/**
 * Hive Service Manager
 * Auto-starts and manages Hive Nation services as child processes:
 * - Council API Server (default port 3007)
 * - WebUI Server (default port 3131)
 * - Agent Mesh API (default port 4000)
 *
 * Uses health checks to detect if already running before spawning.
 * Services are started on REPL init if HIVE_COUNCIL_ENABLED !== 'false'.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HttpProxyAgent } from 'hpagent'
import { logForDebugging } from '../../utils/debug.js'

// ─── Config ───────────────────────────────────────────────────────────────────

const COUNCIL_PORT = Number.parseInt(process.env.COUNCIL_PORT || '3007', 10)
const WEBUI_PORT = Number.parseInt(process.env.WEBUI_PORT || '3131', 10)
const MESH_PORT = Number.parseInt(process.env.MESH_PORT || '4000', 10)

const HEALTH_TIMEOUT_MS = 5000
const STARTUP_TIMEOUT_MS = 15_000

const HIVE_ENABLED = process.env.HIVE_COUNCIL_ENABLED !== 'false'
const HIVE_SERVICES_DIR =
  process.env.HIVE_SERVICES_DIR ||
  join(process.cwd(), 'src', 'services', 'council-server')

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ServiceInfo {
  name: string
  port: number
  healthPath: string
  process?: ChildProcess
  started: boolean
}

// ─── Health Checker ────────────────────────────────────────────────────────────

async function checkHealth(port: number, path: string): Promise<boolean> {
  const url = `http://localhost:${port}${path}`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal as any,
      agent: new HttpProxyAgent({ keepAlive: false } as any),
    } as any)
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// ─── Service Definitions ──────────────────────────────────────────────────────

const SERVICES: ServiceInfo[] = [
  {
    name: 'Council API',
    port: COUNCIL_PORT,
    healthPath: '/api/health',
    started: false,
  },
  {
    name: 'WebUI',
    port: WEBUI_PORT,
    healthPath: '/health',
    started: false,
  },
  {
    name: 'Mesh API',
    port: MESH_PORT,
    healthPath: '/api/status',
    started: false,
  },
]

// ─── Single Service Starter ─────────────────────────────────────────────────────

function startService(svc: ServiceInfo, entryPoint: string): Promise<boolean> {
  return new Promise(resolve => {
    if (!existsSync(entryPoint)) {
      logForDebugging(`[HiveServiceManager] ${svc.name}: entry not found at ${entryPoint}`)
      resolve(false)
      return
    }

    const ext = entryPoint.endsWith('.cjs') ? 'cjs' : 'js'
    const proc = spawn(process.execPath, [entryPoint], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(svc.port),
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    } as any)

    svc.process = proc

    proc.stdout?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) logForDebugging(`[${svc.name}] ${line}`)
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString().trim()
      if (line) logForDebugging(`[${svc.name}][ERR] ${line}`)
    })

    proc.on('exit', (code) => {
      logForDebugging(`[HiveServiceManager] ${svc.name} exited with code ${code}`)
      svc.process = undefined
    })

    // Wait for health check to pass
    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    const poll = () => {
      if (Date.now() > deadline) {
        logForDebugging(`[HiveServiceManager] ${svc.name}: startup timeout`)
        proc.kill()
        resolve(false)
        return
      }
      checkHealth(svc.port, svc.healthPath).then(ok => {
        if (ok) {
          svc.started = true
          logForDebugging(`[HiveServiceManager] ${svc.name} is ready at http://localhost:${svc.port}`)
          resolve(true)
        } else {
          setTimeout(poll, 500)
        }
      })
    }
    poll()
  })
}

// ─── Main Orchestrator ─────────────────────────────────────────────────────────

export interface HiveServiceStatus {
  name: string
  port: number
  running: boolean
  url: string
}

export async function ensureHiveServices(): Promise<HiveServiceStatus[]> {
  if (!HIVE_ENABLED) {
    logForDebugging('[HiveServiceManager] disabled via HIVE_COUNCIL_ENABLED=false')
    return []
  }

  logForDebugging('[HiveServiceManager] Starting Hive services...')

  // Check which services are already running
  await Promise.all(
    SERVICES.map(async (svc) => {
      const ok = await checkHealth(svc.port, svc.healthPath)
      if (ok) {
        svc.started = true
        logForDebugging(`[HiveServiceManager] ${svc.name} already running on port ${svc.port}`)
      }
    })
  )

  const needsStart = SERVICES.filter(s => !s.started)

  // Start missing services in parallel
  const entryPoints: Record<string, string> = {
    'Council API': join(HIVE_SERVICES_DIR, 'council-api-server.cjs'),
    'WebUI': join(HIVE_SERVICES_DIR, '..', 'council-webui', 'server.js'),
    'Mesh API': join(HIVE_SERVICES_DIR, '..', 'mesh-api', 'server.js'),
  }

  const results = await Promise.all(
    needsStart.map(svc => {
      const ep = entryPoints[svc.name]
      return ep ? startService(svc, ep) : Promise.resolve(false)
    })
  )

  return SERVICES.map(svc => ({
    name: svc.name,
    port: svc.port,
    running: svc.started,
    url: `http://localhost:${svc.port}`,
  }))
}

export function getHiveServiceStatus(): HiveServiceStatus[] {
  return SERVICES.map(svc => ({
    name: svc.name,
    port: svc.port,
    running: !!svc.process || svc.started,
    url: `http://localhost:${svc.port}`,
  }))
}

export function stopHiveServices(): void {
  for (const svc of SERVICES) {
    if (svc.process) {
      logForDebugging(`[HiveServiceManager] Stopping ${svc.name}`)
      svc.process.kill()
      svc.process = undefined
      svc.started = false
    }
  }
}

// Handle process termination
process.on('SIGTERM', stopHiveServices)
process.on('exit', stopHiveServices)