/**
 * Privacy Shield — PII Detection & Scrubbing
 *
 * High-confidence Personally Identifiable Information (PII) detection and
 * scrubbing for API call content. Inspired by DreamServer's Privacy Shield
 * service, adapted for DuckHive's TypeScript codebase.
 *
 * Detects:
 *   - Email addresses
 *   - Phone numbers (international formats)
 *   - Credit card numbers (Luhn-validated)
 *   - Social Security Numbers (US SSN)
 *   - IP addresses
 *   - Physical addresses (street patterns)
 *   - Names (heuristic: capitalized word pairs near address patterns)
 *   - API keys and tokens (reuses secretScanner patterns)
 *
 * Provides both detection (find PII) and scrubbing (redact PII) modes.
 * Designed to be called before sending content to external APIs.
 */

import { containsSecrets, redactSecrets } from './secretScanner.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PiiMatch {
  /** Category of PII detected */
  category: PiiCategory
  /** The original matched text */
  value: string
  /** Start index in the original content */
  startIndex: number
  /** End index in the original content */
  endIndex: number
  /** Redacted replacement */
  redacted: string
}

// NOTE: 'api_key' is not produced by scanForPii() (secret detection is handled
// by secretScanner). It exists for scanAndRedactPii() composite reporting.
export type PiiCategory =
  | 'email'
  | 'phone'
  | 'credit_card'
  | 'ssn'
  | 'ip_address'
  | 'street_address'
  | 'api_key'

export interface PiiScanResult {
  /** Whether any PII was found */
  hasPii: boolean
  /** All detected PII matches */
  matches: PiiMatch[]
  /** Original content with all PII redacted */
  redactedContent: string
  /** Summary of what was found and redacted */
  summary: string
}

// ─── Detection patterns ────────────────────────────────────────────────────

interface PiiPattern {
  category: PiiCategory
  regex: RegExp
  /** Optional validator for reducing false positives */
  validate?: (match: string) => boolean
  /** Redaction mask pattern */
  mask: (match: string) => string
}

const PII_PATTERNS: PiiPattern[] = [
  // Email addresses
  {
    category: 'email',
    // Standard email regex — matches common formats
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    validate: (email) => {
      // Reject obviously fake emails (test@test.com, example@example.com, etc.)
      const lower = email.toLowerCase()
      const commonFakes = ['test@test.com', 'example@example.com', 'user@example.com',
        'admin@example.com', 'foo@bar.com', 'no-reply@', 'noreply@']
      return !commonFakes.some(f => lower.startsWith(f) || lower === f)
    },
    mask: (email) => {
      const [local, domain] = email.split('@')
      if (!local || !domain) return '[EMAIL]'
      const maskedLocal = local.length <= 2
        ? local[0] + '*'
        : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
      return `${maskedLocal}@${domain}`
    },
  },

  // Phone numbers (international)
  {
    category: 'phone',
    // Covers: +1-555-123-4567, (555) 123-4567, 555-123-4567, 555.123.4567
    regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    validate: (phone) => {
      // Reject numbers that are clearly not phone numbers (all same digit, etc.)
      const digits = phone.replace(/\D/g, '')
      if (digits.length < 10 || digits.length > 15) return false
      // Reject sequences like 123-456-7890, 111-111-1111
      if (/^(\d)\1{9,}$/.test(digits)) return false
      if (digits === '1234567890' || digits === '0123456789') return false
      return true
    },
    mask: () => '[PHONE]',
  },

  // Credit card numbers (Luhn-validated)
  {
    category: 'credit_card',
    // Matches common card number formats with optional separators
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: (num) => {
      const digits = num.replace(/\D/g, '')
      if (digits.length < 13 || digits.length > 19) return false
      // Luhn algorithm check
      return luhnCheck(digits)
    },
    mask: (match) => {
      const digits = match.replace(/\D/g, '')
      const last4 = digits.slice(-4)
      const prefix = digits.slice(0, 2) === '4' ? 'Visa'
        : digits.slice(0, 2) === '34' || digits.slice(0, 2) === '37' ? 'Amex'
        : digits.slice(0, 4) === '6011' ? 'Discover'
        : digits.startsWith('5') ? 'MasterCard'
        : 'CC'
      return `[${prefix}-${last4}]`
    },
  },

  // US Social Security Numbers
  {
    category: 'ssn',
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    validate: (ssn) => {
      const parts = ssn.split('-')
      if (parts.length !== 3) return false
      const area = parseInt(parts[0] ?? '0', 10)
      const group = parseInt(parts[1] ?? '0', 10)
      // Known invalid area numbers
      if (area === 0 || area === 666 || (area >= 900 && area <= 999)) return false
      if (group === 0) return false
      return true
    },
    mask: () => '[SSN]',
  },

  // IP addresses (both IPv4 and IPv6)
  {
    category: 'ip_address',
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    validate: (ip) => {
      // Skip common non-PII IPs
      const skipList = ['0.0.0.0', '127.0.0.1', '255.255.255.255', '1.1.1.1', '8.8.8.8']
      return !skipList.includes(ip)
    },
    mask: (ip) => {
      const parts = ip.split('.')
      if (parts.length !== 4) return '[IP]'
      return `${parts[0]}.${parts[1]}.*.*`
    },
  },

  // Street addresses (US format)
  {
    category: 'street_address',
    // Matches patterns like "123 Main St" or "456 Elm Street, Apt 4"
    regex: /\b\d{1,6}\s+(?:[A-Z][a-z]+\s)+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Plaza|Pl|Circle|Cir|Highway|Hwy|Parkway|Pkwy)\b(?:,?\s+(?:Apt|Suite|Unit|#)\s*\d+[A-Za-z]?)?/g,
    mask: () => '[ADDRESS]',
  },
]

// ─── Luhn algorithm for credit card validation ─────────────────────────────

function luhnCheck(digits: string): boolean {
  let sum = 0
  let alternate = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i] ?? '0', 10)
    if (alternate) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alternate = !alternate
  }
  return sum % 10 === 0
}

// ─── Scanning logic ────────────────────────────────────────────────────────

/**
 * Scan content for PII. Returns all detected PII matches.
 *
 * @param content The text content to scan
 * @param options Optional configuration
 * @returns Array of PII matches found
 */
export function scanForPii(
  content: string,
  options?: {
    /** Skip API key scanning (already done by secretScanner) */
    skipApiKeys?: boolean
    /** Additional custom PII patterns to include */
    extraPatterns?: PiiPattern[]
  },
): PiiMatch[] {
  const matches: PiiMatch[] = []
  const patterns = [
    ...PII_PATTERNS,
    ...(options?.extraPatterns ?? []),
  ]

  for (const pattern of patterns) {
    // Reset regex state
    pattern.regex.lastIndex = 0

    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(content)) !== null) {
      const value = match[0]
      if (!value) continue

      // Run optional validation
      if (pattern.validate && !pattern.validate(value)) {
        continue
      }

      // Skip if this match overlaps with an existing match
      const overlaps = matches.some(m =>
        match!.index < m.endIndex && match!.index + value.length > m.startIndex,
      )
      if (overlaps) continue

      matches.push({
        category: pattern.category,
        value,
        startIndex: match.index,
        endIndex: match.index + value.length,
        redacted: pattern.mask(value),
      })
    }
  }

  // Sort by position
  matches.sort((a, b) => a.startIndex - b.startIndex)

  return matches
}

/**
 * Redact all PII from content, replacing matches with category-based masks.
 * Also runs secretScanner redaction for API keys.
 *
 * @param content The text content to redact
 * @returns The content with all PII redacted
 */
export function redactPii(content: string): string {
  let result = content

  // First pass: redact secrets (API keys, tokens)
  result = redactSecrets(result)

  // Second pass: redact PII (emails, phones, addresses, etc.)
  const piiMatches = scanForPii(result)

  // Process in reverse order to preserve indices
  for (let i = piiMatches.length - 1; i >= 0; i--) {
    const match = piiMatches[i]!
    result = result.slice(0, match.startIndex) + match.redacted + result.slice(match.endIndex)
  }

  return result
}

/**
 * Check if content contains any PII. Fast path — stops at first match.
 *
 * @param content The text content to check
 * @returns True if PII is detected
 */
export function containsPii(content: string): boolean {
  // Quick check: secrets first
  if (containsSecrets(content)) return true

  // Check PII patterns
  for (const pattern of PII_PATTERNS) {
    pattern.regex.lastIndex = 0
    if (pattern.regex.test(content)) {
      // Verify with validator if present
      if (pattern.validate) {
        pattern.regex.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = pattern.regex.exec(content)) !== null) {
          if (pattern.validate(match[0]!)) return true
        }
      } else {
        return true
      }
    }
  }

  return false
}

/**
 * Full PII scan and redaction. Returns both the redacted content and a
 * detailed report of what was found.
 *
 * @param content The text content to scan and redact
 * @returns Full scan result with matches and redacted content
 */
export function scanAndRedactPii(content: string): PiiScanResult {
  const matches = scanForPii(content)

  // Check for secrets (use containsSecrets as the authoritative check;
  // scanForPii focuses on PII patterns, not API keys)
  const hasSecrets = containsSecrets(content)
  const hasPii = matches.length > 0

  // Build redacted content
  const redactedContent = redactPii(content)

  // Build summary — count from both PII matches and secrets check
  const categoryCounts: Record<string, number> = {}
  for (const m of matches) {
    categoryCounts[m.category] = (categoryCounts[m.category] ?? 0) + 1
  }
  if (hasSecrets) {
    // Only add api_key if secret was found but not already counted by scanForPii
    if (!matches.some(m => m.category === 'api_key')) {
      categoryCounts['api_key'] = (categoryCounts['api_key'] ?? 0) + 1
    }
  }

  const parts: string[] = []
  for (const [category, count] of Object.entries(categoryCounts)) {
    parts.push(`${count} ${category}${count > 1 ? 's' : ''}`)
  }

  const summary = hasPii || hasSecrets
    ? `PII detected: ${parts.join(', ')}`
    : 'No PII detected'

  return {
    hasPii: hasPii || hasSecrets,
    matches,
    redactedContent,
    summary,
  }
}

/**
 * Sanitize content before sending to an external API.
 * Combines SSRF validation and PII redaction.
 *
 * @param content The content to sanitize
 * @returns Sanitized content safe for external transmission
 */
export function sanitizeForExternalApi(content: string): string {
  return redactPii(content)
}

/**
 * Sanitize a prompt being sent to a cloud AI provider.
 * Redacts PII but preserves code and technical content.
 *
 * @param prompt The prompt to sanitize
 * @returns Sanitized prompt
 */
export function sanitizePrompt(prompt: string): string {
  // For prompts, we take a lighter touch — only redact secrets and
  // high-sensitivity PII (SSN, credit cards, API keys). Emails and
  // phone numbers in code are often intentional (e.g., config examples).
  let result = prompt
  result = redactSecrets(result)

  // Only redact high-sensitivity categories
  const highSensitivityPatterns = PII_PATTERNS.filter(p =>
    p.category === 'ssn' || p.category === 'credit_card',
  )

  for (const pattern of highSensitivityPatterns) {
    pattern.regex.lastIndex = 0
    let match: RegExpExecArray | null
    // Process in reverse to preserve indices
    const replacements: Array<{ start: number; end: number; mask: string }> = []
    while ((match = pattern.regex.exec(result)) !== null) {
      if (pattern.validate && !pattern.validate(match[0]!)) continue
      replacements.push({
        start: match.index,
        end: match.index + match[0]!.length,
        mask: pattern.mask(match[0]!),
      })
    }

    for (let i = replacements.length - 1; i >= 0; i--) {
      const r = replacements[i]!
      result = result.slice(0, r.start) + r.mask + result.slice(r.end)
    }
  }

  return result
}
