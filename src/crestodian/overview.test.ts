import { describe, expect, test } from 'bun:test'
import { formatDuckCustodianOverview, type DuckCustodianOverview } from './overview.js'

describe('formatDuckCustodianOverview', () => {
  test('renders ASCII-safe terminal status output', () => {
    const overview: DuckCustodianOverview = {
      duckhive: {
        version: '0.12.0',
        configPath: 'C:/DuckHive/config.json',
        configValid: true,
        configErrors: [],
      },
      tools: {
        mmx: { found: true, version: '1.0.0' },
        lmStudio: { found: true, modelCount: 2, models: ['model-a', 'model-b'] },
        openClawNative: true,
      },
      memory: {
        memoryDir: 'C:/DuckHive/memory',
        lessonsPath: 'C:/DuckHive/LESSONS.md',
      },
      workspace: {
        cwd: 'C:/repo',
      },
      audit: {
        path: 'C:/DuckHive/audit/duckcustodian.jsonl',
      },
    }

    const output = formatDuckCustodianOverview(overview)

    expect(output).toContain('DuckCustodian - DuckHive System Status')
    expect(output).toContain('Config: [ok] valid')
    expect(output).toContain('OpenClaw features: [ok] native (DuckHive)')
    expect(/[^\x00-\x7F]/.test(output)).toBe(false)
  })
})
