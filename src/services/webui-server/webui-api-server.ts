// @ts-nocheck
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cpus, freemem, platform, totalmem, uptime } from 'node:os'
import { join, resolve } from 'node:path'
import {
  getAgentRunStore,
  type AgentRun,
  type AgentRunEvent,
} from '../../agent-runs/index.js'
import type { DuckHiveSearchProvider } from '../../utils/duckhiveSearch.js'
import { parseRunEventLimit, parseRunStatusFilter } from './runApiUtils.js'
import { getSearchProviderStatus } from './searchProviderStatus.js'
import { getTelegramWebUiStatus } from './telegramStatus.js'

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null

type SessionRecord = {
  id: string
  title: string
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>
  createdAt: number
  updatedAt: number
  runId?: string
}

const DEFAULT_PORT = 3017
const HOST = process.env.DUCKHIVE_WEBUI_API_HOST ?? '127.0.0.1'
const PORT = Number(process.env.DUCKHIVE_WEBUI_API_PORT ?? DEFAULT_PORT)
const sessions = new Map<string, SessionRecord>()

const server = createServer(async (req, res) => {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    await route(req, res)
  } catch (error) {
    sendJson(res, 500, {
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown WebUI API error',
    })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`DuckHive WebUI API listening at http://${HOST}:${PORT}`)
})

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`)
  const method = req.method ?? 'GET'

  if (method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      version: readPackageVersion(),
      timestamp: Date.now(),
      service: 'duckhive-webui-api',
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, await buildStatus())
    return
  }

  if (method === 'GET' && url.pathname === '/api/agents') {
    const runs = getAgentRunStore().listRuns()
    sendJson(res, 200, {
      agents: [
        {
          id: 'builtin',
          name: 'DuckHive Built-in Harness',
          status: runs.some(run => run.status === 'running' || run.status === 'awaiting_approval')
            ? 'busy'
            : 'online',
          model: process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'auto',
          capabilities: ['agent-runs', 'tools', 'mcp', 'telegram', 'desktop-control'],
        },
      ],
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/tools') {
    sendJson(res, 200, { tools: buildToolCatalog() })
    return
  }

  if (method === 'GET' && url.pathname === '/api/mcp/servers') {
    sendJson(res, 200, { servers: buildMcpServers() })
    return
  }

  if (method === 'GET' && url.pathname === '/api/sessions') {
    sendJson(res, 200, { sessions: [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt) })
    return
  }

  if (method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJson(req)
    const session = createSession(typeof body?.title === 'string' ? body.title : undefined)
    sendJson(res, 201, session)
    return
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
  if (method === 'GET' && sessionMatch) {
    const session = sessions.get(decodeURIComponent(sessionMatch[1]))
    if (!session) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    sendJson(res, 200, session)
    return
  }

  if (method === 'GET' && url.pathname === '/api/search-provider') {
    sendJson(res, 200, getSearchProviderStatus())
    return
  }

  if (method === 'POST' && url.pathname === '/api/search-provider') {
    const body = await readJson(req)
    const provider = typeof body?.provider === 'string' ? body.provider : null
    const searxngUrl = typeof body?.searxngUrl === 'string' ? body.searxngUrl : undefined
    if (!provider) {
      sendJson(res, 400, { error: 'provider is required' })
      return
    }
    try {
      const {
        applyDuckHiveSearchPreferenceToEnv,
        normalizeDuckHiveSearchProvider,
        setDuckHiveSearchPreferenceSync,
      } =
        await import('../../utils/duckhiveSearch.js')
      const normalized = normalizeDuckHiveSearchProvider(provider)
      if (!normalized) {
        sendJson(res, 400, { error: `Unknown provider: ${provider}` })
        return
      }
      const saved = setDuckHiveSearchPreferenceSync(
        normalized as DuckHiveSearchProvider,
        { searxngUrl },
      )
      applyDuckHiveSearchPreferenceToEnv(saved)
      sendJson(res, 200, { provider: normalized, searxngUrl: searxngUrl ?? null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sendJson(res, 500, { error: message })
    }
    return
  }

  if (method === 'POST' && url.pathname === '/api/chat') {
    const body = await readJson(req)
    const messages = Array.isArray(body?.messages) ? body.messages : []
    const userMessage = [...messages].reverse().find(message => message?.role === 'user')
    const prompt = typeof userMessage?.content === 'string' ? userMessage.content : 'WebUI request'
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined
    const session = sessionId && sessions.has(sessionId)
      ? sessions.get(sessionId)!
      : createSession(prompt.slice(0, 48))

    session.messages = messages
      .filter(message => typeof message?.role === 'string' && typeof message?.content === 'string')
      .map(message => ({ role: message.role, content: message.content }))
    session.updatedAt = Date.now()

    const store = getAgentRunStore()
    const existingRun = session.runId ? store.getRun(session.runId) : undefined
    const run = existingRun ?? store.createRun({
      title: prompt.slice(0, 72),
      description: prompt,
      status: 'running',
      selectedAgent: 'builtin',
      provider: process.env.CLAUDE_CODE_USE_OPENAI ? 'openai-compatible' : 'auto',
      model: typeof body?.model === 'string' ? body.model : process.env.OPENAI_MODEL ?? 'auto',
      runtimeHarness: 'builtin',
      channelSource: { type: 'headless', id: 'webui' },
      progress: { summary: 'Accepted from DuckHive WebUI', lastActivity: new Date().toISOString() },
    })
    session.runId = run.id

    store.updateRun(run.id, {
      status: 'completed',
      progress: {
        summary: 'WebUI request registered in AgentRun control plane.',
        lastActivity: new Date().toISOString(),
        toolUseCount: run.progress?.toolUseCount ?? 0,
      },
    })

    const content = `Registered this request as AgentRun ${run.id}. The WebUI control plane is online; start DuckHive from the CLI/TUI for full provider-backed execution.`
    session.messages.push({ role: 'assistant', content })
    session.updatedAt = Date.now()

    sendJson(res, 200, {
      id: `chat_${run.id}`,
      model: run.model ?? 'auto',
      runId: run.id,
      session,
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/runs') {
    const statusFilter = parseRunStatusFilter(url.searchParams.get('status'))
    if (!statusFilter.ok) {
      sendJson(res, 400, { error: 'invalid_status', message: statusFilter.message })
      return
    }
    const parentRunId = url.searchParams.get('parentRunId') ?? undefined
    const runs = getAgentRunStore().listRuns({
      status: statusFilter.status,
      parentRunId,
    })
    sendJson(res, 200, { runs, tree: buildRunTree(runs) })
    return
  }

  const runEventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
  if (method === 'GET' && runEventsMatch) {
    const runId = decodeURIComponent(runEventsMatch[1])
    const limit = parseRunEventLimit(url.searchParams.get('limit'))
    sendJson(res, 200, { events: getAgentRunStore().tailEvents(runId, limit) })
    return
  }

  const runActionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/(pause|resume|stop|approve|recover)$/)
  if (method === 'POST' && runActionMatch) {
    const runId = decodeURIComponent(runActionMatch[1])
    const action = runActionMatch[2]
    const body = await readJson(req)
    const store = getAgentRunStore()
    const run = action === 'pause'
      ? store.pauseRun(runId)
      : action === 'resume'
        ? store.resumeRun(runId)
        : action === 'stop'
          ? store.cancelRun(runId)
          : action === 'approve'
            ? store.approveRun(runId, typeof body?.approvalId === 'string' ? body.approvalId : undefined)
            : store.recoverRun(runId, typeof body?.summary === 'string' ? body.summary : undefined)

    if (!run) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    sendJson(res, 200, { run })
    return
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
  if (method === 'GET' && runMatch) {
    const runId = decodeURIComponent(runMatch[1])
    const store = getAgentRunStore()
    const run = store.getRun(runId)
    if (!run) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    sendJson(res, 200, {
      run,
      children: run.childRunIds.map(id => store.getRun(id)).filter(Boolean),
      events: store.tailEvents(run.id, 100),
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/events') {
    streamEvents(res)
    return
  }

  sendJson(res, 404, { error: 'not_found' })
}

function createSession(title = 'New WebUI session'): SessionRecord {
  const now = Date.now()
  const session: SessionRecord = {
    id: `session_${randomUUID()}`,
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
  sessions.set(session.id, session)
  return session
}

function streamEvents(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write(`event: snapshot\ndata: ${JSON.stringify({ runs: getAgentRunStore().listRuns() })}\n\n`)
  const unsubscribe = getAgentRunStore().subscribe((event: AgentRunEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  })
  res.on('close', unsubscribe)
}

async function readJson(req: IncomingMessage): Promise<Record<string, any>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res: ServerResponse, status: number, body: JsonValue): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(`${JSON.stringify(body)}\n`)
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function buildStatus(): Promise<Record<string, unknown>> {
  const total = totalmem()
  const free = freemem()
  const openClawUrl = process.env.OPENCLAW_GATEWAY_URL
  const openClaw = openClawUrl ? await probeUrl(openClawUrl) : { configured: false }
  const desktopControlPath = resolve(process.cwd(), 'skills/newest-desktop-control/package.json')
  const desktopPackage = existsSync(desktopControlPath)
    ? JSON.parse(readFileSync(desktopControlPath, 'utf8')) as { version?: string }
    : undefined

  const searchProvider = getSearchProviderStatus()

  return {
    system: {
      cpuCount: cpus().length,
      memory: {
        used: total - free,
        total,
        percent: Math.round(((total - free) / total) * 100),
      },
      uptime: uptime(),
      platform: platform(),
    },
    provider: {
      provider: process.env.CLAUDE_CODE_USE_OPENAI ? 'openai-compatible' : 'auto',
      model: process.env.OPENAI_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'auto',
    },
    telegram: getTelegramWebUiStatus(),
    desktopControl: {
      configured: Boolean(desktopPackage),
      packagePath: desktopControlPath,
      version: desktopPackage?.version,
      android: process.env.ANDROID_HOME || process.env.ADB ? 'configured' : 'not_configured',
    },
    openClaw,
    searchProvider,
  }
}

async function probeUrl(baseUrl: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(new URL('/health', baseUrl))
    return { configured: true, ok: res.ok, status: res.status, url: baseUrl }
  } catch (error) {
    return {
      configured: true,
      ok: false,
      url: baseUrl,
      error: error instanceof Error ? error.message : 'Probe failed',
    }
  }
}

function buildToolCatalog(): Array<Record<string, unknown>> {
  return [
    { name: 'agent_runs.list', description: 'List active and historical AgentRun records.', dangerous: false, category: 'agent' },
    { name: 'agent_runs.control', description: 'Pause, resume, stop, approve, or recover a run.', dangerous: true, category: 'agent' },
    { name: 'desktop_control.status', description: 'Inspect bundled desktop and Android control gateway readiness.', dangerous: false, category: 'desktop' },
    { name: 'telegram.status', description: 'Inspect Telegram remote-control configuration.', dangerous: false, category: 'channel' },
    { name: 'mcp.servers', description: 'List DuckHive MCP server integration state.', dangerous: false, category: 'mcp' },
  ]
}

function buildMcpServers(): Array<Record<string, unknown>> {
  return [
    {
      id: 'newest-desktop-control',
      name: 'Newest Desktop Control',
      status: existsSync(resolve(process.cwd(), 'skills/newest-desktop-control/package.json')) ? 'connected' : 'disconnected',
      tools: 0,
      url: 'stdio://skills/newest-desktop-control',
    },
  ]
}

function buildRunTree(runs: AgentRun[]): AgentRun[] {
  return runs.filter(run => !run.parentRunId)
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
