/**
 * embedRecall.ts — Semantic/conceptual recall as the 3rd memory layer.
 *
 * Layer order in DuckHive recall:
 *   1. BM25 keyword search  (findRelevantMemories.ts — semantic header matching)
 *   2. embedRecall         ← this layer  (TF-IDF cosine similarity, or LM Studio embeddings)
 *   3. LESSONS             (lessons.ts — distilled learnings)
 *
 * Architecture:
 *   - Primary: TF-IDF cosine similarity (no external API calls needed)
 *   - Enhancement: LM Studio /v1/embeddings if LM_STUDIO_URL is set and reachable
 *   - Index stored in DuckHive's resolved config home as embed-index.json
 *
 * Public API:
 *   indexDocument(id, text)  — add/update a document in the embedding index
 *   search(query, opts?)      — cosine-similarity search, returns top-K results
 *   clearIndex()              — wipe all embeddings
 *
 * Auto-index on startup: indexSessionContent() scans session logs and indexes them.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createCombinedAbortSignal } from '../utils/combinedAbortSignal.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

// ─── Config ───────────────────────────────────────────────────────────────────

export function getEmbedRecallIndexDir(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return configHomeDir
}

export function getEmbedRecallIndexPath(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(getEmbedRecallIndexDir(configHomeDir), 'embed-index.json')
}

export function getEmbedRecallSessionsDir(
  configHomeDir = getClaudeConfigHomeDir(),
): string {
  return join(configHomeDir, 'sessions')
}

const INDEX_DIR = getEmbedRecallIndexDir()
const INDEX_PATH = getEmbedRecallIndexPath()

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IndexedDoc {
  id: string
  text: string
  // TF-IDF sparse vector: term → tf-idf score
  vector: Record<string, number>
  indexedAt: number
}

export interface SearchResult {
  id: string
  text: string
  score: number
}

export interface SearchOptions {
  topK?: number       // default 5
  minScore?: number   // minimum cosine similarity threshold, default 0.1
}

interface EmbedIndex {
  docs: IndexedDoc[]
  version: number
}

// ─── Embedding provider (configurable) ───────────────────────────────────────
// Supports: 'lmstudio' (default, local), 'openai', 'ollama'
const EMBEDDING_PROVIDER = process.env['EMBEDDING_PROVIDER'] ?? 'lmstudio'
const LM_STUDIO_URL = process.env['LM_STUDIO_URL'] ?? 'http://localhost:1234'
const OPENAI_URL = process.env['OPENAI_EMBEDDING_URL'] ?? 'https://api.openai.com/v1/embeddings'
const OPENAI_MODEL = process.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small'
const OPENAI_API_KEY = process.env['OPENAI_API_KEY'] ?? ''

async function getEmbedding(text: string): Promise<Record<string, number> | null> {
  if (EMBEDDING_PROVIDER === 'openai') {
    return getOpenAIEmbedding(text)
  }
  // Default: LM Studio (local)
  return getLmStudioEmbedding(text)
}

async function getOpenAIEmbedding(text: string): Promise<Record<string, number> | null> {
  try {
    if (!OPENAI_API_KEY) return null
    const { signal, cleanup } = createCombinedAbortSignal(undefined, { timeoutMs: 10000 })
    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text, model: OPENAI_MODEL }),
      signal,
    }).finally(cleanup)
    if (!res.ok) return null
    const data = (await res.json()) as { data?: { embedding?: number[] }[] }
    const embedding = data?.data?.[0]?.embedding
    if (!embedding) return null
    // Quantize to 128 buckets for uniform sparse similarity API
    const sparse: Record<string, number> = {}
    for (let i = 0; i < embedding.length; i++) {
      const bucket = Math.floor((embedding[i] + 1) * 64)
      sparse[`d${i}_b${bucket}`] = 1
    }
    return sparse
  } catch {
    return null
  }
}

async function getLmStudioEmbedding(text: string): Promise<Record<string, number> | null> {
  try {
    const { signal, cleanup } = createCombinedAbortSignal(undefined, {
      timeoutMs: 5000,
    })
    const res = await fetch(`${LM_STUDIO_URL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: text,
        model: '',  // let LM Studio choose default
      }),
      signal,
    }).finally(cleanup)
    if (!res.ok) return null
    const data = (await res.json()) as { data?: { embedding?: number[] }[] }
    const embedding = data?.data?.[0]?.embedding
    if (!embedding) return null

    // Convert dense embedding to sparse hash-based (for uniform cosine-similarity API)
    // We quantize to 128 buckets to keep the index small and avoid external deps.
    const sparse: Record<string, number> = {}
    for (let i = 0; i < embedding.length; i++) {
      const bucket = Math.floor((embedding[i] + 1) * 64) // [-1,1] → [0,127]
      sparse[`d${i}_b${bucket}`] = 1
    }
    return sparse
  } catch {
    return null
  }
}

// ─── TF-IDF helpers ───────────────────────────────────────────────────────────

/** Tokenize text into lowercase terms (simple word split + stopword removal) */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t))
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','was','are','were','be','been','being','have',
  'has','had','do','does','did','will','would','should','could','may',
  'might','can','this','that','these','those','i','you','he','she',
  'it','we','they','what','which','who','when','where','why','how',
  'not','no','so','if','then','else','there','here','up','down','out',
  'more','most','some','any','all','each','every','both','few','many',
])

/** Compute TF (term frequency) for a document */
function computeTf(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {}
  for (const t of tokens) {
    tf[t] = (tf[t] ?? 0) + 1
  }
  const max = Math.max(...Object.values(tf), 1)
  for (const k in tf) {
    tf[k] = tf[k]! / max  // normalize by max frequency
  }
  return tf
}

/** Build IDF from a corpus (map: term → idf score) */
function buildIdf(docTokens: string[][]): Record<string, number> {
  const docFreq: Record<string, number> = {}
  const N = docTokens.length
  for (const tokens of docTokens) {
    const seen = Array.from(new Set(tokens))
    for (const t of seen) {
      docFreq[t] = (docFreq[t] ?? 0) + 1
    }
  }
  const idf: Record<string, number> = {}
  for (const t in docFreq) {
    idf[t] = Math.log(N / (docFreq[t]! + 1)) + 1
  }
  return idf
}

/** Convert TF + IDF to a TF-IDF vector */
function tfidfVector(
  tf: Record<string, number>,
  idf: Record<string, number>,
): Record<string, number> {
  const vec: Record<string, number> = {}
  for (const t in tf) {
    vec[t] = tf[t]! * (idf[t] ?? 1)
  }
  return vec
}

/** Cosine similarity between two sparse vectors */
function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const k in a) {
    const bVal = b[k]
    if (bVal !== undefined) dot += a[k]! * bVal!
    normA += a[k]! * a[k]!
  }
  for (const k in b) {
    normB += b[k]! * b[k]!
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB)
  return norm === 0 ? 0 : dot / norm
}

// ─── Index storage ────────────────────────────────────────────────────────────

function loadIndex(): EmbedIndex {
  try {
    if (existsSync(INDEX_PATH)) {
      return JSON.parse(readFileSync(INDEX_PATH, 'utf-8')) as EmbedIndex
    }
  } catch { /* corrupt / missing → fresh */ }
  return { docs: [], version: 1 }
}

function saveIndex(idx: EmbedIndex): void {
  mkdirSync(INDEX_DIR, { recursive: true })
  writeFileSync(INDEX_PATH, JSON.stringify(idx), 'utf-8')
}

// Cached IDF for the full corpus (rebuilt whenever docs change)
let cachedIdf: Record<string, number> = {}
let cachedIndex: EmbedIndex | null = null

function ensureIndex(): EmbedIndex {
  if (!cachedIndex) cachedIndex = loadIndex()
  return cachedIndex!
}

function rebuildIdf(): void {
  const idx = ensureIndex()
  const allTokens = idx.docs.map(d => tokenize(d.text))
  cachedIdf = buildIdf(allTokens)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Add or update a document in the embedding index.
 * Re-indexes if document with same `id` already exists.
 */
export function indexDocument(id: string, text: string): void {
  const idx = ensureIndex()

  // Remove existing entry if any
  idx.docs = idx.docs.filter(d => d.id !== id)

  const tokens = tokenize(text)

  // Build TF-IDF vector synchronously (always runs)
  const allTokens = idx.docs.map(d => tokenize(d.text))
  allTokens.push(tokens)
  const idf = buildIdf(allTokens)
  const tf = computeTf(tokens)
  const vector = tfidfVector(tf, idf)

  // Fire-and-forget dense embedding — if it responds, upgrade the entry.
  // Clone docs so the async callback operates on a snapshot, not shared state.
  const docsSnapshot = [...idx.docs]
  getEmbedding(text)
    .then(emb => {
      if (emb) {
        // Build a fresh index with the embedding-upgraded entry, then persist
        const upgraded = docsSnapshot.filter(d => d.id !== id)
        upgraded.push({ id, text, vector: emb, indexedAt: Date.now() })
        cachedIndex = { docs: upgraded, version: idx.version }
        rebuildIdf()
        saveIndex(cachedIndex)
      }
    })
    .catch(() => { /* Provider unavailable, skip */ })

  // Always push TF-IDF entry first (synchronous, stable)
  idx.docs.push({ id, text, vector, indexedAt: Date.now() })
  cachedIdf = idf
  saveIndex(idx)
}

/**
 * Search the index using cosine similarity.
 * Returns top-K results with score >= minScore.
 * Awaitable — tries embedding-based search first, falls back to TF-IDF.
 */
export async function search(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const { topK = 5, minScore = 0.1 } = opts

  const idx = ensureIndex()
  if (idx.docs.length === 0) return []

  // Build query vector: try embedding provider first, fall back to TF-IDF
  const queryTokens = tokenize(query)

  const allTokens = idx.docs.map(d => tokenize(d.text))
  const idf = cachedIdf && Object.keys(cachedIdf).length > 0
    ? cachedIdf
    : buildIdf(allTokens)
  const queryTf = computeTf(queryTokens)

  // TF-IDF baseline (always available)
  const tfidfVector_ = tfidfVector(queryTf, idf)

  // Try to upgrade with embedding provider — await it so results actually get used
  let queryVector = tfidfVector_
  try {
    const emb = await getEmbedding(query)
    if (emb) {
      queryVector = emb
    }
  } catch { /* embedding provider unavailable, TF-IDF result stands */ }

  // Score all docs against the best query vector we have
  const results: SearchResult[] = idx.docs.map(doc => ({
    id: doc.id,
    text: doc.text,
    score: cosineSimilarity(queryVector, doc.vector),
  }))

  return results
    .filter(r => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * Wipe all embeddings from the index.
 */
export function clearIndex(): void {
  cachedIndex = { docs: [], version: 1 }
  cachedIdf = {}
  saveIndex(cachedIndex)
}

/**
 * Remove a document from the embedding index.
 */
export function removeDocument(id: string): void {
  const idx = ensureIndex()
  idx.docs = idx.docs.filter(d => d.id !== id)
  rebuildIdf()
  saveIndex(idx)
}

/**
 * Auto-index all session content from DuckHive's resolved sessions directory.
 * Called on startup to bootstrap the semantic layer.
 */
export async function indexSessionContent(): Promise<void> {
  const sessionsDir = getEmbedRecallSessionsDir()
  if (!existsSync(sessionsDir)) return

  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'))
    for (const file of files) {
      const sessionId = file.replace('.jsonl', '')
      // Only index if not already in the main index
      const idx = ensureIndex()
      if (idx.docs.some(d => d.id.startsWith(`session:${sessionId}`))) continue

      const content = readFileSync(join(sessionsDir, file), 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      // Index the first non-system line as the session summary
      const summaryLine = lines.find(l => !l.includes('"type":"system"'))
      if (summaryLine) {
        try {
          const msg = JSON.parse(summaryLine)
          const text = typeof msg === 'object' && msg !== null
            ? ((msg as Record<string, unknown>)['content'] as string) ?? ''
            : String(summaryLine)
          if (text.length > 10) {
            indexDocument(`session:${sessionId}`, text.slice(0, 2000))
          }
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* sessions dir doesn't exist or empty */ }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Rebuild IDF from loaded corpus on startup
rebuildIdf()

// Fire-and-forget auto-index on module load
void indexSessionContent()
