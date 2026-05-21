/**
 * DuckHive /goal Command - Persisted Workflow Goals
 * Inspired by Codex /goal (r0.128.0)
 *
 * Features:
 * - /goal create <description> - Create a new persisted goal
 * - /goal list - List all goals with status
 * - /goal status [id] - Show detailed status of a goal
 * - /goal pause [id] - Pause a running goal
 * - /goal resume [id] - Resume a paused goal
 * - /goal complete [id] - Mark a goal as completed
 * - /goal fail [id] - Mark a goal as failed
 * - /goal clear [id] - Remove a goal
 * - /goal attach [id] - Attach current conversation to a goal
 */

import { bold, italic } from '../../components/styles.js'
import { getSessionId, setActiveGoalId, getActiveGoalId } from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { sessions_spawn } from '../../subagentSystem.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { getSystemContext } from '../../context.js'
import type { ToolUseContext } from '../../Tool.js'
import { createSignal } from '../../utils/signal.js'
import { TaskPlanner } from '../../coordinator/planner.js'
import { writePlan } from '../../utils/plans.js'
import { writeToMailbox } from '../../utils/teammateMailbox.js'

// Goal states
export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed'

export interface GoalStep {
  id: string
  description: string
  status: GoalStatus
  createdAt: string
  completedAt?: string
  result?: string
  error?: string
}

export interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  steps: GoalStep[]
  currentStepId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  // Autonomous mode: when true, /goal pursue spawns a background subagent
  // that continuously works the goal without requiring constant user input.
  // Inspired by Codex /goal autonomous agent mode.
  autonomousMode?: boolean
  // Active agent run tracking for autonomous mode
  activeAgentRunId?: string
  activeAgentName?: string
  lastActivityAt?: string
}

export type GoalUpdateType =
  | 'created'
  | 'paused'
  | 'resumed'
  | 'completed'
  | 'failed'
  | 'step_added'
  | 'step_completed'
  | 'autonomous_started'
  | 'autonomous_failed'
  | 'autonomous_stopped'
  | 'cleared'
  | 'attached'

export type GoalUpdateEvent = {
  type: GoalUpdateType
  goal?: Goal
  goals: Goal[]
}

export const goalUpdates = createSignal<[GoalUpdateEvent]>()

// Storage key for goals
export const GOALS_STORAGE_KEY = 'duckhive.goals'

function generateId(): string {
  return `goal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

export function getGoals(): Goal[] {
  try {
    const config = getGlobalConfig()
    return (config as Record<string, unknown>)[GOALS_STORAGE_KEY] as Goal[] || []
  } catch {
    return []
  }
}

function getCurrentSessionId(): string | undefined {
  try {
    return getSessionId()
  } catch {
    return undefined
  }
}

function findGoalByReference(
  goals: Goal[],
  goalRef: string,
): { goal?: Goal; error?: string } {
  const exactMatch = goals.find((goal) => goal.id === goalRef)
  if (exactMatch) {
    return { goal: exactMatch }
  }

  const partialMatches = goals.filter((goal) => goal.id.includes(goalRef))
  if (partialMatches.length === 0) {
    return { error: `Goal not found: ${goalRef}` }
  }

  if (partialMatches.length > 1) {
    return {
      error:
        `Goal reference is ambiguous: ${goalRef}\n` +
        `Matches: ${partialMatches.map((goal) => goal.id).join(', ')}`,
    }
  }

  return { goal: partialMatches[0] }
}

function getSingleActiveGoal(goals: Goal[]): { goal?: Goal; error?: string } {
  return getSingleGoalByStatus(goals, 'active', {
    missing:
      'No active goal found. Create a goal first or specify a goal ID explicitly.',
    ambiguous:
      'Multiple active goals found. Specify a goal ID explicitly with `/goal step add <goal-id> <description>`.',
  })
}

function getCurrentSessionGoal(
  goals: Goal[],
  statuses?: GoalStatus[],
): { goal?: Goal; error?: string } {
  const sessionId = getCurrentSessionId()
  if (!sessionId) {
    return {}
  }

  const matches = goals.filter((goal) => {
    if (goal.sessionId !== sessionId) {
      return false
    }
    if (!statuses || statuses.length === 0) {
      return true
    }
    return statuses.includes(goal.status)
  })

  if (matches.length === 0) {
    return {}
  }

  if (matches.length > 1) {
    return {
      error:
        'Multiple goals are attached to this session. Specify a goal ID explicitly.',
    }
  }

  return { goal: matches[0] }
}

function getSingleGoalByStatus(
  goals: Goal[],
  status: GoalStatus,
  messages: { missing: string; ambiguous: string },
): { goal?: Goal; error?: string } {
  const matchingGoals = goals.filter((goal) => goal.status === status)
  if (matchingGoals.length === 0) {
    return {
      error: messages.missing,
    }
  }

  if (matchingGoals.length > 1) {
    return {
      error: messages.ambiguous,
    }
  }

  return { goal: matchingGoals[0] }
}

function getSingleGoalByStatuses(
  goals: Goal[],
  statuses: GoalStatus[],
  messages: { missing: string; ambiguous: string },
): { goal?: Goal; error?: string } {
  const matchingGoals = goals.filter((goal) => statuses.includes(goal.status))
  if (matchingGoals.length === 0) {
    return { error: messages.missing }
  }

  if (matchingGoals.length > 1) {
    return { error: messages.ambiguous }
  }

  return { goal: matchingGoals[0] }
}

function resolveGoalTarget(
  goals: Goal[],
  goalRef?: string,
  statuses: GoalStatus[] = ['active'],
): { goal?: Goal; error?: string } {
  if (goalRef?.trim()) {
    return findGoalByReference(goals, goalRef)
  }

  const currentSessionGoal = getCurrentSessionGoal(goals, statuses)
  if (currentSessionGoal.goal || currentSessionGoal.error) {
    return currentSessionGoal
  }

  if (statuses.length === 1 && statuses[0] === 'active') {
    return getSingleActiveGoal(goals)
  }

  return getSingleGoalByStatuses(goals, statuses, {
    missing:
      'No matching goal found. Create a goal first or specify a goal ID explicitly.',
    ambiguous: 'Multiple matching goals found. Specify a goal ID explicitly.',
  })
}

function attachCurrentSessionToGoal(goals: Goal[], targetGoal: Goal): void {
  const sessionId = getCurrentSessionId()
  if (!sessionId) {
    return
  }

  for (const goal of goals) {
    if (
      goal !== targetGoal &&
      goal.sessionId === sessionId &&
      (goal.status === 'active' || goal.status === 'paused')
    ) {
      goal.sessionId = undefined
    }
  }

  targetGoal.sessionId = sessionId
}

function getCurrentStep(goal: Goal): GoalStep | undefined {
  if (!goal.currentStepId) return undefined
  return goal.steps.find(step => step.id === goal.currentStepId)
}

function formatGoalStatusLabel(status: GoalStatus): string {
  const labels: Record<GoalStatus, string> = {
    active: '[active]',
    paused: '[paused]',
    completed: '[done]',
    failed: '[failed]',
  }
  return labels[status]
}

function formatStepStatusLabel(status: GoalStatus): string {
  const labels: Record<GoalStatus, string> = {
    active: 'active',
    paused: '||',
    completed: 'x',
    failed: '!',
  }
  return labels[status]
}

function cloneGoal(goal: Goal): Goal {
  return {
    ...goal,
    steps: goal.steps.map(step => ({ ...step })),
    metadata: goal.metadata ? { ...goal.metadata } : undefined,
  }
}

/**
 * Decompose a goal description into multiple actionable steps using TaskPlanner.
 * Populates the goal.steps array, sets the initial currentStepId, and writes
 * the plan to the built-in session plan file.
 */
async function planGoal(goal: Goal): Promise<void> {
  const planner = new TaskPlanner({ maxSteps: 30 })
  const plan = await planner.createPlan(goal.description)

  if (plan.steps.length > 0) {
    goal.steps = plan.steps.map((s, index) => ({
      id: `step_${Date.now()}_${index}`,
      description: s.description,
      status: index === 0 ? 'active' : 'paused',
      createdAt: new Date().toISOString(),
    }))
    goal.currentStepId = goal.steps[0].id
  } else {
    // Fallback if planner returned nothing
    const step: GoalStep = {
      id: `step_${Date.now()}`,
      description: goal.description,
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    goal.steps = [step]
    goal.currentStepId = step.id
  }

  // Sync with built-in planning infrastructure
  const planContent = [
    `# Goal: ${goal.title}`,
    ``,
    `> ${goal.description}`,
    ``,
    `## Steps`,
    ...goal.steps.map(
      (s, i) => `${i + 1}. [${s.status === 'completed' ? 'x' : ' '}] ${s.description}`,
    ),
    ``,
    `*Generated via DuckHive Autonomous Planning*`,
  ].join('\n')

  try {
    await writePlan(planContent)
  } catch (e) {
    // Ignore if plan file cannot be written
  }
}

async function saveGoals(
  goals: Goal[],
  event?: { type: GoalUpdateType; goal?: Goal },
): Promise<void> {
  saveGlobalConfig(config => ({
    ...config,
    [GOALS_STORAGE_KEY]: goals,
  }))
  if (event) {
    goalUpdates.emit({
      type: event.type,
      goal: event.goal ? cloneGoal(event.goal) : undefined,
      goals: goals.map(cloneGoal),
    })

    // Trigger global state signal if it's the active goal or just became autonomous
    if (
      event.goal?.id === getActiveGoalId() ||
      event.type === 'autonomous_started'
    ) {
      setActiveGoalId(event.goal?.id ?? null)
    }
  }
}

function formatGoal(goal: Goal, detailed = false): string {
  const completedSteps = goal.steps.filter(s => s.status === 'completed').length
  const totalSteps = goal.steps.length
  const percent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

  // Build a precise ASCII progress bar
  const barWidth = 30
  const filledWidth = Math.round((percent / 100) * barWidth)
  const emptyWidth = barWidth - filledWidth
  const progressBar = `|${'#'.repeat(filledWidth)}${'.'.repeat(emptyWidth)}| ${percent}%`

  let output = `\n${formatGoalStatusLabel(goal.status)} **${bold(goal.title)}** \`${goal.id}\`\n`
  output += `   Progress: ${progressBar}\n`
  output += `   Status:   ${goal.status.toUpperCase()}\n`
  output += `   Created:  ${new Date(goal.createdAt).toLocaleString()}\n`

  if (goal.status === 'paused' && goal.currentStepId) {
    output += `   Waiting at: ${goal.currentStepId}\n`
  }

  if (goal.sessionId) {
    output += `   Attached Session: ${goal.sessionId}\n`
  }

  if (detailed) {
    output += `\n   ${italic(goal.description)}\n`
    if (goal.steps.length > 0) {
      output += `\n   ${bold('Milestones:')}\n`
      for (const step of goal.steps) {
        const isCurrent = step.id === goal.currentStepId
        const prefix = isCurrent ? '> ' : '  '
        const label = `[${step.id}]`
        const status = formatStepStatusLabel(step.status)
        const desc = isCurrent ? bold(step.description) : step.description
        output += `${prefix}${label} (${status}) ${desc}\n`
      }
    }
  }

  return output
}

async function stopActiveAutonomousGoal(
  context?: ToolUseContext,
): Promise<string> {
  const goals = getGoals()
  const active = goals.find(
    g => g.autonomousMode === true && g.status === 'active',
  )
  if (!active) {
    // No active autonomous goal — fall back to pausing the current session goal
    // or the single active goal (same behavior as the old /goal stop)
    return pauseGoal([])
  }
  return stopAutonomousMode([active.id], context)
}

async function createGoalAndStartAutonomous(
  args: string[],
  context?: ToolUseContext,
): Promise<string> {
  if (args.length === 0) {
    return `Usage: /goal "<task description>"

Starts autonomous goal mode immediately. The agent works toward the goal
across turns until you run /goal stop.

Examples:
  /goal "Fix the login bug"
  /goal Write tests for auth module
  /goal stop  (to cancel)
  /goal status  (to check progress)`
  }

  const { goalId, message } = await createGoal(args)
  if (!goalId) return message

  const goals = getGoals()
  const goal = goals.find(g => g.id === goalId)
  if (!goal) return message

  setActiveGoalId(goal.id)
  // Enable YOLO mode for the current session to ensure the goal is truly autonomous
  // and matches Codex /goal behavior.
  try {
    const { setSessionBypassPermissionsMode } = await import('../../bootstrap/state.js')
    setSessionBypassPermissionsMode(true)
  } catch (e) {
    // Ignore errors if state.js is not available or doesn't have the setter
  }
  getSystemContext.cache.clear?.()

  goal.autonomousMode = true
  goal.status = 'active'
  goal.updatedAt = new Date().toISOString()
  goal.lastActivityAt = new Date().toISOString()

  if (goal.steps.length === 0) {
    await planGoal(goal)
  }

  const step = getCurrentStep(goal)
  const stepInfo = step ? `\nCurrent step: ${step.description}` : ''

  await saveGoals(goals, { type: 'autonomous_started', goal })

  let spawnInfo = ''
  if (context) {
    const spawnResult = await sessions_spawn({
      label: `goal-${goal.id}`,
      agentType: 'general-purpose',
      mode: 'autonomous-goal',
      permissionMode: 'bypassPermissions',
      task: buildAutonomousGoalTask(goal, step),
      context,
    })
    const agentRunId = extractSpawnedAgentRunId(spawnResult)
    const agentName = extractSpawnedAgentName(spawnResult)
    if (agentRunId) {
      goal.activeAgentRunId = agentRunId
      goal.activeAgentName = agentName
      spawnInfo = `\nBackground teammate started: ${agentRunId} (${agentName || 'unknown name'})`
    } else if (spawnResult.includes('Failed to spawn subagent teammate')) {
      goal.autonomousMode = false
      goal.activeAgentRunId = undefined
      goal.activeAgentName = undefined
      await saveGoals(goals, { type: 'autonomous_failed', goal })
      return `Failed to start autonomous goal mode.\n\n${spawnResult}`
    } else if (spawnResult.trim()) {
      spawnInfo = `\nSpawn result: ${spawnResult}`
    }
  } else {
    // Trigger first autonomous tick for the 1s scheduler if no REPL context
    // is available for spawning a background teammate.
    enqueuePendingNotification({
      value: `<goal_tick>Autonomous goal started. Work toward the active goal. Report your progress after each step. Keep working until the goal is met. Check system prompt for goal context.</goal_tick>`,
      mode: 'prompt',
      priority: 'next',
      isMeta: true,
    })
    spawnInfo = '\nCron-tick loop active — the 1s scheduler drives goal work each turn.'
  }

  return `Autonomous goal started.\n\n${formatGoal(goal, true)}${stepInfo}${spawnInfo}\n\nThe agent will work toward this goal continuously. Run /goal stop to cancel.`
}

async function createGoal(args: string[]): Promise<{ goalId: string; message: string }> {
  if (args.length === 0) {
    return {
      goalId: '',
      message: `Usage: /goal create <description>\nExample: /goal create Build user authentication system`,
    }
  }

  const description = args.join(' ')
  const id = generateId()
  const now = new Date().toISOString()

  const goal: Goal = {
    id,
    title: description.substring(0, 60) + (description.length > 60 ? '...' : ''),
    description,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    steps: [],
    currentStepId: undefined,
  }

  const goals = getGoals()
  goals.unshift(goal)
  attachCurrentSessionToGoal(goals, goal)
  await saveGoals(goals, { type: 'created', goal })

  return {
    goalId: goal.id,
    message: `Goal created successfully!\n\n${formatGoal(goal, true)}`,
  }
}

async function listGoals(args: string[]): Promise<string> {
  const goals = getGoals()
  const filter = args[0]?.toLowerCase()
  const showAll = filter === 'all'
  const validFilters = new Set(['all', 'active', 'paused', 'completed', 'failed'])

  if (filter && !validFilters.has(filter)) {
    return 'Unknown goal filter. Use one of: all, active, paused, completed, failed.'
  }

  let filtered = goals
  if (filter === 'active') {
    filtered = goals.filter((g) => g.status === 'active')
  } else if (filter === 'completed') {
    filtered = goals.filter((g) => g.status === 'completed')
  } else if (filter === 'paused') {
    filtered = goals.filter((g) => g.status === 'paused')
  } else if (filter === 'failed') {
    filtered = goals.filter((g) => g.status === 'failed')
  }

  if (filtered.length === 0) {
    return 'No goals found.'
  }

  const visibleGoals = showAll ? filtered : filtered.slice(0, 10)
  let output = `${bold('DuckHive Goals')}\n`
  if (filter && filter !== 'all') {
    output += `Showing ${visibleGoals.length} of ${filtered.length} ${filter} goals (${goals.length} total goals)\n\n`
  } else {
    output += `Showing ${visibleGoals.length} of ${goals.length} total goals\n\n`
  }

  for (const goal of visibleGoals) {
    output += formatGoal(goal) + '\n'
  }

  if (!showAll && filtered.length > 10) {
    output += `\n... and ${filtered.length - 10} more. Use /goal list all to see all.`
  }

  return output
}

async function goalStatus(args: string[]): Promise<string> {
  const goals = getGoals()

  if (args.length === 0) {
    const currentSessionGoal = getCurrentSessionGoal(goals, [
      'active',
      'paused',
    ])
    if (currentSessionGoal.goal) {
      return formatGoal(currentSessionGoal.goal, true)
    }
    if (currentSessionGoal.error) {
      return currentSessionGoal.error
    }

    const activeGoal = getSingleActiveGoal(goals)
    if (activeGoal.goal) {
      return formatGoal(activeGoal.goal, true)
    }

    const active = goals.filter((g) => g.status === 'active')
    const paused = goals.filter((g) => g.status === 'paused')

    let output = `${bold('Goal Status Summary')}\n\n`
    output += `Active: ${active.length} | Paused: ${paused.length} | Total: ${goals.length}\n\n`

    if (active.length > 0) {
      output += `${bold('Active Goals:')}\n`
      for (const goal of active.slice(0, 5)) {
        output += formatGoal(goal) + '\n'
      }
    }

    return output
  }

  const goalId = args[0]
  const { goal, error } = findGoalByReference(goals, goalId)

  if (!goal) {
    return error ?? `Goal not found: ${goalId}`
  }

  return formatGoal(goal, true)
}

async function pauseGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], ['active'])

  if (!goal) {
    return error ?? `Usage: /goal pause [goal-id]\nTip: Use /goal list to find goal IDs`
  }
  if (goal.status !== 'active') return `Goal is not active (current status: ${goal.status})`

  goal.status = 'paused'
  const currentStep = getCurrentStep(goal)
  if (currentStep?.status === 'active') {
    currentStep.status = 'paused'
  }
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'paused', goal })

  return `Goal paused.\n\n${formatGoal(goal)}`
}

async function resumeGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], ['paused'])

  if (!goal) {
    return error ?? `Usage: /goal resume [goal-id]\nTip: Use /goal list paused to find paused goals`
  }
  if (goal.status !== 'paused') return `Goal is not paused (current status: ${goal.status})`

  goal.status = 'active'
  attachCurrentSessionToGoal(goals, goal)
  const currentStep = getCurrentStep(goal)
  if (currentStep?.status === 'paused') {
    currentStep.status = 'active'
  }
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'resumed', goal })

  return `Goal resumed!\n\n${formatGoal(goal)}`
}

async function completeGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], [
    'active',
    'paused',
  ])

  if (!goal) return error ?? 'Usage: /goal complete [goal-id]'

  goal.status = 'completed'
  const currentStep = getCurrentStep(goal)
  if (currentStep && currentStep.status !== 'completed') {
    currentStep.status = 'completed'
    currentStep.completedAt = new Date().toISOString()
  }
  goal.currentStepId = undefined
  goal.completedAt = new Date().toISOString()
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'completed', goal })

  return `Goal completed.\n\n${formatGoal(goal)}`
}

async function failGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], [
    'active',
    'paused',
  ])

  if (!goal) return error ?? 'Usage: /goal fail [goal-id]'
  if (goal.status !== 'active' && goal.status !== 'paused') {
    return `Goal is not active or paused (current status: ${goal.status})`
  }

  goal.status = 'failed'
  const currentStep = getCurrentStep(goal)
  if (currentStep && currentStep.status !== 'completed') {
    currentStep.status = 'failed'
    currentStep.completedAt = new Date().toISOString()
  }
  goal.currentStepId = undefined
  goal.completedAt = new Date().toISOString()
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'failed', goal })

  return `Goal marked failed.\n\n${formatGoal(goal)}`
}

async function addStep(args: string[], goalId?: string): Promise<string> {
  if (args.length === 0) {
    return `Usage: /goal step add <goal-id> <step-description>\n   or: /goal step add <step-description> (uses active goal)`
  }

  const goals = getGoals()
  let goal: Goal | undefined
  let stepDesc = ''

  if (goalId) {
    const resolved = findGoalByReference(goals, goalId)
    if (!resolved.goal) {
      return resolved.error ?? `Goal not found: ${goalId}`
    }
    goal = resolved.goal
    stepDesc = args.join(' ')
  } else {
    const firstArg = args[0]
    const resolvedById = firstArg ? findGoalByReference(goals, firstArg) : {}
    if (resolvedById.goal) {
      goal = resolvedById.goal
      stepDesc = args.slice(1).join(' ')
    } else if (
      firstArg &&
      (firstArg.startsWith('goal_') || resolvedById.error?.startsWith('Goal reference is ambiguous:'))
    ) {
      return resolvedById.error ?? `Goal not found: ${firstArg}`
    } else {
      const currentSessionGoal = getCurrentSessionGoal(goals, ['active'])
      if (currentSessionGoal.goal) {
        goal = currentSessionGoal.goal
        stepDesc = args.join(' ')
      } else if (currentSessionGoal.error) {
        return currentSessionGoal.error
      } else {
        const activeGoal = getSingleActiveGoal(goals)
        if (!activeGoal.goal) {
          return activeGoal.error ?? 'No active goal found.'
        }
        goal = activeGoal.goal
        stepDesc = args.join(' ')
      }
    }
  }

  if (!stepDesc.trim()) {
    return `Usage: /goal step add <goal-id> <step-description>\n   or: /goal step add <step-description> (uses active goal)`
  }

  if (goal.status !== 'active') {
    return `Cannot add a step to a ${goal.status} goal. Resume it first or target an active goal instead.`
  }

  const previousCurrentStep = getCurrentStep(goal)
  if (previousCurrentStep?.status === 'active') {
    previousCurrentStep.status = 'completed'
    previousCurrentStep.completedAt = new Date().toISOString()
  }

  const step: GoalStep = {
    id: `step_${Date.now()}`,
    description: stepDesc,
    status: 'active',
    createdAt: new Date().toISOString(),
  }

  goal.steps.push(step)
  goal.currentStepId = step.id
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'step_added', goal })

  return `Step added to goal.\n\n${formatGoal(goal, true)}`
}

async function completeStep(
  args: string[],
  context?: ToolUseContext,
): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], ['active'])
  if (!goal) {
    return error ?? 'No active goal found.'
  }

  const currentStep = getCurrentStep(goal)
  if (!currentStep) {
    return 'No current step to complete.'
  }

  currentStep.status = 'completed'
  currentStep.completedAt = new Date().toISOString()
  goal.updatedAt = new Date().toISOString()

  // Find next sequential step after current
  const currentIdx = goal.steps.findIndex(s => s.id === currentStep.id)
  const nextStep = currentIdx >= 0 ? goal.steps[currentIdx + 1] : undefined
  goal.currentStepId = nextStep?.id

  await saveGoals(goals, { type: 'step_completed', goal })

  // If goal is in autonomous mode and there's a next step, re-enqueue
  // a goal_tick to keep the agent working (Codex-style autonomous loop).
  if (goal.autonomousMode && nextStep) {
    getSystemContext.cache.clear?.()
    const tickContent = `<goal_tick>Step completed. Report what you did, then continue with the next step: ${nextStep.description}. Read the relevant files first, then make targeted changes.</goal_tick>`

    if (context?.agentId && goal.activeAgentName) {
      // If called from a subagent, wake it up via its mailbox to keep the loop local to that agent
      await writeToMailbox(goal.activeAgentName, {
        from: 'team-lead',
        text: tickContent,
        timestamp: new Date().toISOString(),
        summary: `Next step: ${nextStep.description}`,
      })
    } else {
      // Fallback to global queue (e.g. for lead-driven cron loop)
      enqueuePendingNotification({
        value: tickContent,
        mode: 'prompt',
        priority: 'next',
        isMeta: true,
        agentId: context?.agentId,
      })
    }
  }

  return `Step completed: ${currentStep.description}${nextStep ? `\nNext step: ${nextStep.description}` : '\nAll steps completed!'}`
}

function buildAutonomousGoalTask(goal: Goal, currentStep: GoalStep | undefined): string {
  const stepGuidance = currentStep
    ? `Current step: ${currentStep.description}`
    : 'First step: identify the most concrete action that advances the goal and take it now.'

  return [
    `Pursue DuckHive goal ${goal.id}: ${goal.title}`,
    '',
    `Goal: ${goal.description}`,
    stepGuidance,
    '',
    `Your job is to make concrete progress toward this goal. You must balance deep understanding with decisive action. Do not guess, but do not hesitate.`,
    '',
    `=== WORKFLOW: READ ONCE, PLAN ONCE, ACT ALWAYS ===`,
    `1. PLAN & REFINE: Review the current steps. If they are too broad or missing details, use '/goal step add' to decompose them into smaller, actionable tasks.`,
    `2. TARGETED RESEARCH: Read only the files directly related to the current step. Use grep to find exact locations. Do not browse the whole repo.`,
    `3. VALIDATE UNDERSTANDING: Briefly state what you've learned. If you find a contradiction or gap, resolve it immediately with one more targeted read.`,
    `4. DECISIVE ACTION: Once the path is clear, execute the change. If the path is 80% clear, take the safest first step (e.g., create a test or a small part of the logic).`,
    `5. EMPIRICAL FEEDBACK: Run the code or tests. Use the output to correct your course rather than just reading more code.`,
    `6. ATOMIC COMMIT: Once a step is verified, commit your changes with a clear message referencing the goal.`,
    `7. REPORT & CONTINUE: After each step, summarize what you did and use '/goal step complete' to move to the next.`,
    '',
    `=== REPORTING & TRANSPARENCY (MANDATORY) ===`,
    `- BEFORE EACH TASK: You MUST explicitly state what you are about to do. Example: "I am now going to implement the login logic in auth.ts and verify it with a unit test."`,
    `- AFTER EACH TASK: You MUST summarize exactly what was changed and the result. Example: "I have implemented the JWT token generation. Tests are passing. Moving to next step."`,
    `- BE CONCISE: Reporting should be 1-2 sentences maximum to keep the conversation focused.`,
    '',
    `=== COMMUNICATION & ORCHESTRATION ===`,
    `- If you are stuck, need clarification, or encounter a major blocker, send a message to 'team-lead' using 'SendMessage'.`,
    `- When you finish a major milestone, send a summary message to 'team-lead' before marking the step complete.`,
    `- The 'team-lead' is monitoring your progress but you are the primary driver.`,
    '',
    `=== RULES TO PREVENT STALLING & TOKEN BLOWOUTS ===`,
    `- ONE SEARCH, ONE ACTION: For every file search or read you perform, you MUST take a concrete action (edit, create, or delete) within 2 turns. Do not "keep searching" for more context if you have found the relevant code.`,
    `- NO REDUNDANT SEARCHING: If you have already read a file or seen a search result, do not repeat it. Use your memory.`,
    `- PRIORITIZE EDITS: Once you find a bug or a missing feature, FIX IT IMMEDIATELY. Do not search for "similar problems" or "related files" until the current task is done.`,
    `- STOP IF STUCK: If you cannot find the solution after 3 search attempts, STOP and ask the 'team-lead' for help. Do not keep searching blindly.`,
    `- BE SURGICAL: Use grep_search and read_file with line ranges to minimize token usage. Never read entire large files if you only need one function.`,
    '',
    `=== RULES TO PREVENT HALLUCINATION ===`,
    `- COMMIT FREQUENTLY: Prefer small, atomic commits for each completed milestone. This makes it easier to track progress and revert if needed.`,
    `- PLAN YOUR WORK: Never start a complex step without a plan. Record your plan in the goal system so it's visible.`,
    `- NO GUESSING: Never edit a file based on an assumption. If you haven't read the file in this session, read it now.`,
    `- NO ENDLESS BROWSING: If you have read a file and know where the logic is, stop searching. Start planning the edit.`,
    `- TEST-DRIVEN PROGRESS: If you are unsure, write a small reproduction test. The test failure will give you "perfect information" without needing to read every file.`,
    `- ONE READ, MANY EDITS: Try to make all related changes for a step in one go once you understand the target files.`,
    `- BE SURGICAL: Make the minimal change necessary to satisfy the goal. This reduces the need for massive "safety analysis" and prevents hallucinations.`,
    '',
    `=== STOPPING ===`,
    `Stop only when ALL goal steps are complete or you are genuinely blocked by an external dependency.`,
  ].join('\n')
}

function extractSpawnedAgentRunId(spawnResult: string): string | undefined {
  return spawnResult.match(/Agent ID:\s*`([^`]+)`/)?.[1]
}

function extractSpawnedAgentName(spawnResult: string): string | undefined {
  return spawnResult.match(/Subagent teammate \*\*([^*]+)\*\*/)?.[1]
}

async function pursueGoal(args: string[], context?: ToolUseContext): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], ['active', 'paused'])
  if (!goal) {
    return error ?? 'Usage: /goal pursue [goal-id]\nStarts autonomous goal pursuit mode.'
  }

  // Mark the goal as active and set autonomous mode flag
  goal.status = 'active'
  goal.autonomousMode = true
  goal.updatedAt = new Date().toISOString()
  goal.lastActivityAt = new Date().toISOString()

  // If goal has no steps yet, decompose it into actionable steps
  if (goal.steps.length === 0) {
    await planGoal(goal)
  }

  // Set active goal in global state so buildGoalPromptSection picks it up
  setActiveGoalId(goal.id)
  // Enable YOLO mode for the current session to ensure the goal is truly autonomous
  // and matches Codex /goal behavior.
  try {
    const { setSessionBypassPermissionsMode } = await import('../../bootstrap/state.js')
    setSessionBypassPermissionsMode(true)
  } catch (e) {
    // Ignore errors if state.js is not available or doesn't have the setter
  }
  // Clear system context cache so the goal section appears immediately
  getSystemContext.cache.clear?.()

  await saveGoals(goals, { type: 'autonomous_started', goal })

  const currentStep = getCurrentStep(goal)
  const stepInfo = currentStep
    ? `\nCurrent step: ${currentStep.description}`
    : '\nNo steps defined yet.'

  // If REPL context is available, spawn a background teammate for live
  // autonomous work. Otherwise the cron scheduler's 1s tick loop drives
  // progress via the enqueued goal_tick prompt above.
  let spawnInfo = ''
  if (context) {
    const spawnResult = await sessions_spawn({
      label: `goal-${goal.id}`,
      agentType: 'general-purpose',
      mode: 'autonomous-goal',
      permissionMode: 'bypassPermissions',
      task: buildAutonomousGoalTask(goal, currentStep),
      context,
    })
    const agentRunId = extractSpawnedAgentRunId(spawnResult)
    const agentName = extractSpawnedAgentName(spawnResult)
    if (agentRunId) {
      goal.activeAgentRunId = agentRunId
      goal.activeAgentName = agentName
      spawnInfo = `\nBackground teammate started: ${agentRunId} (${agentName || 'unknown name'})`
    } else if (spawnResult.includes('Failed to spawn subagent teammate')) {
      goal.autonomousMode = false
      goal.activeAgentRunId = undefined
      goal.activeAgentName = undefined
      await saveGoals(goals, { type: 'autonomous_failed', goal })
      return `Failed to start autonomous goal mode.\n\n${spawnResult}`
    } else {
      spawnInfo = `\nBackground teammate spawn result:\n${spawnResult}`
    }
  } else {
    // Trigger first autonomous tick — injects a goal-aware prompt on the next
    // turn so the model immediately starts working without waiting for a cron
    // timer or user message. The REPL's 1s cron scheduler processes this via
    // processQueueIfReady → executeQueuedInput → handlePromptSubmit.
    enqueuePendingNotification({
      value: `<goal_tick>Autonomous goal started. Work toward the active goal. Report your progress after each step. Keep working until the goal is met. Check system prompt for goal context.</goal_tick>`,
      mode: 'prompt',
      priority: 'next',
      isMeta: true,
    })
    spawnInfo = '\nNo REPL context — running in cron-tick loop mode. The 1s scheduler will fire goal-aware prompts each turn.'
  }

  return `Autonomous goal mode activated for goal.\n\n${formatGoal(goal, true)}${stepInfo}${spawnInfo}\n\nThe agent will now work toward this goal continuously. Use /goal status to check progress or /goal stop-autonomous to cancel.`
}

async function stopAutonomousMode(args: string[], context?: ToolUseContext): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], ['active', 'paused'])
  if (!goal) {
    return error ?? 'Usage: /goal stop-autonomous [goal-id]'
  }

  goal.autonomousMode = false
  goal.activeAgentRunId = undefined
  goal.status = 'paused'
  const currentStep = getCurrentStep(goal)
  if (currentStep?.status === 'active') {
    currentStep.status = 'paused'
  }
  goal.updatedAt = new Date().toISOString()
  goal.lastActivityAt = new Date().toISOString()
  await saveGoals(goals, { type: 'autonomous_stopped', goal })

  // Clear active goal from global state so buildGoalPromptSection returns null
  setActiveGoalId(null)
  // Clear system context cache so the goal section disappears immediately
  getSystemContext.cache.clear?.()

  return `Autonomous mode stopped for goal.\n\n${formatGoal(goal)}\n\nGoal is paused. Use /goal pursue to restart autonomous work or /goal status to check progress.`
}

async function clearGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], [
    'active',
    'paused',
    'completed',
    'failed',
  ])
  if (!goal) {
    return error ?? `Usage: /goal clear [goal-id]\nWarning: This cannot be undone!`
  }
  const index = goals.indexOf(goal)

  const removed = goals.splice(index, 1)[0]
  await saveGoals(goals, { type: 'cleared', goal: removed })

  return `Goal "${removed.title}" has been removed.`
}

async function attachToGoal(args: string[]): Promise<string> {
  const goals = getGoals()
  const { goal, error } = resolveGoalTarget(goals, args[0], [
    'active',
    'paused',
    'completed',
    'failed',
  ])

  if (!goal) return error ?? 'Usage: /goal attach [goal-id]'

  attachCurrentSessionToGoal(goals, goal)
  goal.updatedAt = new Date().toISOString()
  await saveGoals(goals, { type: 'attached', goal })

  return `Current session attached to goal.\n\n${formatGoal(goal)}`
}

function showHelp(): string {
  return `
${bold('DuckHive /goal - Persisted Workflow Goals')}

${bold('REPL commands:')}
  /goal <description>            Create goal and start autonomous work
  /goal create <description>     Create a goal (does not start autonomous mode)
  /goal list                     List all goals
  /goal status                   Show active goal progress
  /goal pursue [id]              Start autonomous work on a goal
  /goal stop-autonomous [id]     Stop autonomous work
  /goal pause [id]               Pause a goal
  /goal resume [id]              Resume a paused goal
  /goal complete [id]            Mark goal completed
  /goal fail [id]                Mark goal failed
  /goal clear [id]               Delete a goal
  /goal attach [id]              Attach current session to goal
  /goal step add [id] <desc>     Add a step to a goal

${bold('Terminal commands:')}
  duckhive goal <description>            Create goal and start autonomous work
  duckhive goal create <description>     Create a goal
  duckhive goal list                     List all goals
  duckhive goal status                   Show goal status
  duckhive goal pursue [id]              Start autonomous work
  duckhive goal stop-autonomous [id]     Stop autonomous work
  duckhive goal pause [id]               Pause a goal
  duckhive goal resume [id]              Resume a paused goal
  duckhive goal complete [id]            Mark goal completed
  duckhive goal fail [id]                Mark goal failed
  duckhive goal clear [id]               Delete a goal
  duckhive goal step add [id] <desc>     Add a step to a goal

${bold('Examples:')}
  /goal "Build user authentication system"
  /goal Write tests for the auth module
  /goal stop
  /goal list active
  /goal pursue goal_123
  /goal stop-autonomous goal_123

${italic('Autonomous mode: the agent works toward the goal continuously across turns. Run /goal stop to cancel.')}
`.trim()
}

async function handleStepCommand(
  args: string[],
  context?: ToolUseContext,
): Promise<string> {
  const action = args[0]?.toLowerCase()

  if (!action) {
    return 'Usage: /goal step add <goal-id> <description>\n   or: /goal step add <description> (uses active goal)'
  }

  switch (action) {
    case 'add':
    case 'create':
      return addStep(args.slice(1))
    case 'complete':
    case 'done':
      return completeStep(args.slice(1), context)
    default:
      return 'Unknown step command: ' + action + '\nUsage: /goal step add <goal-id> <description>'
  }
}

export async function call(
  args: string,
  context?: ToolUseContext,
): Promise<{ type: 'text'; value: string }> {
  const parsed = splitCommandArgs(args)
  if (parsed.error) {
    return { type: 'text', value: parsed.error }
  }
  return { type: 'text', value: await goalCommand(parsed.args, context) }
}

export default async function goalCommand(
  args: string[],
  context?: ToolUseContext,
): Promise<string> {
  // Simplified one-shot interface:
  //   /goal "do X"      → create + start autonomous work
  //   /goal stop        → stop active autonomous goal
  //   /goal list/status → management (same as before)
  // All other subcommands still work for power users.

  const subcommand = args[0]?.toLowerCase()
  const isKnownSubcommand = [
    'create', 'new', 'list', 'ls', 'status', 'stat',
    'pause', 'resume', 'continue', 'complete', 'done', 'finish',
    'fail', 'failed', 'cancel', 'clear', 'delete', 'remove',
    'attach', 'link', 'step',
    'pursue', 'work', 'start',
    'stop', 'stop-autonomous', 'help',
  ].includes(subcommand ?? '')

  // /goal do X — multi-word non-subcommand → create goal and start autonomous
  // pursuit (Codex-style shorthand). The agent works toward the goal in the
  // foreground, visible to the user, not stopping until the goal is met.
  // We no longer reject single words, to match Codex exactly.
  if (args.length >= 1 && !isKnownSubcommand) {
    return await createGoalAndStartAutonomous(args, context)
  }

  switch (subcommand) {
    case undefined:
    case 'status':
    case 'stat':
      return goalStatus(args.slice(1))

    case 'stop':
      return stopActiveAutonomousGoal(context)

    case 'list':
    case 'ls':
      return listGoals(args.slice(1))

    case 'create':
    case 'new': {
      const result = await createGoal(args.slice(1))
      // If goal was created successfully and REPL context available, start autonomous mode
      if (result.goalId && context) {
        return await pursueGoal([result.goalId], context)
      }
      return result.message
    }

    case 'pursue':
    case 'work':
    case 'start':
      return pursueGoal(args.slice(1), context)

    case 'stop-autonomous':
      return stopAutonomousMode(args.slice(1), context)

    case 'pause':
      return pauseGoal(args.slice(1))

    case 'resume':
    case 'continue':
      return resumeGoal(args.slice(1))

    case 'complete':
    case 'done':
    case 'finish':
      return completeGoal(args.slice(1))

    case 'fail':
    case 'failed':
    case 'cancel':
      return failGoal(args.slice(1))

    case 'clear':
    case 'delete':
      return clearGoal(args.slice(1))

    case 'attach':
    case 'link':
      return attachToGoal(args.slice(1))

    case 'step':
      return handleStepCommand(args.slice(1), context)

    case 'help':
      return showHelp()

    default:
      return goalStatus(args)
  }
}

function splitCommandArgs(args: string): { args: string[]; error?: string } {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of args) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }

    if (char === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaping) {
    current += '\\'
  }

  if (quote) {
    return {
      args: [],
      error: `Unterminated quoted string in /goal arguments. Close the ${quote} quote and try again.`,
    }
  }

  if (current) {
    tokens.push(current)
  }

  return { args: tokens }
}
