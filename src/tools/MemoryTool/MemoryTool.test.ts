import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MemoryTool,
  getMemoryToolDir,
  setMemoryToolTestDeps,
} from './MemoryTool.ts'

let configHomeDir: string

describe('MemoryTool', () => {
  beforeEach(() => {
    configHomeDir = mkdtempSync(join(tmpdir(), 'duckhive-memory-tool-'))
    setMemoryToolTestDeps({ getClaudeConfigHomeDir: () => configHomeDir })
  })

  afterEach(() => {
    setMemoryToolTestDeps(null)
    rmSync(configHomeDir, { recursive: true, force: true })
  })

  test('uses DuckHive config home for memory storage', () => {
    expect(getMemoryToolDir()).toBe(join(configHomeDir, 'memory'))
  })

  test('supports remember, recall, search, stats, and forget', async () => {
    const remembered = await MemoryTool.call(
      {
        action: 'remember',
        content: 'User prefers Hermes-style memory reviews',
        type: 'preference',
        tags: ['memory', 'hermes'],
        importance: 8,
      },
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(remembered.data.success).toBe(true)
    expect(remembered.data.count).toBe(1)

    const recalled = await MemoryTool.call(
      { action: 'recall', limit: 5 },
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(recalled.data.memories).toHaveLength(1)
    const memoryId = recalled.data.memories?.[0]?.id
    expect(recalled.data.memories?.[0]?.content).toContain('Hermes-style')

    const searched = await MemoryTool.call(
      { action: 'search', query: 'hermes', limit: 5 },
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(searched.data.count).toBe(1)

    const stats = await MemoryTool.call(
      { action: 'stats' },
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(stats.data.count).toBe(1)
    expect(stats.data.memories?.[0]?.id).toBe('preference')

    const forgotten = await MemoryTool.call(
      { action: 'forget', memoryId },
      {} as never,
      undefined as never,
      undefined as never,
      undefined as never,
    )
    expect(forgotten.data.success).toBe(true)
    expect(forgotten.data.count).toBe(0)
  })
})
