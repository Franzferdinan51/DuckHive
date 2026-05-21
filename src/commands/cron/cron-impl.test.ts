import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let addedTask: {
  cron: string
  prompt: string
  recurring: boolean
  durable: boolean
} | null
let listedTasks: any[]
let removedIds: string[][]
let queuedCommands: any[]

async function importFreshCronCommand() {
  return await import(`./cron-impl.ts?cron-test=${Date.now()}-${Math.random()}`)
}

describe('/cron command', () => {
  beforeEach(() => {
    addedTask = null
    listedTasks = []
    removedIds = []
    queuedCommands = []

    mock.module('../../utils/cronTasks.js', () => ({
      addCronTask: async (
        cron: string,
        prompt: string,
        recurring: boolean,
        durable: boolean,
      ) => {
        addedTask = { cron, prompt, recurring, durable }
        return 'cron-test'
      },
      listAllCronTasks: async () => listedTasks,
      nextCronRunMs: () => Date.UTC(2026, 4, 21, 12, 0, 0),
      removeCronTasks: async (ids: string[]) => {
        removedIds.push(ids)
      },
    }))

    mock.module('../../utils/messageQueueManager.js', () => ({
      enqueuePendingNotification: (command: any) => {
        queuedCommands.push(command)
      },
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  test('add honors --interval instead of always using the default schedule', async () => {
    const { call } = await importFreshCronCommand()

    const result = await call('add "Check release health" --interval 15m', {} as never)

    expect(result.type).toBe('text')
    expect(result.value).toContain('cron-test')
    expect(addedTask).toEqual({
      cron: '*/15 * * * *',
      prompt: 'Check release health',
      recurring: true,
      durable: false,
    })
  })

  test('add accepts explicit cron expressions and rejects invalid ones', async () => {
    const { call } = await importFreshCronCommand()

    await call('add "Daily check" --cron "0 9 * * *"', {} as never)
    expect(addedTask?.cron).toBe('0 9 * * *')

    const invalid = await call('add "Bad check" --cron nope', {} as never)
    expect(invalid.type).toBe('text')
    expect(invalid.value).toContain('Invalid cron expression')
  })

  test('list --json includes OpenClaw-style status and next-run fields', async () => {
    listedTasks = [
      {
        id: 'cron-1',
        cron: '*/30 * * * *',
        prompt: 'Summarize status',
        createdAt: Date.UTC(2026, 4, 21, 10, 0, 0),
        recurring: true,
        durable: false,
      },
    ]
    const { call } = await importFreshCronCommand()

    const result = await call('list --json', {} as never)
    expect(result.type).toBe('text')
    const parsed = JSON.parse(result.value)
    expect(parsed.tasks[0]).toMatchObject({
      id: 'cron-1',
      cron: '*/30 * * * *',
      schedule: 'Every 30 minutes',
      status: 'idle',
      durable: false,
      nextRunAt: '2026-05-21T12:00:00.000Z',
    })
  })

  test('run queues the task prompt for immediate execution', async () => {
    listedTasks = [
      {
        id: 'cron-run-me',
        cron: '*/30 * * * *',
        prompt: 'Run now',
        createdAt: Date.now(),
        recurring: true,
      },
    ]
    const { call } = await importFreshCronCommand()

    const result = await call('run cron-run-me', {} as never)

    expect(result.type).toBe('text')
    expect(result.value).toContain('queued')
    expect(queuedCommands).toHaveLength(1)
    expect(queuedCommands[0]).toMatchObject({
      value: 'Run now',
      mode: 'prompt',
      priority: 'next',
      isMeta: true,
      workload: 'cron',
    })
  })

  test('clear removes all listed tasks', async () => {
    listedTasks = [
      { id: 'a', cron: '*/5 * * * *', prompt: 'A', createdAt: Date.now() },
      { id: 'b', cron: '*/10 * * * *', prompt: 'B', createdAt: Date.now() },
    ]
    const { call } = await importFreshCronCommand()

    const result = await call('clear', {} as never)

    expect(result.type).toBe('text')
    expect(result.value).toContain('Removed 2')
    expect(removedIds).toEqual([['a', 'b']])
  })
})
