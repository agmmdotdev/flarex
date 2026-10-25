import { Result, Schema } from "effect"
import { MedusaError } from "@medusajs/utils/common/errors"

const Id = Schema.String.check(Schema.isLengthBetween(1, 256))
export const LinkOperationPair = Schema.Struct({ primary: Id, foreign: Id })
export const LinkOperationRequest = Schema.Struct({ operationId: Id,
  add: Schema.Array(LinkOperationPair), remove: Schema.Array(LinkOperationPair) })
export const LinkOperationHandle = Schema.Struct({ operationId: Id, serviceName: Id, request: LinkOperationRequest })
  .check(Schema.makeFilter(handle => handle.request.operationId === handle.operationId))
const Count = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
export const LinkOperationResult = Schema.Struct({ operationId: Id, serviceName: Id,
  state: Schema.Literals(["applied", "compensated", "cancelled"]), changedPairs: Count, replayed: Schema.Boolean })
export const LinkOperationCompensation = Schema.Struct({ operationId: Id, serviceName: Id,
  status: Schema.Literals(["compensated", "alreadyCompensated", "notApplied"]), changedPairs: Count })
const Change = Schema.Struct({ primary: Id, foreign: Id, beforeActive: Schema.Boolean,
  afterActive: Schema.Boolean, afterRevision: Id })
export const LinkOperationEventIntent = Schema.Struct({ event_id: Id, id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(2))]), action: Schema.Literals(["attached", "detached"]) })
const Managed = { created_at: Schema.optionalKey(Schema.Unknown), updated_at: Schema.optionalKey(Schema.Unknown),
  deleted_at: Schema.optionalKey(Schema.Null) }

/** Managed timestamps remain with native DML. Only the protocol fields below
 * participate in replay, arbitration and compensation ownership. */
export const LinkOperationRecord = Schema.Union([
  Schema.Struct({ ...Managed, id: Id, service_name: Id, request: LinkOperationRequest,
    state: Schema.Literal("applied"), changes: Schema.Array(Change), events: Schema.Array(LinkOperationEventIntent), compensation_events: Schema.Tuple([]) }),
  Schema.Struct({ ...Managed, id: Id, service_name: Id, request: LinkOperationRequest,
    state: Schema.Literal("compensated"), changes: Schema.Array(Change), events: Schema.Array(LinkOperationEventIntent), compensation_events: Schema.Array(LinkOperationEventIntent) }),
  Schema.Struct({ ...Managed, id: Id, service_name: Id, request: LinkOperationRequest,
    state: Schema.Literal("cancelled"), changes: Schema.Tuple([]), events: Schema.Tuple([]), compensation_events: Schema.Tuple([]) }),
]).check(Schema.makeFilter(record => {
  const key = (pair: typeof LinkOperationPair.Type) => JSON.stringify([pair.primary, pair.foreign])
  const targets = new Map<string, boolean>()
  for (const pair of record.request.add) targets.set(key(pair), true)
  for (const pair of record.request.remove) targets.set(key(pair), false)
  return record.request.operationId === record.id &&
    record.changes.every(change => change.beforeActive !== change.afterActive && targets.get(key(change)) === change.afterActive) &&
    new Set(record.changes.map(key)).size === record.changes.length &&
    new Set([...record.events, ...record.compensation_events].map(event => event.event_id)).size === record.events.length + record.compensation_events.length
}))
export const LinkPairRevisionRecord = Schema.Struct({ ...Managed, id: Id, service_name: Id,
  primary_value: Id, foreign_value: Id, revision: Id })

function decoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S, kind: "input" | "stored", excess: "error" | "ignore" = "error") {
  const decode = Schema.decodeUnknownResult(schema, { onExcessProperty: excess, propertyOrder: "original" })
  return (value: unknown): S["Type"] => Result.match(decode(value), {
    onSuccess: result => result,
    onFailure: cause => {
      const error = new MedusaError(kind === "input" ? MedusaError.Types.INVALID_DATA : MedusaError.Types.UNEXPECTED_STATE,
        kind === "input" ? "Invalid Link operation input" : "Invalid durable Link operation state")
      Object.defineProperty(error, "cause", { value: cause })
      throw error
    },
  })
}

export const decodeLinkOperationRequest = decoder(LinkOperationRequest, "input")
export const decodeLinkOperationHandle = decoder(LinkOperationHandle, "input")
export const decodeLinkOperationRecord = decoder(LinkOperationRecord, "stored")
export const decodeLinkPairRevisionRecord = decoder(LinkPairRevisionRecord, "stored")
export const decodeLinkPairRevisionRows = decoder(Schema.Array(LinkPairRevisionRecord), "stored")
export const decodeLinkOperationRows = decoder(Schema.Array(Schema.Struct({ id: Id })), "stored", "ignore")

/** This protocol hashes arrays of established strings, never arbitrary records.
 * Domain tags separate operation identities from normalized endpoint keys. */
async function digest(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts))
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")
}

export async function linkPairRevisionId(serviceName: string, pair: typeof LinkOperationPair.Type): Promise<string> {
  return "lpr_" + await digest(["medusa.link-pair-revision", "1", serviceName, pair.primary, pair.foreign])
}

export function linkOperationConflict(message: string): MedusaError {
  return new MedusaError(MedusaError.Types.CONFLICT, message)
}

/** Object property order is incidental; endpoint and operation-array order
 * are part of the native request, including repeated additions. */
export function linkOperationRequestKey(request: typeof LinkOperationRequest.Type): string {
  return JSON.stringify([request.operationId, request.add.map(pair => [pair.primary, pair.foreign]),
    request.remove.map(pair => [pair.primary, pair.foreign])])
}
