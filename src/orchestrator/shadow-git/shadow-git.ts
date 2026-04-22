// @ts-nocheck
/**
 * Shadow Git Checkpointing — Gemini CLI inspired safety net
 * Automatically creates Git snapshots BEFORE any file modification.
 * Stored in ~/.config/openclaude/shadow/ — separate from project Git.
 */
import { execSync, existsSync, mkdirSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'

export interface CheckpointRef {
  id: string
  timestamp: number
  message: string
  files: string[]
  commitHash: string
  projectPath: string
}

export class ShadowGit {
  private shadowDir: string
  private projectPath: string
  private initialized: boolean = false

  constructor(projectPath: string = process.cwd()) {
    const shadowBase = resolve(homedir(), '.config/openclaude/shadow')
    this.projectPath = resolve(projectPath)
    this.shadowDir = resolve(shadowBase, this.hashPath(projectPath))
    mkdirSync(this.shadowDir, { recursive: true })
  }

  /** Initialize shadow repo if not already done */
  init(): boolean {
    if (this.initialized) return true
    try {
      if (!existsSync(join(this.shadowDir, '.git'))) {
        execSync('git init', { cwd: this.shadowDir, stdio: 'ignore' })
        execSync('git config user.email "duckhive@shadow"', { cwd: this.shadowDir, stdio: 'ignore' })
        execSync('git config user.name "DuckHive Shadow"', { cwd: this.shadowDir, stdio: 'ignore' })
      }
      this.initialized = true
      return true
    } catch {
      return false
    }
  }

  /** Create a checkpoint BEFORE file modification */
  checkpoint(message: string, files?: string[]): CheckpointRef | null {
    if (!this.init()) return null
    try {
      const timestamp = Date.now()
      const id = `ckpt_${timestamp}`
      const fileList: string[] = files ?? this.getChangedFiles()

      // Copy files to shadow repo with timestamp prefix
      for (const file of fileList) {
        const src = resolve(this.projectPath, file)
        if (existsSync(src)) {
          const destDir = resolve(this.shadowDir, 'files', id)
          mkdirSync(destDir, { recursive: true })
          execSync(`cp -r "${src}" "${resolve(destDir, file)}"`, { stdio: 'ignore' })
        }
      }

      // Stage and commit
      execSync('git add -A', { cwd: this.shadowDir, stdio: 'ignore' })
      try {
        execSync(`git commit -m "${message} [${id}]" --allow-empty`, { cwd: this.shadowDir, stdio: 'ignore' })
      } catch { /* empty commit ok */ }
      const commitHash = execSync('git rev-parse HEAD', { cwd: this.shadowDir, encoding: 'utf8', stdio: 'pipe' }).trim()

      return { id, timestamp, message, files: fileList, commitHash, projectPath: this.projectPath }
    } catch (err) {
      return null
    }
  }

  /** List all checkpoints */
  list(): CheckpointRef[] {
    if (!this.init()) return []
    try {
      const logs = execSync('git log --oneline --format="%H|%s|%ct" 2>/dev/null || true', {
        cwd: this.shadowDir,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      return logs.trim().split('\n').filter(Boolean).map(line => {
        const [commitHash, message, timestamp] = line.split('|')
        const id = message.match(/\[(ckpt_\d+)\]/)?.[1] ?? commitHash.slice(0, 12)
        return {
          id,
          timestamp: parseInt(timestamp) * 1000,
          message: message.replace(/\[.*\]/, '').trim(),
          files: [] as string[],
          commitHash,
          projectPath: this.projectPath,
        }
      })
    } catch {
      return []
    }
  }

  /** Restore a checkpoint */
  restore(checkpointId: string, targetFile?: string): boolean {
    if (!this.init()) return false
    try {
      if (targetFile) {
        // Restore specific file
        const ckptDir = resolve(this.shadowDir, 'files', checkpointId)
        if (existsSync(ckptDir)) {
          execSync(`cp -r "${resolve(ckptDir, targetFile)}" "${resolve(this.projectPath, targetFile)}"`, { stdio: 'ignore' })
          return true
        }
      } else {
        // Restore all files from checkpoint
        const ckptDir = resolve(this.shadowDir, 'files', checkpointId)
        if (existsSync(ckptDir)) {
          execSync(`cp -r "${ckptDir}"/* "${this.projectPath}/"`, { stdio: 'ignore' })
          return true
        }
      }
    } catch { /* */ }
    return false
  }

  private getChangedFiles(): string[] {
    try {
      const out = execSync('git diff --name-only HEAD 2>/dev/null || true', {
        cwd: this.projectPath,
        encoding: 'utf8',
        stdio: 'pipe',
      })
      return out.trim().split('\n').filter(Boolean)
    } catch {
      return []
    }
  }

  private hashPath(p: string): string {
    let hash = 0
    for (let i = 0; i < p.length; i++) {
      hash = ((hash << 5) - hash) + p.charCodeAt(i)
      hash |= 0
    }
    return `proj_${Math.abs(hash).toString(36)}`
  }
}

export const createShadowGit = (path?: string) => new ShadowGit(path)
