import React from 'react';
import { Text } from '../../ink.js';
import type { Input } from './AndroidTool.js';

const ACTION_LABELS: Record<string, string> = {
  devices: 'Listing Android devices',
  screenshot: 'Taking screenshot',
  screenshot_pull: 'Taking screenshot and pulling to disk',
  tap: 'Tapping on device',
  swipe: 'Swiping on device',
  type: 'Typing text on device',
  launch: 'Launching app',
  battery: 'Checking battery status',
  shell: 'Running shell command',
};

export function renderToolUseMessage(input: Partial<Input>): React.ReactNode {
  if (!input.action) return null;
  const label = ACTION_LABELS[input.action] ?? `Android: ${input.action}`;

  let detail = '';
  if (input.action === 'tap' && input.x !== undefined && input.y !== undefined) {
    detail = ` at (${input.x}, ${input.y})`;
  } else if (input.action === 'swipe' && input.direction) {
    detail = ` ${input.direction}`;
  } else if (input.action === 'type' && input.text) {
    detail = ` "${input.text.slice(0, 40)}${input.text.length > 40 ? '…' : ''}"`;
  } else if (input.action === 'launch' && input.package) {
    detail = ` ${input.package}`;
  } else if (input.action === 'shell' && input.command) {
    detail = `: ${input.command.slice(0, 60)}${input.command.length > 60 ? '…' : ''}`;
  }

  return <Text dimColor>{label}{detail}</Text>;
}
