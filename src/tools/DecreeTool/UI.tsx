import React from 'react';
import { Text } from '../../ink.js';
import type { Input } from './DecreeTool.js';

const ACTION_LABELS: Record<string, string> = {
  check: 'Checking decree',
  enforce: 'Enforcing decree',
  list: 'Listing decrees',
  issue: 'Issuing decree',
  revoke: 'Revoking decree',
};

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.action) return null;
  const label = ACTION_LABELS[input.action] ?? input.action;

  let detail = '';
  if (input.action === 'check' && input.tool) {
    detail = ` for ${input.tool}`;
  } else if (input.action === 'check' && input.command) {
    detail = ` for command: ${input.command}`;
  } else if ((input.action === 'issue' || input.action === 'revoke') && input.title) {
    detail = `: ${input.title}`;
  }

  return <Text dimColor>{label}{detail}</Text>;
}
