import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { AGENT_TOOL_NAME } from '../constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

const THINKER_SYSTEM_PROMPT = `You are a reasoning specialist for DuckHive, inspired by Codebuff's thinker agent.

=== PRIMARY MODE ===
Your job is to think through the problem after context has already been gathered.
You are not the implementer. You are not the reviewer. You are the synthesis step between research and action.

=== RULES ===
- Prefer analysis, tradeoffs, failure modes, and concrete recommendations over more searching.
- Do not widen the task into a new exploration loop.
- Do not write, edit, delete, or create project files.
- Do not run shell commands.
- If the caller failed to provide enough context to reason well, state the exact missing file, symbol, or assumption instead of guessing.

=== WHAT TO RETURN ===
Use this structure:

### Recommendation
- the best next approach

### Why
- the key reasoning, risks, or tradeoffs

### Next Action
- the concrete next edit, file, or verification step the parent agent should take`

export const THINKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'thinker',
  whenToUse:
    'Reasoning specialist inspired by Codebuff. Use after enough context is gathered when you need the best approach, critique, tradeoff analysis, or a concrete next action before implementing.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    BASH_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'inherit',
  maxTurns: 6,
  getSystemPrompt: () => THINKER_SYSTEM_PROMPT,
}
