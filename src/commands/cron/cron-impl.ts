/**
 * DuckHive Cron Manager — inspired by OpenClaw 'triggers'.
 * Manages session-level recurring prompts.
 */
import type { LocalCommandCall } from '../../types/command.js'
import { bold } from '../../components/styles.js'
import { addSessionCronTask, getSessionCronTasks, removeSessionCronTasks } from '../../bootstrap/state.js'

export const call: LocalCommandCall = async (args: string) => {
  const parts = args.split(' ')
  const action = parts[0]?.toLowerCase()

  switch (action) {
    case 'add': {
      const prompt = args.match(/"([^"]+)"/)?.[1] ?? args.slice(action.length).trim()
      if (!prompt) return { type: 'text', value: 'Usage: /cron add "<prompt>" [--interval 30m]' }

      const id = `cron-${Date.now()}`
      addSessionCronTask({
        id,
        cron: '*/30 * * * *', // Default to 30m
        prompt,
        createdAt: Date.now(),
        recurring: true,
      })
      return { type: 'text', value: `SUCCESS Recurring task added (ID: ${id})` }
    }

    case 'list':
    case 'ls': {
      const tasks = getSessionCronTasks()
      if (tasks.length === 0) return { type: 'text', value: 'No recurring tasks scheduled.' }

      let output = `${bold('Scheduled Tasks')}\n\n`
      for (const task of tasks) {
        output += `${task.id} | ${task.cron} | ${task.prompt.substring(0, 50)}${task.prompt.length > 50 ? '...' : ''}\n`
      }
      return { type: 'text', value: output }
    }

    case 'remove':
    case 'rm': {
      const id = parts[1]
      if (!id) return { type: 'text', value: 'Usage: /cron remove <id>' }
      const count = removeSessionCronTasks([id])
      return {
        type: 'text',
        value: count > 0 ? 'SUCCESS Task removed.' : 'ERROR Task not found.'
      }
    }

    default:
      return {
        type: 'text',
        value: `DuckHive Cron Manager\n\nCommands:\n  /cron add "<prompt>"  - Add a new recurring prompt\n  /cron list             - List all scheduled tasks\n  /cron remove <id>      - Remove a task`,
      }
  }
}
