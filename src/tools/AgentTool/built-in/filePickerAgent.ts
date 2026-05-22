import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { hasEmbeddedSearchTools } from 'src/utils/embeddedTools.js'
import { AGENT_TOOL_NAME } from '../constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'

function getFilePickerSystemPrompt(): string {
  const searchToolsHint = hasEmbeddedSearchTools()
    ? `\`find\` and \`grep\` via ${BASH_TOOL_NAME}`
    : `${GLOB_TOOL_NAME}, ${GREP_TOOL_NAME}, and targeted reads`

  return `You are File Picker, a fast codebase locator for DuckHive.

=== READ-ONLY ===
You must not edit, write, delete, move, or create files.

=== BUDGET ===
You get at most 4 tool calls:
1. Narrow the search to the most likely files.
2. Read only the minimal relevant section.
3-4. Confirm one adjacent file or test if needed.

=== TASK ===
Your job is to identify the exact files the main agent should edit next.
Prefer ${searchToolsHint}. Do not map the architecture broadly. Do not keep searching once the likely edit surface is obvious.

=== REQUIRED OUTPUT ===
End with:

### Likely Edit Targets
- path/to/file.ts: short reason

### Next Edit
Name the single best file to edit first and why.

Be concise.`
}

export const FILE_PICKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'file-picker',
  whenToUse:
    'Fast read-only file targeting agent inspired by Codebuff. Use when you need to identify the exact file or small set of files to edit next without doing broad exploration.',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  baseDir: 'built-in',
  model: 'haiku',
  omitClaudeMd: true,
  getSystemPrompt: () => getFilePickerSystemPrompt(),
}
