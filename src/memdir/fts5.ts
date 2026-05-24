/**
 * SQLite FTS5 full-text search layer for DuckHive memory and sessions.
 *
 * Layers over existing file-based storage for durability.
 * Blends FTS5 results with existing BM25 scores for hybrid ranking.
 *
 * Usage:
 *   import { fts5, initFts5, searchFts5 } from './memdir/fts5.js'
 *   await initFts5()
 *   const results = await searchFts5("typescript preferences", 5)
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import Database from 'better-sqlite3'
import { getMemoryBaseDir } from './paths.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export function getFts5DbPath(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(configHomeDir, 'fts5.db')
}

export function getFts5MemoryDir(
  memoryBaseDir = getMemoryBaseDir(),
): string {
  return join(memoryBaseDir, 'memory')
}

export function getFts5SessionsDir(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(configHomeDir, 'sessions')
}

// Lazy-initialized to avoid stale paths from module-level getClaudeConfigHomeDir()
let DB_PATH: string | undefined
let MEMORY_DIR: string | undefined
let SESSIONS_DIR: string | undefined

function getDbPath(): string {
  if (!DB_PATH) DB_PATH = getFts5DbPath()
  return DB_PATH
}

function getMemoryDir(): string {
  if (!MEMORY_DIR) MEMORY_DIR = getFts5MemoryDir()
  return MEMORY_DIR
}

function getSessionsDir(): string {
  if (!SESSIONS_DIR) SESSIONS_DIR = getFts5SessionsDir()
  return SESSIONS_DIR
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Fts5Result {
  docId: string
  path: string
  score: number
  snippet: string
}

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db) return _db

  // Ensure directory exists
  const dbPath = getDbPath()
  const dir = dirname(dbPath)
    try {
      mkdirSync(dir, { recursive: true })
    } catch { /* already exists */ }

    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('synchronous = NORMAL')
    _db.pragma('cache_size = -64000') // 64MB cache

    // Create FTS5 virtual table
    _db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        path UNINDEXED,
        filename,
        content,
        tokenize='porter unicode61'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        doc_id UNINDEXED,
        content,
        tokenize='porter unicode61'
      );
    `)

    // Prepared statements are created lazily via _insertMemory, _deleteMemory,
    // and _searchMemories helpers — no need to execute parameterized queries here.
  return _db
}

// ---------------------------------------------------------------------------
// Insert / Delete
// ---------------------------------------------------------------------------

const _insertMemory = (db: Database.Database) =>
  db.prepare('INSERT OR REPLACE INTO memories_fts(path, filename, content) VALUES (?, ?, ?)')
const _deleteMemory = (db: Database.Database) =>
  db.prepare('DELETE FROM memories_fts WHERE path = ?')
const _searchMemories = (db: Database.Database) =>
  db.prepare(`
    SELECT path, filename, snippet(memories_fts, 2, '[', ']', '...', 20) as snippet,
           bm25(memories_fts) as score
    FROM memories_fts
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `)

/**
 * Index a single memory file by its path.
 * Reads the file, extracts filename + content, upserts into FTS5.
 */
export function indexMemoryFile(filePath: string): void {
  if (!existsSync(filePath)) return
  try {
    const content = readFileSync(filePath, 'utf-8')
    const filename = filePath.split('/').pop() ?? ''
    const db = getDb()
    _insertMemory(db).run(filePath, filename, content)
  } catch (err) {
    logForDebugging(`[fts5] indexMemoryFile failed for ${filePath}: ${err}`)
  }
}

/**
 * Remove a memory file from the FTS5 index.
 */
export function deleteMemoryFile(filePath: string): void {
  try {
    const db = getDb()
    _deleteMemory(db).run(filePath)
  } catch (err) {
    logForDebugging(`[fts5] deleteMemoryFile failed for ${filePath}: ${err}`)
  }
}

/**
 * Search memory FTS5 index.
 * Returns top-N results with BM25 score and snippet.
 */
export function searchMemoriesFts5(query: string, limit = 10): Fts5Result[] {
  if (!query.trim()) return []
  try {
    const db = getDb()
    // FTS5 query syntax: escape special chars and wrap for phrase search
    const ftsQuery = query
      .replace(/['"]/g, '')
      .split(/\s+/)
      .map(t => `"${t}"*`)
      .join(' ')

    const rows = _searchMemories(db).all(ftsQuery, limit) as Array<{
      path: string
      filename: string
      snippet: string
      score: number
    }>

    return rows.map(row => ({
      docId: row.path,
      path: row.path,
      score: Math.abs(row.score), // bm25() returns negative values in FTS5
      snippet: row.snippet ?? '',
    }))
  } catch (err) {
    logForDebugging(`[fts5] searchMemoriesFts5 failed: ${err}`)
    return []
  }
}

/**
 * Index all memory files from DuckHive's shared memory base.
 * Call this on startup to bootstrap the FTS5 index.
 */
export function indexAllMemoryFiles(): void {
  const memoryDir = getMemoryDir()
  if (!existsSync(memoryDir)) return
  try {
    const files = readdirSync(memoryDir).filter(f => f.endsWith('.md'))
    for (const file of files) {
      const filePath = join(memoryDir, file)
      indexMemoryFile(filePath)
    }
    logForDebugging(`[fts5] indexed ${files.length} memory files`)
  } catch (err) {
    logForDebugging(`[fts5] indexAllMemoryFiles failed: ${err}`)
  }
}

/**
 * Index session files from DuckHive's resolved sessions directory.
 * Indexes the first non-system line as the session summary.
 */
export function indexAllSessionFiles(): void {
  const sessionsDir = getSessionsDir()
  if (!existsSync(sessionsDir)) return
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const filePath = join(sessionsDir, file)
      const sessionId = file.replace('.jsonl', '')
      try {
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n').filter(l => l.trim())
        // Find first non-system line as session summary
        const summaryLine = lines.find(l => {
          try {
            const msg = JSON.parse(l)
            return msg && typeof msg === 'object' && (msg as Record<string, unknown>).type !== 'system'
              && (msg as Record<string, unknown>).type !== 'progress'
          } catch { return false }
        })
        if (summaryLine) {
          try {
            const msg = JSON.parse(summaryLine) as Record<string, unknown>
            const text = typeof msg.content === 'string' ? msg.content : String(summaryLine)
            if (text.length > 10) {
              indexSessionFile(`session:${sessionId}`, text.slice(0, 2000))
            }
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable */ }
    }
    logForDebugging(`[fts5] indexed ${files.length} session files`)
  } catch (err) {
    logForDebugging(`[fts5] indexAllSessionFiles failed: ${err}`)
  }
}

/**
 * Index a single session file by its docId + content.
 */
export function indexSessionFile(docId: string, content: string): void {
  try {
    const db = getDb()
    db.prepare('INSERT OR REPLACE INTO sessions_fts(doc_id, content) VALUES (?, ?)')
      .run(docId, content)
  } catch (err) {
    logForDebugging(`[fts5] indexSessionFile failed for ${docId}: ${err}`)
  }
}

/**
 * Search session FTS5 index.
 */
export function searchSessionsFts5(query: string, limit = 10): Fts5Result[] {
  if (!query.trim()) return []
  try {
    const db = getDb()
    const ftsQuery = query
      .replace(/['"]/g, '')
      .split(/\s+/)
      .map(t => `"${t}"*`)
      .join(' ')

    const rows = db.prepare(`
      SELECT doc_id, snippet(sessions_fts, 1, '[', ']', '...', 20) as snippet,
             bm25(sessions_fts) as score
      FROM sessions_fts
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, limit) as Array<{
      doc_id: string
      snippet: string
      score: number
    }>

    return rows.map(row => ({
      docId: row.doc_id,
      path: row.doc_id,
      score: Math.abs(row.score),
      snippet: row.snippet ?? '',
    }))
  } catch (err) {
    logForDebugging(`[fts5] searchSessionsFts5 failed: ${err}`)
    return []
  }
}

/**
 * Get total indexed document count.
 */
export function getFts5Stats(): { memoryCount: number; sessionCount: number } {
  try {
    const db = getDb()
    const memCount = (db.prepare('SELECT COUNT(*) as c FROM memories_fts').get() as { c: number }).c
    const sessCount = (db.prepare('SELECT COUNT(*) as c FROM sessions_fts').get() as { c: number }).c
    return { memoryCount: memCount, sessionCount: sessCount }
  } catch {
    return { memoryCount: 0, sessionCount: 0 }
  }
}

// ---------------------------------------------------------------------------
// Debug logger (avoid circular deps)
// ---------------------------------------------------------------------------

function logForDebugging(msg: string): void {
  // eslint-disable-next-line no-console
  console.debug(`[fts5] ${msg}`)
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let _initialized = false

/**
 * Initialize FTS5 — indexes memory files and session files.
 * Safe to call multiple times (idempotent).
 */
export async function initFts5(): Promise<void> {
  if (_initialized) return
  _initialized = true
  // Ensure DB is created (triggers table creation)
  getDb()
  indexAllMemoryFiles()
  indexAllSessionFiles()
}
