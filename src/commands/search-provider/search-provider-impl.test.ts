import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type {
  DuckHiveSearchProvider,
  DuckHiveSearchSettings,
} from '../../utils/duckhiveSearch.js'

let settings: DuckHiveSearchSettings
let savedProvider: DuckHiveSearchProvider | undefined
let savedSearxngUrl: string | undefined
let savedApiKey: string | undefined
let savedCustomProvider: string | undefined
let savedCustomSearchApi: string | undefined
let savedCustomUrlTemplate: string | undefined
let appliedSettings: DuckHiveSearchSettings | undefined

async function importFreshSearchProviderModule() {
  return await import(
    `./search-provider-impl.ts?search-provider-test=${Date.now()}-${Math.random()}`
  )
}

describe('/search-provider command', () => {
  beforeEach(() => {
    settings = {}
    savedProvider = undefined
    savedSearxngUrl = undefined
    savedApiKey = undefined
    savedCustomProvider = undefined
    savedCustomSearchApi = undefined
    savedCustomUrlTemplate = undefined
    appliedSettings = undefined
    delete process.env.TAVILY_API_KEY
    delete process.env.WEB_KEY

    mock.module('../../utils/duckhiveSearch.js', () => {
      const aliases: Record<string, DuckHiveSearchProvider> = {
        auto: 'auto',
        minimax: 'minimax',
        mmx: 'minimax',
        'minimax-cli': 'minimax',
        native: 'native',
        custom: 'custom',
        searxng: 'searxng',
        searx: 'searxng',
        firecrawl: 'firecrawl',
        ddg: 'ddg',
        duckduckgo: 'ddg',
        tavily: 'tavily',
        exa: 'exa',
        you: 'you',
        youcom: 'you',
        jina: 'jina',
        brave: 'brave',
        bing: 'bing',
        mojeek: 'mojeek',
        linkup: 'linkup',
      }
      const envVars: Partial<Record<DuckHiveSearchProvider, string>> = {
        minimax: 'MINIMAX_API_KEY',
        firecrawl: 'FIRECRAWL_API_KEY',
        tavily: 'TAVILY_API_KEY',
        exa: 'EXA_API_KEY',
        you: 'YOU_API_KEY',
        jina: 'JINA_API_KEY',
        brave: 'BRAVE_API_KEY',
        bing: 'BING_API_KEY',
        mojeek: 'MOJEEK_API_KEY',
        linkup: 'LINKUP_API_KEY',
        custom: 'WEB_KEY',
      }

      return {
        applyDuckHiveSearchPreferenceToEnv: (
          config: DuckHiveSearchSettings,
        ) => {
          appliedSettings = config
        },
        getDuckHiveSearchProviderKeyEnvVar: (provider: DuckHiveSearchProvider) =>
          envVars[provider],
        normalizeDuckHiveSearchProvider: (value?: string | null) =>
          value ? aliases[value.trim().toLowerCase()] : undefined,
        providerSupportsDuckHiveSearchApiKey: (provider: DuckHiveSearchProvider) =>
          Boolean(envVars[provider]),
        getConfiguredDuckHiveSearchProvider: (
          config: DuckHiveSearchSettings | null | undefined,
        ) =>
          config?.search?.provider
            ? aliases[config.search.provider.trim().toLowerCase()] ?? 'auto'
            : 'auto',
        readDuckHiveSearchSettingsSync: () => settings,
        setDuckHiveSearchPreferenceSync: (
          provider: DuckHiveSearchProvider,
          options?: {
            searxngUrl?: string
            apiKey?: string
            customProvider?: string
            customSearchApi?: string
            customUrlTemplate?: string
          },
        ) => {
          savedProvider = provider
          savedSearxngUrl = options?.searxngUrl
          savedApiKey = options?.apiKey
          savedCustomProvider = options?.customProvider
          savedCustomSearchApi = options?.customSearchApi
          savedCustomUrlTemplate = options?.customUrlTemplate
          settings = {
            ...settings,
            search: {
              ...(settings.search ?? {}),
              provider,
              ...(options?.searxngUrl
                ? { searxngUrl: options.searxngUrl }
                : {}),
              ...(options?.apiKey
                ? {
                    apiKeys: {
                      ...((settings.search?.apiKeys as Record<string, string> | undefined) ?? {}),
                      [provider]: options.apiKey,
                    },
                  }
                : {}),
              ...(
                options?.customProvider ||
                options?.customSearchApi ||
                options?.customUrlTemplate
                  ? {
                      custom: {
                        ...((settings.search?.custom as Record<string, string> | undefined) ?? {}),
                        ...(options?.customProvider
                          ? { provider: options.customProvider }
                          : {}),
                        ...(options?.customSearchApi
                          ? { api: options.customSearchApi }
                          : {}),
                        ...(options?.customUrlTemplate
                          ? { urlTemplate: options.customUrlTemplate }
                          : {}),
                      },
                    }
                  : {}),
            },
          }
          return settings
        },
      }
    })
  })

  afterEach(() => {
    mock.restore()
  })

  test('reports the current provider without mutating settings', async () => {
    settings = { search: { provider: 'ddg' } }
    const { call } = await importFreshSearchProviderModule()

    const result = await call('', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('unexpected result type')
    expect(result.value).toContain('Provider: ddg')
    expect(savedProvider).toBeUndefined()
  })

  test('saves provider aliases through the shared normalizer', async () => {
    const { call } = await importFreshSearchProviderModule()

    const result = await call('duckduckgo', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('unexpected result type')
    expect(savedProvider).toBe('ddg')
    expect(result.value).toContain('Search provider set to ddg.')
  })

  test('saves keyed provider credentials through the command', async () => {
    const { call } = await importFreshSearchProviderModule()

    const result = await call('tavily tvly-test-key', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('unexpected result type')
    expect(savedProvider).toBe('tavily')
    expect(savedApiKey).toBe('tvly-test-key')
    expect(appliedSettings?.search?.provider).toBe('tavily')
    expect(process.env.TAVILY_API_KEY).toBe('tvly-test-key')
    expect(result.value).toContain('Saved TAVILY_API_KEY in DuckHive config.')
  })

  test('requires a SearXNG URL unless one is already saved', async () => {
    const { call } = await importFreshSearchProviderModule()

    const missing = await call('searxng', {} as never)
    expect(missing.type).toBe('text')
    if (missing.type !== 'text') throw new Error('unexpected result type')
    expect(missing.value).toContain('SearXNG requires --url')
    expect(savedProvider).toBeUndefined()

    const saved = await call('searxng http://localhost:8080/search', {} as never)
    expect(saved.type).toBe('text')
    if (saved.type !== 'text') throw new Error('unexpected result type')
    expect(savedProvider).toBe('searxng')
    expect(savedSearxngUrl).toBe('http://localhost:8080/search')
    expect(saved.value).toContain('SearXNG URL: http://localhost:8080/search')
  })

  test('requires custom endpoint details unless already saved', async () => {
    const { call } = await importFreshSearchProviderModule()

    const missing = await call('custom', {} as never)
    expect(missing.type).toBe('text')
    if (missing.type !== 'text') throw new Error('unexpected result type')
    expect(missing.value).toContain('Custom search requires --custom-api or --custom-url-template')

    const saved = await call(
      'custom --custom-api https://example.com/search --custom-provider brave --key brv-test-key',
      {} as never,
    )
    expect(saved.type).toBe('text')
    if (saved.type !== 'text') throw new Error('unexpected result type')
    expect(savedProvider).toBe('custom')
    expect(savedApiKey).toBe('brv-test-key')
    expect(savedCustomProvider).toBe('brave')
    expect(savedCustomSearchApi).toBe('https://example.com/search')
    expect(savedCustomUrlTemplate).toBeUndefined()
    expect(saved.value).toContain('Custom API: https://example.com/search')
    expect(saved.value).toContain('Custom preset: brave')
  })

  test('returns usage for unknown providers', async () => {
    const { call } = await importFreshSearchProviderModule()

    const result = await call('unknown-provider', {} as never)

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('unexpected result type')
    expect(result.value).toContain('Unknown search provider: unknown-provider')
    expect(result.value).toContain('/search-provider')
  })
})
