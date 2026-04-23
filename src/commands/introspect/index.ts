import type { Command } from '../../commands.js'

const INTROSPECT_PROMPT = `You are an introspection agent. Your goal is to analyze which system instructions influenced a specific behavior or decision.

**Specific point of interest:** {{args}}

Please provide a detailed breakdown of:
1. Which parts of your system instructions (global, workspace-specific, or provided via DUCK.md) influenced this behavior?
2. What was your internal thought process leading up to this action?
3. Are there any ambiguities or conflicting instructions that played a role?

Your goal is to provide transparency into your underlying logic so the user can potentially improve the instructions in the future.

Be specific and reference actual files or instruction sections when possible.`

export default {
  type: 'prompt',
  name: 'introspect',
  description: 'Analyze which system instructions influenced a specific action or decision',
  contentLength: 0,
  progressMessage: 'introspecting on system instructions',
  source: 'builtin',
  async getPromptForCommand() {
    return [
      {
        type: 'text',
        text: INTROSPECT_PROMPT,
      },
    ]
  },
} satisfies Command