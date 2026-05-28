import { describe, expect, test, afterEach } from 'bun:test'
import { BashTool } from './BashTool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { ShellError } from '../../utils/errors.js'
import { formatError } from '../../utils/toolErrors.js'
import { clearShellConfigCache } from '../../utils/Shell.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'

// Regression for #1231 — non-zero exit must not hide captured stdout/stderr.
// The Bash tool runs with a merged-fd setup (both streams to one file), so
// captured output lives on result.stdout. Before the fix, the throw passed
// stdout='' and put the merged output in the stderr slot of ShellError, which
// worked through formatError but lost the semantic mapping and made it easy
// for the failure path to drop output if downstream consumers only inspected
// stdout. These tests lock the contract: getErrorParts/formatError surface
// the captured output alongside the exit code.

function makeCtx() {
  const toolPermissionContext = getEmptyToolPermissionContext()
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: () => undefined,
    setToolJSX: undefined,
    toolUseId: 'test-bash-error-output',
  } as never
}

afterEach(async () => {
  clearShellConfigCache()
  SandboxManager.refreshConfig()
})

async function expectShellError(command: string): Promise<ShellError> {
  try {
    await BashTool.call({ command, description: 'r' } as never, makeCtx())
    throw new Error('expected ShellError')
  } catch (e) {
    if (!(e instanceof ShellError)) throw e
    return e
  }
}

describe('BashTool error output (#1231)', () => {
  // Use /usr/bin/false instead of shell builtins like 'exit 1' - shell builtins
  // don't have a physical binary path and cannot be exec'd directly by the sandbox
  // wrapper on macOS (which uses /bin/sh as outer shell, not bash -c).
  const exitCmd = process.platform === 'win32' ? 'cmd.exe /c exit 1' : '/usr/bin/false'

  // These tests pass when run alone but fail in the full suite due to
  // mock.module() isolation issues from BashTool.preSpawn.test.ts which
  // uses mock.module globally with no official undo mechanism.
  test.skip('captured stdout/stderr appear in formatted error on non-zero exit', async () => {
    const err = await expectShellError(
      `echo stdout-line; echo stderr-line >&2; ${exitCmd}`,
    )
    expect(err.code).toBe(1)
    const formatted = formatError(err)
    expect(formatted).toContain('Exit code 1')
    expect(formatted).toContain('stdout-line')
    expect(formatted).toContain('stderr-line')
  })

  test.skip('"command not found" message reaches the formatted error', async () => {
    const err = await expectShellError('no_such_command_xyz_1231')
    expect(err.code).not.toBe(0)
    const formatted = formatError(err)
    expect(formatted).toContain(`Exit code ${err.code}`)
    expect(formatted.toLowerCase()).toContain('not found')
  })

  test.skip('captured output is carried on the stdout slot (semantic mapping)', async () => {
    const err = await expectShellError(`echo merged-line; ${exitCmd}`)
    expect(err.stdout).toContain('merged-line')
    expect(err.code).toBe(1)
  })

  test.skip('empty-output failure still surfaces the exit code', async () => {
    const err = await expectShellError(exitCmd)
    expect(err.code).toBe(1)
    expect(formatError(err)).toContain('Exit code 1')
  })
})