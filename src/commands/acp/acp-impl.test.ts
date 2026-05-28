import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  call,
  executeToolCall,
  resetACPServerState,
  runACPChat,
  setACPTestDeps,
} from './acp-impl.js'

function expectTextResult(result: Awaited<ReturnType<typeof call>>) {
  expect(result.type).toBe('text')
  if (result.type !== 'text') {
    throw new Error(`expected text result, received ${result.type}`)
  }
  return result
}

describe('/acp command', () => {
  let startServer: ReturnType<typeof mock>
  let closeServer: ReturnType<typeof mock>
  let queryAsyncMock: ReturnType<typeof mock>

  beforeEach(() => {
    closeServer = mock(() => {})
    startServer = mock(() => ({ close: closeServer }))
    queryAsyncMock = mock(async () => ({
      sessionId: 'duck-session-1',
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'ACP assistant reply' }],
          },
        }
      },
    }))
    setACPTestDeps({ startServer, queryAsync: queryAsyncMock as never })
  })

  afterEach(() => {
    resetACPServerState()
    setACPTestDeps(null)
  })

  test('starts the ACP server with default settings', async () => {
    const result = expectTextResult(await call(''))

    expect(startServer).toHaveBeenCalledWith({
      host: 'localhost',
      port: 8080,
      socketPath: undefined,
    })
    expect(result.value).toContain('ACP Server Started')
    expect(result.value).toContain('Address: localhost:8080')
    expect(result.value).toContain('ACP tool calls now execute DuckHive-backed shell/file/search operations')
  })

  test('reports status when the ACP server is running', async () => {
    await call('--port=9911 --host=127.0.0.1')

    const result = expectTextResult(await call('status'))

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(result.value).toContain('Status: running')
    expect(result.value).toContain('Address: 127.0.0.1:9911')
  })

  test('stops the running ACP server', async () => {
    await call('--socket=/tmp/duckhive-acp.sock')

    const result = expectTextResult(await call('stop'))

    expect(closeServer).toHaveBeenCalledTimes(1)
    expect(result.value).toContain('ACP Server Stopped')
    expect(result.value).toContain('unix:///tmp/duckhive-acp.sock')
  })

  test('reports when no ACP server is running', async () => {
    const result = expectTextResult(await call('status'))

    expect(startServer).not.toHaveBeenCalled()
    expect(result.value).toContain('Status: not running')
  })

  test('does not start a second ACP server when one is already running', async () => {
    await call('--port=8080')

    const result = expectTextResult(await call('--port=8080'))

    expect(startServer).toHaveBeenCalledTimes(1)
    expect(result.value).toContain('Status: already running')
  })

  test('rejects unsupported subcommands instead of silently starting a server', async () => {
    const result = expectTextResult(await call('restart'))

    expect(startServer).not.toHaveBeenCalled()
    expect(result.value).toContain('Usage:')
    expect(result.value).toContain('/acp status')
  })
})

describe('executeToolCall', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'duckhive-acp-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('writes and reads files', async () => {
    const filePath = path.join(tempDir, 'notes.txt')

    const writeResult = await executeToolCall('write_file', {
      path: filePath,
      content: 'alpha\nbeta\ngamma\n',
    })
    expect(writeResult.success).toBe(true)

    const readResult = await executeToolCall('read_file', {
      path: filePath,
      offset: 1,
      limit: 1,
    })
    expect(readResult.success).toBe(true)
    expect(readResult.content).toBe('beta')
  })

  test('lists directories recursively', async () => {
    await executeToolCall('write_file', {
      path: path.join(tempDir, 'nested', 'child.txt'),
      content: 'hello',
    })

    const result = await executeToolCall('list_directory', {
      path: tempDir,
      recursive: true,
    })

    expect(result.success).toBe(true)
    expect(result.items).toContain('nested/')
    expect(result.items).toContain('nested/child.txt')
  })

  test('searches by filename and content', async () => {
    await executeToolCall('write_file', {
      path: path.join(tempDir, 'alpha-note.txt'),
      content: 'needle in content\n',
    })
    await executeToolCall('write_file', {
      path: path.join(tempDir, 'other.txt'),
      content: 'plain text\n',
    })

    const fileResult = await executeToolCall('search', {
      path: tempDir,
      query: 'alpha',
      mode: 'files',
    })
    expect(fileResult.success).toBe(true)
    expect(fileResult.files).toContain('alpha-note.txt')

    const contentResult = await executeToolCall('search', {
      path: tempDir,
      query: 'needle',
      mode: 'content',
    })
    expect(contentResult.success).toBe(true)
    expect(contentResult.content).toEqual([
      {
        path: 'alpha-note.txt',
        line: 1,
        text: 'needle in content',
      },
    ])
  })

  test('executes shell commands', async () => {
    const result = await executeToolCall('shell', {
      command: '/bin/sh -c "echo ACP_OK"',
    })

    expect(result.success).toBe(true)
    expect(result.stdout).toContain('ACP_OK')
  })

  test('appends when requested', async () => {
    const filePath = path.join(tempDir, 'append.txt')
    await executeToolCall('write_file', {
      path: filePath,
      content: 'first\n',
    })
    await executeToolCall('write_file', {
      path: filePath,
      content: 'second\n',
      append: true,
    })

    const content = await readFile(filePath, 'utf8')
    expect(content).toBe('first\nsecond\n')
  })
})

describe('runACPChat', () => {
  afterEach(() => {
    setACPTestDeps(null)
  })

  test('routes ACP chat through SDK queryAsync in read-only mode', async () => {
    let canUseToolResult: unknown
    const queryAsyncMock = mock(async (params: { prompt: string; options: Record<string, unknown> }) => ({
      sessionId: 'duck-session-42',
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First line' }, { type: 'text', text: 'Second line' }],
          },
        }
      },
    }))
    setACPTestDeps({ queryAsync: queryAsyncMock as never })

    const result = await runACPChat('Hello ACP', {})
    const canUseTool = queryAsyncMock.mock.calls[0]?.[0]?.options?.canUseTool as
      | ((toolName: string) => Promise<unknown>)
      | undefined
    canUseToolResult = canUseTool ? await canUseTool('Bash') : undefined

    expect(queryAsyncMock).toHaveBeenCalledWith({
      prompt: 'Hello ACP',
      options: expect.objectContaining({
        cwd: process.cwd(),
        canUseTool: expect.any(Function),
      }),
    })
    expect(result).toEqual({
      content: 'First line\nSecond line',
      duckSessionId: 'duck-session-42',
    })
    expect(canUseToolResult).toEqual({
      behavior: 'deny',
      message:
        'ACP chat/message currently runs in read-only chat mode. Re-initialize the ACP client with the "tools" capability or use ACP tools/call for shell or filesystem operations.',
    })
  })

  test('routes ACP chat through SDK queryAsync with selective tool allowance when enabled', async () => {
    const queryAsyncMock = mock(async (_params: { prompt: string; options: Record<string, unknown> }) => ({
      sessionId: 'duck-session-99',
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Tool-enabled reply' }],
          },
        }
      },
    }))
    setACPTestDeps({ queryAsync: queryAsyncMock as never })

    const result = await runACPChat('Hello ACP', {}, { allowTools: true })
    const canUseTool = queryAsyncMock.mock.calls[0]?.[0]?.options?.canUseTool as
      | ((toolName: string) => Promise<unknown>)
      | undefined

    expect(await canUseTool?.('Bash')).toEqual({ behavior: 'allow' })
    expect(await canUseTool?.('Read')).toEqual({ behavior: 'allow' })
    expect(await canUseTool?.('Agent')).toEqual({
      behavior: 'deny',
      message:
        'ACP chat/message can only use the local shell/filesystem/search tool set (Bash, PowerShell, Read, Write, Edit, Grep, Glob, LSP). Use ACP tools/call for direct execution outside that set.',
    })
    expect(result).toEqual({
      content: 'Tool-enabled reply',
      duckSessionId: 'duck-session-99',
    })
  })
})
