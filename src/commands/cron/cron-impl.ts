/**
 * DuckHive Cron Manager - session-level scheduled prompts inspired by
 * OpenClaw's cron administration surface.
 */
import type { LocalCommandCall } from '../../types/command.js'
import { bold } from '../../components/styles.js'
import { cronToHuman, parseCronExpression } from '../../utils/cron.js'
import {
  addCronTask,
  listAllCronTasks,
  nextCronRunMs,
  removeCronTasks,
  type CronTask,
} from '../../utils/cronTasks.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { WORKLOAD_CRON } from '../../utils/workloadContext.js'

type CronView = {
  id: string
  cron: string
  schedule: string
  prompt: string
  status: 'idle'
  recurring: boolean
  durable: boolean
  nextRunAt: string | null
  createdAt: string
}

type ParsedArgs = {
  action: string
  positional: string[]
  flags: Set<string>
  options: Map<string, string>
}

const DEFAULT_CRON = '*/30 * * * *'

export const call: LocalCommandCall = async (args: string) => {
  const parsed = parseArgs(args)
  const action = parsed.action

  switch (action) {
    case 'add':
    case 'create':
      return addTask(parsed)

    case 'list':
    case 'ls':
      return listTasks(parsed)

    case 'show':
    case 'get':
      return showTask(parsed)

    case 'run':
      return runTask(parsed)

    case 'remove':
    case 'rm':
    case 'delete':
      return removeTask(parsed)

    case 'clear':
      return clearTasks()

    case 'help':
    case '':
      return { type: 'text', value: usage() }

    default:
      return {
        type: 'text',
        value: `Unknown /cron command "${action}".\n\n${usage()}`,
      }
  }
}

async function addTask(parsed: ParsedArgs) {
  const prompt = parsePrompt(parsed)
  if (!prompt) {
    return { type: 'text' as const, value: 'Usage: /cron add "<prompt>" [--interval 30m | --cron "*/30 * * * *"]' }
  }

  const cron = parseSchedule(parsed)
  if (!cron.ok) return { type: 'text' as const, value: cron.error }

  const id = await addCronTask(cron.value, prompt, true, false)
  return {
    type: 'text' as const,
    value: `SUCCESS Recurring task added (ID: ${id})\nSchedule: ${cronToHuman(cron.value)}\nPrompt: ${prompt}`,
  }
}

async function listTasks(parsed: ParsedArgs) {
  const tasks = await listAllCronTasks()
  const views = tasks.map(taskToView)

  if (parsed.flags.has('json')) {
    return { type: 'text' as const, value: jsonStringify({ tasks: views }, null, 2) }
  }

  if (views.length === 0) {
    return { type: 'text' as const, value: 'No recurring tasks scheduled.' }
  }

  const rows = views.map(
    task =>
      `${task.id} | ${task.status} | ${task.schedule} | next: ${task.nextRunAt ?? 'unknown'} | ${truncate(task.prompt, 70)}`,
  )
  return { type: 'text' as const, value: `${bold('Scheduled Tasks')}\n\n${rows.join('\n')}` }
}

async function showTask(parsed: ParsedArgs) {
  const id = parsed.positional[0]
  if (!id) return { type: 'text' as const, value: 'Usage: /cron show <id> [--json]' }

  const task = await findTask(id)
  if (!task) return { type: 'text' as const, value: `ERROR Task not found: ${id}` }

  const view = taskToView(task)
  if (parsed.flags.has('json')) {
    return { type: 'text' as const, value: jsonStringify(view, null, 2) }
  }

  return {
    type: 'text' as const,
    value: [
      `${bold('Scheduled Task')} ${view.id}`,
      `Status: ${view.status}`,
      `Schedule: ${view.schedule} (${view.cron})`,
      `Next run: ${view.nextRunAt ?? 'unknown'}`,
      `Durable: ${view.durable ? 'yes' : 'no (session-only)'}`,
      `Prompt: ${view.prompt}`,
    ].join('\n'),
  }
}

async function runTask(parsed: ParsedArgs) {
  const id = parsed.positional[0]
  if (!id) return { type: 'text' as const, value: 'Usage: /cron run <id>' }

  const task = await findTask(id)
  if (!task) return { type: 'text' as const, value: `ERROR Task not found: ${id}` }

  enqueuePendingNotification({
    value: task.prompt,
    mode: 'prompt',
    priority: 'next',
    isMeta: true,
    workload: WORKLOAD_CRON,
  })

  return {
    type: 'text' as const,
    value: `SUCCESS Task queued for manual run (ID: ${task.id})`,
  }
}

async function removeTask(parsed: ParsedArgs) {
  const id = parsed.positional[0]
  if (!id) return { type: 'text' as const, value: 'Usage: /cron remove <id>' }

  const task = await findTask(id)
  if (!task) return { type: 'text' as const, value: `ERROR Task not found: ${id}` }

  await removeCronTasks([task.id])
  return { type: 'text' as const, value: `SUCCESS Task removed: ${task.id}` }
}

async function clearTasks() {
  const tasks = await listAllCronTasks()
  if (tasks.length === 0) {
    return { type: 'text' as const, value: 'No recurring tasks scheduled.' }
  }

  await removeCronTasks(tasks.map(task => task.id))
  return { type: 'text' as const, value: `SUCCESS Removed ${tasks.length} scheduled task(s).` }
}

async function findTask(idOrPrefix: string): Promise<CronTask | undefined> {
  const tasks = await listAllCronTasks()
  return (
    tasks.find(task => task.id === idOrPrefix) ??
    tasks.find(task => task.id.startsWith(idOrPrefix))
  )
}

function taskToView(task: CronTask): CronView {
  const nextRunMs = nextCronRunMs(task.cron, Date.now())
  return {
    id: task.id,
    cron: task.cron,
    schedule: cronToHuman(task.cron),
    prompt: task.prompt,
    status: 'idle',
    recurring: task.recurring === true,
    durable: task.durable !== false,
    nextRunAt: nextRunMs ? new Date(nextRunMs).toISOString() : null,
    createdAt: new Date(task.createdAt).toISOString(),
  }
}

function parseArgs(args: string): ParsedArgs {
  const tokens = tokenize(args)
  const action = (tokens.shift() ?? '').toLowerCase()
  const positional: string[] = []
  const flags = new Set<string>()
  const options = new Map<string, string>()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const eq = token.indexOf('=')
    const key = token.slice(2, eq === -1 ? undefined : eq)
    if (eq !== -1) {
      options.set(key, token.slice(eq + 1))
      continue
    }

    const next = tokens[i + 1]
    if (next && !next.startsWith('--')) {
      options.set(key, next)
      i++
    } else {
      flags.add(key)
    }
  }

  return { action, positional, flags, options }
}

function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (current) tokens.push(current)
  return tokens
}

function parsePrompt(parsed: ParsedArgs): string {
  return (
    parsed.options.get('prompt') ??
    parsed.options.get('system-event') ??
    parsed.positional.join(' ')
  ).trim()
}

function parseSchedule(
  parsed: ParsedArgs,
): { ok: true; value: string } | { ok: false; error: string } {
  const explicitCron = parsed.options.get('cron')
  if (explicitCron) {
    return parseCronExpression(explicitCron)
      ? { ok: true, value: explicitCron }
      : { ok: false, error: `ERROR Invalid cron expression: ${explicitCron}` }
  }

  const interval = parsed.options.get('interval')
  if (!interval) return { ok: true, value: DEFAULT_CRON }

  const cron = intervalToCron(interval)
  return cron
    ? { ok: true, value: cron }
    : {
        ok: false,
        error: `ERROR Unsupported interval "${interval}". Use Nm or Nh, for example 15m or 2h.`,
      }
}

function intervalToCron(interval: string): string | null {
  const match = interval.trim().match(/^(\d+)([mh])$/i)
  if (!match) return null

  const amount = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toLowerCase()
  if (!Number.isInteger(amount) || amount < 1) return null

  if (unit === 'm') {
    if (amount > 59) return null
    return amount === 1 ? '* * * * *' : `*/${amount} * * * *`
  }

  if (amount > 23) return null
  return amount === 1 ? '0 * * * *' : `0 */${amount} * * *`
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

function usage(): string {
  return [
    'DuckHive Cron Manager',
    '',
    'Commands:',
    '  /cron add "<prompt>" [--interval 30m | --cron "*/30 * * * *"]',
    '  /cron list [--json]',
    '  /cron show <id> [--json]',
    '  /cron run <id>',
    '  /cron remove <id>',
    '  /cron clear',
  ].join('\n')
}
