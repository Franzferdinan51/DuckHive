/**
 * Policy Engine — Tool-Call Governance & Audit
 *
 * Inspired by DreamServer's Agent Policy Engine (APE), adapted for DuckHive.
 *
 * Provides a declarative policy system for governing tool calls made by
 * autonomous agents and subagents. Policies are defined as YAML-inspired
 * rules that specify which tools can be called, under what conditions,
 * and what happens when a policy is violated.
 *
 * Policy format:
 *   - **allow**: Explicitly allow a tool under specific conditions
 *   - **deny**: Explicitly deny a tool
 *   - **audit**: Log tool usage for review without blocking
 *   - **require_approval**: Flag a tool for human approval
 *   - **rate_limit**: Limit how often a tool can be called
 *
 * Integration points:
 *   - Hooks into the tool permission system (yoloClassifier)
 *   - Integrates with subagent spawns (subagentSystem.ts)
 *   - Provides an audit trail for autonomous goal execution
 */

import { logForDebugging } from '../utils/debug.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PolicyRule {
  /** Unique rule identifier */
  id: string
  /** Description of what this rule governs */
  description: string
  /** Tool name pattern to match (supports * wildcard) */
  toolPattern: string
  /** The action to take when this rule matches */
  action: 'allow' | 'deny' | 'audit' | 'require_approval' | 'rate_limit'
  /** Conditions under which this rule applies */
  conditions?: PolicyCondition[]
  /** For rate_limit: max calls per window */
  maxCallsPerWindow?: number
  /** For rate_limit: time window in milliseconds */
  rateWindowMs?: number
  /** Priority: higher = takes precedence. Default 0. */
  priority: number
  /** Whether this rule is enabled */
  enabled: boolean
}

export interface PolicyCondition {
  /** Condition type */
  type: 'context' | 'time' | 'agent' | 'input_match' | 'env'
  /** Condition key (e.g., agent name, env var) */
  key: string
  /** Operator */
  operator: 'equals' | 'contains' | 'regex' | 'not_equals' | 'gt' | 'lt'
  /** Expected value */
  value: string | number | boolean
}

export interface PolicyDecision {
  /** Final action to take */
  action: PolicyRule['action']
  /** Rules that matched */
  matchedRules: string[]
  /** Whether the tool call is blocked */
  blocked: boolean
  /** Whether the tool call requires approval */
  requiresApproval: boolean
  /** Reason for the decision */
  reason: string
}

export interface AuditEntry {
  /** Unique audit entry ID */
  id: string
  /** Timestamp */
  timestamp: string
  /** Tool that was called */
  toolName: string
  /** Input to the tool (redacted for sensitive fields) */
  toolInput: string
  /** Agent that made the call */
  agentId?: string
  /** Decision that was made */
  decision: PolicyDecision
  /** Whether the call was approved */
  approved: boolean
  /** Duration of the tool call in ms (if available) */
  durationMs?: number
  /** Result status */
  result?: 'success' | 'error' | 'denied'
}

export type Policy = PolicyRule[]

// ─── Pattern matching ───────────────────────────────────────────────────────

function matchToolPattern(pattern: string, toolName: string): boolean {
  // Convert glob-style pattern to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  const regex = new RegExp(`^${escaped}$`, 'i')
  return regex.test(toolName)
}

function evaluateCondition(condition: PolicyCondition, context: PolicyEvaluationContext): boolean {
  const contextValue = getContextValue(condition.type, condition.key, context)

  switch (condition.operator) {
    case 'equals':
      return String(contextValue).toLowerCase() === String(condition.value).toLowerCase()
    case 'not_equals':
      return String(contextValue).toLowerCase() !== String(condition.value).toLowerCase()
    case 'contains':
      return String(contextValue).toLowerCase().includes(String(condition.value).toLowerCase())
    case 'regex':
      try {
        return new RegExp(String(condition.value), 'i').test(String(contextValue))
      } catch {
        return false
      }
    case 'gt':
      return Number(contextValue) > Number(condition.value)
    case 'lt':
      return Number(contextValue) < Number(condition.value)
    default:
      return false
  }
}

// ─── Evaluation context ─────────────────────────────────────────────────────

export interface PolicyEvaluationContext {
  /** Name/ID of the agent making the call */
  agentId?: string
  /** Agent type (e.g., 'subagent', 'leader', 'autonomous') */
  agentType?: string
  /** Current time (for time-based conditions) */
  currentTime?: Date
  /** Tool input being evaluated */
  toolInput?: Record<string, unknown>
  /** Environment variables available */
  env?: Record<string, string | undefined>
  /** Custom context values */
  custom?: Record<string, unknown>
}

function getContextValue(
  type: PolicyCondition['type'],
  key: string,
  context: PolicyEvaluationContext,
): string | number | boolean {
  switch (type) {
    case 'context':
      return String(context.custom?.[key] ?? '')
    case 'time': {
      const now = context.currentTime ?? new Date()
      if (key === 'hour') return now.getHours()
      if (key === 'day') return now.getDay()
      if (key === 'date') return now.toISOString().split('T')[0] ?? ''
      return 0
    }
    case 'agent':
      if (key === 'id') return context.agentId ?? ''
      if (key === 'type') return context.agentType ?? ''
      return ''
    case 'input_match': {
      const input = context.toolInput ?? {}
      return String(input[key] ?? '')
    }
    case 'env':
      return context.env?.[key] ?? ''
    default:
      return ''
  }
}

// ─── Rate limiter state ────────────────────────────────────────────────────

interface RateLimitState {
  calls: number[]
  windowStart: number
}

const rateLimitStates: Map<string, RateLimitState> = new Map()

function checkRateLimit(rule: PolicyRule): boolean {
  if (!rule.maxCallsPerWindow || !rule.rateWindowMs) return false

  const key = rule.id
  const now = Date.now()
  const state = rateLimitStates.get(key) ?? { calls: [], windowStart: now }

  // Expire old calls outside the window
  state.calls = state.calls.filter(t => now - t < rule.rateWindowMs!)

  if (state.calls.length >= rule.maxCallsPerWindow) {
    // Rate limit exceeded
    rateLimitStates.set(key, state)
    return true
  }

  // Record this call
  state.calls.push(now)
  rateLimitStates.set(key, state)
  return false
}

// ─── Default policies ──────────────────────────────────────────────────────

const DEFAULT_POLICIES: Policy = [
  {
    id: 'allow-read-only',
    description: 'Allow all file read operations unconditionally',
    toolPattern: 'FileRead*',
    action: 'allow',
    priority: 100,
    enabled: true,
  },
  {
    id: 'allow-search',
    description: 'Allow code search and glob operations',
    toolPattern: 'Grep*',
    action: 'allow',
    priority: 100,
    enabled: true,
  },
  {
    id: 'allow-glob',
    description: 'Allow glob pattern matching',
    toolPattern: 'Glob*',
    action: 'allow',
    priority: 100,
    enabled: true,
  },
  {
    id: 'audit-file-writes',
    description: 'Audit all file write/edit operations',
    toolPattern: 'FileWrite*',
    action: 'audit',
    priority: 50,
    enabled: true,
  },
  {
    id: 'audit-file-edits',
    description: 'Audit all file editing operations',
    toolPattern: 'FileEdit*',
    action: 'audit',
    priority: 50,
    enabled: true,
  },
  {
    id: 'auto-approve-safe-bash',
    description: 'Auto-approve safe bash commands (git status, ls, etc.)',
    toolPattern: 'Bash*',
    action: 'allow',
    conditions: [
      {
        type: 'input_match',
        key: 'command',
        operator: 'regex',
        value: '^(ls|dir|pwd|git\\s+status|git\\s+log|git\\s+diff|echo|cat\\s+\\S+\\.(ts|js|json|md|txt)|head|tail|wc|which|type|node\\s+--version|npm\\s+--version)',
      },
    ],
    priority: 80,
    enabled: true,
  },
  {
    id: 'approve-subagent-spawns',
    description: 'Require approval for spawning subagents',
    toolPattern: 'Task*',
    action: 'require_approval',
    priority: 60,
    enabled: true,
  },
  {
    id: 'rate-limit-web-fetch',
    description: 'Rate limit web fetch calls to 5 per minute',
    toolPattern: 'WebFetch*',
    action: 'rate_limit',
    maxCallsPerWindow: 5,
    rateWindowMs: 60_000,
    priority: 70,
    enabled: true,
  },
  {
    id: 'rate-limit-web-search',
    description: 'Rate limit web search calls to 3 per minute',
    toolPattern: 'WebSearch*',
    action: 'rate_limit',
    maxCallsPerWindow: 3,
    rateWindowMs: 60_000,
    priority: 70,
    enabled: true,
  },
]

// ─── Policy engine state ────────────────────────────────────────────────────

let policies: Policy = [...DEFAULT_POLICIES]
const auditLog: AuditEntry[] = []
const MAX_AUDIT_ENTRIES = 1000
let auditIdCounter = 0

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Load a set of policies, replacing the current policy set.
 * Merges with defaults unless `replaceAll` is true.
 */
export function loadPolicies(newPolicies: Policy, replaceAll = false): void {
  if (replaceAll) {
    policies = [...newPolicies]
  } else {
    // Merge: new policies override defaults by ID
    const merged = new Map<string, PolicyRule>()
    for (const p of policies) merged.set(p.id, p)
    for (const p of newPolicies) merged.set(p.id, p)
    policies = [...merged.values()]
  }

  logForDebugging(`[PolicyEngine] Loaded ${policies.length} policies (${policies.filter(p => p.enabled).length} enabled)`)
}

/**
 * Get the currently loaded policies.
 */
export function getPolicies(): Policy {
  return [...policies]
}

/**
 * Add a single policy rule.
 */
export function addPolicy(rule: PolicyRule): void {
  // Remove existing rule with same ID
  policies = policies.filter(p => p.id !== rule.id)
  policies.push(rule)
}

/**
 * Remove a policy by ID.
 */
export function removePolicy(id: string): boolean {
  const before = policies.length
  policies = policies.filter(p => p.id !== id)
  return policies.length < before
}

/**
 * Reset policies to defaults.
 */
export function resetPolicies(): void {
  policies = [...DEFAULT_POLICIES]
  logForDebugging('[PolicyEngine] Policies reset to defaults')
}

/**
 * Evaluate a tool call against all active policies.
 * Returns a PolicyDecision indicating whether the call is allowed,
 * denied, requires approval, or should be audited.
 *
 * @param toolName  The name of the tool being called
 * @param context  Evaluation context (agent, input, etc.)
 * @returns  Policy decision
 */
export function evaluateToolCall(
  toolName: string,
  context: PolicyEvaluationContext = {},
): PolicyDecision {
  const matchedRules: string[] = []
  let highestAction: PolicyRule['action'] = 'allow'
  let highestPriority = -1
  let blockReason = ''

  // Sort by priority (descending)
  const sortedPolicies = [...policies]
    .filter(p => p.enabled)
    .sort((a, b) => b.priority - a.priority)

  for (const rule of sortedPolicies) {
    // Check tool pattern match
    if (!matchToolPattern(rule.toolPattern, toolName)) continue

    // Check conditions
    if (rule.conditions && rule.conditions.length > 0) {
      const allConditionsMet = rule.conditions.every(c => evaluateCondition(c, context))
      if (!allConditionsMet) continue
    }

    // Rule matches!
    matchedRules.push(rule.id)

    if (rule.priority > highestPriority) {
      highestPriority = rule.priority
    }

    switch (rule.action) {
      case 'deny':
        // Deny takes immediate precedence
        return {
          action: 'deny',
          matchedRules,
          blocked: true,
          requiresApproval: false,
          reason: `Blocked by policy "${rule.id}": ${rule.description}`,
        }

      case 'require_approval':
        highestAction = 'require_approval'
        break

      case 'rate_limit':
        if (checkRateLimit(rule)) {
          return {
            action: 'deny',
            matchedRules,
            blocked: true,
            requiresApproval: false,
            reason: `Rate limited by policy "${rule.id}": max ${rule.maxCallsPerWindow} calls per ${(rule.rateWindowMs ?? 60000) / 1000}s`,
          }
        }
        break

      case 'audit':
        // Audit doesn't change the action, just logs
        break

      case 'allow':
        // Allow is the default
        break
    }
  }

  if (matchedRules.length === 0) {
    return {
      action: 'allow',
      matchedRules: [],
      blocked: false,
      requiresApproval: false,
      reason: 'No matching policy — default allow',
    }
  }

  return {
    action: highestAction,
    matchedRules,
    blocked: false,
    requiresApproval: highestAction === 'require_approval',
    reason: highestAction === 'require_approval'
      ? `Requires approval per policies: ${matchedRules.join(', ')}`
      : `Allowed by policies: ${matchedRules.join(', ')}`,
  }
}

/**
 * Record an audit entry for a tool call decision.
 */
export function recordAudit(
  toolName: string,
  toolInput: unknown,
  decision: PolicyDecision,
  approved: boolean,
  options?: {
    agentId?: string
    durationMs?: number
    result?: 'success' | 'error' | 'denied'
  },
): AuditEntry {
  const entry: AuditEntry = {
    id: `audit-${++auditIdCounter}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    toolName,
    toolInput: safeStringify(toolInput),
    agentId: options?.agentId,
    decision,
    approved,
    durationMs: options?.durationMs,
    result: options?.result,
  }

  auditLog.push(entry)

  // Prune old entries if over limit
  while (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift()
  }

  // Log audits that are purely for tracking
  if (decision.action === 'audit') {
    logForDebugging(
      `[PolicyEngine:Audit] ${toolName} — ${decision.reason} (approved: ${approved})`,
    )
  }

  return entry
}

/**
 * Query the audit log.
 */
export function getAuditLog(options?: {
  toolName?: string
  agentId?: string
  since?: string
  limit?: number
}): AuditEntry[] {
  let entries = [...auditLog]

  if (options?.toolName) {
    entries = entries.filter(e => e.toolName === options.toolName)
  }
  if (options?.agentId) {
    entries = entries.filter(e => e.agentId === options.agentId)
  }
  if (options?.since) {
    entries = entries.filter(e => e.timestamp >= options.since!)
  }
  if (options?.limit && options.limit > 0) {
    entries = entries.slice(-options.limit)
  }

  return entries
}

/**
 * Clear the audit log.
 */
export function clearAuditLog(): void {
  auditLog.length = 0
}

/**
 * Get audit log summary stats.
 */
export function getAuditStats(): {
  total: number
  denied: number
  approved: number
  byTool: Record<string, number>
} {
  const byTool: Record<string, number> = {}
  let denied = 0
  let approved = 0

  for (const entry of auditLog) {
    byTool[entry.toolName] = (byTool[entry.toolName] ?? 0) + 1
    if (entry.decision.blocked) denied++
    else approved++
  }

  return {
    total: auditLog.length,
    denied,
    approved,
    byTool,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeStringify(value: unknown, maxLength = 500): string {
  try {
    const str = JSON.stringify(value)
    return str.length > maxLength ? str.slice(0, maxLength) + '...' : str
  } catch {
    return '[unserializable input]'
  }
}
