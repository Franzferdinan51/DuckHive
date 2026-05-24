import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import {
  buildSessionMemoryUpdatePrompt,
  DEFAULT_SESSION_MEMORY_TEMPLATE,
  SESSION_MEMORY_TEMPLATE_VERSION,
} from './prompts.js'

describe('SessionMemory prompts', () => {
  afterEach(() => {
    setClaudeConfigHomeDirForTesting(undefined)
  })

  test('default session memory template is versioned for dense summary regeneration', () => {
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE.startsWith(`${SESSION_MEMORY_TEMPLATE_VERSION}\n`)).toBe(true)
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).toContain(
      'dense routing index for future agents',
    )
    expect(DEFAULT_SESSION_MEMORY_TEMPLATE).toContain(
      'Newest useful steps only',
    )
  })

  test('update prompt preserves the version line and requests dense routing handles', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'duckhive-session-memory-prompt-'))
    try {
      setClaudeConfigHomeDirForTesting(configDir)

      const prompt = await buildSessionMemoryUpdatePrompt(
        DEFAULT_SESSION_MEMORY_TEMPLATE,
        join(configDir, 'session-memory.md'),
      )

      expect(prompt).toContain(`The first line must be exactly "${SESSION_MEMORY_TEMPLATE_VERSION}"`)
      expect(prompt).toContain('Prefer compact routing handles over long prose')
      expect(prompt).toContain('Keep the notes current, not archival')
      expect(prompt).toContain(
        'remove that issue from "Current State" and pending work',
      )
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })

  test('over-budget reminders enforce the lower dense-memory budget', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'duckhive-session-memory-budget-'))
    try {
      setClaudeConfigHomeDirForTesting(configDir)
      const oversizedCurrentState = 'dense detail '.repeat(26_000)
      const currentNotes = DEFAULT_SESSION_MEMORY_TEMPLATE.replace(
        '# Current State\n_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._',
        `# Current State\n_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._\n${oversizedCurrentState}`,
      )

      const prompt = await buildSessionMemoryUpdatePrompt(
        currentNotes,
        join(configDir, 'session-memory.md'),
      )

      expect(prompt).toContain('exceeds the maximum of 6000 tokens')
      expect(prompt).toContain('dense routing/index layer')
      expect(prompt).toContain(`Keep the first line exactly "${SESSION_MEMORY_TEMPLATE_VERSION}"`)
    } finally {
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
