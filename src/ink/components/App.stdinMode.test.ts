import { describe, expect, test } from 'bun:test'
import { PassThrough } from 'node:stream'
import React from 'react'
import { createRoot } from '../root.js'
import useInput from '../hooks/use-input.js'

type TestStdin = PassThrough & {
  isTTY: boolean
  setRawMode: (mode: boolean) => void
  ref: () => void
  unref: () => void
}

function createTestStreams(): {
  stdout: PassThrough
  stdin: TestStdin
} {
  const stdout = new PassThrough()
  const stdin = new PassThrough() as TestStdin

  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}

  ;(stdout as unknown as { columns: number }).columns = 120
  ;(stdout as unknown as { rows: number }).rows = 24
  ;(stdout as unknown as { isTTY: boolean }).isTTY = true

  return { stdout, stdin }
}

async function waitForCondition(
  predicate: () => boolean,
  errorMessage: string,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }

    await Bun.sleep(10)
  }

  throw new Error(errorMessage)
}

describe('Ink stdin delivery', () => {
  test('default stdin delivers typed characters to useInput listeners', async () => {
    const received: string[] = []
    const { stdout, stdin } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })

    function InputProbe(): null {
      useInput(input => {
        received.push(input)
      })
      return null
    }

    root.render(React.createElement(InputProbe))
    await Bun.sleep(25)
    stdin.write('abc')

    try {
      await waitForCondition(
        () => received.join('') === 'abc',
        `Expected stdin to deliver "abc", received ${JSON.stringify(received)}`,
      )
      expect(received.join('')).toBe('abc')
    } finally {
      root.unmount()
      stdin.end()
      stdout.end()
      await Bun.sleep(25)
    }
  })

  test('forced data stdin mode delivers typed characters to useInput listeners', async () => {
    const previous = process.env.OPENCLAUDE_USE_DATA_STDIN
    process.env.OPENCLAUDE_USE_DATA_STDIN = '1'

    const received: string[] = []
    const { stdout, stdin } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })

    function InputProbe(): null {
      useInput(input => {
        received.push(input)
      })
      return null
    }

    root.render(React.createElement(InputProbe))
    await Bun.sleep(25)
    stdin.write('xyz')

    try {
      await waitForCondition(
        () => received.join('') === 'xyz',
        `Expected data stdin to deliver "xyz", received ${JSON.stringify(received)}`,
      )
      expect(received.join('')).toBe('xyz')
    } finally {
      if (previous === undefined) {
        delete process.env.OPENCLAUDE_USE_DATA_STDIN
      } else {
        process.env.OPENCLAUDE_USE_DATA_STDIN = previous
      }
      root.unmount()
      stdin.end()
      stdout.end()
      await Bun.sleep(25)
    }
  })
})
