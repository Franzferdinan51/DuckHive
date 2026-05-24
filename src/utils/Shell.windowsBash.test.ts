import { existsSync } from 'fs'
import { expect, test } from 'bun:test'
import { exec } from './Shell.js'

test('windows bash spills moderately large output to disk', async () => {
  if (process.platform !== 'win32') {
    return
  }

  const ac = new AbortController()
  const shell = await exec("printf '%*s' 100000 '' | tr ' ' x", ac.signal, 'bash')
  const result = await shell.result

  expect(result.outputFilePath).toBeDefined()
  expect(result.outputFileSize).toBeGreaterThan(30_000)
  expect(result.stdout).toContain('Output truncated')
  expect(result.outputFilePath && existsSync(result.outputFilePath)).toBe(true)

  shell.cleanup()
})
