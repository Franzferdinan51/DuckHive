import { join } from 'path'
import type { LocalCommandCall } from '../../types/command.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { clearLessonsCache } from '../../memdir/lessons.js'
import { resetGetMemoryFilesCache } from '../../utils/claudemd.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { logForDebugging } from '../../utils/debug.js'

export const call: LocalCommandCall = async () => {
  const memPath = getAutoMemPath()
  const fs = getFsImplementation()

  let deletedCount = 0
  const deletedFiles: string[] = []

  try {
    const entries = await fs.readdir(memPath)
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const fullPath = join(memPath, entry.name)
        try {
          await fs.unlink(fullPath)
          deletedCount++
          deletedFiles.push(entry.name)
        } catch (e) {
          logForDebugging(`[memory-reset] Failed to delete ${fullPath}: ${e}`)
        }
      }
    }
  } catch {
    // Directory may not exist yet — no memories to clear
  }

  // Clear caches so the next getMemoryFiles call re-reads from disk
  clearLessonsCache()
  resetGetMemoryFilesCache('session_start')

  if (deletedCount > 0) {
    logForDebugging(`[memory-reset] Cleared ${deletedCount} file(s): ${deletedFiles.join(', ')}`)
    return {
      type: 'text',
      value: `Cleared ${deletedCount} memory file(s): ${deletedFiles.join(', ')}.\n\nMemory has been reset to default.`,
    }
  }

  return {
    type: 'text',
    value: 'No memory files found — already at default state.',
  }
}
