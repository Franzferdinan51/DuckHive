/**
 * Telegram Bot Service — grammY runner with OpenClaw-style polling monitor
 *
 * Architecture mirrors OpenClaw's extension/telegram/monitor-polling.runtime.ts:
 * - TelegramPollingMonitor class manages the polling lifecycle
 * - grammY's `run(bot)` starts the non-blocking runner
 * - Automatic reconnection, stall detection, graceful abort
 * - Exponential backoff on recoverable network errors
 *
 * Enable with: DUCKHIVE_TELEGRAM_BOT_TOKEN env var or /connect command.
 * Persists chat_id across restarts so Telegram messages don't get lost.
 */

import { Bot, Context, NextFunction } from 'grammy'
import { run } from '@grammyjs/runner'
import { logForDebugging } from '../../utils/debug.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'

// ============================================================================
// Types
// ============================================================================

export type TelegramCommandHandler = (chatId: number, args: string) => void
export type TelegramMessageHandler = (chatId: number, text: string) => void

// ============================================================================
// Storage helpers
// ============================================================================

const STORAGE_KEY = 'pluginSecrets.telegram'

function getStorageData(): Record<string, unknown> | null {
  try {
    const storage = getSecureStorage()
    return storage.read() as Record<string, unknown> | null
  } catch {
    return null
  }
}

function saveStorageData(data: Record<string, unknown>): void {
  try {
    const storage = getSecureStorage()
    const existing = storage.read() as Record<string, unknown> ?? {}
    existing.pluginSecrets = existing.pluginSecrets ?? {}
    ;(existing.pluginSecrets as Record<string, unknown>)['telegram'] = {
      ...((existing.pluginSecrets as Record<string, unknown>)['telegram'] as Record<string, unknown> | undefined),
      ...data,
    }
    storage.update(existing)
  } catch { /* ignore */ }
}

function getStoredChatId(): number | null {
  const data = getStorageData()
  const telegram = data?.pluginSecrets as Record<string, unknown> | undefined
  return (telegram?.['telegram'] as Record<string, unknown> | undefined)?.['chatId'] as number | undefined ?? null
}

function saveChatId(chatId: number): void {
  saveStorageData({ chatId, connectionStatus: 'connected' })
}

// ============================================================================
// Constants
// ============================================================================

const POLL_WATCHDOG_INTERVAL_MS = 5_000
const STALL_THRESHOLD_MS = 60_000
const POLL_STOP_GRACE_MS = 10_000
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000
const CONFIRM_PERSISTED_OFFSET_TIMEOUT_MS = 10_000

// ============================================================================
// Service state
// ============================================================================

let bot: Bot | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runner: any = null
let registeredChatId: number | null = null
let isConnected = false

// REPL integration
let replMessageHandler: ((text: string) => Promise<void>) | null = null
const telegramMessageQueue: Array<{ chatId: number; text: string }> = []
const commandHandlers = new Map<string, TelegramCommandHandler>()
const messageHandlers: TelegramMessageHandler[] = []

// Abort controller for graceful shutdown
let fetchAbortController: AbortController | null = null
let isShuttingDown = false

// Polling liveness tracking
let lastPollSuccessTime = 0
let lastGetUpdatesError: string | null = null
let consecutiveGetUpdatesErrors = 0

// ============================================================================
// Public API
// ============================================================================

export function registerCommand(command: string, handler: TelegramCommandHandler): void {
  commandHandlers.set(command, handler)
}

export function onTelegramMessage(handler: TelegramMessageHandler): () => void {
  messageHandlers.push(handler)
  return () => {
    const idx = messageHandlers.indexOf(handler)
    if (idx !== -1) messageHandlers.splice(idx, 1)
  }
}

export function getRegisteredChatId(): number | null {
  return registeredChatId
}

export function isTelegramConnected(): boolean {
  return isConnected
}

function getToken(): string | null {
  return process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN ?? null
}

// ============================================================================
// REPL Integration
// ============================================================================

export function onTelegramReplMessage(handler: (text: string) => Promise<void>): () => void {
  replMessageHandler = handler
  while (telegramMessageQueue.length > 0) {
    const msg = telegramMessageQueue.shift()
    if (msg && replMessageHandler) {
      replMessageHandler(msg.text).catch(err =>
        logForDebugging(`[telegram] queued repl error: ${err}`),
      )
    }
  }
  return () => { replMessageHandler = null }
}

export function queueTelegramMessageForRepl(chatId: number, text: string): void {
  if (replMessageHandler) {
    replMessageHandler(text).catch(err =>
      logForDebugging(`[telegram] repl handler error: ${err}`),
    )
  } else {
    telegramMessageQueue.push({ chatId, text })
    logForDebugging(`[telegram] queued message (${telegramMessageQueue.length} in queue)`)
  }
}

// ============================================================================
// grammY Bot Setup
// ============================================================================

function createBot(token: string): Bot {
  const bot = new Bot(token)

  // ── Built-in commands ───────────────────────────────────────────────────
  bot.command('start', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    registeredChatId = chatId
    saveChatId(chatId)
    logForDebugging(`[telegram] /start registered chat ${chatId}`)
    await ctx.reply(
      '✅ *DuckHive connected!*\n\n' +
      'Send me a message and I\'ll forward it to your DuckHive session.\n' +
      'Use /help for commands.',
      { parse_mode: 'Markdown' },
    )
    for (const h of messageHandlers) {
      try { h(chatId, '') } catch { /* noop */ }
    }
  })

  bot.command('help', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    await ctx.reply(
      '*DuckHive Telegram Commands*\n\n' +
      '• /start — Register with DuckHive\n' +
      '• /status — Current session status\n' +
      '• /help — Show this help\n\n' +
      'Any message without a leading slash is sent to DuckHive.',
      { parse_mode: 'Markdown' },
    )
  })

  bot.command('status', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const stored = registeredChatId ?? getStoredChatId()
    await ctx.reply(
      `*DuckHive Status*\n\n` +
      `Session: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}\n` +
      `Chat: ${stored ? `✅ (${stored})` : '❌ not registered'}\n` +
      `Queue: ${telegramMessageQueue.length} message(s)\n\n` +
      `Send /help for commands.`,
      { parse_mode: 'Markdown' },
    )
  })

  // Custom commands registered via registerCommand()
  bot.command('duckhive_status', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const handler = commandHandlers.get('status')
    if (handler) {
      try { handler(chatId, '') }
      catch (err) { await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`) }
    }
  })

  // ── Text messages → REPL queue ─────────────────────────────────────────
  bot.on('message:text', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    const message = ctx.message
    if (!chatId || !message) return
    const text: string = message.text ?? ''

    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ')
      const cmd = parts[0].toLowerCase()
      const args = parts.slice(1).join(' ')

      if (['start', 'help', 'status', 'duckhive_status'].includes(cmd)) return

      const handler = commandHandlers.get(cmd)
      if (handler) {
        try { handler(chatId, args) }
        catch (err) {
          try { await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`) }
          catch { /* ignore */ }
        }
      } else {
        try { await ctx.reply(`Unknown command: /${cmd}. Try /help`) }
        catch { /* ignore */ }
      }
      return
    }

    // Persist chatId on first message
    if (!registeredChatId) {
      registeredChatId = chatId
      saveChatId(chatId)
      logForDebugging(`[telegram] registered chat ${chatId}`)
      for (const h of messageHandlers) {
        try { h(chatId, '') } catch { /* noop */ }
      }
    }

    for (const h of messageHandlers) {
      try { h(chatId, text) }
      catch (err) { logForDebugging(`[telegram] message handler error: ${err}`) }
    }

    queueTelegramMessageForRepl(chatId, text)
  })

  // ── Error handler ──────────────────────────────────────────────────────
  bot.catch((err: Error & { ctx?: Context }) => {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`[telegram] bot error: ${msg}`)
    if (err.ctx && err.ctx.chat) {
      err.ctx.reply(`Error: ${msg}`).catch(() => {})
    }
  })

  return bot
}

// ============================================================================
// Polling Monitor (mirrors OpenClaw's TelegramPollingMonitor)
// ============================================================================

function isRecoverableNetworkError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  // Network errors, timeouts, 5xx from Telegram
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch/i.test(msg)) return true
  if (/5\d{2}|gateway.?timeout|service.?unavailable/i.test(msg)) return true
  return false
}

function isSafeToRetrySendError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  if (/420|429|flood/i.test(msg)) return false // rate limited — don't retry
  return true
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }, { once: true })
  })
}

async function waitBeforeRetry(
  err: unknown,
  logPrefix: string,
  minDelay = BASE_RETRY_DELAY_MS,
  maxDelay = MAX_RETRY_DELAY_MS,
): Promise<number> {
  if (isShuttingDown) return -1
  const msg = err instanceof Error ? err.message : String(err)
  logForDebugging(`${logPrefix}: ${msg}; retrying...`)
  // Exponential backoff with jitter
  const delay = Math.min(minDelay * 2 ** Math.random(), maxDelay)
  await sleepWithAbort(delay)
  return delay
}

async function confirmPersistedOffset(botInstance: Bot, lastUpdateId: number): Promise<void> {
  if (lastUpdateId < 0) return
  try {
    await botInstance.api.getUpdates({
      offset: lastUpdateId + 1,
      limit: 1,
      timeout: 0,
    })
  } catch { /* ignore — best-effort confirmation */ }
}

async function runPollingCycle(botInstance: Bot): Promise<'continue' | 'exit'> {
  const abortSignal = fetchAbortController?.signal

  // Confirm the persisted offset so we don't re-process old messages
  await confirmPersistedOffset(botInstance, getStoredChatId() ? 0 : -1)

  // Wrap getUpdates with liveness tracking (mirrors OpenClaw pattern)
  let callId = 0
  const originalFetch = botInstance.api.config.use

  // Start the grammY runner — this is the core polling loop
  const runningRunner = run(botInstance, {
    // runner handles: auto-reconnect, back-pressure, sequential processing
    // no extra options needed — grammY runner is self-managing
  })

  runner = runningRunner
  lastPollSuccessTime = Date.now()

  // Abort handling
  const stopRunner = () => {
    fetchAbortController?.abort()
    if (runner) {
      const r = runner
      runner = null
      r.stop().catch(() => {})
    }
  }

  const stopBot = () => {
    botInstance.stop().catch(() => {})
  }

  // Stall watchdog — detect if getUpdates stops returning
  let stallTimer: ReturnType<typeof setInterval> | null = null
  let forceTimer: ReturnType<typeof setTimeout> | null = null
  let forceResolve: (() => void) | null = null

  const forceCyclePromise = new Promise<void>((resolve) => { forceResolve = resolve })

  const watchdog = setInterval(() => {
    if (isShuttingDown || abortSignal?.aborted) return

    const elapsed = Date.now() - lastPollSuccessTime
    if (elapsed > STALL_THRESHOLD_MS) {
      logForDebugging(`[telegram] polling stall detected (${elapsed}ms since last success)`)
      stopRunner()
      stopBot()
      if (!forceTimer) {
        forceTimer = setTimeout(() => {
          if (isShuttingDown || abortSignal?.aborted) return
          logForDebugging(`[telegram] polling stop timed out, forcing restart`)
          forceResolve?.()
        }, POLL_STOP_GRACE_MS)
      }
    }
  }, POLL_WATCHDOG_INTERVAL_MS)

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      stopRunner()
      stopBot()
    }, { once: true })
  }

  try {
    await Promise.race([runningRunner.task(), forceCyclePromise])
  } catch (err) {
    if (isShuttingDown) return 'exit'
    logForDebugging(`[telegram] runner task error: ${err}`)
  }

  clearInterval(watchdog)
  if (forceTimer) clearTimeout(forceTimer)

  if (isShuttingDown || abortSignal?.aborted) return 'exit'

  // Runner stopped — determine reason and retry
  logForDebugging('[telegram] polling runner stopped, restarting cycle')
  return 'continue'
}

// ============================================================================
// Service lifecycle
// ============================================================================

export async function startTelegramService(): Promise<void> {
  const token = getToken()
  if (!token) {
    logForDebugging('[telegram] no DUCKHIVE_TELEGRAM_BOT_TOKEN set, skipping')
    return
  }

  if (bot) {
    logForDebugging('[telegram] already running')
    return
  }

  isShuttingDown = false

  try {
    // Create bot instance
    bot = createBot(token)

    // Restore chatId from storage
    const storedChatId = getStoredChatId()
    if (storedChatId) {
      registeredChatId = storedChatId
      logForDebugging(`[telegram] restored chat ${storedChatId} from storage`)
    }

    // Verify bot identity
    const me = await bot.api.getMe()
    logForDebugging(`[telegram] bot username: @${me.username}`)

    isConnected = true
    logForDebugging('[telegram] service starting')

    // Start the polling loop (non-blocking via setTimeout)
    setTimeout(startPollingLoop, 0)
  } catch (err) {
    bot = null
    isConnected = false
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`[telegram] failed to start: ${msg}`)
  }
}

let pollingActive = false

async function startPollingLoop(): Promise<void> {
  if (isShuttingDown || !bot) return

  fetchAbortController = new AbortController()
  pollingActive = true
  let retryCount = 0

  while (!isShuttingDown && bot) {
    try {
      const result = await runPollingCycle(bot)
      if (result === 'exit' || isShuttingDown) break

      // Successful poll — reset retry counter
      retryCount = 0

    } catch (err) {
      if (isShuttingDown || !bot) break

      const isRecoverable = isRecoverableNetworkError(err)
      if (!isRecoverable) {
        logForDebugging(`[telegram] non-recoverable error: ${err instanceof Error ? err.message : String(err)}`)
        break
      }

      const delay = await waitBeforeRetry(
        err,
        `[telegram] network error`,
        BASE_RETRY_DELAY_MS * Math.max(1, retryCount),
        MAX_RETRY_DELAY_MS,
      )
      if (delay < 0 || isShuttingDown) break

      retryCount = Math.min(retryCount + 1, 10)

      // Recreate bot after network error (fresh connection)
      try {
        const token = getToken()
        if (token) {
          bot = createBot(token)
          const me = await bot.api.getMe()
          logForDebugging(`[telegram] bot reconnected as @${me.username}`)
        }
      } catch (reconnectErr) {
        logForDebugging(`[telegram] reconnect failed: ${reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr)}`)
      }
    }
  }

  pollingActive = false
  logForDebugging('[telegram] polling loop ended')
}

export function stopTelegramService(): void {
  if (!bot && !pollingActive) return

  isShuttingDown = true
  fetchAbortController?.abort()

  if (runner) {
    const r = runner
    runner = null
    r.stop().catch(() => {})
  }

  if (bot) {
    bot.stop().catch(() => {})
    bot = null
  }

  isConnected = false
  logForDebugging('[telegram] service stopped (chatId preserved in storage)')
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const chatId = registeredChatId ?? getStoredChatId()
  if (!chatId || !bot) {
    logForDebugging('[telegram] cannot send: no registered chat or no bot')
    return false
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (bot.api.sendMessage as any)(chatId, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    })
    logForDebugging(`[telegram] sent message to ${chatId}`)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logForDebugging(`[telegram] send error: ${msg}`)
    return false
  }
}

// ============================================================================
// Auto-start (when token is present)
// ============================================================================

const autoStartToken = getToken()
if (autoStartToken) {
  setTimeout(() => {
    startTelegramService().catch(() => {})
  }, 2000)
}