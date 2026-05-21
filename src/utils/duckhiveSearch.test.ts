import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setClaudeConfigHomeDirForTesting } from './envUtils.js'
import {
  applyDuckHiveSearchPreferenceToEnv,
  getConfiguredDuckHiveSearchProvider,
  getDuckHiveSearchConfigPath,
  normalizeDuckHiveSearchProvider,
  readDuckHiveSearchSettingsSync,
  setDuckHiveSearchPreferenceSync,
} from './duckhiveSearch.js'

let tempDir: string | undefined

afterEach(() => {
  setClaudeConfigHomeDirForTesting(undefined)
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

test('normalizes supported search provider aliases', () => {
  expect(normalizeDuckHiveSearchProvider('mmx')).toBe('minimax')
  expect(normalizeDuckHiveSearchProvider('minimax-cli')).toBe('minimax')
  expect(normalizeDuckHiveSearchProvider('searx')).toBe('searxng')
  expect(normalizeDuckHiveSearchProvider('duckduckgo')).toBe('ddg')
  expect(normalizeDuckHiveSearchProvider('tavily')).toBe('tavily')
})

test('defaults search provider to auto', () => {
  expect(getConfiguredDuckHiveSearchProvider({})).toBe('auto')
})

test('uses DuckHive config home for the default search settings path', () => {
  setClaudeConfigHomeDirForTesting('C:/DuckHive')
  expect(getDuckHiveSearchConfigPath()).toBe(join('C:/DuckHive', 'config.json'))
})

test('persists search preference without discarding other config', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'duckhive-search-'))
  const configPath = join(tempDir, 'config.json')

  writeFileSync(
    configPath,
    JSON.stringify({ providers: { default: 'minimax' } }, null, 2),
  )

  setDuckHiveSearchPreferenceSync(
    'searxng',
    { searxngUrl: 'http://localhost:8080/search' },
    configPath,
  )

  const saved = readDuckHiveSearchSettingsSync(configPath)
  expect(saved.providers).toEqual({ default: 'minimax' })
  expect(saved.search).toEqual({
    provider: 'searxng',
    searxngUrl: 'http://localhost:8080/search',
  })
})

test('persists provider API keys in DuckHive config', () => {
  tempDir = mkdtempSync(join(tmpdir(), 'duckhive-search-'))
  const configPath = join(tempDir, 'config.json')

  setDuckHiveSearchPreferenceSync(
    'tavily',
    { apiKey: 'tvly-test-key' },
    configPath,
  )

  const saved = readDuckHiveSearchSettingsSync(configPath)
  expect(saved.search).toEqual({
    provider: 'tavily',
    apiKeys: {
      tavily: 'tvly-test-key',
    },
  })
})

test('applies searxng env including local endpoint guard overrides', () => {
  const env: NodeJS.ProcessEnv = {}

  applyDuckHiveSearchPreferenceToEnv(
    {
      search: {
        provider: 'searxng',
        searxngUrl: 'http://localhost:8080/search',
      },
    },
    env,
  )

  expect(env.WEB_SEARCH_PROVIDER).toBe('searxng')
  expect(env.WEB_PROVIDER).toBe('searxng')
  expect(env.WEB_SEARCH_API).toBe('http://localhost:8080/search')
  expect(env.WEB_CUSTOM_ALLOW_HTTP).toBe('true')
  expect(env.WEB_CUSTOM_ALLOW_PRIVATE).toBe('true')
})

test('applies persisted keyed-provider credentials into runtime env', () => {
  const env: NodeJS.ProcessEnv = {}

  applyDuckHiveSearchPreferenceToEnv(
    {
      search: {
        provider: 'tavily',
        apiKeys: {
          tavily: 'tvly-test-key',
        },
      },
    },
    env,
  )

  expect(env.WEB_SEARCH_PROVIDER).toBe('tavily')
  expect(env.TAVILY_API_KEY).toBe('tvly-test-key')
})
