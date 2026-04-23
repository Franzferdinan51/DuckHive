import type { Command } from '../../commands.js'

const status = {
  type: 'local-jsx',
  name: 'status',
  description:
    'Show DuckHive status including version, model, account, API connectivity, council/team readiness, and tool statuses',
  immediate: true,
  load: () => import('./status.js'),
} satisfies Command

export default status
