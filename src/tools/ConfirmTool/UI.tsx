import React from 'react';
import { Text } from '../../ink.js';
import type { Input } from './ConfirmTool.js';

const ACTION_LABELS: Record<string, string> = {
  confirm: 'Confirming',
  choose: 'Choosing from options',
  input: 'Prompting for input',
  filter: 'Filtering list',
};

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.action) return null;
  const label = ACTION_LABELS[input.action] ?? input.action;

  let detail = '';
  if (input.message) {
    detail = `: ${input.message.slice(0, 60)}${input.message.length > 60 ? '…' : ''}`;
  }

  return <Text dimColor>{label}{detail}</Text>;
}
