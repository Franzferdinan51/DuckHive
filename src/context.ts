import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  getAdditionalDirectoriesForClaudeMd,
  setCachedClaudeMdContent,
  getTotalCostUSD,
  getActiveGoalId,
} from './bootstrap/state.js'
import { getLocalISODate } from './constants/common.js'
import {
  filterInjectedMemoryFiles,
  getClaudeMds,
  getMemoryFiles,
} from './utils/claudemd.js'
import { getCombinedDuckContext } from './utils/contextLoader.js'
import { getGlobalConfig } from './utils/config.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import { isBareMode, isEnvTruthy } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'

const MAX_STATUS_CHARS = 2000

// System prompt injection for cache breaking (internal-only, ephemeral debugging state)
let systemPromptInjection: string | null = null

// Storage key for goals (must match goal.ts)
const GOALS_STORAGE_KEY = 'duckhive.goals'

/**
 * Build the goal system prompt section when a goal has active autonomous mode.
 * This is called on every getSystemContext refresh so the active goal is
 * always surfaced to the model regardless of which tick/timer supplies the
 * next user turn.
 */
function buildGoalPromptSection(): Record<string, string> | null {
  try {
    const config = getGlobalConfig()
    const goals: Array<{
      id: string
      title: string
      description: string
      status: string
      autonomousMode?: boolean
      currentStepId?: string
      activeAgentRunId?: string
      steps: Array<{
        id: string
        description: string
        status: string
      }>
    }> = (config as Record<string, unknown>)[GOALS_STORAGE_KEY] as typeof goals || []

    const activeGoal = goals.find(
      g => g.autonomousMode === true && (g.status === 'active' || g.status === 'paused'),
    )
    if (!activeGoal) return null

    const currentStep = activeGoal.currentStepId
      ? activeGoal.steps.find(s => s.id === activeGoal.currentStepId)
      : activeGoal.steps.find(s => s.status === 'active') ?? activeGoal.steps[0]

    const currentCost = getTotalCostUSD()
    const budgetExceeded = activeGoal.budgetUSD !== undefined && currentCost >= activeGoal.budgetUSD

    return {
      goalContext: [
        `## Active Autonomous Goal`,
        ``,
        `**Goal**: ${activeGoal.title}`,
        `**Description**: ${activeGoal.description}`,
        `**Status**: ${activeGoal.status}`,
        activeGoal.activeAgentRunId ? `**Assigned Agent**: ${activeGoal.activeAgentRunId}` : '',
        activeGoal.budgetUSD !== undefined ? `**Budget**: $${activeGoal.budgetUSD.toFixed(2)} (Current Session Cost: $${currentCost.toFixed(2)})` : '',
        ``,
        budgetExceeded ? `**!!! BUDGET EXCEEDED !!!**` : '',
        currentStep
          ? `**Current step**: ${currentStep.description} [${currentStep.status}]`
          : `**No steps defined yet** — take the first concrete action toward: "${activeGoal.description}"`,
        ``,
        ...(activeGoal.steps.filter(s => s.status !== 'completed' && s.id !== currentStep?.id).length > 0
          ? [
              `Remaining steps:`,
              ...activeGoal.steps
                .filter(s => s.status !== 'completed' && s.id !== currentStep?.id)
                .map((s, i) => `  ${i + 1}. ${s.description} [${s.status}]`),
              ``,
            ]
          : []),
        `### EXECUTION GUIDELINES`,
        budgetExceeded
          ? `**CRITICAL: YOUR BUDGET HAS BEEN EXCEEDED ($${currentCost.toFixed(2)} / $${activeGoal.budgetUSD?.toFixed(2)}). YOU MUST STOP ALL WORK IMMEDIATELY. Report this to the user and wait for further instructions. DO NOT use any more tools.**`
          : `1. ROLE & ORCHESTRATION: ${
              activeGoal.activeAgentRunId
                ? `Subagent \`${activeGoal.activeAgentRunId}\` is assigned to this goal. If you are the team-lead, you are the COORDINATOR and a CONTRIBUTOR. Work alongside the subagent by tackling parallel steps or handling complex integration. Use 'SendMessage' to divide the work and avoid redundant searching. If YOU are the assigned subagent, you are the primary driver for your current task.`
                : `You are the primary driver for this goal. Work decisively until complete.`
            }`,
        !budgetExceeded ? `2. FOLLOW THE PLAN: You have been provided with a list of steps. Work through them sequentially.` : '',
        !budgetExceeded ? `3. BE DECISIVE: While understanding the code is vital, every turn should move you closer to completing the current step. Action is often the best way to validate findings.` : '',
        !budgetExceeded ? `4. UPDATE STATUS: As soon as a step is complete, use '/goal step complete' to mark it done and move to the next. Show your progress to the user.` : '',
        !budgetExceeded ? `5. REFINE IF NEEDED: If the current plan is too vague, use '/goal step add' to break it down into smaller, actionable sub-tasks.` : '',
        !budgetExceeded ? `Keep working until the ENTIRE goal is met. Don't stop after one step.` : '',
      ].filter(line => line !== '').join('\n'),
    }
  } catch {
    return null
  }
}

export function getSystemPromptInjection(): string | null {
  return systemPromptInjection
}

export function setSystemPromptInjection(value: string | null): void {
  systemPromptInjection = value
  // Clear context caches immediately when injection changes
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
  getRepoMapContext.cache.clear?.()
}

export const getGitStatus = memoize(async (): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') {
    // Avoid cycles in tests
    return null
  }

  const startTime = Date.now()
  logForDiagnosticsNoPII('info', 'git_status_started')

  const isGitStart = Date.now()
  const isGit = await getIsGit()
  logForDiagnosticsNoPII('info', 'git_is_git_check_completed', {
    duration_ms: Date.now() - isGitStart,
    is_git: isGit,
  })

  if (!isGit) {
    logForDiagnosticsNoPII('info', 'git_status_skipped_not_git', {
      duration_ms: Date.now() - startTime,
    })
    return null
  }

  try {
    const gitCmdsStart = Date.now()
    const [branch, mainBranch, status, log, userName] = await Promise.all([
      getBranch(),
      getDefaultBranch(),
      execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
        {
          preserveOutputOnError: false,
        },
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(gitExe(), ['config', 'user.name'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
    ])

    logForDiagnosticsNoPII('info', 'git_commands_completed', {
      duration_ms: Date.now() - gitCmdsStart,
      status_length: status.length,
    })

    // Check if status exceeds character limit
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status

    logForDiagnosticsNoPII('info', 'git_status_completed', {
      duration_ms: Date.now() - startTime,
      truncated: status.length > MAX_STATUS_CHARS,
    })

    return [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
      ...(userName ? [`Git user: ${userName}`] : []),
      `Status:\n${truncatedStatus || '(clean)'}`,
      `Recent commits:\n${log}`,
    ].join('\n\n')
  } catch (error) {
    logForDiagnosticsNoPII('error', 'git_status_failed', {
      duration_ms: Date.now() - startTime,
    })
    logError(error)
    return null
  }
})

export const getRepoMapContext = memoize(
  async (): Promise<string | null> => {
    const runtimeEnabled = isEnvTruthy(process.env.REPO_MAP)
    if (!runtimeEnabled) return null
    if (isBareMode()) return null
    if (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)) return null

    try {
      const startTime = Date.now()
      logForDiagnosticsNoPII('info', 'repo_map_started')
      const { buildRepoMap } = await import('./context/repoMap/index.js')
      const result = await buildRepoMap({ maxTokens: 1024 })
      logForDiagnosticsNoPII('info', 'repo_map_completed', {
        duration_ms: Date.now() - startTime,
        token_count: result.tokenCount,
        file_count: result.fileCount,
        cache_hit: result.cacheHit,
      })
      if (!result.map || result.map.length === 0) return null
      return `This is a structural map of the repository, ranked by importance. Use it to understand the codebase architecture.\n\n${result.map}`
    } catch (err) {
      logForDiagnosticsNoPII('warn', 'repo_map_failed', {
        error: String(err),
      })
      return null
    }
  },
)

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getSystemContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'system_context_started')

    // Skip git status in CCR (unnecessary overhead on resume) or when git instructions are disabled
    const gitStatus =
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
      !shouldIncludeGitInstructions()
        ? null
        : await getGitStatus()

    const repoMap = await getRepoMapContext()

    // Include system prompt injection if set (for cache breaking, internal-only)
    const injection = feature('BREAK_CACHE_COMMAND')
      ? getSystemPromptInjection()
      : null

    logForDiagnosticsNoPII('info', 'system_context_completed', {
      duration_ms: Date.now() - startTime,
      has_git_status: gitStatus !== null,
      has_repo_map: repoMap !== null,
      has_injection: injection !== null,
    })

    return {
      ...(gitStatus && { gitStatus }),
      ...(repoMap && { repoMap }),
      ...(feature('BREAK_CACHE_COMMAND') && injection
        ? {
            cacheBreaker: `[CACHE_BREAKER: ${injection}]`,
          }
        : {}),
      ...(buildGoalPromptSection()),
    }
  },
)

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'user_context_started')

    // CLAUDE_CODE_DISABLE_CLAUDE_MDS: hard off, always.
    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    // --bare means "skip what I didn't ask for", not "ignore what I asked for".
    const shouldDisableClaudeMd =
      isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS) ||
      (isBareMode() && getAdditionalDirectoriesForClaudeMd().length === 0)
    // Await the async I/O (readFile/readdir directory walk) so the event
    // loop yields naturally at the first fs.readFile.
    const claudeMd = shouldDisableClaudeMd
      ? null
      : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))

    // DuckHive DUCK.md hierarchical context (gemini-cli style)
    const duckContext = getCombinedDuckContext()

    // Cache for the auto-mode classifier (yoloClassifier.ts reads this
    // instead of importing claudemd.ts directly, which would create a
    // cycle through permissions/filesystem → permissions → yoloClassifier).
    setCachedClaudeMdContent(claudeMd || null)

    logForDiagnosticsNoPII('info', 'user_context_completed', {
      duration_ms: Date.now() - startTime,
      claudemd_length: claudeMd?.length ?? 0,
      claudemd_disabled: Boolean(shouldDisableClaudeMd),
    })

    return {
      ...(claudeMd && { claudeMd }),
      ...(duckContext && { duckContext }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)
