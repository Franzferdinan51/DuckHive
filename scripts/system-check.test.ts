import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  checkCliLauncherPath,
  checkCliInputMode,
  checkAgentRunCliControls,
  checkConnectorCliControls,
  checkHarnessCommandSurfaces,
  checkHarnessStateReadiness,
  checkCouncilRuntimeReadiness,
  checkBaseUrlReachability,
  checkTuiInputSmoke,
  checkTopLevelCliHelpSurface,
  checkOpenAIEnv,
  checkSkillHubRegistry,
  checkTelegramChannelConfig,
  checkTerminalStdio,
  formatReachabilityFailureDetail,
} from './system-check.ts'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  DUCKHIVE_PROVIDER: process.env.DUCKHIVE_PROVIDER,
  DUCKHIVE_DEFAULT_PROVIDER: process.env.DUCKHIVE_DEFAULT_PROVIDER,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENGATEWAY_API_KEY: process.env.OPENGATEWAY_API_KEY,
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MMX_API_KEY: process.env.MMX_API_KEY,
  DUCKHIVE_CLAWHUB_REGISTRY: process.env.DUCKHIVE_CLAWHUB_REGISTRY,
  CLAWHUB_REGISTRY: process.env.CLAWHUB_REGISTRY,
  DUCKHIVE_TELEGRAM_BOT_TOKEN: process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID:
    process.env.DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID,
}

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name]
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.DUCKHIVE_PROVIDER
  delete process.env.DUCKHIVE_DEFAULT_PROVIDER
  delete process.env.OPENAI_MODEL
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENGATEWAY_API_KEY
  delete process.env.MINIMAX_API_KEY
  delete process.env.MMX_API_KEY
  delete process.env.XAI_API_KEY
  delete process.env.VENICE_API_KEY
  delete process.env.MIMO_API_KEY
  delete process.env.DUCKHIVE_CLAWHUB_REGISTRY
  delete process.env.CLAWHUB_REGISTRY
  delete process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID
  // Set MMX_HOME to a temp directory to prevent file-based MiniMax credential detection
  process.env.MMX_HOME = mkdtempSync(join(tmpdir(), 'duckhive-test-mmx-'))
}

afterEach(() => {
  for (const name of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(name)
  }
})

describe('formatReachabilityFailureDetail', () => {
  test('returns generic failure detail for non-codex transport', () => {
    const detail = formatReachabilityFailureDetail(
      'https://api.openai.com/v1/models',
      429,
      '{"error":"rate_limit"}',
      {
        transport: 'chat_completions',
        requestedModel: 'gpt-4o',
        resolvedModel: 'gpt-4o',
      },
    )

    expect(detail).toBe(
      'Unexpected status 429 from https://api.openai.com/v1/models. Body: {"error":"rate_limit"}',
    )
  })

  test('redacts credentials and sensitive query parameters in endpoint details', () => {
    const detail = formatReachabilityFailureDetail(
      'http://user:pass@localhost:11434/v1/models?token=abc123&mode=test',
      502,
      'bad gateway',
      {
        transport: 'chat_completions',
        requestedModel: 'llama3.1:8b',
        resolvedModel: 'llama3.1:8b',
      },
    )

    expect(detail).toBe(
      'Unexpected status 502 from http://redacted:redacted@localhost:11434/v1/models?token=redacted&mode=test. Body: bad gateway',
    )
  })

  test('adds alias/entitlement hint for codex model support 400s', () => {
    const detail = formatReachabilityFailureDetail(
      'https://chatgpt.com/backend-api/codex/responses',
      400,
      '{"detail":"The \\"gpt-5.3-codex-spark\\" model is not supported when using Codex with a ChatGPT account."}',
      {
        transport: 'codex_responses',
        requestedModel: 'codexspark',
        resolvedModel: 'gpt-5.3-codex-spark',
      },
    )

    expect(detail).toContain(
      'model alias "codexspark" resolved to "gpt-5.3-codex-spark"',
    )
    expect(detail).toContain(
      'Try "codexplan" or another entitled Codex model.',
    )
  })
})

describe('checkCliInputMode', () => {
  test('passes on Windows when data-event stdin remains the default', () => {
    const result = checkCliInputMode({}, { platform: 'win32' })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Windows data-event stdin')
    expect(result.detail).toContain('duckhive --stdin-mode readable')
    expect(result.detail).toContain('classic REPL')
    expect(result.detail).toContain('inherited TUI handoff flags')
    expect(result.detail).toContain('cannot unmount the prompt before the first submission')
  })

  test('reports explicit data stdin mode as supported', () => {
    const result = checkCliInputMode(
      { DUCKHIVE_STDIN_MODE: 'data' },
      { platform: 'win32' },
    )

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Windows data-event stdin')
    expect(result.detail).toContain('--stdin-mode readable')
  })

  test('reports explicit readable stdin mode as compatibility mode', () => {
    const result = checkCliInputMode(
      { DUCKHIVE_STDIN_MODE: 'readable' },
      { platform: 'win32' },
    )

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('DuckHive readable compatibility stdin')
    expect(result.detail).toContain('Windows data-event default')
  })

  test('fails on Windows when data stdin is forced', () => {
    const result = checkCliInputMode(
      { DUCKHIVE_USE_DATA_STDIN: '1' },
      { platform: 'win32' },
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('DUCKHIVE_USE_DATA_STDIN')
  })

  test('passes on non-Windows without Windows-specific warnings', () => {
    const result = checkCliInputMode(
      { DUCKHIVE_USE_DATA_STDIN: '1' },
      { platform: 'linux' },
    )

    expect(result.ok).toBe(true)
    expect(result.detail).toBe('Readable stdin default active.')
  })
})

describe('checkTerminalStdio', () => {
  test('reports when stdin/stdout are attached to a terminal', () => {
    const result = checkTerminalStdio({
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('stdin=TTY')
    expect(result.detail).toContain('Interactive REPL input/output can attach')
  })

  test('reports redirected stdio without failing the runtime doctor', () => {
    const result = checkTerminalStdio({
      stdinIsTTY: false,
      stdoutIsTTY: false,
      stderrIsTTY: true,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('stdin=not TTY')
    expect(result.detail).toContain('interactive REPL needs stdin and stdout')
  })

  test('fails redirected stdio when strict interactive mode is requested', () => {
    const result = checkTerminalStdio(
      {
        stdinIsTTY: false,
        stdoutIsTTY: false,
        stderrIsTTY: true,
      },
      { strictInteractive: true },
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Strict interactive check failed')
    expect(result.detail).toContain('stdin and stdout attached')
  })
})

describe('checkTuiInputSmoke', () => {
  test('verifies packaged TUI input smoke through the CLI launcher', () => {
    const result = checkTuiInputSmoke({
      cliPath: 'dist/cli.mjs',
      smokeText: 'typed by test',
      submitText: 'submitted by test',
      runCommand: (_command, args) =>
        args.includes('--submit-smoke')
          ? {
              status: 0,
              stdout: `DuckHive TUI submit smoke passed: "${args.at(-1)}"`,
            }
          : {
              status: 0,
              stdout: `DuckHive TUI input smoke passed: "${args.at(-1)}"`,
            },
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Bubble Tea input loop')
    expect(result.detail).toContain('submit path')
  })

  test('fails when packaged TUI input smoke does not echo typed text', () => {
    const result = checkTuiInputSmoke({
      cliPath: 'dist/cli.mjs',
      smokeText: 'typed by test',
      runCommand: () => ({
        status: 0,
        stdout: 'DuckHive TUI input smoke passed: "other text"',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Packaged TUI input smoke failed')
  })

  test('fails when packaged TUI submit smoke does not echo submitted text', () => {
    const result = checkTuiInputSmoke({
      cliPath: 'dist/cli.mjs',
      smokeText: 'typed by test',
      submitText: 'submitted by test',
      runCommand: (_command, args) =>
        args.includes('--submit-smoke')
          ? {
              status: 0,
              stdout: 'DuckHive TUI submit smoke passed: "other text"',
            }
          : {
              status: 0,
              stdout: `DuckHive TUI input smoke passed: "${args.at(-1)}"`,
            },
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Packaged TUI submit smoke failed')
  })
})

describe('checkCliLauncherPath', () => {
  test('reports a duckhive command resolved on PATH', () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'duckhive-shim-'))
    const packageDir = join(shimDir, 'node_modules', 'duckhive')
    mkdirSync(packageDir, { recursive: true })
    const launcherPath = join(shimDir, 'duckhive.cmd')

    const result = checkCliLauncherPath({
      platform: 'win32',
      cwd: packageDir,
      expectedVersion: '0.12.0',
      resolveRealPath: path => path,
      runCommand: (command, args) =>
        command === 'cmd.exe' && args.join(' ').includes('duckhive --version')
          ? {
              status: 0,
              stdout: '0.12.0 (DuckHive)\r\n',
            }
          : {
              status: 0,
              stdout: `${launcherPath}\r\n`,
            },
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('duckhive resolves on PATH')
    expect(result.detail).toContain('duckhive.cmd')
    expect(result.detail).toContain('0.12.0 (DuckHive)')
    expect(result.detail).toContain(`Target: ${packageDir}`)
  })

  test('fails when the PATH launcher targets a different checkout', () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'duckhive-shim-'))
    const packageDir = join(shimDir, 'node_modules', 'duckhive')
    const checkoutDir = join(shimDir, 'checkout')
    mkdirSync(packageDir, { recursive: true })
    mkdirSync(checkoutDir, { recursive: true })
    const launcherPath = join(shimDir, 'duckhive.cmd')

    const result = checkCliLauncherPath({
      platform: 'win32',
      cwd: checkoutDir,
      expectedVersion: '0.12.0',
      resolveRealPath: path => path,
      runCommand: (command, args) =>
        command === 'cmd.exe' && args.join(' ').includes('duckhive --version')
          ? {
              status: 0,
              stdout: '0.12.0 (DuckHive)\r\n',
            }
          : {
              status: 0,
              stdout: `${launcherPath}\r\n`,
            },
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('package target')
    expect(result.detail).toContain(packageDir)
    expect(result.detail).toContain(checkoutDir)
  })

  test('fails when the PATH launcher resolves to a stale DuckHive version', () => {
    const result = checkCliLauncherPath({
      platform: 'win32',
      cwd: process.cwd(),
      expectedVersion: '0.12.0',
      runCommand: (command, args) =>
        command === 'cmd.exe' && args.join(' ').includes('duckhive --version')
          ? {
              status: 0,
              stdout: '0.8.0 (OpenClaude)\r\n',
            }
          : {
              status: 0,
              stdout:
                'C:\\Users\\franz\\AppData\\Roaming\\npm\\duckhive.cmd\r\n',
            },
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('duckhive resolves on PATH')
    expect(result.detail).toContain('instead of 0.12.0')
    expect(result.detail).toContain('Reinstall or relink')
  })

  test('reports the Windows install fix when duckhive is not on PATH', () => {
    const result = checkCliLauncherPath({
      platform: 'win32',
      cwd: process.cwd(),
      runCommand: () => ({
        status: 1,
        stdout: '',
        stderr: 'INFO: Could not find files',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('duckhive is not on PATH')
    expect(result.detail).toContain('.\\install.ps1')
    expect(result.detail).toContain('.\\bin\\duckhive.cmd')
  })
})

describe('checkOpenAIEnv', () => {
  test('reports DuckHive MiniMax provider preference instead of Anthropic mode', () => {
    clearProviderEnv()
    process.env.DUCKHIVE_PROVIDER = 'minimax'
    process.env.MINIMAX_API_KEY = 'minimax-test-key'

    const results = checkOpenAIEnv()

    expect(results[0]).toEqual({
      ok: true,
      label: 'Provider mode',
      detail: 'MiniMax provider enabled.',
    })
    expect(results.some(result => result.label.includes('MINIMAX_API_KEY'))).toBe(true)
  })

  test('reports DuckHive MiniMax default when no provider env is active', () => {
    clearProviderEnv()

    expect(checkOpenAIEnv()[0]).toEqual({
      ok: true,
      label: 'Provider mode',
      detail: 'MiniMax provider enabled by DuckHive default.',
    })
    expect(checkOpenAIEnv().some(result => result.label.includes('MINIMAX_API_KEY'))).toBe(true)
  })

  test('keeps Anthropic mode when explicitly selected', () => {
    clearProviderEnv()
    process.env.DUCKHIVE_PROVIDER = 'anthropic'

    expect(checkOpenAIEnv()[0]).toEqual({
      ok: true,
      label: 'Provider mode',
      detail: 'Anthropic login flow enabled by explicit DuckHive provider selection.',
    })
  })

  test('uses route-specific Opengateway credentials when OpenAI mode is enabled', () => {
    clearProviderEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
    process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
    process.env.OPENGATEWAY_API_KEY = 'opengateway-test-key'

    const results = checkOpenAIEnv()
    const credentialCheck = results.find(result => result.label.includes('OPENGATEWAY_API_KEY'))

    expect(credentialCheck).toEqual({
      ok: true,
      label: 'OPENGATEWAY_API_KEY or OPENAI_API_KEY',
      detail: 'Configured.',
    })
  })
})

describe('checkBaseUrlReachability', () => {
  test('probes Gitlawb Opengateway with chat completions instead of /models', async () => {
    clearProviderEnv()
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    process.env.OPENAI_BASE_URL = 'https://opengateway.gitlawb.com/v1'
    process.env.OPENAI_MODEL = 'mimo-v2.5-pro'
    process.env.OPENGATEWAY_API_KEY = 'opengateway-test-key'

    const originalFetch = globalThis.fetch
    const requests: Array<{
      url: string
      headers: Record<string, string>
      body: Record<string, unknown> | null
    }> = []

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>)
      )
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as Record<string, unknown>
        : null

      requests.push({ url, headers, body })

      if (url.endsWith('/models')) {
        return new Response('not found', { status: 404 })
      }

      return new Response(
        JSON.stringify({
          id: 'chatcmpl-opengateway-probe',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'ok',
              },
              finish_reason: 'stop',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      )
    }) as typeof globalThis.fetch

    try {
      const result = await checkBaseUrlReachability()

      expect(result.ok).toBe(true)
      expect(result.detail).toContain('Reached https://opengateway.gitlawb.com/v1/chat/completions')
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe('https://opengateway.gitlawb.com/v1/chat/completions')
      expect(requests[0]?.headers.Authorization).toBe('Bearer opengateway-test-key')
      expect(requests[0]?.body).toMatchObject({
        model: 'mimo-v2.5-pro',
        max_completion_tokens: 1,
        stream: true,
      })
      expect(requests[0]?.body?.messages).toEqual([
        {
          role: 'user',
          content: 'Runtime doctor probe.',
        },
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('checkHarnessCommandSurfaces', () => {
  test('verifies the terminal-first harness command set is registered', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-harness-commands-'))
    const commandFiles = [
      'src/commands/goal/index.ts',
      'src/commands/loop/index.ts',
      'src/commands/run/index.ts',
      'src/commands/computer-use/index.ts',
      'src/commands/mmx/index.ts',
      'src/commands/voice/index.ts',
      'src/commands/provider/index.ts',
      'src/commands/permissions/index.ts',
      'src/commands/checkpoint/index.ts',
      'src/commands/channel/index.ts',
      'src/commands/connect/index.ts',
      'src/commands/skill/index.ts',
      'src/commands/skills/index.ts',
      'src/commands/spawn/index.ts',
      'src/commands/hive-orchestrate/index.ts',
      'src/commands/hive-team/index.ts',
      'src/commands/hive-council/index.ts',
      'src/commands/hive-senate/index.ts',
      'src/commands/hive-decree/index.ts',
      'src/commands/hive-swarm/index.ts',
      'src/commands/tui/index.ts',
      'src/commands/doctor/index.ts',
      'src/commands/android/index.ts',
      'src/commands/vision/index.ts',
      'src/commands/shadow/index.ts',
      'src/commands/router/index.ts',
      'src/commands/budget/index.ts',
      'src/commands/cache/index.ts',
      'src/commands/export/index.ts',
    ]
    for (const relativePath of commandFiles) {
      const fullPath = join(root, relativePath)
      mkdirSync(dirname(fullPath), { recursive: true })
      writeFileSync(fullPath, '')
    }

    const result = checkHarnessCommandSurfaces({ cwd: root })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('goal')
    expect(result.detail).toContain('loop')
    expect(result.detail).toContain('run')
    expect(result.detail).toContain('computer-use')
    expect(result.detail).toContain('voice')
    expect(result.detail).toContain('permissions')
    expect(result.detail).toContain('checkpoint')
    expect(result.detail).toContain('channel')
    expect(result.detail).toContain('council')
    expect(result.detail).toContain('decree')
    expect(result.detail).toContain('swarm')
    expect(result.detail).toContain('tui')
    expect(result.detail).toContain('Required slash-only command files found')
    expect(result.detail).toContain('android')
    expect(result.detail).toContain('vision')
    expect(result.detail).toContain('shadow')
    expect(result.detail).toContain('router')
    expect(result.detail).toContain('budget')
    expect(result.detail).toContain('cache')
    expect(result.detail).toContain('Key aliases tracked')
    expect(result.detail).toContain('g')
    expect(result.detail).toContain('subagent')
    expect(result.detail).toContain('cu')
  })

  test('fails when required command implementation files are missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-harness-missing-'))

    const result = checkHarnessCommandSurfaces({ cwd: root })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Missing core command files')
    expect(result.detail).toContain('goal')
    expect(result.detail).toContain('src/commands/goal/index.ts')
    expect(result.detail).toContain('Missing slash-only command files')
    expect(result.detail).toContain('android')
  })
})

describe('checkHarnessStateReadiness', () => {
  test('reports shared checkpoint, budget, MCP, ACP, and permission readiness', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-harness-state-'))
    const configDir = join(root, '.duckhive')
    mkdirSync(join(configDir, 'checkpoints'), { recursive: true })
    writeFileSync(join(configDir, 'checkpoints', 'release-ready.json'), '{}')
    writeFileSync(join(configDir, 'budget-state.json'), '{}')
    writeFileSync(join(configDir, 'budget-log.jsonl'), '{}\n')

    mkdirSync(join(root, 'src', 'services', 'mcp'), { recursive: true })
    mkdirSync(join(root, 'src', 'commands', 'acp'), { recursive: true })
    mkdirSync(join(root, 'src', 'utils', 'permissions'), { recursive: true })
    writeFileSync(join(root, 'src', 'commands', 'acp', 'acp-impl.ts'), '')
    writeFileSync(
      join(root, 'src', 'utils', 'permissions', 'permissions.ts'),
      '',
    )

    const result = checkHarnessStateReadiness({
      cwd: root,
      configDir,
      homeDir: root,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('checkpoints=1')
    expect(result.detail).toContain('budget=state+log')
    expect(result.detail).toContain('MCP=detected')
    expect(result.detail).toContain('ACP=detected')
    expect(result.detail).toContain('permissions=detected')
    expect(result.detail).toContain('/checkpoint')
    expect(result.detail).toContain('/permissions')
  })

  test('falls back to legacy checkpoint count without failing empty state', () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-harness-state-'))
    const legacyDir = join(root, '.config', 'openclaude', 'checkpoints')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'legacy.json'), '{}')

    const result = checkHarnessStateReadiness({
      cwd: root,
      homeDir: root,
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('checkpoints=1')
    expect(result.detail).toContain('budget=not initialized')
    expect(result.detail).toContain('MCP=not detected')
    expect(result.detail).toContain('ACP=not detected')
    expect(result.detail).toContain('permissions=not detected')
  })
})

describe('checkCouncilRuntimeReadiness', () => {
  test('reports a live Hive Nation council runtime', async () => {
    const result = await checkCouncilRuntimeReadiness({
      councilUrl: 'http://localhost:3007',
      fetchJson: async url =>
        url.endsWith('/api/councilors')
          ? [{ id: 'speaker' }, { id: 'skeptic' }]
          : {
              status: 'ok',
              version: '3.1.0',
              services: { council: true, hiveCore: true },
            },
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('Live at http://localhost:3007')
    expect(result.detail).toContain('councilors=2')
    expect(result.detail).toContain('council=ready')
    expect(result.detail).toContain('hiveCore=ready')
  })

  test('fails when live council runtime has no councilor catalog', async () => {
    const result = await checkCouncilRuntimeReadiness({
      councilUrl: 'http://localhost:3007',
      fetchJson: async url =>
        url.endsWith('/api/councilors')
          ? []
          : {
              status: 'ok',
              version: '3.1.0',
              services: { council: true, hiveCore: true },
            },
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('/api/councilors')
    expect(result.detail).toContain('usable councilor catalog')
  })

  test('reports source-checkout start command when council runtime is offline', async () => {
    const result = await checkCouncilRuntimeReadiness({
      councilUrl: 'http://localhost:3999',
      fetchJson: async () => {
        throw new Error('connection refused')
      },
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('not currently reachable')
    expect(result.detail).toContain('bun run council:serve')
    expect(result.detail).toContain('DUCKHIVE_COUNCIL_URL')
  })

  test('fails when local council runtime source is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'duckhive-council-missing-'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }))

    const result = await checkCouncilRuntimeReadiness({ cwd: root })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Missing local Council runtime pieces')
    expect(result.detail).toContain('council-api-server.cjs')
    expect(result.detail).toContain('council:serve')
  })
})

describe('checkTopLevelCliHelpSurface', () => {
  test('verifies duckhive --help advertises terminal harness commands', () => {
    const result = checkTopLevelCliHelpSurface({
      cliPath: 'dist/cli.mjs',
      runCommand: () => ({
        status: 0,
        stdout: [
          'goal|g',
          'run|runs',
          'computer-use|cu',
          'mmx|minimax',
          'voice',
          'provider',
          'permissions|allowed-tools',
          'checkpoint|checkpoints',
          'channel',
          'connect|telegram',
          'config|settings',
          'skill|skills',
          'spawn|subagent',
          'ps',
          'logs',
          'attach',
          'pause',
          'resume',
          'approve',
          'recover',
          'kill',
          'orchestrate',
          'team',
          'council',
          'senate',
          'decree',
          'swarm',
        ].join('\n'),
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('duckhive --help')
    expect(result.detail).toContain('orchestrate')
  })

  test('fails when top-level help omits a terminal harness command', () => {
    const result = checkTopLevelCliHelpSurface({
      cliPath: 'dist/cli.mjs',
      runCommand: () => ({
        status: 0,
        stdout: 'goal|g\nrun|runs\n',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('computer-use|cu')
    expect(result.detail).toContain('swarm')
  })
})

describe('checkInputTestCliControl', () => {
  test('verifies the provider-free input test command is reachable', async () => {
    const { checkInputTestCliControl } = await import('./system-check.js')
    const result = checkInputTestCliControl({
      cliPath: 'dist/cli.mjs',
      runCommand: () => ({
        status: 0,
        stdout:
          'DuckHive input-test\nExercises DuckHive keyboard path without starting providers\n',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('duckhive input-test')
  })

  test('fails when input-test help is not reachable', async () => {
    const { checkInputTestCliControl } = await import('./system-check.js')
    const result = checkInputTestCliControl({
      cliPath: 'dist/cli.mjs',
      runCommand: () => ({
        status: 1,
        stderr: 'provider startup failed',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('input-test --help')
  })
})

describe('checkAgentRunCliControls', () => {
  test('verifies top-level AgentRun commands avoid provider startup', () => {
    const result = checkAgentRunCliControls({
      cliPath: 'dist/cli.mjs',
      runCommand: () => ({
        status: 0,
        stdout: 'DuckHive background run controls\n',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('pause')
    expect(result.detail).toContain('recover')
    expect(result.detail).toContain('without provider startup')
  })

  test('fails if a top-level AgentRun command emits provider startup warnings', () => {
    const result = checkAgentRunCliControls({
      cliPath: 'dist/cli.mjs',
      runCommand: (_command, args) => ({
        status: args.includes('pause') ? 0 : 0,
        stdout: 'DuckHive background run controls\n',
        stderr: args.includes('pause')
          ? 'Warning: ignoring saved provider profile. broken\n'
          : '',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('pause')
    expect(result.detail).toContain('provider-blocked')
  })
})

describe('checkSkillHubRegistry', () => {
  test('reports the configured ClawHub registry and skill command availability', () => {
    clearProviderEnv()
    process.env.DUCKHIVE_CLAWHUB_REGISTRY = 'https://example.test/clawhub/'

    const result = checkSkillHubRegistry()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('https://example.test/clawhub')
    expect(result.detail).toContain('/skill search')
    expect(result.detail).toContain('install')
  })
})

describe('checkConnectorCliControls', () => {
  test('verifies provider-free connector status commands are reachable', () => {
    const seen: string[] = []
    const result = checkConnectorCliControls({
      cliPath: 'dist/cli.mjs',
      runCommand: (_command, args) => {
        seen.push(args.slice(1).join(' '))
        return {
          status: 0,
          stdout: 'Telegram Connection Status\nStatus:   Not connected\n',
        }
      },
    })

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('connect status')
    expect(result.detail).toContain('telegram status')
    expect(result.detail).toContain('channel status telegram')
    expect(seen).toEqual([
      'connect status',
      'telegram status',
      'channel status telegram',
    ])
  })

  test('fails if a connector status command hits provider startup', () => {
    const result = checkConnectorCliControls({
      cliPath: 'dist/cli.mjs',
      runCommand: (_command, args) => ({
        status: 0,
        stdout: 'Status: Not connected\n',
        stderr: args.includes('telegram')
          ? 'Warning: ignoring saved provider profile. broken\n'
          : '',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('telegram status')
    expect(result.detail).toContain('channel status telegram')
  })
})

describe('checkTelegramChannelConfig', () => {
  test('reports missing Telegram token with both supported env names', () => {
    clearProviderEnv()

    const result = checkTelegramChannelConfig()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('DUCKHIVE_TELEGRAM_BOT_TOKEN')
    expect(result.detail).toContain('TELEGRAM_BOT_TOKEN')
  })

  test('accepts legacy TELEGRAM_BOT_TOKEN fallback used by the adapter', () => {
    clearProviderEnv()
    process.env.TELEGRAM_BOT_TOKEN = '123456789:ABCDEFGHIJKLMNOPQRSTUVWX'

    const result = checkTelegramChannelConfig()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('TELEGRAM_BOT_TOKEN')
    expect(result.detail).toContain('Configured without')
  })

  test('reports DuckHive Telegram token with allowlist', () => {
    clearProviderEnv()
    process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN =
      '123456789:ABCDEFGHIJKLMNOPQRSTUVWX'
    process.env.DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID = '424242'

    const result = checkTelegramChannelConfig()

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('DUCKHIVE_TELEGRAM_BOT_TOKEN')
    expect(result.detail).toContain('chat allowlist')
  })

  test('fails malformed Telegram allowlist instead of reporting remote control ready', () => {
    clearProviderEnv()
    process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN =
      '123456789:ABCDEFGHIJKLMNOPQRSTUVWX'
    process.env.DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID = 'not-a-chat-id'

    const result = checkTelegramChannelConfig()

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('contains no numeric chat IDs')
  })
})
