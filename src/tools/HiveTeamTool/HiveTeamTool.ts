// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { HiveBridge } from '../../services/hive-bridge/hive-bridge.js'
import { DESCRIPTION } from './prompt.js'

const hive = new HiveBridge()

const TEMPLATES = ['research', 'code', 'security', 'emergency', 'planning', 'analysis', 'devops', 'swarm'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['list', 'spawn', 'status', 'templates']).describe('Team action'),
    name: z.string().optional().describe('Team name'),
    template: z.enum(TEMPLATES).optional().describe('Team template'),
    teamId: z.string().optional().describe('Team ID'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    action: z.string(),
    teams: z.array(z.object({ id: z.string(), name: z.string(), template: z.string(), status: z.string() })).optional(),
    teamId: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const HiveTeamTool = buildTool({
  name: 'hive_team',
  async description() { return DESCRIPTION },
  async prompt() { return DESCRIPTION },
  get inputSchema(): InputSchema { return inputSchema() },
  get outputSchema(): OutputSchema { return outputSchema() },
  isConcurrencySafe() { return false },
  isReadOnly(input) { return input.action === 'list' || input.action === 'templates' },
  async call(input, context, canUseTool, parentMessage) {
    const { action, name, template, teamId } = input

    switch (action) {
      case 'list': {
        const teams = await hive.getActiveTeams()
        return { data: { success: true, action: 'list', teams: teams.map(t => ({ id: t.id, name: t.name, template: t.template, status: t.status })) } }
      }
      case 'spawn': {
        if (!name || !template) return { data: { success: false, action: 'spawn', error: 'name and template required' } }
        const result = await hive.spawnTeam(name, template)
        return { data: { success: result.success, action: 'spawn', teamId: result.teamId, error: result.error } }
      }
      case 'status': {
        if (!teamId) return { data: { success: false, action: 'status', error: 'teamId required' } }
        const teams = await hive.getActiveTeams()
        const team = teams.find(t => t.id === teamId)
        return { data: { success: !!team, action: 'status', teams: team ? [{ id: team.id, name: team.name, template: team.template, status: team.status }] : [] } }
      }
      case 'templates':
        return { data: { success: true, action: 'templates', teams: TEMPLATES.map(t => ({ id: t, name: t, template: t, status: 'available' })) } }
      default:
        return { data: { success: false, action, error: `Unknown action: ${action}` } }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
