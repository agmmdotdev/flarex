import type { Context, ILockingProvider } from "@medusajs/framework/types"
import type {
  CloudflareDurableObjectNamespace,
  CloudflareLockingProviderOptions,
  LockAcquireRequest,
  LockReleaseAllRequest,
  LockReleaseRequest,
} from "../types"

type LockingArgs = {
  ownerId?: string | null
  expire?: number
  awaitQueue?: boolean
}

type TimeoutToken = {
  cancelled: boolean
}

export class CloudflareDurableObjectLockingProvider
  implements ILockingProvider
{
  static identifier = "locking-cloudflare"

  readonly #namespace: CloudflareDurableObjectNamespace
  readonly #instanceName: string
  readonly #keyPrefix: string
  readonly #pollIntervalMs: number

  constructor(
    _container?: unknown,
    options?: CloudflareLockingProviderOptions
  ) {
    if (!options?.namespace) {
      throw new Error(
        "Cloudflare Locking provider requires a Durable Object namespace"
      )
    }

    this.#namespace = options.namespace
    this.#instanceName = options.instanceName ?? "global"
    this.#keyPrefix = options.keyPrefix ?? "medusa-lock:"
    this.#pollIntervalMs = Math.max(options.pollIntervalMs ?? 25, 1)
  }

  async execute<T>(
    keys: string | string[],
    job: () => Promise<T>,
    args?: {
      timeout?: number
    },
    _sharedContext: Context = {}
  ): Promise<T> {
    const timeout = Math.max(args?.timeout ?? 5, 1)
    const timeoutSeconds = Number.isNaN(timeout) ? 1 : timeout
    const ownerId = this.#createOwnerId()

    const cancellationToken = { cancelled: false }
    const timeoutPromise = this.#getTimeout(
      timeoutSeconds,
      cancellationToken
    )
    const acquirePromise = this.acquire_(
      keys,
      {
        ownerId,
        expire: timeoutSeconds,
        awaitQueue: true,
      },
      cancellationToken
    )

    await Promise.race([timeoutPromise, acquirePromise])

    try {
      return await job()
    } finally {
      await this.release(keys, { ownerId })
    }
  }

  async acquire(
    keys: string | string[],
    args?: {
      ownerId?: string | null
      expire?: number
    },
    _sharedContext: Context = {}
  ): Promise<void> {
    return await this.acquire_(keys, args)
  }

  async acquire_(
    keys: string | string[],
    args?: LockingArgs,
    cancellationToken?: TimeoutToken
  ): Promise<void> {
    const sortedKeys = this.#normalizeKeys(keys)
    const acquired: string[] = []

    try {
      for (const key of sortedKeys) {
        const lockKey = this.#lockKey(key)
        await this.#acquireOne(lockKey, args, cancellationToken)
        acquired.push(key)
      }
    } catch (error) {
      await this.release(acquired, { ownerId: args?.ownerId ?? null })
      throw error
    }
  }

  async release(
    keys: string | string[],
    args?: {
      ownerId?: string | null
    },
    _sharedContext: Context = {}
  ): Promise<boolean> {
    const sortedKeys = this.#normalizeKeys(keys)
    const results = await Promise.all(
      sortedKeys.map((key) =>
        this.#postJson<LockReleaseRequest>(
          "/release",
          createReleaseRequest(this.#lockKey(key), args)
        ).then(assertLockReleaseResponse)
      )
    )

    return results.every((result) => result.released)
  }

  async releaseAll(
    args?: {
      ownerId?: string | null
    },
    _sharedContext: Context = {}
  ): Promise<void> {
    const result = await this.#postJson<LockReleaseAllRequest>(
      "/release-all",
      createReleaseAllRequest(args)
    )
    assertLockReleaseAllResponse(result)
  }

  async #acquireOne(
    lockKey: string,
    args?: LockingArgs,
    cancellationToken?: TimeoutToken
  ): Promise<void> {
    while (true) {
      if (cancellationToken?.cancelled) {
        return
      }

      const result = assertLockAcquireResponse(
        await this.#postJson<LockAcquireRequest>("/acquire", {
          key: lockKey,
          ownerId: args?.ownerId ?? null,
          expire: args?.expire,
        })
      )

      if (cancellationToken?.cancelled) {
        if (result.acquired) {
          await this.#postJson<LockReleaseRequest>(
            "/release",
            createReleaseRequest(lockKey, args)
          )
        }
        return
      }

      if (result.acquired) {
        return
      }

      if (!args?.awaitQueue) {
        throw new Error(`Failed to acquire lock for key "${lockKey}"`)
      }

      await this.#sleep(this.#pollIntervalMs)
    }
  }

  async #postJson<RequestBody>(
    path: string,
    body: RequestBody
  ): Promise<unknown> {
    const id = this.#namespace.idFromName(this.#instanceName)
    const response = await this.#namespace.get(id).fetch(
      new Request(`https://locking.medusa.internal${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
      })
    )

    if (!response.ok) {
      const message = await response.text()
      throw new Error(message || `Locking DO request failed: ${path}`)
    }

    return await response.json()
  }

  #normalizeKeys(keys: string | string[]): string[] {
    return [...(Array.isArray(keys) ? keys : [keys])].sort()
  }

  #lockKey(key: string): string {
    return `${this.#keyPrefix}${key}`
  }

  #createOwnerId(): string {
    return `cf-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
  }

  #getTimeout(
    seconds: number,
    cancellationToken: TimeoutToken
  ): Promise<void> {
    return new Promise((_, reject) => {
      globalThis.setTimeout(() => {
        cancellationToken.cancelled = true
        reject(new Error("Timed-out acquiring lock."))
      }, seconds * 1000)
    })
  }
}

function assertLockAcquireResponse(value: unknown): { acquired: boolean } {
  if (isRecord(value) && typeof value.acquired === "boolean") {
    return { acquired: value.acquired }
  }

  throw new Error("Locking DO returned an invalid acquire response")
}

function assertLockReleaseResponse(value: unknown): { released: boolean } {
  if (isRecord(value) && typeof value.released === "boolean") {
    return { released: value.released }
  }

  throw new Error("Locking DO returned an invalid release response")
}

function assertLockReleaseAllResponse(value: unknown): { released: number } {
  if (isRecord(value) && typeof value.released === "number") {
    return { released: value.released }
  }

  throw new Error("Locking DO returned an invalid release-all response")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function createReleaseRequest(
  key: string,
  args?: {
    ownerId?: string | null
  }
): LockReleaseRequest {
  if (args && "ownerId" in args) {
    return {
      key,
      ownerId: args.ownerId ?? null,
    }
  }

  return { key }
}

function createReleaseAllRequest(args?: {
  ownerId?: string | null
}): LockReleaseAllRequest {
  if (args && "ownerId" in args) {
    return {
      ownerId: args.ownerId ?? null,
    }
  }

  return {}
}
