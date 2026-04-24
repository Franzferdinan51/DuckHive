/**
 * Telegram Bot Service
 *
 * Provides bidirectional communication between DuckHive REPL and Telegram.
 * Uses long polling (no webhook required) to receive messages and can send
 * updates back to the user's Telegram chat.
 *
 * Enable with: DUCKHIVE_TELEGRAM_BOT_TOKEN env var or /connect command.
 * After connecting, messages from Telegram are forwarded to the REPL via
 * onTelegramMessage handlers, and the REPL can send responses via sendTelegramMessage.
 */

import { logForDebugging } from '../../utils/debug.js'
import { getSecureStorage } from '../../utils/secureStorage/index.js'

// ============================================================================
// Types
// ============================================================================

export interface TelegramMessage {
  update_id: number
  message?: {
    from: { id: number; is_bot: boolean; first_name: string; username?: string }
    chat: { id: number; type: string }
    text?: string
    date: number
  }
}

export interface TelegramUpdate {
  ok: boolean
  result: TelegramMessage[]
}

export type TelegramCommandHandler = (chatId: number, args: string) => void
export type TelegramMessageHandler = (chatId: number, text: string) => void

// ============================================================================
// Telegram Bot API Client
// ============================================================================

class TelegramBotAPI {
  private token: string
  private baseUrl = 'https://api.telegram.org/bot'

  constructor(token: string) {
    this.token = token
  }

  private async request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${this.token}/${method}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} ${response.statusText}`)
    }
    return response.json() as Promise<T>
  }

  async getMe(): Promise<{ ok: boolean; result: { id: number; is_bot: boolean; username: string } }> {
    return this.request('getMe')
  }

  async getUpdates(offset: number, timeout: number = 30): Promise<TelegramUpdate> {
    return this.request('getUpdates', { offset, timeout, allowed_updates: ['message'] })
  }

  async sendMessage(chatId: number, text: string, parseMode: 'Markdown' | 'HTML' | undefined = undefined): Promise<unknown> {
    return this.request('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    })
  }

  async sendMarkdown(chatId: number, text: string): Promise<unknown> {
    return this.sendMessage(chatId, text, 'Markdown')
  }

  async setCommands(commands: Array<{ command: string; description: string }>): Promise<unknown> {
    return this.request('setMyCommands', { commands })
  }
}

// ============================================================================
// Telegram Service
// ============================================================================

let api: TelegramBotAPI | null = null
let pollingInterval: ReturnType<typeof setInterval> | null = null
let offset = 0
let registeredChatId: number | null = null

const commandHandlers = new Map<string, TelegramCommandHandler>()
const messageHandlers: TelegramMessageHandler[] = []

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

function getToken(): string | null {
  // Check env first
  const envToken = process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN
  if (envToken) return envToken

  // Check secure storage
  try {
    const storage = getSecureStorage()
    const data = storage.read()
    return data?.pluginSecrets?.telegram?.botToken ?? null
  } catch {
    return null
  }
}

export async function startTelegramService(): Promise<void> {
  const token = getToken()
  if (!token) {
    logForDebugging('[telegram] no token found, skipping start')
    return
  }

  if (api) {
    logForDebugging('[telegram] already running')
    return
  }

  try {
    api = new TelegramBotAPI(token)
    const me = await api.getMe()
    logForDebugging(`[telegram] bot username: @${me.result.username}`)

    // Set bot commands
    await api.setCommands([
      { command: 'start', description: 'Register with DuckHive' },
      { command: 'status', description: 'Show current session status' },
      { command: 'help', description: 'Show available commands' },
    ])

    // Start polling
    startPolling()
    logForDebugging('[telegram] service started with long polling')
  } catch (err) {
    api = null
    logForDebugging(`[telegram] failed to start: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function startPolling(): void {
  if (pollingInterval) return

  pollingInterval = setInterval(async () => {
    if (!api) return

    try {
      const updates = await api.getUpdates(offset)
      if (!updates.ok || updates.result.length === 0) return

      for (const update of updates.result) {
        offset = update.update_id + 1

        if (update.message?.text) {
          const chatId = update.message.chat.id
          const text = update.message.text

          // Register chat ID on first message
          if (!registeredChatId) {
            registeredChatId = chatId
            // Save to storage
            try {
              const storage = getSecureStorage()
              const data = storage.read() ?? {}
              if (!data.pluginSecrets) data.pluginSecrets = {}
              data.pluginSecrets.telegram = { ...data.pluginSecrets?.telegram, chatId }
              storage.update(data)
            } catch { /* ignore storage errors */ }
            logForDebugging(`[telegram] registered chat ${chatId}`)
          }

          // Handle commands
          if (text.startsWith('/')) {
            const parts = text.slice(1).split(' ')
            const cmd = parts[0].toLowerCase()
            const args = parts.slice(1).join(' ')

            const handler = commandHandlers.get(cmd)
            if (handler) {
              try {
                handler(chatId, args)
              } catch (err) {
                logForDebugging(`[telegram] command error: ${err}`)
                api?.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`).catch(() => {})
              }
            } else {
              api?.sendMessage(chatId, `Unknown command: /${cmd}. Try /help`).catch(() => {})
            }
          } else {
            // Forward message to REPL handlers
            for (const h of messageHandlers) {
              try {
                h(chatId, text)
              } catch (err) {
                logForDebugging(`[telegram] message handler error: ${err}`)
              }
            }
          }
        }
      }
    } catch (err) {
      logForDebugging(`[telegram] polling error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, 1000)
}

export function stopTelegramService(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
  api = null
  offset = 0
  registeredChatId = null
  logForDebugging('[telegram] service stopped')
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const chatId = registeredChatId || (await getStoredChatId())
  if (!chatId || !api) {
    logForDebugging('[telegram] cannot send: no registered chat or no API')
    return
  }
  try {
    await api.sendMarkdown(chatId, text)
    logForDebugging(`[telegram] sent message to ${chatId}`)
  } catch (err) {
    logForDebugging(`[telegram] send error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function getStoredChatId(): Promise<number | null> {
  try {
    const storage = getSecureStorage()
    const data = storage.read()
    return data?.pluginSecrets?.telegram?.chatId ?? null
  } catch {
    return null
  }
}

// ============================================================================
// REPL Integration - bridge Telegram messages to DuckHive query pipeline
// ============================================================================

// Queue of messages to be processed by the REPL
const telegramMessageQueue: Array<{ chatId: number; text: string }> = []
let replMessageHandler: ((text: string) => Promise<void>) | null = null

export function onTelegramReplMessage(handler: (text: string) => Promise<void>): () => void {
  replMessageHandler = handler
  // Process any queued messages
  while (telegramMessageQueue.length > 0) {
    const msg = telegramMessageQueue.shift()
    if (msg && handler) {
      handler(msg.text).catch(err => logForDebugging(`[telegram] repl message error: ${err}`))
    }
  }
  return () => {
    replMessageHandler = null
  }
}

export function queueTelegramMessageForRepl(chatId: number, text: string): void {
  if (replMessageHandler) {
    replMessageHandler(text).catch(err => logForDebugging(`[telegram] queued repl error: ${err}`))
  } else {
    telegramMessageQueue.push({ chatId, text })
    logForDebugging(`[telegram] queued message (${telegramMessageQueue.length} in queue)`)
  }
}

// Register built-in commands
registerCommand('start', (chatId) => {
  registeredChatId = chatId
  api?.sendMarkdown(chatId, '✅ *DuckHive connected!*\n\nSend me a message and I\'ll forward it to your DuckHive session.\n\nUse /help for commands.').catch(() => {})
})

registerCommand('help', (chatId) => {
  api?.sendMarkdown(chatId, `*DuckHive Telegram Commands*

• /start — Register with DuckHive
• /status — Current session status
• /help — Show this help

You can also just send any message to have it processed by DuckHive.`).catch(() => {})
})

registerCommand('status', async (chatId) => {
  api?.sendMarkdown(chatId, `*DuckHive Status*

Session: Active
Model: ${process.env.DUCKHIVE_MODEL_NAME ?? 'default'}
Provider: ${process.env.DUCKHIVE_PROVIDER ?? 'default'}

Send /help for commands.`).catch(() => {})
})

// Auto-start if token is available
const token = getToken()
if (token) {
  // Defer start to next tick so the app is ready
  setTimeout(() => { startTelegramService().catch(() => {}) }, 2000)
}