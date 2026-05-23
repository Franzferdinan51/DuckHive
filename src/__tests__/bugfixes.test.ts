/**
 * Tests for Bug Fixes applied to openclaude.
 *
 * Covers:
 * 1. Gemini `store: false` rejection fix
 * 2. Session timeout / 500 error fix (stream idle timeout)
 * 3. Agent loop continuation nudge
 * 4. Web search result count improvements
 */

import { describe, test, expect } from 'bun:test'
import { resolve } from 'path'
import {
  clearRegisteredHooks,
  registerHookCallbacks,
} from '../bootstrap/state.js'
import { getMatchingHooks } from '../utils/hooks.js'
import type { PluginHookMatcher } from '../utils/settings/types.js'

const SRC = resolve(import.meta.dir, '..')
const file = (relative: string) => Bun.file(resolve(SRC, relative))

// ---------------------------------------------------------------------------
// Fix 1: Gemini `store: false` rejection
// ---------------------------------------------------------------------------
describe('Gemini store field fix', () => {
  test('descriptor-backed shim config strips store for Gemini and Mistral routes', async () => {
    const runtimeMetadata = await file('integrations/runtimeMetadata.ts').text()
    const geminiDescriptor = await file('integrations/vendors/gemini.ts').text()
    const mistralDescriptor = await file('integrations/gateways/mistral.ts').text()

    expect(runtimeMetadata).toContain('removeBodyFields')
    expect(geminiDescriptor).toContain("removeBodyFields: ['store']")
    expect(mistralDescriptor).toContain("removeBodyFields: ['store']")
  })

  test('store: false is still set by default and only removed via shim config', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).toMatch(/store:\s*false/)
    expect(content).toContain('shimConfig.removeBodyFields')
    expect(content).toContain('delete body[field]')
  })

  test('openaiShim does not keep a hardcoded descriptor route fallback list', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).not.toContain(
      "['mistral', 'gemini', 'moonshot', 'deepseek', 'zai', 'kimi-code']",
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 2: Session timeout — stream idle timeout
// ---------------------------------------------------------------------------
describe('Session timeout fix', () => {
  test('openaiShim has idle timeout for SSE streams', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    expect(content).toContain('STREAM_IDLE_TIMEOUT_MS')
    expect(content).toContain('readWithTimeout')
    expect(content).toMatch(/readWithTimeout\(\)/)
  })

  test('codexShim has idle timeout for SSE streams', async () => {
    const content = await file('services/api/codexShim.ts').text()

    expect(content).toContain('STREAM_IDLE_TIMEOUT_MS')
    expect(content).toContain('readWithTimeout')
    expect(content).toMatch(/readWithTimeout\(\)/)
  })

  test('idle timeout is set to a reasonable value (>= 60s)', async () => {
    const content = await file('services/api/openaiShim.ts').text()

    // Extract the timeout value (supports numeric separators like 120_000)
    const match = content.match(/STREAM_IDLE_TIMEOUT_MS\s*=\s*([\d_]+)/)
    expect(match).not.toBeNull()
    const timeoutMs = parseInt(match![1].replace(/_/g, ''), 10)
    expect(timeoutMs).toBeGreaterThanOrEqual(60_000)
  })
})

// ---------------------------------------------------------------------------
// Fix 3: Agent loop continuation nudge
// ---------------------------------------------------------------------------
describe('Agent loop continuation nudge', () => {
  test('query.ts has continuation signal detection', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('continuationSignals')
    expect(content).toContain('Continuation nudge triggered')
    expect(content).toContain('continuation_nudge')
  })

  test('continuation signals include tightened patterns', async () => {
    const content = await file('query.ts').text()

    // Should detect tightened patterns requiring explicit action verbs
    expect(content).toMatch(/so now \(i\|let me\|we\)/)
    expect(content).toContain('completionMarkers')
    expect(content).toContain('MAX_CONTINUATION_NUDGES')
    // Verify the nudge counter guard exists
    expect(content).toMatch(/continuationNudgeCount\s*<\s*MAX_CONTINUATION_NUDGES/)
  })

  test('nudge creates a meta user message to continue', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain(
      'Continue with the task. Use the appropriate tools to proceed.',
    )
  })

  test('exploration-only loops are nudged early toward edits', async () => {
    const queryContent = await file('query.ts').text()
    const promptContent = await file('constants/prompts.ts').text()

    expect(queryContent).toContain('EXPLORATION_NUDGE_THRESHOLD = 2')
    expect(queryContent).toContain(
      'You have used only search/read tools for multiple consecutive turns.',
    )
    expect(queryContent).toContain(
      'make the smallest safe Edit/Write now and verify it',
    )
    expect(queryContent).toContain('ACTION REQUIRED: Search/read budget exhausted.')
    expect(queryContent).toContain('HARD_EXPLORATION_LIMIT = 3')
    expect(promptContent).toContain(
      'After 3 consecutive search/read-only turns on the same task',
    )
    expect(promptContent).toContain('SEARCH BUDGETS:')
  })

  test('verification agent guidance is available in the main prompt', async () => {
    const promptContent = await file('constants/prompts.ts').text()
    const builtInAgents = await file('tools/AgentTool/builtInAgents.ts').text()
    const agentToolContent = await file('tools/AgentTool/AgentTool.tsx').text()
    const autoRouteContent = await file('tools/AgentTool/autoRoute.ts').text()
    const agentPromptContent = await file('tools/AgentTool/prompt.ts').text()
    const todoContent = await file('tools/TodoWriteTool/TodoWriteTool.ts').text()
    const taskUpdateContent = await file('tools/TaskUpdateTool/TaskUpdateTool.ts').text()
    const agentConstants = await file('tools/AgentTool/constants.ts').text()

    expect(promptContent).toContain('subagent_type="code-reviewer"')
    expect(promptContent).toContain('subagent_type="editor"')
    expect(builtInAgents).toContain('agents.push(VERIFICATION_AGENT)')
    expect(builtInAgents).toContain('EDITOR_AGENT')
    expect(builtInAgents).toContain('FILE_PICKER_AGENT')
    expect(builtInAgents).toContain('THINKER_AGENT')
    expect(builtInAgents).toContain('PLAN_AGENT')
    expect(builtInAgents).toContain('EXPLORE_AGENT')
    expect(builtInAgents).toContain('CODE_REVIEWER_AGENT')
    expect(agentToolContent).toContain('resolveAutoRoutedAgentType')
    expect(autoRouteContent).toContain('shouldAutoRouteToFilePicker')
    expect(autoRouteContent).toContain('shouldAutoRouteToPlan')
    expect(autoRouteContent).toContain('shouldAutoRouteToExplore')
    expect(autoRouteContent).toContain('shouldAutoRouteToThinker')
    expect(autoRouteContent).toContain('shouldAutoRouteToCodeReviewer')
    expect(autoRouteContent).toContain('shouldAutoRouteToVerification')
    expect(autoRouteContent).toContain('shouldAutoRouteToEditor')
    expect(agentToolContent).toContain('auto_routed_to_builtin_agent')
    expect(agentToolContent).toContain('auto_routed_agent_type')
    expect(autoRouteContent).toContain('EDITOR_AGENT_TYPE')
    expect(autoRouteContent).toContain('FILE_PICKER_AGENT_TYPE')
    expect(autoRouteContent).toContain('THINKER_AGENT_TYPE')
    expect(autoRouteContent).toContain('CODE_REVIEWER_AGENT_TYPE')
    expect(autoRouteContent).toContain('VERIFICATION_AGENT_TYPE')
    expect(autoRouteContent).toContain("const PLAN_AGENT_TYPE = 'Plan'")
    expect(autoRouteContent).toContain("const EXPLORE_AGENT_TYPE = 'Explore'")
    expect(agentPromptContent).toContain('"Explore": use this agent when the task is broad codebase reconnaissance')
    expect(agentPromptContent).toContain('"Plan": use this agent when you need a concrete file-scoped implementation plan')
    expect(agentPromptContent).toContain('"thinker": use this agent when enough context is gathered')
    expect(agentPromptContent).toContain('"editor": use this agent when the target files are known')
    expect(agentConstants).toContain("export const FILE_PICKER_AGENT_TYPE = 'file-picker'")
    expect(agentConstants).toContain("export const EDITOR_AGENT_TYPE = 'editor'")
    expect(agentConstants).toContain("export const THINKER_AGENT_TYPE = 'thinker'")
    expect(agentConstants).toContain('FILE_PICKER_AGENT_TYPE')
    expect(agentConstants).toContain('THINKER_AGENT_TYPE')
    expect(agentConstants).toContain('CODE_REVIEWER_AGENT_TYPE')
    expect(todoContent).toContain('CODE_REVIEWER_AGENT_TYPE')
    expect(todoContent).toContain('missing part of the non-trivial completion workflow')
    expect(taskUpdateContent).toContain('CODE_REVIEWER_AGENT_TYPE')
    expect(taskUpdateContent).toContain('missing part of the non-trivial completion workflow')
  })

  test('query loop enforces read-only subagent handoffs', async () => {
    const queryContent = await file('query.ts').text()
    const autoRouteContent = await file('tools/AgentTool/autoRoute.ts').text()

    expect(queryContent).toContain('buildAutoRouteActionHint')
    expect(queryContent).toContain('Use ${FILE_READ_TOOL_NAME} on the target file if needed, then ${hasEditTool ? FILE_EDIT_TOOL_NAME : FILE_WRITE_TOOL_NAME} to make the change now.')
    expect(queryContent).toContain('Use ${BASH_TOOL_NAME} to run the narrowest verification command that proves the change works now.')
    expect(autoRouteContent).toContain('isKnownTargetImplementationPrompt')
    expect(autoRouteContent).toContain('isReasoningLikePrompt')
    expect(autoRouteContent).toContain('isVerificationLikePrompt')
    expect(queryContent).toContain('You have not completed the task yet. You summarized or declared completion before taking action.')
    expect(queryContent).toContain("transition: { reason: 'premature_completion_nudge' }")
    expect(queryContent).toContain('editedFileAttachmentCount: number')
    expect(queryContent).toContain('hasUsedCodeReviewer: boolean')
    expect(queryContent).toContain('hasUsedVerificationAgent: boolean')
    expect(queryContent).toContain('readOnlySubagentPassCount: number')
    expect(queryContent).toContain('isSearchOrReadOnlyToolBatch')
    expect(queryContent).toContain('isReadOnlySubagentOnlyBatch')
    expect(queryContent).toContain('isActionTakingToolUse')
    expect(queryContent).toContain('Search/read budget exhausted. This tool batch was blocked because you have already spent too many consecutive turns exploring without acting.')
    expect(queryContent).toContain('ACTION REQUIRED: Repeated exploration-only tool calls are now blocked for this task.')
    expect(queryContent).toContain("transition: { reason: 'blocked_exploration_tool_batch' }")
    expect(queryContent).toContain('ACTION REQUIRED: You have already used multiple read-only subagent passes without taking a real action.')
    expect(queryContent).toContain('ACTION REQUIRED: Repeated read-only subagent calls are now blocked for this task.')
    expect(queryContent).toContain("transition: { reason: 'blocked_read_only_subagent_batch' }")
    expect(queryContent).toContain('You have already made a non-trivial code change set in this turn and cannot report completion yet.')
    expect(queryContent).toContain("transition: { reason: 'review_verification_gate' }")
    expect(queryContent).toContain('Continue with the task. Use the appropriate tools to proceed.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="${FILE_PICKER_AGENT_TYPE}" to identify the next file to edit')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="Plan" to produce a concrete file-scoped plan before implementing.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="Explore" to find the relevant files or symbols quickly, then act on its findings immediately.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="${THINKER_AGENT_TYPE}" to reason through the best approach now that enough context is gathered.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="${EDITOR_AGENT_TYPE}" to implement the known-target change now.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="${CODE_REVIEWER_AGENT_TYPE}" to perform the requested review now.')
    expect(queryContent).toContain('Use ${AGENT_TOOL_NAME} with subagent_type="${VERIFICATION_AGENT_TYPE}" to run independent verification now.')
    expect(autoRouteContent).toContain('resolveAutoRoutedAgentType')
    expect(autoRouteContent).toContain('shouldAutoRouteToVerification')
    expect(queryContent).toContain('ACTION REQUIRED: File-picker is a read-only targeting pass.')
    expect(queryContent).toContain('ACTION REQUIRED: Thinker is a read-only reasoning pass.')
    expect(queryContent).toContain('ACTION REQUIRED: Plan is a read-only planning pass.')
    expect(queryContent).toContain('subagent_type="${EDITOR_AGENT_TYPE}"')
    expect(queryContent).toContain('REVIEW HANDOFF: The code-reviewer pass is complete.')
    expect(queryContent).toContain('VERIFICATION HANDOFF: You just received an independent verification report.')
    expect(queryContent).toContain('subagent_type="${FILE_PICKER_AGENT_TYPE}" exactly once')
  })

  test('planner schema includes executable implementation details', async () => {
    const plannerContent = await file('coordinator/planner.ts').text()

    expect(plannerContent).toContain('targetFiles?: string[]')
    expect(plannerContent).toContain('changeIntent?: string')
    expect(plannerContent).toContain('verificationCommand?: string')
    expect(plannerContent).toContain('exitCriteria?: string')
  })
})

// ---------------------------------------------------------------------------
// Fix 4: Web search result count improvements
// ---------------------------------------------------------------------------
describe('Web search result count improvements', () => {
  test('Bing provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/bing.ts',
    ).text()

    expect(content).toMatch(/count.*['"]15['"]/)
  })

  test('Tavily provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/tavily.ts',
    ).text()

    expect(content).toMatch(/max_results:\s*15/)
  })

  test('Exa provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/exa.ts',
    ).text()

    expect(content).toMatch(/numResults:\s*15/)
  })

  test('Firecrawl provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/firecrawl.ts',
    ).text()

    expect(content).toMatch(/limit:\s*15/)
  })

  test('Mojeek provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/mojeek.ts',
    ).text()

    // Mojeek uses 't' param for result count — verify it's set to 10
    expect(content).toMatch(/searchParams\.set\('t',\s*'10'\)/)
  })

  test('You.com provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/you.ts',
    ).text()

    expect(content).toMatch(/num_web_results.*['"]10['"]/)
  })

  test('Jina provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/jina.ts',
    ).text()

    expect(content).toMatch(/count.*['"]10['"]/)
  })

  test('Native Anthropic web search max_uses increased to 15', async () => {
    const content = await file(
      'tools/WebSearchTool/WebSearchTool.ts',
    ).text()

    expect(content).toMatch(/max_uses:\s*15/)
  })

  test('codex web search path guarantees a non-empty result body', async () => {
    const content = await file(
      'tools/WebSearchTool/WebSearchTool.ts',
    ).text()

    expect(content).toContain("results.push('No results found.')")
  })
})

// ---------------------------------------------------------------------------
// Fix 5: MCP tool timeout fix
// ---------------------------------------------------------------------------
describe('MCP tool timeout fix', () => {
  test('default MCP tool timeout is reasonable (not 27 hours)', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Should NOT have the old ~27.8 hour default
    expect(content).not.toContain('100_000_000')
    // Should have a reasonable timeout (5 minutes = 300_000ms)
    expect(content).toMatch(/DEFAULT_MCP_TOOL_TIMEOUT_MS\s*=\s*300_000/)
  })

  test('MCP tools/list has retry logic', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('tools/list failed (attempt')
    expect(content).toContain('Retrying...')
  })

  test('MCP URL elicitation checks abort signal', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('signal.aborted')
    expect(content).toContain('Tool call aborted during URL elicitation')
  })

  test('MCP tool error messages include server and tool name in telemetry', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Telemetry message should include context like "MCP tool [serverName] toolName: error"
    // The human-readable message stays unchanged to avoid breaking error consumers
    expect(content).toContain('MCP tool [${name}] ${tool}:')
  })
})

// ---------------------------------------------------------------------------
// Cross-cutting: verify no regressions
// ---------------------------------------------------------------------------
describe('Regression checks', () => {
  test('duplicate plugin hooks are deduplicated before execution', async () => {
    clearRegisteredHooks()

    const hookA: PluginHookMatcher = {
      pluginId: 'claude-mem@thedotmack',
      pluginName: 'claude-mem',
      pluginRoot: '/plugins/claude-mem-a',
      matcher: 'startup',
      hooks: [
        {
          async: true,
          command: 'node hook.js',
          statusMessage: 'warming cache',
          type: 'command',
        },
      ],
    }
    const hookB: PluginHookMatcher = {
      pluginId: 'claude-mem@thedotmack',
      pluginName: 'claude-mem',
      pluginRoot: '/plugins/claude-mem-a',
      matcher: 'startup',
      hooks: [
        {
          command: 'node hook.js',
          type: 'command',
          statusMessage: 'warming cache',
          async: true,
        },
      ],
    }
    const hookDifferentRoot: PluginHookMatcher = {
      ...hookA,
      pluginRoot: '/plugins/claude-mem-b',
    }

    try {
      registerHookCallbacks({
        SessionStart: [hookA, hookB, hookDifferentRoot],
      })

      const matched = await getMatchingHooks(
        undefined,
        'test-session',
        'SessionStart',
        {
          hook_event_name: 'SessionStart',
          source: 'startup',
        } as never,
      )

      expect(matched).toHaveLength(2)
      expect(matched.map(hook => hook.pluginRoot)).toEqual([
        '/plugins/claude-mem-a',
        '/plugins/claude-mem-b',
      ])
    } finally {
      clearRegisteredHooks()
    }
  })

  test('store field remains opt-out by per-route config rather than unconditional deletion', async () => {
    const openaiShim = await file('services/api/openaiShim.ts').text()
    const runtimeMetadata = await file('integrations/runtimeMetadata.ts').text()

    expect(openaiShim).toMatch(/store:\s*false/)
    expect(openaiShim).toContain('for (const field of shimConfig.removeBodyFields ?? [])')
    expect(runtimeMetadata).toContain('mergeRemoveBodyFields')
  })
})

// ---------------------------------------------------------------------------
// Fix 6: SendMessageTool race condition guard
// ---------------------------------------------------------------------------
describe('SendMessageTool race condition fix', () => {
  test('SendMessageTool has double-check for concurrent resume', async () => {
    const content = await file('tools/SendMessageTool/SendMessageTool.ts').text()

    // Should have a second status check before resuming to prevent race
    expect(content).toContain('was concurrently resumed')
    // The freshTask check should re-read from getAppState
    expect(content).toMatch(/const freshTask = context\.getAppState\(\)\.tasks\[agentId\]/)
  })
})

// ---------------------------------------------------------------------------
// Fix 7: AgentTool dump state cleanup
// ---------------------------------------------------------------------------
describe('AgentTool cleanup fix', () => {
  test('backgrounded agent always cleans up dump state', async () => {
    const content = await file('tools/AgentTool/AgentTool.tsx').text()

    // The backgrounded agent's finally block should clean up regardless
    // of whether the agent crashed or completed normally
    expect(content).toContain('Defensive cleanup: wrap each call so one failure')
    // Verify cleanup is wrapped in try/catch for defensive execution
    expect(content).toMatch(/try\s*\{\s*clearInvokedSkillsForAgent/)
    expect(content).toMatch(/try\s*\{\s*clearDumpState/)
  })
})

// ---------------------------------------------------------------------------
// Fix 8: Context overflow 500 error handling
// ---------------------------------------------------------------------------
describe('Context overflow 500 fix', () => {
  test('errors.ts has handler for context overflow 500 errors', async () => {
    const content = await file('services/api/errors.ts').text()

    expect(content).toContain('500 errors caused by context overflow')
    expect(content).toContain('too many tokens')
    expect(content).toContain('The conversation has grown too large')
  })

  test('query.ts has circuit breaker safety net for oversized context', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('Safety net: when auto-compact')
    expect(content).toContain('circuit breaker has tripped')
    expect(content).toContain('automatic compaction has failed')
  })
})

describe('DuckHive startup identity', () => {
  test('setup Node version guard does not show OpenClaude branding', async () => {
    const content = await file('setup.ts').text()

    expect(content).toContain('DuckHive requires Node.js version 18 or higher')
    expect(content).not.toContain('OpenClaude requires Node.js')
  })
})

// ---------------------------------------------------------------------------
// Fix N: Skill improvement survey was accidentally hard-disabled in REPL
// ---------------------------------------------------------------------------
describe('Skill improvement survey visibility', () => {
  test('REPL does not hard-disable the skill improvement survey', async () => {
    const content = await file('screens/REPL.tsx').text()

    expect(content).toContain('skillImprovementSurvey')
    expect(content).toContain('<SkillImprovementSurvey')
    expect(content).not.toContain(
      '{false && (skillImprovementSurvey as any).suggestion',
    )
  })
})

// ---------------------------------------------------------------------------
// Fix N: Ultraplan prompt override was accidentally hard-disabled
// ---------------------------------------------------------------------------
describe('Ultraplan prompt override visibility', () => {
  test('ultraplan uses the intended ant-only prompt file gate instead of false &&', async () => {
    const content = await file('commands/ultraplan.tsx').text()

    expect(content).toContain("process.env.USER_TYPE === 'ant'")
    expect(content).toContain('process.env.ULTRAPLAN_PROMPT_FILE')
    expect(content).not.toContain(
      'false && process.env.ULTRAPLAN_PROMPT_FILE',
    )
  })
})

// ---------------------------------------------------------------------------
// Fix N: Project-scope MCP servers from .mcp.json not detected for 3P providers (issue #696)
// ---------------------------------------------------------------------------
describe('Project-scope MCP approval — third-party providers (issue #696)', () => {
  test('handleMcpjsonServerApprovals is NOT gated behind usesAnthropicSetup', async () => {
    const content = await file('interactiveHelpers.tsx').text()

    // The call site for handleMcpjsonServerApprovals must not sit inside an
    // `if (usesAnthropicSetup) { ... }` block, or third-party providers will
    // never get the dialog and project-scope .mcp.json servers will be silently
    // dropped from /mcp listings (issue #696).
    const approvalCallIdx = content.indexOf('await handleMcpjsonServerApprovals(root)')
    expect(approvalCallIdx).toBeGreaterThan(-1)

    // Look at the 800 chars BEFORE the call site for any `if (usesAnthropicSetup)`
    // block that would still be open. Pick a window that's definitely inside the
    // showSetupScreens function but not in earlier dialogs.
    const before = content.slice(Math.max(0, approvalCallIdx - 800), approvalCallIdx)
    expect(before).not.toMatch(/if\s*\(\s*usesAnthropicSetup\s*\)\s*{[^}]*$/)
  })

  test('issue #696 is referenced from the comment so future readers can find context', async () => {
    const content = await file('interactiveHelpers.tsx').text()
    expect(content).toContain('#696')
  })
})
