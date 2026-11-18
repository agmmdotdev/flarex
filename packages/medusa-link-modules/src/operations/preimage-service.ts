import type { Context, LinkOperationCompensation, LinkOperationResult } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/utils/common/errors"
import { linkOperationConflict, linkPairRevisionId, type LinkOperationPair } from "./contracts"
import { decodeLinkPreimageHandle, decodeLinkPreimageRequest, isLinkPreimageRecord,
  linkPreimageRequestKey, linkPreimageRowKey, type LinkPreimageOperationRecord, type LinkPreimageRow } from "./preimage-contracts"
import type { LinkOperationStore } from "./store"

type Pair = typeof LinkOperationPair.Type
type Row = typeof LinkPreimageRow.Type
type Record = typeof LinkPreimageOperationRecord.Type
type Applied = Extract<Record, { readonly state: "applied" }>
type Completed = Extract<Record, { readonly state: "compensated" }>
interface NativeRows {
  create(pairs: readonly Pair[], context: Context): Promise<unknown>
  dismiss(pairs: readonly Pair[], context: Context): Promise<unknown>
  restore(rows: readonly Row[], context: Context): Promise<unknown>
}
const pairKey = (pair: Pair) => JSON.stringify([pair.primary, pair.foreign])
const rowMap = (rows: readonly Row[]) => new Map(rows.map(row => [pairKey(row), row]))
const changedPairs = (record: Record) => record.changes.filter(change => linkPreimageRowKey(change.before) !== linkPreimageRowKey(change.after)).length
const unexpected = (message: string) => new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message)

/** Exact preimages extend the existing serialized Link owner. Public native
 * mutation methods retain selection, upsert, scalar/batch events and native
 * event-failure timing; this service never starts another lifetime. */
export class LinkPreimageOperationService {
  constructor(readonly store: LinkOperationStore, readonly rows: NativeRows) {
    if (!store.supportsPreimages) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Native Link preimages are not enabled")
  }

  async apply(input: unknown, context: Context): Promise<LinkOperationResult> {
    const request = structuredClone(decodeLinkPreimageRequest(input))
    return this.store.withTransaction(context, async owned => {
      const existing = await this.store.operation(request.operationId, owned)
      if (existing !== undefined) {
        if (!isLinkPreimageRecord(existing.value)) throw linkOperationConflict("Native Link operation identity belongs to another protocol")
        if (linkPreimageRequestKey(existing.value.request) !== linkPreimageRequestKey(request))
          throw linkOperationConflict("Native Link preimage operation identity was reused with a different request")
        return { operationId: request.operationId, serviceName: this.store.serviceName,
          state: existing.value.state, changedPairs: changedPairs(existing.value), replayed: true }
      }
      // Presentation order follows the native request. Head acquisition has
      // its own deterministic complete-cohort order in the existing Store.
      const targets = new Map<string, Pair>(), finalActive = new Map<string, boolean>()
      for (const mutation of request.mutations) for (const pair of mutation.pairs) {
        if (!targets.has(pairKey(pair))) targets.set(pairKey(pair), pair)
        finalActive.set(pairKey(pair), mutation.action === "create")
      }
      const pairs = [...targets.values()]
      await this.store.rotate(pairs, owned)
      const before = rowMap(await this.store.capturePreimages(pairs, owned))
      for (const mutation of request.mutations) if (mutation.pairs.length) {
        if (mutation.action === "create") await this.rows.create(mutation.pairs, owned)
        else await this.rows.dismiss(mutation.pairs, owned)
        // Each original public call normally reaches its native flush before
        // the next call starts. Seal that same boundary inside this borrowed
        // transaction, then authenticate its actual persisted membership.
        const checkpoint = rowMap(await this.store.capturePreimages(mutation.pairs, owned))
        for (const pair of mutation.pairs) {
          const row = checkpoint.get(pairKey(pair))
          if ((row !== undefined && row.deleted_at === null) !== (mutation.action === "create"))
            throw unexpected("Native Link mutation did not produce its requested membership")
        }
      }
      const after = rowMap(await this.store.capturePreimages(pairs, owned)), revisions = await this.store.revisions(pairs, owned)
      const changes: Applied["changes"][number][] = []
      for (const pair of pairs) {
        const current = after.get(pairKey(pair)) ?? null
        if ((current !== null && current.deleted_at === null) !== finalActive.get(pairKey(pair)))
          throw unexpected("Native Link mutations did not produce their requested membership")
        const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, pair))
        if (revision === undefined) throw unexpected("Missing native Link preimage write fence")
        changes.push({ ...pair, before: before.get(pairKey(pair)) ?? null, after: current, afterRevision: revision.value.revision })
      }
      const record: Applied = { id: request.operationId, service_name: this.store.serviceName, request,
        state: "applied", changes, events: [], compensation_events: [] }
      await this.store.insert(record, owned)
      return { operationId: request.operationId, serviceName: this.store.serviceName, state: "applied", changedPairs: changedPairs(record), replayed: false }
    })
  }

  async compensate(input: unknown, context: Context): Promise<LinkOperationCompensation> {
    const handle = structuredClone(decodeLinkPreimageHandle(input)), identity = { operationId: handle.operationId, serviceName: handle.serviceName }
    if (handle.serviceName !== this.store.serviceName) throw linkOperationConflict("Native Link preimage compensation selected another module")
    return this.store.withTransaction(context, async owned => {
      const operation = await this.store.operation(handle.operationId, owned)
      if (operation === undefined) {
        await this.store.insert({ id: handle.operationId, service_name: this.store.serviceName, request: handle.request,
          state: "cancelled", changes: [], events: [], compensation_events: [] }, owned)
        return { ...identity, status: "notApplied", changedPairs: 0 }
      }
      const record = operation.value
      if (!isLinkPreimageRecord(record)) throw linkOperationConflict("Native Link operation identity belongs to another protocol")
      if (linkPreimageRequestKey(record.request) !== linkPreimageRequestKey(handle.request))
        throw linkOperationConflict("Native Link preimage compensation request differs from its retained operation")
      if (record.state === "cancelled") return { ...identity, status: "notApplied", changedPairs: 0 }

      const revisions = await this.store.revisions(record.changes, owned)
      if (record.state === "applied") {
        for (const change of record.changes) {
          const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, change))
          if (revision?.value.revision !== change.afterRevision)
            throw linkOperationConflict("A later native Link write superseded preimage compensation ownership")
        }
        // Every native writer acquires heads before Link rows. Rotate the
        // complete cohort in that same order, then authenticate exact rows.
        // A stale SERIALIZABLE writer fails instead of reversing lock order.
        await this.store.rotate(record.changes, owned)
      }
      const current = rowMap(await this.store.capturePreimages(record.changes, owned))
      if (record.state === "compensated") {
        for (const change of record.changes) {
          const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, change))
          if (revision?.value.revision !== change.compensatedRevision ||
            linkPreimageRowKey(current.get(pairKey(change)) ?? null) !== linkPreimageRowKey(change.compensated))
            throw linkOperationConflict("A later native Link write superseded the completed preimage inverse")
        }
        return { ...identity, status: "alreadyCompensated", changedPairs: changedPairs(record) }
      }
      for (const change of record.changes) {
        const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, change))
        if (revision?.value.revision !== change.afterRevision ||
          linkPreimageRowKey(current.get(pairKey(change)) ?? null) !== linkPreimageRowKey(change.after))
          throw linkOperationConflict("A later native Link write superseded preimage compensation ownership")
      }
      const changed = record.changes.filter(change => linkPreimageRowKey(change.before) !== linkPreimageRowKey(change.after))
      const dismiss = changed.filter(change => change.after !== null && change.after.deleted_at === null)
      if (dismiss.length) await this.rows.dismiss(dismiss, owned)
      const restore: Row[] = []
      for (const change of changed) if (change.before !== null) restore.push(change.before)
      if (restore.length) await this.rows.restore(restore, owned)

      const restored = rowMap(await this.store.capturePreimages(record.changes, owned)), finalRevisions = await this.store.revisions(record.changes, owned)
      const changes: Completed["changes"][number][] = []
      for (const change of record.changes) {
        const value = restored.get(pairKey(change)) ?? null, revision = finalRevisions.get(await linkPairRevisionId(this.store.serviceName, change))
        if (revision === undefined) throw unexpected("Missing native Link inverse write fence")
        if (change.before !== null ? linkPreimageRowKey(value) !== linkPreimageRowKey(change.before)
          : change.after === null ? value !== null : value === null || value.id !== change.after.id || value.deleted_at === null)
          throw unexpected("Native Link inverse did not restore its retained preimage")
        changes.push({ ...change, compensated: value, compensatedRevision: revision.value.revision })
      }
      await this.store.completePreimage(operation, changes, owned)
      return { ...identity, status: "compensated", changedPairs: changedPairs(record) }
    })
  }
}
