/**
 * Agent Soul & Identity System
 *
 * Provides persistent agent identity across sessions — a "soul" file that
 * defines who the agent is, what it values, how it thinks, and what it's
 * learned about itself over time.
 *
 * Based on OpenClaw autonomy features and duck-cli's meta-agent patterns.
 * Lives at ~/.duckhive/agent-soul/<agentType>/
 */

import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { logForDebugging } from '../../utils/debug.js'
import { getCwd } from '../../utils/cwd.js'

// ============================================================================
// Types
// ============================================================================

export interface AgentPersonality {
  name: string
  tagline: string           // One-line description of who this agent is
  communicationStyle: 'formal' | 'casual' | 'technical' | 'friendly'
  decisionStyle: 'cautious' | 'bold' | 'balanced'
  curiosityLevel: 0 | 1 | 2 | 3  // 0=none, 3=high
  creativityLevel: 0 | 1 | 2 | 3
}

export interface AgentSelfModel {
  strengths: string[]       // What the agent knows it does well
  weaknesses: string[]      // What the agent knows it struggles with
  preferredTools: string[]   // Tools the agent consistently chooses
  patterns: string[]         // Behavioral patterns (e.g., "tends to over-plan")
  values: string[]           // What the agent prioritizes
}

export interface AgentGoals {
  shortTerm: string[]        // Current session goals
  longTerm: string[]         // Multi-session aspirations
  learningObjectives: string[] // Things the agent is working to improve
}

export interface AgentMemory {
  lessonsLearned: string[]  // Hard-won lessons from past failures
  successfulStrategies: string[]  // Approaches that worked well
  failedStrategies: string[]      // Approaches that didn't work (and why)
  memorableExperiences: string[]  // Notable experiences that shaped behavior
}

export interface AgentSoul {
  personality: AgentPersonality
  selfModel: AgentSelfModel
  goals: AgentGoals
  memory: AgentMemory
  sessionCount: number
  lastActive: string        // ISO date
  createdAt: string          // ISO date
  version: number
}

export interface SelfCritiqueResult {
  task: string
  outcome: 'success' | 'partial' | 'failure'
  whatWentWell: string[]
  whatCouldImprove: string[]
  lessons: string[]
  strategyAdjustment: string
  timestamp: string
}

export interface MetaLearnerInsight {
  pattern: string
  recommendation: string
  evidence: string[]
  confidence: number  // 0-1
  source: string
}

// ============================================================================
// Paths
// ============================================================================

function getSoulBaseDir(): string {
  return join(process.env.HOME ?? '~', '.duckhive', 'agent-soul')
}

function getAgentSoulDir(agentType: string): string {
  const safeName = agentType.replace(/:/g, '-').replace(/\//g, '-')
  return join(getSoulBaseDir(), safeName)
}

function getSoulFilePath(agentType: string): string {
  return join(getAgentSoulDir(agentType), 'soul.json')
}

function getMetaCritiquePath(agentType: string): string {
  return join(getAgentSoulDir(agentType), 'meta-critique.jsonl')
}

function getLearnerPath(agentType: string): string {
  return join(getAgentSoulDir(agentType), 'learner-insights.json')
}

// ============================================================================
// Default Soul (new agent)
// ============================================================================

const DEFAULT_PERSONALITY: AgentPersonality = {
  name: 'DuckHive Assistant',
  tagline: 'A helpful coding assistant with strong problem-solving skills',
  communicationStyle: 'friendly',
  decisionStyle: 'balanced',
  curiosityLevel: 2,
  creativityLevel: 2,
}

const DEFAULT_SELF_MODEL: AgentSelfModel = {
  strengths: ['coding', 'debugging', 'architecture design', 'documentation'],
  weaknesses: [],
  preferredTools: [],
  patterns: [],
  values: ['correctness', 'clarity', 'user satisfaction'],
}

const DEFAULT_GOALS: AgentGoals = {
  shortTerm: [],
  longTerm: [],
  learningObjectives: [],
}

const DEFAULT_MEMORY: AgentMemory = {
  lessonsLearned: [],
  successfulStrategies: [],
  failedStrategies: [],
  memorableExperiences: [],
}

function createDefaultSoul(agentType: string): AgentSoul {
  return {
    personality: { ...DEFAULT_PERSONALITY },
    selfModel: { ...DEFAULT_SELF_MODEL },
    goals: { ...DEFAULT_GOALS },
    memory: { ...DEFAULT_MEMORY },
    sessionCount: 0,
    lastActive: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    version: 1,
  }
}

// ============================================================================
// Core API
// ============================================================================

export function loadOrCreateSoul(agentType: string): AgentSoul {
  const path = getSoulFilePath(agentType)

  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'))
      // Update last active
      data.lastActive = new Date().toISOString()
      data.sessionCount = (data.sessionCount ?? 0) + 1
      return data as AgentSoul
    } catch (err) {
      logForDebugging(`[agent-soul] failed to load soul at ${path}, creating new: ${err}`)
    }
  }

  // Create new soul
  const dir = getAgentSoulDir(agentType)
  mkdirSync(dir, { recursive: true })

  const soul = createDefaultSoul(agentType)
  saveSoul(soul, agentType)
  return soul
}

export function saveSoul(soul: AgentSoul, agentType: string): void {
  const path = getSoulFilePath(agentType)
  const dir = getAgentSoulDir(agentType)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(soul, null, 2), 'utf8')
}

export function getSoul(agentType: string): AgentSoul | null {
  const path = getSoulFilePath(agentType)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AgentSoul
  } catch {
    return null
  }
}

export function updateSoul(agentType: string, updates: Partial<AgentSoul>): void {
  const soul = loadOrCreateSoul(agentType)
  const updated = { ...soul, ...updates, lastActive: new Date().toISOString() }
  saveSoul(updated, agentType)
}

// ============================================================================
// Soul file update helpers
// ============================================================================

export function learnFromExperience(
  agentType: string,
  experience: string,
  outcome: 'success' | 'failure',
  lessons: string[],
): void {
  const soul = loadOrCreateSoul(agentType)

  if (outcome === 'success') {
    if (!soul.memory.successfulStrategies.includes(experience)) {
      soul.memory.successfulStrategies.push(experience)
    }
  } else {
    if (!soul.memory.failedStrategies.includes(experience)) {
      soul.memory.failedStrategies.push(experience)
    }
  }

  for (const lesson of lessons) {
    if (!soul.memory.lessonsLearned.includes(lesson)) {
      soul.memory.lessonsLearned.push(lesson)
    }
  }

  saveSoul(soul, agentType)
}

export function recordStrength(agentType: string, strength: string): void {
  const soul = loadOrCreateSoul(agentType)
  if (!soul.selfModel.strengths.includes(strength)) {
    soul.selfModel.strengths.push(strength)
  }
  saveSoul(soul, agentType)
}

export function recordWeakness(agentType: string, weakness: string): void {
  const soul = loadOrCreateSoul(agentType)
  if (!soul.selfModel.weaknesses.includes(weakness)) {
    soul.selfModel.weaknesses.push(weakness)
  }
  saveSoul(soul, agentType)
}

export function addGoal(agentType: string, goal: string, scope: 'shortTerm' | 'longTerm' | 'learningObjectives'): void {
  const soul = loadOrCreateSoul(agentType)
  if (!soul.goals[scope].includes(goal)) {
    soul.goals[scope].push(goal)
  }
  saveSoul(soul, agentType)
}

export function removeGoal(agentType: string, goal: string, scope: 'shortTerm' | 'longTerm' | 'learningObjectives'): void {
  const soul = loadOrCreateSoul(agentType)
  soul.goals[scope] = soul.goals[scope].filter(g => g !== goal)
  saveSoul(soul, agentType)
}

// ============================================================================
// Meta-Critic: self-reflection after task completion
// ============================================================================

export function recordSelfCritique(agentType: string, critique: SelfCritiqueResult): void {
  const path = getMetaCritiquePath(agentType)
  const dir = getAgentSoulDir(agentType)
  mkdirSync(dir, { recursive: true })

  const line = JSON.stringify(critique)
  // Append to jsonl file
  try {
    const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const newContent = existing ? existing + '\n' + line : line + '\n'
    writeFileSync(path, newContent, 'utf8')
    logForDebugging(`[agent-soul] self-critique recorded for ${agentType}`)
  } catch (err) {
    logForDebugging(`[agent-soul] failed to record self-critique: ${err}`)
  }
}

export function getSelfCritiques(agentType: string, limit = 50): SelfCritiqueResult[] {
  const path = getMetaCritiquePath(agentType)
  if (!existsSync(path)) return []

  try {
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n').filter(l => l.trim())
    const critiques = lines.map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean) as SelfCritiqueResult[]

    return critiques.slice(-limit)
  } catch {
    return []
  }
}

export function buildMetaCritiquePrompt(agentType: string): string {
  const critiques = getSelfCritiques(agentType, 10)
  if (critiques.length === 0) return ''

  const recent = critiques.slice(-5)
  const failureLessons = recent
    .filter(c => c.outcome === 'failure')
    .flatMap(c => c.lessons)
    .slice(0, 5)

  if (failureLessons.length === 0) return ''

  return `\n\nSelf-improvement context (learned from past failures):
${failureLessons.map(l => `- ${l}`).join('\n')}`
}

// ============================================================================
// Meta-Learner: patterns and recommendations
// ============================================================================

export function generateLearnerInsights(agentType: string): MetaLearnerInsight[] {
  const critiques = getSelfCritiques(agentType, 100)
  if (critiques.length < 5) return []

  const insights: MetaLearnerInsight[] = []

  // Analyze failure patterns
  const failedCritiques = critiques.filter(c => c.outcome === 'failure')
  if (failedCritiques.length >= 3) {
    const commonThemes = new Map<string, number>()
    for (const c of failedCritiques) {
      for (const lesson of c.lessons) {
        const theme = lesson.toLowerCase().split(' ').slice(0, 3).join(' ')
        commonThemes.set(theme, (commonThemes.get(theme) ?? 0) + 1)
      }
    }

    for (const [theme, count] of commonThemes.entries()) {
      if (count >= 2) {
        insights.push({
          pattern: theme,
          recommendation: `Multiple failures related to "${theme}" — consider a different approach`,
          evidence: failedCritiques.filter(c => c.lessons.some(l => l.toLowerCase().includes(theme))).map(c => c.task),
          confidence: Math.min(count / failedCritiques.length, 0.9),
          source: 'meta-critic',
        })
      }
    }
  }

  // Analyze success patterns
  const successCritiques = critiques.filter(c => c.outcome === 'success')
  if (successCritiques.length >= 5) {
    const strategies = successCritiques.flatMap(c => c.whatWentWell)
    const commonSuccess = new Map<string, number>()
    for (const s of strategies) {
      commonSuccess.set(s, (commonSuccess.get(s) ?? 0) + 1)
    }

    for (const [strategy, count] of commonSuccess.entries()) {
      if (count >= 3) {
        insights.push({
          pattern: strategy,
          recommendation: `"${strategy}" has succeeded ${count} times — apply this pattern more often`,
          evidence: successCritiques.filter(c => c.whatWentWell.includes(strategy)).map(c => c.task),
          confidence: Math.min(count / 10, 0.95),
          source: 'meta-critic',
        })
      }
    }
  }

  return insights
}

export function getLearnerInsights(agentType: string): MetaLearnerInsight[] {
  const path = getLearnerPath(agentType)
  if (!existsSync(path)) return []

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'))
    return (data.insights ?? []) as MetaLearnerInsight[]
  } catch {
    return []
  }
}

export function saveLearnerInsights(agentType: string, insights: MetaLearnerInsight[]): void {
  const path = getLearnerPath(agentType)
  const dir = getAgentSoulDir(agentType)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify({ insights }, null, 2), 'utf8')
}

// ============================================================================
// Build system prompt from soul
// ============================================================================

export function buildSoulSystemPrompt(agentType: string): string {
  const soul = loadOrCreateSoul(agentType)
  const insights = generateLearnerInsights(agentType)
  const learnerInsights = getLearnerInsights(agentType)
  const allInsights = [...learnerInsights, ...insights]

  const lines: string[] = []

  lines.push(`## Agent Identity`)
  lines.push(`Name: ${soul.personality.name}`)
  lines.push(`Tagline: ${soul.personality.tagline}`)
  lines.push(`Communication: ${soul.personality.communicationStyle}`)
  lines.push(`Decision style: ${soul.personality.decisionStyle}`)
  lines.push(`Curiosity: ${'⚡'.repeat(soul.personality.curiosityLevel)} (${soul.personality.curiosityLevel}/3)`)
  lines.push(`Creativity: ${'✨'.repeat(soul.personality.creativityLevel)} (${soul.personality.creativityLevel}/3)`)

  if (soul.selfModel.strengths.length > 0) {
    lines.push(`\nKnown strengths: ${soul.selfModel.strengths.join(', ')}`)
  }

  if (soul.selfModel.weaknesses.length > 0) {
    lines.push(`Known weaknesses: ${soul.selfModel.weaknesses.join(', ')}`)
  }

  if (soul.memory.lessonsLearned.length > 0) {
    lines.push(`\nKey lessons learned:`)
    for (const lesson of soul.memory.lessonsLearned.slice(-5)) {
      lines.push(`- ${lesson}`)
    }
  }

  if (allInsights.length > 0) {
    lines.push(`\nMeta-learner recommendations:`)
    for (const insight of allInsights.slice(0, 3)) {
      lines.push(`- ${insight.recommendation} (${Math.round(insight.confidence * 100)}% confidence)`)
    }
  }

  if (soul.goals.shortTerm.length > 0) {
    lines.push(`\nCurrent goals: ${soul.goals.shortTerm.join('; ')}`)
  }

  lines.push(`\nSessions completed: ${soul.sessionCount}`)

  return lines.join('\n')
}

// ============================================================================
// SubconsciousProcessor: background thought processing
// ============================================================================

// Simple background thought queue — processes when REPL is idle
const subconsciousQueue: Array<{ thought: string; priority: number; timestamp: number }> = []
let processingSubconscious = false

export function queueSubconsciousThought(thought: string, priority = 5): void {
  subconsciousQueue.push({ thought, priority, timestamp: Date.now() })
  // Sort by priority (lower = more important)
  subconsciousQueue.sort((a, b) => a.priority - b.priority)
}

export function processSubconsciousQueue(): string | null {
  if (subconsciousQueue.length === 0 || processingSubconscious) return null

  processingSubconscious = true
  const item = subconsciousQueue.shift()
  processingSubconscious = false

  return item?.thought ?? null
}

export function getSubconsciousDepth(): number {
  return subconsciousQueue.length
}

export function clearSubconscious(): void {
  subconsciousQueue.length = 0
}