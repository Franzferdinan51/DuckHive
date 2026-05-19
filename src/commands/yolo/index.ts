import type { Command } from '../../commands.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'
import { isYoloModeEnabled } from './yolo.js'

const yolo = {
  type: 'local' as const,
  name: 'yolo',
  aliases: ['bypass', 'perm'] as const,
  description: 'Toggle yolo/permission bypass mode (auto-approve all tool calls)',
  supportsNonInteractive: true,
  isEnabled: () => true,
  argumentHint: '[on|off|toggle]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./yolo.tsx' as any) as any,
} as Command

export default yolo