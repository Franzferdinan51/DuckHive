// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { HiveBridge } from '../../services/hive-bridge/hive-bridge.js'
import { DESCRIPTION } from './prompt.js'

const hive = new HiveBridge()

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['list', 'issue', 'show', 'parties']).describe('Senate action'),
    decreeId: z.string().optional().describe('Decree ID'),
    title: z.string().optional().describe('Decree title'),
    content: z.string().optional().describe('Decree content'),
    authority: z.string().optional().describe('Issuing authority'),
    scope: z.enum(['universal', 'agent', 'session', 'project']).optional().describe('Scope'),
    priority: z.enum(['high', 'medium', 'low']).optional().describe('Priority'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    decrees: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), priority: z.string(), votes: z.object({ yeas: z.number(), nays: z.number() }) })).optional(),
    decreeId: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const HiveSenateTool = buildTool({
  name: 'hive_senate',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return true },
  isReadOnly(input) { return input.action === 'list' || input.action === 'show' },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    }
  },
  async call(input, context, canUseTool, parentMessage) {
    const { action, decreeId, title, content, authority, scope, priority } = input

    switch (action) {
      case 'list': {
        const decrees = await hive.getActiveDecrees()
        return { data: { success: true, action: 'list', decrees: decrees.map(d => ({ id: d.id, title: d.title, status: d.status, priority: d.priority, votes: { yeas: 0, nays: 0 } })) } }
      }
      case 'issue': {
        if (!title || !content) return { data: { success: false, action: 'issue', error: 'title and content required' } }
        const result = await hive.issueDecree(title, content, authority ?? 'openclaude', scope ?? 'agent', priority ?? 'medium')
        return { data: { success: result.success, action: 'issue', decreeId: result.decreeId, error: result.error } }
      }
      case 'show': {
        if (!decreeId) return { data: { success: false, action: 'show', error: 'decreeId required' } }
        const decree = await hive.getDecree(decreeId)
        return { data: { success: !!decree, action: 'show', decree: decree ? { id: decree.id, title: decree.title, status: decree.status } : undefined } }
      }
      case 'parties':
        return { data: { success: true, action: 'parties', decrees: [{ id: 'hawks', title: 'Hawks Party', status: 'active', priority: 'high', votes: { yeas: 0, nays: 0 } }, { id: 'doves', title: 'Doves Party', status: 'active', priority: 'high', votes: { yeas: 0, nays: 0 } }, { id: 'centrists', title: 'Centrists Party', status: 'active', priority: 'high', votes: { yeas: 0, nays: 0 } }] } }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
