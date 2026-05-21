import type { Command } from '../../commands.js'

const cron: Command = {
  name: 'cron',
  description: 'Schedule recurring tasks and prompts (OpenClaw-style)',
  type: 'local',
  supportsNonInteractive: true,
  load: () => import('./cron-impl.js'),
}

export default cron
