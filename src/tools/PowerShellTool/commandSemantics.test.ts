import { describe, expect, test } from 'bun:test'
import { interpretCommandResult } from './commandSemantics.js'

describe('interpretCommandResult', () => {
  describe('default semantic', () => {
    test('exit code 0 = success', () => {
      const result = interpretCommandResult('foo', 0, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBeUndefined()
    })

    test('exit code 1 = error', () => {
      const result = interpretCommandResult('foo', 1, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('foo', 2, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 2')
    })
  })

  describe('grep semantic', () => {
    test('exit code 0 = matches found', () => {
      const result = interpretCommandResult('grep foo', 0, 'match', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('grep foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('grep foo', 2, '', '')
      expect(result.isError).toBe(true)
    })
  })

  describe('rg semantic', () => {
    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('rg foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })
  })

  describe('findstr semantic', () => {
    test('exit code 1 = no match (not error)', () => {
      const result = interpretCommandResult('findstr foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('findstr foo', 2, '', '')
      expect(result.isError).toBe(true)
    })
  })

  describe('robocopy semantic', () => {
    test('exit code 0 = no files copied', () => {
      const result = interpretCommandResult('robocopy src dest', 0, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No files copied (already in sync)')
    })

    test('exit code 1 = files copied', () => {
      const result = interpretCommandResult('robocopy src dest', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files copied successfully')
    })

    test('exit code 7 = success', () => {
      const result = interpretCommandResult('robocopy src dest', 7, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 8 = error', () => {
      const result = interpretCommandResult('robocopy src dest', 8, '', '')
      expect(result.isError).toBe(true)
    })
  })

  describe('git subcommand semantics', () => {
    test('git diff (plain) exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('git diff', 1, '+added line', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff --stat exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult(
        'git diff --stat',
        1,
        ' src/file.ts | 5 +++--',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff --quiet exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('git diff --quiet', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff with file path exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult(
        'git diff src/foo.ts',
        1,
        '+added line',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff --exit-code exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult(
        'git diff --exit-code',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git diff with real error (exit code 128) is still an error', () => {
      const result = interpretCommandResult(
        'git diff bad-ref',
        128,
        '',
        'fatal: bad revision',
      )
      expect(result.isError).toBe(true)
    })

    test('git grep exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('git grep foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })

    test('git merge-base --is-ancestor exit code 1 = false predicate (not error)', () => {
      const result = interpretCommandResult(
        'git merge-base --is-ancestor HEAD origin/main',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Commit is not an ancestor')
    })

    test('git show-ref --verify --quiet exit code 1 = ref not found (not error)', () => {
      const result = interpretCommandResult(
        'git show-ref --verify --quiet refs/heads/nonexistent',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Ref not found')
    })

    test('git rev-parse --verify --quiet exit code 1 = revision not found (not error)', () => {
      const result = interpretCommandResult(
        'git rev-parse --verify --quiet nonexistent',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Revision not found')
    })

    test('git.exe diff also recognized', () => {
      const result = interpretCommandResult('git.exe diff', 1, 'diff output', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })

    test('git with global options -C still recognized', () => {
      const result = interpretCommandResult('git -C /path diff', 1, 'diff output', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })
  })

  describe('pipeline segment extraction', () => {
    test('uses last segment for base command', () => {
      const result = interpretCommandResult('foo | grep bar', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('No matches found')
    })

    test('git diff in pipeline uses last segment', () => {
      const result = interpretCommandResult('foo | git diff', 1, 'diff', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Files differ')
    })
  })

  describe('which/type lookup semantic', () => {
    test('which exit code 1 = not found (not error)', () => {
      const result = interpretCommandResult('which foo', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBe('Command not found')
    })

    test('which exit code 2 = error', () => {
      const result = interpretCommandResult('which', 2, '', '')
      expect(result.isError).toBe(true)
    })
  })
})
