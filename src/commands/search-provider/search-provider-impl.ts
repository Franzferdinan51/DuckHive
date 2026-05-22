import type { LocalCommandCall } from '../../types/command.js'
import {
  applyDuckHiveSearchPreferenceToEnv,
  getDuckHiveSearchProviderKeyEnvVar,
  getConfiguredDuckHiveSearchProvider,
  normalizeDuckHiveSearchProvider,
  providerSupportsDuckHiveSearchApiKey,
  readDuckHiveSearchSettingsSync,
  setDuckHiveSearchPreferenceSync,
  type DuckHiveSearchProvider,
} from '../../utils/duckhiveSearch.js'

type ParsedArgs =
  | {
      ok: true
      help: boolean
      provider?: DuckHiveSearchProvider
      searxngUrl?: string
      apiKey?: string
      customProvider?: string
      customSearchApi?: string
      customUrlTemplate?: string
    }
  | { ok: false; error: string }

function parseArgs(args: string): ParsedArgs {
  const tokens = args.trim().split(/\s+/).filter(Boolean)
  const parsed: Extract<ParsedArgs, { ok: true }> = { ok: true, help: false }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token.startsWith('-') && parsed.provider) {
      if (
        parsed.provider === 'searxng' &&
        !parsed.searxngUrl
      ) {
        parsed.searxngUrl = token.trim()
        continue
      }
      if (
        providerSupportsDuckHiveSearchApiKey(parsed.provider) &&
        !parsed.apiKey
      ) {
        parsed.apiKey = token.trim()
        continue
      }
      if (parsed.provider === 'custom' && !parsed.customSearchApi) {
        parsed.customSearchApi = token.trim()
        continue
      }
    }

    const [flag, inlineValue] = token.split(/=(.*)/s, 2)

    if (flag === '--help' || flag === '-h') {
      parsed.help = true
      continue
    }

    if (flag === '--url' || flag === '--searxng-url') {
      const value = inlineValue ?? tokens[++i]
      if (!value?.trim()) {
        return { ok: false, error: `${flag} requires a value.` }
      }
      parsed.searxngUrl = value.trim()
      continue
    }

    if (flag === '--key' || flag === '--api-key') {
      const value = inlineValue ?? tokens[++i]
      if (!value?.trim()) {
        return { ok: false, error: `${flag} requires a value.` }
      }
      parsed.apiKey = value.trim()
      continue
    }

    if (flag === '--custom-provider' || flag === '--preset') {
      const value = inlineValue ?? tokens[++i]
      if (!value?.trim()) {
        return { ok: false, error: `${flag} requires a value.` }
      }
      parsed.customProvider = value.trim()
      continue
    }

    if (flag === '--custom-api') {
      const value = inlineValue ?? tokens[++i]
      if (!value?.trim()) {
        return { ok: false, error: `${flag} requires a value.` }
      }
      parsed.customSearchApi = value.trim()
      continue
    }

    if (flag === '--custom-url-template' || flag === '--template') {
      const value = inlineValue ?? tokens[++i]
      if (!value?.trim()) {
        return { ok: false, error: `${flag} requires a value.` }
      }
      parsed.customUrlTemplate = value.trim()
      continue
    }

    const provider = normalizeDuckHiveSearchProvider(token)
    if (!provider) {
      return { ok: false, error: `Unknown search provider: ${token}` }
    }
    parsed.provider = provider
  }

  return parsed
}

function usage(error?: string): string {
  const lines = [
    'Search provider setup',
    '',
    'Usage:',
    '  /search-provider [auto|minimax|native|ddg|searxng|firecrawl|tavily|exa|you|jina|brave|bing|mojeek|linkup|custom] [flags]',
    '',
    'Examples:',
    '  /search-provider auto',
    '  /search-provider minimax',
    '  /search-provider tavily tvly-...',
    '  /search-provider searxng http://localhost:8080/search',
    '  /search-provider custom https://example.com/search --key sk-...',
    '',
    'Flags:',
    '  --key <api-key>                 Save the provider API key in DuckHive config.json',
    '  --url <searxng-url>            Save a SearXNG endpoint',
    '  --custom-provider <preset>     Save WEB_PROVIDER for custom mode',
    '  --custom-api <url>             Save WEB_SEARCH_API for custom mode',
    '  --custom-url-template <url>    Save WEB_URL_TEMPLATE for custom mode',
    '',
    'No key needed: auto, native, ddg, searxng.',
    'Keyed providers: minimax, firecrawl, tavily, exa, you, jina, brave, bing, mojeek, linkup, custom.',
  ]
  return error ? `${error}\n\n${lines.join('\n')}` : lines.join('\n')
}

function hasConfiguredApiKey(
  provider: DuckHiveSearchProvider,
  current: ReturnType<typeof readDuckHiveSearchSettingsSync>,
): boolean {
  const envVar = getDuckHiveSearchProviderKeyEnvVar(provider)
  if (!envVar) return false
  if (process.env[envVar]?.trim()) return true
  const saved = current.search?.apiKeys?.[
    provider as keyof typeof current.search.apiKeys
  ]
  return typeof saved === 'string' && saved.trim().length > 0
}

export const call: LocalCommandCall = async (args: string) => {
  const parsed = parseArgs(args)
  if (!parsed.ok) {
    return { type: 'text', value: usage(parsed.error) }
  }
  if (parsed.help) {
    return { type: 'text', value: usage() }
  }

  const current = readDuckHiveSearchSettingsSync()
  if (!parsed.provider) {
    const provider = getConfiguredDuckHiveSearchProvider(current)
    const searxngUrl = current.search?.searxngUrl
    const lines = [
      'Search provider defaults',
      `Provider: ${provider}`,
      searxngUrl ? `SearXNG: ${searxngUrl}` : undefined,
    ]
    if (providerSupportsDuckHiveSearchApiKey(provider)) {
      lines.push(
        `Credential: ${
          hasConfiguredApiKey(provider, current) ? 'configured' : 'missing'
        }`,
      )
    }
    lines.push(
      '',
      'Use /search-provider --help for setup examples.',
    )
    return {
      type: 'text',
      value: lines.filter(Boolean).join('\n'),
    }
  }

  if (parsed.provider === 'searxng' && !parsed.searxngUrl && !current.search?.searxngUrl) {
    return {
      type: 'text',
      value: usage('SearXNG requires --url unless a SearXNG URL is already saved.'),
    }
  }

  if (
    parsed.provider === 'custom' &&
    !parsed.customSearchApi &&
    !parsed.customUrlTemplate &&
    !current.search?.custom?.api &&
    !current.search?.custom?.urlTemplate
  ) {
    return {
      type: 'text',
      value: usage(
        'Custom search requires --custom-api or --custom-url-template unless one is already saved.',
      ),
    }
  }

  const saved = setDuckHiveSearchPreferenceSync(parsed.provider, {
    searxngUrl: parsed.searxngUrl,
    apiKey: parsed.apiKey,
    customProvider: parsed.customProvider,
    customSearchApi: parsed.customSearchApi,
    customUrlTemplate: parsed.customUrlTemplate,
  })
  applyDuckHiveSearchPreferenceToEnv(saved)
  const lines = [`Search provider set to ${parsed.provider}.`]
  if (parsed.provider === 'searxng') {
    lines.push(`SearXNG URL: ${saved.search?.searxngUrl}`)
  }
  const keyEnvVar = getDuckHiveSearchProviderKeyEnvVar(parsed.provider)
  if (keyEnvVar && parsed.apiKey) {
    process.env[keyEnvVar] = parsed.apiKey
    lines.push(`Saved ${keyEnvVar} in DuckHive config.`)
  } else if (
    providerSupportsDuckHiveSearchApiKey(parsed.provider) &&
    !hasConfiguredApiKey(parsed.provider, saved)
  ) {
    lines.push(
      `Warning: ${parsed.provider} still needs ${keyEnvVar} before searches will work.`,
    )
  }
  if (parsed.provider === 'custom') {
    if (saved.search?.custom?.api) {
      lines.push(`Custom API: ${saved.search.custom.api}`)
    }
    if (saved.search?.custom?.urlTemplate) {
      lines.push(`Custom template: ${saved.search.custom.urlTemplate}`)
    }
    if (saved.search?.custom?.provider) {
      lines.push(`Custom preset: ${saved.search.custom.provider}`)
    }
  }
  lines.push('Saved for new sessions and applied to the current session.')
  return { type: 'text', value: lines.join('\n') }
}
