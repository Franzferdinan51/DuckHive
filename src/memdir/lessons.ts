/**
 * LESSONS.md — permanent failure moat
 *
 * Append-only log of failures and pitfalls encountered across sessions.
 * Unlike session-level memory (which gets compacted), LESSONS.md grows forever
 * and is checked at the start of every session.
 *
 * Inspired by Aiden's 6-layer memory system (LESSONS.md layer).
 * Unlike the rest of DuckHive's memory, LESSONS.md is NEVER compacted,
 * NEVER erased, and grows every session.
 *
 * File location: <memdir>/LESSONS.md
 *
 * Format:
 *   ## [YYYY-MM-DD] <category> — <one-line summary>
 *   Context: <what we tried, what happened>
 *   Lesson:  <what to do instead>
 *   Tags:    <failure-type>
 *   ---
 *
 * Categories: provider-failure | tool-error | api-limit | infra | code-pattern | permission
 */

import { appendFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getAutoMemPath } from './paths.js'
import { logForDebugging } from '../debug.js'

// ─── Paths ───────────────────────────────────────────────────────────────────

export function getLessonsPath(): string {
  return join(getAutoMemPath(), 'LESSONS.md')
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type LessonCategory =
  | 'provider-failure'
  | 'tool-error'
  | 'api-limit'
  | 'infra'
  | 'code-pattern'
  | 'permission'
  | 'security'
  | 'memory'
  | 'model-bug'

export type LessonEntry = {
  date: string                    // YYYY-MM-DD
  category: LessonCategory
  summary: string                 // one-liner
  context: string                 // what failed
  lesson: string                  // what to do instead
  tags: string[]
}

export type LessonLookup = {
  byCategory: (cat: LessonCategory) => LessonEntry[]
  byTag: (tag: string) => LessonEntry[]
  recent: (n?: number) => LessonEntry[]
  all: () => LessonEntry[]
  check: (query: string) => LessonEntry[]  // fuzzy match against summary + context
}

// ─── Write ───────────────────────────────────────────────────────────────────

function tagsToString(tags: string[]): string {
  return tags.length > 0 ? `Tags:    ${tags.join(', ')}` : ''
}

function formatEntry(entry: LessonEntry): string {
  const lines = [
    `## [${entry.date}] ${entry.category} — ${entry.summary}`,
    `Context: ${entry.context}`,
    `Lesson:  ${entry.lesson}`,
    tagsToString(entry.tags),
    '---',
    '',
  ]
  return lines.filter(l => l.trim() !== '' || l === '').join('\n')
}

/**
 * Append a failure lesson to LESSONS.md.
 * Call this whenever the agent encounters a repeating mistake or
 * a provider/tool failure that has a clear workaround.
 *
 * @param entry Lesson to record (date auto-set to today if omitted)
 * @param autoDeduplicate If true, skips appending if an identical summary exists
 */
export function recordLesson(
  entry: Omit<LessonEntry, 'date'> & { date?: string },
  autoDeduplicate = true,
): void {
  const { category, summary, context, lesson, tags, date } = entry

  if (autoDeduplicate && hasSimilarLesson(summary)) {
    logForDebugging(`[LESSONS] Skipped duplicate: ${summary}`)
    return
  }

  const resolvedDate = date ?? new Date().toISOString().slice(0, 10)
  const fullEntry: LessonEntry = { date: resolvedDate, category, summary, context, lesson, tags }

  const content = formatEntry(fullEntry)
  const path = getLessonsPath()

  try {
    appendFileSync(path, content, 'utf-8')
    // Append to cache so next read doesn't re-parse the entire file
    if (_cachedEntries) {
      _cachedEntries.push(fullEntry)
    }
    logForDebugging(`[LESSONS] Recorded: ${category} — ${summary}`)
  } catch (err) {
    logForDebugging(`[LESSONS] Failed to write: ${err}`)
  }
}

/**
 * Convenience wrapper: record a provider failure.
 * Call when an LLM API fails with a specific error that has a known workaround.
 */
export function recordProviderFailure(
  provider: string,
  errorPattern: string,
  workaround: string,
  summary?: string,
): void {
  recordLesson({
    category: 'provider-failure',
    summary: summary ?? `${provider}: ${errorPattern.slice(0, 80)}`,
    context: `Provider: ${provider}\nError: ${errorPattern}`,
    lesson: workaround,
    tags: ['provider', provider],
  })
}

/**
 * Convenience wrapper: record a tool error with workaround.
 */
export function recordToolError(
  tool: string,
  error: string,
  workaround: string,
  summary?: string,
): void {
  recordLesson({
    category: 'tool-error',
    summary: summary ?? `${tool}: ${error.slice(0, 80)}`,
    context: `Tool: ${tool}\nError: ${error}`,
    lesson: workaround,
    tags: ['tool', tool],
  })
}

/**
 * Convenience wrapper: record an API limit hit.
 */
export function recordApiLimit(
  provider: string,
  limitType: string,
  workaround: string,
  summary?: string,
): void {
  recordLesson({
    category: 'api-limit',
    summary: summary ?? `${provider} ${limitType} hit`,
    context: `Provider: ${provider}\nLimit type: ${limitType}`,
    lesson: workaround,
    tags: ['api-limit', provider],
  })
}

// ─── Cache ──────────────────────────────────────────────────────────────────

/** Cached parsed entries. Set to null to force re-read from disk. */
let _cachedEntries: LessonEntry[] | null = null

/** For testing: clear the cache to force re-read from disk. */
export function clearLessonsCache(): void {
  _cachedEntries = null
}

// ─── Read ───────────────────────────────────────────────────────────────────

function parseEntries(content: string): LessonEntry[] {
  if (!content.trim()) return []

  const entries: LessonEntry[] = []
  const blocks = content.split(/^## \[/m)

  for (const block of blocks) {
    if (!block.trim()) continue

    // block starts with "YYYY-MM-DD] category — summary"
    const headerMatch = block.match(/^(\d{4}-\d{2}-\d{2})\]\s+(\S+)\s+—\s+(.+)/)
    if (!headerMatch) continue

    const [, date, category, summary] = headerMatch
    const rest = block.slice(headerMatch[0].length)

    const contextMatch = rest.match(/Context:\s*(.+?)(?=Lesson:|$)/s)
    const lessonMatch = rest.match(/Lesson:\s*(.+?)(?=Tags:|$)/s)
    const tagsMatch = rest.match(/Tags:\s*(.+?)(?=---|$)/s)

    entries.push({
      date,
      category: category as LessonEntry['category'],
      summary: summary.trim(),
      context: contextMatch?.[1]?.trim() ?? '',
      lesson: lessonMatch?.[1]?.trim() ?? '',
      tags: tagsMatch?.[1]?.split(',').map(t => t.trim()).filter(Boolean) ?? [],
    })
  }

  return entries
}

function readAllEntries(): LessonEntry[] {
  if (_cachedEntries) return _cachedEntries
  const path = getLessonsPath()
  if (!existsSync(path)) {
    _cachedEntries = []
    return []
  }
  try {
    _cachedEntries = parseEntries(readFileSync(path, 'utf-8'))
    return _cachedEntries
  } catch {
    _cachedEntries = []
    return []
  }
}

export function getLessonLookup(): LessonLookup {

  return {
    byCategory(cat): LessonEntry[] {
      return readAllEntries().filter(e => e.category === cat)
    },

    byTag(tag): LessonEntry[] {
      return readAllEntries().filter(e => e.tags.includes(tag))
    },

    recent(n = 20): LessonEntry[] {
      return readAllEntries().slice(-n)
    },

    all(): LessonEntry[] {
      return readAllEntries()
    },

    check(query): LessonEntry[] {
      const q = query.toLowerCase()
      return readAllEntries().filter(
        e =>
          e.summary.toLowerCase().includes(q) ||
          e.context.toLowerCase().includes(q) ||
          e.lesson.toLowerCase().includes(q),
      )
    },
  }
}

/**
 * Returns true if a lesson with an identical (or near-identical) summary exists.
 * Used to avoid deduplicating failures.
 */
function hasSimilarLesson(summary: string, threshold = 0.8): boolean {
  const all = readAllEntries()
  if (all.length === 0) return false

  const normalized = summary.toLowerCase()
  for (const entry of all) {
    const entryNorm = entry.summary.toLowerCase()
    // Exact or very close → skip
    if (
      entryNorm === normalized ||
      (entryNorm.includes(normalized) || normalized.includes(entryNorm))
    ) {
      return true
    }
    // Word-level similarity
    const entryWords = entryNorm.split(/\s+/)
    const queryWords = normalized.split(/\s+/)
    const overlap = entryWords.filter(w => queryWords.includes(w))
    const sim = overlap.length / Math.max(entryWords.length, queryWords.length)
    if (sim >= threshold) return true
  }

  return false
}

// ─── Pre-flight check ─────────────────────────────────────────────────────────

/**
 * Called at session start. Returns lessons relevant to the current task
 * by checking a query string (e.g. "TurboQuant" returns relevant lessons).
 *
 * Embed this in the system prompt builder or memory injection.
 */
export function getLessonsForTask(task: string): string {
  const lookup = getLessonLookup()
  const hits = lookup.check(task)
  if (hits.length === 0) return ''

  const lines = [
    '\n--- FAILURE MOAT (from LESSONS.md) ---\n',
    `Found ${hits.length} lesson(s) for "${task}":\n`,
  ]

  for (const h of hits.slice(-5)) {
    // Show most recent 5
    lines.push(`[${h.category}] ${h.summary}`)
    lines.push(`  → ${h.lesson}`)
  }

  lines.push('---\n')
  return lines.join('\n')
}

/**
 * Auto-record from error signals in tool results.
 * Call this at the end of any tool call that returned an error.
 *
 * Currently a no-op stub — the agent is expected to call recordLesson()
 * explicitly when it learns something. Hook this into the error handler
 * for automatic failure tracking.
 */
export function autoRecordFromError(
  toolName: string,
  error: string,
  _agentId?: string,
): void {
  // Minimal heuristic: look for known patterns
  const known: Array<{ pattern: string; category: LessonCategory; workaround: string }> = [
    {
      pattern: 'rate limit|429|quota',
      category: 'api-limit',
      workaround: 'Switch to fallback provider or wait and retry',
    },
    {
      pattern: 'timeout|ECONNRESET|ETIMEDOUT',
      category: 'infra',
      workaround: 'Retry with exponential backoff, check network',
    },
    {
      pattern: 'permission denied|access denied|EACCES',
      category: 'permission',
      workaround: 'Check file permissions or run with elevated privileges',
    },
    {
      pattern: 'ENOENT|no such file|not found',
      category: 'tool-error',
      workaround: 'Verify file path, check if resource was deleted',
    },
  ]

  const lowerError = error.toLowerCase()
  for (const { pattern, category, workaround } of known) {
    if (lowerError.includes(pattern)) {
      recordLesson({
        category,
        summary: `${toolName}: ${pattern}`,
        context: error,
        lesson: workaround,
        tags: [toolName, category],
      })
      break
    }
  }
}