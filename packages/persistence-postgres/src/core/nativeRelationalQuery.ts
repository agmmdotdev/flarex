/** Native relational plans borrow the ordinary Core observation owners. */
import { Effect, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { prepareRelationalRead, relationalSelectionValues, type RelationalSelection } from "../values/relationalQuery";
import type { NormalizedRelationalPredicate } from "../values/relationalPredicate";
import { CoreNativeQueryError, CoreQueryInputError, CoreTransactionError, type CoreError, type CoreNativeOperations, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import type { CoreNativeRelationalRowPolicy, CoreNativeTableDeclaration } from "./nativePolicy";

const failure = (reason: "invalidInput" | "limitExceeded" | "storedCorruption", cause?: unknown): CoreError =>
  reason === "storedCorruption" ? new CorePersistenceError({ reason: "corruptData", cause })
    : reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause })
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
  return prepareRelationalRead(policy.table, input, pageRows, failure).pipe(Result.flatMap(prepared =>
    prepared.compile().pipe(Result.map(query => ({ ...query, predicate: prepared.predicate })))));
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

/** Complete selections retain their first native membership observation. Search
 * and JSON are genuine pure residuals over that bounded indexed cohort; no SQL
 * or second snapshot is introduced. Count precedes projection and population. */
export const executeCoreNativeRelationalRead = Effect.fn("CoreNativeRelational.read")(function* (
  operations: Pick<CoreNativeOperations, "find">, table: CoreTableDefinition,
  policy: CoreNativeRelationalRowPolicy, query: Query,
) {
  if (query.postgresPredicate !== undefined) return yield* new CoreQueryInputError({ reason: "invalidQuery",
    cause: "PostgreSQL predicate execution is not admitted by this native profile" });
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
  return yield* Effect.fromResult(Result.gen(function* () {
    const matched: { readonly id: string; readonly row: JsonObject; readonly order: Uint8Array; readonly creationTime: number }[] = [];
    for (const [id, document] of candidates) {
      const row = yield* coreNativeRelationalRow(document);
      yield* policy.rows.validate(row, "storedCorruption");
      const inspected = yield* query.inspect(row);
      if (inspected.matches) {
        if (typeof document._creationTime !== "number" || !Number.isFinite(document._creationTime))
          return yield* Result.fail(failure("storedCorruption"));
        matched.push({ id, row, order: inspected.order, creationTime: document._creationTime });
      }
    }
    matched.sort((left, right) => (query.storageInsertion ? left.creationTime - right.creationTime
      : compareBytesLexicographically(left.order, right.order)) * (query.direction === "asc" ? 1 : -1)
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rows: JsonObject[] = [];
    for (const member of matched.slice(query.offset, query.offset + query.limit)) rows.push(yield* project(member.row, query.fields));
    return { rows, count: matched.length };
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
    && declaration.indexes?.some(binding => binding.indexName === candidate.name && binding.requiredPrefix === undefined));
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
