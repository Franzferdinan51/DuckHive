/**
 * BM25 keyword search layer for DuckHive.
 *
 * No external dependencies — pure TypeScript implementation of the BM25
 * ranking function (Okapi BM25) with an in-memory inverted index persisted
 * to disk as JSON.
 *
 * Usage:
 *   await bm25.buildIndex()          // initial index build (re-indexes if stale)
 *   const results = await bm25.search("typescript preferences", 5)
 *   await bm25.updateIndex(docId, newContent)
 *   await bm25.clearIndex()
 */

import { unlinkSync } from 'fs'
import { readdir, readFile, stat, writeFile, mkdir } from 'fs/promises'
import { join, dirname, sep as pathSep } from 'path'
import { getMemoryBaseDir } from './paths.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default index file path in DuckHive's data directory. */
export function getBm25IndexPath(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(configHomeDir, 'bm25-index.json')
}

export const DEFAULT_INDEX_PATH = getBm25IndexPath()

/** BM25 parameters */
const BM25_K1 = 1.5
const BM25_B = 0.75

/** Average document length for BM25 (recomputed on each buildIndex). */
const AVG_DOC_LEN_DEFAULT = 100

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Bm25Result {
  docId: string
  path: string
  score: number
}

interface IndexFile {
  path: string
  /** Last modified time in ms — used to detect stale index. */
  mtimeMs: number
  /** Total raw token count (whitespace-split, pre-filter). */
  tokenCount: number
}

interface InvertedPosting {
  docId: string
  /** Term frequency in this document. */
  tf: number
}

interface Bm25Index {
  /** Inverted index: term → sorted posting list (desc tf). */
  inverted: Record<string, InvertedPosting[]>
  /** Map from docId → file metadata. */
  docs: Record<string, IndexFile>
  /** Average document length (avg tokenCount across all docs). */
  avgDocLen: number
  /** Total number of documents. */
  n: number
  /** Index build timestamp (ms). */
  builtAt: number
  /** Source directories that were indexed. */
  sources: string[]
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Split text into lowercase tokens.
 * Strip punctuation, split on whitespace.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Remove most punctuation except alphanumeric, dash, underscore.
    .replace(/[^a-z0-9\s\-_]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0)
}

// ---------------------------------------------------------------------------
// BM25 Scorer (from scratch)
// ---------------------------------------------------------------------------

/**
 * Compute BM25 scores for all documents against a query.
 *
 * Formula:
 *   score(D, Q) = sum_{q in Q} IDF(q) * (tf(q,D) * (k1 + 1))
 *                                     / (tf(q,D) + k1 * (1 - b + b * |D|/avgdl))
 *
 * IDF = log((N - n_q + 0.5) / (n_q + 0.5))
 *
 * @param queryTokens  Lowercase query tokens.
 * @param index       The BM25 index.
 * @param docId       Document ID to score.
 * @returns           BM25 score (can be 0 if no term overlap).
 */
function scoreDoc(
  queryTokens: string[],
  index: Bm25Index,
  docId: string,
): number {
  const doc = index.docs[docId]
  if (!doc) return 0

  let score = 0
  const docLen = doc.tokenCount
  const avgdl = index.avgDocLen

  for (const term of queryTokens) {
    const postings = index.inverted[term]
    if (!postings) continue

    // Find this doc's posting
    const posting = postings.find(p => p.docId === docId)
    if (!posting) continue

    const tf = posting.tf
    const n_q = postings.length // number of docs containing this term

    // IDF with smoothing to handle unseen terms
    const idf = Math.log((index.n - n_q + 0.5) / (n_q + 0.5) + 1)

    // BM25 term component
    const numerator = tf * (BM25_K1 + 1)
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgdl))

    score += idf * (numerator / denominator)
  }

  return score
}

// ---------------------------------------------------------------------------
// Disk I/O helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch {
    // EEXIST is fine
  }
}

async function readIndex(path: string): Promise<Bm25Index | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as Bm25Index
  } catch {
    return null
  }
}

async function writeIndex(path: string, index: Bm25Index): Promise<void> {
  const dir = dirname(path)
  await ensureDir(dir)
  await writeFile(path, JSON.stringify(index), 'utf-8')
}

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

interface DiscoveredDoc {
  docId: string
  path: string
  mtimeMs: number
  tokenCount: number
}

/**
 * Discover indexable documents in a directory tree.
 * Supports .md, .txt, .json, .jsonl files up to MAX_DEPTH levels.
 */
async function discoverDocs(
  rootDir: string,
  maxDepth = 3,
): Promise<DiscoveredDoc[]> {
  const results: DiscoveredDoc[] = []

  try {
    const entries = await readdir(rootDir, { recursive: true })
    for (const relativePath of entries) {
      // Enforce depth limit
      const depth = relativePath.split(pathSep).length - 1
      if (depth >= maxDepth) continue

      const fullPath = join(rootDir, relativePath)
      // Only index files, not directories
      try {
        const s = await stat(fullPath)
        if (!s.isFile()) continue
      } catch {
        continue
      }

      const ext = relativePath.split('.').pop()?.toLowerCase() ?? ''
      // Index: .md, .txt, .json, .jsonl, .ts, .js
      if (!['md', 'txt', 'json', 'jsonl', 'ts', 'js'].includes(ext)) continue

      const mtimeMs = (await stat(fullPath)).mtimeMs
      let content = ''
      try {
        content = await readFile(fullPath, 'utf-8')
      } catch {
        continue
      }
      const tokens = tokenize(content)
      const docId = `duckhive:${relativePath.replace(/\\/g, '/')}`

      results.push({
        docId,
        path: fullPath,
        mtimeMs,
        tokenCount: tokens.length,
      })
    }
  } catch {
    // Directory doesn't exist or not readable — skip
  }

  return results
}

/**
 * Get all directories to index (the sources for BM25).
 * Returns array of {dir, label} tuples.
 */
export function getBm25IndexSources(
  configHomeDir = getClaudeConfigHomeDir(),
  memoryBaseDir = getMemoryBaseDir(),
): { dir: string; label: string }[] {
  return [
    { dir: join(memoryBaseDir, 'memory', 'memories'), label: 'memory' },
    { dir: join(memoryBaseDir, 'memory'), label: 'memory-root' },
    { dir: join(configHomeDir, 'exports'), label: 'exports' },
    { dir: join(configHomeDir, 'imports'), label: 'imports' },
    { dir: join(configHomeDir, 'mempalace'), label: 'mempalace' },
  ]
}

// ---------------------------------------------------------------------------
// BM25 Service
// ---------------------------------------------------------------------------

export class Bm25Service {
  private index: Bm25Index | null = null
  private indexPath: string
  private indexReady: Promise<void> | null = null

  constructor(indexPath = DEFAULT_INDEX_PATH) {
    this.indexPath = indexPath
  }

  /**
   * Load index from disk and check staleness.
   * Returns true if the loaded index is fresh (not older than any source).
   */
  async isIndexFresh(): Promise<boolean> {
    const loaded = await readIndex(this.indexPath)
    if (!loaded) return false

    // Check if any source is newer than the index
    const sources = getBm25IndexSources()
    for (const { dir } of sources) {
      try {
        const entries = await readdir(dir, { recursive: true })
        for (const entry of entries) {
          const fullPath = join(dir, entry)
          try {
            const s = await stat(fullPath)
            if (s.mtimeMs > loaded.builtAt) return false
          } catch {
            // Skip unreadable
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return true
  }

  /**
   * Build (or rebuild) the BM25 index from all DuckHive sources.
   * Checks staleness — if index is fresh, skips rebuild.
   * @param force Force rebuild even if index is fresh.
   */
  async buildIndex(force = false): Promise<{ docCount: number; durationMs: number }> {
    const start = Date.now()

    // Check freshness unless forced
    if (!force) {
      const fresh = await this.isIndexFresh()
      if (fresh && this.index) {
        return { docCount: this.index.n, durationMs: Date.now() - start }
      }
    }

    const sources = getBm25IndexSources()
    const allDocs: DiscoveredDoc[] = []
    const docMap: Record<string, IndexFile> = {}

    // Scan all sources
    for (const { dir, label } of sources) {
      const docs = await discoverDocs(dir)
      for (const doc of docs) {
        // Avoid duplicates (same file in multiple sources)
        if (!docMap[doc.docId]) {
          docMap[doc.docId] = { path: doc.path, mtimeMs: doc.mtimeMs, tokenCount: doc.tokenCount }
          allDocs.push(doc)
        }
      }
    }

    // Build inverted index
    const inverted: Record<string, InvertedPosting[]> = {}
    const n = allDocs.length

    if (n === 0) {
      this.index = {
        inverted: {},
        docs: docMap,
        avgDocLen: AVG_DOC_LEN_DEFAULT,
        n: 0,
        builtAt: Date.now(),
        sources: sources.map(s => s.label),
      }
      await writeIndex(this.indexPath, this.index)
      return { docCount: 0, durationMs: Date.now() - start }
    }

    // Count tokens per document
    const docTokenCounts: Record<string, number> = {}
    for (const doc of allDocs) {
      docTokenCounts[doc.docId] = doc.tokenCount
    }

    // Build inverted index: collect term frequencies per document
    for (const doc of allDocs) {
      let content = ''
      try {
        content = await readFile(doc.path, 'utf-8')
      } catch {
        continue
      }
      const tokens = tokenize(content)
      // Update token count to actual
      docMap[doc.docId].tokenCount = tokens.length
      docTokenCounts[doc.docId] = tokens.length

      const seen: string[] = []
      for (const term of tokens) {
        if (!seen.includes(term)) {
          seen.push(term)
          const tf = tokens.filter(t => t === term).length
          if (!inverted[term]) inverted[term] = []
          inverted[term].push({ docId: doc.docId, tf })
        }
      }
    }

    // Sort posting lists by tf descending
    for (const term of Object.keys(inverted)) {
      inverted[term].sort((a, b) => b.tf - a.tf)
    }

    const totalTokens = Object.values(docTokenCounts).reduce((s, v) => s + v, 0)
    const avgDocLen = totalTokens / n

    this.index = {
      inverted,
      docs: docMap,
      avgDocLen,
      n,
      builtAt: Date.now(),
      sources: sources.map(s => s.label),
    }

    await writeIndex(this.indexPath, this.index)

    return { docCount: n, durationMs: Date.now() - start }
  }

  /**
   * Search the index for query, return top-N results with BM25 scores.
   * Builds index automatically if not yet loaded.
   *
   * @param query       Search query string.
   * @param limit       Max results to return (default 10).
   * @returns           Sorted results (highest score first).
   */
  async search(query: string, limit = 10): Promise<Bm25Result[]> {
    // Ensure index is loaded
    if (!this.index) {
      const loaded = await readIndex(this.indexPath)
      if (loaded) {
        this.index = loaded
      } else {
        // No index — build one
        await this.buildIndex()
      }
    }

    if (!this.index || this.index.n === 0) {
      return []
    }

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const index = this.index!  // non-null: checked above with early return
    const scored: { docId: string; score: number }[] = []

    for (const docId of Object.keys(index.docs)) {
      const score = scoreDoc(queryTokens, index, docId)
      if (score > 0) {
        scored.push({ docId, score })
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, limit).map(({ docId, score }) => ({
      docId,
      path: index.docs[docId]?.path ?? docId,
      score: Math.round(score * 1000) / 1000, // round to 3 decimal places
    }))
  }

  /**
   * Update or add a document in the index (incremental, no full rebuild).
   * Persists the updated index to disk.
   *
   * @param docId   Unique document ID (e.g. "duckhive:memory/my-note.md")
   * @param content New content for the document.
   */
  async updateIndex(docId: string, content: string): Promise<void> {
    if (!this.index) {
      const loaded = await readIndex(this.indexPath)
      this.index = loaded ?? {
        inverted: {},
        docs: {},
        avgDocLen: AVG_DOC_LEN_DEFAULT,
        n: 0,
        builtAt: Date.now(),
        sources: [],
      }
    }

    const tokens = tokenize(content)
    const mtimeMs = Date.now()

    // Remove old postings for this docId (from all terms)
    const oldTerms = new Set<string>()
    for (const [term, postings] of Object.entries(this.index.inverted)) {
      const before = postings.length
      this.index.inverted[term] = postings.filter(p => p.docId !== docId)
      if (this.index.inverted[term].length !== before) {
        oldTerms.add(term)
      }
    }

    // Remove terms with empty posting lists
    const idx = this.index!  // guaranteed non-null after init block above
    oldTerms.forEach(term => {
      if (idx.inverted[term]?.length === 0) {
        delete idx.inverted[term]
      }
    })

    // Add new postings
    const seen: string[] = []
    for (const term of tokens) {
      if (!seen.includes(term)) {
        seen.push(term)
        const tf = tokens.filter(t => t === term).length
        if (!this.index.inverted[term]) this.index.inverted[term] = []
        // Insert sorted by tf desc
        const postings = this.index.inverted[term]
        const insertAt = postings.findIndex(p => p.tf < tf)
        if (insertAt === -1) {
          postings.push({ docId, tf })
        } else {
          postings.splice(insertAt, 0, { docId, tf })
        }
      }
    }

    // Update doc metadata
    this.index.docs[docId] = {
      path: docId, // docId IS the path-ish key, preserve old path if different
      mtimeMs,
      tokenCount: tokens.length,
    }
    this.index.n = Object.keys(this.index.docs).length

    // Recompute avgDocLen
    const totalTokens = Object.values(this.index.docs).reduce((s, d) => s + d.tokenCount, 0)
    this.index.avgDocLen = this.index.n > 0 ? totalTokens / this.index.n : AVG_DOC_LEN_DEFAULT
    this.index.builtAt = Date.now()

    await writeIndex(this.indexPath, this.index)
  }

  /**
   * Clear the index from memory and delete the on-disk index file.
   */
  async clearIndex(): Promise<void> {
    this.index = null
    try {
      unlinkSync(this.indexPath)
    } catch {
      // File didn't exist — that's fine
    }
  }

  /**
   * Get index statistics without rebuilding.
   */
  getStats(): { docCount: number; termCount: number; builtAt: number; avgDocLen: number; sources: string[] } | null {
    if (!this.index) return null
    return {
      docCount: this.index.n,
      termCount: Object.keys(this.index.inverted).length,
      builtAt: this.index.builtAt,
      avgDocLen: Math.round(this.index.avgDocLen),
      sources: this.index.sources,
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------

export const bm25 = new Bm25Service()
