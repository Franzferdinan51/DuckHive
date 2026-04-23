import type { Command } from '../../commands.js'

const PROMPT_SUGGEST_PROMPT = `# Prompt Engineering Analysis

You are a world-class prompt engineer and an expert AI coding tool engineer. Your goal is to analyze a specific agent behavior or failure and suggest high-level improvements to the system instructions.

**Observed Behavior / Issue:**
{{args}}

### Task
1. **Analyze the Failure:** Review the provided behavior and identify the underlying instructional causes.
2. **Strategic Insights:** Focus on the "why" and identify any instructional inertia or ambiguity.
3. **Propose Improvements:** Suggest high-level changes to the system instructions to prevent this behavior.

### Principles
- **Avoid Hyper-scoping:** Do not create narrow solutions for specific scenarios; aim for generalized improvements that handle classes of behavior.
- **Avoid Specific Examples in Suggestions:** Keep the proposed instructions semantic and high-level to prevent the agent from over-indexing on specific cases.
- **Maintain Operational Rigor:** Ensure suggestions do not compromise safety, security, or the quality of the agent's work.
- **Consider Context Loading:** Think about how DUCK.md files at global/workspace/per-directory levels affect the behavior.
- **Tool Calling Impact:** Consider how tool definitions and permissions influence the behavior.`

export default {
  type: 'prompt',
  name: 'prompt-suggest',
  description: 'Analyze agent behavior and suggest high-level improvements to system prompts',
  contentLength: 0,
  progressMessage: 'analyzing prompt engineering',
  source: 'builtin',
  async getPromptForCommand() {
    return [
      {
        type: 'text',
        text: PROMPT_SUGGEST_PROMPT,
      },
    ]
  },
} satisfies Command