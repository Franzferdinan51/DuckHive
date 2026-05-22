import type { ReadStream } from 'tty'
import { createStdinOverride } from '../utils/renderOptions.js'

const HELP = `DuckHive input-test

Usage:
  duckhive input-test

Exercises DuckHive's terminal keyboard path without starting providers, the REPL, or the TUI.

Type a short line and press Enter. Ctrl-C exits.
Use \`duckhive --stdin-mode readable input-test\` to compare DuckHive's readable compatibility reader.
`

function hasHelpFlag(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h')
}

function printableChunk(chunk: string): string {
  return chunk.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

function formatMode(mode: 'readable' | 'data'): string {
  return mode === 'readable'
    ? 'readable event mode'
    : 'data event mode'
}

export async function inputTestHandler(args: readonly string[]): Promise<void> {
  if (hasHelpFlag(args)) {
    process.stdout.write(HELP)
    return
  }

  const stdin = createStdinOverride() ?? process.stdin
  const stdout = process.stdout
  const mode: 'readable' | 'data' = process.env.OPENCLAUDE_USE_DATA_STDIN === '1' || process.env.OPENCLAUDE_USE_READABLE_STDIN === '0' ? 'data' : 'readable'

  if (!stdin.isTTY || !stdout.isTTY) {
    process.stderr.write(
      'DuckHive input-test needs stdin and stdout attached to a real terminal.\n' +
        'Run it directly from PowerShell/cmd, not through redirected output or this non-interactive shell.\n',
    )
    process.exitCode = 1
    return
  }

  await new Promise<void>(resolve => {
    let value = ''
    let finished = false

    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.removeListener('readable', onReadable)
      if (stdin.isTTY) {
        try {
          stdin.setRawMode(false)
        } catch {
          // Best effort: process exit will restore terminal state too.
        }
      }
      stdin.pause()
      if (stdin !== process.stdin) {
        ;(stdin as ReadStream).destroy()
      }
    }

    const finish = (exitCode = 0) => {
      if (finished) return
      finished = true
      cleanup()
      stdout.write('\n')
      if (exitCode === 0) {
        stdout.write(`Input received (${value.length} chars): ${value}\n`)
      }
      process.exitCode = exitCode
      resolve()
    }

    const handleChunk = (raw: string | Buffer) => {
      const text = raw.toString()
      for (const char of text) {
        const code = char.charCodeAt(0)
        if (code === 3) {
          stdout.write('^C\n')
          finish(130)
          return
        }
        if (char === '\r' || char === '\n') {
          finish(0)
          return
        }
        if (code === 8 || code === 127) {
          if (value.length > 0) {
            value = value.slice(0, -1)
            stdout.write('\b \b')
          }
          continue
        }
        if (code === 27) {
          continue
        }

        const printable = printableChunk(char)
        if (printable.length > 0) {
          value += printable
          stdout.write(printable)
        }
      }
    }

    const onData = (chunk: string | Buffer) => handleChunk(chunk)
    const onReadable = () => {
      let chunk = stdin.read()
      while (chunk !== null) {
        handleChunk(chunk)
        if (finished) return
        chunk = stdin.read()
      }
    }

    stdout.write(`DuckHive input-test (${formatMode(mode)})\n`)
    stdout.write('Type a short line, then press Enter. Ctrl-C exits.\n> ')

    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    if (mode === 'data') {
      stdin.on('data', onData)
    } else {
      stdin.on('readable', onReadable)
    }
    stdin.resume()
  })
}
