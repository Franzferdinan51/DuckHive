import { afterEach, expect, test } from 'bun:test'

// MACRO is replaced at build time by Bun.define but not in test mode.
// Define it globally so tests that import modules using MACRO don't crash.
;(globalThis as Record<string, unknown>).MACRO = {
  VERSION: '99.0.0',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: new Date().toISOString(),
  ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
  PACKAGE_URL: '@gitlawb/openclaude',
  NATIVE_PACKAGE_URL: undefined,
}

import { getSystemPrompt, DEFAULT_AGENT_PROMPT } from './prompts.js'
import { CLI_SYSPROMPT_PREFIXES, getCLISyspromptPrefix } from './system.js'
import { CLAUDE_CODE_GUIDE_AGENT } from '../tools/AgentTool/built-in/claudeCodeGuideAgent.js'
import { GENERAL_PURPOSE_AGENT } from '../tools/AgentTool/built-in/generalPurposeAgent.js'
import { EXPLORE_AGENT } from '../tools/AgentTool/built-in/exploreAgent.js'
import { PLAN_AGENT } from '../tools/AgentTool/built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from '../tools/AgentTool/built-in/statuslineSetup.js'

const originalSimpleEnv = process.env.CLAUDE_CODE_SIMPLE

afterEach(() => {
  process.env.CLAUDE_CODE_SIMPLE = originalSimpleEnv
})

test('CLI identity prefixes describe DuckHive instead of Claude Code', () => {
  expect(getCLISyspromptPrefix()).toContain('DuckHive')
  expect(getCLISyspromptPrefix()).not.toContain('Claude Code')
  expect(getCLISyspromptPrefix()).not.toContain("Anthropic's official CLI for Claude")

  for (const prefix of CLI_SYSPROMPT_PREFIXES) {
    expect(prefix).toContain('DuckHive')
    expect(prefix).not.toContain('Claude Code')
    expect(prefix).not.toContain("Anthropic's official CLI for Claude")
  }
})

test('simple mode identity describes DuckHive instead of Claude Code', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'

  const prompt = await getSystemPrompt([], 'gpt-4o')

  expect(prompt[0]).toContain('DuckHive')
  expect(prompt[0]).not.toContain('Claude Code')
  expect(prompt[0]).not.toContain("Anthropic's official CLI for Claude")
})

test('normal system prompt encourages useful agent-team and council surfaces', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE

  const prompt = await getSystemPrompt([], 'gpt-4o')
  const combined = prompt.join('\n')

  expect(combined).toContain('Use subagents to parallelize independent work')
  expect(combined).toContain('prefer that native surface for ordinary subagents')
  expect(combined).toContain('DuckHive /spawn, Agent Tool, or team surfaces')
  expect(combined).toContain('/council to consult multiple agents')
  expect(combined).toContain('/team to coordinate multi-agent workflows')
  expect(combined).toContain('/spawn for background tasks')
  expect(combined).toContain('/skills to find specialized capabilities')
})

test('search grounding is configured via WebSearchTool providers, not a static prompt section', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE

  const prompt = await getSystemPrompt([], 'gpt-4o')
  const combined = prompt.join('\n')

  // SEARCH GROUNDING was removed from the static prompt; search is now
  // configured dynamically via WebSearchTool providers and /search-provider
  expect(combined).not.toContain('google_web_search')
})

test('built-in agent prompts describe DuckHive instead of Claude Code', () => {
  expect(DEFAULT_AGENT_PROMPT).toContain('DuckHive')
  expect(DEFAULT_AGENT_PROMPT).toContain('Use subagents to parallelize independent work')
  expect(DEFAULT_AGENT_PROMPT).toContain('prefer native subagent/spawn surfaces')
  expect(DEFAULT_AGENT_PROMPT).toContain('/council')
  expect(DEFAULT_AGENT_PROMPT).toContain('/spawn')
  expect(DEFAULT_AGENT_PROMPT).not.toContain('Claude Code')
  expect(DEFAULT_AGENT_PROMPT).not.toContain("Anthropic's official CLI for Claude")

  const generalPrompt = GENERAL_PURPOSE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(generalPrompt).toContain('DuckHive')
  expect(generalPrompt).not.toContain('Claude Code')
  expect(generalPrompt).not.toContain("Anthropic's official CLI for Claude")

  const explorePrompt = EXPLORE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(explorePrompt).toContain('DuckHive')
  expect(explorePrompt).not.toContain('Claude Code')
  expect(explorePrompt).not.toContain("Anthropic's official CLI for Claude")

  const planPrompt = PLAN_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(planPrompt).toContain('DuckHive')
  expect(planPrompt).not.toContain('Claude Code')

  const statuslinePrompt = STATUSLINE_SETUP_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(statuslinePrompt).toContain('DuckHive')
  expect(statuslinePrompt).not.toContain('Claude Code')

  const guidePrompt = CLAUDE_CODE_GUIDE_AGENT.getSystemPrompt({
    toolUseContext: {
      options: {
        commands: [],
        agentDefinitions: { activeAgents: [] },
        mcpClients: [],
      } as never,
    },
  })
  expect(guidePrompt).toContain('DuckHive')
  expect(guidePrompt).toContain('You are the DuckHive guide agent.')
  expect(guidePrompt).toContain('**DuckHive** (the CLI tool)')
  expect(guidePrompt).not.toContain('You are the Claude guide agent.')
  expect(guidePrompt).not.toContain('**Claude Code** (the CLI tool)')
})
