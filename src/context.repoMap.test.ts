import { afterEach, describe, expect, test } from 'bun:test'

afterEach(() => {
  delete process.env.REPO_MAP
})

describe('getRepoMapContext', () => {
  test('returns null when REPO_MAP env flag is off (default)', async () => {
    const { getRepoMapContext } = await import('./context.js')
    const result = await getRepoMapContext()
    expect(result).toBeNull()
  })

  test('buildRepoMap produces valid output for context injection', async () => {
    process.env.REPO_MAP = '1'
    const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { buildRepoMap } = await import('./context/repoMap/index.js')

    const tempDir = mkdtempSync(join(tmpdir(), 'repomap-ctx-'))
    try {
      writeFileSync(
        join(tempDir, 'main.ts'),
        'export function main(): void { console.log("hello") }\n',
      )
      writeFileSync(
        join(tempDir, 'utils.ts'),
        'import { main } from "./main"\nexport function helper(): void { main() }\n',
      )

      const result = await buildRepoMap({
        root: tempDir,
        maxTokens: 1024,
      })

      // Valid map that could be injected
      expect(result.map.length).toBeGreaterThan(0)
      expect(result.tokenCount).toBeGreaterThan(0)
      expect(result.tokenCount).toBeLessThanOrEqual(1024)
      expect(typeof result.cacheHit).toBe('boolean')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      const { invalidateCache } = await import('./context/repoMap/index.js')
      invalidateCache(tempDir)
    }
  })

  test('getSystemContext does not include repoMap key when flag is off', async () => {
    const { getSystemContext } = await import('./context.js')
    const result = await getSystemContext()
    expect('repoMap' in result).toBe(false)
  })

  test('getSystemContext includes repoMap key when REPO_MAP env flag is on', async () => {
    process.env.REPO_MAP = '1'
    const { getSystemContext, getRepoMapContext } = await import('./context.js')
    getRepoMapContext.cache.clear?.()
    getSystemContext.cache.clear?.()
    const result = await getSystemContext()
    expect(typeof result.repoMap).toBe('string')
    expect(result.repoMap!.length).toBeGreaterThan(0)
  })
})
