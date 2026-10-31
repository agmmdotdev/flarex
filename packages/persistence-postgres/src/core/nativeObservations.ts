/** Native observation policy extends the source transaction, not its pending writes. */
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CoreIndexDefinition, CoreTableDefinition } from "./api";
import type { CoreDocumentLogEntry, CoreInterval } from "./contracts";
import { CoreReadSetBuilder, copyInterval, type CoreReadSet } from "./writeLog";

export interface CoreNativeUniqueSlot {
  readonly table: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
  readonly interval: CoreInterval;
  /** First captured committed owners. The candidate's pending writes are separate. */
  readonly owners: readonly string[];
}

export interface CoreNativeObservations {
  readonly dependencies: readonly Readonly<{ timestamp: bigint; reads: CoreReadSet }>[];
  readonly uniqueSlots: readonly CoreNativeUniqueSlot[];
}

export interface CoreNativeDocumentObservation {
  readonly original: CoreDocumentLogEntry | undefined;
  readonly document: DocumentObject | null;
}

export interface CoreNativeMembership {
  readonly timestamp: bigint;
  /** Physical committed rows, before earlier semantic observations or pending writes. */
  readonly rows: readonly Readonly<{ id: string; observation: CoreNativeDocumentObservation }>[];
}

/** Only explicit native observations enter here; index-cache hydration has no authority. */
export class CoreNativeObservationState {
  private readonly originals = new Map<string, Readonly<{ tablet: string; observation: CoreNativeDocumentObservation }>>();
  private readonly tables = new Set<string>();
  private readonly slots = new Map<string, Readonly<{ slot: CoreNativeUniqueSlot; membership: CoreNativeMembership; observed: boolean }>>();
  private readonly dependencies = new Map<bigint, CoreReadSetBuilder>();

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

  slot(index: CoreIndexDefinition, interval: CoreInterval, releaseOnly = false): CoreNativeMembership | undefined {
    const entry = this.slots.get(slotIdentity(index, interval));
    // A removed key participates in final validation without granting a native
    // query the membership of a key that the callback has never requested.
    return entry !== undefined && (entry.observed || releaseOnly) ? entry.membership : undefined;
  }

  rememberSlot(slot: CoreNativeUniqueSlot, membership: CoreNativeMembership, observed = true): void {
    const identity = slotIdentity(slot.index, slot.interval);
    const previous = this.slots.get(identity);
    if (previous !== undefined) {
      if (!previous.observed && observed) this.slots.set(identity, { ...previous, membership, observed });
      return;
    }
    this.slots.set(identity, { slot: Object.freeze({ ...slot, interval: copyInterval(slot.interval),
      owners: Object.freeze([...slot.owners].toSorted()) }), membership, observed });
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
    return Object.freeze({ dependencies: Object.freeze([...this.dependencies].map(([timestamp, reads]) =>
      Object.freeze({ timestamp, reads: reads.snapshot() }))),
    uniqueSlots: Object.freeze([...this.slots.values()].map(entry => entry.slot)) });
  }
}

function slotIdentity(index: CoreIndexDefinition, interval: CoreInterval): string {
  return `${encodeBytesToLowercaseHex(index.ref.id)}:${interval.start === null ? "-" : encodeBytesToLowercaseHex(interval.start)}:${interval.end === null ? "+" : encodeBytesToLowercaseHex(interval.end)}`;
}
