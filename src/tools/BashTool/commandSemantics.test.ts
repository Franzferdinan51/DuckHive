import { describe, expect, test } from 'bun:test'
import { interpretCommandResult } from './commandSemantics.js'

// =============================================================================
// interpretCommandResult — exit code semantics per command
// =============================================================================

describe('interpretCommandResult', () => {
  // --- Default semantics (most commands) ---
  describe('default semantics', () => {
    test('exit code 0 = success, no error', () => {
      const result = interpretCommandResult('python script.py', 0, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toBeUndefined()
    })

    test('exit code 1 = error', () => {
      const result = interpretCommandResult('python script.py', 1, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('exit code 127 = command not found', () => {
      const result = interpretCommandResult('foobar', 127, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('127')
    })

    test('exit code 126 = permission denied', () => {
      const result = interpretCommandResult('./script.sh', 126, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('126')
    })

    test('exit code 130 = SIGINT (but not treated as interrupted here)', () => {
      const result = interpretCommandResult('long-command', 130, '', '')
      expect(result.isError).toBe(true)
    })
  })

  // --- grep: 0=matches, 1=no matches, 2+=error ---
  describe('grep', () => {
    test('exit code 0 = matches found (not error)', () => {
      const result = interpretCommandResult('grep foo file.txt', 0, 'foo\n', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('grep foo file.txt', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('No matches found')
    })

    test('exit code 2 = real error', () => {
      const result = interpretCommandResult('grep foo file.txt', 2, '', 'No such file')
      expect(result.isError).toBe(true)
    })
  })

  // --- ripgrep: same as grep ---
  describe('rg', () => {
    test('exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('rg pattern', 1, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('rg pattern', 2, '', '')
      expect(result.isError).toBe(true)
    })
  })

  // --- find: 0=success, 1=partial, 2+=error ---
  describe('find', () => {
    test('exit code 0 = success', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 0, 'file.ts\n', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = partial success (not error)', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 1, 'file.ts\n', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('inaccessible')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('find . -name "*.ts"', 2, '', 'Permission denied')
      expect(result.isError).toBe(true)
    })
  })

  // --- diff: 0=same, 1=different, 2+=error ---
  describe('diff', () => {
    test('exit code 0 = files identical', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 1, '< line1\n> line2', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })

    test('exit code 2 = error', () => {
      const result = interpretCommandResult('diff a.txt b.txt', 2, '', 'No such file')
      expect(result.isError).toBe(true)
    })
  })

  // --- cmp: 0=same, 1=different, 2+=error ---
  describe('cmp', () => {
    test('exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('cmp -s a.txt b.txt', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })
  })

  // --- git commands with informational exit code 1 ---
  describe('git', () => {
    test('git grep exit code 1 = no matches (not error)', () => {
      const result = interpretCommandResult('git grep needle', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('No matches found')
    })

    test('git diff (plain) exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('git diff', 1, '+added line', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })

    test('git diff --stat exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult(
        'git diff --stat',
        1,
        ' src/file.ts | 5 +++--',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })

    test('git diff --quiet exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult('git diff --quiet', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
    })

    test('git -C repo diff --exit-code exit code 1 = files differ (not error)', () => {
      const result = interpretCommandResult(
        'git -C repo diff --exit-code',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toContain('differ')
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

    test('git merge-base --is-ancestor exit code 1 = false predicate (not error)', () => {
      const result = interpretCommandResult(
        'git merge-base --is-ancestor HEAD origin/main',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toContain('not an ancestor')
    })

    test('git show-ref --verify --quiet exit code 1 = missing ref (not error)', () => {
      const result = interpretCommandResult(
        'git show-ref --verify --quiet refs/heads/nope',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Ref not found')
    })

    test('git rev-parse --verify --quiet exit code 1 = missing revision (not error)', () => {
      const result = interpretCommandResult(
        'git rev-parse --verify --quiet missing-ref',
        1,
        '',
        '',
      )
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Revision not found')
    })

    test('git predicate errors above code 1 are still errors', () => {
      const result = interpretCommandResult(
        'git merge-base --is-ancestor HEAD missing-ref',
        128,
        '',
        'fatal: Not a valid commit name',
      )
      expect(result.isError).toBe(true)
    })
  })

  // --- command lookup predicates: 0=found, 1=not found, 2+=lookup error ---
  describe('command lookup predicates', () => {
    test('which exit code 1 = command not found (not error)', () => {
      const result = interpretCommandResult('which definitely-not-installed', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Command not found')
    })

    test('command -v exit code 1 = command not found (not error)', () => {
      const result = interpretCommandResult('command -v definitely-not-installed', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Command not found')
    })

    test('type exit code 1 = command not found (not error)', () => {
      const result = interpretCommandResult('type definitely-not-installed', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('Command not found')
    })

    test('command without lookup flag keeps default semantics', () => {
      const result = interpretCommandResult('command node -e "process.exit(1)"', 1, '', '')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('lookup predicate code 2 remains an error', () => {
      const result = interpretCommandResult('which', 2, '', 'usage error')
      expect(result.isError).toBe(true)
    })
  })

  // --- pgrep: 0=matched, 1=no process, 2+=error ---
  describe('pgrep', () => {
    test('exit code 1 = no matching process (not error)', () => {
      const result = interpretCommandResult('pgrep -f duckhive-dev-server', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('No matching process')
    })

    test('exit code 2 = syntax/runtime error', () => {
      const result = interpretCommandResult('pgrep -[', 2, '', 'invalid option')
      expect(result.isError).toBe(true)
    })
  })

  // --- test/[: 0=true, 1=false, 2+=error ---
  describe('test and [', () => {
    test('test exit code 0 = condition true', () => {
      const result = interpretCommandResult('test -f file.txt', 0, '', '')
      expect(result.isError).toBe(false)
    })

    test('test exit code 1 = condition false (not error)', () => {
      const result = interpretCommandResult('test -f file.txt', 1, '', '')
      expect(result.isError).toBe(false)
      expect(result.message).toContain('false')
    })

    test('[ exit code 1 = condition false (not error)', () => {
      const result = interpretCommandResult('[ -f file.txt ]', 1, '', '')
      expect(result.isError).toBe(false)
    })
  })

  // --- Compound commands ---
  describe('compound commands', () => {
    test('last command determines semantics: grep last', () => {
      const result = interpretCommandResult('cd /tmp && grep foo file.txt', 1, '', '')
      // grep exit code 1 = no matches, not error
      expect(result.isError).toBe(false)
    })

    test('last command determines semantics: python last', () => {
      const result = interpretCommandResult('cd /tmp && python script.py', 1, '', '')
      // python exit code 1 = error
      expect(result.isError).toBe(true)
    })
  })

  // --- systemctl, apt, docker (real-world commands) ---
  describe('system/service commands', () => {
    test('systemctl failure = error', () => {
      const result = interpretCommandResult('systemctl start nginx', 1, '', 'Job for nginx.service failed')
      expect(result.isError).toBe(true)
      expect(result.message).toContain('exit code 1')
    })

    test('apt failure = error', () => {
      const result = interpretCommandResult('apt install foo', 100, '', 'Unable to locate package')
      expect(result.isError).toBe(true)
    })

    test('docker failure = error', () => {
      const result = interpretCommandResult('docker run ubuntu', 1, '', 'Unable to find image')
      expect(result.isError).toBe(true)
    })
  })
})
