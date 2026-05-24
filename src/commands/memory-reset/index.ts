import type { Command } from '../../commands.js'

const memoryReset: Command = {
  type: 'local',
  name: 'memory-reset',
  description: 'Clear all past memories and reset to default',
  supportsNonInteractive: true,
  load: () => import('./memory-reset.js'),
}

export default memoryReset
