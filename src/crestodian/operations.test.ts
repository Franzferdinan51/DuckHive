import { describe, expect, it } from 'bun:test'
import {
  executeDuckCustodianOperation,
  parseDuckCustodianOperation,
} from './operations.js'

describe('parseDuckCustodianOperation', () => {
  it('parses setup workspace with an optional model', () => {
    expect(
      parseDuckCustodianOperation(
        'setup workspace C:\\workspace model minimax/m1',
      ),
    ).toEqual({
      kind: 'setup-workspace',
      workspace: 'c:\\workspace',
      model: 'minimax/m1',
    })
  })

  it('parses plain setup without workspace arguments', () => {
    expect(parseDuckCustodianOperation('setup')).toEqual({ kind: 'setup' })
  })

  it('parses gateway restart distinctly from gateway status', () => {
    expect(parseDuckCustodianOperation('gateway')).toEqual({
      kind: 'gateway-status',
    })
    expect(parseDuckCustodianOperation('gateway restart')).toEqual({
      kind: 'gateway-restart',
    })
  })

  it('parses openclaw aliases to duckcustodian operations', () => {
    expect(parseDuckCustodianOperation('openclaw-status')).toEqual({
      kind: 'duck-status',
    })
    expect(parseDuckCustodianOperation('openclaw-restart')).toEqual({
      kind: 'duck-restart',
    })
  })
})

describe('executeDuckCustodianOperation', () => {
  const baseDeps = {
    loadOverview: async () => ({}) as never,
    formatOverview: () => 'overview',
  }

  it('returns live gateway status text from wired deps', async () => {
    const result = await executeDuckCustodianOperation(
      { kind: 'gateway-status' },
      {
        ...baseDeps,
        checkGateway: async () => ({
          reachable: true,
          version: 'background socket active',
        }),
      },
      { approved: true },
    )

    expect(result.applied).toBe(false)
    expect(result.message).toContain('DuckHive gateway reachable')
    expect(result.message).toContain('[ok]')
    expect(result.message).toContain('background socket active')
    expect(/[^\x00-\x7F]/.test(result.message)).toBe(false)
  })

  it('returns ASCII-safe health check output', async () => {
    const result = await executeDuckCustodianOperation(
      { kind: 'health' },
      {
        ...baseDeps,
        checkMmx: async () => ({ found: true, command: 'mmx', version: '1.0.0' }),
        checkLmStudio: async () => ({ found: false, models: [] }),
        checkOpenClaw: async () => ({ reachable: false, error: 'offline' }),
      },
      { approved: true },
    )

    expect(result.applied).toBe(false)
    expect(result.message).toContain('mmx: [ok] 1.0.0')
    expect(result.message).toContain('LM Studio: [fail] not reachable')
    expect(result.message).toContain('OpenClaw: [fail] not reachable')
    expect(/[^\x00-\x7F]/.test(result.message)).toBe(false)
  })

  it('requires approval before applying persistent setup-workspace operations', async () => {
    const result = await executeDuckCustodianOperation(
      { kind: 'setup-workspace', workspace: 'c:\\workspace', model: 'gpt-5' },
      {
        ...baseDeps,
        runSetup: async () => ({ ok: true, message: 'configured' }),
      },
      { approved: false },
    )

    expect(result.applied).toBe(false)
    expect(result.message).toContain('Requires approval')
    expect(result.message).toContain('Setup workspace: c:\\workspace, model: gpt-5')
  })
})
