import { expect, test } from 'bun:test'
import { classifyGuiEditor } from './editor.js'

test('classifyGuiEditor recognizes quoted editor paths with spaces', () => {
  expect(
    classifyGuiEditor('"C:\\Program Files\\Notepad++\\notepad++.exe" --wait'),
  ).toBe('notepad++')
})

test('classifyGuiEditor still recognizes plain GUI editor commands', () => {
  expect(classifyGuiEditor('code --wait')).toBe('code')
})
