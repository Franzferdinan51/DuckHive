export interface RouteResult {
  provider: string
  model: string
  reason: string
  temperature: number
  maxTokens: number
}

const MODEL_PREFERENCES: Record<string, { provider: string; model: string; temp: number; maxTokens: number }> = {
  android: { provider: 'lmstudio', model: 'google/gemma-4-e4b-it', temp: 0.3, maxTokens: 2048 },
  vision: { provider: 'kimi', model: 'kimi-k2.5', temp: 0.3, maxTokens: 4096 },
  coding: { provider: 'openai', model: 'gpt-4o', temp: 0.2, maxTokens: 8192 },
  reasoning: { provider: 'minimax', model: 'minimax-portal/MiniMax-M2.7', temp: 0.5, maxTokens: 8192 },
  fast: { provider: 'openrouter', model: 'minimax/minimax-m2.5:free', temp: 0.5, maxTokens: 4096 },
  creative: { provider: 'openai', model: 'gpt-4o', temp: 0.8, maxTokens: 4096 },
  default: { provider: 'minimax', model: 'minimax-portal/MiniMax-M2.7', temp: 0.5, maxTokens: 8192 },
}

export function selectModel(task: string, complexity: number, hints: Record<string, boolean> = {}): RouteResult {
  const msg = task.toLowerCase()
  
  // Android task → Gemma 4
  if (msg.includes('android') || msg.includes('phone') || msg.includes('adb')) {
    const m = MODEL_PREFERENCES.android
    return { provider: m.provider, model: m.model, reason: 'Android specialist model', temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // Vision task → Kimi K2.5
  if (msg.includes('vision') || msg.includes('screenshot') || msg.includes('image') || msg.includes('photo') || hints.vision) {
    const m = MODEL_PREFERENCES.vision
    return { provider: m.provider, model: m.model, reason: 'Vision + coding champion', temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // Very fast/simple → free tier
  if (complexity <= 2) {
    const m = MODEL_PREFERENCES.fast
    return { provider: m.provider, model: m.model, reason: 'Simple task, free model', temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // High complexity → premium reasoning
  if (complexity >= 7) {
    const m = MODEL_PREFERENCES.reasoning
    return { provider: m.provider, model: m.model, reason: `Complex task (${complexity}/10), premium reasoning`, temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // Coding → GPT-4o
  if (msg.includes('code') || msg.includes('implement') || msg.includes('debug') || msg.includes('fix')) {
    const m = MODEL_PREFERENCES.coding
    return { provider: m.provider, model: m.model, reason: 'Coding task', temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // Creative → higher temp
  if (msg.includes('write') || msg.includes('story') || msg.includes('creative') || msg.includes('generate')) {
    const m = MODEL_PREFERENCES.creative
    return { provider: m.provider, model: m.model, reason: 'Creative task', temperature: m.temp, maxTokens: m.maxTokens }
  }
  
  // Default → MiniMax M2.7
  const m = MODEL_PREFERENCES.default
  return { provider: m.provider, model: m.model, reason: 'General purpose routing', temperature: m.temp, maxTokens: m.maxTokens }
}

export function isAndroidTask(msg: string): boolean {
  return /android|phone|adb|tap\s+\d|swipe|moto\s?g|telephone/.test(msg.toLowerCase())
}

export function isVisionTask(msg: string): boolean {
  return /screenshot|image|vision|photo|picture|see|look|camera|frame/.test(msg.toLowerCase())
}
