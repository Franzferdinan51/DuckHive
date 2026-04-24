import { c as _c } from "react-compiler-runtime";
import React from 'react';
import Text from '../../ink/components/Text.js';
type Props = {
  /** The key or chord to display (e.g., "ctrl+o", "Enter", "↑/↓") */
  shortcut: string;
  /** The action the key performs (e.g., "expand", "select", "navigate") */
  action: string;
  /** Whether to wrap the hint in parentheses. Default: false */
  parens?: boolean;
  /** Whether to render the shortcut in bold. Default: false */
  bold?: boolean;
  /**
   * Visual weight tier — controls dim level and shortcut styling.
   * - 'primary': shortcut rendered bold, action normal weight
   * - 'secondary': shortcut normal weight, action dim
   * - 'muted': shortcut dim, action dim (lowest prominence)
   * Default: 'secondary'
   */
  weight?: 'primary' | 'secondary' | 'muted';
};

/**
 * Renders a keyboard shortcut hint like "ctrl+o to expand" or "(tab to toggle)"
 *
 * Wrap in <Text dimColor> for the common dim styling.
 *
 * @example
 * // Simple hint wrapped in dim Text
 * <Text dimColor><KeyboardShortcutHint shortcut="esc" action="cancel" /></Text>
 *
 * // With parentheses: "(ctrl+o to expand)"
 * <Text dimColor><KeyboardShortcutHint shortcut="ctrl+o" action="expand" parens /></Text>
 *
 * // With bold shortcut: "Enter to confirm" (Enter is bold)
 * <Text dimColor><KeyboardShortcutHint shortcut="Enter" action="confirm" bold /></Text>
 *
 * // With weight: secondary (default) shows shortcut normal + action dim
 * <KeyboardShortcutHint shortcut="Enter" action="confirm" weight="secondary" />
 *
 * // With weight: muted shows both dim (for rarely shown hints)
 * <KeyboardShortcutHint shortcut="?" action="help" weight="muted" />
 */
export function KeyboardShortcutHint(t0) {
  const $ = _c(13);
  const {
    shortcut,
    action,
    parens: t1,
    bold: t2,
    weight: t3
  } = t0;
  const parens = t1 === undefined ? false : t1;
  const bold = t2 === undefined ? false : t2;
  const weight = t3 === undefined ? 'secondary' : t3;

  // Determine dimness based on weight tier
  const shortcutDim = weight === 'muted';
  const actionDim = weight !== 'primary';

  let t4;
  if ($[0] !== bold || $[1] !== shortcut || $[2] !== shortcutDim) {
    const rendered = bold || shortcutDim
      ? <Text bold={bold} dimColor={shortcutDim}>{shortcut}</Text>
      : shortcut;
    t4 = rendered;
    $[0] = bold;
    $[1] = shortcut;
    $[2] = shortcutDim;
    $[3] = t4;
  } else {
    t4 = $[3];
  }
  const shortcutText = t4;

  let t5;
  if ($[4] !== actionDim || $[5] !== shortcutText || $[6] !== action) {
    const actionText = actionDim
      ? <Text dimColor={true}>{action}</Text>
      : action;
    t5 = <>{shortcutText} to {actionText}</>;
    $[4] = actionDim;
    $[5] = shortcutText;
    $[6] = action;
    $[7] = t5;
  } else {
    t5 = $[7];
  }
  const hintText = t5;

  if (parens) {
    let t6;
    if ($[8] !== hintText) {
      t6 = <Text>({hintText})</Text>;
      $[8] = hintText;
      $[9] = t6;
    } else {
      t6 = $[9];
    }
    return t6;
  }
  return hintText;
}