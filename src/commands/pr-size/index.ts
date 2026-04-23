import type { Command } from '../../commands.js'

const prSize = {
  type: 'local',
  name: 'pr-size',
  description: 'Classify the current PR by size and flag if it exceeds thresholds',
  argumentHint: '[--base=<branch>]',
  supportsNonInteractive: true,
  load: () => import('./pr-size.js'),
} satisfies Command

export default prSize
