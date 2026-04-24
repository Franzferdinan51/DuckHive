/**
 * mmx subcommand implementation
 * Proxies all arguments to the mmx CLI (MiniMax AI Platform)
 */
import type { LocalCommandCall } from '../../types/command.js'
import { runMmxCommand } from './index.js'

export function parseMmxArgs(args: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const ch of args.trim()) {
    if (escaped) {
      current += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  // Only append trailing backslash if we actually escaped a character
  if (escaped) current += '\\'
  if (current) out.push(current)
  return out
}

export const call: LocalCommandCall = async (args: string) => {
  const parsedArgs = args.trim() ? parseMmxArgs(args) : []
  const mmxArgs = ['--non-interactive', ...parsedArgs]

  if (mmxArgs.length <= 1) {
    return {
      type: 'text',
      value: `🦆 DuckHive MiniMax Integration

/mmx text chat --message "Hello"     Chat with MiniMax
/mmx image "A cyberpunk cat"         Generate image
/mmx speech synthesize --text "Hi"  Text-to-speech
/mmx music generate --prompt "Jazz"  Generate music
/mmx video generate --prompt "Ocean" Generate video
/mmx vision ./photo.jpg             Analyze image
/mmx search "AI news"               Web search
/mmx quota                           Check usage quota

Run /mmx <subcommand> --help for details.`,
    }
  }

  try {
    await runMmxCommand(mmxArgs)
    return { type: 'text', value: '' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { type: 'text', value: `Error: ${msg}` }
  }
}
