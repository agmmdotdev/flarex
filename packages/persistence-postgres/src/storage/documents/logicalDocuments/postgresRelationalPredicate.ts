import { Result, Schema } from "effect";
import { sql, type SQL } from "drizzle-orm";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { Json, JsonObject } from "flarex-protocol/json";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "../../../values/privateJsonData";
import type { LogicalDocumentFailure } from "./model";
import { MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES } from "../appRows";

/** This is the relational query owner's validated tree, not a second input
 * grammar. PostgreSQL-dependent leaves require evaluation of the whole tree. */
export type NormalizedRelationalPredicate =
  | Readonly<{ kind: "and" | "or"; children: readonly NormalizedRelationalPredicate[] }>
  | Readonly<{ kind: "in"; column: string; values: readonly (string | boolean)[] }>
  | Readonly<{ kind: "numericIn"; column: string; values: readonly string[] }>
  | Readonly<{ kind: "postgresNumericCast"; column: string; operator: "gt" | "gte" | "lt" | "lte"; value: number }>
  | Readonly<{ kind: "indexedPoints"; columns: readonly string[]; values: readonly (readonly (string | boolean)[])[] }>
  | Readonly<{ kind: "isNull"; column: string }>
  | Readonly<{ kind: "textNotEqual" | "greaterThan"; column: string; value: string }>
  | Readonly<{ kind: "textLikeAscii"; column: string; pattern: string }>
  | Readonly<{ kind: "jsonContains"; column: string; value: Json }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "gt" | "gte" | "lt" | "lte" | "like" | "ilike" | "regex" | "fulltext"; value: string }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "notIn"; values: readonly string[] }>
  | Readonly<{ kind: "postgresText"; column: string; operator: "exists"; value: boolean }>;

declare const programBrand: unique symbol;
declare const batchBrand: unique symbol;
export interface PostgresRelationalPredicateProgram { readonly [programBrand]: true }
export interface PostgresRelationalPredicateBatch { readonly [batchBrand]: true }
type Program = Readonly<{ sourceTable: RelationalTableDefinition; predicate: NormalizedRelationalPredicate; bytes: number }>;
type Batch = Readonly<{ program: Program; tableId: CatalogTableId; rows: number; inputBytes: number; maximumBytes: number; payload: string }>;
const programs = new WeakMap<object, Program>();
const batches = new WeakMap<object, Batch>();

/** Called only after the actual relational compiler validates every node.
 * Capturing owns immutable values; it does not introduce another validator. */
export function issuePostgresRelationalPredicate<Failure>(sourceTable: RelationalTableDefinition,
  predicate: NormalizedRelationalPredicate, error: LogicalDocumentFailure<Failure>) {
  return capturePrivateJsonData(predicate, MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, error).pipe(Result.map(captured => {
    // SAFETY: capture preserves the validated tree's JSON shape and values.
    const retained = captured.value as NormalizedRelationalPredicate;
    // SAFETY: only this issuer registers the frozen token in the private
    // WeakMap; the nominal type grants nothing without that exact identity.
    const program = Object.freeze({}) as PostgresRelationalPredicateProgram;
    programs.set(program, Object.freeze({ sourceTable, predicate: retained, bytes: captured.bytes }));
    return program;
  }));
}

const Bounds = Schema.Struct({ rows: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  bytes: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })) });
const decodeBounds = Schema.decodeUnknownResult(Bounds, { onExcessProperty: "error" });
const decodeCandidates = Schema.decodeUnknownResult(Schema.Array(Schema.JsonObject));

/** Captures only complete candidates already authenticated by inspectRow. A
 * token binds those immutable values to one genuine program and table owner. */
export function preparePostgresRelationalBatch<Failure>(program: PostgresRelationalPredicateProgram,
  sourceTable: RelationalTableDefinition, tableId: CatalogTableId, rows: readonly JsonObject[],
  bounds: Readonly<{ rows: number; bytes: number }>, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const retained = programs.get(program);
    if (retained === undefined || retained.sourceTable !== sourceTable) return yield* Result.fail(error("invalidAuthority"));
    const maximum = yield* decodeBounds(bounds).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const maximumBytes = Math.min(maximum.bytes, MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES);
    const captured = yield* useCapturedPrivateJsonData(rows, maximumBytes, error);
    const candidates = yield* decodeCandidates(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause)));
    if (candidates.length > maximum.rows || retained.bytes > maximumBytes - captured.bytes)
      return yield* Result.fail(error("limitExceeded"));
    // SAFETY: this issuer registers the exact frozen batch identity only after
    // genuine program/table binding, value capture and resource validation.
    const batch = Object.freeze({}) as PostgresRelationalPredicateBatch;
    batches.set(batch, Object.freeze({ program: retained, tableId, rows: candidates.length,
      inputBytes: retained.bytes + captured.bytes, maximumBytes, payload: JSON.stringify(captured.value) }));
    return batch;
  });
}

const batchFacts = <Failure>(batch: PostgresRelationalPredicateBatch, tableId: CatalogTableId,
  error: LogicalDocumentFailure<Failure>): Result.Result<Batch, Failure> => {
  const facts = batches.get(batch);
  return facts === undefined || facts.tableId !== tableId ? Result.fail(error("invalidAuthority")) : Result.succeed(facts);
};

export function inspectPostgresRelationalBatch<Failure>(batch: PostgresRelationalPredicateBatch,
  tableId: CatalogTableId, error: LogicalDocumentFailure<Failure>) {
  return batchFacts(batch, tableId, error).pipe(Result.map(facts => Object.freeze({ table: facts.program.sourceTable,
    rows: facts.rows, inputBytes: facts.inputBytes })));
}

const text = (column: string) => sql`(candidate.row ->> ${column})`;
const json = (column: string) => sql`(candidate.row -> ${column})`;
const join = (parts: readonly SQL[], operator: "and" | "or"): SQL => parts.length === 0
  ? operator === "and" ? sql`true` : sql`false`
  : sql`(${sql.join([...parts], operator === "and" ? sql` and ` : sql` or `)})`;
const membership = (column: string, values: readonly (string | boolean)[], negative = false): SQL => values.length === 0
  ? negative ? sql`true` : sql`false`
  : negative ? sql`${text(column)} not in (${sql.join(values.map(value => sql`${String(value)}`), sql`, `)})`
    : sql`${text(column)} in (${sql.join(values.map(value => sql`${String(value)}`), sql`, `)})`;

function expression(node: NormalizedRelationalPredicate): SQL {
  switch (node.kind) {
    case "and": case "or": return join(node.children.map(expression), node.kind);
    case "in": return membership(node.column, node.values);
    case "numericIn": return node.values.length === 0 ? sql`false`
      : sql`(${text(node.column)})::numeric in (${sql.join(node.values.map(value => sql`${value}::numeric`), sql`, `)})`;
    case "postgresNumericCast": {
      // Bind the finite number's decimal spelling. Stored TEXT remains intact:
      // PostgreSQL alone determines numeric precision, special values/errors.
      const left = sql`(${text(node.column)})::numeric`, right = sql`${String(node.value)}::numeric`;
      switch (node.operator) {
        case "gt": return sql`${left} > ${right}`;
        case "gte": return sql`${left} >= ${right}`;
        case "lt": return sql`${left} < ${right}`;
        case "lte": return sql`${left} <= ${right}`;
      }
    }
    case "indexedPoints": return join(node.values.map(point => join(node.columns.map((column, offset) =>
      sql`${text(column)} = ${String(point[offset])}`), "and")), "or");
    case "isNull": return sql`${text(node.column)} is null`;
    case "textNotEqual": return sql`${text(node.column)} <> ${node.value}`;
    case "greaterThan": return sql`convert_to(${text(node.column)}, 'UTF8') > convert_to(${node.value}, 'UTF8')`;
    case "textLikeAscii": return sql`translate(${text(node.column)}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" like translate(${node.pattern}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" escape ''`;
    case "jsonContains": return sql`(${text(node.column)} is not null and ${json(node.column)} @> ${JSON.stringify(node.value)}::jsonb)`;
    case "postgresText": switch (node.operator) {
    case "gt": return sql`${text(node.column)} > ${node.value}`;
    case "gte": return sql`${text(node.column)} >= ${node.value}`;
    case "lt": return sql`${text(node.column)} < ${node.value}`;
    case "lte": return sql`${text(node.column)} <= ${node.value}`;
    case "like": return sql`${text(node.column)} like ${node.value}`;
    case "ilike": return sql`${text(node.column)} ilike ${node.value}`;
    case "regex": return sql`${text(node.column)} ~ ${node.value}`;
    case "fulltext": return sql`to_tsvector('simple', ${text(node.column)}) @@ plainto_tsquery('simple', ${node.value})`;
    case "notIn": return membership(node.column, node.values, true);
    case "exists": return node.value ? sql`${text(node.column)} is not null` : sql`${text(node.column)} is null`;
    }
  }
}

/** No database identifiers, arbitrary SQL, callbacks or sessions cross this
 * boundary. Every value and column key is a parameter in a closed expression. */
export function buildPostgresRelationalPredicateBody<Failure>(batch: PostgresRelationalPredicateBatch,
  tableId: CatalogTableId, error: LogicalDocumentFailure<Failure>) {
  return batchFacts(batch, tableId, error).pipe(Result.map(facts => sql`with candidate_rows as materialized (
      select row, ordinal from jsonb_array_elements(${facts.payload}::jsonb) with ordinality as source(row, ordinal)
    ), matches as materialized (
      select candidate.ordinal from candidate_rows candidate where ${expression(facts.program.predicate)}
    ) select (candidate.ordinal - 1)::integer as ordinal, matches.ordinal is not null as matched
    from candidate_rows candidate left join matches using (ordinal) order by candidate.ordinal`));
}

const decodeMatches = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({
  ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), matched: Schema.NullOr(Schema.Boolean),
})), { onExcessProperty: "error" });

export function decodePostgresRelationalMatches<Failure>(batch: PostgresRelationalPredicateBatch,
  tableId: CatalogTableId, input: unknown, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const facts = yield* batchFacts(batch, tableId, error);
    const captured = yield* capturePrivateJsonData(input, facts.maximumBytes,
      (reason, cause) => error(reason === "invalidInput" ? "storedCorruption" : reason, cause));
    const rows = yield* decodeMatches(captured.value).pipe(Result.mapError(cause => error("storedCorruption", cause)));
    if (rows.length !== facts.rows || rows.some((row, ordinal) => row.ordinal !== ordinal))
      return yield* Result.fail(error("storedCorruption"));
    return Object.freeze({ matches: Object.freeze(rows.map(row => row.matched)), bytes: captured.bytes });
  });
}
