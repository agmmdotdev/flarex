/** Native relational plans borrow the ordinary Core observation owners. */
import { Effect, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { prepareRelationalRead, relationalSelectionValues, type RelationalSelection } from "../values/relationalQuery";
import type { NormalizedRelationalPredicate } from "../values/relationalPredicate";
import { issuePostgresRelationalPredicate } from "../values/postgresRelationalPredicate";
import { CoreNativeQueryError, CoreQueryInputError, CoreTransactionError, type CoreError, type CoreNativeOperations, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import type { CoreNativeRelationalRowPolicy, CoreNativeTableDeclaration } from "./nativePolicy";

const failure = (reason: "invalidInput" | "invalidAuthority" | "limitExceeded" | "storedCorruption", cause?: unknown): CoreError =>
  reason === "storedCorruption" ? new CorePersistenceError({ reason: "corruptData", cause })
    : reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause })
      : reason === "invalidAuthority" ? new CoreTransactionError({ reason: "authorityRevoked", cause })
      : new CoreNativeQueryError({ reason: "invalidInput", cause });

export function coreNativeRelationalRow(document: DocumentObject): Result.Result<JsonObject, CoreError> {
  const { _id, _creationTime, ...row } = document;
  return isJson(row) && isJsonObject(row) ? Result.succeed(row) : Result.fail(failure("storedCorruption"));
}
const project = (row: JsonObject, fields: readonly string[]): Result.Result<JsonObject, CoreError> => Result.gen(function* () {
  const output: Record<string, Json> = {};
  for (const field of fields) {
    const value = row[field];
    if (value === undefined) return yield* Result.fail(failure("storedCorruption"));
    output[field] = value;
  }
  return output;
});

export function prepareCoreNativeRelationalRead(policy: CoreNativeRelationalRowPolicy, input: unknown, pageRows: number) {
  return Result.gen(function* () {
    const prepared = yield* prepareRelationalRead(policy.table, input, pageRows, failure);
    const postgresPredicate = prepared.postgresPredicate === undefined ? undefined
      : yield* issuePostgresRelationalPredicate(policy.table, prepared.postgresPredicate, failure);
    const query = yield* prepared.compile();
    return { ...query, postgresPredicate, predicate: prepared.predicate };
  });
}
type Query = Result.Result.Success<ReturnType<typeof prepareCoreNativeRelationalRead>>;

function selectedWhere(table: CoreTableDefinition, selection: RelationalSelection | null, query: Query): JsonObject {
  if (selection === null) {
    const anchor = query.requiredNulls.find(field => table.indexes.some(index => index.fields[0] === field));
    return anchor === undefined ? { [query.key]: { gte: "" } } : { [anchor]: null };
  }
  const values = relationalSelectionValues(selection);
  const where: Record<string, Json> = {};
  for (const field of values.fields) {
    const value = values.value(field);
    if (value !== undefined) where[field] = value;
  }
  return where;
}

/** Complete selections retain their first native membership observation. Closed
 * PostgreSQL programs evaluate only that captured cohort; pure residuals retain
 * their existing owner. Count precedes projection and population. */
export const executeCoreNativeRelationalRead = Effect.fn("CoreNativeRelational.read")(function* (
  operations: Pick<CoreNativeOperations, "find" | "matchRelational">, table: CoreTableDefinition,
  policy: CoreNativeRelationalRowPolicy, query: Query, purpose: "rows" | "count" = "rows",
) {
  if (query.selections === null && query.requiresIndexedNullAnchor
    && !query.requiredNulls.some(field => table.indexes.some(index => index.fields[0] === field)))
    return yield* failure("invalidInput");
  const candidates = new Map<string, DocumentObject>();
  for (const selection of query.selections ?? [null]) {
    const documents = yield* operations.find(table.name, selectedWhere(table, selection, query));
    for (const document of documents) {
      if (typeof document._id !== "string") return yield* failure("storedCorruption");
      candidates.set(document._id, document);
    }
  }
  const inspectedRows = yield* Effect.fromResult(Result.gen(function* () {
    const rows: { readonly id: string; readonly row: JsonObject; readonly order: Uint8Array;
      readonly matches: boolean; readonly creationTime: unknown }[] = [];
    for (const [id, document] of candidates) {
      const row = yield* coreNativeRelationalRow(document);
      yield* policy.rows.validate(row, "storedCorruption");
      const inspected = yield* query.postgresPredicate === undefined ? query.inspect(row)
        : query.inspectOrder(row).pipe(Result.map(({ order }) => ({ order, matches: false })));
      if (query.postgresPredicate === undefined && inspected.matches
        && (typeof document._creationTime !== "number" || !Number.isFinite(document._creationTime)))
        return yield* Result.fail(failure("storedCorruption"));
      rows.push({ id, row, ...inspected, creationTime: document._creationTime });
    }
    return rows;
  }));
  // Even an empty indexed cohort reaches the complete validated SQL tree once.
  const verdicts = query.postgresPredicate === undefined ? inspectedRows.map(row => row.matches)
    : yield* operations.matchRelational(table.name, query.postgresPredicate, inspectedRows.map(row => row.row));
  return yield* Effect.fromResult(Result.gen(function* () {
    const matched: { readonly id: string; readonly row: JsonObject; readonly order: Uint8Array; readonly creationTime: number }[] = [];
    for (const [ordinal, member] of inspectedRows.entries()) if (verdicts[ordinal] === true) {
      if (typeof member.creationTime !== "number" || !Number.isFinite(member.creationTime))
        return yield* Result.fail(failure("storedCorruption"));
      matched.push({ ...member, creationTime: member.creationTime });
    }
    matched.sort((left, right) => (query.storageInsertion ? left.creationTime - right.creationTime
      : compareBytesLexicographically(left.order, right.order)) * (query.direction === "asc" ? 1 : -1)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rows: JsonObject[] = [];
    const orderedIdentities: Readonly<Record<string, string>>[] = [];
    for (const member of purpose === "count" ? matched : matched.slice(query.offset, query.offset + query.limit)) {
      if (purpose === "rows") rows.push(yield* project(member.row, query.fields));
      if (query.storageInsertion || query.includeIdentities) {
        const identity: Record<string, string> = {};
        for (const field of query.identityColumns) {
          const value = member.row[field];
          if (typeof value !== "string") return yield* Result.fail(failure("storedCorruption"));
          identity[field] = value;
        }
        orderedIdentities.push(Object.freeze(identity));
      }
    }
    return { rows, count: matched.length, returned: purpose === "count" ? matched.length : rows.length,
      ...(query.storageInsertion || query.includeIdentities ? { orderedIdentities: Object.freeze(orderedIdentities) } : {}) };
  }));
});

const pageWhere = (predicate: NormalizedRelationalPredicate): Result.Result<JsonObject, CoreError> => Result.gen(function* () {
  if (predicate.kind === "isNull") return { [predicate.column]: null };
  if (predicate.kind !== "and") return yield* Result.fail(new CoreQueryInputError({ reason: "invalidQuery" }));
  const where: Record<string, Json> = {};
  for (const child of predicate.children) Object.assign(where, yield* pageWhere(child));
  return where;
});

/** Examined pages stay on the existing consumed-prefix/EOF owner, rather than
 * turning a page into a complete selection or observing its untouched suffix. */
export const executeCoreNativeRelationalPage = Effect.fn("CoreNativeRelational.page")(function* (
  operations: Pick<CoreNativeOperations, "findPage">, table: CoreTableDefinition,
  declaration: CoreNativeTableDeclaration, policy: CoreNativeRelationalRowPolicy, query: Query,
) {
  if (query.includeIdentities || query.storageInsertion || query.search !== null || query.json !== null
    || query.postgresPredicate !== undefined || query.direction !== "asc" || query.selections !== null && query.selections.length > 1)
    return yield* new CoreQueryInputError({ reason: "invalidQuery" });
  if (query.selections?.length === 0) return { rows: Object.freeze([]), hasMore: false };
  const where = yield* Effect.fromResult(pageWhere(query.predicate));
  const index = table.indexes.find(candidate => candidate.fields[0] === query.orderColumn
    && declaration.indexes?.some(binding => binding.indexName === candidate.name
      && binding.requiredPrefix === undefined && binding.requiredNonNull === undefined));
  if (index === undefined) return yield* new CoreQueryInputError({ reason: "invalidQuery" });
  const page = yield* operations.findPage(table.name, where,
    { indexName: index.name, offset: query.offset, limit: query.limit, order: "asc" });
  const rows = yield* Effect.fromResult(Result.gen(function* () {
    const output: JsonObject[] = [];
    for (const document of page.documents) {
      const row = yield* coreNativeRelationalRow(document);
      yield* policy.rows.validate(row, "storedCorruption");
      output.push(yield* project(row, query.fields));
    }
    return output;
  }));
  return { rows, hasMore: page.hasMore };
});
