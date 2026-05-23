/**
 * Hive Nation Bridge Service
 * Bridges DuckHive with the Hive Nation AI Council + Senate + Teams system
 *
 * Provides: Council deliberation, Senate decrees, Team spawning, and governance
 * Default API: http://localhost:3007/api/*
 */

import type {
  HiveConfig,
  HiveHealth,
  Councilor,
  DeliberationSession,
  DeliberationMessage,
  DeliberationMode,
  Decree,
  Team,
  AskRequest,
  AskResponse,
  HiveContext,
  IntegrationOptions,
} from './hive-types.js'
import { logForDebugging } from '../../utils/debug.js'

const DEFAULT_COUNCIL_PORT = process.env.COUNCIL_PORT || '3007'
const DEFAULT_HIVE_API_BASE =
  process.env.DUCKHIVE_COUNCIL_URL ||
  process.env.HIVE_API_BASE ||
  `http://localhost:${DEFAULT_COUNCIL_PORT}`

const DEFAULT_CONFIG: HiveConfig = {
  apiBase: DEFAULT_HIVE_API_BASE,
  enabled: process.env.DUCKHIVE_COUNCIL_ENABLED !== 'false',
}

const DEFAULT_OPTIONS: IntegrationOptions = {
  autoConsultCouncil: process.env.DUCKHIVE_COUNCIL_ENABLED !== 'false',
  councilThreshold: Number.parseInt(
    process.env.DUCKHIVE_COUNCIL_THRESHOLD || '3',
    10,
  ) || 3,
  showCouncilInRepl: true,
  cacheCouncilResults: true,
}

const FALLBACK_MODES: DeliberationMode[] = [
  'deliberation',
  'legislative',
  'inquiry',
  'balanced',
  'adversarial',
  'consensus',
  'brainstorm',
  'swarm',
  'swarm_coding',
  'deep_research',
  'collaborative',
  'vision',
  'emergency',
  'risk_assessment',
  'devil-advocate',
  'legislature',
  'prediction',
  'inspector',
]

function isDeliberationMode(value: string): value is DeliberationMode {
  return (FALLBACK_MODES as string[]).includes(value)
}

function normalizeVote(value: unknown): DeliberationMessage['vote'] {
  if (value === 'yea' || value === 'yes') return 'yea'
  if (value === 'nay' || value === 'no') return 'nay'
  if (value === 'abstain') return 'abstain'
  return undefined
}

function normalizeMessage(message: unknown, index: number): DeliberationMessage | null {
  if (!message || typeof message !== 'object') return null
  const raw = message as Record<string, unknown>
  const content =
    typeof raw.content === 'string'
      ? raw.content
      : typeof raw.text === 'string'
        ? raw.text
        : ''

  if (!content) return null

  return {
    id: typeof raw.id === 'string' ? raw.id : `message_${index}`,
    councilor:
      typeof raw.councilor === 'string'
        ? raw.councilor
        : typeof raw.name === 'string'
          ? raw.name
          : typeof raw.role === 'string'
            ? raw.role
            : 'councilor',
    role: typeof raw.role === 'string' ? raw.role : undefined,
    content,
    vote: normalizeVote(raw.vote),
    timestamp: typeof raw.timestamp === 'number'
      ? raw.timestamp
      : typeof raw.timestamp === 'string'
        ? Date.parse(raw.timestamp)
        : undefined,
    type:
      raw.type === 'opening' ||
      raw.type === 'argument' ||
      raw.type === 'rebuttal' ||
      raw.type === 'question' ||
      raw.type === 'vote' ||
      raw.type === 'closing'
        ? raw.type
        : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
  }
}

function normalizeSession(session: unknown): DeliberationSession | null {
  if (!session || typeof session !== 'object') return null
  const raw = session as Record<string, unknown>

  if (
    typeof raw.id === 'string' &&
    typeof raw.topic === 'string' &&
    typeof raw.mode === 'string' &&
    typeof raw.phase === 'string' &&
    raw.stats &&
    typeof raw.stats === 'object'
  ) {
    return raw as unknown as DeliberationSession
  }

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((message, index) => normalizeMessage(message, index))
        .filter((message): message is DeliberationMessage => message !== null)
    : []

  const votes =
    raw.votes && typeof raw.votes === 'object' && !Array.isArray(raw.votes)
      ? (raw.votes as Record<string, unknown>)
      : {}

  const inferredMode =
    typeof raw.mode === 'string' && isDeliberationMode(raw.mode)
      ? raw.mode
      : 'deliberation'

  let phase: DeliberationSession['phase'] = 'idle'
  if (typeof raw.phase === 'string') {
    if (
      raw.phase === 'idle' ||
      raw.phase === 'opening' ||
      raw.phase === 'deliberation' ||
      raw.phase === 'voting' ||
      raw.phase === 'ended'
    ) {
      phase = raw.phase
    }
  } else if (typeof raw.topic === 'string' && raw.topic.trim()) {
    phase = messages.length > 0 ? 'deliberation' : 'opening'
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : 'session_unknown',
    topic: typeof raw.topic === 'string' ? raw.topic : '',
    mode: inferredMode,
    phase,
    messages,
    stats: {
      yeas: Number(votes.yea ?? votes.yeas ?? 0),
      nays: Number(votes.nay ?? votes.nays ?? 0),
      abstainers: Number(votes.abstain ?? votes.abstainers ?? 0),
    },
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
    endedAt: typeof raw.endedAt === 'number' ? raw.endedAt : undefined,
    elapsed: typeof raw.elapsed === 'number' ? raw.elapsed : undefined,
    viewerCount: typeof raw.viewerCount === 'number' ? raw.viewerCount : undefined,
  }
}

function normalizeAskResponse(
  response: unknown,
  fallbackQuestion?: string,
  fallbackMode?: DeliberationMode,
): AskResponse {
  if (!response || typeof response !== 'object') {
    return { success: false }
  }

  const raw = response as Record<string, unknown>
  const responses =
    raw.responses && typeof raw.responses === 'object'
      ? (raw.responses as Record<string, unknown>)
      : {}

  const messages = Object.entries(responses)
    .map(([councilor, content], index) =>
      normalizeMessage({ id: `${councilor}_${index}`, councilor, content }, index),
    )
    .filter((message): message is DeliberationMessage => message !== null)

  const summary = messages
    .slice(0, 3)
    .map(message => `${message.councilor}: ${message.content}`)
    .join(' | ')

  return {
    success: raw.success !== false,
    sessionId:
      typeof raw.sessionId === 'string'
        ? raw.sessionId
        : typeof raw.session_id === 'string'
          ? raw.session_id
          : undefined,
    verdict: typeof raw.verdict === 'string' ? raw.verdict : 'COMPLEX',
    summary: summary || (typeof raw.summary === 'string' ? raw.summary : fallbackQuestion),
    consensus: typeof raw.consensus === 'number' ? raw.consensus : undefined,
    messages,
    recommendations: messages.map(message => message.content),
  }
}

function normalizeHealth(health: unknown): HiveHealth | null {
  if (!health || typeof health !== 'object') return null
  const raw = health as Record<string, unknown>
  const memory =
    raw.memory && typeof raw.memory === 'object'
      ? (raw.memory as Record<string, unknown>)
      : {}
  const services =
    raw.services && typeof raw.services === 'object'
      ? (raw.services as Record<string, unknown>)
      : {}

  const timestampValue =
    typeof raw.timestamp === 'number'
      ? raw.timestamp
      : typeof raw.timestamp === 'string'
        ? Date.parse(raw.timestamp)
        : NaN

  return {
    status:
      raw.status === 'ok' || raw.status === 'degraded' || raw.status === 'error'
        ? raw.status
        : 'ok',
    timestamp: Number.isFinite(timestampValue) ? timestampValue : Date.now(),
    uptime: typeof raw.uptime === 'number' ? raw.uptime : 0,
    memory: {
      used: typeof memory.used === 'number' ? memory.used : 0,
      total: typeof memory.total === 'number' ? memory.total : 0,
      percentage: typeof memory.percentage === 'number' ? memory.percentage : 0,
    },
    services: {
      council: typeof services.council === 'boolean' ? services.council : true,
      hiveCore: typeof services.hiveCore === 'boolean' ? services.hiveCore : true,
    },
  }
}

export class HiveBridge {
  private config: HiveConfig
  private options: IntegrationOptions
  private healthCache?: HiveHealth
  private healthCacheTime = 0
  private councilorsCache?: Councilor[]
  private councilorsCacheTime = 0
  private councilCacheTTL = 60_000
  private healthCacheTTL = 30_000

  constructor(config: Partial<HiveConfig> = {}, options: Partial<IntegrationOptions> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────

  private async apiGet<T>(path: string, timeout = 5000): Promise<T | null> {
    if (!this.config.enabled) return null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      const res = await fetch(`${this.config.apiBase}${path}`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      })
      clearTimeout(timer)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }

  private async apiPost<T>(path: string, body: unknown, timeout = 30_000): Promise<T | null> {
    if (!this.config.enabled) return null
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      const res = await fetch(`${this.config.apiBase}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      })
      clearTimeout(timer)
      if (!res.ok) return null
      return (await res.json()) as T
    } catch {
      return null
    }
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async isHealthy(): Promise<boolean> {
    const now = Date.now()
    if (this.healthCache && now - this.healthCacheTime < this.healthCacheTTL) {
      return this.healthCache.status === 'ok'
    }
    const health = normalizeHealth(await this.apiGet<unknown>('/api/health'))
    if (health) {
      this.healthCache = health
      this.healthCacheTime = now
      return health.status === 'ok'
    }
    return false
  }

  async getHealth(): Promise<HiveHealth | null> {
    const now = Date.now()
    if (this.healthCache && now - this.healthCacheTime < this.healthCacheTTL) {
      return this.healthCache
    }
    const health = normalizeHealth(await this.apiGet<unknown>('/api/health'))
    if (health) {
      this.healthCache = health
      this.healthCacheTime = now
    }
    return health
  }

  // ─── Councilors ───────────────────────────────────────────────────────────

  async getCouncilors(): Promise<Councilor[]> {
    const now = Date.now()
    if (this.councilorsCache && now - this.councilorsCacheTime < this.councilCacheTTL) {
      return this.councilorsCache
    }
    const data = await this.apiGet<unknown>('/api/councilors')
    const councilors = Array.isArray(data)
      ? (data as Councilor[])
      : (
          data &&
          typeof data === 'object' &&
          'councilors' in data &&
          Array.isArray((data as { councilors?: unknown }).councilors)
        )
        ? ((data as { councilors: Councilor[] }).councilors)
        : []
    this.councilorsCache = councilors
    this.councilorsCacheTime = now
    return councilors
  }

  // ─── Deliberation ─────────────────────────────────────────────────────────

  async startDeliberation(
    topic: string,
    mode: DeliberationMode = 'deliberation'
  ): Promise<{
    sessionId?: string
    success: boolean
    error?: string
    verdict?: string
    consensusScore?: number
    arguments?: string[]
    councilors?: string[]
    duration?: number
  }> {
    const start = await this.apiPost<{
      ok?: boolean
      success?: boolean
      sessionId?: string
      session?: unknown
      error?: string
    }>('/api/session/start', { topic, mode })

    if (start?.ok === true || start?.success === true || start?.session || start?.sessionId) {
      const session = normalizeSession(start.session)
      const ask = await this.askCouncil({ question: topic, mode })
      return {
        success: true,
        sessionId: session?.id ?? start.sessionId ?? ask.sessionId,
        verdict: ask.verdict,
        consensusScore: ask.consensus,
        arguments: ask.recommendations,
        councilors: ask.messages?.map(message => message.councilor),
      }
    }

    const legacy = await this.apiPost<Record<string, unknown>>('/api/council/deliberate', {
      topic,
      mode,
    })
    if (legacy) {
      const ask = normalizeAskResponse(legacy, topic, mode)
      return {
        success: ask.success,
        sessionId: ask.sessionId,
        error: typeof legacy.error === 'string' ? legacy.error : undefined,
        verdict: ask.verdict,
        consensusScore: ask.consensus,
        arguments: ask.recommendations,
        councilors: ask.messages?.map(message => message.councilor),
      }
    }

    return { success: false, error: start?.error }
  }

  async askCouncil(request: AskRequest): Promise<AskResponse> {
    const body = {
      question: request.question,
      prompt: request.question,
      mode: request.mode ?? 'deliberation',
    }
    const direct = await this.apiPost('/api/ask', body)
    if (direct) {
      return normalizeAskResponse(direct, request.question, request.mode)
    }

    const legacy = await this.apiPost('/api/council/ask', body)
    return normalizeAskResponse(legacy, request.question, request.mode)
  }

  async getCurrentSession(): Promise<DeliberationSession | null> {
    const direct = await this.apiGet('/api/session')
    const normalizedDirect = normalizeSession(direct)
    if (normalizedDirect) return normalizedDirect

    const legacy = await this.apiGet<{ current: DeliberationSession }>('/api/council/all')
    return normalizeSession(legacy?.current) ?? null
  }

  async getMessages(limit = 50): Promise<DeliberationMessage[]> {
    const data = await this.apiGet<{ messages: DeliberationMessage[] }>(
      `/api/council/messages?limit=${limit}`
    )
    if (data?.messages) return data.messages

    const session = await this.getCurrentSession()
    return session?.messages.slice(-limit) ?? []
  }

  async stopDeliberation(): Promise<{ success: boolean; error?: string }> {
    const result = await this.apiPost<{ ok?: boolean; success?: boolean; error?: string }>(
      '/api/session/stop',
      {}
    )
    return {
      success: result?.ok === true || result?.success === true,
      error: result?.error,
    }
  }

  async getModes(): Promise<DeliberationMode[]> {
    const direct = await this.apiGet<unknown>('/api/modes')
    if (Array.isArray(direct)) {
      const normalized = direct
        .map(entry => {
          if (typeof entry === 'string' && isDeliberationMode(entry)) return entry
          if (
            entry &&
            typeof entry === 'object' &&
            'id' in entry &&
            typeof (entry as { id: unknown }).id === 'string' &&
            isDeliberationMode((entry as { id: string }).id)
          ) {
            return (entry as { id: DeliberationMode }).id
          }
          return null
        })
        .filter((entry): entry is DeliberationMode => entry !== null)

      if (normalized.length > 0) {
        return normalized
      }
    }

    return FALLBACK_MODES
  }

  // ─── Senate / Decrees ─────────────────────────────────────────────────────

  async issueDecree(
    title: string,
    content: string,
    authority = 'duckhive',
    scope: 'universal' | 'agent' | 'session' | 'project' = 'agent',
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<{ success: boolean; decreeId?: string; error?: string }> {
    const result = await this.apiPost<{ success: boolean; decreeId?: string; error?: string }>(
      '/api/decree',
      { title, content, authority, scope, priority }
    )
    return { success: result?.success ?? false, decreeId: result?.decreeId, error: result?.error }
  }

  async getActiveDecrees(): Promise<Decree[]> {
    const data = await this.apiGet<{ decrees: Decree[] }>('/api/decrees')
    return data?.decrees ?? []
  }

  async getDecree(id: string): Promise<Decree | null> {
    return await this.apiGet<Decree>(`/api/decree/${id}`)
  }

  // ─── Teams ────────────────────────────────────────────────────────────────

  async spawnTeam(
    name: string,
    template: Team['template']
  ): Promise<{ success: boolean; teamId?: string; error?: string }> {
    const result = await this.apiPost<{ success: boolean; teamId?: string; error?: string }>(
      '/api/team/spawn',
      { name, template }
    )
    return { success: result?.success ?? false, teamId: result?.teamId, error: result?.error }
  }

  async getActiveTeams(): Promise<Team[]> {
    const data = await this.apiGet<{ teams: Team[] }>('/api/teams')
    return data?.teams ?? []
  }

  // ─── Context for agent ───────────────────────────────────────────────────

  async getContext(): Promise<HiveContext> {
    const [health, session, decrees, teams, councilors] = await Promise.all([
      this.getHealth(),
      this.getCurrentSession(),
      this.getActiveDecrees(),
      this.getActiveTeams(),
      this.getCouncilors(),
    ])

    return {
      activeSession: (session && session.phase !== 'idle') ? session : undefined,
      recentDecrees: decrees.filter(d => d.status === 'active').slice(0, 5),
      activeTeams: teams.filter(t => t.status === 'active'),
      councilorCount: councilors.length || 46,
      senateActive: health?.services?.hiveCore ?? false,
    }
  }

  async formatContextForPrompt(): Promise<string> {
    const ctx = await this.getContext()
    const parts: string[] = []

    parts.push('## Hive Nation Governance Context')

    if (ctx.activeSession) {
      parts.push('')
      parts.push('## ACTIVE COUNCIL DELIBERATION')
      parts.push('Topic: ' + ctx.activeSession.topic)
      parts.push('Mode: ' + ctx.activeSession.mode)
      parts.push('Phase: ' + ctx.activeSession.phase)
      parts.push('Votes: ' + ctx.activeSession.stats.yeas + ' yeas / ' + ctx.activeSession.stats.nays + ' nays')
    }

    const decrees = ctx.recentDecrees ?? []
    if (decrees.length > 0) {
      parts.push('')
      parts.push('## ACTIVE DECREES (' + decrees.length + ')')
      for (const d of decrees) {
        parts.push('  - [' + d.priority.toUpperCase() + '] ' + d.title + ': ' + d.content.substring(0, 80))
      }
    }

    const teams = ctx.activeTeams ?? []
    if (teams.length > 0) {
      parts.push('')
      parts.push('## ACTIVE TEAMS (' + teams.length + ')')
      for (const t of teams) {
        parts.push('  - ' + t.name + ' (' + t.template + ', ' + t.status + ')')
      }
    }

    parts.push('')
    parts.push('## Council: ' + ctx.councilorCount + ' councilors available')
    parts.push('## Senate: ' + (ctx.senateActive ? 'Active' : 'Offline'))

    return parts.join('\n')
  }

  // ─── Utility ─────────────────────────────────────────────────────────────

  isEnabled(): boolean {
    return this.config.enabled
  }

  getOptions(): IntegrationOptions {
    return { ...this.options }
  }

  updateOptions(options: Partial<IntegrationOptions>): void {
    this.options = { ...this.options, ...options }
  }

  shouldConsultCouncil(complexity: number): boolean {
    const auto = this.options.autoConsultCouncil
    const thresh = this.options.councilThreshold
    const result = auto && complexity >= thresh
    logForDebugging(`[hive-bridge] shouldConsultCouncil complexity=${complexity} auto=${auto} threshold=${thresh} → ${result}`)
    return result
  }
}

// ─── Singleton instance ─────────────────────────────────────────────────────

let _instance: HiveBridge | null = null

// Lazy-start the council server on first bridge access
let _councilAutoStartLogged = false

function tryAutoStartCouncil(): void {
  if (!process.env.DUCKHIVE_COUNCIL_AUTO_START) return
  if (_councilAutoStartLogged) return
  _councilAutoStartLogged = true

  const { fork } = require('node:child_process')
  const { join } = require('node:path')

  const port = process.env.COUNCIL_PORT || '3007'
  const checkUrl = `http://localhost:${port}/api/health`

  // Async fire-and-forget - don't block bridge creation
  Promise.resolve().then(async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(checkUrl, { signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) {
        logForDebugging('[hive-bridge] Council already running, no auto-start needed')
        return
      }
    } catch {
      // Not running - spawn it
    }

    const councilPath = join(process.cwd(), 'src', 'services', 'council-server', 'council-api-server.cjs')
    try {
      const child = fork(councilPath, [], {
        env: { ...process.env, PORT: port, NODE_ENV: 'development' },
        detached: true,
        stdio: 'ignore',
      } as any)
      child?.unref?.()
      logForDebugging('[hive-bridge] Auto-started council server via fork')
    } catch (e) {
      logForDebugging(`[hive-bridge] Could not auto-start council: ${e}`)
    }
  }).catch(() => {})
}

export function getHiveBridge(): HiveBridge {
  if (!_instance) {
    tryAutoStartCouncil()
    _instance = new HiveBridge()
  }
  return _instance
}

export function initHiveBridge(config?: Partial<HiveConfig>, options?: Partial<IntegrationOptions>): HiveBridge {
  _instance = new HiveBridge(config, options)
  return _instance
}
