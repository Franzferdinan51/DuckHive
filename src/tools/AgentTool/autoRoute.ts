import type { AgentDefinition } from './loadAgentsDir.js'
import {
  CODE_REVIEWER_AGENT_TYPE,
  EDITOR_AGENT_TYPE,
  FILE_PICKER_AGENT_TYPE,
  VERIFICATION_AGENT_TYPE,
} from './constants.js'

const IMPLEMENTATION_SIGNAL = /\b(implement|implementation|fix|edit|change|update|patch|modify|refactor|wire|integrate|add|remove)\b/i
const RESEARCH_SIGNAL = /\b(find|search|explore|investigate|understand|analyze|locate|where|read|review|verify|test|plan|think)\b/i
const FILE_HINT_SIGNAL = /(?:[A-Za-z]:\\|\/|\\)[^\s'"]+\.[A-Za-z0-9]+|`[^`\n]+\.[A-Za-z0-9]+`|\b[a-z0-9_\-.\/\\]+\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|json|yaml|yml|md|toml|sh)\b/i
const KNOWN_TARGET_SIGNAL = /\b(target file|target files|first target file|named file|named files|apply the plan|apply its findings|make the change|write the code|implement the change)\b/i
const FILE_PICKER_SIGNAL = /\b(find|locate|identify|which file|what file|next file|relevant files|likely files|target file|target files)\b/i
const REVIEW_SIGNAL = /\b(review|reviewer|audit|second opinion|look for bugs|regression|code review|critical read)\b/i
const VERIFICATION_SIGNAL = /\b(verify|verification|validate|prove|confirm|spot-check|adversarial|e2e|end-to-end|test the change|independent verification)\b/i

function hasAgentType(agents: AgentDefinition[], agentType: string): boolean {
  return agents.some(agent => agent.agentType === agentType)
}

function shouldAutoRouteToFilePicker(
  prompt: string,
  description: string,
  agents: AgentDefinition[],
): boolean {
  if (!hasAgentType(agents, FILE_PICKER_AGENT_TYPE)) {
    return false
  }
  const combined = `${description}\n${prompt}`
  return FILE_PICKER_SIGNAL.test(combined) && !FILE_HINT_SIGNAL.test(combined)
}

function shouldAutoRouteToCodeReviewer(
  prompt: string,
  description: string,
  agents: AgentDefinition[],
): boolean {
  if (!hasAgentType(agents, CODE_REVIEWER_AGENT_TYPE)) {
    return false
  }
  const combined = `${description}\n${prompt}`
  return REVIEW_SIGNAL.test(combined) && !VERIFICATION_SIGNAL.test(combined)
}

function shouldAutoRouteToVerification(
  prompt: string,
  description: string,
  agents: AgentDefinition[],
): boolean {
  if (!hasAgentType(agents, VERIFICATION_AGENT_TYPE)) {
    return false
  }
  const combined = `${description}\n${prompt}`
  return VERIFICATION_SIGNAL.test(combined)
}

export function isKnownTargetImplementationPrompt(text: string): boolean {
  if (!IMPLEMENTATION_SIGNAL.test(text)) {
    return false
  }
  return FILE_HINT_SIGNAL.test(text) || KNOWN_TARGET_SIGNAL.test(text)
}

export function isVerificationLikePrompt(text: string): boolean {
  return VERIFICATION_SIGNAL.test(text)
}

function shouldAutoRouteToEditor(
  prompt: string,
  description: string,
  agents: AgentDefinition[],
): boolean {
  if (!hasAgentType(agents, EDITOR_AGENT_TYPE)) {
    return false
  }
  const combined = `${description}\n${prompt}`
  if (!IMPLEMENTATION_SIGNAL.test(combined)) {
    return false
  }
  // Route to editor whenever implementation work has a known target —
  // no longer requires implementation signals to outnumber research signals.
  // If we know WHAT to change (file hint or known target) and we're asked
  // to implement something, the editor is the right agent.
  const hasKnownTargetHint =
    FILE_HINT_SIGNAL.test(combined) || KNOWN_TARGET_SIGNAL.test(combined)
  if (hasKnownTargetHint) {
    return true
  }
  // Fallback: route to editor even without explicit file hints if the
  // implementation signal is stronger than research.
  const researchMatches = combined.match(RESEARCH_SIGNAL) ?? []
  const implementationMatches = combined.match(IMPLEMENTATION_SIGNAL) ?? []
  return implementationMatches.length >= researchMatches.length
}

export function resolveAutoRoutedAgentType(
  prompt: string,
  description: string,
  agents: AgentDefinition[],
): string | null {
  if (shouldAutoRouteToVerification(prompt, description, agents)) {
    return VERIFICATION_AGENT_TYPE
  }
  if (shouldAutoRouteToCodeReviewer(prompt, description, agents)) {
    return CODE_REVIEWER_AGENT_TYPE
  }
  if (shouldAutoRouteToFilePicker(prompt, description, agents)) {
    return FILE_PICKER_AGENT_TYPE
  }
  if (shouldAutoRouteToEditor(prompt, description, agents)) {
    return EDITOR_AGENT_TYPE
  }
  return null
}
