import type { Command } from '../../commands.js'

const acpCommand = {
  type: 'local' as const,
  name: 'acp',
  description: 'Start ACP (Agent Client Protocol) server for IDE integrations',
  aliases: ['acp-server', 'acp-listen'],
  supportsNonInteractive: true,
  load: () => import('./acp-impl.js'),
} satisfies Command

export default acpCommand
