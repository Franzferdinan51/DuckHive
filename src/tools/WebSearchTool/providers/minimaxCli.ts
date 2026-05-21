import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join, resolve } from 'path'

import { errorMessage } from '../../../utils/errors.js'
import { extractHits } from './custom.js'
import {
  applyDomainFilters,
  type ProviderOutput,
  type SearchHit,
  type SearchInput,
  type SearchProvider,
} from './types.js'

const DEFAULT_TIMEOUT_SECONDS = 120
const MAX_OUTPUT_BYTES = 1024 * 1024

function mmxExecutableName(platform = process.platform): string {
  return platform === 'win32' ? 'mmx.cmd' : 'mmx'
}

function executableExists(path: string): boolean {
  try {
    return existsSync(path)
  } catch {
    return false
  }
}

function findInPath(executable: string, env: NodeJS.ProcessEnv): string | undefined {
  const path = env.PATH
  if (!path) return undefined
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, executable)
    if (executableExists(candidate)) return candidate
  }
  return undefined
}

export function resolveMiniMaxCliBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  exists: (path: string) => boolean = executableExists,
): string | undefined {
  if (env.MMX_BIN) return env.MMX_BIN
  const executable = mmxExecutableName(platform)
  const candidates = [
    resolve(env.HOME ?? homedir(), '.npm-global/bin', executable),
    env.APPDATA ? resolve(env.APPDATA, 'npm', executable) : '',
    env.LOCALAPPDATA ? resolve(env.LOCALAPPDATA, 'Programs', 'npm', executable) : '',
    `/usr/local/bin/${executable}`,
    `/usr/bin/${executable}`,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return findInPath(executable, env)
}

export function hasMiniMaxCliAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MINIMAX_API_KEY || env.MINIMAX_OAUTH_TOKEN) return true
  const mmxHome = env.MMX_HOME || join(env.HOME ?? homedir(), '.mmx')
  return executableExists(join(mmxHome, 'config.json')) ||
    executableExists(join(mmxHome, 'credentials.json'))
}

function abortError(): Error {
  const err = new Error('MiniMax CLI search aborted')
  err.name = 'AbortError'
  return err
}

function parseJsonOutput(stdout: string): unknown {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error('MiniMax CLI search returned no output.')

  try {
    return JSON.parse(trimmed)
  } catch (e) {
    const firstObject = trimmed.indexOf('{')
    const lastObject = trimmed.lastIndexOf('}')
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(trimmed.slice(firstObject, lastObject + 1))
      } catch {
        /* ignore fallback failure */
      }
    }
    const firstArray = trimmed.indexOf('[')
    const lastArray = trimmed.lastIndexOf(']')
    if (firstArray >= 0 && lastArray > firstArray) {
      try {
        return JSON.parse(trimmed.slice(firstArray, lastArray + 1))
      } catch {
        /* ignore fallback failure */
      }
    }
    const preview = trimmed.slice(0, 200).trim()
    throw new Error(
      `MiniMax CLI search did not return JSON. ` +
        `Error: ${errorMessage(e)}. ` +
        `Preview: ${preview}${trimmed.length >= 200 ? '...' : ''}`,
    )
  }
}

export function parseMiniMaxSearchOutput(stdout: string): SearchHit[] {
  const raw = parseJsonOutput(stdout)
  return extractHits(raw)
}

async function runMiniMaxSearch(query: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw abortError()

  const binary = resolveMiniMaxCliBinary()
  if (!binary) {
    throw new Error('MiniMax CLI was not found. Install it with: npm install -g mmx-cli')
  }

  const timeoutSec = Number(process.env.WEB_MINIMAX_TIMEOUT_SEC) || DEFAULT_TIMEOUT_SECONDS
  const args = ['--non-interactive', 'search', 'query', '--q', query, '--output', 'json']

  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timeout: ReturnType<typeof setTimeout>

    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: process.env,
    })

    const cleanup = () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const kill = () => {
      if (!child.killed) child.kill(process.platform === 'win32' ? undefined : 'SIGTERM')
    }
    const onAbort = () => {
      kill()
      finish(() => reject(abortError()))
    }
    timeout = setTimeout(() => {
      kill()
      finish(() => reject(new Error(`MiniMax CLI search timed out after ${timeoutSec}s`)))
    }, timeoutSec * 1000)

    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', chunk => {
      stdout += String(chunk)
      if (stdout.length > MAX_OUTPUT_BYTES) {
        kill()
        finish(() => reject(new Error('MiniMax CLI search output exceeded 1MB.')))
      }
    })
    child.stderr?.on('data', chunk => {
      stderr += String(chunk).slice(0, MAX_OUTPUT_BYTES)
    })
    child.on('error', err => {
      finish(() => reject(err))
    })
    child.on('close', code => {
      finish(() => {
        if (code === 0) {
          resolvePromise(stdout)
          return
        }
        reject(new Error(`MiniMax CLI search failed with code ${code}: ${stderr.trim() || 'no stderr'}`))
      })
    })
  })
}

export const minimaxCliProvider: SearchProvider = {
  name: 'minimax',

  isConfigured() {
    return Boolean(resolveMiniMaxCliBinary() && hasMiniMaxCliAuth())
  },

  async search(input: SearchInput, signal?: AbortSignal): Promise<ProviderOutput> {
    const start = performance.now()
    const stdout = await runMiniMaxSearch(input.query, signal)
    const hits = parseMiniMaxSearchOutput(stdout)

    return {
      hits: applyDomainFilters(hits, input),
      providerName: 'minimax',
      durationSeconds: (performance.now() - start) / 1000,
    }
  },
}
