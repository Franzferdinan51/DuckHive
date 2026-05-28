import { afterEach, expect, mock, test } from 'bun:test'
import { ShellError } from '../../utils/errors.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'

const execMock = mock()

afterEach(() => {
  mock.restore()
  // Clear the module override so it doesn't persist into subsequent test files.
  // Bun's mock.module() applies globally and has no official undo - the last
  // mock.module() call wins. We replace our mock with the real module here
  // so subsequent tests get the real Shell.js.
  import('../../utils/Shell.js').then(realShell => {
    try {
      mock.module('../../utils/Shell.js', () => realShell)
    } catch {
      // Best effort - may fail in some Bun versions
    }
  })
})

function makeCtx() {
  const toolPermissionContext = getEmptyToolPermissionContext()
  return {
    abortController: new AbortController(),
    options: { isNonInteractiveSession: false },
    getAppState: () => ({ toolPermissionContext } as never),
    setAppState: () => undefined,
    setToolJSX: undefined,
    toolUseId: 'test-bash-pre-spawn',
  } as never
}

test('BashTool surfaces pre-spawn failures as ShellError', async () => {
  const shellModule = await import('../../utils/Shell.js')
  mock.module('../../utils/Shell.js', () => ({
    ...shellModule,
    exec: execMock,
  }))

  execMock.mockResolvedValue({
    result: Promise.resolve({
      code: 1,
      stdout: '',
      stderr: '',
      interrupted: false,
      preSpawnError: 'shell failed to spawn',
    }),
    cleanup: () => undefined,
    background: () => false,
    kill: () => undefined,
    status: 'completed',
    taskOutput: {
      taskId: 'test',
    },
  })

  const { BashTool } = await import(`./BashTool.js?ts=${Date.now()}-${Math.random()}`)

  try {
    await BashTool.call({ command: 'echo hi', description: 'r' } as never, makeCtx())
    throw new Error('expected ShellError')
  } catch (err) {
    expect(err).toBeInstanceOf(ShellError)
    expect((err as ShellError).code).toBe(1)
    expect((err as ShellError).stderr).toBe('shell failed to spawn')
  }
})
