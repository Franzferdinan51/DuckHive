/**
 * Spawn Command - Subagent Teammate Spawning
 *
 * Provides a UI for spawning subagent teammates.
 */

import React, { useState } from 'react'
import { Box, Text } from '../../ink.js'
import { sessions_spawn } from '../../subagentSystem.js'

interface SpawnProps {
  args: string[]
  context: ToolUseContext
}

export function Spawn({ args, context }: SpawnProps) {
  const [status, setStatus] = useState<string>('Ready')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const task = args.join(' ').trim()

  const handleSpawn = async () => {
    if (!task) {
      setError('No task specified. Usage: /spawn <task description>')
      return
    }

    setStatus('Spawning subagent...')
    setError(null)

    try {
      const spawnResult = await sessions_spawn({
        label: 'spawned-agent',
        task,
        context,
      })
      setResult(spawnResult)
      setStatus('Spawned')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus('Failed')
    }
  }

  // Auto-spawn on mount if task provided
  React.useEffect(() => {
    if (task) {
      handleSpawn()
    }
  }, [])

  return (
    <Box flexDirection="column">
      <Text bold>Subagent Spawn</Text>
      <Text dimColor>Task: {task || '(none)'}</Text>
      <Text dimColor>Status: {status}</Text>
      {result && (
        <Box marginTop={1}>
          <Text>{result}</Text>
        </Box>
      )}
      {error && (
        <Box marginTop={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
    </Box>
  )
}

export default Spawn
