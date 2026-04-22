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

    const onError = (e: Error) => {
      console.error('[TUI spawn error]:', e.message)
      resolve(false)
    }
    child.once('error', onError)
    child.once('spawn', () => {
      child.off('error', onError)
      child.on('exit', code => {
        console.error('[TUI exit]:', code)
        process.exit(code ?? 0)
      })
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

  console.error('[TUI] baseDir:', baseDir)
  console.error('[TUI] tuiPath:', tuiPath, '| exists:', existsSync(tuiPath))
  if (!existsSync(tuiPath)) {
    console.error('[TUI] tuiPath not found!')
    return false
  }

  console.error('[TUI] launching:', tuiPath)
  const result = await spawnAndWaitForStart(tuiPath, args, env)
  console.error('[TUI] result:', result)
  return result
}
