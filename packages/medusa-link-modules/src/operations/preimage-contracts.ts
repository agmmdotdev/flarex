import { Schema } from "effect"
import { LinkOperationPair, LinkOperationManagedFields, decoder } from "./contracts"

const Id = LinkOperationPair.fields.primary
/** Keep exact PostgreSQL microseconds and logical UTC milliseconds. Parsing
 * verifies the calendar without replacing the retained string with a Date. */
const Timestamp = Schema.String.check(Schema.makeFilter(value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(value) || value.startsWith("0000-")) return false
  const milliseconds = value.replace(/(\.\d{3})\d{3}Z$/, "$1Z")
  const time = Date.parse(milliseconds)
  return Number.isFinite(time) && new Date(time).toISOString() === milliseconds
}))
export const LinkPreimageRow = Schema.Struct({ id: Id, primary: Id, foreign: Id,
  created_at: Timestamp, updated_at: Timestamp, deleted_at: Schema.NullOr(Timestamp) })
export const LinkPreimageOperationRequest = Schema.Struct({ kind: Schema.Literal("preimage"), operationId: Id,
  mutations: Schema.Array(Schema.Struct({ action: Schema.Literals(["create", "dismiss"]), pairs: Schema.Array(LinkOperationPair) })) })
export const LinkPreimageOperationHandle = Schema.Struct({ operationId: Id, serviceName: Id, request: LinkPreimageOperationRequest })
  .check(Schema.makeFilter(handle => handle.operationId === handle.request.operationId))
const Change = Schema.Struct({ primary: Id, foreign: Id, before: Schema.NullOr(LinkPreimageRow),
  after: Schema.NullOr(LinkPreimageRow), afterRevision: Id })
const CompensatedChange = Schema.Struct({ ...Change.fields,
  compensated: Schema.NullOr(LinkPreimageRow), compensatedRevision: Id })
const pairKey = (pair: typeof LinkOperationPair.Type) => JSON.stringify([pair.primary, pair.foreign])

/** Every target retains its resulting fence, even if native mutations leave
 * its values unchanged. Caller input never carries a retained row. Native
 * events stay with the real mutation methods, inside this owning transaction. */
const record = { ...LinkOperationManagedFields,
  id: Id, service_name: Id, request: LinkPreimageOperationRequest,
  events: Schema.Tuple([]), compensation_events: Schema.Tuple([]),
}
export const LinkPreimageOperationRecord = Schema.Union([
  Schema.Struct({ ...record, state: Schema.Literal("applied"), changes: Schema.Array(Change) }),
  Schema.Struct({ ...record, state: Schema.Literal("compensated"), changes: Schema.Array(CompensatedChange) }),
  Schema.Struct({ ...record, state: Schema.Literal("cancelled"), changes: Schema.Tuple([]) }),
]).check(Schema.makeFilter(record => {
  if (record.request.operationId !== record.id) return false
  if (record.state === "cancelled") return record.changes.length === 0
  if (record.state === "compensated" && record.changes.some(change => {
    if (change.before !== null) return linkPreimageRowKey(change.compensated) !== linkPreimageRowKey(change.before)
    if (change.after === null) return change.compensated !== null
    if (change.after.deleted_at !== null) return linkPreimageRowKey(change.compensated) !== linkPreimageRowKey(change.after)
    return change.compensated === null || change.compensated.id !== change.after.id ||
      pairKey(change.compensated) !== pairKey(change) || change.compensated.created_at !== change.after.created_at ||
      change.compensated.deleted_at === null
  })) return false
  const targets = new Set(record.request.mutations.flatMap(mutation => mutation.pairs.map(pairKey)))
  return targets.size === record.changes.length && new Set(record.changes.map(pairKey)).size === targets.size &&
    record.changes.every(change => targets.has(pairKey(change)) &&
      (change.before === null || pairKey(change.before) === pairKey(change)) &&
      (change.after === null || pairKey(change.after) === pairKey(change)))
}))

export const decodeLinkPreimageRequest = decoder(LinkPreimageOperationRequest, "input")
export const decodeLinkPreimageHandle = decoder(LinkPreimageOperationHandle, "input")
export const decodeLinkPreimageRecord = decoder(LinkPreimageOperationRecord, "stored")
export const isLinkPreimageRecord = Schema.is(LinkPreimageOperationRecord)
export const decodeLinkPreimageRows = decoder(Schema.Array(LinkPreimageRow), "stored")

export function linkPreimageRequestKey(request: typeof LinkPreimageOperationRequest.Type): string {
  return JSON.stringify([request.kind, request.operationId, request.mutations.map(mutation =>
    [mutation.action, mutation.pairs.map(pair => [pair.primary, pair.foreign])])])
}
export function linkPreimageRowKey(row: typeof LinkPreimageRow.Type | null): string {
  return JSON.stringify(row === null ? null : [row.id, row.primary, row.foreign, row.created_at, row.updated_at, row.deleted_at])
}
export function linkPreimageRecordKey(value: typeof LinkPreimageOperationRecord.Type): string {
  const changes = value.state === "compensated" ? value.changes.map(change => [change.primary, change.foreign,
    linkPreimageRowKey(change.before), linkPreimageRowKey(change.after), change.afterRevision,
    linkPreimageRowKey(change.compensated), change.compensatedRevision]) : value.changes.map(change =>
    [change.primary, change.foreign, linkPreimageRowKey(change.before), linkPreimageRowKey(change.after), change.afterRevision])
  return JSON.stringify([value.id, value.service_name, linkPreimageRequestKey(value.request), value.state, changes])
}
