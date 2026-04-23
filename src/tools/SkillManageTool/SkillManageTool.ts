/**
 * Skill Manager Tool - Agent-Driven Skill Creation
 *
 * Allows the DuckHive agent to create, update, and delete skills
 * based on successful approaches, turning experience into reusable
 * procedural knowledge.
 *
 * Inspired by Hermes Agent's skill_manager_tool.py
 */

import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'fs'
import { join, resolve } from 'path'

const SKILLS_DIR = resolve(process.env.HOME ?? '~', '.duckhive/skills')

function ensureSkillsDir() {
  mkdirSync(SKILLS_DIR, { recursive: true })
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['create', 'edit', 'patch', 'delete', 'list']).describe('Skill action'),
    name: z.string().optional().describe('Skill name (for create/edit/patch/delete)'),
    content: z.string().optional().describe('Skill content (for create/edit)'),
    description: z.string().optional().describe('Skill description (for create)'),
    file: z.string().optional().describe('File to patch'),
    old_text: z.string().optional().describe('Text to find for patch'),
    new_text: z.string().optional().describe('Text to replace with for patch'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

function getSkillsDir(): string {
  ensureSkillsDir()
  return SKILLS_DIR
}

function listUserSkills(): Array<{ name: string; path: string; description: string }> {
  const skills: Array<{ name: string; path: string; description: string }> = []
  const dir = getSkillsDir()

  if (!existsSync(dir)) return skills

  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue
      const skillPath = join(dir, entry)
      const skillMdPath = join(skillPath, 'SKILL.md')

      if (existsSync(skillMdPath)) {
        try {
          const content = readFileSync(skillMdPath, 'utf8')
          // Extract description from frontmatter or first heading
          const descMatch = content.match(/description:\s*(.+)/i) ||
            content.match(/^#\s+(.+)/m)
          const description = descMatch ? descMatch[1]!.trim() : ''
          skills.push({ name: entry, path: skillMdPath, description })
        } catch {
          skills.push({ name: entry, path: skillMdPath, description: '' })
        }
      }
    }
  } catch {
    // Directory might be empty/inaccessible
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

function createSkill(
  name: string,
  description: string,
  content: string,
): { success: boolean; path?: string; error?: string } {
  if (!name || !content) {
    return { success: false, error: 'name and content are required' }
  }

  // Sanitize name for filesystem
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')

  const skillDir = join(getSkillsDir(), safeName)
  const skillMdPath = join(skillDir, 'SKILL.md')

  try {
    // Create directory structure
    mkdirSync(skillDir, { recursive: true })
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    mkdirSync(join(skillDir, 'templates'), { recursive: true })
    mkdirSync(join(skillDir, 'scripts'), { recursive: true })

    // Build skill content with frontmatter
    const frontmatter = `---
name: ${safeName}
description: ${description || 'A DuckHive skill'}
---

`
    const fullContent = frontmatter + (content || '# ' + safeName + '\n\nDescribe this skill here...')

    writeFileSync(skillMdPath, fullContent, 'utf8')
    return { success: true, path: skillMdPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function editSkill(
  name: string,
  content: string,
): { success: boolean; path?: string; error?: string } {
  if (!name || !content) {
    return { success: false, error: 'name and content are required' }
  }

  const skillMdPath = join(getSkillsDir(), name, 'SKILL.md')

  if (!existsSync(skillMdPath)) {
    return { success: false, error: `Skill "${name}" not found` }
  }

  try {
    writeFileSync(skillMdPath, content, 'utf8')
    return { success: true, path: skillMdPath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function patchSkill(
  name: string,
  file: string,
  old_text: string,
  new_text: string,
): { success: boolean; path?: string; error?: string } {
  if (!name || !old_text || !new_text) {
    return { success: false, error: 'name, old_text, and new_text are required' }
  }

  const filePath = file
    ? join(getSkillsDir(), name, file)
    : join(getSkillsDir(), name, 'SKILL.md')

  if (!existsSync(filePath)) {
    return { success: false, error: `File not found: ${file || 'SKILL.md'}` }
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    if (!content.includes(old_text)) {
      return { success: false, error: 'old_text not found in file' }
    }
    const newContent = content.replace(old_text, new_text)
    writeFileSync(filePath, newContent, 'utf8')
    return { success: true, path: filePath }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

function deleteSkill(
  name: string,
): { success: boolean; error?: string } {
  if (!name) {
    return { success: false, error: 'name is required' }
  }

  const skillDir = join(getSkillsDir(), name)

  if (!existsSync(skillDir)) {
    return { success: false, error: `Skill "${name}" not found` }
  }

  try {
    rmSync(skillDir, { recursive: true })
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export const SkillManageTool = buildTool({
  name: 'skill_manage',
  async description() {
    return 'Create, update, and delete DuckHive skills — turn successful approaches into reusable procedural knowledge.'
  },
  async prompt() {
    return 'Skill management — create new skills from successful approaches, edit existing skills, or delete skills you no longer need. Skills capture how to do specific types of tasks.'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema() {
    return z.object({
      success: z.boolean(),
      action: z.string(),
      skill: z.string().optional(),
      skills: z.array(z.object({
        name: z.string(),
        path: z.string(),
        description: z.string(),
      })).optional(),
      path: z.string().optional(),
      error: z.string().optional(),
    })
  },
  isConcurrencySafe() {
    return false // Writes to filesystem
  },
  isReadOnly(input) {
    return input.action === 'list'
  },
  async call(input, _context, _canUseTool, _parentMessage) {
    const { action, name, content, description, file, old_text, new_text } = input

    switch (action) {
      case 'create': {
        const result = createSkill(name || '', description || '', content || '')
        return {
          data: {
            success: result.success,
            action,
            skill: name,
            path: result.path,
            error: result.error,
          },
        }
      }

      case 'edit': {
        const result = editSkill(name || '', content || '')
        return {
          data: {
            success: result.success,
            action,
            skill: name,
            path: result.path,
            error: result.error,
          },
        }
      }

      case 'patch': {
        const result = patchSkill(name || '', file || '', old_text || '', new_text || '')
        return {
          data: {
            success: result.success,
            action,
            skill: name,
            path: result.path,
            error: result.error,
          },
        }
      }

      case 'delete': {
        const result = deleteSkill(name || '')
        return {
          data: {
            success: result.success,
            action,
            skill: name,
            error: result.error,
          },
        }
      }

      case 'list': {
        const skills = listUserSkills()
        return {
          data: {
            success: true,
            action,
            skills,
          },
        }
      }

      default:
        return {
          data: {
            success: false,
            action: action || 'unknown',
            error: `Unknown action: ${action}`,
          },
        }
    }
  },
} satisfies ToolDef<InputSchema, { data: any }>)
