// @ts-nocheck
/**
 * Auto-Orchestration — runs automatically on every user message before the main LLM query.
 *
 * Pipeline: analyze → route → council (if needed) → checkpoint (if needed) → parallel agents (if needed)
 * Returns orchestration context that gets injected into the system prompt so the LLM
 * knows what the orchestrator decided (model, complexity, council verdict, etc.)
 */

import { analyzeTask, type TaskAnalysis } from './task-complexity.js'
import { selectModel, type RouteResult } from './model-router.js'
import { getHiveBridge } from '../../services/hive-bridge/index.js'
import { logForDebugging } from '../../utils/debug.js'

export interface AutoOrchestrationResult {
  /** Whether auto-orchestration ran (false if disabled or message too simple) */
  orchestrated: boolean
  /** Task complexity score 1-10 */
  complexity: number
  /** Task category */
  category: TaskAnalysis['category']
  /** Suggested model route */
  routing: RouteResult
  /** Whether council was triggered and its verdict */
  councilTriggered: boolean
  councilVerdict?: string
  /** Whether a checkpoint was saved */
  checkpointSaved: boolean
  checkpointId?: string
  /** Orchestration context to inject into system prompt */
  systemContext: string
  /** Human-readable summary for status display */
  summary: string
}

const ORCHESTRATION_THRESHOLD = 2 // Orchestrate tasks with complexity >= 2 (council, checkpoint, model routing)

/**
 * Run auto-orchestration on an incoming user message.
 * Called from the REPL and QueryEngine pipelines BEFORE the main LLM query.
 *
 * This is the single entry point that replaces the old fire-and-forget
 * checkAndFireCouncil() — it does the full pipeline:
 *   1. Analyze task complexity
 *   2. Select best model route
 *   3. Fire council deliberation if needed (complex/critical tasks)
 *   4. Save checkpoint if needed (long-running tasks)
 *   5. Return orchestration context for system prompt injection
 */
export async function autoOrchestrate(
  message: string,
  history: Array<{ role: string; content: string }> = [],
  tools: string[] = [],
  options: {
    enableCouncil?: boolean
    enableCheckpoint?: boolean
    checkpointDir?: string
  } = {},
): Promise<AutoOrchestrationResult> {
  const {
    enableCouncil = true,
    enableCheckpoint = true,
  } = options

  // Step 1: Analyze task complexity
  const analysis = analyzeTask(message, {
    message,
    history,
    tools,
    timestamp: Date.now(),
  })

  // Step 2: Route to best model
  const routing = selectModel(message, analysis.complexity)

  // Below threshold — skip orchestration, return minimal context
  if (analysis.complexity < ORCHESTRATION_THRESHOLD) {
    return {
      orchestrated: false,
      complexity: analysis.complexity,
      category: analysis.category,
      routing,
      councilTriggered: false,
      checkpointSaved: false,
      systemContext: '',
      summary: `Simple task (complexity ${analysis.complexity}) — no orchestration needed`,
    }
  }

  // Step 3: Fire council deliberation if needed
  let councilTriggered = false
  let councilVerdict: string | undefined
  if (enableCouncil && analysis.needsCouncil) {
    const bridge = getHiveBridge()
    const shouldConsult = bridge.shouldConsultCouncil(analysis.complexity)
    logForDebugging(`[auto-orchestrate] needsCouncil=true (reasons: ${analysis.councilReasons.join(', ')}), complexity=${analysis.complexity}, councilThreshold=${bridge.getOptions().councilThreshold}, autoConsult=${bridge.getOptions().autoConsultCouncil}, shouldConsult=${shouldConsult}`)
    if (shouldConsult) {
      try {
        const result = await bridge.startDeliberation(message, 'balanced')
        logForDebugging(`[auto-orchestrate] deliberation result: success=${result.success}, verdict=${result.verdict ?? 'none'}`)
        councilTriggered = result.success
        if (result.success && result.verdict) {
          councilVerdict = result.verdict
        }
      } catch (err) {
        logForDebugging(`[auto-orchestrate] deliberation failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // Step 4: Save checkpoint if needed
  let checkpointSaved = false
  let checkpointId: string | undefined
  if (enableCheckpoint && analysis.needsCheckpoint) {
    try {
      const { shadow } = await import('../../utils/shadow.js')
      checkpointId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await shadow.checkpoint(`Auto-orchestration checkpoint: ${message.slice(0, 80)}`)
      checkpointSaved = true
    } catch (err) {
      // Checkpoint failure is non-fatal but log for debugging
      logForDebugging(`Auto-orchestration checkpoint failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Step 5: Build orchestration context for system prompt injection
  const systemContext = buildSystemContext(analysis, routing, councilTriggered, councilVerdict, checkpointSaved, checkpointId)

  const summary = buildSummary(analysis, routing, councilTriggered, checkpointSaved)

  return {
    orchestrated: true,
    complexity: analysis.complexity,
    category: analysis.category,
    routing,
    councilTriggered,
    councilVerdict,
    checkpointSaved,
    checkpointId,
    systemContext,
    summary,
  }
}

/**
 * Build the orchestration context string to inject into the system prompt.
 * This tells the LLM what the orchestrator decided so it can act accordingly.
 */
function buildSystemContext(
  analysis: TaskAnalysis,
  routing: RouteResult,
  councilTriggered: boolean,
  councilVerdict?: string,
  checkpointSaved?: boolean,
  checkpointId?: string,
): string {
  const parts: string[] = []

  parts.push(`<orchestration>`)
  parts.push(`  <complexity score="${analysis.complexity}" category="${analysis.category}" />`)
  parts.push(`  <routing model="${routing.model}" provider="${routing.provider}" reason="${routing.reason}" />`)

  if (analysis.factors.length > 0) {
    parts.push(`  <factors>`)
    for (const factor of analysis.factors) {
      parts.push(`    <factor>${factor}</factor>`)
    }
    parts.push(`  </factors>`)
  }

  if (councilTriggered) {
    parts.push(`  <council triggered="true" verdict="${councilVerdict ?? 'pending'}" />`)
  }

  if (checkpointSaved) {
    parts.push(`  <checkpoint saved="true" id="${checkpointId}" />`)
  }

  if (analysis.estimatedSteps > 1) {
    parts.push(`  <estimatedSteps>${analysis.estimatedSteps}</estimatedSteps>`)
  }

  parts.push(`</orchestration>`)

  return parts.join('\n')
}

/**
 * Build a human-readable summary for status display.
 */
function buildSummary(
  analysis: TaskAnalysis,
  routing: RouteResult,
  councilTriggered: boolean,
  checkpointSaved: boolean,
): string {
  const parts = [`Complexity ${analysis.complexity}/10 (${analysis.category})`]

  if (analysis.complexity >= ORCHESTRATION_THRESHOLD) {
    parts.push(`→ ${routing.model}`)
  }

  if (councilTriggered) {
    parts.push('council deliberating')
  }

  if (checkpointSaved) {
    parts.push('checkpoint saved')
  }

  return parts.join(' | ')
}