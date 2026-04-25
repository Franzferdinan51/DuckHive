/**
 * Telegram Bot Service — grammY-backed
 *
 * Bidirectional communication between DuckHive REPL and Telegram.
 * Uses grammY's Bot class with the @grammyjs/runner for robust long-polling.
 * grammY handles all Telegram API calls, automatic reconnection, rate limiting,
 * sequential message processing, and error recovery internally.
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
// Service state
// ============================================================================

let bot: Bot | null = null
let runnerHandle: { stop(): void } | null = null
let registeredChatId: number | null = null
let isConnected = false

const commandHandlers = new Map<string, TelegramCommandHandler>()
const messageHandlers: TelegramMessageHandler[] = []

// REPL integration state
const telegramMessageQueue: Array<{ chatId: number; text: string }> = []
let replMessageHandler: ((text: string) => Promise<void>) | null = null

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
// REPL Integration — bridge Telegram messages to DuckHive query pipeline
// ============================================================================

export function onTelegramReplMessage(handler: (text: string) => Promise<void>): () => void {
  replMessageHandler = handler
  // Drain queued messages
  while (telegramMessageQueue.length > 0) {
    const msg = telegramMessageQueue.shift()
    if (msg && replMessageHandler) {
      replMessageHandler(msg.text).catch(err =>
        logForDebugging(`[telegram] queued repl error: ${err}`),
      )
    }
  }
  return () => {
    replMessageHandler = null
  }
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

  // ── Command handler ─────────────────────────────────────────────────────────
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
    // Notify REPL that Telegram is live
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
      'You can also just send any message to have it processed by DuckHive.',
      { parse_mode: 'Markdown' },
    )
  })

  bot.command('status', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const currentChatId = registeredChatId ?? getStoredChatId()
    await ctx.reply(
      `*DuckHive Status*\n\n` +
      `Session: ${isConnected ? '🟢 Connected' : '🔴 Disconnected'}\n` +
      `Model: ${process.env.DUCKHIVE_MODEL_NAME ?? 'default'}\n` +
      `Provider: ${process.env.DUCKHIVE_PROVIDER ?? 'default'}\n\n` +
      `Send /help for commands.`,
      { parse_mode: 'Markdown' },
    )
  })

  // ── Custom commands registered by the app ────────────────────────────────
  bot.command('duckhive_status', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const handler = commandHandlers.get('status')
    if (handler) {
      try { handler(chatId, '') }
      catch (err) { await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`) }
    }
  })

  // ── Text messages → REPL queue ────────────────────────────────────────────
  bot.on('message:text', async (ctx: Context) => {
    const chatId = ctx.chat?.id
    const message = ctx.message
    if (!message) return
    const text = message.text
    if (!chatId || !text) return

    // Strip leading slash for non-command text (already handled above)
    if (text.startsWith('/')) {
      // Built-in commands handled above by bot.command(); custom commands
      // registered via registerCommand() are handled here.
      const parts = text.slice(1).split(' ')
      const cmd = parts[0].toLowerCase()
      const args = parts.slice(1).join(' ')

      // Skip if already handled by bot.command() above
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

    // Forward to registered message handlers
    for (const h of messageHandlers) {
      try { h(chatId, text) }
      catch (err) { logForDebugging(`[telegram] message handler error: ${err}`) }
    }

    // Feed into DuckHive REPL command queue
    queueTelegramMessageForRepl(chatId, text)
  })

  // ── Error handler ────────────────────────────────────────────────────────
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
// Service lifecycle
// ============================================================================

export async function startTelegramService(): Promise<void> {
  const token = getToken()
  if (!token) {
    logForDebugging('[telegram] no token found, skipping start')
    return
  }

  if (bot) {
    logForDebugging('[telegram] already running')
    return
  }

  try {
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
    logForDebugging('[telegram] service starting with grammY runner')

    // Start grammY's runner (non-blocking long-polling with automatic reconnection)
    // The runner handles sequential message processing, back-pressure, and reconnection.
    runnerHandle = run(bot)

    logForDebugging('[telegram] grammY runner started')
  } catch (err) {
    bot = null
    runnerHandle = null
    isConnected = false
    logForDebugging(
      `[telegram] failed to start: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export function stopTelegramService(): void {
  if (runnerHandle) {
    runnerHandle.stop()
    runnerHandle = null
  }
  bot = null
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
    logForDebugging(
      `[telegram] send error: ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

// ============================================================================
// Auto-start
// ============================================================================

const autoStartToken = getToken()
if (autoStartToken) {
  setTimeout(() => {
    startTelegramService().catch(() => {})
  }, 2000)
}
