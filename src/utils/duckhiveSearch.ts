import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'

export type DuckHiveSearchProvider =
  | 'auto'
  | 'minimax'
  | 'native'
  | 'custom'
  | 'searxng'
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

export type DuckHiveSearchCredentialProvider = Exclude<
  DuckHiveSearchProvider,
  'auto' | 'native' | 'searxng' | 'ddg'
>

export const DUCKHIVE_SEARCH_PROVIDER_KEY_ENV_VARS: Partial<
  Record<DuckHiveSearchProvider, string>
> = {
  minimax: 'MINIMAX_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
  you: 'YOU_API_KEY',
  jina: 'JINA_API_KEY',
  bing: 'BING_API_KEY',
  mojeek: 'MOJEEK_API_KEY',
  linkup: 'LINKUP_API_KEY',
  custom: 'WEB_KEY',
}

export type DuckHiveSearchConfig = {
  provider?: string
  searxngUrl?: string
  apiKeys?: Partial<Record<DuckHiveSearchCredentialProvider, string>>
  custom?: {
    provider?: string
    api?: string
    urlTemplate?: string
    key?: string
  }
}

export type DuckHiveSearchSettings = Record<string, unknown> & {
  search?: DuckHiveSearchConfig
}

const SEARCH_PROVIDER_ALIASES: Record<string, DuckHiveSearchProvider> = {
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

export function normalizeDuckHiveSearchProvider(
  value?: string | null,
): DuckHiveSearchProvider | undefined {
  if (!value) return undefined
  return SEARCH_PROVIDER_ALIASES[value.trim().toLowerCase()]
}

export function getDuckHiveSearchConfigPath(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(configHomeDir, 'config.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readDuckHiveSearchSettingsSync(
  configPath = getDuckHiveSearchConfigPath(),
): DuckHiveSearchSettings {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    return isRecord(parsed) ? (parsed as DuckHiveSearchSettings) : {}
  } catch {
    return {}
  }
}

export function getConfiguredDuckHiveSearchProvider(
  config: DuckHiveSearchSettings | null | undefined,
): DuckHiveSearchProvider {
  return normalizeDuckHiveSearchProvider(config?.search?.provider) ?? 'auto'
}

export function getDuckHiveSearchProviderKeyEnvVar(
  provider: DuckHiveSearchProvider,
): string | undefined {
  return DUCKHIVE_SEARCH_PROVIDER_KEY_ENV_VARS[provider]
}

export function providerSupportsDuckHiveSearchApiKey(
  provider: DuckHiveSearchProvider,
): provider is DuckHiveSearchCredentialProvider {
  return Boolean(getDuckHiveSearchProviderKeyEnvVar(provider))
}

function sanitizeOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function deepMerge(target: Record<string, unknown>, ...sources: Record<string, unknown>[]): Record<string, unknown> {
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && isRecord(source[key])) {
        if (!target[key] || typeof target[key] !== 'object' || Array.isArray(target[key])) {
          target[key] = {}
        }
        deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>)
      } else {
        target[key] = source[key]
      }
    }
  }
  return target
}

export function setDuckHiveSearchPreferenceSync(
  provider: DuckHiveSearchProvider,
  options?: {
    searxngUrl?: string
    apiKey?: string
    customProvider?: string
    customSearchApi?: string
    customUrlTemplate?: string
  },
  configPath = getDuckHiveSearchConfigPath(),
): DuckHiveSearchSettings {
  const current = readDuckHiveSearchSettingsSync(configPath)
  const currentSearch = isRecord(current.search) ? (current.search as Record<string, unknown>) : {}
  const nextSearch: DuckHiveSearchConfig = {
    ...currentSearch,
    provider,
  }

  if (provider === 'searxng' && options?.searxngUrl) {
    nextSearch.searxngUrl = options.searxngUrl
  }

  if (providerSupportsDuckHiveSearchApiKey(provider)) {
    const nextApiKey = sanitizeOptionalValue(options?.apiKey)
    const currentApiKeys = isRecord(currentSearch.apiKeys)
      ? { ...(currentSearch.apiKeys as Partial<Record<DuckHiveSearchCredentialProvider, string>>) }
      : {}
    if (nextApiKey) {
      currentApiKeys[provider] = nextApiKey
    }
    if (Object.keys(currentApiKeys).length > 0) {
      nextSearch.apiKeys = currentApiKeys
    }
  }

  if (provider === 'custom') {
    const currentCustom = isRecord(currentSearch.custom)
      ? { ...(currentSearch.custom as Record<string, unknown>) }
      : {}
    const nextCustom: DuckHiveSearchConfig['custom'] = {
      ...currentCustom,
    }
    const customProvider = sanitizeOptionalValue(options?.customProvider)
    const customSearchApi = sanitizeOptionalValue(options?.customSearchApi)
    const customUrlTemplate = sanitizeOptionalValue(options?.customUrlTemplate)
    const customKey = sanitizeOptionalValue(options?.apiKey)
    if (customProvider) nextCustom.provider = customProvider
    if (customSearchApi) nextCustom.api = customSearchApi
    if (customUrlTemplate) nextCustom.urlTemplate = customUrlTemplate
    if (customKey) nextCustom.key = customKey
    nextSearch.custom = nextCustom
  }

  const nextConfig: DuckHiveSearchSettings = deepMerge({}, current as Record<string, unknown>, { search: nextSearch } as Record<string, unknown>)

  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8')
  return nextConfig
}

export function applyDuckHiveSearchPreferenceToEnv(
  config: DuckHiveSearchSettings,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const savedApiKeys = isRecord(config.search?.apiKeys)
    ? (config.search?.apiKeys as Partial<Record<DuckHiveSearchCredentialProvider, string>>)
    : {}
  for (const [provider, key] of Object.entries(savedApiKeys)) {
    const envVar = getDuckHiveSearchProviderKeyEnvVar(
      provider as DuckHiveSearchProvider,
    )
    const sanitizedKey = sanitizeOptionalValue(key)
    if (envVar && sanitizedKey) {
      env[envVar] = sanitizedKey
    }
  }

  const provider = getConfiguredDuckHiveSearchProvider(config)
  env.WEB_SEARCH_PROVIDER = provider

  if (provider === 'searxng') {
    env.WEB_PROVIDER = 'searxng'
    if (config.search?.searxngUrl) {
      env.WEB_SEARCH_API = config.search.searxngUrl
    }
    allowLocalSearxngIfNeeded(config.search?.searxngUrl, env)
    return
  }

  if (provider === 'custom') {
    const custom = isRecord(config.search?.custom)
      ? (config.search?.custom as Record<string, unknown>)
      : {}
    const customProvider = sanitizeOptionalValue(
      typeof custom.provider === 'string' ? custom.provider : undefined,
    )
    const customSearchApi = sanitizeOptionalValue(
      typeof custom.api === 'string' ? custom.api : undefined,
    )
    const customUrlTemplate = sanitizeOptionalValue(
      typeof custom.urlTemplate === 'string' ? custom.urlTemplate : undefined,
    )
    const customKey = sanitizeOptionalValue(
      typeof custom.key === 'string' ? custom.key : undefined,
    )
    if (customProvider) {
      env.WEB_PROVIDER = customProvider
    }
    if (customSearchApi) {
      env.WEB_SEARCH_API = customSearchApi
      allowLocalSearxngIfNeeded(customSearchApi, env)
    }
    if (customUrlTemplate) {
      env.WEB_URL_TEMPLATE = customUrlTemplate
    }
    if (customKey) {
      env.WEB_KEY = customKey
    }
  }
}

function allowLocalSearxngIfNeeded(
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv,
): void {
  if (!rawUrl) return
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    if (
      url.protocol === 'http:' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1'
    ) {
      env.WEB_CUSTOM_ALLOW_HTTP ??= 'true'
      env.WEB_CUSTOM_ALLOW_PRIVATE ??= 'true'
    }
  } catch {
    // Validation happens in the search provider before a request is made.
  }
}
