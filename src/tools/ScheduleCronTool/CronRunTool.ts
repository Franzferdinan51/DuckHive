// OpenClaw feature: cron run — immediately fire a scheduled job on demand.
// This allows "check this now" without waiting for the next cron schedule.
import { z } from 'zod/v4'
import type { ValidationResult } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getScheduledPrompt } from '../../bootstrap/state.js'
import { getCronFilePath, listAllCronTasks } from '../../utils/cronTasks.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getTeammateContext } from '../../utils/teammateContext.js'
import { CRON_RUN_DESCRIPTION, CRON_RUN_TOOL_NAME } from './prompt.js'
import { renderRunResultMessage, renderRunToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    id: z.string().describe('Job ID returned by CronCreate.'),
    /** Override the scheduled prompt with a custom one for this run only. */
    prompt: z.string().optional().describe(
      'Optional: override the scheduled prompt with a custom one for this run only.',
    ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    prompt: z.string(),
    firedAt: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type RunOutput = z.infer<OutputSchema>

export const CronRunTool = buildTool({
  name: CRON_RUN_TOOL_NAME,
  searchHint: 'run a scheduled cron job immediately',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return input.id
  },
  async description() {
    return CRON_RUN_DESCRIPTION
  },
  async prompt() {
    return `## CronRun — Fire a scheduled job immediately

Use CronRun when the user wants to trigger a scheduled job right now instead of waiting for its next cron firing.

The tool fires the job's prompt into the session immediately (as if the scheduler had ticked), then returns control. It does NOT modify the original schedule — the job fires again at its next cron time.

- \`id\` (required): The job ID returned by CronCreate.
- \`prompt\` (optional): Override the scheduled prompt with a custom one for this run only. The original prompt is unchanged for future runs.`
  },
  getPath() {
    return getCronFilePath()
  },
  async validateInput(input): Promise<ValidationResult> {
    // Check session tasks first
    const sessionTasks = getScheduledPrompt()
    const sessionTask = sessionTasks.find(t => t.id === input.id)
    if (sessionTask) {
      return { result: true }
    }

    // Check durable tasks
    const tasks = await listAllCronTasks()
    const task = tasks.find(t => t.id === input.id)
    if (!task) {
      return {
        result: false,
        message: `No scheduled job with id '${input.id}'`,
        errorCode: 1,
      }
    }
    // Teammates may only run their own crons.
    const ctx = getTeammateContext()
    if (ctx && task.agentId !== ctx.agentId) {
      return {
        result: false,
        message: `Cannot run cron job '${input.id}': owned by another agent`,
        errorCode: 2,
      }
    }
    return { result: true }
  },
  async call({ id, prompt }) {
    // Try session tasks first
    const sessionTasks = getScheduledPrompt()
    const sessionTask = sessionTasks.find(t => t.id === id)

    const task = sessionTask ?? (await listAllCronTasks()).find(t => t.id === id)
    if (!task) {
      throw new Error(`Cron job '${id}' not found`)
    }

    // Return the prompt to be fired (the scheduler will pick it up via the normal flow)
    // For immediate execution, we return the prompt directly
    const firedAt = Date.now()
    return {
      data: {
        id,
        prompt: prompt ?? task.prompt,
        firedAt,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Fired job ${output.id} immediately (scheduled prompt: "${output.prompt.slice(0, 50)}${output.prompt.length > 50 ? '...' : ''}")`,
    }
  },
  renderToolUseMessage: renderRunToolUseMessage,
  renderToolResultMessage: renderRunResultMessage,
} satisfies ToolDef<InputSchema, RunOutput>)
