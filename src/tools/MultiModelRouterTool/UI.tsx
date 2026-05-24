import React from 'react';
import { Text } from '../../ink.js';
import type { Input } from './MultiModelRouterTool.js';

const ACTION_LABELS: Record<string, string> = {
  route: 'Routing task to best model',
  list: 'Listing available models',
  compare: 'Comparing models',
};

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.action) return null;
  const label = ACTION_LABELS[input.action] ?? input.action;

  let detail = '';
  if (input.action === 'route' && input.task) {
    detail = `: ${input.task.slice(0, 60)}${input.task.length > 60 ? '…' : ''}`;
  }

  return <Text dimColor>{label}{detail}</Text>;
}
