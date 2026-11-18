/** Named native operation DTOs. Identifiers locate state; callers still need
 * the selected module's mutation and compensation authority. */
export interface LinkOperationPair {
  readonly primary: string
  readonly foreign: string
}

export interface LinkOperationRequest {
  readonly operationId: string
  readonly add: readonly LinkOperationPair[]
  readonly remove: readonly LinkOperationPair[]
}

export interface LinkOperationHandle {
  readonly operationId: string
  readonly serviceName: string
  readonly request: LinkOperationRequest
}

export interface LinkOperationResult extends Pick<LinkOperationHandle, "operationId" | "serviceName"> {
  readonly state: "applied" | "compensated" | "cancelled"
  readonly changedPairs: number
  readonly replayed: boolean
}

export interface LinkOperationCompensation extends Pick<LinkOperationHandle, "operationId" | "serviceName"> {
  readonly status: "compensated" | "alreadyCompensated" | "notApplied"
  readonly changedPairs: number
}
