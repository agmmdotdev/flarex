/** Convex indexing/index_registry.rs at db914cf06. Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0. */
import { Result } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CorePersistenceError } from "./contracts";
import { captureCoreIndexRecord, isCoreIndexEnabled, type CoreIndexRecord } from "./indexState";
export interface CoreIndexesByName { readonly enabled?: CoreIndexRecord; readonly pending?: CoreIndexRecord }
const corrupt = (cause: string) => new CorePersistenceError({ reason: "corruptData", cause });
/** COW roots mirror source identity and tablet registries; name lookup never scans other tables. */
export class CoreIndexRegistry {
  private readonly previous: WeakRef<CoreIndexRegistry> | undefined;
  private constructor(private readonly byIdentity: BTree<string, CoreIndexRecord>,
    private readonly byTablet: BTree<string, readonly CoreIndexRecord[]>, readonly changedTablets: readonly Uint8Array[] = [], previous?: CoreIndexRegistry) {
    this.previous = previous === undefined ? undefined : new WeakRef(previous);
  }
  get records(): Pick<BTree<string, CoreIndexRecord>, "get" | "has" | "values" | "entries" | "keys" | "size"> { return this.byIdentity; }
  changedTabletsFrom(previous: CoreIndexRegistry): readonly Uint8Array[] {
    if (this === previous) return [];
    if (this.previous?.deref() === previous) return this.changedTablets;
    // A detached root is still safe to install; cold replacement projects the full tablet union.
    const tablets = new Map<string, Uint8Array>();
    for (const root of [previous, this]) for (const record of root.byIdentity.values())
      tablets.set(encodeBytesToLowercaseHex(record.tableId), record.tableId);
    return [...tablets.values()];
  }
  static empty(): CoreIndexRegistry { return new CoreIndexRegistry(new BTree<string, CoreIndexRecord>(), new BTree<string, readonly CoreIndexRecord[]>()); }
  byId(id: Uint8Array): CoreIndexRecord | undefined { return this.byIdentity.get(encodeBytesToLowercaseHex(id)); }
  forTablet(tableId: Uint8Array): readonly CoreIndexRecord[] { return this.byTablet.get(encodeBytesToLowercaseHex(tableId)) ?? []; }
  byName(tableId: Uint8Array, name: string): CoreIndexesByName {
    const records = this.forTablet(tableId).filter(index => index.name === name);
    const enabled = records.find(isCoreIndexEnabled), pending = records.find(index => !isCoreIndexEnabled(index));
    return { ...(enabled === undefined ? {} : { enabled }), ...(pending === undefined ? {} : { pending }) };
  }
  apply(changes: Readonly<{ removed: readonly Uint8Array[]; added: readonly CoreIndexRecord[] }>)
    : Result.Result<CoreIndexRegistry, CorePersistenceError> {
    const records = this.byIdentity.clone(), byTablet = this.byTablet.clone();
    const affected = new Map<string, Uint8Array>();
    const remove = (id: Uint8Array) => {
      const key = encodeBytesToLowercaseHex(id), old = records.get(key);
      if (old === undefined) return;
      records.delete(key);
      const tablet = encodeBytesToLowercaseHex(old.tableId);
      byTablet.set(tablet, (byTablet.get(tablet) ?? []).filter(index => !bytesEqual(index.ref.id, id)));
      affected.set(tablet, old.tableId);
    };
    for (const id of changes.removed) remove(id);
    for (const input of changes.added) {
      const previous = this.byId(input.ref.id);
      if (previous !== undefined && (!bytesEqual(previous.tableId, input.tableId)
        || previous.fields.length !== input.fields.length || previous.fields.some((field, i) => field !== input.fields[i])
        || (previous.name === "by_id" || previous.name === "by_creation_time") && previous.name !== input.name))
        return Result.fail(corrupt("Index identity changed its immutable specification"));
      remove(input.ref.id);
      const record = captureCoreIndexRecord(input), tablet = encodeBytesToLowercaseHex(record.tableId);
      records.set(encodeBytesToLowercaseHex(record.ref.id), record);
      byTablet.set(tablet, Object.freeze([...(byTablet.get(tablet) ?? []), record]));
      affected.set(tablet, record.tableId);
    }
    for (const tablet of affected.keys()) {
      const names = new Set<string>();
      for (const record of byTablet.get(tablet) ?? []) {
        if (record.name === "by_id" && !isCoreIndexEnabled(record)) return Result.fail(corrupt("Intrinsic by-ID index must be enabled"));
        const key = JSON.stringify([record.name, isCoreIndexEnabled(record)]);
        if (names.has(key)) return Result.fail(corrupt("Duplicate enabled or pending index name"));
        names.add(key);
      }
    }
    return Result.succeed(new CoreIndexRegistry(records, byTablet, [...affected.values()], this));
  }
  without(id: Uint8Array): CoreIndexRegistry {
    const previous = this.byId(id);
    if (previous === undefined) return this;
    const records = this.byIdentity.clone(), byTablet = this.byTablet.clone();
    records.delete(encodeBytesToLowercaseHex(id));
    const tablet = encodeBytesToLowercaseHex(previous.tableId);
    byTablet.set(tablet, (byTablet.get(tablet) ?? []).filter(index => !bytesEqual(index.ref.id, id)));
    return new CoreIndexRegistry(records, byTablet, [previous.tableId], this);
  }
}
