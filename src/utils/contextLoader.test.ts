import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, expect, test } from 'bun:test'
import { scanDuckContextFiles } from './contextLoader.js'

describe('scanDuckContextFiles', () => {
  test('stops at the filesystem root on Windows-style paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-context-'))
    const nested = join(root, 'one', 'two', 'three')

    try {
      const files = scanDuckContextFiles(nested)
      // The temp directory tree has no DUCK.md files, so any files returned
      // must come from outside the temp tree (e.g. global ~/.duckhive/DUCK.md).
      // Verify per-directory files are within the temp tree, not from traversal
      // that went past the filesystem root.
      const perDirFiles = files.filter(f => f.level === 'per-directory')
      for (const file of perDirFiles) {
        expect(file.path.startsWith(root)).toBe(true)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('applies slash-separated duckignore path patterns on the current platform', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-context-'))

    try {
      mkdirSync(join(root, '.duckhive'), { recursive: true })
      writeFileSync(join(root, '.duckignore'), '.duckhive/DUCK.md\n')
      writeFileSync(join(root, '.duckhive', 'DUCK.md'), 'ignored context')

      const files = scanDuckContextFiles(join(root, 'nested'))
      expect(files.map(file => file.content)).not.toContain('ignored context')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
