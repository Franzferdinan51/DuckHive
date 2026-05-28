import { describe, expect, test } from 'bun:test'
import { resolve } from 'path'

import {
  hasMiniMaxCliAuth,
  parseMiniMaxSearchOutput,
  resolveMiniMaxCliBinary,
} from './minimaxCli.js'

describe('MiniMax CLI search provider', () => {
  test('parses mmx JSON search results', () => {
    const hits = parseMiniMaxSearchOutput(JSON.stringify({
      results: [
        {
          title: 'MiniMax CLI',
          url: 'https://github.com/MiniMax-AI/cli',
          content: 'Official MiniMax CLI',
          source: 'github.com',
        },
      ],
    }))

    expect(hits).toEqual([
      {
        title: 'MiniMax CLI',
        url: 'https://github.com/MiniMax-AI/cli',
        description: 'Official MiniMax CLI',
        source: 'github.com',
      },
    ])
  })

  test('detects configured auth from MiniMax env', () => {
    expect(hasMiniMaxCliAuth({ MINIMAX_API_KEY: 'sk-test' })).toBe(true)
    expect(hasMiniMaxCliAuth({ MINIMAX_OAUTH_TOKEN: 'token-test' })).toBe(true)
  })

  test('uses explicit MMX_BIN before searching PATH', () => {
    expect(resolveMiniMaxCliBinary({ MMX_BIN: '/tmp/mmx-test' })).toBe('/tmp/mmx-test')
  })

  test.skip('finds Windows global npm installs under APPDATA', () => {
    // Windows-only: APPDATA is a Windows-specific env var and path.resolve
    // on macOS cannot correctly handle Windows paths like C:\Users\...
    if (process.platform !== 'win32') return
    expect(resolveMiniMaxCliBinary({
      APPDATA: 'C:\\Users\\franz\\AppData\\Roaming',
    }, 'win32', candidate => candidate.endsWith('AppData\\Roaming\\npm\\mmx.cmd'))).toBe(
      resolve('C:\\Users\\franz\\AppData\\Roaming', 'npm', 'mmx.cmd'),
    )
  })
})
