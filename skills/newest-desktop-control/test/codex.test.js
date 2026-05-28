import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createCodexMcpConfig,
  getCandidateCodexComputerUseClientPaths,
} from '../src/backends/codex.js';

test('codex discovery candidates do not include machine-specific developer paths', () => {
  const candidates = getCandidateCodexComputerUseClientPaths({});

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((candidate) => candidate.includes('Codex.app')));
  assert.ok(candidates.some((candidate) => candidate.includes('.codex')));
});

test('codex discovery supports explicit client path env override', async () => {
  const oldDuckHiveClient = process.env.DUCKHIVE_CODEX_COMPUTER_USE_CLIENT;
  const oldCodexClient = process.env.CODEX_COMPUTER_USE_CLIENT;
  const dir = await mkdtemp(join(tmpdir(), 'duckhive-codex-client-'));
  const client = join(dir, 'SkyComputerUseClient');

  try {
    await writeFile(client, '#!/bin/sh\n');
    process.env.DUCKHIVE_CODEX_COMPUTER_USE_CLIENT = client;
    delete process.env.CODEX_COMPUTER_USE_CLIENT;

    const config = createCodexMcpConfig();

    assert.equal(config.available, true);
    assert.equal(config.mcpServers['computer-use'].command, client);
    assert.equal(config.mcpServers['computer-use'].cwd, dir);
  } finally {
    if (oldDuckHiveClient === undefined) {
      delete process.env.DUCKHIVE_CODEX_COMPUTER_USE_CLIENT;
    } else {
      process.env.DUCKHIVE_CODEX_COMPUTER_USE_CLIENT = oldDuckHiveClient;
    }
    if (oldCodexClient === undefined) {
      delete process.env.CODEX_COMPUTER_USE_CLIENT;
    } else {
      process.env.CODEX_COMPUTER_USE_CLIENT = oldCodexClient;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
