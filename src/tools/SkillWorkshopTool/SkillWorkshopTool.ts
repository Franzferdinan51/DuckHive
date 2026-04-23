/**
 * Skill Workshop Tool
 *
 * Captures successful multi-step workflows as reusable skills.
 * Stores skills at ~/.duckhive/skills/{name}/SKILL.md
 *
 * Based on the OpenClaw skill-workshop pattern.
 */

import { z } from 'zod/v4';
import { buildTool, type ToolDef } from '../../Tool.js';
import { lazySchema } from '../../utils/lazySchema.js';
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js';
import {
  applyProposalToWorkspace,
  deleteSkill,
  listSkills,
  normalizeSkillName,
  readSkill,
} from './skills.js';
import type { SkillProposal, SkillWorkshopConfig } from './types.js';

const DEFAULT_SKILL_WORKSHOP_CONFIG: SkillWorkshopConfig = {
  enabled: true,
  autoCapture: true,
  approvalPolicy: 'pending',
  reviewMode: 'heuristic',
  reviewInterval: 15,
  reviewMinToolCalls: 8,
  reviewTimeoutMs: 45000,
  maxPending: 50,
  maxSkillBytes: 40000,
};

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['create', 'append', 'replace', 'list', 'read', 'delete', 'help'])
      .describe('The action to perform'),
    skillName: z.string().optional().describe('Name of the skill'),
    title: z.string().optional().describe('Human-readable title for the skill'),
    reason: z.string().optional().describe('Why this skill was created'),
    description: z.string().optional().describe('Description of the skill or section'),
    body: z.string().optional().describe('The skill content body text'),
    section: z.string().optional().describe('Section name to append to (for append action)'),
    oldText: z.string().optional().describe('Text to replace (for replace action)'),
    newText: z.string().optional().describe('Replacement text (for replace action)'),
    list: z.boolean().optional().describe('List all available skills'),
    read: z.string().optional().describe('Skill name to read'),
    delete: z.string().optional().describe('Skill name to delete'),
  }),
);

type InputSchema = ReturnType<typeof inputSchema>;

function getWorkspaceDir(): string {
  return getClaudeConfigHomeDir();
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildProposal(params: {
  workspaceDir: string;
  raw: z.infer<InputSchema>;
}): SkillProposal {
  const skillName = normalizeSkillName(readString(params.raw.skillName) ?? '');
  if (!skillName) {
    throw new Error('skillName required');
  }
  const now = Date.now();
  const title = readString(params.raw.title) ?? `Skill update: ${skillName}`;
  const reason = readString(params.raw.reason) ?? 'Tool-created skill update';
  const body = readString(params.raw.body);
  const description = readString(params.raw.description) ?? title;

  let change: SkillProposal['change'];
  if (params.raw.oldText !== undefined || params.raw.newText !== undefined) {
    const oldText = readString(params.raw.oldText);
    const newText = readString(params.raw.newText);
    if (!oldText || !newText) {
      throw new Error('oldText and newText required for replace');
    }
    change = { kind: 'replace', oldText, newText };
  } else if (readString(params.raw.section)) {
    if (!body) {
      throw new Error('body required');
    }
    change = {
      kind: 'append',
      section: readString(params.raw.section)!,
      body,
      description,
    };
  } else {
    if (!body) {
      throw new Error('body required for create action');
    }
    change = { kind: 'create', description, body };
  }

  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    workspaceDir: params.workspaceDir,
    skillName,
    title,
    reason,
    source: 'tool',
    status: 'pending',
    change,
  };
}

export const SkillWorkshopTool = buildTool({
  name: 'skill_workshop',
  async description() {
    return 'Captures repeatable workflows as workspace skills. Use to save, list, read, or manage skills.';
  },
  async prompt() {
    return 'Skill Workshop captures successful multi-step workflows as reusable skills. Use when a complex task goes well to save it for future reuse.';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      skill: z.string().optional(),
      skills: z.array(z.string()).optional(),
      path: z.string().optional(),
      content: z.string().optional(),
      error: z.string().optional(),
    });
  },
  isConcurrencySafe() {
    return false;
  },
  isReadOnly(input) {
    const inp = input as { action?: string };
    return inp.action === 'list' || inp.action === 'read';
  },
  async call(input, _context, _canUseTool, _parentMessage) {
    const params = input;
    const workspaceDir = getWorkspaceDir();
    const config = DEFAULT_SKILL_WORKSHOP_CONFIG;

    // Handle list action
    if (params.list || params.action === 'list') {
      const skills = await listSkills(workspaceDir);
      return {
        data: {
          success: true,
          action: 'list',
          skills,
        },
      };
    }

    // Handle read action
    const readSkillName = readString(params.read) || readString(params.skillName);
    if ((params.action === 'read' || params.action === 'info') && readSkillName) {
      const skill = await readSkill(workspaceDir, readSkillName);
      if (!skill) {
        return {
          data: {
            success: false,
            action: 'read',
            error: `Skill not found: ${readSkillName}`,
          },
        };
      }
      return {
        data: {
          success: true,
          action: 'read',
          skill: readSkillName,
          content: skill.content,
        },
      };
    }

    // Handle delete action
    const deleteSkillName = readString(params.delete) || readString(params.skillName);
    if (params.action === 'delete' && deleteSkillName) {
      try {
        await deleteSkill(workspaceDir, deleteSkillName);
        return {
          data: {
            success: true,
            action: 'delete',
            skill: deleteSkillName,
          },
        };
      } catch (err) {
        return {
          data: {
            success: false,
            action: 'delete',
            error: (err as Error).message,
          },
        };
      }
    }

    // Handle help
    if (params.action === 'help' || !params.action) {
      return {
        data: {
          success: true,
          action: 'help',
          content: `Skill Workshop Tool

Actions:
  create   - Create a new skill (requires skillName, body)
  append   - Append a section to an existing skill (requires skillName, section, body)
  replace  - Replace text in a skill (requires skillName, oldText, newText)
  list     - List all available skills
  read     - Read a skill's content
  delete   - Delete a skill

Examples:
  { action: "create", skillName: "git-pr-workflow", title: "GitHub PR Workflow", body: "1. Create branch\\n2. Make changes\\n3. Open PR" }
  { action: "append", skillName: "git-pr-workflow", section: "Tips", body: "Use 'git rebase' for clean history" }
  { action: "list" }
`,
        },
      };
    }

    // Handle create/append/replace
    try {
      const proposal = buildProposal({ workspaceDir, raw: params });

      if (config.approvalPolicy === 'auto') {
        const applied = await applyProposalToWorkspace({
          proposal: { ...proposal, status: 'applied' },
          maxSkillBytes: config.maxSkillBytes,
        });
        return {
          data: {
            success: true,
            action: 'applied',
            skill: proposal.skillName,
            path: applied.skillPath,
          },
        };
      } else {
        const applied = await applyProposalToWorkspace({
          proposal: { ...proposal, status: 'pending' },
          maxSkillBytes: config.maxSkillBytes,
        });
        return {
          data: {
            success: true,
            action: 'pending',
            skill: proposal.skillName,
            path: applied.skillPath,
          },
        };
      }
    } catch (err) {
      return {
        data: {
          success: false,
          action: params.action ?? 'unknown',
          error: (err as Error).message,
        },
      };
    }
  },
} satisfies ToolDef<InputSchema, { data: unknown }>);
