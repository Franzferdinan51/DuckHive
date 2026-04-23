import type { Command } from '../../types/command.js'

const swarmImpl = require('./swarm-impl.js')

export default {
  name: 'swarm',
  description: 'Execute code swarming with parallel agent execution',
  aliases: ['hive-swarm', 'code-swarm'],
  usage: '/swarm <task> [--domain=<type>] [--count=<N>] [--dry-run] [--list] [--list-domain]',
  _call: swarmImpl.call,
} satisfies Command
