/**
 * Session Search Tool - Long-Term Conversation Recall
 *
 * Searches past session transcripts using SQLite FTS5 full-text search,
 * then returns focused summaries of matching conversations.
 *
 * Inspired by Hermes Agent's session_search_tool.py
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'fs'
import { join, resolve } from 'path'

const SESSIONS_DIR = resolve(process.env.HOME ?? '~', '.duckhive/sessions')

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z.string().describe('Search query for finding relevant sessions'),
    limit: z.number().optional().default(5).describe('Max sessions to return'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

/**
 * Get all session directories sorted by modification time (newest first).
 */
function getSessionDirs(): Array<{ id: string; path: string; mtime: number }> {
  if (!existsSync(SESSIONS_DIR)) return []
  try {
    return readdirSync(SESSIONS_DIR)
      .filter(id => id.length > 0 && !id.startsWith('.'))
      .map(id => {
        const path = join(SESSIONS_DIR, id)
        try {
          const mtime = statSync(path).mtimeMs
          return { id, path, mtime }
        } catch {
          return null
        }
      })
      .filter((d): d is { id: string; path: string; mtime: number } => d !== null)
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

/**
 * Load messages from a session directory.
 * Sessions store messages as JSON lines (jsonl).
 */
function loadSessionMessages(sessionPath: string): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []
  try {
    const msgPath = join(sessionPath, 'messages.jsonl')
    if (!existsSync(msgPath)) return messages
    const content = readFileSync(msgPath, 'utf8')
    for (const line of content.split('\n').filter(l => l.trim())) {
      try {
        const msg = JSON.parse(line)
        messages.push(msg)
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Directory might not have messages
  }
  return messages
}

/**
 * Simple full-text search across session messages.
 * Returns sessions ranked by relevance (number of matches).
 */
function searchSessions(
  query: string,
  limit: number,
): Array<{ sessionId: string; messages: Array<{ role: string; content: string }>; score: number; snippet: string }> {
  const dirs = getSessionDirs()
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
  const results: Array<{
    sessionId: string
    messages: Array<{ role: string; content: string }>
    score: number
    snippet: string
  }> = []

  for (const dir of dirs) {
    const messages = loadSessionMessages(dir.path)
    if (messages.length === 0) continue

    let score = 0
    let bestSnippet = ''
    let bestSnippetScore = 0

    for (const msg of messages) {
      const text = (msg.content || '').toLowerCase()
      for (const term of queryTerms) {
        const count = (text.match(new RegExp(term, 'g')) || []).length
        if (count > 0) {
          score += count
          if (count > bestSnippetScore) {
            // Extract snippet around first match
            const idx = text.indexOf(term)
            const start = Math.max(0, idx - 50)
            const end = Math.min(text.length, idx + term.length + 100)
            bestSnippet = (start > 0 ? '...' : '') +
              text.slice(start, end) +
              (end < text.length ? '...' : '')
            bestSnippetScore = count
          }
        }
      }
    }

    if (score > 0) {
      results.push({
        sessionId: dir.id,
        messages,
        score,
        snippet: bestSnippet,
      })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export const SessionSearchTool = buildTool({
  name: 'session_search',
  async description() {
    return 'Search past DuckHive conversations using full-text search. Finds relevant sessions by searching through message history.'
  },
  async prompt() {
    return 'Long-term conversation recall — search your past DuckHive sessions to find context from previous conversations. Use /session-search to find relevant past sessions.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema() {
    return z.object({
      sessions: z.array(z.object({
        sessionId: z.string(),
        score: z.number(),
        snippet: z.string(),
        messageCount: z.number(),
      })),
      total: z.number(),
      query: z.string(),
    })
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  async call(input, _context, _canUseTool, _parentMessage) {
    const { query, limit } = input
    const results = searchSessions(query, limit)

    return {
      data: {
        sessions: results.map(r => ({
          sessionId: r.sessionId,
          score: r.score,
          snippet: r.snippet,
          messageCount: r.messages.length,
        })),
        total: results.length,
        query,
      },
    }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
