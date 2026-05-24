import React from 'react';
import { Text } from '../../ink.js';
import type { Input } from './ShadowGitTool.js';

const ACTION_LABELS: Record<string, string> = {
  checkpoint: 'Creating shadow checkpoint',
  list: 'Listing shadow checkpoints',
  restore: 'Restoring shadow checkpoint',
  diff: 'Showing shadow diff',
};

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.action) return null;
  const label = ACTION_LABELS[input.action] ?? `Shadow: ${input.action}`;

  let detail = '';
  if (input.action === 'checkpoint' && input.message) {
    detail = `: ${input.message.slice(0, 50)}${input.message.length > 50 ? '…' : ''}`;
  } else if (input.action === 'restore' && input.checkpointId) {
    detail = ` ${input.checkpointId.slice(0, 12)}`;
  }

  return <Text dimColor>{label}{detail}</Text>;
}
