type SessionsSpawnOptions = {
  label?: string
  mode?: string
  runtime?: string
  task?: string
}

// Compatibility shim for older DuckHive/OpenClaude extensions that still
// import sessions_spawn. The richer subagent stack now lives elsewhere in
// the codebase; this fallback keeps legacy tools from crashing on startup.
export async function sessions_spawn(
  options: SessionsSpawnOptions,
): Promise<string> {
  const task = options.task?.trim()
  if (!task) {
    return '## Deep Analysis\nNo subagent task was provided.'
  }

  return [
    '## Deep Analysis',
    'Legacy sessions_spawn compatibility path engaged.',
    `Label: ${options.label ?? 'unnamed-task'}`,
    `Mode: ${options.mode ?? 'unknown'}`,
    `Runtime: ${options.runtime ?? 'unknown'}`,
    '',
    'The dedicated subagent runtime for this legacy call site is not wired into this fork, so DuckHive fell back to the local workspace analysis path.',
    '',
    `Requested task: ${task}`,
  ].join('\n')
}
