/**
 * Secret Scanner for Memory Writes
 *
 * High-confidence secret scanner that detects API keys, tokens, certificates,
 * and credentials in free-text content before they are written to persistent
 * memory. Tuned for low false positives with anchored patterns.
 *
 * Ported from NVIDIA NemoClaw (Apache-2.0)
 * Ref: https://github.com/NVIDIA/NemoClaw
 */

export interface SecretMatch {
  pattern: string
  redacted: string
}

interface SecretPattern {
  name: string
  regex: RegExp
}

const SECRET_PATTERNS: SecretPattern[] = [
  // NVIDIA
  { name: 'NVIDIA API key', regex: /\bnvapi-[A-Za-z0-9_-]{20,}\b/ },

  // OpenAI — exclude sk-ant- (Anthropic) to avoid double-matching
  { name: 'OpenAI API key', regex: /\bsk-(?!ant-)[A-Za-z0-9]{20,}\b/ },

  // GitHub
  { name: 'GitHub token', regex: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9]{36,}\b/ },

  // AWS
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'AWS secret key',
    regex: /(?<=aws_secret_access_key\s*[=:]\s*)[A-Za-z0-9/+=]{40}\b/i,
  },

  // Slack
  { name: 'Slack token', regex: /\bxox[bpas]-[A-Za-z0-9-]{10,}\b/ },

  // Discord — require contextual prefix to avoid matching JWT/base64 strings
  {
    name: 'Discord bot token',
    regex:
      /(?<=(?:discord|bot|DISCORD_TOKEN|BOT_TOKEN|token)\s*[=:]\s*["']?)[A-Za-z0-9]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/,
  },

  // npm
  { name: 'npm token', regex: /\bnpm_[A-Za-z0-9]{36,}\b/ },

  // Private keys (PEM)
  {
    name: 'Private key',
    regex: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },

  // Generic bearer/auth header values
  {
    name: 'Authorization header',
    regex:
      /(?<=(?:Authorization\s*:\s*Bearer|Bearer\s*[=:])\s*["']?)[A-Za-z0-9._~+/=-]{40,}/i,
  },

  // Telegram bot token
  { name: 'Telegram bot token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },

  // OpenAI / Anthropic batch keys
  { name: 'Batch API key', regex: /\bsk-batch-[A-Za-z0-9]{40,}\b/ },
]

/**
 * Scan text content for secrets. Returns matched secrets with redacted versions.
 */
export function scanForSecrets(content: string): SecretMatch[] {
  const matches: SecretMatch[] = []

  for (const pattern of SECRET_PATTERNS) {
    // Reset regex state
    pattern.regex.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(content)) !== null) {
      const value = match[0]
      // Redact all but first 4 and last 4 characters
      if (value.length <= 8) {
        matches.push({ pattern: pattern.name, redacted: '****' })
      } else {
        const redacted =
          value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(-4)
        matches.push({ pattern: pattern.name, redacted })
      }

      // Prevent infinite loops on zero-length matches
      if (match.index === pattern.regex.lastIndex) {
        pattern.regex.lastIndex++
      }
    }
  }

  return matches
}

/**
 * Check if content contains any secrets. Returns true if secrets detected.
 */
export function containsSecrets(content: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    if (pattern.regex.test(content)) {
      return true
    }
  }
  return false
}

/**
 * Redact all secrets from content, replacing them with placeholder text.
 */
export function redactSecrets(content: string): string {
  let result = content

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0
    result = result.replace(pattern.regex, match => {
      if (match.length <= 8) return '[SECRET REDACTED]'
      return match.slice(0, 4) + '*'.repeat(match.length - 8) + match.slice(-4)
    })
  }

  return result
}
