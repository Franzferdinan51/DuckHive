/**
 * Provider registry and selection logic.
 *
 * WEB_SEARCH_PROVIDER controls which backend to use:
 *
 *   "auto"      (default) — try providers in priority order, fall through on failure
 *   "custom"    — use WEB_SEARCH_API / WEB_PROVIDER preset only (fail loudly)
 *   "firecrawl" — try Firecrawl, fall back to auto chain on transient errors
 *   "tavily"    — try Tavily, fall back to auto chain on transient errors
 *   "exa"       — try Exa, fall back to auto chain on transient errors
 *   "you"       — try You.com, fall back to auto chain on transient errors
 *   "jina"      — try Jina, fall back to auto chain on transient errors
 *   "brave"     — try Brave, fall back to auto chain on transient errors
 *   "bing"      — try Bing, fall back to auto chain on transient errors
 *   "mojeek"    — try Mojeek, fall back to auto chain on transient errors
 *   "linkup"    — try Linkup, fall back to auto chain on transient errors
 *   "ddg"       — try DuckDuckGo, fall back to auto chain on transient errors
 *   "native"    — use Anthropic native / Codex only (fail loudly)
 *
 * Specific providers fall back to the auto chain on transient failures
 * (connection errors, timeouts, HTTP 5xx/429). Auth/config errors (401, 403)
 * still throw immediately so users can fix their setup.
 *
 * NOTE: "custom" is NOT included in the "auto" fallback chain.
 *       It is only used when WEB_SEARCH_PROVIDER=custom is explicitly selected.
 */

import type { SearchInput, SearchProvider } from './types.js'
import type { ProviderOutput } from './types.js'

import { customProvider } from './custom.js'
import { duckduckgoProvider } from './duckduckgo.js'
import { firecrawlProvider } from './firecrawl.js'
import { tavilyProvider } from './tavily.js'
import { exaProvider } from './exa.js'
import { youProvider } from './you.js'
import { jinaProvider } from './jina.js'
import { braveProvider } from './brave.js'
import { bingProvider } from './bing.js'
import { mojeekProvider } from './mojeek.js'
import { linkupProvider } from './linkup.js'
import { minimaxCliProvider } from './minimaxCli.js'

export { type SearchInput, type SearchProvider, type ProviderOutput, type SearchHit } from './types.js'
export { applyDomainFilters, safeHostname, hostMatchesDomain } from './types.js'
export { extractHits } from './custom.js'

// ---------------------------------------------------------------------------
// All registered providers — order matters for auto mode
// ---------------------------------------------------------------------------
// Priority: firecrawl → tavily → exa → you → jina → brave → bing → mojeek → linkup → ddg
// DDG is last because it's free but rate-limited.
// Brave sits ahead of Bing because it runs an independent index (not Google/Bing
// dependent) and has a usable free tier; Bing's hosted API was sunsetted in 2025
// for new users, so it's a worse fallback in practice.
// NOTE: customProvider is intentionally excluded from the auto chain.
//       It is only available when WEB_SEARCH_PROVIDER=custom is explicitly set.
//       This prevents the generic outbound provider from silently becoming the default backend.

const searxngProvider: SearchProvider = {
  name: 'searxng',
  isConfigured() {
    return true
  },
  async search(input, signal) {
    // Set these before calling customProvider (which validates URLs)
    const prevHttp = process.env.WEB_CUSTOM_ALLOW_HTTP
    const prevPriv = process.env.WEB_CUSTOM_ALLOW_PRIVATE
    const previousProvider = process.env.WEB_PROVIDER
    process.env.WEB_CUSTOM_ALLOW_HTTP = 'true'
    process.env.WEB_CUSTOM_ALLOW_PRIVATE = 'true'
    process.env.WEB_PROVIDER = 'searxng'
    try {
      // Check BEFORE setting WEB_PROVIDER — we need the original (or empty) value,
      // not the one we just assigned. previousProvider is the saved original.
      if (!process.env.WEB_SEARCH_API && !process.env.WEB_URL_TEMPLATE && !previousProvider) {
        throw new Error(
          'SearXNG search requires WEB_SEARCH_API or WEB_URL_TEMPLATE for your instance endpoint.',
        )
      }
      const result = await customProvider.search(input, signal)
      return { ...result, providerName: 'searxng' }
    } finally {
      process.env.WEB_CUSTOM_ALLOW_HTTP = prevHttp ?? undefined
      process.env.WEB_CUSTOM_ALLOW_PRIVATE = prevPriv ?? undefined
      if (previousProvider === undefined) {
        delete process.env.WEB_PROVIDER
      } else {
        process.env.WEB_PROVIDER = previousProvider
      }
    }
  },
}

const ALL_PROVIDERS: SearchProvider[] = [
  minimaxCliProvider,
  firecrawlProvider,
  tavilyProvider,
  exaProvider,
  youProvider,
  jinaProvider,
  braveProvider,
  bingProvider,
  mojeekProvider,
  linkupProvider,
  duckduckgoProvider,
]

export function getAvailableProviders(): SearchProvider[] {
  return ALL_PROVIDERS.filter(p => p.isConfigured())
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ProviderMode =
  | 'auto'
  | 'custom'
  | 'firecrawl'
  | 'ddg'
  | 'tavily'
  | 'exa'
  | 'you'
  | 'jina'
  | 'brave'
  | 'bing'
  | 'mojeek'
  | 'linkup'
  | 'searxng'
  | 'minimax'
  | 'native'

const PROVIDER_BY_NAME: Record<string, SearchProvider> = {
  custom: customProvider,
  firecrawl: firecrawlProvider,
  ddg: duckduckgoProvider,
  tavily: tavilyProvider,
  exa: exaProvider,
  you: youProvider,
  jina: jinaProvider,
  brave: braveProvider,
  bing: bingProvider,
  mojeek: mojeekProvider,
  linkup: linkupProvider,
  searxng: searxngProvider,
  minimax: minimaxCliProvider,
}

const VALID_MODES = new Set<string>(Object.keys(PROVIDER_BY_NAME).concat(['auto', 'native']))

export function getProviderMode(): ProviderMode {
  const raw = process.env.WEB_SEARCH_PROVIDER ?? 'auto'
  if (VALID_MODES.has(raw)) return raw as ProviderMode
  return 'auto'
}

/**
 * Returns the list of providers to try, in order.
 * - Specific mode → single provider
 * - Auto → priority order (ALL_PROVIDERS, filtered by isConfigured)
 */
export function getProviderChain(mode: ProviderMode): SearchProvider[] {
  if (mode === 'auto') {
    return ALL_PROVIDERS.filter(p => p.isConfigured())
  }
  if (mode === 'native') {
    return []
  }
  const provider = PROVIDER_BY_NAME[mode]
  if (!provider) return []
  return [provider]
}

/**
 * Returns true if the error is a transient failure (network, timeout, server overload)
 * rather than a configuration/auth issue. Transient failures should trigger fallback
 * to the auto chain; auth/config errors should throw immediately.
 */
function isTransientError(error: Error): boolean {
  const msg = error.message.toLowerCase()
  // Connection/network errors
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('econnaborted') ||
    msg.includes('fetch failed') ||
    msg.includes('connection refused') ||
    msg.includes('timed out') ||
    msg.includes('unreachable')
  ) {
    return true
  }
  // HTTP status: 429 (rate limit), 5xx (server error) are transient
  const statusMatch = msg.match(/\b([45]\d\d)\b/)
  if (statusMatch) {
    const status = parseInt(statusMatch[1], 10)
    if (status === 401 || status === 403) return false // Auth/config errors
    if (status === 429 || status >= 500) return true
  }
  // Rate limiting hints
  if (msg.includes('rate limit') || msg.includes('too many request')) {
    return true
  }
  return false
}

/**
 * Run a search using the configured provider chain.
 *
 * - Auto mode: tries each provider in order, falls through on failure.
 *   If ALL providers fail, throws the last error.
 * - Specific mode: runs the single provider first. On transient failure
 *   (network errors, timeouts, HTTP 5xx/429), falls back to the auto chain
 *   instead of throwing. Auth/config errors still throw immediately.
 */
export async function runSearch(
  input: SearchInput,
  signal?: AbortSignal,
): Promise<ProviderOutput> {
  const mode = getProviderMode()
  let chain = getProviderChain(mode)

  if (chain.length === 0) {
    throw new Error(
      mode === 'native'
        ? 'Native web search requires firstParty/vertex/foundry provider.'
        : `No search providers available for mode "${mode}". Check your env vars.`,
    )
  }

  const errors: Error[] = []

  // Explicit provider mode: fail fast if the provider isn't configured
  if (mode !== 'auto' && mode !== 'native') {
    const provider = chain[0]
    if (provider && !provider.isConfigured()) {
      throw new Error(
        `Search provider "${mode}" is not configured. ` +
        `Set the required environment variable (e.g. ${mode.toUpperCase()}_API_KEY) ` +
        `or switch to WEB_SEARCH_PROVIDER=auto.`,
      )
    }
  }

  let fellBackToAuto = false
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!
    try {
      return await provider.search(input, signal)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))

      // Cancellation must stop immediately — don't fall through to other providers
      if (error.name === 'AbortError' || signal?.aborted) {
        throw error
      }

      errors.push(error)

      // Specific mode fallback: on transient errors, extend the chain with auto providers
      if (mode !== 'auto' && mode !== 'native' && !fellBackToAuto) {
        if (isTransientError(error)) {
          console.error(
            `[web-search] ${provider.name} (mode=${mode}) failed (transient): ${error.message}. ` +
            `Falling back to auto chain.`,
          )
          const triedNames = chain.map(p => p.name)
          const autoChain = getProviderChain('auto').filter(
            p => !triedNames.includes(p.name),
          )
          chain = chain.concat(autoChain)
          fellBackToAuto = true
          continue
        }
        throw error
      }

      // Auto mode (or fallen back to auto): log and try next
      console.error(`[web-search] ${provider.name} failed: ${error.message}`)
    }
  }

  // All providers failed
  const lastErr = errors[errors.length - 1]
  if (!lastErr) throw new Error('All search providers failed with no error details.')
  if (errors.length === 1) throw lastErr
  throw new Error(
    `All ${errors.length} search providers failed:\n` +
    errors.map((e, i) => `  ${i + 1}. ${e.message}`).join('\n'),
  )
}
