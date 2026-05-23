export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const CODE_REVIEWER_AGENT_TYPE = 'code-reviewer'
export const EDITOR_AGENT_TYPE = 'editor'
export const FILE_PICKER_AGENT_TYPE = 'file-picker'
export const THINKER_AGENT_TYPE = 'thinker'
export const VERIFICATION_AGENT_TYPE = 'verification'

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
  FILE_PICKER_AGENT_TYPE,
  THINKER_AGENT_TYPE,
  CODE_REVIEWER_AGENT_TYPE,
])
