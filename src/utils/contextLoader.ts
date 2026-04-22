/**
 * DuckHive DUCK.md Hierarchical Context Loader
 * 
 * Inspired by gemini-cli's GEMINI.md system. Loads context from:
 * - Global:     ~/.duckhive/DUCK.md
 * - Workspace:   <workspace>/.duckhive/DUCK.md
 * - Per-dir:    any .duckhive/DUCK.md in the directory tree above CWD
 * 
 * Context files are optional — missing files are silently skipped.
 * Loaded once at session start, cached for the lifetime of the process.
 */

import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

export interface ContextFileInfo {
  path: string
  content: string
  level: 'global' | 'workspace' | 'per-directory'
}

const DUCK_MD_FILENAME = 'DUCK.md'
const DUCKHIVE_DIR = '.duckhive'
const DUCKHIVE_DUCK_MD = '.duckhive/DUCK.md'

// Also support common alternative names found in wild
const ALTERNATIVE_CONTEXT_FILES = ['DUCK.md', 'AGENTS.md', 'GEMINI.md', 'CONTEXT.md']

// Cache for loaded context (set once at session start)
let _cachedContextFiles: ContextFileInfo[] | null = null
let _cachedCombinedContext: string | null = null

/**
 * Load a single context file, returning null if it doesn't exist or can't be read.
 */
function loadContextFile(path: string): string | null {
  try {
    if (existsSync(path)) {
      return readFileSync(path, 'utf8')
    }
  } catch {
    // Silently skip unreadable files
  }
  return null
}

/**
 * Check if a path is excluded by a .duckignore file in any parent directory.
 */
function isExcludedByDuckignore(filePath: string, cwd: string): boolean {
  let dir = dirname(filePath)
  const home = process.env.HOME ?? '~'
  
  while (dir && dir !== home && dir !== '/') {
    const duckignorePath = join(dir, '.duckignore')
    if (existsSync(duckignorePath)) {
      try {
        const content = readFileSync(duckignorePath, 'utf8')
        const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        for (const pattern of lines) {
          // Simple glob matching - check if file matches
          if (pattern.includes('/')) {
            // Path pattern relative to .duckignore location
            const fullPattern = join(dir, pattern)
            if (filePath === fullPattern || filePath.startsWith(fullPattern + '/')) {
              return true
            }
          } else {
            // Just filename pattern
            const fileName = filePath.split('/').pop()
            if (fileName === pattern || fileName.startsWith(pattern.replace('*', ''))) {
              return true
            }
          }
        }
      } catch {
        // Can't read .duckignore, skip
      }
    }
    dir = dirname(dir)
  }
  return false
}

/**
 * Scan for all DUCK.md context files in the hierarchical path from global to per-directory.
 * Returns files in order of precedence (global first, then workspace, then per-directory).
 */
export function scanDuckContextFiles(projectPath?: string): ContextFileInfo[] {
  const cwd = projectPath ?? process.cwd()
  const home = process.env.HOME ?? '~'
  const results: ContextFileInfo[] = []
  const seen = new Set<string>()

  const addFile = (path: string, level: ContextFileInfo['level']) => {
    if (seen.has(path)) return
    seen.add(path)
    if (isExcludedByDuckignore(path, cwd)) return
    const content = loadContextFile(path)
    if (content) {
      results.push({ path, content, level })
    }
  }

  // 1. Global context: ~/.duckhive/DUCK.md
  const globalPath = resolve(home, DUCKHIVE_DIR, DUCK_MD_FILENAME)
  addFile(globalPath, 'global')

  // 2. Also check ~/.duckhive/DUCK.md (same as above, just being explicit)
  // 3. Workspace context: <cwd>/.duckhive/DUCK.md or <cwd>/DUCK.md
  addFile(resolve(cwd, DUCKHIVE_DUCK_MD), 'workspace')
  for (const altName of ALTERNATIVE_CONTEXT_FILES) {
    addFile(resolve(cwd, altName), 'workspace')
  }

  // 4. Per-directory: traverse from CWD up to home or filesystem root
  let current = dirname(cwd)
  while (current && current !== home && current !== '/') {
    const perDirDuckMd = resolve(current, DUCKHIVE_DIR, DUCK_MD_FILENAME)
    addFile(perDirDuckMd, 'per-directory')
    for (const altName of ALTERNATIVE_CONTEXT_FILES) {
      addFile(resolve(current, altName), 'per-directory')
    }
    current = dirname(current)
  }

  return results
}

/**
 * Load and cache all DUCK.md context files. Called once at session start.
 * Subsequent calls return the cached result.
 */
export function loadDuckContext(): ContextFileInfo[] {
  if (_cachedContextFiles === null) {
    _cachedContextFiles = scanDuckContextFiles()
    _cachedCombinedContext = null // Will be built on demand
  }
  return _cachedContextFiles
}

/**
 * Get the combined context string from all loaded DUCK.md files.
 * Returns an empty string if no context files are found.
 */
export function getCombinedDuckContext(): string {
  if (_cachedCombinedContext === null) {
    const files = loadDuckContext()
    _cachedCombinedContext = files
      .map(f => `<!-- ${f.level}: ${f.path} -->\n${f.content}`)
      .join('\n\n')
  }
  return _cachedCombinedContext
}

/**
 * Get just the count of loaded context files (for display in startup screen).
 */
export function getDuckContextFileCount(): number {
  return loadDuckContext().length
}

/**
 * Get list of loaded context file paths (for debugging/display).
 */
export function getDuckContextFilePaths(): string[] {
  return loadDuckContext().map(f => f.path)
}

/**
 * Check if any DUCK.md context files exist at all.
 */
export function hasDuckContext(): boolean {
  return loadDuckContext().length > 0
}

/**
 * Clear the context cache (useful for testing or reset).
 */
export function clearDuckContextCache(): void {
  _cachedContextFiles = null
  _cachedCombinedContext = null
}