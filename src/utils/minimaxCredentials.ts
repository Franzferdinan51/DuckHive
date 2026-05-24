import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { execFileNoThrow } from './execFileNoThrow.js'

type EnvLike = NodeJS.ProcessEnv | Record<string, string | undefined>

type MiniMaxCredentialRefreshDeps = {
  execFileNoThrow: typeof execFileNoThrow
  now: () => number
}

export type MiniMaxCredential =
  | { kind: 'api-key'; credential: string; source: string }
  | { kind: 'oauth-access-token'; credential: string; source: string }

interface MiniMaxOAuthTokens {
  accessToken: string
  expiresAtMs: number | null
}

const MINI_MAX_REFRESH_COOLDOWN_MS = 5 * 60 * 1000
const MINI_MAX_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000 // refresh 1 min before expiry

let lastMiniMaxRefreshAttemptAt = 0

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function readJsonFile(path: string): unknown {
  try {
    if (!existsSync(path)) {
      return undefined
    }
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function getMiniMaxHome(processEnv: EnvLike): string {
  const override = trimString(processEnv.MMX_HOME)
  return override ?? join(homedir(), '.mmx')
}

function getMiniMaxHomeDisplayPath(processEnv: EnvLike): string {
  const override = trimString(processEnv.MMX_HOME)
  return override ?? '~/.mmx'
}

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

function findInPath(
  executable: string,
  processEnv: EnvLike,
): string | undefined {
  const pathValue = trimString(processEnv.PATH)
  if (!pathValue) {
    return undefined
  }

  for (const dir of pathValue.split(delimiter)) {
    if (!dir) {
      continue
    }

    const candidate = join(dir, executable)
    if (executableExists(candidate)) {
      return candidate
    }
  }

  return undefined
}

function resolveMiniMaxCliBinary(
  processEnv: EnvLike = process.env,
  platform = process.platform,
): string | undefined {
  const override = trimString(processEnv.MMX_BIN)
  if (override) {
    return override
  }

  const executable = mmxExecutableName(platform)
  const candidates = [
    resolve(homedir(), '.npm-global', 'bin', executable),
    processEnv.LOCALAPPDATA
      ? resolve(processEnv.LOCALAPPDATA, 'Programs', 'npm', executable)
      : '',
    `/usr/local/bin/${executable}`,
    `/usr/bin/${executable}`,
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (executableExists(candidate)) {
      return candidate
    }
  }

  return findInPath(executable, processEnv)
}

function walkForNamedString(
  value: unknown,
  predicate: (key: string, value: string) => boolean,
): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const trimmed = trimString(nested)
    if (trimmed && predicate(key, trimmed)) {
      return trimmed
    }
    const nestedMatch = walkForNamedString(nested, predicate)
    if (nestedMatch) {
      return nestedMatch
    }
  }

  return undefined
}

function readMiniMaxConfigApiKey(path: string): string | undefined {
  const json = readJsonFile(path)
  return walkForNamedString(json, (key, value) => {
    const normalizedKey = key.trim().toLowerCase().replace(/[-_\s]+/g, '')
    if (
      normalizedKey !== 'apikey' &&
      normalizedKey !== 'minimaxapikey' &&
      normalizedKey !== 'token'
    ) {
      return false
    }
    return value.startsWith('sk-')
  })
}

/**
 * Normalize MiniMax expiry values from credentials.json.
 *
 * MiniMax's `mmx auth` may write `expired_in` or `expires_in` in different
 * formats depending on CLI version:
 *   - Relative seconds since issuance (most common, e.g. 3600)
 *   - Unix timestamp in seconds (e.g. 1735689600)
 *   - Absolute milliseconds (e.g. 1735689600000)
 *
 * Returns absolute ms or null if unparseable.
 */
function normalizeMiniMaxExpiry(value: unknown, nowMs: number): number | null {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN

  if (!Number.isFinite(num) || num <= 0) return null

  // Absolute milliseconds (e.g. 1735689600000) — value > 1e12
  if (num > 1e12) return num

  // Unix timestamp in seconds (e.g. 1735689600) — value > 1e10
  if (num > 1e10) return num * 1000

  // Relative seconds (e.g. 3600) — convert to absolute ms
  return nowMs + num * 1000
}

function readMiniMaxOAuthTokens(path: string): MiniMaxOAuthTokens | null {
  const json = readJsonFile(path)
  const accessToken = walkForNamedString(json, (key, value) => {
    const normalizedKey = key.trim().toLowerCase().replace(/[-_\s]+/g, '')
    if (
      normalizedKey !== 'accesstoken' &&
      normalizedKey !== 'token' &&
      normalizedKey !== 'bearertoken'
    ) {
      return false
    }
    return value.length >= 16
  })
  if (!accessToken) return null

  // Try to extract expiry from the tokens object
  let expiresAtMs: number | null = null
  if (json && typeof json === 'object') {
    const tokens = (json as Record<string, unknown>)['tokens']
    if (tokens && typeof tokens === 'object') {
      const t = tokens as Record<string, unknown>
      const expiryRaw = t['expired_in'] ?? t['expires_in'] ?? t['expiresAt'] ?? t['expires_at']
      if (expiryRaw !== undefined && expiryRaw !== null) {
        expiresAtMs = normalizeMiniMaxExpiry(expiryRaw, Date.now())
      }
    }
  }

  return { accessToken, expiresAtMs }
}

export function readMiniMaxCredential(
  processEnv: EnvLike = process.env,
): MiniMaxCredential | null {
  const envApiKey = trimString(processEnv.MINIMAX_API_KEY)
  if (envApiKey) {
    return {
      kind: 'api-key',
      credential: envApiKey,
      source: 'MINIMAX_API_KEY',
    }
  }

  const mmxApiKey = trimString(processEnv.MMX_API_KEY)
  if (mmxApiKey) {
    return {
      kind: 'api-key',
      credential: mmxApiKey,
      source: 'MMX_API_KEY',
    }
  }

  const mmxHome = getMiniMaxHome(processEnv)
  const configApiKey = readMiniMaxConfigApiKey(join(mmxHome, 'config.json'))
  if (configApiKey) {
    return {
      kind: 'api-key',
      credential: configApiKey,
      source: '~/.mmx/config.json',
    }
  }

 const oauthTokens = readMiniMaxOAuthTokens(
		join(mmxHome, 'credentials.json'),
	)
	if (oauthTokens?.accessToken) {
		return {
			kind: 'oauth-access-token',
			credential: oauthTokens.accessToken,
			source: '~/.mmx/credentials.json',
		}
	}











  return null
}

export function readMiniMaxRuntimeToken(
  processEnv: EnvLike = process.env,
): string | undefined {
  return readMiniMaxCredential(processEnv)?.credential
}

export function readMiniMaxApiKey(
  processEnv: EnvLike = process.env,
): string | undefined {
  const credential = readMiniMaxCredential(processEnv)
  return credential?.kind === 'api-key' ? credential.credential : undefined
}

export async function resolveMiniMaxCredentialWithRefresh(
  processEnv: EnvLike = process.env,
  deps: MiniMaxCredentialRefreshDeps = {
    execFileNoThrow,
    now: () => Date.now(),
  },
): Promise<MiniMaxCredential | null> {
  const currentCredential = readMiniMaxCredential(processEnv)
  if (!currentCredential || currentCredential.kind !== 'oauth-access-token') {
    return currentCredential
  }

  const now = deps.now()

  // Check if the OAuth token is still valid - skip refresh if unexpired
  const mmxHome = getMiniMaxHome(processEnv)
  const oauthTokens = readMiniMaxOAuthTokens(join(mmxHome, 'credentials.json'))
  if (oauthTokens?.expiresAtMs && oauthTokens.expiresAtMs - MINI_MAX_TOKEN_EXPIRY_BUFFER_MS > now) {
    return currentCredential
  }

  // Cooldown: don't hammer mmx auth refresh more than once per 5 minutes
  if (
    lastMiniMaxRefreshAttemptAt > 0 &&
    now - lastMiniMaxRefreshAttemptAt < MINI_MAX_REFRESH_COOLDOWN_MS
  ) {
    return currentCredential
  }

  const mmxBinary = resolveMiniMaxCliBinary(processEnv)
  if (!mmxBinary) {
    return currentCredential
  }

  lastMiniMaxRefreshAttemptAt = now

  const refreshResult = await deps.execFileNoThrow(
    mmxBinary,
    ['auth', 'refresh'],
    {
      env: processEnv as NodeJS.ProcessEnv,
      timeout: 60_000,
      useCwd: false,
      stdin: 'ignore',
    },
  )

  if (refreshResult.code !== 0) {
    return currentCredential
  }

  return (
    readMiniMaxCredential(processEnv) ?? {
      kind: 'oauth-access-token',
      credential: currentCredential.credential,
      source: `${getMiniMaxHomeDisplayPath(processEnv)}/credentials.json`,
    }
  )
}


export function resetMiniMaxCredentialRefreshStateForTesting(): void {
  lastMiniMaxRefreshAttemptAt = 0
}
