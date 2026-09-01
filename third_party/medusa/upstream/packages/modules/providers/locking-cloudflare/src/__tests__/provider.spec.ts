import { CloudflareDurableObjectLockingProvider } from "../services/durable-object-lock"
import { lockingCloudflareProvider } from "../provider"

describe("locking cloudflare provider export", () => {
  it("exports the Durable Object locking provider service", () => {
    expect(CloudflareDurableObjectLockingProvider.identifier).toBe(
      "locking-cloudflare"
    )
    expect(lockingCloudflareProvider.services).toEqual([
      CloudflareDurableObjectLockingProvider,
    ])
  })
})
