/** Native observation policy extends the source transaction, not its pending writes. */
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreIndexDefinition, type CoreNativeLimits, type CoreTableDefinition } from "./api";
import { Result } from "effect";
import type { CoreDocumentLogEntry, CoreInterval } from "./contracts";
import { CoreReadSetBuilder, copyInterval, type CoreReadSet } from "./writeLog";

export interface CoreNativeUniqueSlot {
  readonly kind: "unique";
  readonly table: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
  readonly interval: CoreInterval;
  /** First captured committed owners. The candidate's pending writes are separate. */
  readonly owners: readonly string[];
  readonly maxIdentities?: number;
}

export interface CoreNativeRangeSlot {
  readonly kind: "range";
  readonly table: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
  readonly interval: CoreInterval;
  readonly members: readonly Readonly<{ id: string; key: Uint8Array }>[];
  /** A page observation carries its source's finite capture allowance. */
  readonly maxIdentities?: number;
}
export type CoreNativeIndexObservation = CoreNativeUniqueSlot | CoreNativeRangeSlot;

export interface CoreNativeObservations {
  readonly limits: CoreNativeLimits;
  readonly identities?: readonly string[];
  readonly sourceCaptures?: readonly Readonly<{ sourceKey: string; tablets: readonly string[];
    limits: CoreNativeLimits; identities: readonly string[] }>[];
  readonly dependencies: readonly Readonly<{ timestamp: bigint; reads: CoreReadSet }>[];
  readonly indexes: readonly CoreNativeIndexObservation[];
}

export interface CoreNativeDocumentObservation {
  /** Semantic capture frontier S, distinct from the original's revision R. */
  readonly observedAt: bigint;
  readonly original: CoreDocumentLogEntry | undefined;
  readonly document: DocumentObject | null;
}

export interface CoreNativeMembership {
  readonly timestamp: bigint;
  /** Physical committed rows, before earlier semantic observations or pending writes. */
  readonly rows: readonly Readonly<{ id: string; key: Uint8Array; observation: CoreNativeDocumentObservation }>[];
}

/** The slot memo owns membership only; semantic bodies live in originals. */
export interface CoreNativeSlotMembership {
  readonly timestamp: bigint;
  readonly members: readonly Readonly<{ id: string; key: Uint8Array }>[];
}

/** Only explicit native observations enter here; index-cache hydration has no authority. */
export class CoreNativeObservationState {
  private readonly originals = new Map<string, Readonly<{ tablet: string; observation: CoreNativeDocumentObservation }>>();
  private readonly tables = new Set<string>();
  private readonly slots = new Map<string, Readonly<{ slot: CoreNativeUniqueSlot; membership: CoreNativeSlotMembership; observed: boolean }>>();
  private readonly dependencies = new Map<bigint, CoreReadSetBuilder>();
  private readonly ranges = new Map<string, CoreNativeRangeSlot>();
  private readonly pages: CoreNativeRangeSlot[] = [];
  private readonly identities = new Set<string>();
  private readonly sourceIdentities = new Map<string, Set<string>>();
  private readonly sourcesByTablet = new Map<string, Readonly<{ sourceKey: string; limits: CoreNativeLimits }>>();

  constructor(private readonly limits: CoreNativeLimits, sources?: readonly Readonly<{
    sourceKey: string; tables: readonly CoreTableDefinition[]; limits: CoreNativeLimits;
  }>[]) {
    for (const source of sources ?? []) for (const table of source.tables)
      this.sourcesByTablet.set(encodeBytesToLowercaseHex(table.tabletId), source);
  }

  limitsFor(table: CoreTableDefinition): Result.Result<CoreNativeLimits, CoreTransactionError> {
    if (this.sourcesByTablet.size === 0) return Result.succeed(this.limits);
    const source = this.sourcesByTablet.get(encodeBytesToLowercaseHex(table.tabletId));
    return source === undefined ? Result.fail(new CoreTransactionError({ reason: "authorityRevoked" })) : Result.succeed(source.limits);
  }

  reserve(table: CoreTableDefinition, ids: readonly string[]): Result.Result<void, CoreTransactionError> {
    const source = this.sourcesByTablet.get(encodeBytesToLowercaseHex(table.tabletId));
    if (this.sourcesByTablet.size > 0 && source === undefined)
      return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    const additions = new Set(ids.filter(id => !this.identities.has(id)));
    if (this.identities.size + additions.size > this.limits.maxIdentities)
      return Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native captured identity limit" }));
    if (source !== undefined) {
      const captured = this.sourceIdentities.get(source.sourceKey) ?? new Set<string>();
      const sourceAdditions = new Set(ids.filter(id => !captured.has(id)));
      if (captured.size + sourceAdditions.size > source.limits.maxIdentities)
        return Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native source captured identity limit" }));
      for (const id of sourceAdditions) captured.add(id);
      this.sourceIdentities.set(source.sourceKey, captured);
    }
    for (const id of additions) this.identities.add(id);
    return Result.succeed(undefined);
  }

  original(id: string): CoreNativeDocumentObservation | undefined { return this.originals.get(id)?.observation; }

  remember(table: CoreTableDefinition, id: string, observation: CoreNativeDocumentObservation): CoreNativeDocumentObservation {
    const previous = this.originals.get(id);
    if (previous !== undefined) return previous.observation;
    this.originals.set(id, { tablet: encodeBytesToLowercaseHex(table.tabletId), observation });
    return observation;
  }

  remembered(table: CoreTableDefinition): readonly Readonly<{ id: string; observation: CoreNativeDocumentObservation }>[] {
    const tablet = encodeBytesToLowercaseHex(table.tabletId);
    return [...this.originals].flatMap(([id, entry]) => entry.tablet === tablet ? [{ id, observation: entry.observation }] : []);
  }

  hasTable(table: CoreTableDefinition): boolean {
    return this.tables.has(encodeBytesToLowercaseHex(table.tabletId));
  }

  rememberTable(table: CoreTableDefinition, membership: CoreNativeMembership): void {
    this.tables.add(encodeBytesToLowercaseHex(table.tabletId));
    for (const row of membership.rows) this.remember(table, row.id, row.observation);
  }

  slot(index: CoreIndexDefinition, interval: CoreInterval, releaseOnly = false): CoreNativeSlotMembership | undefined {
    const entry = this.slots.get(slotIdentity("unique", index, interval));
    // A removed key participates in final validation without granting a native
    // query the membership of a key that the callback has never requested.
    return entry !== undefined && (entry.observed || releaseOnly) ? entry.membership : undefined;
  }

  rememberSlot(slot: CoreNativeUniqueSlot, membership: CoreNativeSlotMembership, observed = true): void {
    const identity = slotIdentity("unique", slot.index, slot.interval);
    const previous = this.slots.get(identity);
    // Copy only membership evidence. Neither normal captures nor release-only
    // upgrades retain an extra body/revision cache or invent absence observations.
    const retained = Object.freeze({ timestamp: membership.timestamp,
      members: Object.freeze(membership.members.map(member => Object.freeze({ id: member.id, key: member.key.slice() }))) });
    if (previous !== undefined) {
      if (!previous.observed && observed) this.slots.set(identity, { ...previous, membership: retained, observed });
      return;
    }
    this.slots.set(identity, { slot: Object.freeze({ ...slot, interval: copyInterval(slot.interval),
      owners: Object.freeze([...slot.owners].toSorted()) }), membership: retained, observed });
  }

  range(index: CoreIndexDefinition, interval: CoreInterval): CoreNativeRangeSlot | undefined {
    return this.ranges.get(slotIdentity("range", index, interval));
  }

  rememberRange(slot: CoreNativeRangeSlot): void {
    const identity = slotIdentity("range", slot.index, slot.interval);
    if (!this.ranges.has(identity)) this.ranges.set(identity, Object.freeze({ ...slot,
      interval: copyInterval(slot.interval), members: Object.freeze(slot.members.map(member =>
        Object.freeze({ id: member.id, key: member.key.slice() }))) }));
  }

  /** Fresh native windows are independently observed, rather than memoized ranges. */
  rememberPage(slot: CoreNativeRangeSlot): void {
    this.pages.push(Object.freeze({ ...slot, interval: copyInterval(slot.interval),
      members: Object.freeze(slot.members.map(member => Object.freeze({ id: member.id, key: member.key.slice() }))) }));
  }

  addReads(timestamp: bigint, reads: CoreReadSet): void {
    let group = this.dependencies.get(timestamp);
    if (group === undefined) {
      group = new CoreReadSetBuilder();
      this.dependencies.set(timestamp, group);
    }
    for (const read of reads) for (const interval of read.intervals) group.add(read.indexId, interval);
  }

  snapshot(): CoreNativeObservations {
    const indexes: CoreNativeIndexObservation[] = [...this.slots.values()].map(entry => entry.slot);
    indexes.push(...this.ranges.values());
    indexes.push(...this.pages);
    const sources = new Map<string, { tablets: string[]; limits: CoreNativeLimits }>();
    for (const [tablet, source] of this.sourcesByTablet) {
      let capture = sources.get(source.sourceKey);
      if (capture === undefined) { capture = { tablets: [], limits: source.limits }; sources.set(source.sourceKey, capture); }
      capture.tablets.push(tablet);
    }
    return Object.freeze({ limits: Object.freeze({ ...this.limits }),
      identities: Object.freeze([...this.identities]),
      sourceCaptures: Object.freeze([...sources].map(([sourceKey, capture]) => Object.freeze({ sourceKey,
        tablets: Object.freeze(capture.tablets), limits: Object.freeze({ ...capture.limits }),
        identities: Object.freeze([...(this.sourceIdentities.get(sourceKey) ?? [])]) }))),
      dependencies: Object.freeze([...this.dependencies].map(([timestamp, reads]) =>
      Object.freeze({ timestamp, reads: reads.snapshot() }))),
    indexes: Object.freeze(indexes) });
  }
}

function slotIdentity(kind: CoreNativeIndexObservation["kind"], index: CoreIndexDefinition, interval: CoreInterval): string {
  return `${kind}:${encodeBytesToLowercaseHex(index.ref.id)}:${interval.start === null ? "-" : encodeBytesToLowercaseHex(interval.start)}:${interval.end === null ? "+" : encodeBytesToLowercaseHex(interval.end)}`;
}
