import { expect, test } from 'bun:test'
import { createBashShellProvider } from './bashProvider.js'

test('bash provider stays attached on Windows so stdout remains readable', async () => {
  const provider = await createBashShellProvider('/bin/bash', { skipSnapshot: true })
  if (process.platform === 'win32') {
    expect(provider.detached).toBe(false)
  } else {
    expect(provider.detached).toBe(true)
  }
})
