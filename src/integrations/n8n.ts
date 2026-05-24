/**
 * n8n Workflow Automation Integration
 *
 * Inspired by DreamServer's n8n workflow automation, adapted for DuckHive.
 *
 * Provides integration patterns for connecting DuckHive to n8n's 400+ service
 * integrations. Enables DuckHive agents to trigger n8n workflows, pass data
 * between automation and AI agent contexts, and react to webhook events.
 *
 * Integration pattern:
 *   1. DuckHive tool calls n8n webhook to trigger a workflow
 *   2. n8n processes the workflow (send email, update CRM, post to Slack, etc.)
 *   3. n8n calls back to DuckHive via webhook to return results
 *
 * Use cases:
 *   - Agent triggers deployment pipeline via n8n webhook
 *   - Agent sends notifications through n8n → Slack/Teams/Email
 *   - Agent creates tickets via n8n → Jira/Linear/GitHub Issues
 *   - Agent queries databases via n8n → PostgreSQL/MySQL/MongoDB
 */

import { logForDebugging } from '../utils/debug.js'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface N8nConfig {
  /** Base URL of the n8n instance (e.g., "http://localhost:5678") */
  baseUrl: string
  /** API key for authenticating with n8n (optional — use webhook auth instead) */
  apiKey?: string
  /** Default timeout for n8n webhook calls in ms */
  timeoutMs: number
  /** Whether to verify SSL certificates */
  verifySSL: boolean
}

export interface N8nWebhookPayload {
  /** Source of the trigger (e.g., "duckhive-agent") */
  source: string
  /** Action type for the workflow to interpret */
  action: string
  /** Arbitrary data payload */
  data: Record<string, unknown>
  /** Optional callback webhook URL for n8n to respond to */
  callbackUrl?: string
  /** Unique correlation ID for tracking */
  correlationId: string
}

export interface N8nWorkflowResult {
  /** Whether the workflow trigger was successful */
  success: boolean
  /** HTTP status code */
  statusCode: number
  /** Response data from n8n */
  data?: unknown
  /** Error message if failed */
  error?: string
}

export interface N8nWorkflowDefinition {
  /** Unique workflow name */
  name: string
  /** Description of what the workflow does */
  description: string
  /** Webhook path (e.g., "webhook/deploy-to-production") */
  webhookPath: string
  /** HTTP method for the webhook */
  method: 'GET' | 'POST' | 'PUT'
  /** Tags for categorization */
  tags: string[]
  /** Required input fields */
  requiredFields?: string[]
}

// ─── Default workflows catalog ─────────────────────────────────────────────

const DEFAULT_N8N_WORKFLOWS: N8nWorkflowDefinition[] = [
  {
    name: 'send-notification',
    description: 'Send a notification via Slack, Teams, Discord, or Email',
    webhookPath: 'webhook/send-notification',
    method: 'POST',
    tags: ['communication', 'notification'],
    requiredFields: ['message', 'channel'],
  },
  {
    name: 'create-github-issue',
    description: 'Create a GitHub issue with title and body',
    webhookPath: 'webhook/create-github-issue',
    method: 'POST',
    tags: ['github', 'ticketing'],
    requiredFields: ['title', 'body', 'repo'],
  },
  {
    name: 'trigger-deployment',
    description: 'Trigger a deployment pipeline (Vercel, Railway, GitHub Actions)',
    webhookPath: 'webhook/trigger-deployment',
    method: 'POST',
    tags: ['deployment', 'ci-cd'],
    requiredFields: ['project', 'branch'],
  },
  {
    name: 'query-database',
    description: 'Run a database query and return results',
    webhookPath: 'webhook/query-database',
    method: 'POST',
    tags: ['database', 'data'],
    requiredFields: ['query'],
  },
  {
    name: 'create-jira-ticket',
    description: 'Create a Jira ticket with summary and description',
    webhookPath: 'webhook/create-jira-ticket',
    method: 'POST',
    tags: ['jira', 'ticketing'],
    requiredFields: ['summary', 'description', 'project'],
  },
  {
    name: 'send-email',
    description: 'Send an email via SMTP or SendGrid',
    webhookPath: 'webhook/send-email',
    method: 'POST',
    tags: ['email', 'communication'],
    requiredFields: ['to', 'subject', 'body'],
  },
  {
    name: 'update-crm',
    description: 'Update a CRM record (Salesforce, HubSpot, etc.)',
    webhookPath: 'webhook/update-crm',
    method: 'POST',
    tags: ['crm', 'data'],
    requiredFields: ['entity', 'id', 'fields'],
  },
  {
    name: 'run-scheduled-task',
    description: 'Execute a scheduled maintenance or cleanup task',
    webhookPath: 'webhook/run-scheduled-task',
    method: 'POST',
    tags: ['automation', 'maintenance'],
    requiredFields: ['taskName'],
  },
]

// ─── Module state ──────────────────────────────────────────────────────────

let config: N8nConfig = {
  baseUrl: process.env.N8N_BASE_URL ?? 'http://localhost:5678',
  apiKey: process.env.N8N_API_KEY,
  timeoutMs: 30_000,
  verifySSL: true,
}

const registeredWorkflows: Map<string, N8nWorkflowDefinition> = new Map()
const pendingCallbacks: Map<string, {
  resolve: (result: N8nWorkflowResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}> = new Map()

// ─── Configuration ─────────────────────────────────────────────────────────

export function configureN8n(overrides: Partial<N8nConfig>): void {
  config = { ...config, ...overrides }
}

export function getN8nConfig(): N8nConfig {
  return { ...config }
}

// ─── Workflow registration ─────────────────────────────────────────────────

/**
 * Register available n8n workflows. Replaces the default catalog.
 */
export function registerWorkflows(workflows: N8nWorkflowDefinition[]): void {
  registeredWorkflows.clear()
  for (const wf of workflows) {
    registeredWorkflows.set(wf.name, wf)
  }
  logForDebugging(`[N8n] Registered ${workflows.length} workflows`)
}

/**
 * Get all registered workflows.
 */
export function getWorkflows(): N8nWorkflowDefinition[] {
  if (registeredWorkflows.size === 0) {
    // Initialize with defaults if not yet registered
    for (const wf of DEFAULT_N8N_WORKFLOWS) {
      registeredWorkflows.set(wf.name, wf)
    }
  }
  return [...registeredWorkflows.values()]
}

/**
 * Find a workflow by name.
 */
export function getWorkflow(name: string): N8nWorkflowDefinition | undefined {
  return getWorkflows().find(w => w.name === name)
}

/**
 * Find workflows by tag.
 */
export function getWorkflowsByTag(tag: string): N8nWorkflowDefinition[] {
  return getWorkflows().filter(w => w.tags.includes(tag))
}

// ─── Webhook invocation ────────────────────────────────────────────────────

let correlationCounter = 0

function generateCorrelationId(): string {
  return `dh-${Date.now()}-${++correlationCounter}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Trigger an n8n workflow via webhook.
 *
 * @param workflowName  Name of the registered workflow
 * @param action  Action to pass to n8n
 * @param data  Payload data
 * @param options  Additional options
 * @returns  Result of the webhook call
 */
export async function triggerWorkflow(
  workflowName: string,
  action: string,
  data: Record<string, unknown>,
  options?: {
    /** Override the default webhook path */
    webhookPath?: string
    /** Callback URL for async results */
    callbackUrl?: string
    /** Custom timeout in ms */
    timeoutMs?: number
    /** Signal for aborting */
    signal?: AbortSignal
  },
): Promise<N8nWorkflowResult> {
  const workflow = getWorkflow(workflowName)
  if (!workflow) {
    return {
      success: false,
      statusCode: 0,
      error: `Workflow "${workflowName}" not found. Available: ${getWorkflows().map(w => w.name).join(', ')}`,
    }
  }

  const correlationId = generateCorrelationId()
  const webhookPath = options?.webhookPath ?? workflow.webhookPath
  const url = `${config.baseUrl.replace(/\/+$/, '')}/${webhookPath.replace(/^\/+/, '')}`

  const payload: N8nWebhookPayload = {
    source: 'duckhive',
    action,
    data,
    callbackUrl: options?.callbackUrl,
    correlationId,
  }

  // Validate required fields
  if (workflow.requiredFields) {
    const missing = workflow.requiredFields.filter(f => !(f in data))
    if (missing.length > 0) {
      return {
        success: false,
        statusCode: 0,
        error: `Missing required fields for "${workflowName}": ${missing.join(', ')}`,
      }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? config.timeoutMs,
  )

  // Merge external signal
  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort())
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DuckHive-Correlation-Id': correlationId,
    }

    if (config.apiKey) {
      headers['X-N8N-API-Key'] = config.apiKey
    }

    const response = await fetch(url, {
      method: workflow.method,
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    let responseData: unknown
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      responseData = await response.json()
    } else {
      responseData = await response.text()
    }

    const success = response.status >= 200 && response.status < 300

    if (success) {
      logForDebugging(
        `[N8n] Triggered "${workflowName}" → ${url} (${response.status}) [corr: ${correlationId}]`,
      )
    } else {
      logForDebugging(
        `[N8n] Failed to trigger "${workflowName}": status ${response.status} [corr: ${correlationId}]`,
      )
    }

    return {
      success,
      statusCode: response.status,
      data: responseData,
    }
  } catch (error) {
    clearTimeout(timeout)

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        statusCode: 0,
        error: `Timeout after ${options?.timeoutMs ?? config.timeoutMs}ms`,
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    logForDebugging(`[N8n] Error triggering "${workflowName}": ${message}`)

    return {
      success: false,
      statusCode: 0,
      error: message,
    }
  }
}

/**
 * Convenience method: trigger a notification workflow.
 */
export async function sendNotification(
  message: string,
  channel: string,
  extra?: Record<string, unknown>,
): Promise<N8nWorkflowResult> {
  return triggerWorkflow('send-notification', 'notify', {
    message,
    channel,
    ...extra,
  })
}

/**
 * Convenience method: create a GitHub issue.
 */
export async function createGitHubIssue(
  title: string,
  body: string,
  repo: string,
  extra?: Record<string, unknown>,
): Promise<N8nWorkflowResult> {
  return triggerWorkflow('create-github-issue', 'create', {
    title,
    body,
    repo,
    ...extra,
  })
}

/**
 * Convenience method: trigger a deployment.
 */
export async function triggerDeployment(
  project: string,
  branch: string,
  extra?: Record<string, unknown>,
): Promise<N8nWorkflowResult> {
  return triggerWorkflow('trigger-deployment', 'deploy', {
    project,
    branch,
    ...extra,
  })
}

/**
 * Convenience method: create a Jira ticket.
 */
export async function createJiraTicket(
  summary: string,
  description: string,
  project: string,
  extra?: Record<string, unknown>,
): Promise<N8nWorkflowResult> {
  return triggerWorkflow('create-jira-ticket', 'create', {
    summary,
    description,
    project,
    ...extra,
  })
}

// ─── Webhook receiver (for n8n callbacks) ──────────────────────────────────

/**
 * Handle an incoming webhook callback from n8n.
 * Resolves the pending callback matching the correlation ID.
 */
export function handleN8nCallback(
  correlationId: string,
  result: N8nWorkflowResult,
): boolean {
  const pending = pendingCallbacks.get(correlationId)
  if (!pending) return false

  clearTimeout(pending.timeout)
  pendingCallbacks.delete(correlationId)
  pending.resolve(result)
  return true
}

/**
 * Clean up all pending callbacks (e.g., on shutdown).
 */
export function cleanupN8nCallbacks(): void {
  for (const [id, pending] of pendingCallbacks) {
    clearTimeout(pending.timeout)
    pendingCallbacks.delete(id)
    pending.reject(new Error('N8n integration shutting down'))
  }
}

// ─── Health check ──────────────────────────────────────────────────────────

/**
 * Check if the configured n8n instance is reachable.
 */
export async function checkN8nHealth(): Promise<{
  reachable: boolean
  version?: string
  error?: string
}> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/healthz`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      try {
        const data = await response.json() as { version?: string }
        return { reachable: true, version: data.version ?? 'unknown' }
      } catch {
        return { reachable: true }
      }
    }

    return { reachable: false, error: `HTTP ${response.status}` }
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ─── Export default workflow catalog for tool definitions ──────────────────

export { DEFAULT_N8N_WORKFLOWS }
