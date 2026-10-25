import type { Context, LinkOperationCompensation, LinkOperationResult } from "@medusajs/framework/types"
import { moduleEventData } from "@medusajs/utils/modules-sdk/event-builder-factory"
import { generateEntityId } from "@medusajs/utils/common/generate-entity-id"
import { MedusaError } from "@medusajs/utils/common/errors"
import { decodeLinkOperationHandle, decodeLinkOperationRequest, linkOperationConflict,
  linkOperationRequestKey, linkPairRevisionId, type LinkOperationPair, type LinkOperationRecord } from "./contracts"
import type { LinkOperationStore } from "./store"

type Pair = typeof LinkOperationPair.Type
type Record = typeof LinkOperationRecord.Type
type Intent = Record["events"][number]
const pairKey = (pair: Pair) => JSON.stringify([pair.primary, pair.foreign])
interface LinkRows {
  active(pairs: readonly Pair[], context: Context): Promise<readonly Pair[]>
  create(pairs: readonly Pair[], context: Context): Promise<readonly { id: string }[]>
  dismiss(pairs: readonly Pair[], context: Context): Promise<readonly { id: string }[]>
  restore(pairs: readonly Pair[], context: Context): Promise<readonly { id: string }[]>
}

function eventIntents(rows: readonly { id: string }[], action: Intent["action"]): Intent[] {
  const data = moduleEventData(rows)
  return data === undefined ? [] : [{ ...data, action, event_id: generateEntityId(undefined, "lev") }]
}

/** Native Link orchestration. The selected store owns isolation; LinkRows is
 * bound only to the genuine lower Link service in the module constructor. */
export class LinkOperationService {
  constructor(readonly store: LinkOperationStore, readonly rows: LinkRows) {}

  private async orderedPairs(pairs: readonly Pair[]): Promise<Pair[]> {
    const keyed = new Map<string, Pair>()
    for (const pair of pairs) keyed.set(await linkPairRevisionId(this.store.serviceName, pair), pair)
    return [...keyed].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, pair]) => pair)
  }

  private async presence(pairs: readonly Pair[], context: Context): Promise<Set<string>> {
    const expected = new Set(pairs.map(pairKey)), active = new Set<string>()
    if (pairs.length === 0) return active
    for (const pair of await this.rows.active(pairs, context)) {
      const key = pairKey(pair)
      if (!expected.has(key) || active.has(key)) {
        throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Duplicate or mismatched native Link endpoint pair")
      }
      active.add(key)
    }
    return active
  }

  async apply(input: unknown, context: Context): Promise<{ result: LinkOperationResult; events: readonly Intent[] }> {
    const request = structuredClone(decodeLinkOperationRequest(input))
    return await this.store.withTransaction(context, async owned => {
      const existing = await this.store.operation(request.operationId, owned)
      if (existing !== undefined) {
        if (linkOperationRequestKey(existing.value.request) !== linkOperationRequestKey(request)) {
          throw linkOperationConflict("Native Link operation identity was reused with a different request")
        }
        return { result: { operationId: request.operationId, serviceName: this.store.serviceName,
          state: existing.value.state, changedPairs: existing.value.changes.length, replayed: true }, events: [] }
      }
      const pairs = await this.orderedPairs([...request.add, ...request.remove])
      // Acquire the complete write cohort in one deterministic head order
      // before action-specific native writers can acquire any subset of it.
      await this.store.rotate(pairs, owned)
      const before = await this.presence(pairs, owned)

      // The lower owner rotates all requested heads before its normal writes.
      // Keep duplicate/order semantics of the caller's actual native request.
      const created = request.add.length === 0 ? [] : await this.rows.create(request.add, owned)
      const dismissed = request.remove.length === 0 ? [] : await this.rows.dismiss(request.remove, owned)
      const after = await this.presence(pairs, owned), revisions = await this.store.revisions(pairs, owned)
      const changes: Record["changes"][number][] = []
      for (const pair of pairs) {
        const beforeActive = before.has(pairKey(pair)), afterActive = after.has(pairKey(pair))
        if (beforeActive === afterActive) continue
        const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, pair))
        if (revision === undefined) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Missing native Link write fence")
        changes.push({ ...pair, beforeActive, afterActive, afterRevision: revision.value.revision })
      }
      const events: Intent[] = [
        ...eventIntents(created, "attached"),
        ...eventIntents(dismissed, "detached"),
      ]
      await this.store.insert({ id: request.operationId, service_name: this.store.serviceName,
        request, state: "applied", changes, events, compensation_events: [] }, owned)
      return { result: { operationId: request.operationId, serviceName: this.store.serviceName,
        state: "applied", changedPairs: changes.length, replayed: false }, events }
    })
  }

  async compensate(input: unknown, context: Context): Promise<{ result: LinkOperationCompensation; events: readonly Intent[] }> {
    const handle = structuredClone(decodeLinkOperationHandle(input))
    const identity = { operationId: handle.operationId, serviceName: handle.serviceName }
    if (handle.serviceName !== this.store.serviceName) throw linkOperationConflict("Native Link compensation selected another module")
    return await this.store.withTransaction(context, async owned => {
      const found = await this.store.operation(handle.operationId, owned)
      if (found === undefined) {
        // This insert arbitrates with an apply that has not committed. A late
        // apply must lose its entire transaction instead of resurrecting work.
        await this.store.insert({ id: handle.operationId, service_name: this.store.serviceName,
          request: handle.request, state: "cancelled", changes: [], events: [], compensation_events: [] }, owned)
        return { result: { ...identity, status: "notApplied", changedPairs: 0 }, events: [] }
      }
      if (linkOperationRequestKey(found.value.request) !== linkOperationRequestKey(handle.request)) {
        throw linkOperationConflict("Native Link compensation request differs from its retained operation")
      }
      if (found.value.state !== "applied") {
        return { result: { ...identity, status: found.value.state === "compensated" ? "alreadyCompensated" : "notApplied",
          changedPairs: found.value.changes.length }, events: [] }
      }
      // Check every fence before touching any pair. Current presence alone can
      // never establish that an earlier compensation succeeded.
      const revisions = await this.store.revisions(found.value.changes, owned)
      const active = await this.presence(found.value.changes, owned)
      for (const change of found.value.changes) {
        const revision = revisions.get(await linkPairRevisionId(this.store.serviceName, change))
        if (revision?.value.revision !== change.afterRevision || active.has(pairKey(change)) !== change.afterActive) {
          throw linkOperationConflict("A later native Link write superseded compensation ownership")
        }
      }
      const events: Intent[] = []
      // Match native compensation boundaries: dismiss newly attached rows,
      // then restore the prior associations, one event per returned batch.
      for (const beforeActive of [false, true]) {
        const changes = found.value.changes.filter(change => change.beforeActive === beforeActive)
        if (changes.length === 0) continue
        const rows = beforeActive ? await this.rows.restore(changes, owned) : await this.rows.dismiss(changes, owned)
        if (rows.length !== changes.length) {
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link inverse did not restore its owned preimage")
        }
        const restored = await this.presence(changes, owned)
        if (restored.size !== (beforeActive ? changes.length : 0)) {
          throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Native Link inverse did not restore its owned preimage")
        }
        events.push(...eventIntents(rows, beforeActive ? "attached" : "detached"))
      }
      await this.store.complete(found, events, owned)
      return { result: { ...identity, status: "compensated", changedPairs: found.value.changes.length }, events }
    })
  }
}
