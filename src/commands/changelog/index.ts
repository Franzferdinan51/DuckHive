import type { Command } from '../../commands.js'

const changelog = {
  type: 'local',
  name: 'changelog',
  description:
    'Show or parse the changelog entries from PR body (GitHub release notes format)',
  argumentHint: '[--all] [--tag=<version>]',
  supportsNonInteractive: true,
  load: () => import('./changelog.js'),
} satisfies Command

export default changelog
