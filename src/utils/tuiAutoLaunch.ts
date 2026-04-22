import { existsSync } from 'fs'
import { join } from 'path'

type LaunchStandaloneTuiOptions = {
  args?: string[]
  env?: NodeJS.ProcessEnv
}

export function shouldAutoLaunchStandaloneTui(
  args: string[] = process.argv.slice(2),
): boolean {
  return (
    args.length === 0 &&
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.DUCKHIVE_NO_AUTO_TUI !== '1'
  )
}

async function spawnAndWaitForStart(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  const { spawn } = await import('child_process')

  return await new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
    })

    const onError = () => resolve(false)
    child.once('error', onError)
    child.once('spawn', () => {
      child.off('error', onError)
      child.on('exit', code => process.exit(code ?? 0))
      resolve(true)
    })
  })
}

export async function launchStandaloneTui(
  baseDir: string,
  options?: LaunchStandaloneTuiOptions,
): Promise<boolean> {
  const args = options?.args ?? []
  const env = {
    ...process.env,
    ...options?.env,
    DUCKHIVE_AUTO_TUI: '1',
  }
  const tuiPath = join(baseDir, 'tui', 'duckhive-tui')

  if (!existsSync(tuiPath)) {
    return false
  }

  // Spawn Go TUI directly - works in real terminal, skips in non-TTY
  return await spawnAndWaitForStart(tuiPath, args, env)
}
