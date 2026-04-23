/**
 * ACP (Agent Client Protocol) server implementation
 *
 * ACP is a protocol for connecting AI agents to IDEs and external clients.
 * It provides a standardized way for editors to communicate with agents
 * like DuckHive, enabling features like:
 * - Real-time code completion and editing
 * - Terminal command execution
 * - File system operations
 * - Context awareness
 *
 * Reference: https://github.com/agentclientprotocol
 */
import { createServer, Socket } from 'net'
import { randomUUID } from 'crypto'

// ACP message types
export type ACPPayloadType =
  | 'initialize'
  | 'initialize_result'
  | 'chat/message'
  | 'chat/message_result'
  | 'tools/list'
  | 'tools/list_result'
  | 'tools/call'
  | 'tools/call_result'
  | 'tools/call_batch'
  | 'tools/call_batch_result'
  | 'ping'
  | 'pong'
  | 'close'

export interface ACPMessage {
  type: ACPPayloadType
  id?: string
  [key: string]: unknown
}

export interface ACPClient {
  id: string
  name: string
  version: string
  socket: Socket
  sessionId?: string
  capabilities?: string[]
}

interface InitializeMessage {
  type: 'initialize'
  id: string
  client_name: string
  client_version: string
  capabilities?: string[]
  session_id?: string
}

interface ChatMessage {
  type: 'chat/message'
  id: string
  content: string
  context?: Record<string, unknown>
}

interface ToolsListMessage {
  type: 'tools/list'
  id: string
}

interface ToolsCallMessage {
  type: 'tools/call'
  id: string
  tool: string
  input: Record<string, unknown>
}

interface ToolsCallBatchMessage {
  type: 'tools/call_batch'
  id: string
  calls: Array<{ tool: string; input: Record<string, unknown> }>
}

// Session state for connected clients
const sessions = new Map<string, {
  client: ACPClient
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; timestamp: Date }>
}>()

// Tool definitions available via ACP
const TOOLS = [
  {
    name: 'shell',
    description: 'Execute a shell command in the terminal',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        offset: { type: 'number', description: 'Line offset to start reading from' },
        limit: { type: 'number', description: 'Maximum number of lines to read' }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', description: 'Append to existing file instead of overwriting' }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'list_directory',
    description: 'List contents of a directory',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
        recursive: { type: 'boolean', description: 'Recursively list subdirectories' }
      },
      required: ['path']
    }
  },
  {
    name: 'search',
    description: 'Search for files or content',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        path: { type: 'string', description: 'Directory to search in' },
        mode: { type: 'string', enum: ['files', 'content', 'both'], description: 'Search mode' }
      },
      required: ['query']
    }
  }
]

function send(socket: Socket, msg: ACPMessage): void {
  if (socket.destroyed) return
  socket.write(JSON.stringify(msg) + '\n')
}

function formatError(id: string, error: string): ACPMessage {
  return {
    type: 'error' as ACPPayloadType,
    id,
    error
  }
}

async function handleMessage(client: ACPClient, raw: string): Promise<void> {
  let msg: ACPMessage
  try {
    msg = JSON.parse(raw) as ACPMessage
  } catch {
    send(client.socket, formatError('', 'Invalid JSON'))
    return
  }

  switch (msg.type) {
    case 'initialize': {
      const init = msg as InitializeMessage
      client.name = init.client_name
      client.version = init.client_version
      client.capabilities = init.capabilities || []
      client.sessionId = init.session_id || randomUUID()

      // Create session
      sessions.set(client.sessionId, {
        client,
        messages: []
      })

      send(client.socket, {
        type: 'initialize_result',
        id: init.id,
        session_id: client.sessionId,
        server_name: 'DuckHive',
        server_version: '1.0.0',
        capabilities: ['chat', 'tools', 'batch_tools'],
        tools: TOOLS
      })
      break
    }

    case 'chat/message': {
      const chat = msg as ChatMessage
      const session = sessions.get(client.sessionId!)
      if (!session) {
        send(client.socket, formatError(chat.id, 'No active session'))
        return
      }

      // Add user message to history
      session.messages.push({
        role: 'user',
        content: chat.content,
        timestamp: new Date()
      })

      // Build prompt with context
      const context = chat.context || {}
      const contextStr = Object.entries(context)
        .map(([k, v]) => `[${k}] ${v}`)
        .join('\n')

      const prompt = contextStr
        ? `Context:\n${contextStr}\n\nUser: ${chat.content}`
        : chat.content

      // For now, echo back a placeholder response
      // In a full implementation, this would forward to DuckHive's agent
      send(client.socket, {
        type: 'chat/message_result',
        id: chat.id,
        message: {
          role: 'assistant',
          content: `[DuckHive ACP] Received: "${chat.content}". This is an ACP endpoint - connect me to DuckHive's agent for actual processing.`,
          session_id: client.sessionId
        }
      })

      session.messages.push({
        role: 'assistant',
        content: `[DuckHive ACP] Received: "${chat.content}"`,
        timestamp: new Date()
      })
      break
    }

    case 'tools/list': {
      send(client.socket, {
        type: 'tools/list_result',
        id: msg.id,
        tools: TOOLS
      })
      break
    }

    case 'tools/call': {
      const call = msg as ToolsCallMessage
      // Placeholder tool responses - real implementation would execute tools
      send(client.socket, {
        type: 'tools/call_result',
        id: call.id,
        tool: call.tool,
        result: {
          success: true,
          message: `Tool '${call.tool}' called successfully. Connect to DuckHive agent for actual execution.`,
          input: call.input
        }
      })
      break
    }

    case 'tools/call_batch': {
      const batch = msg as ToolsCallBatchMessage
      const results = batch.calls.map(call => ({
        tool: call.tool,
        result: {
          success: true,
          message: `Tool '${call.tool}' called. Connect to DuckHive agent for actual execution.`,
          input: call.input
        }
      }))

      send(client.socket, {
        type: 'tools/call_batch_result',
        id: batch.id,
        results
      })
      break
    }

    case 'ping': {
      send(client.socket, { type: 'pong', id: msg.id })
      break
    }

    default:
      send(client.socket, formatError(msg.id || '', `Unknown message type: ${msg.type}`))
  }
}

function handleConnection(socket: Socket): void {
  const client: ACPClient = {
    id: randomUUID(),
    name: 'unknown',
    version: 'unknown',
    socket
  }

  let buffer = ''

  socket.on('data', async (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        await handleMessage(client, line)
      }
    }
  })

  socket.on('close', () => {
    if (client.sessionId) {
      sessions.delete(client.sessionId)
    }
  })

  socket.on('error', (err) => {
    console.error('[ACP] Socket error:', err.message)
  })
}

export interface ACPServerOptions {
  port?: number
  host?: string
  socketPath?: string
}

export function startACPServer(options: ACPServerOptions = {}): { close: () => void } {
  const { port = 8080, host = 'localhost', socketPath } = options

  const server = createServer(handleConnection)

  server.on('error', (err: Error) => {
    console.error('[ACP] Server error:', err.message)
  })

  if (socketPath) {
    // Unix socket mode
    server.listen(socketPath, () => {
      console.log(`[ACP] Server listening on Unix socket: ${socketPath}`)
    })
  } else {
    // TCP mode
    server.listen(port, host, () => {
      console.log(`[ACP] Server listening on ${host}:${port}`)
    })
  }

  return {
    close: () => {
      server.close(() => {
        console.log('[ACP] Server closed')
      })
    }
  }
}

// CLI entrypoint
export const call = async (args: string) => {
  const parsedArgs = args.trim().split(/\s+/).filter(Boolean)
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (const arg of parsedArgs) {
    if (arg.startsWith('--')) {
      const [k, v] = arg.slice(2).split('=')
      flags[k] = v ?? true
    } else {
      positional.push(arg)
    }
  }

  const port = typeof flags.port === 'string' ? parseInt(flags.port) : 8080
  const host = typeof flags.host === 'string' ? flags.host : 'localhost'
  const socketPath = typeof flags.socket === 'string' ? flags.socket : undefined

  const addr = socketPath
    ? `unix://${socketPath}`
    : `${host}:${port}`

  console.log(`[ACP] Starting DuckHive ACP server...`)
  console.log(`[ACP] Address: ${addr}`)
  console.log(`[ACP] This enables IDE integrations following the Agent Client Protocol`)

  const server = startACPServer({ port, host, socketPath })

  // Keep server running
  process.on('SIGINT', () => {
    server.close()
    process.exit(0)
  })

  return {
    type: 'text',
    value: `ACP Server Started

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DuckHive ACP server is running and ready for IDE connections.

Address: ${addr}

Available tools via ACP:
  - shell: Execute shell commands
  - read_file: Read file contents
  - write_file: Write file contents
  - list_directory: List directory contents
  - search: Search files and content

Press Ctrl+C to stop the server.`
  }
}
