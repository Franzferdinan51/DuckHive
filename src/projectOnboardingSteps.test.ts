import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from './utils/cwd.js'
import { getSteps } from './projectOnboardingSteps.js'

describe('project onboarding steps', () => {
  test('workspace onboarding uses DuckHive branding', () => {
    const emptyWorkspace = mkdtempSync(join(tmpdir(), 'duckhive-onboarding-'))

    const workspace = runWithCwdOverride(emptyWorkspace, () =>
      getSteps().find(step => step.key === 'workspace'),
    )

    expect(workspace?.text).toContain('Ask DuckHive')
    expect(workspace?.text).not.toContain('Ask Claude')
  })

  test('repo instructions step distinguishes init from DUCK.md tuning', () => {
    const emptyWorkspace = mkdtempSync(join(tmpdir(), 'duckhive-onboarding-'))

    const repoInstructions = runWithCwdOverride(emptyWorkspace, () =>
      getSteps().find(step => step.key === 'claudemd'),
    )

    expect(repoInstructions?.text).toContain('AGENTS.md')
    expect(repoInstructions?.text).toContain('CLAUDE.md')
    expect(repoInstructions?.text).toContain('/instruct')
    expect(repoInstructions?.text).toContain('DUCK.md is separate')
  })
})
