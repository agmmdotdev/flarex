/** Native relational plans borrow the ordinary Core observation owners. */
import { Effect, Option, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { isJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { prepareRelationalRead, relationalSelectionValues, type RelationalSelection } from "../values/relationalQuery";
import type { NormalizedRelationalPredicate } from "../values/relationalPredicate";
import { issuePostgresRelationalPredicate, issuePostgresSnapshotFilter, type PostgresRelationalPredicateFailure } from "../values/postgresRelationalPredicate";
import { CoreNativeQueryError, CoreQueryInputError, CoreTransactionError, type CoreError, type CoreNativeOperations, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import type { CoreNativeRelationalRowPolicy, CoreNativeTableDeclaration } from "./nativePolicy";
import { prefetchCoreNativeFindSlots } from "./nativePrefetch";

export const coreNativeRelationalQueryFailure: PostgresRelationalPredicateFailure<CoreError> = (reason, cause) =>
  reason === "storedCorruption" ? new CorePersistenceError({ reason: "corruptData", cause })
    : reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause })
      : reason === "invalidAuthority" ? new CoreTransactionError({ reason: "authorityRevoked", cause })
      : new CoreNativeQueryError({ reason: "invalidInput", cause });
const failure = coreNativeRelationalQueryFailure;

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
    // Issued only for a full-set read whose every leaf has a stored-document form.
    const snapshotFilter = prepared.snapshotPredicate === undefined || query.selections !== null ? undefined
      : yield* issuePostgresSnapshotFilter(policy.table, prepared.snapshotPredicate, failure);
    return { ...query, postgresPredicate, snapshotFilter, predicate: prepared.predicate };
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

const lacksIndexedNullAnchor = (table: CoreTableDefinition, query: Query) => query.selections === null && query.requiresIndexedNullAnchor
  && !query.requiredNulls.some(field => table.indexes.some(index => index.fields[0] === field));

interface InspectedRow {
  readonly id: string;
  readonly row: JsonObject;
  readonly order: Uint8Array;
  readonly matches: boolean;
  readonly creationTime: unknown;
}

const inspectCoreNativeRelationalCohort = Effect.fnUntraced(function* (
  find: CoreNativeOperations["find"], table: CoreTableDefinition, policy: CoreNativeRelationalRowPolicy, query: Query,
  prefetch?: (wheres: readonly JsonObject[]) => Effect.Effect<void>,
) {
  if (lacksIndexedNullAnchor(table, query)) return yield* failure("invalidInput");
  const candidates = new Map<string, DocumentObject>();
  const wheres = (query.selections ?? [null]).map(selection => selectedWhere(table, selection, query));
  // The selections are independent: overlap their first reads, then find them in order.
  if (prefetch !== undefined && wheres.length > 1) yield* prefetch(wheres);
  for (const where of wheres) {
    const documents = yield* find(table.name, where);
    for (const document of documents) {
      if (typeof document._id !== "string") return yield* failure("storedCorruption");
      candidates.set(document._id, document);
    }
  }
  return yield* Effect.fromResult(Result.gen(function* () {
    const rows: InspectedRow[] = [];
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
});

function projectCoreNativeRelationalCohort(inspectedRows: readonly InspectedRow[], query: Query, purpose: "rows" | "count" | "complete",
  verdicts?: readonly (boolean | null)[]) {
  return Result.gen(function* () {
    const matched: { readonly id: string; readonly row: JsonObject; readonly order: Uint8Array; readonly creationTime: number }[] = [];
    for (const [ordinal, member] of inspectedRows.entries()) {
      if (!(verdicts === undefined ? member.matches : verdicts[ordinal] === true)) continue;
      if (typeof member.creationTime !== "number" || !Number.isFinite(member.creationTime))
        return yield* Result.fail(failure("storedCorruption"));
      matched.push({ ...member, creationTime: member.creationTime });
    }
    // The tie-break follows the direction, matching a page's trailing index-key id.
    const direction = query.direction === "asc" ? 1 : -1;
    matched.sort((left, right) => (query.storageInsertion ? left.creationTime - right.creationTime
      : compareBytesLexicographically(left.order, right.order)) * direction
      || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) * direction);
    const rows: JsonObject[] = [];
    const orderedIdentities: Readonly<Record<string, string>>[] = [];
    for (const member of purpose === "rows" ? matched.slice(query.offset, query.offset + query.limit) : matched) {
      if (purpose !== "count") rows.push(yield* project(member.row, query.fields));
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
  });
}

/** What either read path returns; only a complete read lists identities. */
interface CoreNativeRelationalSelection {
  readonly rows: JsonObject[];
  readonly count: number;
  readonly returned: number;
  readonly orderedIdentities?: readonly Readonly<Record<string, string>>[];
}

/** The one rule for an index that covers every row of its table: its binding
 * requires neither a prefix nor a non-null field. `leading` orders a page by
 * the complete key; `exact` is the single-field index whose key order is the
 * complete read's order, that field and then the document identity. */
export function coreNativeUnconditionalIndex(table: CoreTableDefinition, declaration: CoreNativeTableDeclaration,
  column: string, shape: "leading" | "exact") {
  return table.indexes.find(candidate => candidate.fields[0] === column && (shape === "leading" || candidate.fields.length === 1)
    && declaration.indexes?.some(binding => binding.indexName === candidate.name
      && binding.requiredPrefix === undefined && binding.requiredNonNull === undefined));
}

/** divergences/native-snapshot-predicate-pushdown.md. PostgreSQL selects, orders,
 * windows and counts the snapshot-visible rows; each returned row is then
 * validated, re-evaluated and ordered here exactly as a complete read would.
 * None leaves the read with the complete captured path. */
const filterCoreNativeRelationalSnapshot = Effect.fnUntraced(function* (
  filterSnapshot: CoreNativeOperations["filterSnapshot"], table: CoreTableDefinition,
  policy: CoreNativeRelationalRowPolicy, query: Query, purpose: "rows" | "count",
) {
  if (query.snapshotFilter === undefined || query.selections !== null || query.storageInsertion
    || query.includeIdentities || query.postgresPredicate !== undefined) return Option.none<CoreNativeRelationalSelection>();
  const page = yield* filterSnapshot(table.name, query.snapshotFilter, { orderColumn: query.orderColumn, order: query.direction,
    offset: purpose === "count" ? 0 : query.offset, limit: purpose === "count" ? 0 : query.limit });
  if (Option.isNone(page)) return Option.none<CoreNativeRelationalSelection>();
  const { documents, count } = page.value;
  return yield* Effect.fromResult(Result.gen(function* () {
    const rows: JsonObject[] = [];
    const direction = query.direction === "asc" ? 1 : -1;
    let previous: Readonly<{ id: string; order: Uint8Array }> | undefined;
    for (const document of documents) {
      if (typeof document._id !== "string" || typeof document._creationTime !== "number" || !Number.isFinite(document._creationTime))
        return yield* Result.fail(failure("storedCorruption"));
      const row = yield* coreNativeRelationalRow(document);
      yield* policy.rows.validate(row, "storedCorruption");
      const inspected = yield* query.inspect(row);
      const id = document._id;
      // A returned row the owning evaluator rejects, or one out of the complete
      // read's order, means the statement and this owner disagree: refuse it.
      if (!inspected.matches || previous !== undefined && (compareBytesLexicographically(previous.order, inspected.order) * direction
        || (previous.id < id ? -1 : previous.id > id ? 1 : 0) * direction) >= 0)
        return yield* Result.fail(failure("storedCorruption"));
      previous = { id, order: inspected.order };
      rows.push(yield* project(row, query.fields));
    }
    return Option.some<CoreNativeRelationalSelection>({ rows, count, returned: purpose === "count" ? count : rows.length });
  }));
});

/** Complete selections retain their first native membership observation. Closed
 * PostgreSQL programs evaluate only that captured cohort; pure residuals retain
 * their existing owner. Count precedes projection and population. A read-only
 * snapshot operation may instead hand a full-set read to PostgreSQL. */
export const executeCoreNativeRelationalRead = Effect.fn("CoreNativeRelational.read")(function* (
  operations: Pick<CoreNativeOperations, "find" | "matchRelational">, table: CoreTableDefinition,
  policy: CoreNativeRelationalRowPolicy, query: Query, purpose: "rows" | "count" = "rows",
  /** Supplied only for reads that carry no receipts; None keeps the complete path. */
  filterSnapshot: Option.Option<CoreNativeOperations["filterSnapshot"]> = Option.none(),
) {
  // A read the cohort owner refuses for its missing anchor is left to that owner.
  if (Option.isSome(filterSnapshot) && !lacksIndexedNullAnchor(table, query)) {
    const filtered = yield* filterCoreNativeRelationalSnapshot(filterSnapshot.value, table, policy, query, purpose);
    if (Option.isSome(filtered)) return filtered.value;
  }
  const inspected = yield* inspectCoreNativeRelationalCohort(operations.find, table, policy, query,
    wheres => prefetchCoreNativeFindSlots(operations, table.name, wheres));
  // Even an empty indexed cohort reaches the complete validated SQL tree once.
  const verdicts = query.postgresPredicate === undefined ? undefined
    : yield* operations.matchRelational(table.name, query.postgresPredicate, inspected.map(row => row.row));
  return yield* Effect.fromResult(projectCoreNativeRelationalCohort(inspected, query, purpose, verdicts));
});

export const captureCoreNativeRelatedCohort = Effect.fn("CoreNativeRelational.captureRelatedCohort")(function* (
  find: CoreNativeOperations["find"], table: CoreTableDefinition, policy: CoreNativeRelationalRowPolicy,
  primaryColumn: string, pageRows: number,
) {
  const query = Object.freeze({ order: Object.freeze({ column: primaryColumn, direction: "asc" }), includeIdentities: true });
  const prepared = yield* Effect.fromResult(prepareCoreNativeRelationalRead(policy, query, pageRows));
  if (prepared.postgresPredicate !== undefined) return yield* failure("invalidInput");
  const inspected = yield* inspectCoreNativeRelationalCohort(find, table, policy, prepared);
  const cohort = yield* Effect.fromResult(projectCoreNativeRelationalCohort(inspected, prepared, "complete"));
  if (cohort.orderedIdentities === undefined) return yield* failure("storedCorruption");
  return Object.freeze({ ...cohort, query, rows: Object.freeze(cohort.rows), orderedIdentities: cohort.orderedIdentities });
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
    || query.postgresPredicate !== undefined || query.selections !== null && query.selections.length > 1)
    return yield* new CoreQueryInputError({ reason: "invalidQuery" });
  if (query.selections?.length === 0) return { rows: Object.freeze([]), hasMore: false };
  const where = yield* Effect.fromResult(pageWhere(query.predicate));
  const index = coreNativeUnconditionalIndex(table, declaration, query.orderColumn, "leading");
  if (index === undefined) return yield* new CoreQueryInputError({ reason: "invalidQuery" });
  const page = yield* operations.findPage(table.name, where,
    { indexName: index.name, offset: query.offset, limit: query.limit, order: query.direction });
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
