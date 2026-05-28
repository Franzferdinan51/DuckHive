import { expect, test } from 'bun:test'
import { toIDEDisplayName } from './ide.js'

test('toIDEDisplayName recognizes quoted IDE paths with spaces', () => {
  if (process.platform !== 'win32') {
    // Windows paths like "C:\Program Files\Cursor\Cursor.exe" are not valid on macOS/Linux
    // where path.basename() treats backslashes as part of filenames, not separators.
    // The function would return the whole path as-is for non-Windows platforms.
    const result = toIDEDisplayName('"C:\\Program Files\\Cursor\\Cursor.exe" --wait')
    expect(result).toMatch(/^cursor$/i)
  } else {
    expect(toIDEDisplayName('"C:\\Program Files\\Cursor\\Cursor.exe" --wait')).toBe('Cursor')
  }
  if (process.platform !== 'win32') {
    const result = toIDEDisplayName('"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait')
    expect(result).toMatch(/^vs.?code$/i)
  } else {
    expect(
      toIDEDisplayName('"C:\\Program Files\\Microsoft VS Code\\Code.exe" --wait'),
    ).toBe('VS Code')
  }
})

test('toIDEDisplayName still recognizes exact editor aliases', () => {
  expect(toIDEDisplayName('start /wait notepad')).toBe('Notepad')
  expect(toIDEDisplayName('code --wait')).toBe('VS Code')
})
