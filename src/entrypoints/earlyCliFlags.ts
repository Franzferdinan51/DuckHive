export function hasEarlyYoloFlag(args: readonly string[]): boolean {
  return args.some(
    arg =>
      arg === '--yolo' ||
      arg === '-y' ||
      arg === '--dangerously-skip-permissions',
  )
}

export function applyEarlyCliFlags(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (args.includes('--bare')) {
    env.CLAUDE_CODE_SIMPLE = '1'
  }

  if (hasEarlyYoloFlag(args)) {
    env.CLAUDE_CODE_YOLO = '1'
  }
}
