import { Result, Schema } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "./privateJsonData";

import type { NormalizedRelationalPredicate } from "./relationalPredicate";
export type { NormalizedRelationalPredicate } from "./relationalPredicate";

export const MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES = 1_048_576;
export type PostgresRelationalPredicateFailure<Failure> =
  (reason: "invalidInput" | "invalidAuthority" | "limitExceeded" | "storedCorruption", cause?: unknown) => Failure;

export type NormalizedRelatedRelationalPredicate =
  | Readonly<{ kind: "and" | "or"; children: readonly NormalizedRelatedRelationalPredicate[] }>
  | Readonly<{ kind: "parent" | "child" | "notInChild"; predicate: NormalizedRelationalPredicate }>;
export interface RelatedRelationalBinding<Binding = unknown> {
  readonly table: RelationalTableDefinition;
  readonly tableId: Binding;
  readonly parentColumn: string;
  readonly childColumn: string;
}

declare const programBrand: unique symbol;
declare const batchBrand: unique symbol;
export interface PostgresRelationalPredicateProgram<Binding = unknown> { readonly [programBrand]: Binding }
export interface PostgresRelationalPredicateBatch<Binding = unknown> { readonly [batchBrand]: Binding }
type Program<Binding = unknown> = Readonly<{ sourceTable: RelationalTableDefinition; bytes: number }> & (
  Readonly<{ kind: "scalar"; predicate: NormalizedRelationalPredicate }> |
  Readonly<{ kind: "related"; predicate: NormalizedRelatedRelationalPredicate; child: RelatedRelationalBinding<Binding> }>);
type Batch<Binding = unknown> = Readonly<{ program: Program<Binding>; tableId: Binding; rows: number; inputBytes: number; maximumBytes: number; payload: string;
  childPayload?: string }>;
const programs = new WeakMap<object, Program>();
const batches = new WeakMap<object, Batch>();

/** Called only after the actual relational compiler validates every node.
 * Capturing owns immutable values; it does not introduce another validator. */
export function issuePostgresRelationalPredicate<Failure>(sourceTable: RelationalTableDefinition,
  predicate: NormalizedRelationalPredicate, error: PostgresRelationalPredicateFailure<Failure>) {
  return capturePrivateJsonData(predicate, MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES, error).pipe(Result.map(captured => {
    // SAFETY: capture preserves the validated tree's JSON shape and values.
    const retained = captured.value as NormalizedRelationalPredicate;
    // SAFETY: only this issuer registers the frozen token in the private
    // WeakMap; the nominal type grants nothing without that exact identity.
    const program = Object.freeze({}) as PostgresRelationalPredicateProgram<never>;
    programs.set(program, Object.freeze({ kind: "scalar", sourceTable, predicate: retained, bytes: captured.bytes }));
    return program;
  }));
}

/** Only the metadata-bound related compiler supplies this normalized program.
 * Both table identities remain attached through capture and protected execution. */
export function issuePostgresRelatedRelationalPredicate<Binding, Failure>(sourceTable: RelationalTableDefinition,
  child: RelatedRelationalBinding<Binding>, predicate: NormalizedRelatedRelationalPredicate, error: PostgresRelationalPredicateFailure<Failure>) {
  return capturePrivateJsonData(predicate, MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES, error).pipe(Result.map(captured => {
    // SAFETY: capture preserves the compiler-validated normalized tree.
    const retained = captured.value as NormalizedRelatedRelationalPredicate;
    // SAFETY: only exact identities registered here carry a program.
    const program = Object.freeze({}) as PostgresRelationalPredicateProgram<Binding>;
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
export function preparePostgresRelationalBatch<Binding, Failure>(program: PostgresRelationalPredicateProgram<Binding>,
  sourceTable: RelationalTableDefinition, tableId: Binding, rows: readonly JsonObject[],
  bounds: Readonly<{ rows: number; bytes: number }>, error: PostgresRelationalPredicateFailure<Failure>,
  child?: Readonly<{ table: RelationalTableDefinition; tableId: Binding; rows: readonly JsonObject[] }>) {
  return Result.gen(function* () {
    const retained = programs.get(program);
    if (retained === undefined || retained.sourceTable !== sourceTable) return yield* Result.fail(error("invalidAuthority"));
    if (retained.kind === "related" ? child === undefined || child.table !== retained.child.table || child.tableId !== retained.child.tableId
      : child !== undefined) return yield* Result.fail(error("invalidAuthority"));
    const maximum = yield* decodeBounds(bounds).pipe(Result.mapError(cause => error("invalidInput", cause)));
    const maximumBytes = Math.min(maximum.bytes, MAX_POSTGRES_RELATIONAL_PREDICATE_BYTES);
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
    const batch = Object.freeze({}) as PostgresRelationalPredicateBatch<Binding>;
    batches.set(batch, Object.freeze({ program: retained, tableId, rows: candidates.length,
      inputBytes: retained.bytes + captured.bytes + (childCapture?.bytes ?? 0), maximumBytes, payload: JSON.stringify(captured.value),
      ...(childCapture === undefined ? {} : { childPayload: JSON.stringify(childCapture.value) }) }));
    return batch;
  });
}

/** The exact private token authenticates these issuer-owned facts. Binding has
 * no structural meaning; contextual owners compare their own exact identity. */
export function inspectIssuedPostgresRelationalBatch<Binding, Failure>(batch: PostgresRelationalPredicateBatch<Binding>,
  error: PostgresRelationalPredicateFailure<Failure>): Result.Result<Batch<Binding>, Failure> {
  const facts = batches.get(batch);
  // SAFETY: this exact private token was issued with Binding; callers cannot
  // substitute its registered program, immutable payload or owner identity.
  return facts === undefined ? Result.fail(error("invalidAuthority")) : Result.succeed(facts as Batch<Binding>);
}

const batchFacts = <Binding, Failure>(batch: PostgresRelationalPredicateBatch<Binding>, tableId: Binding,
  error: PostgresRelationalPredicateFailure<Failure>): Result.Result<Batch<Binding>, Failure> =>
  inspectIssuedPostgresRelationalBatch(batch, error).pipe(Result.flatMap(facts =>
    facts.tableId !== tableId ? Result.fail(error("invalidAuthority")) : Result.succeed(facts)));

export function inspectPostgresRelationalBatch<Binding, Failure>(batch: PostgresRelationalPredicateBatch<Binding>,
  tableId: Binding, error: PostgresRelationalPredicateFailure<Failure>) {
  return batchFacts(batch, tableId, error).pipe(Result.map(facts => Object.freeze({ table: facts.program.sourceTable,
    rows: facts.rows, inputBytes: facts.inputBytes,
    ...(facts.program.kind === "scalar" ? {} : { child: Object.freeze({ table: facts.program.child.table, tableId: facts.program.child.tableId }) }) })));
}

const decodeMatches = Schema.decodeUnknownResult(Schema.Array(Schema.Struct({
  ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), matched: Schema.NullOr(Schema.Boolean),
})), { onExcessProperty: "error" });

export function decodePostgresRelationalMatches<Binding, Failure>(batch: PostgresRelationalPredicateBatch<Binding>,
  tableId: Binding, input: unknown, error: PostgresRelationalPredicateFailure<Failure>) {
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
