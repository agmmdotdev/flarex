import type { ICachingProviderService } from "@medusajs/types"

interface CacheEntry {
  data: object
  expiresAt?: number
  options?: {
    autoInvalidate?: boolean
  }
}

export class WorkerMemoryCachingProvider implements ICachingProviderService {
  static identifier = "worker-memory"

  readonly #entries = new Map<string, CacheEntry>()
  readonly #tagIndex = new Map<string, Set<string>>()
  readonly #keyTags = new Map<string, Set<string>>()

  async get({
    key,
    tags,
  }: {
    key?: string
    tags?: string[]
  }): Promise<unknown> {
    if (key) {
      const entry = this.#getLiveEntry(key)
      return entry?.data ?? null
    }

    if (tags?.length) {
      const keys = this.#keysForTags(tags)
      const values: object[] = []
      for (const taggedKey of keys) {
        const entry = this.#getLiveEntry(taggedKey)
        if (entry) {
          values.push(entry.data)
        }
      }
      return values
    }

    return null
  }

  async set({
    key,
    data,
    ttl,
    tags,
    options,
  }: {
    key: string
    data: object
    ttl?: number
    tags?: string[]
    options?: {
      autoInvalidate?: boolean
    }
  }): Promise<void> {
    this.#cleanupKey(key)

    this.#entries.set(key, {
      data,
      expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
      options,
    })

    if (tags?.length) {
      const tagSet = new Set(tags)
      this.#keyTags.set(key, tagSet)
      for (const tag of tagSet) {
        const keys = this.#tagIndex.get(tag) ?? new Set<string>()
        keys.add(key)
        this.#tagIndex.set(tag, keys)
      }
    }
  }

  async clear({
    key,
    tags,
    options,
  }: {
    key?: string
    tags?: string[]
    options?: {
      autoInvalidate?: boolean
    }
  }): Promise<void> {
    if (key) {
      this.#cleanupKey(key)
      return
    }

    if (!tags?.length) {
      return
    }

    if (tags.includes("*")) {
      this.#entries.clear()
      this.#tagIndex.clear()
      this.#keyTags.clear()
      return
    }

    for (const taggedKey of this.#keysForTags(tags)) {
      const entry = this.#getLiveEntry(taggedKey)
      if (!entry) {
        continue
      }

      if (!options || entry.options?.autoInvalidate !== false) {
        this.#cleanupKey(taggedKey)
      }
    }
  }

  #getLiveEntry(key: string): CacheEntry | undefined {
    const entry = this.#entries.get(key)
    if (!entry) {
      return undefined
    }

    if (entry.expiresAt && entry.expiresAt <= Date.now()) {
      this.#cleanupKey(key)
      return undefined
    }

    return entry
  }

  #keysForTags(tags: string[]): Set<string> {
    const keys = new Set<string>()
    for (const tag of tags) {
      const keysForTag = this.#tagIndex.get(tag)
      keysForTag?.forEach((key) => keys.add(key))
    }
    return keys
  }

  #cleanupKey(key: string): void {
    this.#entries.delete(key)
    const tags = this.#keyTags.get(key)
    if (!tags) {
      return
    }

    for (const tag of tags) {
      const keys = this.#tagIndex.get(tag)
      keys?.delete(key)
      if (keys?.size === 0) {
        this.#tagIndex.delete(tag)
      }
    }
    this.#keyTags.delete(key)
  }
}

export const workerMemoryCachingProvider = {
  services: [WorkerMemoryCachingProvider],
}
