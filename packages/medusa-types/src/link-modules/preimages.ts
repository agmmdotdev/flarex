import type { LinkOperationPair } from "./operations"

/** Ordered genuine native Link mutations. In particular, Cart REPLACE must
 * dismiss before creating, including when both batches contain one pair. */
export interface LinkPreimageOperationRequest {
  readonly kind: "preimage"
  readonly operationId: string
  readonly mutations: readonly {
    readonly action: "create" | "dismiss"
    readonly pairs: readonly LinkOperationPair[]
  }[]
}

export interface LinkPreimageOperationHandle {
  readonly operationId: string
  readonly serviceName: string
  readonly request: LinkPreimageOperationRequest
}
