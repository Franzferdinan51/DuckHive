import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as stateModule from '../../bootstrap/state.js'
import * as configModule from '../../utils/config.js'

type GoalRecord = {
  id: string
  sessionId?: string
  status?: string
  currentStepId?: string
  description?: string
  completedAt?: string
  autonomousMode?: boolean
  activeAgentRunId?: string
  activeAgentName?: string
  lastActivityAt?: string
  budgetUSD?: number
  steps: Array<{
    id?: string
    description: string
    status?: string
    createdAt?: string
    completedAt?: string
  }>
}

let configStore: Record<string, unknown>
let sessionId = 'session-current'
let spawnedTasks: Array<{
  label?: string
  task?: string
  agentType?: string
  mode?: string
}> = []
let planSlugCache: Map<string, string>
let modelStringsState: unknown = null
let inlinePlugins: string[] = []
let agentColorMap: Map<string, unknown>
let sessionCronTasks: any[] = []

async function importFreshGoalCommand() {
  return (await import(`./goal.ts?goal-test=${Date.now()}-${Math.random()}`))
    .default
}

async function importFreshGoalModule() {
  return await import(`./goal.ts?goal-test=${Date.now()}-${Math.random()}`)
}

function getStoredGoals(): GoalRecord[] {
  return ((configStore['duckhive.goals'] as GoalRecord[]) ?? [])
}

describe('/goal command', () => {
  beforeEach(() => {
    configStore = { 'duckhive.goals': [] }
    sessionId = 'session-current'
    spawnedTasks = []
    planSlugCache = new Map()
    modelStringsState = null
    inlinePlugins = []
    agentColorMap = new Map()
    sessionCronTasks = []

    // Build comprehensive proxy mocks to stop SyntaxErrors
    const stateMock = {} as any
    for (const key of Object.keys(stateModule)) {
      if (typeof (stateModule as any)[key] === 'function') {
        stateMock[key] = (...args: any[]) => {
          if (key === 'getSessionId') return sessionId
          if (key === 'getCwdState') return process.cwd()
          if (key === 'getOriginalCwd') return process.cwd()
          if (key === 'getProjectRoot') return process.cwd()
          if (key === 'getInvokedSkills') return new Map()
          if (key === 'getLastAPIRequestMessages') return []
          if (key === 'getInlinePlugins') return inlinePlugins
          if (key === 'setInlinePlugins') {
            inlinePlugins = args[0] ?? []
            return
          }
          if (key === 'getAllowedSettingSources') {
            return ['userSettings', 'projectSettings', 'localSettings']
          }
          if (key === 'getStatsStore') return {}
          if (key === 'getIsInteractive') return true
          if (key === 'getPlanSlugCache') return planSlugCache
          if (key === 'getAgentColorMap') return agentColorMap
          if (key === 'getSessionCronTasks') return sessionCronTasks
          if (key === 'addSessionCronTask') {
            sessionCronTasks.push(args[0])
            return
          }
          if (key === 'removeSessionCronTasks') {
            const ids = new Set(args[0] ?? [])
            const before = sessionCronTasks.length
            sessionCronTasks = sessionCronTasks.filter(task => !ids.has(task.id))
            return before - sessionCronTasks.length
          }
          if (key === 'getAdditionalDirectoriesForClaudeMd') return []
          if (key === 'getModelStrings') return modelStringsState
          if (key === 'setModelStrings') {
            modelStringsState = args[0]
            return
          }
          if (key === 'resetModelStringsForTestingOnly') {
            modelStringsState = null
            return
          }
          return undefined
        }
      } else {
        stateMock[key] = (stateModule as any)[key]
      }
    }

    const configMock = {} as any
    for (const key of Object.keys(configModule)) {
      if (typeof (configModule as any)[key] === 'function') {
        configMock[key] = (...args: any[]) => {
          if (key === 'getGlobalConfig') return configStore
          if (key === 'saveGlobalConfig') {
            const updater = args[0]
            configStore = updater(configStore)
            return
          }
          if (key === 'getMemoryPath') return ''
          return undefined
        }
      } else {
        configMock[key] = (configModule as any)[key]
      }
    }

    mock.module('../../utils/config.js', () => configMock)
    mock.module('../../bootstrap/state.js', () => stateMock)

    mock.module('../../subagentSystem.js', () => ({
      sessions_spawn: async (options: {
        label?: string
        task?: string
        agentType?: string
        mode?: string
      }) => {
        spawnedTasks.push(options)
        return [
          '## Deep Analysis',
          'Subagent teammate **goal-worker** spawned successfully.',
          'Agent ID: `agent_goal_123`',
          'Team: duckhive-sessions',
          'Model: default',
        ].join('\n')
      },
    }))
    mock.module('../../context.js', () => ({
      getSystemPromptInjection: () => null,
      setSystemPromptInjection: () => undefined,
      getGitStatus: Object.assign(async () => null, {
        cache: { clear: () => undefined },
      }),
      getRepoMapContext: Object.assign(async () => null, {
        cache: { clear: () => undefined },
      }),
      getSystemContext: Object.assign(() => ({}), {
        cache: { clear: () => undefined },
      }),
      getUserContext: Object.assign(async () => ({}), {
        cache: { clear: () => undefined },
      }),
    }))
    mock.module('../../coordinator/planner.js', () => ({
      SimplePlanner: class {},
      LLMPlanner: class {},
      TaskPlanner: class {
        async createPlan(description: string) {
          return { steps: [{ description }] }
        }
      },
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  test('step add without a goal id uses the single active goal', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Ship', 'the', 'release'])

    const result = await goalCommand(['step', 'add', 'Write', 'release', 'notes'])

    expect(result).toContain('Step added to goal.')
    const goals = getStoredGoals()
    expect(goals).toHaveLength(1)
    expect(goals[0]?.steps).toHaveLength(1)
    expect(goals[0]?.steps[0]?.description).toBe('Write release notes')
  })

  test('step add without a goal id errors when multiple active goals exist and none is attached to this session', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Goal', 'two'])
    sessionId = 'session-third'

    const result = await goalCommand(['step', 'add', 'Investigate', 'bug'])

    expect(result).toContain('Multiple active goals found.')
  })

  test('bare /goal <description> uses the Codex-style shorthand create flow', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand(['Build', 'user', 'authentication', 'system'])

    expect(result).toContain('Autonomous goal started')
    expect(getStoredGoals()).toHaveLength(1)
    expect(getStoredGoals()[0]?.description).toBe('Build user authentication system')
  })

  test('emits goal update events after persisted goal mutations', async () => {
    const { default: goalCommand, goalUpdates } = await importFreshGoalModule()
    const events: Array<{ type: string; goal?: GoalRecord; goals: GoalRecord[] }> = []
    const unsubscribe = goalUpdates.subscribe(event => {
      events.push(event as { type: string; goal?: GoalRecord; goals: GoalRecord[] })
    })

    await goalCommand(['create', 'Track', 'goal', 'events'])
    await goalCommand(['pause'])

    unsubscribe()

    expect(events.map(event => event.type)).toEqual(['created', 'paused'])
    expect(events[0]?.goal?.description).toBe('Track goal events')
    expect(events[0]?.goals).toHaveLength(1)
    expect(events[1]?.goal?.status).toBe('paused')
  })

  test('goal update event payloads are snapshots, not live config objects', async () => {
    const { default: goalCommand, goalUpdates } = await importFreshGoalModule()
    let captured: GoalRecord | undefined
    const unsubscribe = goalUpdates.subscribe(event => {
      captured = event.goal as GoalRecord | undefined
    })

    await goalCommand(['create', 'Snapshot', 'goal'])
    unsubscribe()

    captured!.description = 'mutated by subscriber'
    captured!.steps.push({ description: 'subscriber step' })

    expect(getStoredGoals()[0]?.description).toBe('Snapshot goal')
    expect(getStoredGoals()[0]?.steps).toHaveLength(0)
  })

  test('REPL /goal shorthand preserves escaped quotes in descriptions', async () => {
    const { call } = await importFreshGoalModule()

    const result = await call('Build the \\"fast\\" workflow')

    expect(result.value).toContain('Autonomous goal started')
    expect(getStoredGoals()).toHaveLength(1)
    expect(getStoredGoals()[0]?.description).toBe('Build the "fast" workflow')
  })

  test('REPL /goal create preserves escaped quotes in descriptions', async () => {
    const { call } = await importFreshGoalModule()

    const result = await call('create "Build the \\"fast\\" workflow"')

    expect(result.value).toContain('Goal created successfully!')
    expect(getStoredGoals()).toHaveLength(1)
    expect(getStoredGoals()[0]?.description).toBe('Build the "fast" workflow')
  })

  test('REPL /goal step add preserves escaped quotes in step descriptions', async () => {
    const { call } = await importFreshGoalModule()
    await call('create Ship release')

    const result = await call('step add "Run the \\"fast\\" smoke"')

    expect(result.value).toContain('Step added to goal.')
    expect(getStoredGoals()[0]?.steps[0]?.description).toBe(
      'Run the "fast" smoke',
    )
  })

  test('REPL /goal rejects unterminated quotes before creating goals', async () => {
    const { call } = await importFreshGoalModule()

    const result = await call('create "unfinished workflow')

    expect(result.value).toContain('Unterminated quoted string in /goal arguments')
    expect(getStoredGoals()).toHaveLength(0)
  })

  test('goal output uses ASCII-safe terminal status labels', async () => {
    const goalCommand = await importFreshGoalCommand()

    await goalCommand(['create', 'Fix', 'terminal', 'output'])
    await goalCommand(['step', 'add', 'Verify', 'formatting'])
    const created = await goalCommand(['status'])
    const completed = await goalCommand(['complete'])

    expect(created).toContain('[active]')
    expect(created).toContain('> [step_')
    expect(completed).toContain('Goal completed.')
    expect(completed).toContain('[done]')
    expect(/[^\x00-\x7F]/.test(`${created}\n${completed}`)).toBe(false)
  })

  test('bare /goal shows current goal status instead of static help when goals exist', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Track', 'the', 'migration'])

    const result = await goalCommand([])

    expect(result).toContain('Track the migration')
    expect(result).not.toContain('DuckHive /goal - Persisted Workflow Goals')
  })

  test('bare /goal shows a summary instead of help when no active goal exists', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand([])

    expect(result).toContain('Goal Status Summary')
    expect(result).toContain('Active: 0 | Paused: 0 | Total: 0')
  })

  test('help shows terminal and REPL goal commands', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand(['help'])

    expect(result).toContain('DuckHive /goal - Persisted Workflow Goals')
    expect(result).toContain('duckhive goal <description>')
    expect(result).toContain('duckhive goal step add [id] <desc>')
    expect(result).toContain('duckhive goal pursue [id]')
    expect(result).toContain('duckhive goal stop-autonomous [id]')
    expect(result).toContain('/goal <description>')
    expect(result).toContain('/goal step add [id] <desc>')
    expect(result).toContain('/goal pursue [id]')
    expect(result).toContain('/goal stop-autonomous [id]')
  })

  test('adding a new step completes the previous current step', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Ship', 'the', 'release'])
    await goalCommand(['step', 'add', 'Write', 'release', 'notes'])

    const result = await goalCommand(['step', 'add', 'Publish', 'announcement'])

    expect(result).toContain('Step added to goal.')
    const goals = getStoredGoals()
    expect(goals).toHaveLength(1)
    expect(goals[0]?.steps).toHaveLength(2)
    expect(goals[0]?.steps[0]?.status).toBe('completed')
    expect(goals[0]?.steps[0]?.completedAt).toBeTruthy()
    expect(goals[0]?.steps[1]?.description).toBe('Publish announcement')
    expect(goals[0]?.steps[1]?.status).toBe('active')
  })

  test('step add rejects ambiguous goal references instead of falling back to the active goal', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])
    await goalCommand(['create', 'Goal', 'two'])

    const result = await goalCommand(['step', 'add', 'goal_', 'Investigate', 'bug'])

    expect(result).toContain('Goal reference is ambiguous: goal_')
    expect(getStoredGoals()[0]?.steps).toHaveLength(0)
    expect(getStoredGoals()[1]?.steps).toHaveLength(0)
  })

  test('step add rejects missing goal_ references instead of treating them as step text', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])

    const result = await goalCommand([
      'step',
      'add',
      'goal_missing',
      'Investigate',
      'bug',
    ])

    expect(result).toContain('Goal not found: goal_missing')
    expect(getStoredGoals()[0]?.steps).toHaveLength(0)
  })

  test('step add rejects paused goals even when referenced explicitly', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Paused', 'goal'])
    const pausedGoalId = getStoredGoals()[0]?.id
    await goalCommand(['pause', pausedGoalId!])

    const result = await goalCommand([
      'step',
      'add',
      pausedGoalId!,
      'Should',
      'not',
      'append',
    ])

    expect(result).toContain('Cannot add a step to a paused goal')
    expect(getStoredGoals()[0]?.steps).toHaveLength(0)
  })

  test('step add rejects completed goals even when referenced explicitly', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Completed', 'goal'])
    const completedGoalId = getStoredGoals()[0]?.id
    await goalCommand(['complete', completedGoalId!])

    const result = await goalCommand([
      'step',
      'add',
      completedGoalId!,
      'Should',
      'not',
      'append',
    ])

    expect(result).toContain('Cannot add a step to a completed goal')
    expect(getStoredGoals()[0]?.steps).toHaveLength(0)
  })

  test('step without a subcommand returns usage instead of an undefined error', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand(['step'])

    expect(result).toContain('Usage: /goal step add <goal-id> <description>')
    expect(result).not.toContain('Unknown step command: undefined')
  })

  test('status rejects ambiguous partial goal ids', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])
    await goalCommand(['create', 'Goal', 'two'])

    const result = await goalCommand(['status', 'goal_'])

    expect(result).toContain('Goal reference is ambiguous: goal_')
    expect(result).toContain('Matches:')
  })

  test('list rejects unknown filters instead of silently showing all goals', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])

    const result = await goalCommand(['list', 'mystery'])

    expect(result).toContain('Unknown goal filter')
    expect(result).toContain('all, active, paused, completed')
  })

  test('single-word goals are accepted exactly like Codex (no longer rejected as unknown subcommands)', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand(['Refactor'])

    expect(result).toContain('Autonomous goal started')
    expect(getStoredGoals()).toHaveLength(1)
    expect(getStoredGoals()[0]?.description).toBe('Refactor')
  })

  test('bare status prefers the single active goal detail view', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Improve', 'coverage'])

    const result = await goalCommand(['status'])

    expect(result).toContain('Improve coverage')
    expect(result).not.toContain('Goal Status Summary')
  })

  test('pause and resume default to the single active goal', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Ship', 'release'])

    const paused = await goalCommand(['pause'])
    expect(paused).toContain('Goal paused.')

    const resumed = await goalCommand(['resume'])
    expect(resumed).toContain('Goal resumed!')
  })

  test('pause and resume carry the current active step lifecycle', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Ship', 'release'])
    await goalCommand(['step', 'add', 'Run', 'smoke', 'tests'])

    const paused = await goalCommand(['pause'])
    expect(paused).toContain('Goal paused.')
    expect(getStoredGoals()[0]?.status).toBe('paused')
    expect(getStoredGoals()[0]?.steps[0]?.status).toBe('paused')

    const resumed = await goalCommand(['resume'])
    expect(resumed).toContain('Goal resumed!')
    expect(getStoredGoals()[0]?.status).toBe('active')
    expect(getStoredGoals()[0]?.steps[0]?.status).toBe('active')
  })

  test('pursue starts autonomous goal mode and creates an initial step', async () => {
    const { call } = await importFreshGoalModule()
    await (await importFreshGoalCommand())(['create', 'Stabilize', 'the', 'CLI'])

    const result = await call('pursue', {} as never)

    expect(result.value).toContain('Autonomous goal mode activated')
    expect(result.value).toContain('Background teammate started: agent_goal_123')
    expect(spawnedTasks).toHaveLength(1)
    expect(spawnedTasks[0]?.agentType).toBe('general-purpose')
    expect(spawnedTasks[0]?.mode).toBe('autonomous-goal')
    expect(spawnedTasks[0]?.task).toContain('Stabilize the CLI')
    const goal = getStoredGoals()[0]
    expect(goal?.status).toBe('active')
    expect(goal?.autonomousMode).toBe(true)
    expect(goal?.activeAgentRunId).toBe('agent_goal_123')
    expect(goal?.lastActivityAt).toBeTruthy()
    expect(goal?.steps[0]?.description).toBe('Stabilize the CLI')
    expect(goal?.steps[0]?.status).toBe('active')
    expect(sessionCronTasks).toHaveLength(1)
    expect(sessionCronTasks[0]?.id).toBe(`heartbeat-${goal?.id}`)
    expect(sessionCronTasks[0]?.cron).toBe('*/30 * * * *')
    expect(sessionCronTasks[0]?.recurring).toBe(true)
    expect(sessionCronTasks[0]?.prompt).toContain('HEARTBEAT_OK')
  })

  test('stop-autonomous pauses the goal and active step', async () => {
    const { call } = await importFreshGoalModule()
    await (await importFreshGoalCommand())(['create', 'Stabilize', 'the', 'CLI'])
    await call('pursue', {} as never)

    const result = await call('stop-autonomous')

    expect(result.value).toContain('Autonomous mode stopped')
    expect(result.value).toContain('Goal is paused')
    const goal = getStoredGoals()[0]
    expect(goal?.status).toBe('paused')
    expect(goal?.autonomousMode).toBe(false)
    expect(goal?.activeAgentRunId).toBeUndefined()
    expect(goal?.steps[0]?.status).toBe('paused')
  })

  test('resume without an id prefers the current session paused goal', async () => {
    const goalCommand = await importFreshGoalCommand()

    await goalCommand(['create', 'Current', 'goal'])
    await goalCommand(['pause'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Other', 'goal'])
    await goalCommand(['pause'])
    sessionId = 'session-current'

    const result = await goalCommand(['resume'])

    expect(result).toContain('Goal resumed!')
    expect(getStoredGoals().find(goal => goal.sessionId === 'session-current')?.status).toBe(
      'active',
    )
    expect(getStoredGoals().find(goal => goal.sessionId === 'session-other')?.status).toBe(
      'paused',
    )
  })

  test('fail marks the current goal and active step failed', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Investigate', 'regression'])
    await goalCommand(['step', 'add', 'Reproduce', 'the', 'bug'])

    const result = await goalCommand(['fail'])

    expect(result).toContain('Goal marked failed.')
    const goal = getStoredGoals()[0]
    expect(goal?.status).toBe('failed')
    expect(goal?.currentStepId).toBeUndefined()
    expect(goal?.completedAt).toBeTruthy()
    expect(goal?.steps[0]?.status).toBe('failed')
    expect(goal?.steps[0]?.completedAt).toBeTruthy()
  })

  test('fail rejects completed goals even when referenced explicitly', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Already', 'done'])
    const goalId = getStoredGoals()[0]?.id
    await goalCommand(['complete', goalId!])

    const result = await goalCommand(['fail', goalId!])

    expect(result).toContain('Goal is not active or paused')
    expect(getStoredGoals()[0]?.status).toBe('completed')
  })

  test('list failed filters failed goals', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Failed', 'goal'])
    await goalCommand(['fail'])
    await goalCommand(['create', 'Active', 'goal'])

    const result = await goalCommand(['list', 'failed'])

    expect(result).toContain('Failed goal')
    expect(result).not.toContain('Active goal')
    expect(result).toContain('FAILED')
    expect(result).toContain('Showing 1 of 1 failed goals (2 total goals)')
  })

  test('filtered list count reports the filtered subset and total persisted goals', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'First', 'active'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Second', 'active'])
    await goalCommand(['pause'])
    sessionId = 'session-third'
    await goalCommand(['create', 'Third', 'active'])

    const result = await goalCommand(['list', 'active'])

    expect(result).toContain('Showing 2 of 2 active goals (3 total goals)')
    expect(result).toContain('First active')
    expect(result).toContain('Third active')
    expect(result).not.toContain('Second active')
  })

  test('create attaches the current session id to the new goal', async () => {
    const goalCommand = await importFreshGoalCommand()

    const result = await goalCommand(['create', 'Integrate', 'goal', 'workflow'])

    expect(result).toContain('Attached Session: session-current')
    expect(getStoredGoals()[0]?.sessionId).toBe('session-current')
  })

  test('status prefers the goal attached to the current session', async () => {
    const goalCommand = await importFreshGoalCommand()

    await goalCommand(['create', 'Session', 'goal'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Other', 'goal'])
    sessionId = 'session-current'

    const result = await goalCommand(['status'])

    expect(result).toContain('Session goal')
    expect(result).not.toContain('Other goal')
  })

  test('status ignores historical completed session goals when a current goal is active', async () => {
    const goalCommand = await importFreshGoalCommand()

    await goalCommand(['create', 'Finished', 'goal'])
    await goalCommand(['complete'])
    await goalCommand(['create', 'Current', 'goal'])

    const result = await goalCommand(['status'])

    expect(result).toContain('Current goal')
    expect(result).not.toContain('Finished goal')
    expect(result).not.toContain('Multiple goals are attached to this session')
  })

  test('step add without an id prefers the current session goal', async () => {
    const goalCommand = await importFreshGoalCommand()

    await goalCommand(['create', 'Current', 'goal'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Other', 'goal'])
    sessionId = 'session-current'

    const result = await goalCommand(['step', 'add', 'Implement', 'the', 'feature'])

    expect(result).toContain('Step added to goal.')
    expect(getStoredGoals().find(goal => goal.sessionId === 'session-current')?.steps[0]?.description).toBe(
      'Implement the feature',
    )
    expect(getStoredGoals().find(goal => goal.sessionId === 'session-other')?.steps).toHaveLength(0)
  })

  test('attach uses the real current session id instead of a synthetic id', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'First', 'goal'])

    sessionId = 'session-next'
    const result = await goalCommand(['attach', 'goal_'])

    expect(result).toContain('Attached Session: session-next')
    expect(getStoredGoals()[0]?.sessionId).toBe('session-next')
  })

  test('clear defaults to the single active goal', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Remove', 'temp', 'goal'])

    const result = await goalCommand(['clear'])

    expect(result).toContain('has been removed.')
    expect(getStoredGoals()).toHaveLength(0)
  })

  test('pause without an id errors clearly when multiple active goals exist and none is attached to this session', async () => {
    const goalCommand = await importFreshGoalCommand()
    await goalCommand(['create', 'Goal', 'one'])
    sessionId = 'session-other'
    await goalCommand(['create', 'Goal', 'two'])
    sessionId = 'session-third'

    const result = await goalCommand(['pause'])

    expect(result).toContain('Multiple active goals found.')
  })

  test('autonomous start does not enqueue tick for lead when teammate is spawned', async () => {
    let enqueuedCommand: any = null
    mock.module('../../utils/messageQueueManager.js', () => ({
      enqueuePendingNotification: (cmd: any) => {
        enqueuedCommand = cmd
      },
    }))

    const { call } = await importFreshGoalModule()
    // context present means REPL mode -> spawn teammate
    await call('"Fix bug"', {} as any)

    expect(spawnedTasks).toHaveLength(1)
    // Should NOT have enqueued a tick for the lead
    expect(enqueuedCommand).toBeNull()
  })

  test('autonomous start enqueues tick for lead when no teammate is spawned (non-REPL)', async () => {
    let enqueuedCommand: any = null
    mock.module('../../utils/messageQueueManager.js', () => ({
      enqueuePendingNotification: (cmd: any) => {
        enqueuedCommand = cmd
      },
    }))

    const { call } = await importFreshGoalModule()
    // No context -> cron tick loop mode
    await call('"Fix bug"', undefined)

    expect(spawnedTasks).toHaveLength(0)
    expect(enqueuedCommand).not.toBeNull()
    expect(enqueuedCommand.value).toContain('<goal_tick>')
    expect(enqueuedCommand.agentId).toBeUndefined()
  })

  test('completeStep routes goal_tick back to the subagent mailbox if activeAgentName is present', async () => {
    let enqueuedCommand: any = null
    mock.module('../../utils/messageQueueManager.js', () => ({
      enqueuePendingNotification: (cmd: any) => {
        enqueuedCommand = cmd
      },
    }))

    let mailboxMessage: any = null
    mock.module('../../utils/teammateMailbox.js', () => ({
      writeToMailbox: (name: string, msg: any) => {
        mailboxMessage = { name, msg }
      },
    }))

    const { default: goalCommand } = await importFreshGoalModule()
    await goalCommand(['create', 'Work'])

    // Mock an active subagent with steps
    const goals = getStoredGoals()
    goals[0].autonomousMode = true
    goals[0].activeAgentName = 'goal-worker'
    goals[0].activeAgentRunId = 'agent_123'
    goals[0].currentStepId = 'step_1'
    goals[0].steps.push({
      id: 'step_1',
      description: 'Step 1',
      status: 'active',
      createdAt: new Date().toISOString(),
    })
    goals[0].steps.push({
      id: 'step_2',
      description: 'Step 2',
      status: 'paused',
      createdAt: new Date().toISOString(),
    })

    // Call completeStep with an agentId context
    await goalCommand(['step', 'complete'], { agentId: 'agent_123' } as any)

    // Should NOT have enqueued a global tick
    expect(enqueuedCommand).toBeNull()

    // Should HAVE written to the subagent mailbox
    expect(mailboxMessage).not.toBeNull()
    expect(mailboxMessage.name).toBe('goal-worker')
    expect(mailboxMessage.msg.text).toContain('<goal_tick>')
    expect(mailboxMessage.msg.summary).toContain('Next step: Step 2')
  })

  test('completeStep routes goal_tick to lead if called from main thread', async () => {
    let enqueuedCommand: any = null
    mock.module('../../utils/messageQueueManager.js', () => ({
      enqueuePendingNotification: (cmd: any) => {
        enqueuedCommand = cmd
      },
    }))

    const { default: goalCommand } = await importFreshGoalModule()
    await goalCommand(['create', 'Work'])
    await goalCommand(['pursue'], undefined)

    // Manually add a second step
    const goals = getStoredGoals()
    expect(goals).toHaveLength(1)
    goals[0].steps.push({
      id: 'step_2',
      description: 'Step 2',
      status: 'paused',
      createdAt: new Date().toISOString(),
    })

    // Call completeStep without an agentId (main thread)
    await goalCommand(['step', 'complete'], {} as any)

    expect(enqueuedCommand).not.toBeNull()
    expect(enqueuedCommand.agentId).toBeUndefined()
  })

  test('pursue captures and stores activeAgentName from spawn result', async () => {
    const { default: goalCommand } = await importFreshGoalModule()
    await goalCommand(['create', 'Work'])
    await goalCommand(['pursue'], {} as any) // REPL context -> spawn

    const goals = getStoredGoals()
    expect(goals[0].activeAgentName).toBe('goal-worker')
    expect(goals[0].activeAgentRunId).toBe('agent_goal_123')
  })
})
