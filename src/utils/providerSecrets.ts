const SECRET_ENV_KEYS = [
  'OPENAI_API_KEY',
  'KIMI_API_KEY',
  'MOONSHOT_API_KEY',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'NVIDIA_API_KEY',
  'MINIMAX_API_KEY',
  'MISTRAL_API_KEY',
] as const

export type SecretValueSource = Partial<
  Record<(typeof SECRET_ENV_KEYS)[number], string | undefined>
>

const MOONSHOT_API_HOSTS = new Set([
  'api.moonshot.ai',
  'api.moonshot.cn',
])

const MINIMAX_API_HOSTS = new Set([
  'api.minimax.io',
])

const NVIDIA_API_HOSTS = new Set([
  'integrate.api.nvidia.com',
])

export function sanitizeApiKey(
  key: string | null | undefined,
): string | undefined {
  if (!key || key === 'SUA_CHAVE') return undefined
  return key
}

function getApiHostname(baseUrl: string | null | undefined): string | undefined {
  if (!baseUrl) return undefined

  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export function isMoonshotApiBaseUrl(
  baseUrl: string | null | undefined,
): boolean {
  const hostname = getApiHostname(baseUrl)
  return hostname ? MOONSHOT_API_HOSTS.has(hostname) : false
}

export function isMiniMaxApiBaseUrl(
  baseUrl: string | null | undefined,
): boolean {
  const hostname = getApiHostname(baseUrl)
  return hostname ? MINIMAX_API_HOSTS.has(hostname) : false
}

export function isNvidiaNimBaseUrl(
  baseUrl: string | null | undefined,
): boolean {
  const hostname = getApiHostname(baseUrl)
  return hostname ? NVIDIA_API_HOSTS.has(hostname) : false
}

export function getOpenAICompatibleApiKeyEnvVars(
  baseUrl: string | null | undefined,
): Array<(typeof SECRET_ENV_KEYS)[number]> {
  if (isMoonshotApiBaseUrl(baseUrl)) {
    return ['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY']
  }

  if (isMiniMaxApiBaseUrl(baseUrl)) {
    return ['MINIMAX_API_KEY', 'OPENAI_API_KEY']
  }

  if (isNvidiaNimBaseUrl(baseUrl)) {
    return ['NVIDIA_API_KEY', 'OPENAI_API_KEY']
  }

  return ['OPENAI_API_KEY']
}

export function resolveOpenAICompatibleApiKey(
  baseUrl: string | null | undefined,
  source: SecretValueSource | NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const key of getOpenAICompatibleApiKeyEnvVars(baseUrl)) {
    const value = sanitizeApiKey(source[key])
    if (value) {
      return value
    }
  }

  return undefined
}

function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false

  if (trimmed.startsWith('sk-') || trimmed.startsWith('sk-ant-')) {
    return true
  }

  if (trimmed.startsWith('AIza')) {
    return true
  }

  return false
}

function collectSecretValues(
  sources: Array<SecretValueSource | null | undefined>,
): string[] {
  const values = new Set<string>()

  for (const source of sources) {
    if (!source) continue

    for (const key of SECRET_ENV_KEYS) {
      const value = sanitizeApiKey(source[key])
      if (value) {
        values.add(value)
      }
    }
  }

  return [...values]
}

export function maskSecretForDisplay(
  value: string | null | undefined,
): string | undefined {
  const sanitized = sanitizeApiKey(value)
  if (!sanitized) return undefined

  if (sanitized.length <= 8) {
    return 'configured'
  }

  return `${sanitized.slice(0, 3)}...${sanitized.slice(-3)}`
}

export function redactSecretValueForDisplay(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return trimmed

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return maskSecretForDisplay(trimmed) ?? 'configured'
  }

  return trimmed
}

export function sanitizeProviderConfigValue(
  value: string | null | undefined,
  ...sources: Array<SecretValueSource | null | undefined>
): string | undefined {
  if (!value) return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const secretValues = collectSecretValues(sources)
  if (secretValues.includes(trimmed) || looksLikeSecretValue(trimmed)) {
    return undefined
  }

  return trimmed
}
