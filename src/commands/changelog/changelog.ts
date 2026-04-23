import type { LocalCommandCall } from '../../types/command.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { findGitRoot } from '../../utils/git.js'
import { getCwd } from '../../utils/cwd.js'

interface ChangelogEntry {
  type: string
  scope?: string
  description: string
  breaking?: boolean
}

interface ChangeLogResult {
  type: 'text'
  value: string
}

function parseChangelogEntries(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  const lines = text.split('\n')

  let currentType = 'other'
  let currentScope = ''
  let currentDescription = ''
  let inBreaking = false

  for (const line of lines) {
    const trimmed = line.trim()

    const sectionMatch = trimmed.match(/^##\s+\[?([^\]]+)\]?/i)
    if (sectionMatch) {
      if (currentDescription) {
        entries.push({
          type: currentType,
          scope: currentScope || undefined,
          description: currentDescription.trim(),
          breaking: inBreaking,
        })
        currentDescription = ''
        inBreaking = false
      }
      currentType = sectionMatch[1].toLowerCase()
      currentScope = ''
      continue
    }

    if (/^###\s+BREAKING/i.test(trimmed)) {
      inBreaking = true
      continue
    }

    const bulletMatch = trimmed.match(/^-\s+\*\*([^:]+)\*\*:\s*(.*)/)
    if (bulletMatch) {
      if (currentDescription) {
        entries.push({
          type: currentType,
          scope: currentScope || undefined,
          description: currentDescription.trim(),
          breaking: inBreaking,
        })
      }
      currentScope = bulletMatch[1]
      currentDescription = bulletMatch[2]
      continue
    }

    const simpleMatch = trimmed.match(/^-\s+(.*)/)
    if (simpleMatch) {
      if (currentDescription) {
        entries.push({
          type: currentType,
          scope: currentScope || undefined,
          description: currentDescription.trim(),
          breaking: inBreaking,
        })
      }
      currentScope = ''
      currentDescription = simpleMatch[1]
      continue
    }

    if (currentDescription && trimmed.length > 0) {
      currentDescription = currentDescription + ' ' + trimmed
    }
  }

  if (currentDescription) {
    entries.push({
      type: currentType,
      scope: currentScope || undefined,
      description: currentDescription.trim(),
      breaking: inBreaking,
    })
  }

  return entries
}

function formatEntries(entries: ChangelogEntry[]): string {
  if (entries.length === 0) {
    return 'No changelog entries found.'
  }

  const lines: string[] = []
  const typeEmoji: Record<string, string> = {
    added: '[+]',
    changed: '[~]',
    deprecated: '[-]',
    removed: '[x]',
    fixed: '[*]',
    security: '[!]',
    other: '[-]',
  }

  for (const entry of entries) {
    const emoji = typeEmoji[entry.type] ?? typeEmoji.other
    const breaking = entry.breaking ? '!!! ' : ''
    const scope = entry.scope ? '[' + entry.scope + '] ' : ''
    lines.push(emoji + ' ' + breaking + scope + entry.description)
  }

  return lines.join('\n')
}

async function getPrChangelog(prNumber?: string): Promise<string | null> {
  const args = prNumber
    ? ['pr', 'view', prNumber, '--json', 'body', '--jq', '.body']
    : ['pr', 'view', '--json', 'body', '--jq', '.body']

  const { stdout } = await execFileNoThrow('gh', args, {
    cwd: findGitRoot(getCwd()) ?? undefined,
  })

  if (!stdout) return null

  const match = stdout.match(
    /<!--\s*CHANGELOG:\s*START\s*-->([\s\S]*?)<!--\s*CHANGELOG:\s*END\s*-->/i,
  )
  if (match) {
    return match[1].trim()
  }

  const startMarker = 'CHANGELOG:START'
  const endMarker = 'CHANGELOG:END'
  const startIdx = stdout.indexOf(startMarker)
  const endIdx = stdout.indexOf(endMarker)

  if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
    return stdout.substring(startIdx + startMarker.length, endIdx).trim()
  }

  return null
}

async function getChangelogFromGit(tag?: string): Promise<string | null> {
  const args = tag
    ? ['log', tag + '..HEAD', '--pretty=format:%s%n%b', '--']
    : ['log', '--pretty=format:%s%n%b', '-20', '--']

  const { stdout } = await execFileNoThrow('git', args, {
    cwd: findGitRoot(getCwd()) ?? undefined,
  })

  if (!stdout) return null

  const lines = stdout.split('\n')
  const changelogLines: string[] = []
  let inChangelog = false

  for (const line of lines) {
    if (line.includes('CHANGELOG') || line.includes('changelog')) {
      inChangelog = true
    }
    if (inChangelog) {
      changelogLines.push(line)
    }
  }

  return changelogLines.length > 0 ? changelogLines.join('\n') : null
}

export const call: LocalCommandCall = async (args: string): Promise<ChangeLogResult> => {
  const parsedArgs = args.trim().split(/\s+/).filter(Boolean)
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (const arg of parsedArgs) {
    if (arg.startsWith('--')) {
      const idx = arg.indexOf('=')
      if (idx !== -1) {
        const k = arg.substring(2, idx)
        const v = arg.substring(idx + 1)
        flags[k] = v
      } else {
        const k = arg.substring(2)
        flags[k] = true
      }
    } else {
      positional.push(arg)
    }
  }

  const showAll = flags.all === true
  const tag = typeof flags.tag === 'string' ? flags.tag : undefined
  const prArg = positional[0]

  const prChangelog = await getPrChangelog(prArg)

  if (prChangelog) {
    const entries = parseChangelogEntries(prChangelog)
    if (entries.length > 0) {
      const prefix = '[*] Changelog (PR #' + (prArg ?? 'current') + ')\n'
      return {
        type: 'text',
        value: prefix + formatEntries(entries),
      }
    }
  }

  if (showAll || tag) {
    const gitChangelog = await getChangelogFromGit(tag)
    if (gitChangelog) {
      const prefix = '[*] Changelog from ' + (tag ?? 'last 20 commits') + '\n'
      return {
        type: 'text',
        value: prefix + gitChangelog,
      }
    }
  }

  if (!prArg) {
    const currentPr = await getPrChangelog()
    if (currentPr) {
      const entries = parseChangelogEntries(currentPr)
      if (entries.length > 0) {
        return {
          type: 'text',
          value: '[*] Changelog (current PR)\n' + formatEntries(entries),
        }
      }
    }
  }

  return {
    type: 'text',
    value:
      'No changelog entries found. Make sure your PR body includes:\n<!-- CHANGELOG:START -->...<!-- CHANGELOG:END -->',
  }
}
