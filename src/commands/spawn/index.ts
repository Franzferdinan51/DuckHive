/**
 * Spawn Command - Subagent Teammate Spawning
 *
 * Exposes the sessions_spawn functionality as a user-facing slash command.
 * Inspired by Hermes Agent's subagent spawning.
 */

import type { Command } from '../../commands.js'

const spawn = {
  type: 'local-jsx',
  name: 'spawn',
  aliases: ['subagent', 'deep-dive'],
  description: 'Spawn a subagent teammate for deep analysis',
  load: () => import('./spawn.js'),
} satisfies Command

export default spawn
