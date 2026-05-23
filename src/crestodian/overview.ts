/**
 * DuckCustodian Overview — system state snapshot for diagnostics.
 * Combines config validity, tool probes, model availability, and memory stats.
 */
import { getGlobalConfig } from '../utils/config.js';
import { getClaudeConfigHomeDir } from '../utils/envUtils.js';
import {
  probeLmStudio,
  probeMmx,
} from './probes.js';

export type DuckCustodianOverview = {
  duckhive: {
    configPath: string;
    configValid: boolean;
    configErrors: string[];
    version: string;
  };
  tools: {
    mmx: { found: boolean; version?: string; error?: string };
    lmStudio: { found: boolean; modelCount: number; models: string[]; error?: string };
    openClawNative: boolean;
  };
  memory: {
    memoryDir: string;
    lessonsPath: string;
  };
  workspace: {
    cwd: string;
  };
  audit: {
    path: string;
  };
};

function shorten(s: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return home ? s.replace(home, '~') : s;
}

export async function loadDuckCustodianOverview(): Promise<DuckCustodianOverview> {
  const [mmx, lmStudio] = await Promise.all([
    probeMmx().catch((e) => ({ found: false, command: 'mmx', error: String(e) })),
    probeLmStudio().catch((e) => ({ found: false, models: [], error: String(e) })),
  ]);

  let configValid = true;
  let configErrors: string[] = [];
  try {
    getGlobalConfig();
  } catch (e) {
    configValid = false;
    configErrors = [String(e)];
  }

  const configPath = getClaudeConfigHomeDir();
  const memoryDir = `${configPath}/memory`;
  const lessonsPath = `${configPath}/LESSONS.md`;

  return {
    duckhive: {
      configPath: shorten(configPath),
      configValid,
      configErrors,
      version: '1.0.0 (DuckHive)',
    },
    tools: {
      mmx: { found: mmx.found, version: (mmx as { version?: string }).version, error: mmx.error },
      lmStudio: {
        found: lmStudio.found,
        modelCount: lmStudio.models.length,
        models: lmStudio.models.slice(0, 5),
        error: lmStudio.error,
      },
      openClawNative: true,
    },
    memory: {
      memoryDir: shorten(memoryDir),
      lessonsPath: shorten(lessonsPath),
    },
    workspace: {
      cwd: shorten(process.cwd()),
    },
    audit: {
      path: shorten(`${configPath}/audit/duckcustodian.jsonl`),
    },
  };
}

export function formatDuckCustodianOverview(o: DuckCustodianOverview): string {
  const status = (cond: boolean, ok: string, fail: string) => (cond ? `[ok] ${ok}` : `[fail] ${fail}`);

  const lines = [
    'DuckCustodian - DuckHive System Status',
    '-'.repeat(46),
    `Config: ${status(o.duckhive.configValid, 'valid', 'INVALID')}`,
    o.duckhive.configErrors.length > 0
      ? `Errors: ${o.duckhive.configErrors.join(', ')}`
      : null,
    `Config: ${o.duckhive.configPath}`,
    '',
    'Tools',
    `  mmx:         ${status(o.tools.mmx.found, o.tools.mmx.version ?? 'found', 'not found')}`,
    `  LM Studio:    ${status(o.tools.lmStudio.found, `${o.tools.lmStudio.modelCount} models`, 'not reachable')}`,
    o.tools.lmStudio.found
      ? `    models: ${o.tools.lmStudio.models.join(', ')}${o.tools.lmStudio.modelCount > 5 ? '...' : ''}`
      : null,
    `  OpenClaw features: ${status(true, 'native (DuckHive)', 'native (DuckHive)')}`,
    '',
    'Memory',
    `  Memory:  ${o.memory.memoryDir}`,
    `  Lessons: ${o.memory.lessonsPath}`,
    '',
    'Workspace',
    `  CWD:     ${o.workspace.cwd}`,
    '',
    'Audit',
    `  Log:     ${o.audit.path}`,
    '-'.repeat(46),
    '',
    'Commands: status | health | doctor | doctor fix | mmx-status | lmstudio-status',
    '          memory-stats | lessons | audit | inject-memory <text>',
    'Ops:      openclaw-status | openclaw-restart',
  ].filter(Boolean);

  return lines.join('\n');
}
