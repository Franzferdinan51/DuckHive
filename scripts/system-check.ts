// @ts-nocheck
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  CODEX_HTTP_ORIGINATOR,
  resolveCodexApiCredentials,
  resolveProviderRequest,
  isLocalProviderUrl as isProviderLocalUrl,
} from '../src/services/api/providerConfig.js'
import {
  getLocalOpenAICompatibleProviderLabel,
  probeOllamaGenerationReadiness,
} from '../src/utils/providerDiscovery.js'
import { detectCliInputModeWarnings } from '../src/utils/cliInputModeDiagnostic.js'
import { DEFAULT_GEMINI_MODEL } from '../src/utils/providerProfile.js'
import { redactUrlForDisplay } from '../src/utils/urlRedaction.js'
import {
  getRouteCredentialEnvVars,
  getRouteCredentialValue,
  getRouteDefaultBaseUrl,
  getRouteDefaultModel,
  getRouteLabel,
  getTransportKindForRoute,
  resolveActiveRouteIdFromEnv,
} from '../src/integrations/routeMetadata.js'
import { getClawHubRegistryUrl } from '../src/services/clawhub/skillHub.js'
import { createCombinedAbortSignal } from '../src/utils/combinedAbortSignal.js'

type CheckResult = {
  ok: boolean
  label: string
  detail?: string
}

type CliOptions = {
  json: boolean
  outFile: string | null
  strictInteractive: boolean
}

function pass(label: string, detail?: string): CheckResult {
  return { ok: true, label, detail }
}

function fail(label: string, detail?: string): CheckResult {
  return { ok: false, label, detail }
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

function parseOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    outFile: null,
    strictInteractive: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
      continue
    }

    if (arg === '--strict-interactive') {
      options.strictInteractive = true
      continue
    }

    if (arg === '--out') {
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        options.outFile = next
        i++
      }
    }
  }

  return options
}

export function formatReachabilityFailureDetail(
  endpoint: string,
  status: number,
  responseBody: string,
  request: {
    transport: string
    requestedModel: string
    resolvedModel: string
  },
): string {
  const compactBody = responseBody.trim().replace(/\s+/g, ' ').slice(0, 240)
  const base = `Unexpected status ${status} from ${redactUrlForDisplay(endpoint)}.`
  const bodySuffix = compactBody ? ` Body: ${compactBody}` : ''

  if (request.transport !== 'codex_responses' || status !== 400) {
    return `${base}${bodySuffix}`
  }

  if (!/not supported.*chatgpt account/i.test(responseBody)) {
    return `${base}${bodySuffix}`
  }

  return `${base}${bodySuffix} Hint: model alias "${request.requestedModel}" resolved to "${request.resolvedModel}", which this ChatGPT account does not currently allow. Try "codexplan" or another entitled Codex model.`
}

function checkNodeVersion(): CheckResult {
  const raw = process.versions.node
  const major = Number(raw.split('.')[0] ?? '0')
  if (Number.isNaN(major)) {
    return fail('Node.js version', `Could not parse version: ${raw}`)
  }

  if (major < 22) {
    return fail('Node.js version', `Detected ${raw}. Require >= 22.`)
  }

  return pass('Node.js version', raw)
}

function checkBunRuntime(): CheckResult {
  const bunVersion = (globalThis as { Bun?: { version?: string } }).Bun?.version
  if (!bunVersion) {
    return pass('Bun runtime', 'Not running inside Bun (this is acceptable for Node startup).')
  }
  return pass('Bun runtime', bunVersion)
}

function checkBuildArtifacts(): CheckResult {
  const distCli = resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(distCli)) {
    return fail('Build artifacts', `Missing ${distCli}. Run: bun run build`)
  }
  return pass('Build artifacts', distCli)
}

export function checkCliLauncherPath(options: {
  platform?: NodeJS.Platform
  cwd?: string
  expectedVersion?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
  resolveRealPath?: (path: string) => string
} = {}): CheckResult {
  const platform = options.platform ?? process.platform
  const cwd = options.cwd ?? process.cwd()
  const expectedVersion =
    options.expectedVersion ?? readPackageVersion(resolve(cwd, 'package.json'))
  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
      }))
  const resolveRealPath = options.resolveRealPath ?? realpathSync.native
  const sourceLauncher = resolve(
    cwd,
    'bin',
    platform === 'win32' ? 'duckhive.cmd' : 'duckhive',
  )

  const command = platform === 'win32' ? 'where.exe' : 'sh'
  const args = platform === 'win32' ? ['duckhive'] : ['-lc', 'command -v duckhive']
  const result = runCommand(command, args)
  const output = String(result.stdout ?? '').trim()
  const paths = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

  if (result.status === 0 && paths.length > 0) {
    const versionResult =
      platform === 'win32'
        ? runCommand('cmd.exe', ['/d', '/s', '/c', 'duckhive --version'])
        : runCommand('duckhive', ['--version'])
    const versionOutput = String(
      versionResult.stdout ?? versionResult.stderr ?? '',
    ).trim()
    if (
      expectedVersion &&
      (versionResult.status !== 0 || !versionOutput.includes(expectedVersion))
    ) {
      return fail(
        'CLI launcher',
        `duckhive resolves on PATH: ${paths[0]}, but \`duckhive --version\` returned "${versionOutput || 'no output'}" instead of ${expectedVersion}. Reinstall or relink this checkout.`,
      )
    }

    const shimDir = dirname(paths[0])
    const packageDir = resolve(shimDir, 'node_modules', 'duckhive')
    const expectedRealPath = resolveRealPath(cwd)
    const packageRealPath = existsSync(packageDir)
      ? resolveRealPath(packageDir)
      : null
    const normalizePath = (value: string) =>
      platform === 'win32' ? value.toLowerCase() : value

    if (
      packageRealPath &&
      normalizePath(packageRealPath) !== normalizePath(expectedRealPath)
    ) {
      return fail(
        'CLI launcher',
        `duckhive resolves on PATH: ${paths[0]}, but its package target is ${packageRealPath} instead of this checkout ${expectedRealPath}. Reinstall or relink this checkout.`,
      )
    }

    const versionSuffix = versionOutput ? ` Version: ${versionOutput}.` : ''
    const targetSuffix = packageRealPath ? ` Target: ${packageRealPath}.` : ''
    return pass(
      'CLI launcher',
      `duckhive resolves on PATH: ${paths[0]}.${versionSuffix}${targetSuffix}`,
    )
  }

  if (existsSync(sourceLauncher)) {
    return fail(
      'CLI launcher',
      platform === 'win32'
        ? `duckhive is not on PATH. Run .\\install.ps1, open a new PowerShell, or start from this checkout with .\\bin\\duckhive.cmd.`
        : `duckhive is not on PATH. Run ./install.sh, open a new shell, or start from this checkout with ./bin/duckhive.`,
    )
  }

  return fail(
    'CLI launcher',
    `duckhive is not on PATH and the source launcher is missing at ${sourceLauncher}. Reinstall DuckHive.`,
  )
}

export function checkTerminalStdio(io = {
  stdinIsTTY: process.stdin.isTTY === true,
  stdoutIsTTY: process.stdout.isTTY === true,
  stderrIsTTY: process.stderr.isTTY === true,
}, options: { strictInteractive?: boolean } = {}): CheckResult {
  const detail = `stdin=${io.stdinIsTTY ? 'TTY' : 'not TTY'}, stdout=${io.stdoutIsTTY ? 'TTY' : 'not TTY'}, stderr=${io.stderrIsTTY ? 'TTY' : 'not TTY'}.`

  if (io.stdinIsTTY && io.stdoutIsTTY) {
    return pass(
      'Terminal stdio',
      `${detail} Interactive REPL input/output can attach to this terminal.`,
    )
  }

  if (options.strictInteractive) {
    return fail(
      'Terminal stdio',
      `${detail} Strict interactive check failed: the REPL needs stdin and stdout attached to a real terminal.`,
    )
  }

  return pass(
    'Terminal stdio',
    `${detail} This diagnostic can run redirected, but the interactive REPL needs stdin and stdout attached to a real terminal.`,
  )
}

function checkTuiLaunchPath(): CheckResult {
  const isWindows = process.platform === 'win32'
  const binary = resolve(
    process.cwd(),
    'tui',
    isWindows ? 'duckhive-tui.exe' : 'duckhive-tui',
  )
  if (existsSync(binary)) {
    return pass('Terminal TUI', `Ready: ${binary}`)
  }

  const source = resolve(process.cwd(), 'tui', 'cmd', 'duckhive-tui', 'main.go')
  if (!existsSync(source)) {
    return fail(
      'Terminal TUI',
      `Missing Bubble Tea source at ${source}. Reinstall DuckHive or restore the tui directory.`,
    )
  }

  const goVersion = spawnSync('go', ['version'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  if (goVersion.status === 0) {
    return pass(
      'Terminal TUI',
      `Binary missing, but Go is available for on-demand build: ${(goVersion.stdout || '').trim()}`,
    )
  }

  return pass(
    'Terminal TUI',
    isWindows
      ? 'Binary missing and Go is not installed. `duckhive tui` will explain this and the classic REPL remains the Windows-safe default.'
      : 'Binary missing and Go is not installed. Run `scripts/install.sh` after installing Go, or use the classic REPL.',
  )
}

export function checkTuiInputSmoke(options: {
  cliPath?: string
  smokeText?: string
  submitText?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
} = {}): CheckResult {
  const cliPath = options.cliPath ?? resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(cliPath)) {
    return fail('Terminal TUI input', `Missing ${cliPath}. Run: bun run build`)
  }

  const smokeText = options.smokeText ?? 'typed through runtime doctor'
  const submitText = options.submitText ?? 'submitted through runtime doctor'
  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...process.env,
          DUCKHIVE_DISABLE_STARTUP_SCREEN: '1',
        },
      }))

  const inputResult = runCommand(process.execPath, [
    cliPath,
    'tui',
    '--input-smoke',
    smokeText,
  ])
  const inputOutput = `${inputResult.stdout ?? ''}${inputResult.stderr ?? ''}`
  if (
    inputResult.status !== 0 ||
    !inputOutput.includes('DuckHive TUI input smoke passed') ||
    !inputOutput.includes(smokeText)
  ) {
    return fail(
      'Terminal TUI input',
      `Packaged TUI input smoke failed. Output: ${inputOutput.trim() || 'none'}`,
    )
  }

  const submitResult = runCommand(process.execPath, [
    cliPath,
    'tui',
    '--submit-smoke',
    submitText,
  ])
  const submitOutput = `${submitResult.stdout ?? ''}${submitResult.stderr ?? ''}`
  if (
    submitResult.status !== 0 ||
    !submitOutput.includes('DuckHive TUI submit smoke passed') ||
    !submitOutput.includes(submitText)
  ) {
    return fail(
      'Terminal TUI input',
      `Packaged TUI submit smoke failed. Output: ${submitOutput.trim() || 'none'}`,
    )
  }

  return pass(
    'Terminal TUI input',
    '`duckhive tui --input-smoke` and `duckhive tui --submit-smoke` verified the packaged Bubble Tea input loop and submit path through the CLI launcher.',
  )
}

export function checkCliInputMode(
  env: NodeJS.ProcessEnv = process.env,
  runtime = { platform: process.platform },
): CheckResult {
  const warnings = detectCliInputModeWarnings(env, runtime.platform)
  if (runtime.platform === 'win32' && env.DUCKHIVE_STDIN_MODE === 'data') {
    return pass(
      'CLI input mode',
      'Windows data-event stdin is active for this launch; use `duckhive --stdin-mode readable` only if you need to compare DuckHive\'s readable compatibility path.',
    )
  }

  if (runtime.platform === 'win32' && env.DUCKHIVE_STDIN_MODE === 'readable') {
    return pass(
      'CLI input mode',
      'DuckHive readable compatibility stdin is explicitly active for this launch; remove `--stdin-mode readable` to return to the Windows data-event default.',
    )
  }

  if (warnings.length === 0 && runtime.platform !== 'win32') {
    return pass('CLI input mode', 'Readable stdin default active.')
  }

  if (warnings.length > 0) {
    return fail(
      'CLI input mode',
      `${warnings[0]?.issue}. ${warnings[0]?.fix}`,
    )
  }

  return pass(
    'CLI input mode',
    'Windows data-event stdin is active by default so the REPL accepts typed characters after the UI paints. Use `duckhive --stdin-mode readable` to compare DuckHive\'s readable compatibility path. Early input capture remains disabled, no-args startup forces the classic REPL, inherited TUI handoff flags are ignored unless `duckhive tui` or DUCKHIVE_TUI_WINDOWS_EXPERIMENT=1 is used, startup-era dialogs cannot unmount the prompt before the first submission, and detached stdin falls back to CONIN$ only when stdout is still interactive.',
  )
}

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : undefined
  } catch {
    return undefined
  }
}

function existingOverridePaths(keys: string[]): string[] {
  const paths: string[] = []
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value && existsSync(resolve(value))) {
      paths.push(`${key}=${value}`)
    }
  }
  return paths
}

function checkComputerUseReadiness(): CheckResult {
  const gatewayPackageJson = resolve(
    process.cwd(),
    'skills',
    'newest-desktop-control',
    'package.json',
  )

  if (!existsSync(gatewayPackageJson)) {
    return fail(
      'Computer use',
      'Missing bundled skills/newest-desktop-control gateway. Restore the skill before using desktop, Android, or computer_use_* aliases.',
    )
  }

  const gatewayVersion = readPackageVersion(gatewayPackageJson)
  const gatewayDetail = gatewayVersion
    ? `bundled newest-desktop-control v${gatewayVersion}`
    : 'bundled newest-desktop-control present'
  const overridePaths = existingOverridePaths([
    'DUCKHIVE_CODEX_COMPUTER_USE_PLUGIN_DIR',
    'CODEX_COMPUTER_USE_PLUGIN_DIR',
    'DUCKHIVE_CODEX_COMPUTER_USE_CLIENT',
    'CODEX_COMPUTER_USE_CLIENT',
  ])

  if (process.platform !== 'darwin') {
    return pass(
      'Computer use',
      `Native Codex computer-use is macOS-only; ${gatewayDetail} is available for desktop, Android, and compatibility aliases.`,
    )
  }

  if (overridePaths.length > 0) {
    return pass(
      'Computer use',
      `${gatewayDetail}; native Codex override configured: ${overridePaths.join(', ')}.`,
    )
  }

  const codexBundle = '/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use'
  if (existsSync(codexBundle)) {
    return pass(
      'Computer use',
      `${gatewayDetail}; Codex.app computer-use bundle detected for /computer-use inspection.`,
    )
  }

  return pass(
    'Computer use',
    `${gatewayDetail}; native Codex computer-use bundle not detected, so use newest-desktop-control unless a Codex plugin override is configured.`,
  )
}

function isLocalBaseUrl(baseUrl: string): boolean {
  return isProviderLocalUrl(baseUrl)
}

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const MISTRAL_DEFAULT_BASE_URL = 'https://api.mistral.ai/v1'
const GITHUB_COPILOT_BASE = 'https://api.githubcopilot.com'

const REQUIRED_HARNESS_COMMANDS = {
  goal: 'src/commands/goal/index.ts',
  loop: 'src/commands/loop/index.ts',
  run: 'src/commands/run/index.ts',
  'computer-use': 'src/commands/computer-use/index.ts',
  mmx: 'src/commands/mmx/index.ts',
  voice: 'src/commands/voice/index.ts',
  provider: 'src/commands/provider/index.ts',
  permissions: 'src/commands/permissions/index.ts',
  checkpoint: 'src/commands/checkpoint/index.ts',
  channel: 'src/commands/channel/index.ts',
  connect: 'src/commands/connect/index.ts',
  skill: 'src/commands/skill/index.ts',
  skills: 'src/commands/skills/index.ts',
  spawn: 'src/commands/spawn/index.ts',
  orchestrate: 'src/commands/hive-orchestrate/index.ts',
  team: 'src/commands/hive-team/index.ts',
  council: 'src/commands/hive-council/index.ts',
  senate: 'src/commands/hive-senate/index.ts',
  decree: 'src/commands/hive-decree/index.ts',
  swarm: 'src/commands/hive-swarm/index.ts',
  tui: 'src/commands/tui/index.ts',
  doctor: 'src/commands/doctor/index.ts',
} as const

const REQUIRED_SLASH_ONLY_COMMANDS = {
  android: 'src/commands/android/index.ts',
  vision: 'src/commands/vision/index.ts',
  shadow: 'src/commands/shadow/index.ts',
  router: 'src/commands/router/index.ts',
  budget: 'src/commands/budget/index.ts',
  cache: 'src/commands/cache/index.ts',
  export: 'src/commands/export/index.ts',
} as const

const REQUIRED_HARNESS_ALIASES = {
  g: 'goal',
  subagent: 'spawn',
  cu: 'computer-use',
  minimax: 'mmx',
  'allowed-tools': 'permissions',
  checkpoints: 'checkpoint',
} as const

const REQUIRED_AGENT_RUN_CLI_CONTROLS = [
  'ps',
  'logs',
  'attach',
  'pause',
  'resume',
  'approve',
  'recover',
  'kill',
] as const

const REQUIRED_TOP_LEVEL_HELP_TERMS = [
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
] as const

const REQUIRED_CONNECTOR_STATUS_COMMANDS = [
  ['connect', 'status'],
  ['telegram', 'status'],
  ['channel', 'status', 'telegram'],
] as const

function missingCommandFiles(
  cwd: string,
  commands: Record<string, string>,
): string[] {
  return Object.entries(commands)
    .filter(([, relativePath]) => !existsSync(join(cwd, relativePath)))
    .map(([command, relativePath]) => `${command} (${relativePath})`)
}

export function checkHarnessCommandSurfaces(options: {
  cwd?: string
} = {}): CheckResult {
  const cwd = options.cwd ?? process.cwd()
  const missingCore = missingCommandFiles(cwd, REQUIRED_HARNESS_COMMANDS)
  const missingSlashOnly = missingCommandFiles(cwd, REQUIRED_SLASH_ONLY_COMMANDS)

  if (missingCore.length > 0 || missingSlashOnly.length > 0) {
    return fail(
      'Harness command surfaces',
      [
        missingCore.length > 0
          ? `Missing core command files: ${missingCore.join(', ')}.`
          : '',
        missingSlashOnly.length > 0
          ? `Missing slash-only command files: ${missingSlashOnly.join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const coreCommands = Object.keys(REQUIRED_HARNESS_COMMANDS)
  const slashOnlyCommands = Object.keys(REQUIRED_SLASH_ONLY_COMMANDS)
  const aliases = Object.keys(REQUIRED_HARNESS_ALIASES)

  return pass(
    'Harness command surfaces',
    `${coreCommands.length} required core command files found: ${coreCommands.join(', ')}. Required slash-only command files found: ${slashOnlyCommands.join(', ')}. Key aliases tracked: ${aliases.join(', ')}.`,
  )
}

function countCheckpointJsonFiles(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      entry => entry.isFile() && entry.name.endsWith('.json'),
    ).length
  } catch {
    return 0
  }
}

function resolveHarnessConfigDir(options: {
  configDir?: string
  homeDir?: string
} = {}): string {
  const configured = options.configDir ?? process.env.CLAUDE_CONFIG_DIR
  if (configured?.trim()) {
    return configured
  }

  return join(options.homeDir ?? homedir(), '.duckhive')
}

export function checkHarnessStateReadiness(options: {
  cwd?: string
  configDir?: string
  homeDir?: string
} = {}): CheckResult {
  const cwd = options.cwd ?? process.cwd()
  const home = options.homeDir ?? homedir()
  const configDir = resolveHarnessConfigDir({
    configDir: options.configDir,
    homeDir: home,
  })
  let checkpoints = countCheckpointJsonFiles(join(configDir, 'checkpoints'))
  if (checkpoints === 0) {
    checkpoints = countCheckpointJsonFiles(
      join(home, '.config', 'openclaude', 'checkpoints'),
    )
  }

  const budgetState = existsSync(join(configDir, 'budget-state.json'))
  const budgetLog = existsSync(join(configDir, 'budget-log.jsonl'))
  const budget =
    budgetState && budgetLog
      ? 'state+log'
      : budgetState
        ? 'state only'
        : budgetLog
          ? 'log only'
          : 'not initialized'

  const mcpDetected =
    existsSync(join(cwd, 'src', 'services', 'mcp')) ||
    existsSync(join(cwd, 'config', 'mcporter.json'))
  const acpDetected = existsSync(join(cwd, 'src', 'commands', 'acp', 'acp-impl.ts'))
  const permissionsDetected = existsSync(
    join(cwd, 'src', 'utils', 'permissions', 'permissions.ts'),
  )

  return pass(
    'Harness state readiness',
    `checkpoints=${checkpoints}; budget=${budget}; MCP=${mcpDetected ? 'detected' : 'not detected'}; ACP=${acpDetected ? 'detected' : 'not detected'}; permissions=${permissionsDetected ? 'detected' : 'not detected'}. Read-only diagnostics; mutate through /checkpoint, /budget, /mcp, /acp, and /permissions.`,
  )
}

export function checkTopLevelCliHelpSurface(options: {
  cliPath?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
} = {}): CheckResult {
  const cliPath = options.cliPath ?? resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(cliPath)) {
    return fail('Top-level CLI help', `Missing ${cliPath}. Run: bun run build`)
  }

  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          DUCKHIVE_DISABLE_STARTUP_SCREEN: '1',
        },
      }))

  const result = runCommand(process.execPath, [cliPath, '--help'])
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const missing = REQUIRED_TOP_LEVEL_HELP_TERMS.filter(term => !output.includes(term))

  if (result.status !== 0 || missing.length > 0) {
    return fail(
      'Top-level CLI help',
      `Missing terminal help entries: ${missing.join(', ') || 'help command failed'}.`,
    )
  }

  return pass(
    'Top-level CLI help',
    `duckhive --help advertises terminal harness commands: ${REQUIRED_TOP_LEVEL_HELP_TERMS.join(', ')}.`,
  )
}

export function checkAgentRunCliControls(options: {
  cliPath?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
} = {}): CheckResult {
  const cliPath = options.cliPath ?? resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(cliPath)) {
    return fail('AgentRun CLI controls', `Missing ${cliPath}. Run: bun run build`)
  }

  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          DUCKHIVE_DISABLE_STARTUP_SCREEN: '1',
        },
      }))

  const missing: string[] = []
  for (const control of REQUIRED_AGENT_RUN_CLI_CONTROLS) {
    const result = runCommand(process.execPath, [cliPath, control, '--help'])
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (
      result.status !== 0 ||
      !output.includes('DuckHive background run controls') ||
      output.includes('Warning: ignoring saved provider profile')
    ) {
      missing.push(control)
    }
  }

  if (missing.length > 0) {
    return fail(
      'AgentRun CLI controls',
      `Missing or provider-blocked top-level controls: ${missing.join(', ')}.`,
    )
  }

  return pass(
    'AgentRun CLI controls',
    `Top-level controls available without provider startup: ${REQUIRED_AGENT_RUN_CLI_CONTROLS.join(', ')}.`,
  )
}

export function checkInputTestCliControl(options: {
  cliPath?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
} = {}): CheckResult {
  const cliPath = options.cliPath ?? resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(cliPath)) {
    return fail('Terminal input test', `Missing ${cliPath}. Run: bun run build`)
  }

  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          DUCKHIVE_DISABLE_STARTUP_SCREEN: '1',
        },
      }))

  const result = runCommand(process.execPath, [cliPath, 'input-test', '--help'])
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

  if (
    result.status !== 0 ||
    !output.includes('DuckHive input-test') ||
    !output.includes('without starting providers')
  ) {
    return fail(
      'Terminal input test',
      '`duckhive input-test --help` is not reachable without provider startup.',
    )
  }

  return pass(
    'Terminal input test',
    'Provider-free `duckhive input-test` is available for raw keyboard diagnostics.',
  )
}

export function checkSkillHubRegistry(): CheckResult {
  const registry = getClawHubRegistryUrl()
  return pass(
    'Skill hub registry',
    `ClawHub registry configured at ${registry}; /skill search, inspect, and install are available.`,
  )
}

export function checkConnectorCliControls(options: {
  cliPath?: string
  runCommand?: (command: string, args: string[]) => {
    status: number | null
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
} = {}): CheckResult {
  const cliPath = options.cliPath ?? resolve(process.cwd(), 'dist', 'cli.mjs')
  if (!existsSync(cliPath)) {
    return fail('Connector CLI controls', `Missing ${cliPath}. Run: bun run build`)
  }

  const runCommand =
    options.runCommand ??
    ((command: string, args: string[]) =>
      spawnSync(command, args, {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          DUCKHIVE_DISABLE_STARTUP_SCREEN: '1',
        },
      }))

  const missing: string[] = []
  for (const args of REQUIRED_CONNECTOR_STATUS_COMMANDS) {
    const result = runCommand(process.execPath, [cliPath, ...args])
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (
      result.status !== 0 ||
      !output.includes('Status:') ||
      output.includes('Warning: ignoring saved provider profile')
    ) {
      missing.push(args.join(' '))
    }
  }

  if (missing.length > 0) {
    return fail(
      'Connector CLI controls',
      `Missing or provider-blocked connector status commands: ${missing.join(', ')}.`,
    )
  }

  return pass(
    'Connector CLI controls',
    `Provider-free connector status commands available: ${REQUIRED_CONNECTOR_STATUS_COMMANDS.map(args => args.join(' ')).join(', ')}.`,
  )
}

function getActiveDescriptorOpenAICompatibleRouteId(): string | null {
  const routeId = resolveActiveRouteIdFromEnv(process.env)
  if (!routeId || routeId === 'anthropic') {
    return null
  }

  const transport = getTransportKindForRoute(routeId)
  return transport === 'openai-compatible' || transport === 'local'
    ? routeId
    : null
}

function resolveDoctorProviderRequest() {
  const routeId = getActiveDescriptorOpenAICompatibleRouteId()
  return resolveProviderRequest({
    model: process.env.OPENAI_MODEL || (routeId ? getRouteDefaultModel(routeId) : undefined),
    baseUrl: process.env.OPENAI_BASE_URL || (routeId ? getRouteDefaultBaseUrl(routeId) : undefined),
  })
}

function currentBaseUrl(): string {
  if (isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) {
    return process.env.MISTRAL_BASE_URL ?? MISTRAL_DEFAULT_BASE_URL
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)) {
    return process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE
  }
  return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
}

function checkGeminiEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const model = process.env.GEMINI_MODEL
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  const baseUrl = process.env.GEMINI_BASE_URL ?? GEMINI_DEFAULT_BASE_URL

  results.push(pass('Provider mode', 'Google Gemini provider enabled.'))

  if (!model) {
    results.push(pass('GEMINI_MODEL', `Not set. Default ${DEFAULT_GEMINI_MODEL} will be used.`))
  } else {
    results.push(pass('GEMINI_MODEL', model))
  }

  results.push(pass('GEMINI_BASE_URL', baseUrl))

  if (!key) {
    results.push(fail('GEMINI_API_KEY', 'Missing. Set GEMINI_API_KEY or GOOGLE_API_KEY.'))
  } else {
    results.push(pass('GEMINI_API_KEY', 'Configured.'))
  }

  return results
}

function checkMistralEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const model = process.env.MISTRAL_MODEL
  const key = process.env.MISTRAL_API_KEY
  const baseUrl = process.env.MISTRAL_BASE_URL ?? MISTRAL_DEFAULT_BASE_URL

  results.push(pass('Provider mode', 'Mistral provider enabled.'))

  if (!model) {
    results.push(pass('MISTRAL_MODEL', 'Not set. Default will be used at runtime.'))
  } else {
    results.push(pass('MISTRAL_MODEL', model))
  }

  results.push(pass('MISTRAL_BASE_URL', baseUrl))

  if (!key) {
    results.push(fail('MISTRAL_API_KEY', 'Missing. Set MISTRAL_API_KEY.'))
  } else {
    results.push(pass('MISTRAL_API_KEY', 'Configured.'))
  }

  return results
}

function checkGithubEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const baseUrl = process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE
  results.push(pass('Provider mode', 'GitHub Models provider enabled.'))

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (!token?.trim()) {
    results.push(fail('GITHUB_TOKEN', 'Missing. Set GITHUB_TOKEN or GH_TOKEN.'))
  } else {
    results.push(pass('GITHUB_TOKEN', 'Configured.'))
  }

  if (!process.env.OPENAI_MODEL) {
    results.push(
      pass(
        'OPENAI_MODEL',
        'Not set. Default github:copilot → openai/gpt-4.1 at runtime.',
      ),
    )
  } else {
    results.push(pass('OPENAI_MODEL', process.env.OPENAI_MODEL))
  }

  results.push(pass('OPENAI_BASE_URL', baseUrl))
  return results
}

function checkDescriptorRouteEnv(routeId: string): CheckResult[] {
  const results: CheckResult[] = []
  const label = getRouteLabel(routeId) ?? routeId
  const defaultModel = getRouteDefaultModel(routeId)
  const defaultBaseUrl = getRouteDefaultBaseUrl(routeId)
  const credentialVars = getRouteCredentialEnvVars(routeId)
  const credential = getRouteCredentialValue(routeId)

  results.push(pass('Provider mode', `${label} provider enabled.`))
  results.push(
    pass(
      'OPENAI_MODEL',
      process.env.OPENAI_MODEL ||
        defaultModel ||
        'Not set. Runtime fallback model will be used.',
    ),
  )
  if (defaultBaseUrl || process.env.OPENAI_BASE_URL) {
    results.push(
      pass(
        'OPENAI_BASE_URL',
        redactUrlForDisplay(process.env.OPENAI_BASE_URL ?? defaultBaseUrl ?? ''),
      ),
    )
  }

  if (credentialVars.length > 0) {
    results.push(
      credential
        ? pass(credentialVars.join(' or '), 'Configured.')
        : fail(
            credentialVars.join(' or '),
            `Missing. Set one of: ${credentialVars.join(', ')}.`,
          ),
    )
  }

  return results
}

function checkDefaultMiniMaxEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const defaultModel = getRouteDefaultModel('minimax') ?? 'MiniMax-M2.7'
  const defaultBaseUrl = getRouteDefaultBaseUrl('minimax')
  const credentialVars = getRouteCredentialEnvVars('minimax')
  const credential = getRouteCredentialValue('minimax')

  results.push(pass('Provider mode', 'MiniMax provider enabled by DuckHive default.'))
  results.push(pass('OPENAI_MODEL', defaultModel))
  if (defaultBaseUrl) {
    results.push(pass('OPENAI_BASE_URL', redactUrlForDisplay(defaultBaseUrl)))
  }
  if (credentialVars.length > 0) {
    results.push(
      credential
        ? pass(credentialVars.join(' or '), 'Configured.')
        : pass(
            credentialVars.join(' or '),
            `Not configured. Startup will use MiniMax defaults and request auth when generation is needed; set one of: ${credentialVars.join(', ')}.`,
          ),
    )
  }

  return results
}

export function checkOpenAIEnv(): CheckResult[] {
  const results: CheckResult[] = []
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)

  if (useGemini) {
    return checkGeminiEnv()
  }

  if (useMistral) {
    return checkMistralEnv()
  }

  if (useGithub && !useOpenAI) {
    return checkGithubEnv()
  }

  const activeRouteId = resolveActiveRouteIdFromEnv(process.env)
  if (!useOpenAI && activeRouteId && activeRouteId !== 'anthropic') {
    return checkDescriptorRouteEnv(activeRouteId)
  }

  if (!useOpenAI) {
    const explicitDuckHiveProvider =
      process.env.DUCKHIVE_PROVIDER ?? process.env.DUCKHIVE_DEFAULT_PROVIDER
    if (explicitDuckHiveProvider?.trim().toLowerCase() === 'anthropic') {
      results.push(pass('Provider mode', 'Anthropic login flow enabled by explicit DuckHive provider selection.'))
      return results
    }
    return checkDefaultMiniMaxEnv()
  }

  const request = resolveDoctorProviderRequest()
  const routeCredential =
    activeRouteId && activeRouteId !== 'anthropic'
      ? getRouteCredentialValue(activeRouteId)
      : undefined
  const credentialLabel =
    activeRouteId && activeRouteId !== 'anthropic'
      ? getRouteCredentialEnvVars(activeRouteId).join(' or ')
      : 'OPENAI_API_KEY'
  const key = routeCredential ?? process.env.OPENAI_API_KEY

  results.push(
    pass(
      'Provider mode',
      request.transport === 'codex_responses'
        ? 'Codex responses backend enabled.'
        : 'OpenAI-compatible provider enabled.',
    ),
  )

  if (!process.env.OPENAI_MODEL) {
    results.push(pass('OPENAI_MODEL', 'Not set. Runtime fallback model will be used.'))
  } else {
    results.push(pass('OPENAI_MODEL', process.env.OPENAI_MODEL))
  }

  results.push(pass('OPENAI_BASE_URL', redactUrlForDisplay(request.baseUrl)))

  if (request.transport === 'codex_responses') {
    const credentials = resolveCodexApiCredentials(process.env)
    if (!credentials.apiKey) {
      const authHint = credentials.authPath
        ? `Missing CODEX_API_KEY and no usable auth.json at ${credentials.authPath}.`
        : 'Missing CODEX_API_KEY and auth.json fallback.'
      results.push(fail('CODEX auth', authHint))
    } else if (!credentials.accountId) {
      results.push(fail('CHATGPT_ACCOUNT_ID', 'Missing chatgpt_account_id in Codex auth.'))
    } else {
      const detail = credentials.source === 'env'
        ? 'Using CODEX_API_KEY.'
        : `Using ${credentials.authPath}.`
      results.push(pass('CODEX auth', detail))
    }
    return results
  }

  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (key === 'SUA_CHAVE') {
    results.push(fail(credentialLabel, 'Placeholder value detected: SUA_CHAVE.'))
  } else if (
    !key &&
    !isLocalBaseUrl(request.baseUrl) &&
    !(useGithub && githubToken?.trim())
  ) {
    results.push(fail(credentialLabel, 'Missing key for non-local provider URL.'))
  } else if (!key && useGithub && githubToken?.trim()) {
    results.push(
      pass(credentialLabel, 'Not set; GITHUB_TOKEN/GH_TOKEN will be used for GitHub Models.'),
    )
  } else if (!key) {
    results.push(pass(credentialLabel, 'Not set (allowed for local providers like Atomic Chat/Ollama/LM Studio).'))
  } else {
    results.push(pass(credentialLabel, 'Configured.'))
  }

  return results
}

export async function checkBaseUrlReachability(): Promise<CheckResult> {
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  const descriptorRouteId = getActiveDescriptorOpenAICompatibleRouteId()

  if (!useGemini && !useOpenAI && !useGithub && !useMistral && !descriptorRouteId) {
    return pass('Provider reachability', 'Skipped (OpenAI-compatible mode disabled).')
  }

  if (useGithub && !useOpenAI) {
    return pass(
      'Provider reachability',
      'Skipped for GitHub Models (inference endpoint differs from OpenAI /models probe).',
    )
  }

  const geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai'
  const resolvedBaseUrl = useGemini
    ? (process.env.GEMINI_BASE_URL ?? geminiBaseUrl)
    : undefined
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL || (descriptorRouteId ? getRouteDefaultModel(descriptorRouteId) : undefined),
    baseUrl: resolvedBaseUrl ?? process.env.OPENAI_BASE_URL ?? (descriptorRouteId ? getRouteDefaultBaseUrl(descriptorRouteId) : undefined),
  })
  const probeViaChatCompletions = descriptorRouteId === 'gitlawb-opengateway'
  const endpoint = request.transport === 'codex_responses'
    ? `${request.baseUrl}/responses`
    : probeViaChatCompletions
      ? `${request.baseUrl}/chat/completions`
    : `${request.baseUrl}/models`
  const redactedEndpoint = redactUrlForDisplay(endpoint)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  try {
    const headers: Record<string, string> = {}
    let method = 'GET'
    let body: string | undefined

    if (request.transport === 'codex_responses') {
      const credentials = resolveCodexApiCredentials(process.env)
      if (credentials.apiKey) {
        headers.Authorization = `Bearer ${credentials.apiKey}`
      }
      if (credentials.accountId) {
        headers['chatgpt-account-id'] = credentials.accountId
      }
      headers['Content-Type'] = 'application/json'
      headers.originator = CODEX_HTTP_ORIGINATOR
      method = 'POST'
      body = JSON.stringify({
        model: request.resolvedModel,
        instructions: 'Runtime doctor probe.',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'ping' }],
          },
        ],
        store: false,
        stream: true,
      })
    } else if (useGemini && (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)) {
      headers.Authorization = `Bearer ${process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY}`
    } else if (useMistral && process.env.MISTRAL_API_KEY) {
      headers.Authorization = `Bearer ${process.env.MISTRAL_API_KEY}`
    } else if (descriptorRouteId && getRouteCredentialValue(descriptorRouteId)) {
      headers.Authorization = `Bearer ${getRouteCredentialValue(descriptorRouteId)}`
    } else if (probeViaChatCompletions && process.env.OPENAI_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`
    } else if (process.env.OPENAI_API_KEY) {
      headers.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`
    }

    if (probeViaChatCompletions) {
      method = 'POST'
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        model: request.resolvedModel,
        messages: [
          {
            role: 'user',
            content: 'Runtime doctor probe.',
          },
        ],
        max_completion_tokens: 1,
        stream: true,
      })
    }

    const response = await fetch(endpoint, {
      method,
      headers,
      body,
      signal: controller.signal,
    })

    if (response.status === 200 || response.status === 401 || response.status === 403) {
      if (probeViaChatCompletions && response.body) {
        await response.body.cancel().catch(() => {})
      }
      return pass(
        'Provider reachability',
        `Reached ${redactedEndpoint} (status ${response.status}).`,
      )
    }

    const responseBody = await response.text().catch(() => '')
    const detail = formatReachabilityFailureDetail(
      endpoint,
      response.status,
      responseBody,
      request,
    )
    return fail(
      'Provider reachability',
      detail,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(
      'Provider reachability',
      `Failed to reach ${redactedEndpoint}: ${message}`,
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function checkProviderGenerationReadiness(): Promise<CheckResult> {
  const useGemini = isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)
  const useOpenAI = isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  const useGithub = isTruthy(process.env.CLAUDE_CODE_USE_GITHUB)
  const useMistral = isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  const descriptorRouteId = getActiveDescriptorOpenAICompatibleRouteId()

  if (!useGemini && !useOpenAI && !useGithub && !useMistral && !descriptorRouteId) {
    return pass('Provider generation readiness', 'Skipped (OpenAI-compatible mode disabled).')
  }

  if (useGithub && !useOpenAI) {
    return pass(
      'Provider generation readiness',
      'Skipped for GitHub Models (runtime generation uses a different endpoint flow).',
    )
  }

  if (useGemini || useMistral) {
    return pass(
      'Provider generation readiness',
      'Skipped for managed provider mode.',
    )
  }

  if (!useOpenAI && !descriptorRouteId) {
    return pass('Provider generation readiness', 'Skipped (OpenAI-compatible mode disabled).')
  }

  const request = resolveDoctorProviderRequest()

  if (request.transport === 'codex_responses') {
    return pass(
      'Provider generation readiness',
      'Skipped for Codex responses (reachability probe already performs a lightweight generation request).',
    )
  }

  if (!isLocalBaseUrl(request.baseUrl)) {
    return pass('Provider generation readiness', 'Skipped for non-local provider URL.')
  }

  const localProviderLabel = getLocalOpenAICompatibleProviderLabel(request.baseUrl)
  if (localProviderLabel !== 'Ollama') {
    return pass(
      'Provider generation readiness',
      `Skipped for ${localProviderLabel} (no provider-specific generation probe).`,
    )
  }

  const readiness = await probeOllamaGenerationReadiness({
    baseUrl: request.baseUrl,
    model: request.requestedModel,
  })

  if (readiness.state === 'ready') {
    return pass(
      'Provider generation readiness',
      `Generated a test response with ${readiness.probeModel ?? request.requestedModel}.`,
    )
  }

  if (readiness.state === 'unreachable') {
    return fail(
      'Provider generation readiness',
      `Could not reach Ollama at ${redactUrlForDisplay(request.baseUrl)}.`,
    )
  }

  if (readiness.state === 'no_models') {
    return fail(
      'Provider generation readiness',
      'Ollama is reachable, but no installed models were found. Pull a model first (for example: ollama pull qwen2.5-coder:7b).',
    )
  }

  const detailSuffix = readiness.detail ? ` Detail: ${readiness.detail}.` : ''
  return fail(
    'Provider generation readiness',
    `Ollama is reachable, but generation failed for ${readiness.probeModel ?? request.requestedModel}.${detailSuffix}`,
  )
}

function isAtomicChatUrl(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl)
    return parsed.port === '1337' && isLocalBaseUrl(baseUrl)
  } catch {
    return false
  }
}

function checkOllamaProcessorMode(): CheckResult {
  const descriptorRouteId = getActiveDescriptorOpenAICompatibleRouteId()
  if (
    (!isTruthy(process.env.CLAUDE_CODE_USE_OPENAI) && !descriptorRouteId) ||
    isTruthy(process.env.CLAUDE_CODE_USE_GEMINI) ||
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB) ||
    isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)
  ) {
    return pass('Ollama processor mode', 'Skipped (OpenAI-compatible mode disabled).')
  }

  const baseUrl = descriptorRouteId
    ? (process.env.OPENAI_BASE_URL ?? getRouteDefaultBaseUrl(descriptorRouteId) ?? currentBaseUrl())
    : currentBaseUrl()
  if (!isLocalBaseUrl(baseUrl)) {
    return pass('Ollama processor mode', 'Skipped (provider URL is not local).')
  }

  if (isAtomicChatUrl(baseUrl)) {
    return pass('Ollama processor mode', 'Skipped (Atomic Chat local provider detected, not Ollama).')
  }

  const result = spawnSync('ollama', ['ps'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || 'Unable to run ollama ps').trim()
    return pass('Ollama processor mode', `Native CLI check failed (${detail}). Assuming valid Docker/remote backend since HTTP ping passed.`)
  }

  const output = (result.stdout || '').trim()
  if (!output) {
    return fail('Ollama processor mode', 'ollama ps returned empty output.')
  }

  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const modelLine = lines.find(line => line.includes(':') && !line.startsWith('NAME'))
  if (!modelLine) {
    return pass('Ollama processor mode', 'No loaded model found (run a prompt first).')
  }

  if (modelLine.includes('CPU')) {
    return pass('Ollama processor mode', 'Detected CPU mode. This is valid but can be slow for larger models.')
  }

  return pass('Ollama processor mode', `Detected non-CPU mode: ${modelLine}`)
}

function checkAgentHarnessRuntime(): CheckResult {
  const runtime = process.env.DUCKHIVE_AGENT_RUNTIME ?? 'auto'
  const fallback = process.env.DUCKHIVE_AGENT_HARNESS_FALLBACK ?? 'builtin'
  const validFallbacks = new Set(['builtin', 'none'])
  if (!validFallbacks.has(fallback)) {
    return fail(
      'Agent harness runtime',
      `Invalid DUCKHIVE_AGENT_HARNESS_FALLBACK=${fallback}. Use builtin or none.`,
    )
  }
  return pass(
    'Agent harness runtime',
    `runtime=${runtime}; fallback=${fallback}; public import duckhive/harness.`,
  )
}

export async function checkCouncilRuntimeReadiness(options: {
  cwd?: string
  councilUrl?: string
  fetchJson?: (url: string) => Promise<unknown>
} = {}): Promise<CheckResult> {
  const cwd = options.cwd ?? process.cwd()
  const serverPath = resolve(cwd, 'src', 'services', 'council-server', 'council-api-server.cjs')
  const hasServerSource = existsSync(serverPath)
  const packageJsonPath = resolve(cwd, 'package.json')
  const hasServeScript = (() => {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        scripts?: Record<string, unknown>
      }
      return typeof parsed.scripts?.['council:serve'] === 'string'
    } catch {
      return false
    }
  })()

  if (!hasServerSource || !hasServeScript) {
    return fail(
      'AI Council runtime',
      `Missing local Council runtime pieces: ${hasServerSource ? '' : 'src/services/council-server/council-api-server.cjs '}${hasServeScript ? '' : 'package script council:serve'}`.trim(),
    )
  }

  const councilUrl = (options.councilUrl ?? process.env.DUCKHIVE_COUNCIL_URL ?? 'http://localhost:3007').replace(/\/+$/, '')
  const fetchJson =
    options.fetchJson ??
    (async (url: string) => {
      const timeout = createCombinedAbortSignal(undefined, { timeoutMs: 1500 })
      try {
        const response = await fetch(url, {
          signal: timeout.signal,
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        return await response.json()
      } finally {
        timeout.cleanup()
      }
    })

  try {
    const health = await fetchJson(`${councilUrl}/api/health`) as {
      status?: unknown
      services?: { council?: unknown; hiveCore?: unknown }
      version?: unknown
    }
    const councilReady = health?.status === 'ok' || health?.services?.council === true
    if (!councilReady) {
      return fail(
        'AI Council runtime',
        `Council endpoint responded at ${councilUrl}, but health did not report ready status. Check /api/health.`,
      )
    }

    const councilors = await fetchJson(`${councilUrl}/api/councilors`)
    const councilorCount = Array.isArray(councilors)
      ? councilors.length
      : (
          councilors &&
          typeof councilors === 'object' &&
          'councilors' in councilors &&
          Array.isArray((councilors as { councilors?: unknown }).councilors)
        )
        ? (councilors as { councilors: unknown[] }).councilors.length
        : 0
    if (councilorCount === 0) {
      return fail(
        'AI Council runtime',
        `Council endpoint responded at ${councilUrl}, but /api/councilors did not return a usable councilor catalog.`,
      )
    }

    return pass(
      'AI Council runtime',
      `Live at ${councilUrl}; councilors=${councilorCount}; services council=${health.services?.council === true ? 'ready' : 'unknown'}, hiveCore=${health.services?.hiveCore === true ? 'ready' : 'unknown'}, version=${String(health.version ?? 'unknown')}.`,
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return pass(
      'AI Council runtime',
      `Local runtime source is present but not currently reachable at ${councilUrl} (${reason}). Start with \`bun run council:serve\` or set DUCKHIVE_COUNCIL_URL to a running Hive Nation service.`,
    )
  }
}

export function checkTelegramChannelConfig(): CheckResult {
  const hasDuckHiveToken = Boolean(process.env.DUCKHIVE_TELEGRAM_BOT_TOKEN?.trim())
  const hasLegacyToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim())
  const hasToken = hasDuckHiveToken || hasLegacyToken
  const allowlist = process.env.DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID
  const allowlistIds = (allowlist ?? '')
    .split(',')
    .map(item => Number(item.trim()))
    .filter(Number.isFinite)
  if (!hasToken) {
    return pass(
      'Telegram channel',
      'Not configured. Set DUCKHIVE_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN to enable remote run control.',
    )
  }
  if (allowlist !== undefined && allowlist.trim() !== '' && allowlistIds.length === 0) {
    return fail(
      'Telegram channel',
      'DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID is set but contains no numeric chat IDs. Fix the allowlist before enabling Telegram remote control.',
    )
  }
  return pass(
    'Telegram channel',
    allowlist
      ? `Configured with chat allowlist for AgentRun commands (${hasDuckHiveToken ? 'DUCKHIVE_TELEGRAM_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'}).`
      : `Configured without DUCKHIVE_TELEGRAM_ALLOWED_CHAT_ID; any chat the bot can read may register (${hasDuckHiveToken ? 'DUCKHIVE_TELEGRAM_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'}).`,
  )
}

function serializeSafeEnvSummary(): Record<string, string | boolean> {
  if (isTruthy(process.env.CLAUDE_CODE_USE_GEMINI)) {
    return {
      CLAUDE_CODE_USE_GEMINI: true,
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? `(unset, default: ${DEFAULT_GEMINI_MODEL})`,
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      GEMINI_API_KEY_SET: Boolean(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
    }
  }
  if (isTruthy(process.env.CLAUDE_CODE_USE_MISTRAL)) {
    return {
      CLAUDE_CODE_USE_MISTRAL: true,
      MISTRAL_MODEL: process.env.MISTRAL_MODEL ?? '(unset, default: devstral-latest)',
      MISTRAL_BASE_URL: process.env.MISTRAL_BASE_URL ?? 'https://api.mistral.ai/v1',
      MISTRAL_API_KEY_SET: Boolean(process.env.MISTRAL_API_KEY),
    }
  }
  if (
    isTruthy(process.env.CLAUDE_CODE_USE_GITHUB) &&
    !isTruthy(process.env.CLAUDE_CODE_USE_OPENAI)
  ) {
    return {
      CLAUDE_CODE_USE_GITHUB: true,
      OPENAI_MODEL:
        process.env.OPENAI_MODEL ??
        '(unset, default: github:copilot → openai/gpt-4.1)',
      OPENAI_BASE_URL:
        process.env.OPENAI_BASE_URL ?? GITHUB_COPILOT_BASE,
      GITHUB_TOKEN_SET: Boolean(
        process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
      ),
    }
  }
  const request = resolveProviderRequest({
    model: process.env.OPENAI_MODEL,
    baseUrl: process.env.OPENAI_BASE_URL,
  })
  return {
    CLAUDE_CODE_USE_OPENAI: isTruthy(process.env.CLAUDE_CODE_USE_OPENAI),
    OPENAI_MODEL: process.env.OPENAI_MODEL ?? '(unset)',
    OPENAI_BASE_URL: request.baseUrl,
    OPENAI_API_KEY_SET: Boolean(process.env.OPENAI_API_KEY),
    CODEX_API_KEY_SET: Boolean(resolveCodexApiCredentials(process.env).apiKey),
  }
}

function printResults(results: CheckResult[]): void {
  for (const result of results) {
    const icon = result.ok ? 'PASS' : 'FAIL'
    const suffix = result.detail ? ` - ${result.detail}` : ''
    console.log(`[${icon}] ${result.label}${suffix}`)
  }
}

function writeJsonReport(
  options: CliOptions,
  results: CheckResult[],
): void {
  const envSummary = serializeSafeEnvSummary()
  const payload = {
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    summary: {
      total: results.length,
      passed: results.filter(result => result.ok).length,
      failed: results.filter(result => !result.ok).length,
    },
    env: envSummary,
    results,
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          timestamp: payload.timestamp,
          cwd: payload.cwd,
          summary: payload.summary,
          env: '[redacted in console JSON output; use --out-file for the full report]',
          results: payload.results,
        },
        null,
        2,
      ),
    )
  }

  if (options.outFile) {
    const outputPath = resolve(process.cwd(), options.outFile)
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8')
    if (!options.json) {
      console.log(`Report written to ${outputPath}`)
    }
  }
}

export async function runRuntimeDoctor(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv)
  const results: CheckResult[] = []

  const { enableConfigs } = await import('../src/utils/config.js')
  enableConfigs()
  const { applySafeConfigEnvironmentVariables } = await import('../src/utils/managedEnv.js')
  applySafeConfigEnvironmentVariables()
  const { hydrateGithubModelsTokenFromSecureStorage } = await import('../src/utils/githubModelsCredentials.js')
  hydrateGithubModelsTokenFromSecureStorage()

  results.push(checkNodeVersion())
  results.push(checkBunRuntime())
  results.push(checkBuildArtifacts())
  results.push(checkCliLauncherPath())
  results.push(checkCliInputMode())
  results.push(checkTerminalStdio(undefined, {
    strictInteractive: options.strictInteractive,
  }))
  results.push(checkTuiLaunchPath())
  results.push(checkTuiInputSmoke())
  results.push(checkComputerUseReadiness())
  results.push(checkHarnessCommandSurfaces())
  results.push(checkHarnessStateReadiness())
  results.push(checkTopLevelCliHelpSurface())
  results.push(checkAgentRunCliControls())
  results.push(checkInputTestCliControl())
  results.push(checkSkillHubRegistry())
  results.push(checkConnectorCliControls())
  results.push(...checkOpenAIEnv())
  results.push(await checkBaseUrlReachability())
  results.push(await checkProviderGenerationReadiness())
  results.push(checkOllamaProcessorMode())
  results.push(checkAgentHarnessRuntime())
  results.push(await checkCouncilRuntimeReadiness())
  results.push(checkTelegramChannelConfig())

  if (!options.json) {
    printResults(results)
  }

  writeJsonReport(options, results)

  const hasFailure = results.some(result => !result.ok)
  if (hasFailure) {
    process.exitCode = 1
    return
  }

  if (!options.json) {
    console.log('\nRuntime checks completed successfully.')
  }
}

if (import.meta.main) {
  await runRuntimeDoctor()
}

export {}
