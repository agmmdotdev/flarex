import { Dirent } from "fs"
import { readdir } from "fs/promises"
import { join } from "path"

const MISSING_NODE_ERRORS = ["ENOTDIR", "ENOENT"]

export type DirentWithPath = Dirent & {
  path: string
}

export async function readDir(
  dir: string,
  options?: {
    ignoreMissing?: boolean
  }
) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
  } catch (error) {
    if (options?.ignoreMissing && MISSING_NODE_ERRORS.includes(error.code)) {
      return []
    }
    throw error
  }
}

export async function readDirRecursive(
  dir: string,
  options?: {
    ignoreMissing?: boolean
    maxDepth?: number
  }
): Promise<DirentWithPath[]> {
  let allEntries: DirentWithPath[] = []
  const readRecursive = async (dir: string, depth: number = 1) => {
    const maxDepth = options?.maxDepth ?? Infinity
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const entryWithPath = entry as DirentWithPath
        Object.defineProperty(entryWithPath, "path", {
          value: dir,
        })
        allEntries.push(entryWithPath)

        if (entry.isDirectory() && depth < maxDepth) {
          await readRecursive(fullPath, depth + 1)
        }
      }
    } catch (error) {
      if (options?.ignoreMissing && error.code === "ENOENT") {
        return
      }

      throw error
    }
  }

  await readRecursive(dir)
  return allEntries
}
