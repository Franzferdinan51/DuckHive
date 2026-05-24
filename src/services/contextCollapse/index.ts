/**
 * Context Collapse Service
 *
 * Provides conversation summarization and collapse for long-running sessions.
 * Implements a keep-first/keep-last/collapse-middle strategy to maintain
 * conversation context within token budgets.
 *
 * Enabled via DUCKHIVE_CONTEXT_COLLAPSE=1 or feature('CONTEXT_COLLAPSE').
 */

import { feature } from 'bun:bundle'
import { logForDebugging } from '../../utils/debug.js'

// ============================================================================
// Types
// ============================================================================

export interface CollapsedSpan {
  id: string
  startIndex: number
  endIndex: number
  summary: string
  tokenCount: number
  messageCount: number
}

export interface ContextCollapseStats {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: {
    totalSpawns: number
    totalErrors: number
    lastError: string | null
    totalEmptySpawns: number
    emptySpawnWarningEmitted: boolean
  }
}

export interface CollapseResult {
  messages: unknown[]
  collapsed: CollapsedSpan[]
  removedCount: number
}

// ============================================================================
// Configuration
// ============================================================================

const COLLAPSE_THRESHOLD_MESSAGES = 20 // Collapse when conversation exceeds this many messages
const COLLAPSE_MIN_MESSAGES = 8       // Don't collapse until at least this many messages exist
const COLLAPSE_TARGET_KEEP = 6        // When collapsing, keep this many from start and end each
const MAX_SUMMARY_TOKENS = 4000       // Max tokens for the collapsed summary content

let enabled = false
let stats: ContextCollapseStats = {
  collapsedSpans: 0,
  collapsedMessages: 0,
  stagedSpans: 0,
  health: {
    totalSpawns: 0,
    totalErrors: 0,
    lastError: null,
    totalEmptySpawns: 0,
    emptySpawnWarningEmitted: false,
  },
}
const listeners = new Set<() => void>()

function createEmptyStats(): ContextCollapseStats {
  return {
    collapsedSpans: 0,
    collapsedMessages: 0,
    stagedSpans: 0,
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      lastError: null,
      totalEmptySpawns: 0,
      emptySpawnWarningEmitted: false,
    },
  }
}

function cloneStats(value: ContextCollapseStats): ContextCollapseStats {
  return {
    ...value,
    health: { ...value.health },
  }
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      logForDebugging(
        `[context-collapse] subscriber error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

// ============================================================================
// Core API
// ============================================================================

export function initContextCollapse(): void {
  let featureEnabled = false
  if (feature('CONTEXT_COLLAPSE')) {
    featureEnabled = true
  }

  const previousEnabled = enabled
  enabled = featureEnabled || process.env.DUCKHIVE_CONTEXT_COLLAPSE === '1'
  if (enabled !== previousEnabled) {
    notifyListeners()
  }
  logForDebugging(`[context-collapse] init — enabled=${enabled}`)
}

export function isContextCollapseEnabled(): boolean {
  return enabled
}

export function getContextCollapseState(): { enabled: boolean; stats: ContextCollapseStats } | null {
  return enabled ? { enabled, stats: cloneStats(stats) } : null
}

export function getStats(): ContextCollapseStats {
  return cloneStats(stats)
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetContextCollapse(): void {
  stats = createEmptyStats()
  notifyListeners()
}

// ============================================================================
// Message type detection
// ============================================================================

function getMessageRole(msg: unknown): string {
  if (typeof msg !== 'object' || msg === null) return 'unknown'
  const m = msg as Record<string, unknown>
  if (m['role']) return String(m['role'])
  if (m['type']) return String(m['type'])
  return 'unknown'
}

function getMessageContent(msg: unknown): string {
  if (typeof msg !== 'object' || msg === null) return ''
  const m = msg as Record<string, unknown>

  // Handle content as string or array of blocks
  const content = m['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(b => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text')
      .map(b => String((b as Record<string, unknown>)['text'] ?? ''))
      .join('\n')
  }
  return String(content ?? '')
}

function isUserMessage(msg: unknown): boolean {
  return getMessageRole(msg) === 'user'
}

function isAssistantMessage(msg: unknown): boolean {
  return getMessageRole(msg) === 'assistant'
}

function isSystemMessage(msg: unknown): boolean {
  return getMessageRole(msg) === 'system'
}

// ============================================================================
// Collapse Strategy: keep first N, keep last N, summarize the middle
// ============================================================================

/**
 * Identify consecutive non-essential message spans that can be collapsed.
 * Returns indices [start, end) of collaspable regions.
 */
function findCollapsibleRegions(messages: unknown[]): Array<[number, number]> {
  const regions: Array<[number, number]> = []
  const len = messages.length

  // Don't collapse until we have enough messages
  if (len < COLLAPSE_MIN_MESSAGES) return regions

  // Check if total exceeds threshold — collapse the middle block
  if (len > COLLAPSE_THRESHOLD_MESSAGES) {
    const keepFirst = COLLAPSE_TARGET_KEEP
    const keepLast = COLLAPSE_TARGET_KEEP
    const middleStart = keepFirst
    const middleEnd = len - keepLast

    // Only collapse if there's a meaningful middle section (≥4 messages)
    // and the middle section doesn't consist entirely of collapse summaries
    if (middleEnd - middleStart >= 4) {
      const middleMessages = messages.slice(middleStart, middleEnd)
      const nonSummaryCount = middleMessages.filter(
        m => !isCollapseSummaryMessage(m),
      ).length
      if (nonSummaryCount >= 4) {
        regions.push([middleStart, middleEnd])
      }
    }
  }

  return regions
}

function isCollapseSummaryMessage(msg: unknown): boolean {
  if (typeof msg !== 'object' || msg === null) return false
  const content = (msg as Record<string, unknown>)['content']
  return typeof content === 'string' && content.startsWith('[Previous conversation summary')
}

/**
 * Generate a summary text from a list of messages.
 * Uses the content from messages, filtering to user and assistant messages.
 */
function generateSummary(messages: unknown[]): string {
  const lines: string[] = []
  for (const msg of messages) {
    const role = getMessageRole(msg)
    if (role === 'system') continue
    const content = getMessageContent(msg).trim()
    if (!content) continue
    const prefix = role === 'user' ? 'User' : role === 'assistant' ? 'Assistant' : role
    lines.push(`[${prefix}]: ${content.substring(0, 300)}`)
  }
  return lines.join('\n').slice(0, MAX_SUMMARY_TOKENS * 4)
}

/**
 * Build a system message that represents the collapsed span.
 */
function buildCollapseSystemMessage(summary: string, collapsedCount: number): {
  type: 'system'
  role: 'system'
  content: string
  [key: string]: unknown
} {
  return {
    type: 'system',
    role: 'system',
    content: `[Previous conversation summary (${collapsedCount} messages collapsed):]\n${summary}\n[End of summary]`,
  }
}

/**
 * Apply collapses to a message array.
 *
 * Strategy:
 * - Keep first COLLAPSE_TARGET_KEEP messages (context anchor)
 * - Keep last COLLAPSE_TARGET_KEEP messages (recent context)
 * - Replace middle section with a single summary system message
 * - Track collapsed spans for persistence
 */
export function applyCollapsesIfNeeded(
  messages: unknown[],
  _toolUseContext: unknown,
  _querySource: unknown,
): { messages: unknown[] } {
  if (!enabled || messages.length === 0) {
    return { messages }
  }

  stats.health.totalSpawns++

  try {
    const regions = findCollapsibleRegions(messages)
    if (regions.length === 0) {
      stats.health.totalEmptySpawns++
      notifyListeners()
      return { messages }
    }

    let result = messages
    const collapsed: CollapsedSpan[] = []

    // Apply regions in reverse order to preserve indices
    for (const [start, end] of regions.toReversed()) {
      const middleMessages = result.slice(start, end)
      const summary = generateSummary(middleMessages)
      const collapsedCount = end - start

      const span: CollapsedSpan = {
        id: `collapse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        startIndex: start,
        endIndex: end,
        summary,
        tokenCount: roughTokenEstimate(summary),
        messageCount: collapsedCount,
      }

      // Build the collapsed message list
      const before = result.slice(0, start)
      const after = result.slice(end)
      const collapseMsg = buildCollapseSystemMessage(summary, collapsedCount)
      result = [...before, collapseMsg, ...after]

      collapsed.push(span)
    }

    stats.collapsedSpans += collapsed.length
    stats.collapsedMessages += collapsed.reduce((sum, s) => sum + s.messageCount, 0)
    notifyListeners()

    logForDebugging(
      `[context-collapse] collapsed ${collapsed.length} span(s), ` +
      `removed ${collapsed.reduce((s, c) => s + c.messageCount, 0)} messages`,
    )

    return { messages: result }
  } catch (err) {
    stats.health.totalErrors++
    stats.health.lastError = err instanceof Error ? err.message : String(err)
    notifyListeners()
    logForDebugging(`[context-collapse] error: ${stats.health.lastError}`)
    return { messages }
  }
}

function roughTokenEstimate(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4)
}

export function recoverFromOverflow(
  messages: unknown[],
  querySource: unknown,
): { messages: unknown[]; committed: number } {
  if (!enabled || messages.length === 0) {
    return { messages, committed: 0 }
  }

  const result = applyCollapsesIfNeeded(messages, undefined, querySource)
  return {
    messages: result.messages,
    committed: Math.max(0, messages.length - result.messages.length),
  }
}

export function isWithheldPromptTooLong(): boolean {
  // This projection path does not withhold API errors by itself.
  return false
}

// ============================================================================
// Persistence (for resume across sessions)
// ============================================================================

export function restoreFromEntries(
  _commits: unknown[],
  _snapshot: unknown,
): void {
  // When fully implemented, this rebuilds the commit log from transcript entries.
  // For now, the session storage handles message persistence natively.
  // The collapse state is maintained in-memory during a session.
}
