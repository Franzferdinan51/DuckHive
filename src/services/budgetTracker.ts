/**
 * Budget Tracker Service
 *
 * Tracks per-provider daily spend and enforces daily budget limits.
 * Falls back to the next-cheapest available provider when a budget is exceeded.
 * Storage: ~/.duckhive/budget-state.json (daily spend per provider)
 * Logging: ~/.duckhive/budget-log.jsonl (all budget decisions)
 *
 * Follows DuckHive patterns from policyLimits (fail-open, file caching, session state).
 */

import { existsSync, readFileSync as fsReadFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { safeParseJSON } from '../utils/json.js'
import { sleep } from '../utils/sleep.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'moonshotai'
  | 'deepseek'
  | 'gemini'
  | 'mistral'
  | 'together'
  | 'groq'
  | 'azure-openai'
  | 'openrouter'
  | 'lmstudio'
  | 'dashscope'
  | 'nvidia-nim'
  | 'minimax'
  | 'atomic-chat'
  | 'ollama'

export interface ProviderBudgetSettings {
  /** Daily budget limit in USD for this provider */
  dailyBudgetUsd: number
  /** Whether this provider is enabled (can be used for routing) */
  enabled: boolean
  /** Priority rank — lower = preferred. 0 = disabled. */
  priority: number
}

export interface DailySpend {
  provider: ProviderId
  date: string // YYYY-MM-DD
  spentUsd: number
  requests: number
  tokensUsed: number
}

export interface BudgetState {
  /** Per-provider daily budget config (can be overridden at runtime) */
  providerSettings: Partial<Record<ProviderId, ProviderBudgetSettings>>
  /** Global daily budget cap in USD (all providers combined) */
  globalDailyBudgetUsd: number
  /** Today's spend per provider */
  dailySpend: Record<ProviderId, DailySpend>
  /** Last date the spend was reset (YYYY-MM-DD) */
  lastResetDate: string
  /** Explicit fallback chain override (provider IDs in order) */
  fallbackChainOverride?: ProviderId[]
}

export interface BudgetCheckResult {
  allowed: boolean
  provider: ProviderId
  reason: 'ok' | 'provider_over_budget' | 'global_over_budget' | 'provider_disabled'
  remainingUsd: number
  fallbackProvider?: ProviderId
}

export interface BudgetLogEntry {
  timestamp: string // ISO-8601
  event: 'check' | 'track' | 'fallback' | 'budget_exceeded' | 'reset'
  provider: ProviderId
  amountUsd?: number
  reason?: string
  fallbackProvider?: ProviderId
  dailySpentUsd?: number
  dailyBudgetUsd?: number
  globalSpentUsd?: number
  globalBudgetUsd?: number
}

// ---------------------------------------------------------------------------
// Default known provider costs (USD per 1M tokens — input + output average)
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER_COSTS: Record<ProviderId, number> = {
  // Most expensive first (fallbacks will route to cheaper)
  'anthropic': 15.0,       // Claude Sonnet 4 / Opus 4
  'openai': 15.0,          // GPT-5 / GPT-4o
  'nvidia-nim': 12.0,      // NVIDIA NIM premium
  'moonshotai': 10.0,      // Kimi K2.5
  'deepseek': 8.0,         // DeepSeek V3
  'gemini': 7.5,           // Gemini 3 series
  'mistral': 7.0,          // Devstral / Mistral
  'together': 5.0,         // Together AI (various models)
  'openrouter': 5.0,       // OpenRouter (varies by model)
  'azure-openai': 5.0,    // Azure OpenAI
  'groq': 3.0,             // Groq (LLaMA 3.3 70B)
  'dashscope': 2.0,        // Alibaba Qwen 3.6
  'minimax': 1.5,          // MiniMax M2.5
  'ollama': 0.0,           // Local — no API cost
  'lmstudio': 0.0,         // Local — no API cost
  'atomic-chat': 0.0,      // Local — no API cost
}

const DEFAULT_DAILY_BUDGETS: Partial<Record<ProviderId, number>> = {
  'anthropic': 10.0,
  'openai': 10.0,
  'moonshotai': 5.0,
  'deepseek': 5.0,
  'gemini': 5.0,
  'minimax': 5.0,
  'mistral': 3.0,
  'together': 3.0,
  'groq': 2.0,
  'openrouter': 3.0,
  'nvidia-nim': 3.0,
  'azure-openai': 5.0,
  'dashscope': 2.0,
  'lmstudio': 0,    // Free — default to unlimited
  'ollama': 0,      // Free — default to unlimited
  'atomic-chat': 0, // Free — default to unlimited
}

const DEFAULT_GLOBAL_DAILY_BUDGET_USD = 20.0

// ---------------------------------------------------------------------------
// File paths
// ---------------------------------------------------------------------------

const BUDGET_STATE_FILENAME = 'budget-state.json'
const BUDGET_LOG_FILENAME = 'budget-log.jsonl'

function getBudgetStatePath(): string {
  return join(getClaudeConfigHomeDir(), BUDGET_STATE_FILENAME)
}

function getBudgetLogPath(): string {
  return join(getClaudeConfigHomeDir(), BUDGET_LOG_FILENAME)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]!
}

function isToday(dateStr: string): boolean {
  return dateStr === getTodayDate()
}

/** Returns true when dateA and dateB are the same calendar day. */
function sameDay(dateA: string, dateB: string): boolean {
  return dateA === dateB
}

// ---------------------------------------------------------------------------
// Default fallback chain: most-expensive-first (so we prefer cheaper providers
// unless budget allows premium). Sorted by cost descending.
// ---------------------------------------------------------------------------

function buildDefaultFallbackChain(): ProviderId[] {
  return Object.entries(DEFAULT_PROVIDER_COSTS)
    .sort(([, costA], [, costB]) => costB - costA)
    .map(([id]) => id as ProviderId)
    .filter(id => DEFAULT_DAILY_BUDGETS[id] !== 0) // exclude free local providers from paid chain
}

// ---------------------------------------------------------------------------
// Module-level state (mirrors policyLimits sessionCache pattern)
// ---------------------------------------------------------------------------

let sessionState: BudgetState | null = null
let logWritePending = false
const LOG_WRITE_DEBOUNCE_MS = 500

// ---------------------------------------------------------------------------
// Core state operations
// ---------------------------------------------------------------------------

function getDefaultState(): BudgetState {
  return {
    providerSettings: Object.fromEntries(
      Object.entries(DEFAULT_DAILY_BUDGETS).map(([id, budget]) => [
        id,
        {
          dailyBudgetUsd: budget ?? 0,
          enabled: budget !== undefined && budget > 0,
          priority: budget === undefined ? 0 : 10, // undefined = free = disabled for routing
        } satisfies ProviderBudgetSettings,
      ]),
    ) as Partial<Record<ProviderId, ProviderBudgetSettings>>,
    globalDailyBudgetUsd: DEFAULT_GLOBAL_DAILY_BUDGET_USD,
    dailySpend: {} as Record<ProviderId, DailySpend>,
    lastResetDate: getTodayDate(),
  }
}

function loadStateFromDisk(): BudgetState {
  try {
    const content = fsReadFileSync(getBudgetStatePath(), 'utf-8')
    const parsed = safeParseJSON(content, false) as BudgetState | null
    if (!parsed) return getDefaultState()

    // Validate required fields
    if (
      typeof parsed.globalDailyBudgetUsd !== 'number' ||
      !parsed.lastResetDate
    ) {
      return getDefaultState()
    }

    return parsed
  } catch {
    return getDefaultState()
  }
}

async function saveStateToDisk(state: BudgetState): Promise<void> {
  try {
    await writeFile(getBudgetStatePath(), JSON.stringify(state, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch (error) {
    // Fail silently — budget tracking should never break API calls
    await appendLog({
      timestamp: new Date().toISOString(),
      event: 'reset',
      provider: 'minimax',
      reason: `save_state_failed: ${error instanceof Error ? error.message : 'unknown'}`,
    })
  }
}

/** Flush state to disk in background with debounce to avoid hammering fs. */
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStateSave(state: BudgetState): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer)
  saveDebounceTimer = setTimeout(() => {
    void saveStateToDisk(state)
    saveDebounceTimer = null
  }, LOG_WRITE_DEBOUNCE_MS)
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

async function appendLog(entry: BudgetLogEntry): Promise<void> {
  try {
    const line = JSON.stringify(entry) + '\n'
    await writeFile(getBudgetLogPath(), line, { encoding: 'utf-8', flag: 'a' })
  } catch {
    // Never let log write failures affect budget decisions
  }
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

/**
 * Get or create the current budget state.
 * Handles daily rollover automatically.
 */
export function getBudgetState(): BudgetState {
  if (!sessionState) {
    const state = loadStateFromDisk()
    sessionState = state
    void checkAndResetDailySpend(sessionState)
  }

  if (!sessionState) {
    sessionState = getDefaultState()
  }

  // Auto-reset if it's a new day
  checkAndResetDailySpend(sessionState)

  return sessionState
}

function checkAndResetDailySpend(state: BudgetState): void {
  const today = getTodayDate()
  if (!sameDay(state.lastResetDate, today)) {
    // Capture spend BEFORE clearing so the log reflects actual usage
    const totalSpentBeforeReset = Object.values(state.dailySpend).reduce((sum, s) => sum + s.spentUsd, 0)
    state.dailySpend = {} as Record<ProviderId, DailySpend>
    state.lastResetDate = today
    scheduleStateSave(state)
    void appendLog({
      timestamp: new Date().toISOString(),
      event: 'reset',
      provider: 'minimax',
      reason: `daily_reset_new_date=${today}`,
      globalSpentUsd: totalSpentBeforeReset,
      globalBudgetUsd: state.globalDailyBudgetUsd,
    })
  }
}

function getOrCreateDailySpend(
  state: BudgetState,
  provider: ProviderId,
): DailySpend {
  const today = getTodayDate()
  if (!state.dailySpend[provider] || state.dailySpend[provider]!.date !== today) {
    state.dailySpend[provider] = {
      provider,
      date: today,
      spentUsd: 0,
      requests: 0,
      tokensUsed: 0,
    }
  }
  return state.dailySpend[provider]!
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a provider is over its daily budget.
 * Returns { allowed: true } if the call can proceed.
 * Returns { allowed: false, fallbackProvider } if routing should occur.
 */
export function isProviderOverBudget(provider: ProviderId): BudgetCheckResult {
  const state = getBudgetState()

  const settings = state.providerSettings[provider]
  if (!settings || !settings.enabled || settings.dailyBudgetUsd <= 0) {
    // Provider is disabled or has no budget — treat as OK
    return {
      allowed: true,
      provider,
      reason: settings && !settings.enabled ? 'provider_disabled' : 'ok',
      remainingUsd: 0,
    }
  }

  const spend = getOrCreateDailySpend(state, provider)
  const remaining = Math.max(0, settings.dailyBudgetUsd - spend.spentUsd)

  if (spend.spentUsd >= settings.dailyBudgetUsd) {
    const fallback = getNextFallback(provider)
    void appendLog({
      timestamp: new Date().toISOString(),
      event: 'budget_exceeded',
      provider,
      reason: `daily_limit_reached`,
      fallbackProvider: fallback,
      dailySpentUsd: spend.spentUsd,
      dailyBudgetUsd: settings.dailyBudgetUsd,
    })
    return {
      allowed: false,
      provider,
      reason: 'provider_over_budget',
      remainingUsd: 0,
      fallbackProvider: fallback,
    }
  }

  return { allowed: true, provider, reason: 'ok', remainingUsd: remaining }
}

/**
 * Check if the global daily budget cap would be exceeded.
 */
export function isGlobalOverBudget(): BudgetCheckResult {
  const state = getBudgetState()
  const totalSpent = Object.values(state.dailySpend).reduce(
    (sum, s) => sum + s.spentUsd,
    0,
  )
  const remaining = Math.max(0, state.globalDailyBudgetUsd - totalSpent)

  if (totalSpent >= state.globalDailyBudgetUsd) {
    const fallback = getNextFallback(undefined)
    void appendLog({
      timestamp: new Date().toISOString(),
      event: 'budget_exceeded',
      provider: 'minimax',
      reason: 'global_limit_reached',
      fallbackProvider: fallback,
      globalSpentUsd: totalSpent,
      globalBudgetUsd: state.globalDailyBudgetUsd,
    })
    return {
      allowed: false,
      provider: 'minimax',
      reason: 'global_over_budget',
      remainingUsd: 0,
      fallbackProvider: fallback,
    }
  }

  return { allowed: true, provider: 'minimax', reason: 'ok', remainingUsd: remaining }
}

/**
 * Combined check: provider budget AND global budget.
 * Returns the first available provider (including fallbacks) that is under budget.
 */
export function checkBudget(provider: ProviderId): BudgetCheckResult {
  const providerCheck = isProviderOverBudget(provider)
  if (providerCheck.allowed) {
    const globalCheck = isGlobalOverBudget()
    if (!globalCheck.allowed) {
      return globalCheck
    }
    return providerCheck
  }
  return providerCheck
}

/**
 * Track spend for a provider after an API call.
 * @param provider  The provider used
 * @param amountUsd  The cost in USD (input + output tokens)
 * @param tokensUsed Total tokens used (for record keeping)
 */
export function trackSpend(
  provider: ProviderId,
  amountUsd: number,
  tokensUsed: number = 0,
): void {
  const state = getBudgetState()
  const spend = getOrCreateDailySpend(state, provider)

  spend.spentUsd += amountUsd
  spend.requests += 1
  spend.tokensUsed += tokensUsed

  const settings = state.providerSettings[provider]
  const dailyBudgetUsd = settings?.dailyBudgetUsd ?? 0

  scheduleStateSave(state)

  void appendLog({
    timestamp: new Date().toISOString(),
    event: 'track',
    provider,
    amountUsd,
    dailySpentUsd: spend.spentUsd,
    dailyBudgetUsd,
    globalSpentUsd: Object.values(state.dailySpend).reduce((sum, s) => sum + s.spentUsd, 0),
    globalBudgetUsd: state.globalDailyBudgetUsd,
  })
}

/**
 * Get the remaining daily budget for a provider.
 */
export function getRemainingBudget(provider: ProviderId): number {
  const state = getBudgetState()
  const settings = state.providerSettings[provider]

  if (!settings || settings.dailyBudgetUsd <= 0) {
    return Infinity // Free provider — unlimited
  }

  const spend = state.dailySpend[provider]
  if (!spend) return settings.dailyBudgetUsd

  return Math.max(0, settings.dailyBudgetUsd - spend.spentUsd)
}

/**
 * Get the remaining global budget across all providers.
 */
export function getGlobalRemainingBudget(): number {
  const state = getBudgetState()
  const totalSpent = Object.values(state.dailySpend).reduce(
    (sum, s) => sum + s.spentUsd,
    0,
  )
  return Math.max(0, state.globalDailyBudgetUsd - totalSpent)
}

/**
 * Get all spend for today.
 */
export function getTodaySpend(): Record<ProviderId, DailySpend> {
  const state = getBudgetState()
  return { ...state.dailySpend }
}

/**
 * Get the configured fallback chain (override or default).
 */
export function getFallbackChain(): ProviderId[] {
  const state = getBudgetState()
  return state.fallbackChainOverride ?? buildDefaultFallbackChain()
}

/**
 * Override the fallback chain.
 */
export function setFallbackChain(chain: ProviderId[]): void {
  const state = getBudgetState()
  state.fallbackChainOverride = chain
  scheduleStateSave(state)
}

/**
 * Get the next fallback provider for a given provider (or for any over-budget provider).
 * Returns the cheapest enabled provider that still has budget remaining.
 */
export function getNextFallback(currentProvider?: ProviderId): ProviderId | undefined {
  const state = getBudgetState()
  const chain = state.fallbackChainOverride ?? buildDefaultFallbackChain()

  for (const candidate of chain) {
    if (candidate === currentProvider) continue
    const settings = state.providerSettings[candidate]
    if (!settings || !settings.enabled) continue

    const check = isProviderOverBudget(candidate)
    if (check.allowed) {
      const globalCheck = isGlobalOverBudget()
      if (globalCheck.allowed) {
        return candidate
      }
    }
  }

  // All paid providers exhausted — fall back to free local options
  const freeProviders: ProviderId[] = ['ollama', 'lmstudio', 'atomic-chat']
  for (const free of freeProviders) {
    const settings = state.providerSettings[free]
    if (settings?.enabled !== false) {
      return free
    }
  }

  return undefined
}

/**
 * Update budget settings for a provider.
 */
export function setProviderBudget(
  provider: ProviderId,
  settings: Partial<ProviderBudgetSettings>,
): void {
  const state = getBudgetState()
  const current = state.providerSettings[provider] ?? {
    dailyBudgetUsd: DEFAULT_DAILY_BUDGETS[provider] ?? 0,
    enabled: true,
    priority: 10,
  }
  state.providerSettings[provider] = { ...current, ...settings }
  scheduleStateSave(state)
}

/**
 * Update the global daily budget cap.
 */
export function setGlobalBudget(limitUsd: number): void {
  const state = getBudgetState()
  state.globalDailyBudgetUsd = limitUsd
  scheduleStateSave(state)
}

/**
 * Reset spend for all providers (admin/debug use).
 */
export function resetAllSpend(): void {
  const state = getBudgetState()
  state.dailySpend = {} as Record<ProviderId, DailySpend>
  state.lastResetDate = getTodayDate()
  scheduleStateSave(state)
  void appendLog({
    timestamp: new Date().toISOString(),
    event: 'reset',
    provider: 'minimax',
    reason: 'manual_reset',
    globalSpentUsd: 0,
    globalBudgetUsd: state.globalDailyBudgetUsd,
  })
}

/**
 * Reset spend for a specific provider.
 */
export function resetProviderSpend(provider: ProviderId): void {
  const state = getBudgetState()
  delete state.dailySpend[provider]
  state.lastResetDate = getTodayDate()
  scheduleStateSave(state)
}

/**
 * Force a daily reset immediately (normally triggered automatically).
 */
export function forceDailyReset(): void {
  const state = getBudgetState()
  state.dailySpend = {} as Record<ProviderId, DailySpend>
  state.lastResetDate = getTodayDate()
  scheduleStateSave(state)
}

/**
 * Get the estimated cost for a provider based on known pricing.
 * Returns cost per 1M tokens (average input+output).
 */
export function getProviderCostPerMillionTokens(provider: ProviderId): number {
  return DEFAULT_PROVIDER_COSTS[provider] ?? 1.0
}

/**
 * Get all providers sorted by cost (ascending — cheapest first).
 */
export function getProvidersByCost(): Array<{ provider: ProviderId; costPerM: number }> {
  return Object.entries(DEFAULT_PROVIDER_COSTS)
    .map(([id, cost]) => ({ provider: id as ProviderId, costPerM: cost }))
    .sort((a, b) => a.costPerM - b.costPerM)
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let initialized = false

/**
 * Initialize budget tracker. Safe to call multiple times.
 * Loads state from disk and resets if it's a new day.
 */
export function initBudgetTracker(): void {
  if (initialized) return
  initialized = true

  // Pre-load state to trigger daily reset check
  getBudgetState()

  // Ensure log file exists (appendLog handles this, but we want it discoverable)
  if (!existsSync(getBudgetLogPath())) {
    void appendLog({
      timestamp: new Date().toISOString(),
      event: 'reset',
      provider: 'minimax',
      reason: 'budget_tracker_initialized',
    })
  }
}

// Auto-initialize on module load
initBudgetTracker()
