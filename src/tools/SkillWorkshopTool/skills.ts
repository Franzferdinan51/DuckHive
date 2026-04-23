/**
 * Skill Workshop - Skill File Operations
 *
 * Reads, writes, and manages skill files at ~/.duckhive/skills/{name}/SKILL.md
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'path';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import { scanSkillContent, assertSkillContentSafe } from './scanner.js';
import type { SkillProposal, SkillScanFinding } from './types.js';

const VALID_SKILL_NAME = /^[a-z0-9][a-z0-9_-]{1,79}$/;
const VALID_SECTION = /^[A-Za-z0-9][A-Za-z0-9 _./:-]{0,80}$/;
const SUPPORT_DIRS = new Set(['references', 'templates', 'scripts', 'assets']);

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '')
    .slice(0, 80);
}

export function assertValidSkillName(name: string): string {
  const normalized = normalizeSkillName(name);
  if (!VALID_SKILL_NAME.test(normalized)) {
    throw new Error(`invalid skill name: ${name}`);
  }
  return normalized;
}

function assertValidSection(section: string): string {
  const trimmed = section.trim();
  if (!VALID_SECTION.test(trimmed)) {
    throw new Error(`invalid section: ${section}`);
  }
  return trimmed;
}

function getSkillsRootDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'skills');
}

function skillDir(workspaceDir: string, skillName: string): string {
  const safeName = assertValidSkillName(skillName);
  const root = path.resolve(workspaceDir, 'skills');
  const dir = path.resolve(root, safeName);
  if (!dir.startsWith(`${root}${path.sep}`)) {
    throw new Error('skill path escapes workspace skills directory');
  }
  return dir;
}

function skillPath(workspaceDir: string, skillName: string): string {
  return path.join(skillDir(workspaceDir, skillName), 'SKILL.md');
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${randomUUID()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

export async function readSkill(
  workspaceDir: string,
  skillName: string,
): Promise<{ content: string; path: string } | null> {
  const sp = skillPath(workspaceDir, skillName);
  try {
    const content = await fs.readFile(sp, 'utf8');
    return { content, path: sp };
  } catch {
    return null;
  }
}

export async function writeSkill(
  workspaceDir: string,
  skillName: string,
  content: string,
): Promise<string> {
  assertSkillContentSafe(content);
  const sp = skillPath(workspaceDir, skillName);
  await atomicWrite(sp, content);
  return sp;
}

export async function skillExists(workspaceDir: string, skillName: string): Promise<boolean> {
  return pathExists(skillPath(workspaceDir, skillName));
}

export async function deleteSkill(workspaceDir: string, skillName: string): Promise<void> {
  const dir = skillDir(workspaceDir, skillName);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function listSkills(workspaceDir: string): Promise<string[]> {
  const root = path.resolve(workspaceDir, 'skills');
  try {
    const entries = await fs.readdir(root);
    return entries.filter((e) => VALID_SKILL_NAME.test(e));
  } catch {
    return [];
  }
}

export type PrepareProposalWriteResult = {
  findings: SkillScanFinding[];
  preparedContent: string;
};

export async function prepareProposalWrite(params: {
  proposal: SkillProposal;
  maxSkillBytes: number;
}): Promise<PrepareProposalWriteResult> {
  const { proposal, maxSkillBytes } = params;
  const existing = await readSkill(proposal.workspaceDir, proposal.skillName);

  let preparedContent: string;
  if (existing) {
    preparedContent = applyChangeToContent(existing.content, proposal.change);
  } else {
    if (proposal.change.kind !== 'create') {
      throw new Error('cannot apply non-create change to non-existent skill');
    }
    preparedContent = buildSkillContent(proposal);
  }

  // Truncate if needed
  if (preparedContent.length > maxSkillBytes) {
    preparedContent = preparedContent.slice(0, maxSkillBytes);
  }

  const findings = scanSkillContent(preparedContent);
  return { findings, preparedContent };
}

export function applyChangeToContent(content: string, change: SkillProposal['change']): string {
  switch (change.kind) {
    case 'create':
      return buildSkillContent({ ...({} as SkillProposal), change });
    case 'append':
      return appendSection(content, change.section, change.body);
    case 'replace':
      return content.replace(change.oldText, change.newText);
  }
}

function buildSkillContent(proposal: Pick<SkillProposal, 'skillName' | 'title' | 'reason' | 'change'>): string {
  const { skillName, title, reason, change } = proposal;
  const body = change.kind === 'create' || change.kind === 'append' ? change.body : '';

  return `---
name: ${skillName}
title: ${title}
reason: ${reason}
created: ${new Date().toISOString()}
---

# ${title}

${body}
`;
}

function appendSection(content: string, section: string, body: string): string {
  const trimmed = content.trim();
  const sectionHeader = `## ${assertValidSection(section)}`;

  // Check if section exists
  const sectionIndex = trimmed.indexOf(sectionHeader);
  if (sectionIndex !== -1) {
    // Find end of section (next ## or end of file)
    const nextSection = trimmed.indexOf('\n## ', sectionIndex + sectionHeader.length);
    const sectionEnd = nextSection === -1 ? trimmed.length : nextSection;
    const existingSection = trimmed.slice(sectionIndex, sectionEnd).trim();
    return (
      trimmed.slice(0, sectionIndex) +
      existingSection +
      '\n\n' +
      body.trim() +
      '\n' +
      trimmed.slice(sectionEnd)
    );
  }

  // Append new section
  return trimmed + '\n\n' + sectionHeader + '\n\n' + body.trim() + '\n';
}

export async function applyProposalToWorkspace(params: {
  proposal: SkillProposal;
  maxSkillBytes: number;
}): Promise<{ skillPath: string; findings: SkillScanFinding[] }> {
  const { findings, preparedContent } = await prepareProposalWrite(params);
  const sp = await writeSkill(params.proposal.workspaceDir, params.proposal.skillName, preparedContent);
  return { skillPath: sp, findings };
}
