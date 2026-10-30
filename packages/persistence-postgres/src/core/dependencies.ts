/**
 * Mechanisms translated from Convex crates/database/src/writes.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Result } from "effect";
import { compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { CoreTransactionError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { INDEXES, TABLES, publicDocumentId, type CoreRegistry } from "./registry";
import type { CoreDocumentChange } from "./transaction";
import { CoreReadSetBuilder, pointInterval, type CoreIndexKeys } from "./writeLog";

/** Conflict-only _index.by_table_id, as Writes::record_reads_for_write; never persisted. */
function virtualIndexIdentity(registry: CoreRegistry): Result.Result<Uint8Array, CoreTransactionError> {
  const table = registry.table(INDEXES);
  if (table === undefined) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
  // Physical index identities have16bytes. This domain-separated logical name has17.
  const name = new Uint8Array(17);
  name[0] = 255;
  name.set(table.definition.tabletId, 1);
  return Result.succeed(name);
}

function prefixInterval(prefix: Uint8Array) {
  let position = prefix.length - 1;
  while (position >= 0 && prefix[position] === 255) position -= 1;
  if (position < 0) return { start: prefix, end: null };
  const end = prefix.slice(0, position + 1);
  end[position] = (end[position] ?? 0) + 1;
  return { start: prefix, end };
}

export function addIndexMetadataDependency(reads: CoreReadSetBuilder, registry: CoreRegistry,
  index: CoreIndexDefinition): Result.Result<void, CoreTransactionError> {
  return Result.gen(function* () {
    const table = registry.table(INDEXES)?.definition;
    const byId = table?.indexes.find(candidate => candidate.name === "by_id");
    if (table === undefined || byId === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    const id = yield* publicDocumentId(table, index.ref.id);
    const key = yield* Result.mapError(encodeIndexKey([], id), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(byId.ref.id, pointInterval(key));
  });
}

export function addTableWriteDependencies(reads: CoreReadSetBuilder, registry: CoreRegistry,
  table: CoreTableDefinition): Result.Result<void, CoreTransactionError> {
  return Result.gen(function* () {
    if (table.name === TABLES || table.name === INDEXES) {
      for (const name of [TABLES, INDEXES]) {
        const byId = registry.table(name)?.definition.indexes.find(index => index.name === "by_id");
        if (byId === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
        reads.add(byId.ref.id, { start: null, end: null });
      }
      return;
    }
    const metadata = registry.table(TABLES)?.definition;
    const byId = metadata?.indexes.find(index => index.name === "by_id");
    const record = registry.table(table.name);
    if (metadata === undefined || byId === undefined || record === undefined)
      return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    const tableId = yield* publicDocumentId(metadata, record.id);
    const tableKey = yield* Result.mapError(encodeIndexKey([], tableId), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(byId.ref.id, pointInterval(tableKey));
    const virtual = yield* virtualIndexIdentity(registry);
    const key = yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(table.tabletId)), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(virtual, prefixInterval(key));
  });
}

export function metadataConflictKeys(registry: CoreRegistry,
  changes: readonly CoreDocumentChange[]): Result.Result<readonly CoreIndexKeys[], CoreTransactionError> {
  return Result.gen(function* () {
    const keys = new BTree<Uint8Array, true>(undefined, compareBytesLexicographically);
    for (const change of changes) {
      if (change.table.name !== INDEXES) continue;
      for (const document of [change.originalDocument, change.finalDocument]) {
        if (document === null) continue;
        const number = document.tableNumber;
        const target = typeof number === "number" ? registry.tableByNumber(number) : undefined;
        if (target === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
        const key = yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(target.definition.tabletId)), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
        keys.set(key, true);
      }
    }
    if (keys.size === 0) return Object.freeze([]);
    return Object.freeze([{ indexId: yield* virtualIndexIdentity(registry), keys: Object.freeze([...keys.keys()]) }]);
  });
}
