import { Effect, Option, Schema } from "effect";
import { compareBytesLexicographically as compare } from "@flarex/utils/bytes";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence,
  type CorePersistenceIndexEntry, type CorePersistenceLease, type CorePersistenceSnapshot } from "../../../persistence-postgres/src/core/contracts";
import type { CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { timestampSchema } from "../../../persistence-postgres/src/database/corePersistence/rows";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const documentKey = (table: Uint8Array, id: Uint8Array) => hex(table) + ":" + hex(id);
const decodeTimestamp = Schema.decodeUnknownSync(timestampSchema);
const copyDocument = (row: CoreDocumentLogEntry): CoreDocumentLogEntry => ({ ...row,
  tableId: row.tableId.slice(), id: row.id.slice(), jsonValue: row.jsonValue.slice() });
const copyIndex = (row: CorePersistenceIndexEntry): CorePersistenceIndexEntry => ({ ...row,
  index: { ...row.index, id: row.index.id.slice() }, key: row.key.slice(),
  value: row.value === null ? null : { tableId: row.value.tableId.slice(), documentId: row.value.documentId.slice() },
  prev: row.prev === null ? null : { ...row.prev, documentId: row.prev.documentId.slice() } });
const timestampOrder = (a: { ts: bigint }, b: { ts: bigint }) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
const logOrder = (a: CoreDocumentLogEntry, b: Pick<CoreDocumentLogEntry, "ts" | "tableId" | "id">) =>
  timestampOrder(a, b) || compare(a.tableId, b.tableId) || compare(a.id, b.id);
const minimumQueryTimestamp = (queries: readonly { ts: bigint }[]) => queries.reduce<bigint | null>(
  (minimum, query) => minimum === null || query.ts < minimum ? query.ts : minimum, null);

/** Benchmark-only storage port. No commerce, schema or transaction business logic.
 * A single sequential writer, retained revisions and byte-ordered index scans.
 * Unsupported SQL predicate/history operations fail instead of returning success. */
export function makeMemoryPersistence() {
  const documents = new Map<string, CoreDocumentLogEntry[]>();
  const indexes = new Map<string, Map<string, CorePersistenceIndexEntry[]>>();
  const globals = new Map<string, Uint8Array>();
  const issued = new WeakSet<CorePersistenceLease>();
  const calls: Record<string, number> = {};
  let generation = 0n;
  let measureBodies = false;
  let bodyCpuUs = 0;
  const operation = <A>(name: string, work: () => A): Effect.Effect<A, CorePersistenceError> => Effect.suspend(() => {
    calls[name] = (calls[name] ?? 0) + 1;
    const before = measureBodies ? process.threadCpuUsage() : undefined;
    try { return Effect.succeed(work()); }
    catch (cause) { return cause instanceof CorePersistenceError ? Effect.fail(cause) : Effect.die(cause); }
    finally { if (before !== undefined) { const elapsed = process.threadCpuUsage(before); bodyCpuUs += elapsed.user + elapsed.system; } }
  });
  const invalid = (cause: string): never => { throw new CorePersistenceError({ reason: "corruptData", cause }); };
  const fence = (lease: CorePersistenceLease) => {
    if (!issued.has(lease) || lease.token !== generation) throw new CorePersistenceError({ reason: "leaseLost" });
  };
  const latest = (versions: readonly CoreDocumentLogEntry[] | undefined, at: bigint) =>
    versions?.findLast(row => row.ts <= at);
  const globalTimestamp = (key: string) => {
    const value = globals.get(key);
    return value === undefined ? 0n : decodeTimestamp(new TextDecoder("utf-8", { fatal: true }).decode(value));
  };
  const bounds = () => ({ indexMinimumTimestamp: globalTimestamp("min_snapshot_ts"),
    documentMinimumTimestamp: globalTimestamp("document_min_snapshot_ts") });
  const retentionValidator = {
    validateIndex: (at: bigint) => operation("validateIndex", () => {
      if (at < bounds().indexMinimumTimestamp) throw new CorePersistenceError({ reason: "outOfRetention" });
    }),
    validateDocument: (at: bigint) => operation("validateDocument", () => {
      if (at < bounds().documentMinimumTimestamp) throw new CorePersistenceError({ reason: "outOfRetention" });
    }),
  };
  const writeIndexes = (rows: readonly CorePersistenceIndexEntry[], overwrite: boolean) => {
    for (const input of rows) {
      const row = copyIndex(input), id = hex(row.index.id), key = hex(row.key);
      let entries = indexes.get(id);
      if (entries === undefined) { entries = new Map(); indexes.set(id, entries); }
      const versions = entries.get(key) ?? [];
      const existing = versions.findIndex(value => value.ts === row.ts);
      if (existing >= 0) {
        if (!overwrite) invalid("Duplicate index version");
        versions[existing] = row;
      } else versions.push(row);
      versions.sort(timestampOrder);
      entries.set(key, versions);
    }
  };
  const unsupported = (name: string) => Effect.die(new Error("Unsupported benchmark storage operation: " + name));
  const persistence: CorePersistence = {
    retentionValidator,
    evaluateRelational: () => unsupported("evaluateRelational"),
    loadIndexHistory: () => unsupported("loadIndexHistory"),
    acquireLease: () => operation("acquireLease", () => {
      const lease = Object.freeze({ token: ++generation }); issued.add(lease); return lease;
    }),
    latestTimestamp: lease => operation("latestTimestamp", () => {
      fence(lease); let at = globalTimestamp("max_repeatable_ts");
      for (const versions of documents.values()) { const row = versions.at(-1); if (row !== undefined && row.ts > at) at = row.ts; }
      return at;
    }),
    isFresh: lease => operation("isFresh", () => { fence(lease); return documents.size === 0 && indexes.size === 0 && globalTimestamp("max_repeatable_ts") === 0n; }),
    readRetentionBounds: lease => operation("readRetentionBounds", () => { fence(lease); return bounds(); }),
    readSnapshot: (at, retention = retentionValidator) => Effect.gen(function* (): Effect.fn.Return<CorePersistenceSnapshot, CorePersistenceError> {
      yield* retention.validateIndex(at);
      return {
        timestamp: at,
        get: (tableId, id) => Effect.gen(function* () {
          yield* retention.validateDocument(at);
          return yield* operation("get", () => {
            const row = latest(documents.get(documentKey(tableId, id)), at);
            return row === undefined ? Option.none() : Option.some(copyDocument(row));
          });
        }),
        scan: request => Effect.gen(function* () {
          yield* retention.validateIndex(at);
          return yield* operation("scan", () => {
            const selected = [];
            for (const versions of indexes.get(hex(request.index.id))?.values() ?? []) {
              const row = versions.findLast(value => value.ts <= at);
              if (row === undefined || row.value === null ||
                request.interval.start !== null && compare(row.key, request.interval.start) < 0 ||
                request.interval.end !== null && compare(row.key, request.interval.end) >= 0) continue;
              const document = documents.get(documentKey(row.value.tableId, row.value.documentId))?.find(value => value.ts === row.ts);
              if (document === undefined) return invalid("Missing exact index anchor");
              if (document.deleted || compare(document.tableId, request.tableId) !== 0) invalid("Missing exact index anchor");
              selected.push({ key: row.key.slice(), document: copyDocument(document) });
            }
            selected.sort((a, b) => compare(a.key, b.key) * (request.order === "asc" ? 1 : -1));
            const entries = selected.slice(0, request.maxResults), last = entries.at(-1);
            return { entries, cursor: entries.length < request.maxResults || last === undefined
              ? { kind: "end" as const } : { kind: "after" as const, key: last.key.slice() } };
          });
        }),
      };
    }),
    write: (lease, batch) => operation("write", () => {
      fence(lease);
      // Preflight before publishing any part of the atomic batch.
      const keys = new Set<string>();
      for (const row of batch.documents) {
        const key = documentKey(row.tableId, row.id) + ":" + row.ts;
        if (keys.has(key) || documents.get(documentKey(row.tableId, row.id))?.some(value => value.ts === row.ts)) invalid("Duplicate document version");
        keys.add(key);
      }
      const indexKeys = new Set<string>();
      for (const row of batch.indexes) {
        const key = hex(row.index.id) + ":" + hex(row.key) + ":" + row.ts;
        if (indexKeys.has(key) || indexes.get(hex(row.index.id))?.get(hex(row.key))?.some(value => value.ts === row.ts)) invalid("Duplicate index version");
        indexKeys.add(key);
      }
      for (const row of batch.documents) {
        const key = documentKey(row.tableId, row.id), versions = documents.get(key) ?? [];
        versions.push(copyDocument(row)); versions.sort(timestampOrder); documents.set(key, versions);
      }
      writeIndexes(batch.indexes, false);
    }),
    writeIndexBackfill: (lease, rows) => operation("writeIndexBackfill", () => { fence(lease); writeIndexes(rows, true); }),
    reconcileIndexBackfill: lease => operation("reconcileIndexBackfill", () => { fence(lease); }),
    getGlobal: key => operation("getGlobal", () => {
      const value = globals.get(key); return value === undefined ? Option.none() : Option.some(value.slice());
    }),
    putGlobal: (lease, key, value) => operation("putGlobal", () => { fence(lease); globals.set(key, value.slice()); }),
    loadDocuments: (request, retention = retentionValidator) => Effect.gen(function* () {
      yield* retention.validateDocument(request.start);
      return yield* operation("loadDocuments", () => {
        const direction = request.order === "asc" ? 1 : -1;
        const selected = [...documents.values()].flat().filter(row => row.ts >= request.start && row.ts <= request.end &&
          (request.tableId === undefined || compare(row.tableId, request.tableId) === 0) &&
          (request.after === undefined || logOrder(row, request.after) * direction > 0))
          .sort((a, b) => logOrder(a, b) * direction).slice(0, request.maxResults);
        const last = selected.at(-1);
        return { documents: selected.map(copyDocument), done: selected.length < request.maxResults,
          cursor: last === undefined ? null : { ts: last.ts, tableId: last.tableId.slice(), id: last.id.slice() } };
      });
    }),
    previousRevisions: (queries, retention = retentionValidator) => Effect.gen(function* () {
      const minimum = minimumQueryTimestamp(queries);
      if (minimum === null) return [];
      yield* retention.validateDocument(minimum);
      return yield* operation("previousRevisions", () => queries.flatMap(query => {
        const document = documents.get(documentKey(query.tableId, query.id))?.findLast(row => row.ts < query.ts);
        return document === undefined ? [] : [{ query, document: copyDocument(document) }];
      }));
    }),
    previousRevisionsOfDocuments: (queries, retention = retentionValidator) => Effect.gen(function* () {
      const minimum = minimumQueryTimestamp(queries);
      if (minimum === null) return [];
      yield* retention.validateDocument(minimum);
      return yield* operation("previousRevisionsOfDocuments", () => queries.flatMap(query => {
        const document = documents.get(documentKey(query.tableId, query.id))?.find(row => row.ts === query.prevTs);
        return document === undefined ? [] : [{ query, document: copyDocument(document) }];
      }));
    }),
  };
  return { persistence, calls, get bodyCpuUs() { return bodyCpuUs; },
    measureBodies(value: boolean) { measureBodies = value; bodyCpuUs = 0; } };
}

export function makeMemoryPhysical() {
  const instances = new Map<string, ReturnType<typeof makeMemoryPersistence>>();
  const instance = (name: string) => {
    let value = instances.get(name);
    if (value === undefined) { value = makeMemoryPersistence(); instances.set(name, value); }
    return value;
  };
  const initial = instance("benchmark");
  const physical: CorePersistenceFixture = {
    persistence: initial.persistence, namespace: "memory_cpu_only", instanceName: "benchmark",
    reopen: async name => instance(name ?? "benchmark").persistence,
    query: async () => { throw new Error("SQL must not run in the CPU benchmark"); },
    close: async () => {},
  };
  return { physical, instances };
}
