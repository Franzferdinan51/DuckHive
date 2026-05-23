import { expect, test, describe } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

// Read agent source files as strings to avoid circular dependency issues
// (importing agent definitions triggers FILE_WRITE_TOOL_NAME initialization).
function readAgentSource(filename: string): string {
  return readFileSync(
    join(import.meta.dir, filename),
    'utf8',
  )
}

function extractMaxTurns(source: string): number | null {
  const match = source.match(/maxTurns:\s*(\d+)/)
  return match ? parseInt(match[1]!, 10) : null
}

const ALL_AGENTS: Array<{ name: string; file: string; expectedMaxTurns: number | null }> = [
  { name: 'general-purpose', file: 'generalPurposeAgent.ts', expectedMaxTurns: 20 },
  { name: 'editor', file: 'editorAgent.ts', expectedMaxTurns: 10 },
  { name: 'Explore', file: 'exploreAgent.ts', expectedMaxTurns: 6 },
  { name: 'Plan', file: 'planAgent.ts', expectedMaxTurns: 10 },
  { name: 'file-picker', file: 'filePickerAgent.ts', expectedMaxTurns: 8 },
  { name: 'thinker', file: 'thinkerAgent.ts', expectedMaxTurns: 6 },
  { name: 'code-reviewer', file: 'codeReviewerAgent.ts', expectedMaxTurns: 10 },
  { name: 'verification', file: 'verificationAgent.ts', expectedMaxTurns: 30 },
  { name: 'claude-code-guide', file: 'claudeCodeGuideAgent.ts', expectedMaxTurns: 12 },
  { name: 'statusline-setup', file: 'statuslineSetup.ts', expectedMaxTurns: null },
]

describe('agent maxTurns enforcement', () => {
  for (const { name, file, expectedMaxTurns } of ALL_AGENTS) {
    test(`${name} agent maxTurns matches expected value`, () => {
      const source = readAgentSource(file)
      const maxTurns = extractMaxTurns(source)

      if (expectedMaxTurns === null) {
        // statusline-setup is a one-shot config agent — no maxTurns needed
        return
      }

      expect(maxTurns).toBe(expectedMaxTurns)
    })
  }

  test('all implementation agents have maxTurns set', () => {
    const implAgents = ['generalPurposeAgent.ts', 'editorAgent.ts']
    for (const file of implAgents) {
      const source = readAgentSource(file)
      expect(extractMaxTurns(source)).toBeGreaterThan(0)
    }
  })

  test('all read-only search agents have maxTurns backstops', () => {
    const searchAgents = ['exploreAgent.ts', 'planAgent.ts', 'filePickerAgent.ts']
    for (const file of searchAgents) {
      const source = readAgentSource(file)
      const maxTurns = extractMaxTurns(source)
      expect(maxTurns).toBeGreaterThan(0)
      expect(maxTurns).toBeLessThanOrEqual(15) // tight budget for search agents
    }
  })

  test('verification agent has enough headroom', () => {
    const source = readAgentSource('verificationAgent.ts')
    const maxTurns = extractMaxTurns(source)
    expect(maxTurns).toBeGreaterThanOrEqual(20)
  })

  test('editor agent has tight anti-stall budget', () => {
    const source = readAgentSource('editorAgent.ts')
    const maxTurns = extractMaxTurns(source)
    expect(maxTurns).toBeLessThanOrEqual(15)
  })

  test('no agent can spin forever — all have maxTurns <= 50', () => {
    for (const { file } of ALL_AGENTS) {
      const source = readAgentSource(file)
      const maxTurns = extractMaxTurns(source)
      if (maxTurns !== null) {
        expect(maxTurns).toBeLessThanOrEqual(50)
      }
    }
  })
})
