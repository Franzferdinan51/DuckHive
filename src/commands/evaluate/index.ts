import type { Command } from '../../commands.js'

const evaluate: Command = {
  name: 'evaluate',
  description: 'Run automated evaluations on the agent to catch regressions',
  type: 'local',
  supportsNonInteractive: true,
  load: () => import('./evaluate-impl.js'),
}

export default evaluate
