import type { ToolUseContext } from './Tool.js'
import { routeTask } from './orchestrator/multi-model/multi-model-router.js'
import { spawnTeammate } from './tools/shared/spawnMultiAgent.js'

type SessionsSpawnOptions = {
  label?: string
  model?: string
  agentType?: string
  mode?: string
  runtime?: string
  permissionMode?: import('./utils/permissions/PermissionMode.js').PermissionMode
  task?: string
  context: ToolUseContext
}

type SubagentSystemDeps = {
  routeTask: typeof routeTask
  spawnTeammate: typeof spawnTeammate
}

let subagentSystemTestDeps: Partial<SubagentSystemDeps> | null = null

function getSubagentSystemDeps(): SubagentSystemDeps {
  return {
    routeTask,
    spawnTeammate,
    ...subagentSystemTestDeps,
  }
}

export function setSubagentSystemTestDeps(
  overrides: Partial<SubagentSystemDeps> | null,
): void {
  subagentSystemTestDeps = overrides
}

function inferSpawnComplexity(task: string, agentType?: string): number {
  const complexityHints = [task, agentType].filter(Boolean).join(' ').toLowerCase()
  if (
    /architect|analysis|review|security|audit|refactor|migration|debug|investigate|research/.test(
      complexityHints,
    )
  ) {
    return 7
  }
  if (task.length > 120) return 7
  if (task.length > 50) return 6
  return 5
}

function resolveSpawnModel(task: string, agentType?: string, explicitModel?: string): string {
  if (explicitModel?.trim()) return explicitModel.trim()

  const routingTask = [agentType, task].filter(Boolean).join(' ')
  const route = getSubagentSystemDeps().routeTask({
    task: routingTask,
    complexity: inferSpawnComplexity(task, agentType),
    vision: /\bimage|vision|screenshot|photo\b/i.test(routingTask),
    functionCalling: true,
    preferQuality: true,
  })
  return route.model
}

/**
 * Spawn a subagent teammate for tasks like deep workspace analysis.
 *
 * This wires the legacy sessions_spawn API to the modern team infrastructure
 * (spawnTeammate / InProcessTeammateTask) so that subagents actually run
 * as proper teammates rather than falling back to a stub response.
 */
export async function sessions_spawn(
  options: SessionsSpawnOptions,
): Promise<string> {
  const task = options.task?.trim()
  if (!task) {
    return '## Deep Analysis\nNo subagent task was provided.'
  }

  // Derive a teammate name from the label, sanitizing for use as agentId
  const label = options.label ?? 'subagent'
  const teammateName = label.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) || 'subagent'
  const model = resolveSpawnModel(task, options.agentType, options.model)

  try {
    const result = await getSubagentSystemDeps().spawnTeammate(
      {
        name: teammateName,
        prompt: task,
        team_name: 'duckhive-sessions',
        plan_mode_required: options.mode === 'plan' || options.mode === 'autonomous-goal',
        model,
        agent_type: options.agentType,
        ...(options.permissionMode && {
          permissionMode: options.permissionMode,
        }),
      },
      options.context,
    )

    // The teammate is now running asynchronously. Return a status that
    // informs the leader agent the teammate was spawned successfully.
    return [
      `## Deep Analysis`,
      `Subagent teammate **${result.data.name}** spawned successfully.`,
      `Agent ID: \`${result.data.agent_id}\``,
      `Team: ${result.data.team_name ?? 'duckhive-sessions'}`,
      `Model: ${result.data.model ?? 'default'}`,
      `Mode: ${options.permissionMode === 'bypassPermissions' ? 'YOLO (autonomous)' : options.permissionMode ?? 'default'}`,
      '',
      `The teammate is processing the requested task. Results will appear in the team conversation.`,
    ].join('\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return [
      `## Deep Analysis`,
      `Failed to spawn subagent teammate: ${message}`,
      `Requested task: ${task}`,
    ].join('\n')
  }
}
