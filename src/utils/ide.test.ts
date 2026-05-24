import { expect, test } from 'bun:test'
import { toIDEDisplayName } from './ide.js'

test('toIDEDisplayName recognizes quoted IDE paths with spaces', () => {
  expect(
    toIDEDisplayName('"C:\\Program Files\\Cursor\\Cursor.exe" --wait'),
  ).toBe('Cursor')
  expect(
    toIDEDisplayName('"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait'),
  ).toBe('VS Code')
})

test('toIDEDisplayName still recognizes exact editor aliases', () => {
  expect(toIDEDisplayName('start /wait notepad')).toBe('Notepad')
  expect(toIDEDisplayName('code --wait')).toBe('VS Code')
})
