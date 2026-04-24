/**
 * DuckHive mmx command — MiniMax CLI integration
 */
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

function findMmx(): string {
  if (process.env.MMX_BIN) return process.env.MMX_BIN
  const executable = process.platform === 'win32' ? 'mmx.cmd' : 'mmx'
  const locations = [
    resolve(process.env.HOME ?? '~', '.npm-global/bin', executable),
    resolve(process.env.LOCALAPPDATA ?? '', 'Programs', 'npm', executable),
    `/usr/local/bin/${executable}`,
    `/usr/bin/${executable}`,
  ]
  for (const loc of locations) {
    if (existsSync(loc)) return loc
  }
  return executable
}

const MMX_BIN = findMmx()

export async function runMmxCommand(args: string[], timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    const mmx = spawn(MMX_BIN, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    const timer = setTimeout(() => {
      mmx.kill('SIGKILL')
      reject(new Error(`mmx timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    mmx.on('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`mmx exited with code ${code}`))
    })
    mmx.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`mmx failed to start: ${err.message}`))
    })
  })
}

export default {
  type: 'local' as const,
  name: 'mmx',
  description: 'MiniMax AI Platform — text, image, speech, music, video, vision, search',
  aliases: ['minimax'],
  supportsNonInteractive: true,
  load() {
    return import('./mmx-impl.js')
  },
}
