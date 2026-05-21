/**
 * DuckHive Evaluation Runner inspired by OpenClaw-style operational checks.
 */
import type { LocalCommandCall } from '../../types/command.js'
import { bold } from '../../components/styles.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'

const DEFAULT_EVAL_TESTS = [
  'src/tools/WebSearchTool/WebSearchTool.test.ts',
  'src/tools/BashTool/commandSemantics.test.ts',
  'src/constants/promptIdentity.test.ts',
]

function truncateOutput(value: string, maxChars = 4000): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, maxChars)}\n... output truncated ...`
}

export const call: LocalCommandCall = async (args: string) => {
  const isVerbose = args.includes('--verbose') || args.includes('-v')
  const result = await execFileNoThrow('bun', ['test', ...DEFAULT_EVAL_TESTS], {
    timeout: 120_000,
    preserveOutputOnError: true,
  })

  const lines = [
    bold('DuckHive Evaluation Runner'),
    `Command: bun test ${DEFAULT_EVAL_TESTS.join(' ')}`,
    '',
    result.code === 0
      ? 'PASS Focused evaluations passed.'
      : `FAIL Focused evaluations exited with code ${result.code}.`,
  ]

  if (result.error) {
    lines.push(`Error: ${result.error}`)
  }

  if (isVerbose || result.code !== 0) {
    const output = [result.stdout.trim(), result.stderr.trim()]
      .filter(Boolean)
      .join('\n')
    if (output) {
      lines.push('', truncateOutput(output))
    }
  }

  return {
    type: 'text',
    value: lines.join('\n'),
  }
}
