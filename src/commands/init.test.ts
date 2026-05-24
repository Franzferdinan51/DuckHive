import { afterEach, expect, mock, test } from 'bun:test'

const originalClaudeCodeNewInit = process.env.CLAUDE_CODE_NEW_INIT

async function importInitCommand() {
  return (await import(`./init.ts?ts=${Date.now()}-${Math.random()}`)).default
}

afterEach(() => {
  mock.restore()

  if (originalClaudeCodeNewInit === undefined) {
    delete process.env.CLAUDE_CODE_NEW_INIT
  } else {
    process.env.CLAUDE_CODE_NEW_INIT = originalClaudeCodeNewInit
  }
})

test('NEW_INIT prompt preserves existing root CLAUDE.md by default', async () => {
  process.env.CLAUDE_CODE_NEW_INIT = '1'

  mock.module('../projectOnboardingState.js', () => ({
    maybeMarkProjectOnboardingComplete: () => {},
  }))
  mock.module('./initMode.js', () => ({
    isNewInitEnabled: () => true,
  }))

  const command = await importInitCommand()
  const blocks = await command.getPromptForCommand()

  expect(blocks).toHaveLength(1)
  expect(blocks[0]?.type).toBe('text')
  expect(String(blocks[0]?.text)).toContain(
    'checked-in root `CLAUDE.md` and does NOT already have a root `AGENTS.md`',
  )
  expect(String(blocks[0]?.text)).toContain(
    'do NOT silently create a second root instruction file',
  )
  expect(String(blocks[0]?.text)).toContain(
    'update the existing root `CLAUDE.md` in place by default',
  )
})

test('NEW_INIT prompt uses DuckHive branding for generated guidance', async () => {
  process.env.CLAUDE_CODE_NEW_INIT = '1'

  mock.module('../projectOnboardingState.js', () => ({
    maybeMarkProjectOnboardingComplete: () => {},
  }))
  mock.module('./initMode.js', () => ({
    isNewInitEnabled: () => true,
  }))

  const command = await importInitCommand()
  const blocks = await command.getPromptForCommand()
  const prompt = String(blocks[0]?.text)

  expect(prompt).toContain('loaded into every DuckHive session')
  expect(prompt).toContain('DUCK.md system-instruction files')
  expect(prompt).toContain('/instruct')
  expect(prompt).toContain(
    'This file provides guidance to DuckHive when working with code in this repository.',
  )
  expect(prompt).not.toContain('Claude Code')
  expect(prompt).not.toContain('claude.ai/code')
})

test('legacy init prompt uses DuckHive branding', async () => {
  delete process.env.CLAUDE_CODE_NEW_INIT

  mock.module('../projectOnboardingState.js', () => ({
    maybeMarkProjectOnboardingComplete: () => {},
  }))
  mock.module('./initMode.js', () => ({
    isNewInitEnabled: () => false,
  }))

  const command = await importInitCommand()
  const blocks = await command.getPromptForCommand()
  const prompt = String(blocks[0]?.text)

  expect(prompt).toContain('future instances of DuckHive')
  expect(prompt).toContain(
    'This file provides guidance to DuckHive when working with code in this repository.',
  )
  expect(prompt).not.toContain('Claude Code')
  expect(prompt).not.toContain('claude.ai/code')
})
