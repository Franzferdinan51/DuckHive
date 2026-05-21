import { afterEach, describe, expect, test } from 'bun:test'
import type { ProviderOutput } from './providers/types.js'
import { __test, WebSearchTool } from './WebSearchTool.js'

const {
  buildAdapterUnavailableError,
  buildEmptyAdapterResultHint,
  formatProviderGroundingEvidence,
  formatProviderOutputWithEmptyHint,
} = __test

const SAVED_ENV = {
  WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER,
  WEB_SEARCH_API: process.env.WEB_SEARCH_API,
  MMX_BIN: process.env.MMX_BIN,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
}

afterEach(() => {
  if (SAVED_ENV.WEB_SEARCH_PROVIDER === undefined) delete process.env.WEB_SEARCH_PROVIDER
  else process.env.WEB_SEARCH_PROVIDER = SAVED_ENV.WEB_SEARCH_PROVIDER

  if (SAVED_ENV.WEB_SEARCH_API === undefined) delete process.env.WEB_SEARCH_API
  else process.env.WEB_SEARCH_API = SAVED_ENV.WEB_SEARCH_API

  if (SAVED_ENV.MMX_BIN === undefined) delete process.env.MMX_BIN
  else process.env.MMX_BIN = SAVED_ENV.MMX_BIN

  if (SAVED_ENV.MINIMAX_API_KEY === undefined) delete process.env.MINIMAX_API_KEY
  else process.env.MINIMAX_API_KEY = SAVED_ENV.MINIMAX_API_KEY
})

describe('buildEmptyAdapterResultHint', () => {
  test('names the active provider and the failing backend', () => {
    const msg = buildEmptyAdapterResultHint('minimax', 'duckduckgo')
    expect(msg).toContain('minimax')
    expect(msg).toContain('duckduckgo')
  })

  test('includes the actionable env-var list so the user can pick one', () => {
    const msg = buildEmptyAdapterResultHint('moonshot', 'duckduckgo')
    for (const key of [
      'FIRECRAWL_API_KEY',
      'TAVILY_API_KEY',
      'EXA_API_KEY',
      'JINA_API_KEY',
      'BING_API_KEY',
      'MOJEEK_API_KEY',
      'LINKUP_API_KEY',
      'YOU_API_KEY',
    ]) {
      expect(msg).toContain(key)
    }
  })

  test('mentions the native-provider escape hatch', () => {
    const msg = buildEmptyAdapterResultHint('nvidia-nim', 'duckduckgo')
    expect(msg).toMatch(/Anthropic/)
    expect(msg).toMatch(/Vertex/)
    expect(msg).toMatch(/Foundry/)
  })
})

describe('formatProviderOutputWithEmptyHint', () => {
  test('formats provider results as grounding evidence with source URLs', () => {
    const po: ProviderOutput = {
      hits: [
        {
          title: 'DuckHive search',
          url: 'https://example.com/duckhive',
          description: 'Provider-backed search result.',
          source: 'example.com',
        },
      ],
      providerName: 'tavily',
      durationSeconds: 0.4,
    }

    const evidence = formatProviderGroundingEvidence(po, 'duckhive search')

    expect(evidence).toContain('Grounded search evidence from tavily')
    expect(evidence).toContain('Use these provider results')
    expect(evidence).toContain('https://example.com/duckhive')
    expect(evidence).toContain('Snippet: Provider-backed search result.')
  })

  test('replaces the empty placeholder with a diagnostic when 0 hits', () => {
    const po: ProviderOutput = {
      hits: [],
      providerName: 'duckduckgo',
      durationSeconds: 0.42,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    expect(out.results.length).toBe(1)
    expect(out.results[0]).toMatch(/^No results from "duckduckgo"/)
    expect(out.durationSeconds).toBe(0.42)
    expect(out.query).toBe('cat facts')
  })

  test('does not mutate the result when hits are present', () => {
    const po: ProviderOutput = {
      hits: [
        {
          title: 'Cats',
          url: 'https://example.com/cats',
          description: 'About cats.',
        },
      ],
      providerName: 'duckduckgo',
      durationSeconds: 1.2,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    // hits-present case preserves grounded evidence + tool_use_id links.
    expect(out.results.length).toBe(2)
    expect(typeof out.results[0]).toBe('string')
    expect(out.results[0]).toContain('Cats')
    expect(out.results[0]).toContain('https://example.com/cats')
  })
})

// Regression for adapter failures in auto mode on openai-shim providers with
// no native web-search fallback: the user must see the underlying adapter error.
describe('buildAdapterUnavailableError', () => {
  test('names the active provider', () => {
    const msg = buildAdapterUnavailableError('minimax', 'rate limited')
    expect(msg).toContain('minimax')
  })

  test('embeds the underlying adapter error message verbatim', () => {
    const msg = buildAdapterUnavailableError(
      'moonshot',
      'duckduckgo: 429 Too Many Requests',
    )
    expect(msg).toContain('duckduckgo: 429 Too Many Requests')
  })

  test('points the user at a working native-search provider', () => {
    const msg = buildAdapterUnavailableError('nvidia-nim', 'timeout')
    expect(msg).toMatch(/Anthropic/)
    expect(msg).toMatch(/Codex/)
  })
})

describe('WebSearchTool.isEnabled', () => {
  test('enables explicit minimax mode when the CLI and auth are configured', () => {
    process.env.WEB_SEARCH_PROVIDER = 'minimax'
    process.env.MMX_BIN = '/tmp/mmx-test'
    process.env.MINIMAX_API_KEY = 'sk-test'

    expect(WebSearchTool.isEnabled()).toBe(true)
  })

  test('enables explicit searxng mode when an endpoint is configured', () => {
    process.env.WEB_SEARCH_PROVIDER = 'searxng'
    process.env.WEB_SEARCH_API = 'http://localhost:8080/search'

    expect(WebSearchTool.isEnabled()).toBe(true)
  })
})
