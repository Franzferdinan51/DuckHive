/**
 * EmailAdapter.ts — IMAP/SMTP email channel adapter for DuckHive
 *
 * Reads inbound emails via IMAP (polling the inbox) and sends outbound
 * messages via SMTP. Normalizes emails to DuckHive's Message type.
 *
 * Peer dependency: `nodemailer` and `imap` must be installed separately.
 *   npm install nodemailer imap
 *
 * The adapter polls the IMAP inbox at a configurable interval. New messages
 * since the last poll are returned one at a time from receiveMessage().
 *
 * Inbound:  email → IMAP inbox → receiveMessage() → Message
 * Outbound: sendMessage() → SMTP → recipient email
 *
 * Supports plain-text and HTML email bodies (HTML is stripped to text).
 */

import type {
  ChannelAdapter,
  ChannelAdapterConfig,
} from './ChannelAdapter.js'
import { normalizeMessage } from './ChannelAdapter.js'
import type { Message } from '../utils/mailbox.js'

// ─── Config ─────────────────────────────────────────────────────────────────

export interface EmailAdapterConfig extends ChannelAdapterConfig {
  // ── IMAP (inbound) ────────────────────────────────────────────────────────
  /** IMAP host to connect to for reading email. */
  imapHost?: string
  /** IMAP port. Defaults to 993 (IMAPS). */
  imapPort?: number
  /** IMAP username (email address). */
  imapUser?: string
  /** IMAP password or app-specific password. */
  imapPassword?: string
  /**
   * IMAP TLS/SSL. Defaults to true (IMAPS on port 993).
   * Set false for port 143 with STARTTLS.
   */
  imapTls?: boolean
  /**
   * Polling interval in milliseconds. Defaults to 30_000 (30 seconds).
   * Set to 0 to disable automatic polling (manual only via pollInbox()).
   */
  pollIntervalMs?: number
  /**
   * IMAP mailbox to read from. Defaults to 'INBOX'.
   */
  mailbox?: string

  // ── SMTP (outbound) ────────────────────────────────────────────────────────
  /** SMTP host. Defaults to same as imapHost if not set. */
  smtpHost?: string
  /** SMTP port. Defaults to 465 (SMTPS) or 587 (submission). */
  smtpPort?: number
  /** SMTP username. Defaults to imapUser. */
  smtpUser?: string
  /** SMTP password. Defaults to imapPassword. */
  smtpPassword?: string
  /**
   * SMTP TLS/SSL. Defaults to true.
   * Set false for port 587 with STARTTLS.
   */
  smtpTls?: boolean
  /** Default sender email address. Defaults to imapUser. */
  fromAddress?: string
  /** Default recipient email address for sendMessage(). */
  defaultTo?: string

  // ── Labels ────────────────────────────────────────────────────────────────
  /**
   * Human-readable label used as Message.from on inbound messages.
   * Defaults to 'email'.
   */
  sourceLabel?: string
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export class EmailAdapter implements ChannelAdapter {
  // IMAP config
  private readonly imapHost: string
  private readonly imapPort: number
  private readonly imapUser: string
  private readonly imapPassword: string
  private readonly imapTls: boolean
  private readonly mailbox: string
  // SMTP config
  private readonly smtpHost: string
  private readonly smtpPort: number
  private readonly smtpUser: string
  private readonly smtpPassword: string
  private readonly smtpTls: boolean
  private readonly fromAddress: string
  private readonly defaultTo?: string
  // Labels
  private readonly sourceLabel: string
  private readonly contentPrefix?: string
  private readonly contentSuffix?: string

  /** In-memory queue of newly-read messages not yet returned by receiveMessage(). */
  private readonly inboundQueue: Message[] = []

  /** Most recent IMAP UID we've seen — used to avoid re-delivering messages. */
  private lastSeenUid = 0

  /** Interval timer handle. */
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /** Lazy-loaded IMAP connection. */
  private imap: ImapConnection | null = null

  /** True when the IMAP connection is open. */
  private _connected = false

  constructor(config: EmailAdapterConfig = {}) {
    // IMAP
    this.imapHost =
      config.imapHost ?? process.env.EMAIL_IMAP_HOST ?? ''
    this.imapPort = config.imapPort ?? 993
    this.imapUser =
      config.imapUser ?? process.env.EMAIL_IMAP_USER ?? ''
    this.imapPassword =
      config.imapPassword ?? process.env.EMAIL_IMAP_PASSWORD ?? ''
    this.imapTls = config.imapTls ?? true
    this.mailbox = config.mailbox ?? 'INBOX'

    // SMTP — fall back to IMAP settings
    this.smtpHost =
      config.smtpHost ?? process.env.EMAIL_SMTP_HOST ?? this.imapHost
    this.smtpPort = config.smtpPort ?? (config.smtpTls !== false ? 465 : 587)
    this.smtpUser = config.smtpUser ?? this.imapUser
    this.smtpPassword = config.smtpPassword ?? this.imapPassword
    this.smtpTls = config.smtpTls ?? true
    this.fromAddress =
      config.fromAddress ?? process.env.EMAIL_FROM ?? this.imapUser
    this.defaultTo = config.defaultTo ?? process.env.EMAIL_TO

    this.sourceLabel = config.sourceLabel ?? 'email'
    this.contentPrefix = config.contentPrefix
    this.contentSuffix = config.contentSuffix

    if (!this.imapHost || !this.imapUser) {
      throw new Error(
        '[EmailAdapter] IMAP host and user are required. ' +
          'Pass them in config or set EMAIL_IMAP_HOST and EMAIL_IMAP_USER env vars.',
      )
    }
  }

  getChannelName(): string {
    return `email:${this.imapUser}`
  }

  isConnected(): boolean {
    return this._connected
  }

  /**
   * Opens the IMAP connection and starts polling for new messages.
   * Idempotent.
   */
  async connect(): Promise<void> {
    if (this._connected) return
    await this.openImap()
  }

  /**
   * Send an email via SMTP.
   * @param text  Plain-text body of the email.
   * @param to    Recipient address. Defaults to defaultTo from config.
   * @param subject Optional subject line. Defaults to '(no subject)'.
   */
  async sendMessage(text: string, to?: string, subject = '(no subject)'): Promise<void> {
    const recipient = to ?? this.defaultTo
    if (!recipient) {
      throw new Error(
        '[EmailAdapter] sendMessage requires a recipient. ' +
          'Pass `to` as the second argument or set defaultTo / EMAIL_TO in config.',
      )
    }

    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpTls,
      auth:
        this.smtpUser
          ? { user: this.smtpUser, pass: this.smtpPassword }
          : undefined,
    })

    await transporter.sendMail({
      from: this.fromAddress,
      to: recipient,
      subject,
      text,
    })
  }

  /**
   * Returns the next queued inbound email as a Message, or null if the inbox is empty.
   */
  async receiveMessage(): Promise<Message | null> {
    // Top up the queue with any new messages on the IMAP server.
    await this.pollInbox()

    // Serve from the queue.
    return this.inboundQueue.shift() ?? null
  }

  /**
   * Immediately poll IMAP for new messages without waiting for the next interval.
   * Useful when you want to force a poll (e.g., on a timer or external signal).
   */
  async pollInbox(): Promise<void> {
    if (!this.imap || !this._connected) {
      // Silently skip if not connected yet.
      return
    }

    try {
      const newMessages = await this.fetchNewMessages(this.imap)
      for (const msg of newMessages) {
        this.inboundQueue.push(msg)
      }
    } catch (err) {
      // Log and recover — try to reconnect on next poll.
      console.error('[EmailAdapter] IMAP poll error:', err)
      await this.closeImap()
      // Attempt reconnection for next poll.
      await this.openImap().catch(() => {})
    }
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    await this.closeImap()
    this._connected = false
  }

  // ─── IMAP helpers ─────────────────────────────────────────────────────────

  private async openImap(): Promise<void> {
    const Imap = (await import('imap')).default
    this.imap = new Imap({
      user: this.imapUser,
      password: this.imapPassword,
      host: this.imapHost,
      port: this.imapPort,
      tls: this.imapTls,
      // Auto-reconnect on close.
      autoreconnect: true,
      // Connection timeout.
      connTimeout: 15_000,
    })

    return new Promise((resolve, reject) => {
      this.imap!.on('ready', () => {
        this.imap!.openBox(this.mailbox, true, openErr => {
          if (openErr) {
            reject(new Error(`[EmailAdapter] Failed to open mailbox "${this.mailbox}": ${openErr.message}`))
            return
          }
          this._connected = true
          resolve()
        })
      })

      this.imap!.on('error', (err: Error) => {
        console.error('[EmailAdapter] IMAP error:', err.message)
        this._connected = false
      })

      this.imap!.on('close', () => {
        this._connected = false
      })

      this.imap!.connect()
    })
  }

  private async closeImap(): Promise<void> {
    if (!this.imap) return
    const imap = this.imap
    this.imap = null
    return new Promise(resolve => {
      try {
        imap.end()
        imap.once('end', resolve)
      } catch {
        resolve()
      }
    })
  }

  private async fetchNewMessages(imap: ImapConnection): Promise<Message[]> {
    // Fetch messages with UID > lastSeenUid that are recent (seen in last 7 days).
    const sinceUid = this.lastSeenUid + 1
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const searchCriteria = [
      ['UID', `${sinceUid}:*`],
      ['SINCE', sevenDaysAgo],
    ]

    return new Promise((resolve, reject) => {
      imap.search(searchCriteria, (searchErr, results) => {
        if (searchErr) {
          reject(searchErr)
          return
        }

        if (!results || results.length === 0) {
          resolve([])
          return
        }

        // Fetch envelope + body structure (no body text yet — we do that per message).
        const fetch = imap.fetch(results, {
          bodies: 'HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)',
          struct: true,
        })

        const messages: Message[] = []

        fetch.on('message', (msg: ImapMessage) => {
          let envelope: Record<string, string[]> = {}
          let uid = 0

          msg.on('body', (stream: NodeJS.ReadableStream, info) => {
            // Parse headers.
            const parser = new HeaderParser()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ;(stream as any).pipe(parser)
            parser.on('headers', (headers: Record<string, string[]>) => {
              envelope = headers
            })
          })

          msg.once('attributes', (attrs: { uid: number }) => {
            uid = attrs.uid ?? 0
          })

          msg.once('end', async () => {
            // Now fetch the actual body text.
            const bodyText = await this.fetchMessageBody(imap, uid)
            if (!bodyText) return

            const from = (envelope.from ?? [])[0] ?? this.sourceLabel
            const subject = (envelope.subject ?? [])[0] ?? '(no subject)'

            const content = [
              this.contentPrefix ?? '',
              `From: ${from}\nSubject: ${subject}\n\n${bodyText}`,
              this.contentSuffix ?? '',
            ].join('')

            messages.push(
              normalizeMessage(content, 'user', {
                from: this.sourceLabel,
                color: '#ea4335', // Gmail red
              }),
            )

            if (uid > this.lastSeenUid) {
              this.lastSeenUid = uid
            }
          })
        })

        fetch.once('error', (err: Error) => {
          reject(err)
        })

        fetch.once('end', () => {
          resolve(messages)
        })
      })
    })
  }

  private fetchMessageBody(imap: ImapConnection, uid: number): Promise<string> {
    return new Promise(resolve => {
      // Fetch plain text if available, else HTML.
      const f = imap.fetch([uid], {
        bodies: ['TEXT', '1'],
        struct: true,
      })

      let body = ''

      f.on('message', (msg: ImapMessage) => {
        msg.on('body', (stream: NodeJS.ReadableStream, info) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const chunks: Buffer[] = []
          ;(stream as any).on('data', (chunk: Buffer) => chunks.push(chunk))
          ;(stream as any).on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8')
            // HeaderParser gives us just the body part content.
            body += raw
          })
        })
      })

      f.once('error', () => {
        resolve('')
      })

      f.once('end', () => {
        // Strip HTML tags if this looks like HTML.
        const text = stripHtml(body).trim()
        resolve(text)
      })
    })
  }
}

// ─── Header parser (minimal, no external dependency) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class HeaderParser extends (require('stream').Readable as any) {
  private buffer = ''
  private headers: Record<string, string[]> = {}
  private currentKey = ''
  private inHeaders = true

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor() {
    super()
    // Empty
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _read(size?: number): void {
    // No-op — data is pushed via .write
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: Buffer | string, _enc?: string, _cb?: () => void): void {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.parseHeaders()
  }

  private parseHeaders(): void {
    if (!this.inHeaders) return
    const lines = this.buffer.split(/\r?\n/)
    for (const line of lines) {
      // Blank line marks end of headers.
      if (line === '') {
        this.inHeaders = false
        this.emit('headers', this.headers)
        return
      }
      // Continuation line.
      if (/^[ \t]/.test(line)) {
        const vals = this.headers[this.currentKey]
        if (vals) {
          vals[vals.length - 1] += ' ' + line.trim()
        }
        continue
      }
      // New header: "Key: Value"
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      this.currentKey = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (!this.headers[this.currentKey]) {
        this.headers[this.currentKey] = []
      }
      this.headers[this.currentKey].push(value)
    }
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common HTML entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCharCode(parseInt(code, 10)),
    )
    .replace(/\n{3,}/g, '\n\n')
}

// ─── Type shims for the imap package (avoid importing the full .d.ts chain) ─

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImapConnection = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImapMessage = any
type NodeJSReadableStream = NodeJS.ReadableStream
