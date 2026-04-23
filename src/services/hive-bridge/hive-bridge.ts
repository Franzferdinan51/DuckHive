/**
 * Hive Nation Bridge Service
 * Bridges OpenClaude with the Hive Nation AI Council + Senate + Teams system
 *
 * Provides: Council deliberation, Senate decrees, Team spawning, and governance
 * API: http://localhost:3131/api/*
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
    process.env.DUCKHIVE_COUNCIL_THRESHOLD || '4',
    10,
  ) || 4,
  showCouncilInRepl: true,
  cacheCouncilResults: true,
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
    const health = await this.apiGet<HiveHealth>('/api/health')
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
    const health = await this.apiGet<HiveHealth>('/api/health')
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
    const data = await this.apiGet<{ councilors: Councilor[] }>('/api/councilors')
    const councilors = data?.councilors ?? []
    this.councilorsCache = councilors
    this.councilorsCacheTime = now
    return councilors
  }

  // ─── Deliberation ─────────────────────────────────────────────────────────

  async startDeliberation(
    topic: string,
    mode: DeliberationMode = 'balanced'
  ): Promise<{ sessionId?: string; success: boolean; error?: string }> {
    const result = await this.apiPost<{ success: boolean; sessionId?: string; error?: string }>(
      '/api/council/deliberate',
      { topic, mode }
    )
    return { success: result?.success ?? false, sessionId: result?.sessionId, error: result?.error }
  }

  async askCouncil(request: AskRequest): Promise<AskResponse> {
    const result = await this.apiPost<AskResponse>('/api/council/ask', {
      question: request.question,
      mode: request.mode ?? 'balanced',
    })
    return result ?? { success: false }
  }

  async getCurrentSession(): Promise<DeliberationSession | null> {
    const data = await this.apiGet<{ current: DeliberationSession }>('/api/council/all')
    return data?.current ?? null
  }

  async getMessages(limit = 50): Promise<DeliberationMessage[]> {
    const data = await this.apiGet<{ messages: DeliberationMessage[] }>(
      `/api/council/messages?limit=${limit}`
    )
    return data?.messages ?? []
  }

  async getModes(): Promise<DeliberationMode[]> {
    return [
      'balanced', 'adversarial', 'consensus', 'brainstorm', 'swarm',
      'devil-advocate', 'legislature', 'prediction', 'inspector',
    ]
  }

  // ─── Senate / Decrees ─────────────────────────────────────────────────────

  async issueDecree(
    title: string,
    content: string,
    authority = 'openclaude',
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
    return this.options.autoConsultCouncil && complexity >= this.options.councilThreshold
  }
}

// ─── Singleton instance ─────────────────────────────────────────────────────

let _instance: HiveBridge | null = null

export function getHiveBridge(): HiveBridge {
  if (!_instance) {
    _instance = new HiveBridge()
  }
  return _instance
}

export function initHiveBridge(config?: Partial<HiveConfig>, options?: Partial<IntegrationOptions>): HiveBridge {
  _instance = new HiveBridge(config, options)
  return _instance
}
