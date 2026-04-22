// @ts-nocheck
/**
 * MultiModelRouter — Crush CLI inspired multi-provider routing
 * Routes requests across MiniMax, Kimi, OpenAI, Anthropic, OpenRouter, LM Studio
 * Based on task type, cost, availability, and user preferences.
 */

export interface ModelInfo {
  provider: string
  model: string
  contextWindow: number
  costPer1MInput: number
  costPer1MOutput: number
  speed: 'fast' | 'medium' | 'slow'
  strengths: string[]
  vision: boolean
  functionCalling: boolean
}

export interface RouteRequest {
  task: string
  complexity: number
  vision: boolean
  functionCalling: boolean
  maxCost?: number
  preferSpeed?: boolean
  preferQuality?: boolean
}

export interface RouteResult {
  provider: string
  model: string
  reason: string
  costEstimate: number
  fallback?: ModelInfo
}

const MODEL_CATALOG: ModelInfo[] = [
  { provider: 'minimax', model: 'minimax-portal/MiniMax-M2.7', contextWindow: 1000000, costPer1MInput: 0.05, costPer1MOutput: 0.10, speed: 'fast', strengths: ['agents', 'reasoning', 'coding'], vision: false, functionCalling: true },
  { provider: 'minimax', model: 'minimax-portal/MiniMax-M2.5', contextWindow: 1000000, costPer1MInput: 0.02, costPer1MOutput: 0.05, speed: 'fast', strengths: ['fast', 'free'], vision: false, functionCalling: true },
  { provider: 'kimi', model: 'kimi/kimi-k2.5', contextWindow: 256000, costPer1MInput: 0.12, costPer1MOutput: 0.12, speed: 'medium', strengths: ['vision', 'coding', 'humaneval'], vision: true, functionCalling: true },
  { provider: 'openai', model: 'gpt-4o', contextWindow: 128000, costPer1MInput: 2.50, costPer1MOutput: 10.00, speed: 'medium', strengths: ['reasoning', 'coding', 'vision'], vision: true, functionCalling: true },
  { provider: 'openai', model: 'gpt-4o-mini', contextWindow: 128000, costPer1MInput: 0.15, costPer1MOutput: 0.60, speed: 'fast', strengths: ['fast', 'cheap', 'coding'], vision: true, functionCalling: true },
  { provider: 'anthropic', model: 'claude-sonnet-4-20250514', contextWindow: 200000, costPer1MInput: 3.00, costPer1MOutput: 15.00, speed: 'medium', strengths: ['reasoning', 'analysis', 'writing'], vision: true, functionCalling: true },
  { provider: 'openrouter', model: 'minimax/minimax-m2.5:free', contextWindow: 196000, costPer1MInput: 0, costPer1MOutput: 0, speed: 'fast', strengths: ['free', 'fast'], vision: false, functionCalling: false },
  { provider: 'lmstudio', model: 'qwen3.5-9b', contextWindow: 32000, costPer1MInput: 0, costPer1MOutput: 0, speed: 'fast', strengths: ['local', 'free', 'fast'], vision: true, functionCalling: false },
  { provider: 'lmstudio', model: 'google/gemma-4-e4b-it', contextWindow: 32000, costPer1MInput: 0, costPer1MOutput: 0, speed: 'fast', strengths: ['android', 'local', 'tool-calling'], vision: true, functionCalling: false },
]

export function routeTask(req: RouteRequest): RouteResult {
  const { task, complexity, vision, functionCalling, maxCost, preferSpeed, preferQuality } = req

  // Filter candidates
  let candidates = MODEL_CATALOG.filter(m => {
    if (vision && !m.vision) return false
    if (functionCalling && !m.functionCalling) return false
    if (maxCost && m.costPer1MInput > maxCost) return false
    return true
  })

  if (candidates.length === 0) candidates = MODEL_CATALOG

  // Score candidates
  const scored = candidates.map(m => {
    let score = 50
    const msg = task.toLowerCase()

    // Complexity routing
    if (complexity <= 2) {
      if (m.costPer1MInput === 0) score += 30 // Free/local for simple
      if (m.speed === 'fast') score += 20
    }
    if (complexity >= 7) {
      if (m.strengths.includes('reasoning')) score += 30
      if (m.costPer1MInput === 0) score += 10 // Free is nice but quality matters
    }

    // Task-based scoring
    if (msg.includes('android') && m.strengths.includes('android')) score += 40
    if (msg.includes('vision') && m.strengths.includes('vision')) score += 40
    if (msg.includes('code') && m.strengths.includes('coding')) score += 25
    if (msg.includes('write') && m.strengths.includes('writing')) score += 25
    if (msg.includes('analyze') && m.strengths.includes('analysis')) score += 25

    // Speed preference
    if (preferSpeed && m.speed === 'fast') score += 25
    if (preferQuality && m.costPer1MInput > 0) score += 15

    // Context window
    if (m.contextWindow >= 1000000) score += 10

    return { model: m, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const primary = scored[0].model
  const fallback = scored[1]?.model

  // Estimate cost for 10K input / 1K output
  const costEst = (primary.costPer1MInput * 10 + primary.costPer1MOutput) / 100

  return {
    provider: primary.provider,
    model: primary.model,
    reason: `Best match for ${complexity >= 7 ? 'complex' : complexity <= 2 ? 'simple' : 'medium'} task${vision ? ' with vision' : ''}`,
    costEstimate: costEst,
    fallback: fallback,
  }
}

export function listModels(): ModelInfo[] {
  return MODEL_CATALOG
}
