import { Result, Schema } from "effect";
import { sql, type SQL } from "drizzle-orm";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { Json, JsonObject } from "flarex-protocol/json";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "../../../values/privateJsonData";
import type { LogicalDocumentFailure } from "./model";
import { MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES } from "../appRows";

import type { NormalizedRelationalPredicate } from "../../../values/relationalPredicate";
export type { NormalizedRelationalPredicate } from "../../../values/relationalPredicate";

export type NormalizedRelatedRelationalPredicate =
  | Readonly<{ kind: "and" | "or"; children: readonly NormalizedRelatedRelationalPredicate[] }>
  | Readonly<{ kind: "parent" | "child" | "notInChild"; predicate: NormalizedRelationalPredicate }>;
export interface RelatedRelationalBinding {
  readonly table: RelationalTableDefinition;
  readonly tableId: CatalogTableId;
  readonly parentColumn: string;
  readonly childColumn: string;
}

declare const programBrand: unique symbol;
declare const batchBrand: unique symbol;
export interface PostgresRelationalPredicateProgram { readonly [programBrand]: true }
export interface PostgresRelationalPredicateBatch { readonly [batchBrand]: true }
type Program = Readonly<{ sourceTable: RelationalTableDefinition; bytes: number }> & (
  Readonly<{ kind: "scalar"; predicate: NormalizedRelationalPredicate }> |
  Readonly<{ kind: "related"; predicate: NormalizedRelatedRelationalPredicate; child: RelatedRelationalBinding }>);
type Batch = Readonly<{ program: Program; tableId: CatalogTableId; rows: number; inputBytes: number; maximumBytes: number; payload: string;
  childPayload?: string }>;
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
    programs.set(program, Object.freeze({ kind: "scalar", sourceTable, predicate: retained, bytes: captured.bytes }));
    return program;
  }));
}

/** Only the metadata-bound related compiler supplies this normalized program.
 * Both table identities remain attached through capture and protected execution. */
export function issuePostgresRelatedRelationalPredicate<Failure>(sourceTable: RelationalTableDefinition,
  child: RelatedRelationalBinding, predicate: NormalizedRelatedRelationalPredicate, error: LogicalDocumentFailure<Failure>) {
  return capturePrivateJsonData(predicate, MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES, error).pipe(Result.map(captured => {
    // SAFETY: capture preserves the compiler-validated normalized tree.
    const retained = captured.value as NormalizedRelatedRelationalPredicate;
    // SAFETY: only exact identities registered here carry a program.
    const program = Object.freeze({}) as PostgresRelationalPredicateProgram;
    programs.set(program, Object.freeze({ kind: "related", sourceTable, child: Object.freeze({ ...child }), predicate: retained, bytes: captured.bytes }));
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
  bounds: Readonly<{ rows: number; bytes: number }>, error: LogicalDocumentFailure<Failure>,
  child?: Readonly<{ table: RelationalTableDefinition; tableId: CatalogTableId; rows: readonly JsonObject[] }>) {
  return Result.gen(function* () {
    const retained = programs.get(program);
    if (retained === undefined || retained.sourceTable !== sourceTable) return yield* Result.fail(error("invalidAuthority"));
    if (retained.kind === "related" ? child === undefined || child.table !== retained.child.table || child.tableId !== retained.child.tableId
      : child !== undefined) return yield* Result.fail(error("invalidAuthority"));
    const maximum = yield* decodeBounds(bounds).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const maximumBytes = Math.min(maximum.bytes, MAX_BOUNDED_APP_ROW_READ_VALUE_BYTES);
    const captured = yield* useCapturedPrivateJsonData(rows, maximumBytes, error);
    const candidates = yield* decodeCandidates(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const childCapture = child === undefined ? undefined : yield* useCapturedPrivateJsonData(child.rows, maximumBytes, error);
    const childCandidates = childCapture === undefined ? [] : yield* decodeCandidates(childCapture.value).pipe(Result.mapError(cause => error("invalidInput", cause)));
    if (candidates.length + childCandidates.length > maximum.rows || retained.bytes + captured.bytes + (childCapture?.bytes ?? 0) > maximumBytes)
      return yield* Result.fail(error("limitExceeded"));
    if (retained.kind === "related") {
      // Bound possible comparisons before delegating join planning to PG; a
      // selective result cannot shrink the complete two-cohort work budget.
      if (candidates.length * Math.max(1, childCandidates.length) > maximum.rows)
        return yield* Result.fail(error("limitExceeded"));
      const parents = new Set<string>();
      for (const row of candidates) {
        const key = row[retained.child.parentColumn];
        if (typeof key !== "string" || parents.has(key)) return yield* Result.fail(error("storedCorruption"));
        parents.add(key);
      }
      for (const row of childCandidates) if (typeof row[retained.child.childColumn] !== "string")
        return yield* Result.fail(error("storedCorruption"));
      // A single checked FK gives each child at most one joined parent. Thus
      // parent + child bounds both complete cohorts and the left-join work.
    }
    // SAFETY: this issuer registers the exact frozen batch identity only after
    // genuine program/table binding, value capture and resource validation.
    const batch = Object.freeze({}) as PostgresRelationalPredicateBatch;
    batches.set(batch, Object.freeze({ program: retained, tableId, rows: candidates.length,
      inputBytes: retained.bytes + captured.bytes + (childCapture?.bytes ?? 0), maximumBytes, payload: JSON.stringify(captured.value),
      ...(childCapture === undefined ? {} : { childPayload: JSON.stringify(childCapture.value) }) }));
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
    rows: facts.rows, inputBytes: facts.inputBytes,
    ...(facts.program.kind === "scalar" ? {} : { child: Object.freeze({ table: facts.program.child.table, tableId: facts.program.child.tableId }) }) })));
}

const text = (row: SQL, column: string) => sql`(${row} ->> ${column})`;
const json = (row: SQL, column: string) => sql`(${row} -> ${column})`;
const join = (parts: readonly SQL[], operator: "and" | "or"): SQL => parts.length === 0
  ? operator === "and" ? sql`true` : sql`false`
  : sql`(${sql.join([...parts], operator === "and" ? sql` and ` : sql` or `)})`;
const membership = (row: SQL, column: string, values: readonly (string | boolean | null)[], negative = false): SQL => values.length === 0
  ? negative ? sql`true` : sql`false`
  : negative ? sql`${text(row, column)} not in (${sql.join(values.map(value => sql`${value === null ? null : String(value)}`), sql`, `)})`
    : sql`${text(row, column)} in (${sql.join(values.map(value => sql`${value === null ? null : String(value)}`), sql`, `)})`;

function expression(node: NormalizedRelationalPredicate, row: SQL): SQL {
  switch (node.kind) {
    case "and": case "or": return join(node.children.map(child => expression(child, row)), node.kind);
    case "in": return membership(row, node.column, node.values);
    case "numberIn": return node.values.length === 0 ? sql`false`
      : sql`(${text(row, node.column)})::double precision in (${sql.join(node.values.map(value => sql`${String(value)}::double precision`), sql`, `)})`;
    case "numericIn": return node.values.length === 0 ? sql`false`
      : sql`(${text(row, node.column)})::numeric in (${sql.join(node.values.map(value => sql`${value}::numeric`), sql`, `)})`;
    case "postgresNumericCast": {
      // Bind the finite number's decimal spelling. Stored TEXT remains intact:
      // PostgreSQL alone determines numeric precision, special values/errors.
      const left = sql`(${text(row, node.column)})::numeric`, right = sql`${String(node.value)}::numeric`;
      switch (node.operator) {
        case "gt": return sql`${left} > ${right}`;
        case "gte": return sql`${left} >= ${right}`;
        case "lt": return sql`${left} < ${right}`;
        case "lte": return sql`${left} <= ${right}`;
      }
    }
    case "indexedPoints": return join(node.values.map(point => join(node.columns.map((column, offset) =>
      sql`${text(row, column)} = ${String(point[offset])}`), "and")), "or");
    case "isNull": return sql`${text(row, node.column)} is null`;
    case "textNotEqual": return sql`${text(row, node.column)} <> ${node.value}`;
    case "greaterThan": return sql`convert_to(${text(row, node.column)}, 'UTF8') > convert_to(${node.value}, 'UTF8')`;
    case "lessThan": return sql`convert_to(${text(row, node.column)}, 'UTF8') < convert_to(${node.value}, 'UTF8')`;
    case "textLikeAscii": return sql`translate(${text(row, node.column)}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" like translate(${node.pattern}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate "C" escape ''`;
    case "jsonContains": return sql`(${text(row, node.column)} is not null and ${json(row, node.column)} @> ${JSON.stringify(node.value)}::jsonb)`;
    case "postgresText": switch (node.operator) {
    case "gt": return sql`${text(row, node.column)} > ${node.value}`;
    case "gte": return sql`${text(row, node.column)} >= ${node.value}`;
    case "lt": return sql`${text(row, node.column)} < ${node.value}`;
    case "lte": return sql`${text(row, node.column)} <= ${node.value}`;
    case "like": return sql`${text(row, node.column)} like ${node.value}`;
    case "ilike": return sql`${text(row, node.column)} ilike ${node.value}`;
    case "regex": return sql`${text(row, node.column)} ~ ${node.value}`;
    case "fulltext": return sql`to_tsvector('simple', ${text(row, node.column)}) @@ plainto_tsquery('simple', ${node.value})`;
    case "notIn": return membership(row, node.column, node.values, true);
    case "exists": return node.value ? sql`${text(row, node.column)} is not null` : sql`${text(row, node.column)} is null`;
    }
  }
}

/** No database identifiers, arbitrary SQL, callbacks or sessions cross this
 * boundary. Every value and column key is a parameter in a closed expression. */
export function buildPostgresRelationalPredicateBody<Failure>(batch: PostgresRelationalPredicateBatch,
  tableId: CatalogTableId, error: LogicalDocumentFailure<Failure>) {
  return batchFacts(batch, tableId, error).pipe(Result.map(facts => {
    if (facts.program.kind === "related") {
      const program = facts.program;
      const relatedExpression = (node: NormalizedRelatedRelationalPredicate): SQL => {
        if ("children" in node) return join(node.children.map(relatedExpression), node.kind);
        if (node.kind === "parent") return expression(node.predicate, sql`parent.row`);
        if (node.kind === "child") return expression(node.predicate, sql`child.row`);
        return sql`${text(sql`parent.row`, program.child.parentColumn)} not in (
          select ${text(sql`member.row`, program.child.childColumn)} from child_rows member
          where ${expression(node.predicate, sql`member.row`)})`;
      };
      return sql`with candidate_rows as materialized (
        select row, ordinal from jsonb_array_elements(${facts.payload}::jsonb) with ordinality as source(row, ordinal)
      ), child_rows as materialized (
        select row from jsonb_array_elements(${facts.childPayload}::jsonb) as source(row)
      ), matches as materialized (
        select distinct parent.ordinal from candidate_rows parent left join child_rows child
          on ${text(sql`child.row`, program.child.childColumn)} = ${text(sql`parent.row`, program.child.parentColumn)}
        where ${relatedExpression(program.predicate)}
      ) select (candidate.ordinal - 1)::integer as ordinal, matches.ordinal is not null as matched
      from candidate_rows candidate left join matches using (ordinal) order by candidate.ordinal`;
    }
    return sql`with candidate_rows as materialized (
      select row, ordinal from jsonb_array_elements(${facts.payload}::jsonb) with ordinality as source(row, ordinal)
    ), matches as materialized (
      select candidate.ordinal from candidate_rows candidate where ${expression(facts.program.predicate, sql`candidate.row`)}
    ) select (candidate.ordinal - 1)::integer as ordinal, matches.ordinal is not null as matched
    from candidate_rows candidate left join matches using (ordinal) order by candidate.ordinal`;
  }));
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
