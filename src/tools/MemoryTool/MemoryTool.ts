// @ts-nocheck
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { search as embedRecallSearch, indexDocument, clearIndex as clearEmbedIndex, removeDocument } from '../../memdir/embedRecall.js'

const memoryToolDeps: {
  getClaudeConfigHomeDir: () => string
} = {
  getClaudeConfigHomeDir,
}

export function setMemoryToolTestDeps(
  overrides: Partial<typeof memoryToolDeps> | null,
): void {
  Object.assign(memoryToolDeps, {
    getClaudeConfigHomeDir,
    ...(overrides ?? {}),
  })
}

export function getMemoryToolDir(
  configHomeDir = memoryToolDeps.getClaudeConfigHomeDir(),
): string {
  return resolve(configHomeDir, 'memory')
}

export function getMemoryToolFilePath(
  configHomeDir = memoryToolDeps.getClaudeConfigHomeDir(),
): string {
  return join(getMemoryToolDir(configHomeDir), 'memories.json')
}

function ensureDir(memoryDir = getMemoryToolDir()) {
  mkdirSync(memoryDir, { recursive: true })
  mkdirSync(resolve(memoryDir, 'memories'), { recursive: true })
}

export function getMemories(
  filePath = getMemoryToolFilePath(),
): Array<{
  id: string
  content: string
  type: string
  tags: string[]
  created: string
  importance: number
}> {
  ensureDir(resolve(filePath, '..'))
  if (!existsSync(filePath)) return []
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return []
  }
}

export function saveMemories(
  memories: Array<{
    id: string
    content: string
    type: string
    tags: string[]
    created: string
    importance: number
  }>,
  filePath = getMemoryToolFilePath(),
) {
  ensureDir(resolve(filePath, '..'))
  writeFileSync(filePath, JSON.stringify(memories, null, 2), 'utf8')
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['remember', 'recall', 'search', 'stats', 'forget'])
      .describe('Memory action'),
    content: z.string().optional().describe('Content to remember'),
    type: z
      .enum(['fact', 'preference', 'task', 'learning', 'context'])
      .optional()
      .describe('Memory type'),
    tags: z.array(z.string()).optional().describe('Tags for the memory'),
    importance: z.number().min(0).max(10).optional().describe('Importance 0-10'),
    query: z.string().optional().describe('Search/recall query'),
    memoryId: z.string().optional().describe('Memory ID to recall/forget'),
    limit: z.number().optional().describe('Max results for recall'),
    reindex: z.boolean().optional().describe('Rebuild embed index from all memories'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

export const MemoryTool = buildTool({
  name: 'memory',
  async description() {
    return 'Long-term memory — remember facts, recall past context, search memories, track learnings. SQLite-backed subconscious memory system.'
  },
  async prompt() {
    return 'Long-term memory system — remember important facts, recall context from past sessions, search memories by content or tags. Use /memory remember to store, /memory recall to retrieve.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      memories: z
        .array(
          z.object({
            id: z.string(),
            content: z.string(),
            type: z.string(),
            tags: z.array(z.string()),
            created: z.string(),
          }),
        )
        .optional(),
      content: z.string().optional(),
      count: z.number().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly(input) {
    return (
      input.action === 'recall' ||
      input.action === 'search' ||
      input.action === 'stats' ||
      input.action === 'reindex'
    )
  },
  async call(input, context, canUseTool, parentMessage) {
    const {
      action,
      content,
      type = 'context',
      tags = [],
      importance = 5,
      query,
      memoryId,
      limit = 10,
      reindex,
    } = input

    switch (action) {
      case 'remember': {
        if (!content) {
          return {
            data: {
              success: false,
              action: 'remember',
              error: 'content required',
            },
          }
        }
        const memories = getMemories()
        const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
        memories.push({
          id,
          content,
          type,
          tags,
          created: new Date().toISOString(),
          importance,
        })
        saveMemories(memories)
        // Index in embedRecall for semantic search
        try {
          indexDocument(id, [type, tags.join(' '), content].join(' '))
        } catch { /* non-fatal */ }
        return {
          data: { success: true, action: 'remember', count: memories.length },
        }
      }
      case 'recall': {
        const memories = getMemories()
        if (memoryId) {
          const memory = memories.find(m => m.id === memoryId)
          return {
            data: {
              success: !!memory,
              action: 'recall',
              memories: memory ? [memory] : [],
              content: memory?.content,
            },
          }
        }
        const recent = memories
          .sort(
            (a, b) =>
              b.importance - a.importance ||
              new Date(b.created).getTime() - new Date(a.created).getTime(),
          )
          .slice(0, limit)
        return {
          data: {
            success: true,
            action: 'recall',
            memories: recent,
            count: recent.length,
          },
        }
      }
      case 'search': {
        if (!query) {
          return {
            data: {
              success: false,
              action: 'search',
              error: 'query required',
            },
          }
        }
        const memories = getMemories()
        const q = query.toLowerCase()
        // Phase 1: keyword matching (exact substring)
        const keywordMatches = memories.filter(
          m =>
            m.content.toLowerCase().includes(q) ||
            m.tags.some(t => t.toLowerCase().includes(q)) ||
            m.type.toLowerCase().includes(q),
        )
        // Phase 2: semantic search via embedRecall (TF-IDF / LM Studio embeddings)
        let semanticMatches: Array<{ id: string; score: number }> = []
        try {
          const embResults = embedRecallSearch(query, { topK: 20, minScore: 0.15 })
          semanticMatches = embResults.map(r => ({ id: r.id, score: r.score }))
        } catch { /* embedRecall unavailable */ }
        // Merge: keyword matches get boosted by semantic similarity
        const seen = new Set<string>()
        const results: typeof memories = []
        // Prioritize keyword matches that also have semantic relevance
        for (const m of keywordMatches) {
          if (!seen.has(m.id)) {
            seen.add(m.id)
            const sem = semanticMatches.find(s => s.id === m.id)
            results.push({ ...m, importance: sem ? m.importance + Math.round(sem.score * 10) : m.importance })
          }
        }
        // Fill with semantic-only matches not caught by keyword search
        for (const sem of semanticMatches) {
          if (!seen.has(sem.id)) {
            seen.add(sem.id)
            const mem = memories.find(m => m.id === sem.id)
            if (mem) results.push({ ...mem, importance: Math.round(mem.importance + sem.score * 5) })
          }
        }
        results.sort((a, b) => b.importance - a.importance)
        return {
          data: {
            success: true,
            action: 'search',
            memories: results.slice(0, limit),
            count: results.length,
          },
        }
      }
      case 'stats': {
        const memories = getMemories()
        const byType: Record<string, number> = {}
        for (const memory of memories) {
          byType[memory.type] = (byType[memory.type] ?? 0) + 1
        }
        return {
          data: {
            success: true,
            action: 'stats',
            count: memories.length,
            memories: Object.entries(byType).map(([type, count]) => ({
              id: type,
              content: `${count} memories`,
              type: 'stat',
              tags: [],
              created: '',
            })),
          },
        }
      }
      case 'forget': {
        if (!memoryId) {
          return {
            data: {
              success: false,
              action: 'forget',
              error: 'memoryId required',
            },
          }
        }
        const memories = getMemories().filter(m => m.id !== memoryId)
        saveMemories(memories)
        // Remove from embedRecall index
        try {
          removeDocument(memoryId)
        } catch { /* non-fatal */ }
        return {
          data: { success: true, action: 'forget', count: memories.length },
        }
      }
      case 'reindex': {
        const memories = getMemories()
        clearEmbedIndex()
        let indexed = 0
        for (const m of memories) {
          try {
            indexDocument(m.id, [m.type, m.tags.join(' '), m.content].join(' '))
            indexed++
          } catch { /* non-fatal */ }
        }
        return {
          data: {
            success: true,
            action: 'reindex',
            count: indexed,
            content: `Re-indexed ${indexed} of ${memories.length} memories`,
          },
        }
      }
      default:
        return {
          data: { success: false, action, error: `Unknown action: ${action}` },
        }
    }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
