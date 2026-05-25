/**
 * Token Spy — Real-time Token Usage Monitoring & Budget Alerts
 *
 * Inspired by DreamServer's Token Spy service, adapted for DuckHive.
 *
 * Provides real-time token usage monitoring with configurable alert thresholds,
 * per-provider tracking, and proactive budget warnings. Integrates with the
 * existing budgetTracker.ts for spend enforcement and cost-tracking.
 *
 * Features:
 *   - Real-time input/output token counting per API call
 *   - Per-session and cumulative token tracking
 *   - Configurable alert thresholds (warn %, critical %)
 *   - Provider-specific token pricing integration
 *   - Budget-blowout early warning system
 *   - Streaming-aware token counting
 */

import {
  type ProviderId,
  getProviderCostPerMillionTokens,
  getRemainingBudget,
  getGlobalRemainingBudget,
  trackSpend,
} from './budgetTracker.js'
import { logForDebugging } from '../utils/debug.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TokenSpyConfig {
  /** Warn at this % of per-provider budget (default 70%) */
  warnThresholdPercent: number
  /** Critical alert at this % of per-provider budget (default 90%) */
  criticalThresholdPercent: number
  /** Warn at this % of global budget (default 80%) */
  globalWarnThresholdPercent: number
  /** Emit a log event on every tracking update */
  verboseTracking: boolean
  /** Suppress budget warnings entirely (for tests) */
  suppressWarnings: boolean
}

export interface TokenUsageSnapshot {
  provider: ProviderId
  /** Input tokens for this specific call */
  inputTokens: number
  /** Output tokens for this specific call */
  outputTokens: number
  /** Total tokens (input + output) */
  totalTokens: number
  /** Estimated cost in USD */
  estimatedCostUsd: number
  /** Cumulative input tokens this session */
  sessionInputTokens: number
  /** Cumulative output tokens this session */
  sessionOutputTokens: number
  /** Running total tokens this session */
  sessionTotalTokens: number
  /** Running total cost this session */
  sessionTotalCostUsd: number
  /** Per-provider remaining daily budget */
  remainingProviderBudgetUsd: number
  /** Global remaining daily budget */
  remainingGlobalBudgetUsd: number
}

export interface TokenAlert {
  level: 'warn' | 'critical'
  provider: ProviderId
  message: string
  /** % of budget consumed */
  budgetConsumedPercent: number
  /** Remaining budget in USD */
  remainingUsd: number
  /** Timestamp of alert */
  timestamp: string
}

export type TokenAlertCallback = (alert: TokenAlert) => void

// ─── Default config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TokenSpyConfig = {
  warnThresholdPercent: 70,
  criticalThresholdPercent: 90,
  globalWarnThresholdPercent: 80,
  verboseTracking: false,
  suppressWarnings: false,
}

// ─── Module-level state ─────────────────────────────────────────────────────

let config: TokenSpyConfig = { ...DEFAULT_CONFIG }
const alertCallbacks: TokenAlertCallback[] = []
const sessionTokens: Map<ProviderId, { input: number; output: number; cost: number }> = new Map()
const alertCooldowns: Map<string, number> = new Map() // key = provider:level, value = last alert timestamp
const COOLDOWN_MS = 30_000 // Don't repeat same alert within 30 seconds

// ─── Configuration ─────────────────────────────────────────────────────────

export function configureTokenSpy(overrides: Partial<TokenSpyConfig>): void {
  config = { ...config, ...overrides }
}

export function resetTokenSpyConfig(): void {
  config = { ...DEFAULT_CONFIG }
}

export function getTokenSpyConfig(): TokenSpyConfig {
  return { ...config }
}

// ─── Alert system ──────────────────────────────────────────────────────────

export function onTokenAlert(callback: TokenAlertCallback): () => void {
  alertCallbacks.push(callback)
  return () => {
    const idx = alertCallbacks.indexOf(callback)
    if (idx >= 0) alertCallbacks.splice(idx, 1)
  }
}

function emitAlert(alert: TokenAlert): void {
  // Cleanup stale cooldown entries (> 2x COOLDOWN_MS) to prevent unbounded growth
  const now = Date.now()
  for (const [key, timestamp] of alertCooldowns) {
    if (now - timestamp > COOLDOWN_MS * 2) {
      alertCooldowns.delete(key)
    }
  }

  // Cooldown check — don't spam the same alert
  const key = `${alert.provider}:${alert.level}`
  const lastTime = alertCooldowns.get(key) ?? 0
  if (now - lastTime < COOLDOWN_MS) return
  alertCooldowns.set(key, now)

  // Always log
  const level = alert.level === 'critical' ? 'CRITICAL' : 'WARN'
  logForDebugging(
    `[TokenSpy:${level}] ${alert.message} (${alert.budgetConsumedPercent.toFixed(1)}% consumed, $${alert.remainingUsd.toFixed(2)} remaining)`,
  )

  // Notify callbacks
  for (const cb of alertCallbacks) {
    try {
      cb(alert)
    } catch {
      // Never let callback errors affect token tracking
    }
  }
}

// ─── Token tracking ────────────────────────────────────────────────────────

/**
 * Track token usage for a single API call. Updates session state,
 * checks budget thresholds, and emits alerts if needed.
 *
 * @param provider  The provider used for this call
 * @param inputTokens  Number of input tokens consumed
 * @param outputTokens Number of output tokens consumed
 * @returns A snapshot of current token usage state
 */
export function trackTokenUsage(
  provider: ProviderId,
  inputTokens: number,
  outputTokens: number,
): TokenUsageSnapshot {
  const totalTokens = inputTokens + outputTokens
  const costPerMillion = getProviderCostPerMillionTokens(provider)
  const estimatedCostUsd = (totalTokens / 1_000_000) * costPerMillion

  // Update session state
  const session = sessionTokens.get(provider) ?? { input: 0, output: 0, cost: 0 }
  session.input += inputTokens
  session.output += outputTokens
  session.cost += estimatedCostUsd
  sessionTokens.set(provider, session)

  // Track spend in budget tracker (for daily limits)
  try {
    trackSpend(provider, estimatedCostUsd, totalTokens)
  } catch {
    // Never let budget tracker errors affect token tracking
  }

  // Compute budget remaining
  const remainingProviderBudgetUsd = getRemainingBudget(provider)
  const remainingGlobalBudgetUsd = getGlobalRemainingBudget()

  // Check provider budget thresholds
  const providerBudgetUsd = remainingProviderBudgetUsd + session.cost
  if (providerBudgetUsd > 0 && !config.suppressWarnings) {
    const providerConsumedPercent = (session.cost / providerBudgetUsd) * 100

    if (providerConsumedPercent >= config.criticalThresholdPercent) {
      emitAlert({
        level: 'critical',
        provider,
        message: `Provider ${provider} budget critical: ${providerConsumedPercent.toFixed(1)}% consumed`,
        budgetConsumedPercent: providerConsumedPercent,
        remainingUsd: remainingProviderBudgetUsd,
        timestamp: new Date().toISOString(),
      })
    } else if (providerConsumedPercent >= config.warnThresholdPercent) {
      emitAlert({
        level: 'warn',
        provider,
        message: `Provider ${provider} budget warning: ${providerConsumedPercent.toFixed(1)}% consumed`,
        budgetConsumedPercent: providerConsumedPercent,
        remainingUsd: remainingProviderBudgetUsd,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Check global budget threshold
  if (remainingGlobalBudgetUsd >= 0 && !config.suppressWarnings) {
    const globalSpent = getGlobalSessionCost()
    const globalBudget = remainingGlobalBudgetUsd + globalSpent
    const globalPercent = (globalSpent / globalBudget) * 100

    if (globalPercent >= config.globalWarnThresholdPercent) {
      emitAlert({
        level: globalPercent >= config.criticalThresholdPercent ? 'critical' : 'warn',
        provider,
        message: `Global budget ${globalPercent >= config.criticalThresholdPercent ? 'critical' : 'warning'}: ${globalPercent.toFixed(1)}% consumed`,
        budgetConsumedPercent: globalPercent,
        remainingUsd: remainingGlobalBudgetUsd,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Verbose logging
  if (config.verboseTracking) {
    logForDebugging(
      `[TokenSpy] ${provider}: ${inputTokens} in + ${outputTokens} out = ${totalTokens} tokens, ` +
      `$${estimatedCostUsd.toFixed(4)} (session: ${session.input} in / ${session.output} out / $${session.cost.toFixed(2)})`,
    )
  }

  return {
    provider,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd,
    sessionInputTokens: session.input,
    sessionOutputTokens: session.output,
    sessionTotalTokens: session.input + session.output,
    sessionTotalCostUsd: session.cost,
    remainingProviderBudgetUsd,
    remainingGlobalBudgetUsd,
  }
}

/**
 * Track input tokens only (called at the start of a streaming response).
 */
export function trackInputTokens(
  provider: ProviderId,
  inputTokens: number,
): void {
  const costPerMillion = getProviderCostPerMillionTokens(provider)
  const estimatedCostUsd = (inputTokens / 1_000_000) * costPerMillion

  const session = sessionTokens.get(provider) ?? { input: 0, output: 0, cost: 0 }
  session.input += inputTokens
  session.cost += estimatedCostUsd
  sessionTokens.set(provider, session)

  try {
    trackSpend(provider, estimatedCostUsd, inputTokens)
  } catch {
    // Never let budget tracker errors affect token tracking
  }
}

/**
 * Track output tokens (called during streaming or at message_delta).
 */
export function trackOutputTokens(
  provider: ProviderId,
  outputTokens: number,
): void {
  const costPerMillion = getProviderCostPerMillionTokens(provider)
  const estimatedCostUsd = (outputTokens / 1_000_000) * costPerMillion

  const session = sessionTokens.get(provider) ?? { input: 0, output: 0, cost: 0 }
  session.output += outputTokens
  session.cost += estimatedCostUsd
  sessionTokens.set(provider, session)

  try {
    trackSpend(provider, estimatedCostUsd, outputTokens)
  } catch {
    // Never let budget tracker errors affect token tracking
  }
}

// ─── Query methods ─────────────────────────────────────────────────────────

/**
 * Get the total cost incurred this session across all providers.
 */
export function getGlobalSessionCost(): number {
  let total = 0
  for (const session of sessionTokens.values()) {
    total += session.cost
  }
  return total
}

/**
 * Get session token statistics for a specific provider.
 */
export function getProviderSessionStats(provider: ProviderId): {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
} {
  const session = sessionTokens.get(provider)
  if (!session) return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }
  return {
    inputTokens: session.input,
    outputTokens: session.output,
    totalTokens: session.input + session.output,
    costUsd: session.cost,
  }
}

/**
 * Get a comprehensive session summary.
 */
export function getSessionSummary(): {
  totalTokens: number
  totalCostUsd: number
  providers: Array<{
    provider: ProviderId
    inputTokens: number
    outputTokens: number
    costUsd: number
  }>
} {
  let totalTokens = 0
  let totalCostUsd = 0
  const providers: Array<{
    provider: ProviderId
    inputTokens: number
    outputTokens: number
    costUsd: number
  }> = []

  for (const [provider, session] of sessionTokens) {
    const sessionTotalTokens = session.input + session.output
    totalTokens += sessionTotalTokens
    totalCostUsd += session.cost
    providers.push({
      provider,
      inputTokens: session.input,
      outputTokens: session.output,
      costUsd: session.cost,
    })
  }

  return { totalTokens, totalCostUsd, providers }
}

/**
 * Reset all session tracking. Does NOT reset daily budget tracking
 * (use budgetTracker.resetAllSpend() for that).
 */
export function resetSessionTokens(): void {
  sessionTokens.clear()
  alertCooldowns.clear()
}

/**
 * Estimate the cost for a given number of tokens on a provider.
 */
export function estimateCost(
  provider: ProviderId,
  inputTokens: number,
  outputTokens: number,
): number {
  const costPerMillion = getProviderCostPerMillionTokens(provider)
  return ((inputTokens + outputTokens) / 1_000_000) * costPerMillion
}

/**
 * Get a human-readable budget status string.
 */
export function getBudgetStatus(): string {
  const summary = getSessionSummary()
  const globalRemaining = getGlobalRemainingBudget()
  const parts: string[] = []

  parts.push(`Session: ${summary.totalTokens.toLocaleString()} tokens, $${summary.totalCostUsd.toFixed(2)}`)

  if (globalRemaining < Infinity) {
    parts.push(`Global remaining: $${globalRemaining.toFixed(2)}`)
  }

  for (const p of summary.providers) {
    const remaining = getRemainingBudget(p.provider)
    if (remaining < Infinity) {
      parts.push(`${p.provider}: $${remaining.toFixed(2)} remaining`)
    }
  }

  return parts.join(' | ')
}
