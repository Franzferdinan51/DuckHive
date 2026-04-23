/**
 * Hive Nation Bridge - TypeScript types for the AI Council integration
 * Part of the OpenClaude + Hive Nation integration
 */

export interface HiveConfig {
  apiBase: string  // e.g., 'http://localhost:3131'
  wsBase?: string  // WebSocket for live updates
  apiKey?: string
  enabled: boolean
}

export interface Councilor {
  id: string
  name: string
  role: string
  specialty: string
  party?: string
  avatar?: string
  traits?: string[]
  position?: string
  votingRecord?: number
}

export interface DeliberationSession {
  id: string
  topic: string
  mode: DeliberationMode
  phase: 'idle' | 'opening' | 'deliberation' | 'voting' | 'ended'
  messages: DeliberationMessage[]
  stats: {
    yeas: number
    nays: number
    abstainers: number
  }
  startedAt?: number
  endedAt?: number
  elapsed?: number
  viewerCount?: number
}

export type DeliberationMode =
  | 'balanced'      // Standard deliberation
  | 'adversarial'   // Devil's advocate mode
  | 'consensus'     // Consensus building
  | 'brainstorm'    // Creative ideation
  | 'swarm'         // Parallel specialist opinions
  | 'swarm_coding'  // Multi-agent code development with quality gates
  | 'deep_research' // Comprehensive research with source verification
  | 'collaborative' // Collaborative building with shared state
  | 'devil-advocate'
  | 'legislature'
  | 'prediction'
  | 'inspector'

export interface DeliberationMessage {
  id?: string
  councilor: string
  role?: string
  content: string
  vote?: 'yea' | 'nay' | 'abstain'
  timestamp?: number
  type?: 'opening' | 'argument' | 'rebuttal' | 'question' | 'vote' | 'closing'
  confidence?: number
}

export interface Decree {
  id: string
  title: string
  content: string
  status: 'active' | 'pending' | 'archived' | 'repealed'
  authority: string
  scope: 'universal' | 'agent' | 'session' | 'project'
  priority: 'high' | 'medium' | 'low'
  votes?: {
    yeas: number
    nays: number
    passedAt?: number
  }
  createdAt: number
  enactedAt?: number
}

export interface Team {
  id: string
  name: string
  template: TeamTemplate
  status: 'planning' | 'active' | 'completed' | 'failed'
  roles: TeamRole[]
  createdAt: number
  tasks?: TeamTask[]
}

export type TeamTemplate =
  | 'research'   // researcher + writer + reviewer
  | 'code'       // coder + reviewer + security
  | 'security'   // security + reviewer + communicator
  | 'emergency'  // security + communicator + planner
  | 'planning'   // planning + analysis
  | 'analysis'   // analysis + research
  | 'devops'     // devops + security
  | 'swarm'      // multiple specialists

export interface TeamRole {
  role: string
  agentId?: string
  status: 'pending' | 'active' | 'done'
  output?: string
}

export interface TeamTask {
  id: string
  description: string
  assignedTo: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface HiveHealth {
  status: 'ok' | 'degraded' | 'error'
  timestamp: number
  uptime: number
  memory: {
    used: number
    total: number
    percentage: number
  }
  services: {
    council: boolean
    hiveCore: boolean
  }
}

export interface AskRequest {
  question: string
  mode?: DeliberationMode
  urgency?: 'high' | 'normal' | 'low'
  scope?: 'quick' | 'standard' | 'deep'
}

export interface AskResponse {
  success: boolean
  sessionId?: string
  verdict?: string
  summary?: string
  consensus?: number
  messages?: DeliberationMessage[]
  recommendations?: string[]
}

// Tool integration types
export interface HiveContext {
  activeSession?: DeliberationSession
  recentDecrees?: Decree[]
  activeTeams?: Team[]
  councilorCount: number
  senateActive: boolean
}

export interface IntegrationOptions {
  autoConsultCouncil: boolean  // Automatically consult council for complex tasks
  councilThreshold: number     // Complexity threshold to trigger council (1-10)
  showCouncilInRepl: boolean   // Show council status in REPL UI
  cacheCouncilResults: boolean  // Cache council verdicts for similar questions
}
