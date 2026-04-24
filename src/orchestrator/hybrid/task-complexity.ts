import { z } from 'zod/v4'

export interface TaskAnalysis {
  complexity: number // 1-10
  category: 'simple' | 'medium' | 'complex' | 'critical'
  factors: string[]
  suggestedModel: string
  needsCouncil: boolean
  councilReasons: string[]
  needsCheckpoint: boolean
  estimatedSteps: number
}

export interface TaskContext {
  message: string
  history: Array<{role: string; content: string}>
  tools: string[]
  timestamp: number
}

const COMPLEXITY_KEYWORDS = {
  critical: ['security', 'delete', 'rm -rf', 'drop table', 'sudo', 'grant all', 'firewall', 'deploy production', 'reboot', 'shutdown'],
  complex: ['architect', 'design pattern', 'multi-step', 'parallel', 'async', 'database migration', 'api design', 'auth', 'restructure', 'redesign'],
  medium: ['build', 'implement', 'create api', 'write test', 'debug', 'optimize', 'improve', 'add feature', 'fix bug', 'analyze'],
}

const COUNCIL_TRIGGERS = [
  // Phrase-based triggers (explicit safety/risk questions)
  'should we', 'should i', 'is it safe', 'is it secure', 'is this a good idea',
  'what if', 'risk assessment', 'ethics', 'privacy', 'compliance',
  // Keyword triggers (common sensitive operations)
  'security', 'auth', 'permission', 'deploy', 'production',
  'cost', 'budget', 'financial', 'api key', 'secret', 'credential',
  'delete', 'remove', 'drop', 'truncate', 'rm -rf',
  'firewall', 'network', 'ssl', 'tls', 'oauth',
  'database migration', 'schema change', 'breaking change',
  'sudo', 'root', 'admin', 'access control',
  'migrate', 'refactor architecture', 'delete production',
  'authentication', 'authorization',
]

export function analyzeTask(message: string, context: TaskContext): TaskAnalysis {
  const msg = message.toLowerCase()
  let complexity = 1
  const factors: string[] = []
  
  // Count complexity factors
  if (COMPLEXITY_KEYWORDS.critical.some(k => msg.includes(k))) {
    complexity = Math.max(complexity, 9)
    factors.push('Critical operation detected')
  }
  if (COMPLEXITY_KEYWORDS.complex.some(k => msg.includes(k))) {
    complexity = Math.max(complexity, 6)
    factors.push('Complex task pattern')
  }
  if (COMPLEXITY_KEYWORDS.medium.some(k => msg.includes(k))) {
    complexity = Math.max(complexity, 4)
    factors.push('Medium complexity task')
  }
  
  // Length factor
  if (message.length > 500) { complexity = Math.max(complexity, 5); factors.push('Long message') }
  if (message.length > 1500) { complexity = Math.max(complexity, 7); factors.push('Very long message') }
  
  // History context
  if (context.history.length > 10) { complexity = Math.max(complexity, 4); factors.push('Extended conversation') }
  if (context.history.length > 30) { complexity = Math.max(complexity, 7); factors.push('Long conversation context') }
  
  // Tool count
  if (context.tools.length > 3) { complexity = Math.max(complexity, 5); factors.push('Multi-tool request') }
  if (context.tools.length > 7) { complexity = Math.max(complexity, 8); factors.push('Complex multi-tool pipeline') }
  
  // Council triggers
  const councilReasons: string[] = []
  const needsCouncil = COUNCIL_TRIGGERS.some(t => msg.includes(t)) || complexity >= 4
  if (needsCouncil && complexity < 4) { complexity = Math.max(complexity, 4); factors.push('Council-worthy topic') }
  if (msg.includes('security') || msg.includes('auth')) { councilReasons.push('Security-relevant decision') }
  if (msg.includes('deploy') || msg.includes('production')) { councilReasons.push('Production change') }
  if (msg.includes('cost') || msg.includes('budget')) { councilReasons.push('Financial impact') }
  
  // Checkpoint suggestion
  const needsCheckpoint = complexity >= 6 || message.length > 2000
  
  // Category
  const category = complexity <= 3 ? 'simple' : complexity <= 5 ? 'medium' : complexity <= 8 ? 'complex' : 'critical'
  
  // Suggested model
  let suggestedModel = 'minimax-portal/MiniMax-M2.7'
  if (complexity <= 2) suggestedModel = 'lmstudio/qwen3.5-9b' // Fast local
  if (complexity >= 7) suggestedModel = 'openai/gpt-4o' // Premium reasoning
  if (msg.includes('android')) suggestedModel = 'lmstudio/google/gemma-4-e4b-it' // Android specialist
  if (msg.includes('vision') || msg.includes('screenshot') || msg.includes('image')) suggestedModel = 'kimi/kimi-k2.5' // Vision
  
  return {
    complexity,
    category,
    factors,
    suggestedModel,
    needsCouncil,
    councilReasons,
    needsCheckpoint,
    estimatedSteps: Math.ceil(complexity * 1.5),
  }
}
