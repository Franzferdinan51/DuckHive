import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempDirs: string[] = []
const scriptPath = join(import.meta.dir, 'provider-bootstrap.ts')

function makeConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'duckhive-provider-bootstrap-'))
  tempDirs.push(dir)
  return dir
}

function runBootstrap(args: string[], configDir: string) {
  return Bun.spawnSync({
    cmd: ['bun', scriptPath, ...args],
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('provider bootstrap preserves MiniMax routing and key aliases', () => {
  const configDir = makeConfigDir()
  const result = runBootstrap(
    ['--provider', 'minimax', '--api-key', 'minimax-live', '--model', 'MiniMax-M2.7'],
    configDir,
  )

  expect(result.exitCode).toBe(0)
  const persisted = JSON.parse(
    readFileSync(join(configDir, '.duckhive-profile.json'), 'utf8'),
  )

  expect(persisted.profile).toBe('minimax')
  expect(persisted.env.OPENAI_BASE_URL).toBe('https://api.minimax.io/v1')
  expect(persisted.env.OPENAI_MODEL).toBe('MiniMax-M2.7')
  expect(persisted.env.OPENAI_API_KEY).toBe('minimax-live')
  expect(persisted.env.MINIMAX_API_KEY).toBe('minimax-live')
})

test('provider bootstrap preserves xAI routing and key aliases', () => {
  const configDir = makeConfigDir()
  const result = runBootstrap(
    ['--provider', 'xai', '--api-key', 'xai-live', '--model', 'grok-4.3'],
    configDir,
  )

  expect(result.exitCode).toBe(0)
  const persisted = JSON.parse(
    readFileSync(join(configDir, '.duckhive-profile.json'), 'utf8'),
  )

  expect(persisted.profile).toBe('xai')
  expect(persisted.env.OPENAI_BASE_URL).toBe('https://api.x.ai/v1')
  expect(persisted.env.OPENAI_MODEL).toBe('grok-4.3')
  expect(persisted.env.OPENAI_API_KEY).toBe('xai-live')
  expect(persisted.env.XAI_API_KEY).toBe('xai-live')
})

test('provider bootstrap rejects unsupported providers', () => {
  const configDir = makeConfigDir()
  const result = runBootstrap(['--provider', 'zai', '--api-key', 'zai-live'], configDir)

  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain(
    'Unsupported provider for bootstrap: zai',
  )
})
