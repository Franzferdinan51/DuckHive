/**
 * Command semantics configuration for interpreting exit codes in PowerShell.
 *
 * PowerShell-native cmdlets do NOT need exit-code semantics:
 *   - Select-String (grep equivalent) exits 0 on no-match (returns $null)
 *   - Compare-Object (diff equivalent) exits 0 regardless
 *   - Test-Path exits 0 regardless (returns bool via pipeline)
 * Native cmdlets signal failure via terminating errors ($?), not exit codes.
 *
 * However, EXTERNAL executables invoked from PowerShell DO set $LASTEXITCODE,
 * and many use non-zero codes to convey information rather than failure:
 *   - grep.exe / rg.exe (Git for Windows, scoop, etc.): 1 = no match
 *   - findstr.exe (Windows native): 1 = no match
 *   - robocopy.exe (Windows native): 0-7 = success, 8+ = error (notorious!)
 *   - git.exe (Git for Windows): diff exits 1 when files differ, merge-base
 *     --is-ancestor exits 1 when false, etc.
 *
 * Without this module, PowerShellTool throws ShellError on any non-zero exit,
 * so `robocopy` reporting "files copied successfully" (exit 1) shows as an error.
 */

export type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => {
  isError: boolean
  message?: string
}

/**
 * Default semantic: treat only 0 as success, everything else as error
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message:
    exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

function predicateSemantic(falseMessage: string): CommandSemantic {
  return (exitCode, _stdout, _stderr) => ({
    isError: exitCode !== 0 && exitCode !== 1,
    message: exitCode === 1 ? falseMessage : undefined,
  })
}

const COMMAND_LOOKUP_SEMANTIC: CommandSemantic = (
  exitCode,
  _stdout,
  _stderr,
) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'Command not found' : undefined,
})

/**
 * grep / ripgrep: 0 = matches found, 1 = no matches, 2+ = error
 */
const GREP_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode >= 2,
  message: exitCode === 1 ? 'No matches found' : undefined,
})

/**
 * Command-specific semantics for external executables.
 * Keys are lowercase command names WITHOUT .exe suffix.
 *
 * Deliberately omitted:
 *   - 'diff': Ambiguous. Windows PowerShell 5.1 aliases `diff` → Compare-Object
 *     (exit 0 on differ), but PS Core / Git for Windows may resolve to diff.exe
 *     (exit 1 on differ). Cannot reliably interpret.
 *   - 'fc': Ambiguous. PowerShell aliases `fc` → Format-Custom (a native cmdlet),
 *     but `fc.exe` is the Windows file compare utility (exit 1 = files differ).
 *     Same aliasing problem as `diff`.
 *   - 'find': Ambiguous. Windows find.exe (text search) vs Unix find.exe
 *     (file search via Git for Windows) have different semantics.
 *   - 'test', '[': Not PowerShell constructs.
 *   - 'select-string', 'compare-object', 'test-path': Native cmdlets exit 0.
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // External grep/ripgrep (Git for Windows, scoop, choco)
  ['grep', GREP_SEMANTIC],
  ['rg', GREP_SEMANTIC],

  // findstr.exe: Windows native text search
  // 0 = match found, 1 = no match, 2 = error
  ['findstr', GREP_SEMANTIC],

  // robocopy.exe: Windows native robust file copy
  // Exit codes are a BITFIELD — 0-7 are success, 8+ indicates at least one failure:
  //   0 = no files copied, no mismatch, no failures (already in sync)
  //   1 = files copied successfully
  //   2 = extra files/dirs detected (no copy)
  //   4 = mismatched files/dirs detected
  //   8 = some files/dirs could not be copied (copy errors)
  //  16 = serious error (robocopy did not copy any files)
  // This is the single most common "CI failed but nothing's wrong" Windows gotcha.
  [
    'robocopy',
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 8,
      message:
        exitCode === 0
          ? 'No files copied (already in sync)'
          : exitCode >= 1 && exitCode < 8
            ? exitCode & 1
              ? 'Files copied successfully'
              : 'Robocopy completed (no errors)'
            : undefined,
    }),
  ],

  // which/type: 0=command found, 1=not found, 2+=lookup error
  ['which', COMMAND_LOOKUP_SEMANTIC],
])

/**
 * Extract the command name from a single pipeline segment.
 * Strips leading `&` / `.` call operators and `.exe` suffix, lowercases.
 */
function extractBaseCommand(segment: string): string {
  // Strip PowerShell call operators: & "cmd", . "cmd"
  // (& and . at segment start followed by whitespace invoke the next token)
  const stripped = segment.trim().replace(/^[&.]\s+/, '')
  const firstToken = stripped.split(/\s+/)[0] || ''
  // Strip surrounding quotes if command was invoked as & "grep.exe"
  const unquoted = firstToken.replace(/^["']|["']$/g, '')
  // Strip path: C:\bin\grep.exe → grep.exe, .\rg.exe → rg.exe
  const basename = unquoted.split(/[\\/]/).pop() || unquoted
  // Strip .exe suffix (Windows is case-insensitive)
  return basename.toLowerCase().replace(/\.exe$/, '')
}

/**
 * Extract the last active segment from a PowerShell command line.
 * Takes the LAST pipeline segment since that determines the exit code,
 * and strips leading call operators so the real command is visible.
 *
 * Heuristic split on `;` and `|` — may get it wrong for quoted strings or
 * complex constructs. Do NOT depend on this for security; it's only used
 * for exit-code interpretation (false negatives just fall back to default).
 */
function getLastSegment(command: string): string {
  const segments = command.split(/[;|]/).filter(s => s.trim())
  const last = segments[segments.length - 1] || command
  // Strip PowerShell call operators same as extractBaseCommand does
  return last.trim().replace(/^[&.]\s+/, '')
}

/**
 * Extract the base command name from the last pipeline segment.
 */
function heuristicallyExtractBaseCommand(command: string): string {
  return extractBaseCommand(getLastSegment(command))
}

function splitShellWords(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}

function getGitSubcommand(
  command: string,
): { subcommand: string; args: string[] } | undefined {
  const words = splitShellWords(command)
  const first = words[0]
  if (!first) return undefined

  // Handle git.exe, C:\path\to\git.exe, ./git, etc.
  const basename = (first.split(/[\\/]/).pop() || first)
    .toLowerCase()
    .replace(/\.exe$/, '')
  if (basename !== 'git') return undefined

  for (let i = 1; i < words.length; i++) {
    const word = words[i]
    if (!word) continue
    if (
      word === '-C' ||
      word === '-c' ||
      word === '--git-dir' ||
      word === '--work-tree' ||
      word === '--namespace'
    ) {
      i++
      continue
    }
    if (word.startsWith('-')) continue
    return { subcommand: word, args: words.slice(i + 1) }
  }

  return undefined
}

function getGitCommandSemantic(command: string): CommandSemantic | undefined {
  const parsed = getGitSubcommand(command)
  if (!parsed) return undefined

  if (parsed.subcommand === 'grep') {
    return GREP_SEMANTIC
  }

  // git diff always returns 1 when files differ (not an error), regardless of flags.
  if (parsed.subcommand === 'diff') {
    return (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? 'Files differ' : undefined,
    })
  }

  if (
    parsed.subcommand === 'merge-base' &&
    parsed.args.includes('--is-ancestor')
  ) {
    return predicateSemantic('Commit is not an ancestor')
  }

  if (
    parsed.subcommand === 'show-ref' &&
    parsed.args.includes('--verify') &&
    parsed.args.includes('--quiet')
  ) {
    return predicateSemantic('Ref not found')
  }

  if (
    parsed.subcommand === 'rev-parse' &&
    parsed.args.includes('--verify') &&
    parsed.args.includes('--quiet')
  ) {
    return predicateSemantic('Revision not found')
  }

  return undefined
}

function getShellPredicateCommandSemantic(
  command: string,
): CommandSemantic | undefined {
  const words = splitShellWords(command)
  if (words[0] !== 'command') return undefined
  return words.some(word => word === '-v' || word === '-V')
    ? COMMAND_LOOKUP_SEMANTIC
    : undefined
}

/**
 * Interpret command result based on semantic rules
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): {
  isError: boolean
  message?: string
} {
  // Git subcommands are unambiguous even in PowerShell because they run
  // git.exe (external), which sets $LASTEXITCODE with standard git semantics.
  // Use the last pipeline segment (same logic as base-command extraction) so
  // `foo | git diff` is interpreted as git diff, not as a generic `foo`.
  const activeCommand = getLastSegment(command)
  const gitSemantic = getGitCommandSemantic(activeCommand)
  if (gitSemantic) {
    return gitSemantic(exitCode, stdout, stderr)
  }

  const shellPredicateSemantic = getShellPredicateCommandSemantic(activeCommand)
  if (shellPredicateSemantic) {
    return shellPredicateSemantic(exitCode, stdout, stderr)
  }

  const baseCommand = heuristicallyExtractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
  return semantic(exitCode, stdout, stderr)
}
