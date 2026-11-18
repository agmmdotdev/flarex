/**
 * Selected resident metadata indexes translated from Convex
 * crates/indexing/src/database_index_snapshot.rs at
 * db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Result } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { CoreIndexDefinition, CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreHydratedIndexEntry,
  type CoreIndexPage, type CoreIndexRef, type CoreIndexScan } from "./contracts";
import { documentIndexKey } from "./documentIndex";
import { INDEXES, PROGRAMS, TABLES, readDocumentObject, type CoreRegistry } from "./registry";

interface ResidentIndex {
  readonly ref: CoreIndexRef;
  readonly fields: readonly string[];
  readonly entries: BTree<Uint8Array, CoreDocumentLogEntry>;
}

interface ResidentTable {
  readonly definition: CoreTableDefinition;
  readonly documents: BTree<string, CoreDocumentLogEntry>;
  readonly indexes: ReadonlyMap<string, ResidentIndex>;
}

function ownedRevision(entry: CoreDocumentLogEntry): CoreDocumentLogEntry {
  return Object.freeze({ ...entry, tableId: entry.tableId.slice(), id: entry.id.slice(), jsonValue: entry.jsonValue.slice() });
}

function corrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}

function sameIndex(index: CoreIndexDefinition, resident: ResidentIndex): boolean {
  return index.ref.persistenceIndexId === resident.ref.persistenceIndexId && bytesEqual(index.ref.id, resident.ref.id)
    && index.fields.length === resident.fields.length && index.fields.every((field, position) => field === resident.fields[position]);
}

function emptyIndex(index: CoreIndexDefinition): ResidentIndex {
  return Object.freeze({ ref: Object.freeze({ ...index.ref, id: index.ref.id.slice() }), fields: Object.freeze([...index.fields]),
    entries: new BTree<Uint8Array, CoreDocumentLogEntry>(undefined, compareBytesLexicographically) });
}

/** Full builds happen only on bootstrap or a new/changed resident index. */
function buildIndex(definition: CoreTableDefinition, index: CoreIndexDefinition,
  documents: BTree<string, CoreDocumentLogEntry>): Result.Result<ResidentIndex, CorePersistenceError> {
  return Result.gen(function* () {
    const resident = emptyIndex(index);
    for (const entry of documents.values()) {
      const document = yield* readDocumentObject(entry, definition);
      const key = yield* Result.mapError(documentIndexKey(index, document), corrupt);
      if (resident.entries.has(key)) return yield* Result.fail(corrupt());
      resident.entries.set(key, entry);
    }
    return resident;
  });
}

function buildTable(definition: CoreTableDefinition,
  documents: BTree<string, CoreDocumentLogEntry>): Result.Result<ResidentTable, CorePersistenceError> {
  return Result.gen(function* () {
    const indexes = new Map<string, ResidentIndex>();
    for (const index of definition.indexes)
      indexes.set(encodeBytesToLowercaseHex(index.ref.id), yield* buildIndex(definition, index, documents));
    return Object.freeze({ definition, documents, indexes });
  });
}

/** Clone the resident roots, then remove/add only the changed rows' keys. */
function updateTable(previous: ResidentTable, definition: CoreTableDefinition,
  changes: readonly CoreDocumentLogEntry[]): Result.Result<ResidentTable, CorePersistenceError> {
  return Result.gen(function* () {
    const documents = changes.length === 0 ? previous.documents : previous.documents.clone();
    const indexes = new Map<string, ResidentIndex>();
    const unchanged: Array<Readonly<{ definition: CoreIndexDefinition; resident: ResidentIndex }>> = [];
    const rebuild: CoreIndexDefinition[] = [];
    for (const index of definition.indexes) {
      const id = encodeBytesToLowercaseHex(index.ref.id);
      const old = previous.indexes.get(id);
      if (old !== undefined && sameIndex(index, old) && definition.number === previous.definition.number) {
        const resident = changes.length === 0 ? old : Object.freeze({ ...old, entries: old.entries.clone() });
        indexes.set(id, resident);
        unchanged.push({ definition: index, resident });
      } else rebuild.push(index);
    }
    for (const revision of changes) {
      const id = encodeBytesToLowercaseHex(revision.id);
      const old = documents.get(id);
      const next = revision.deleted ? undefined : ownedRevision(revision);
      const oldDocument = old === undefined ? undefined : yield* readDocumentObject(old, previous.definition);
      const nextDocument = next === undefined ? undefined : yield* readDocumentObject(next, definition);
      for (const index of unchanged) {
        if (oldDocument !== undefined) {
          const key = yield* Result.mapError(documentIndexKey(index.definition, oldDocument), corrupt);
          if (!index.resident.entries.delete(key)) return yield* Result.fail(corrupt());
        }
        if (nextDocument !== undefined && next !== undefined) {
          const key = yield* Result.mapError(documentIndexKey(index.definition, nextDocument), corrupt);
          if (index.resident.entries.has(key)) return yield* Result.fail(corrupt());
          index.resident.entries.set(key, next);
        }
      }
      if (next === undefined) documents.delete(id);
      else documents.set(id, next);
    }
    for (const index of rebuild) indexes.set(encodeBytesToLowercaseHex(index.ref.id), yield* buildIndex(definition, index, documents));
    return Object.freeze({ definition, documents, indexes });
  });
}

/** Immutable snapshot roots. Only complete selected metadata tables are resident;
 * user rows and request outcomes continue through operation/shared/physical reads. */
export class CoreResidentIndexes {
  private constructor(private readonly tables: ReadonlyMap<string, ResidentTable>) { Object.freeze(this); }

  static create(registry: CoreRegistry, revisions: readonly CoreDocumentLogEntry[]): Result.Result<CoreResidentIndexes, CorePersistenceError> {
    return Result.gen(function* () {
      const tables = new Map<string, ResidentTable>();
      for (const name of [TABLES, INDEXES, PROGRAMS]) {
        const definition = registry.table(name)?.definition;
        if (definition === undefined) return yield* Result.fail(corrupt());
        const documents = new BTree<string, CoreDocumentLogEntry>();
        for (const revision of revisions) if (bytesEqual(revision.tableId, definition.tabletId) && !revision.deleted) {
          const id = encodeBytesToLowercaseHex(revision.id);
          if (documents.has(id)) return yield* Result.fail(corrupt());
          documents.set(id, ownedRevision(revision));
        }
        tables.set(encodeBytesToLowercaseHex(definition.tabletId), yield* buildTable(definition, documents));
      }
      return new CoreResidentIndexes(tables);
    });
  }

  apply(registry: CoreRegistry, revisions: readonly CoreDocumentLogEntry[]): Result.Result<CoreResidentIndexes, CorePersistenceError> {
    const tables = this.tables;
    return Result.gen(function* () {
      let next: Map<string, ResidentTable> | undefined;
      for (const [tableId, previous] of tables) {
        const definition = registry.table(previous.definition.name, previous.definition.namespace)?.definition;
        if (definition === undefined || !bytesEqual(definition.tabletId, previous.definition.tabletId))
          return yield* Result.fail(corrupt());
        const changed = revisions.filter(revision => bytesEqual(revision.tableId, definition.tabletId));
        if (changed.length === 0 && definition === previous.definition) continue;
        next ??= new Map(tables);
        next.set(tableId, yield* updateTable(previous, definition, changed));
      }
      return next === undefined ? undefined : new CoreResidentIndexes(next);
    }).pipe(Result.map(next => next ?? this));
  }

  scan(request: CoreIndexScan): CoreIndexPage | undefined {
    const table = this.tables.get(encodeBytesToLowercaseHex(request.tableId));
    const index = table?.indexes.get(encodeBytesToLowercaseHex(request.index.id));
    if (index === undefined || index.ref.persistenceIndexId !== request.index.persistenceIndexId) return undefined;
    const iterator = request.order === "asc" ? index.entries.entries(request.interval.start ?? undefined)
      : index.entries.entriesReversed(request.interval.end ?? undefined, undefined, request.interval.end !== null);
    const selected: Array<[Uint8Array, CoreDocumentLogEntry]> = [];
    let complete = true;
    for (const [key, document] of iterator) {
      if ((request.interval.start !== null && compareBytesLexicographically(key, request.interval.start) < 0)
        || (request.interval.end !== null && compareBytesLexicographically(key, request.interval.end) >= 0)) break;
      if (selected.length === request.maxResults) { complete = false; break; }
      selected.push([key, document]);
    }
    const entries: CoreHydratedIndexEntry[] = selected.map(([key, document]) => Object.freeze({ key: key.slice(), document: ownedRevision(document) }));
    const last = entries.at(-1);
    return Object.freeze({ entries: Object.freeze(entries), cursor: complete || last === undefined
      ? Object.freeze({ kind: "end" as const }) : Object.freeze({ kind: "after" as const, key: last.key.slice() }) });
  }
}
