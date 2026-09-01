import { CloudflareDurableObjectLockingProvider } from "./services/durable-object-lock"

export { CloudflareDurableObjectLockingProvider }
export type {
  CloudflareDurableObjectNamespace,
  CloudflareLockingProviderOptions,
  LockAcquireRequest,
  LockReleaseAllRequest,
  LockReleaseRequest,
} from "./types"

export const lockingCloudflareProvider = {
  services: [CloudflareDurableObjectLockingProvider],
}
