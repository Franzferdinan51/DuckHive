// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { HiveBridge } from '../../services/hive-bridge/hive-bridge.js'
import { DESCRIPTION } from './prompt.js'

const hive = new HiveBridge()

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['deliberate', 'status', 'modes', 'councilors']).describe('Council action'),
    topic: z.string().optional().describe('Topic for deliberation'),
    mode: z.enum(['balanced', 'adversarial', 'consensus', 'brainstorm', 'swarm', 'devil-advocate', 'legislature', 'prediction', 'inspector']).optional().describe('Deliberation mode'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    sessionId: z.string().optional(),
    topic: z.string().optional(),
    mode: z.string().optional(),
    phase: z.string().optional(),
    votes: z.object({ yeas: z.number(), nays: z.number() }).optional(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).optional(),
    councilorCount: z.number().optional(),
    modes: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const HiveCouncilTool = buildTool({
  name: 'hive_council',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly() { return true },
  async call(input, context, canUseTool, parentMessage) {
    const { action, topic, mode } = input

    switch (action) {
      case 'deliberate': {
        if (!topic) return { data: { success: false, action: 'deliberate', error: 'topic required' } }
        const result = await hive.startDeliberation(topic, mode ?? 'balanced')
        return { data: { success: result.success, action: 'deliberate', sessionId: result.sessionId, topic, mode: mode ?? 'balanced', error: result.error } }
      }
      case 'status': {
        const session = await hive.getCurrentSession()
        if (!session || session.phase === 'idle') return { data: { success: true, action: 'status', phase: 'idle', councilorCount: 46 } }
        return { data: { success: true, action: 'status', sessionId: session.id, topic: session.topic, mode: session.mode, phase: session.phase, votes: { yeas: session.stats.yeas, nays: session.stats.nays }, councilorCount: 46 } }
      }
      case 'modes': {
        const modes = await hive.getModes()
        return { data: { success: true, action: 'modes', modes } }
      }
      case 'councilors': {
        const councilors = await hive.getCouncilors()
        return { data: { success: true, action: 'councilors', councilorCount: councilors.length } }
      }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
