import type {
  LockAcquireRequest,
  LockReleaseAllRequest,
  LockReleaseRequest,
} from "@medusajs/locking-cloudflare/provider"

interface StoredLock {
  ownerId: string | null
  expiration: number | null
}

export class MedusaLockingDO {
  constructor(
    private readonly ctx: DurableObjectState,
    _env: object
  ) {}

  async fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname

    if (pathname === "/acquire" && request.method === "POST") {
      const input: unknown = await request.json()
      if (!isLockAcquireRequest(input)) {
        return new Response("Invalid lock acquire request", { status: 400 })
      }

      return Response.json({
        acquired: await this.acquire(input),
      })
    }

    if (pathname === "/release" && request.method === "POST") {
      const input: unknown = await request.json()
      if (!isLockReleaseRequest(input)) {
        return new Response("Invalid lock release request", { status: 400 })
      }

      return Response.json({
        released: await this.release(input),
      })
    }

    if (pathname === "/release-all" && request.method === "POST") {
      const input: unknown = await request.json()
      if (!isLockReleaseAllRequest(input)) {
        return new Response("Invalid lock release-all request", {
          status: 400,
        })
      }

      return Response.json({
        released: await this.releaseAll(input),
      })
    }

    return new Response("Not found", { status: 404 })
  }

  private async acquire(input: LockAcquireRequest): Promise<boolean> {
    const now = Date.now()
    const lock = await this.ctx.storage.get<StoredLock>(input.key)
    const expiration = input.expire ? now + input.expire * 1000 : null

    if (!lock || isExpired(lock, now)) {
      await this.ctx.storage.put(input.key, {
        ownerId: input.ownerId,
        expiration,
      } satisfies StoredLock)
      return true
    }

    if (lock.ownerId !== null && lock.ownerId === input.ownerId) {
      if (input.expire) {
        await this.ctx.storage.put(input.key, {
          ...lock,
          expiration,
        } satisfies StoredLock)
      }
      return true
    }

    return false
  }

  private async release(input: LockReleaseRequest): Promise<boolean> {
    const lock = await this.ctx.storage.get<StoredLock>(input.key)
    if (!lock) {
      return false
    }

    if ("ownerId" in input && lock.ownerId !== input.ownerId) {
      return false
    }

    await this.ctx.storage.delete(input.key)
    return !isExpired(lock, Date.now())
  }

  private async releaseAll(input: LockReleaseAllRequest): Promise<number> {
    const locks = await this.ctx.storage.list<StoredLock>()
    let released = 0

    for (const [key, lock] of locks.entries()) {
      if ("ownerId" in input && lock.ownerId !== input.ownerId) {
        continue
      }

      await this.ctx.storage.delete(key)
      released++
    }

    return released
  }
}

function isExpired(lock: StoredLock, now: number): boolean {
  return lock.expiration !== null && lock.expiration <= now
}

function isLockAcquireRequest(value: unknown): value is LockAcquireRequest {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    (typeof value.ownerId === "string" || value.ownerId === null) &&
    (!("expire" in value) || typeof value.expire === "number")
  )
}

function isLockReleaseRequest(value: unknown): value is LockReleaseRequest {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    (!("ownerId" in value) ||
      typeof value.ownerId === "string" ||
      value.ownerId === null)
  )
}

function isLockReleaseAllRequest(
  value: unknown
): value is LockReleaseAllRequest {
  return (
    isRecord(value) &&
    (!("ownerId" in value) ||
      typeof value.ownerId === "string" ||
      value.ownerId === null)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
