export interface CloudflareDurableObjectNamespace {
  idFromName(name: string): CloudflareDurableObjectId
  get(id: CloudflareDurableObjectId): CloudflareDurableObjectStub
}

export interface CloudflareDurableObjectId {}

export interface CloudflareDurableObjectStub {
  fetch(request: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export interface CloudflareLockingProviderOptions {
  namespace: CloudflareDurableObjectNamespace
  instanceName?: string
  keyPrefix?: string
  pollIntervalMs?: number
}

export interface LockAcquireRequest {
  key: string
  ownerId: string | null
  expire?: number
}

export interface LockReleaseRequest {
  key: string
  ownerId?: string | null
}

export interface LockReleaseAllRequest {
  ownerId?: string | null
}
