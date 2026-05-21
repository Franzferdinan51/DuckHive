export type StartupScreenIO = {
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
}

const STARTUP_SCREEN_SKIP_COMMANDS = new Set([
  'tui',
  'goal',
  'g',
  'doctor',
  'doctor:runtime',
  'doctor-runtime',
  'runtime-doctor',
])

const GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '--debug-file',
  '--effort',
  '--fallback-model',
  '--input-format',
  '--json-schema',
  '--max-budget-usd',
  '--max-turns',
  '--model',
  '--name',
  '--output-format',
  '--output-schema',
  '--permission-mode',
  '--provider',
  '--session-id',
  '--setting-sources',
  '--settings',
  '--stdin-mode',
  '--system-prompt',
])

export function shouldPrintStartupScreen(
  args: string[],
  io: StartupScreenIO = {
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
  },
): boolean {
  if (!io.stdinIsTTY || !io.stdoutIsTTY) {
    return false
  }

  const command = getCliCommand(args)
  if (command !== undefined && STARTUP_SCREEN_SKIP_COMMANDS.has(command)) {
    return false
  }

  if (args.includes('--print') || args.includes('-p')) {
    return false
  }

  return true
}

function getCliCommand(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (arg === '--') return args[i + 1]

    if (arg.startsWith('--')) {
      const option = arg.split('=', 1)[0]
      if (!arg.includes('=') && GLOBAL_OPTIONS_WITH_VALUE.has(option)) {
        i++
      }
      continue
    }

    if (arg.startsWith('-')) continue

    return arg
  }

  return undefined
}
