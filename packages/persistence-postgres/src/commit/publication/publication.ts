import { closeExactAttemptScopeClockObservation } from "../../scope/scopeClock";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Result } from "effect";
import { MAX_PERSISTED_SIGNED_INT64_V1, CommitSeqSchema, type CommitSeq, type ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { type AppRowTransaction } from "../../storage/documents/appRows";
import { observeDrizzleQuery as observeCompiledDrizzleQuery } from "../../database/drizzleQueryObservation";
import { fxSystemScopeClocks } from "../../database/schema";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure, type ScopePublicationClock, type ScopePublicationContribution, type ScopePublicationKernel, type ScopePublicationOptions, type ScopePublicationSqlOperation } from "./scopePublicationModel";
import { requireStrongReferencePublication } from "./strongReferenceAdmission";
import {
  observePointCommitPublicationEffect,
} from "../point/observation";
import { requireAdmittedTargetInstallationSchema } from "../../installation/installationLifecycle";
import { scopePublicationProcedureFailure } from "./prefixProjection";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";

export { writeScopePublicationPrefix, beginScopePublicationPrefix, reproveScopePublicationPrefix } from "./prefixWriter";
export type { ScopePublicationPrefixProof } from "./prefixWriter";

export const requireScopePublicationStrongReferences = Effect.fn("ScopePublication.requireFinalReferences")((
  tx: AppRowTransaction, kernel: ScopePublicationKernel, options: ScopePublicationOptions,
) => observePointCommitPublicationEffect(options.publicationObservation, "finalReferences",
  requireStrongReferencePublication(tx, kernel.clock, kernel.commitSeq, options)));

export function scopePublicationClockAdvanceSource(schemaName: string, kernel: ScopePublicationKernel) {
  return sql`${sql.identifier(schemaName)}.fx_advance_scope_publication_clock(${kernel.clock.scopeUuid}::uuid,
    ${kernel.clock.record.lastCommitSeq.toString()}::bigint, ${kernel.commitSeq.toString()}::bigint,
    ${sql.param(new Date(kernel.publicationTimeMilliseconds), fxSystemScopeClocks.updatedAt)}::timestamptz)`;
}

export const advanceScopePublicationClock = Effect.fn("ScopePublication.advanceClock")(function* (
  tx: AppRowTransaction,
  command: ScopePublicationContribution,
  kernel: ScopePublicationKernel,
  options: ScopePublicationOptions,
) {
  yield* requireScopePublicationStrongReferences(tx, kernel, options);
  const commitSeq = kernel.commitSeq;
  closeExactAttemptScopeClockObservation(tx);
  options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "begin" });
  yield* Effect.gen(function* () {
    const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx));
    const query = tx.select({
      lastCommitSeq: sql`advanced.last_commit_seq`.mapWith(fxSystemScopeClocks.lastCommitSeq),
    }).from(sql`${scopePublicationClockAdvanceSource(schemaName, kernel)} advanced`);
    observeDrizzleQuery("advanceScopeClock", query, options);
    const clock = yield* runDrizzleStatementEffect(query, cause =>
      scopePublicationProcedureFailure(cause) ?? new ScopePublicationSqlFailure({ operation: "advanceScopeClock", cause }));
    yield* Effect.fromResult(requirePointCommitClockPublicationResult(clock, commitSeq));
    const afterTransactionStep = options.afterTransactionStep;
    if (afterTransactionStep !== undefined) yield* Effect.tryPromise({
      try: () => afterTransactionStep(Object.freeze({ scopeId: command.authorityPins.scopeId, step: "clockAdvanced" })),
      catch: cause => cause,
    }).pipe(Effect.catchIf(Cause.isCause, cause => Effect.failCause(cause)));
    if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "clockAdvances", counts: { rows: clock.length } });
  }).pipe(Effect.ensuring(Effect.sync(() =>
    options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "end" }))));
});

export function allocateScopePublicationResult(
  clock: Pick<ScopePublicationClock, "record">,
  publicationTimeMilliseconds: number,
): Result.Result<
  Readonly<{
    readonly commitSeq: CommitSeq;
    readonly publicationTimeMilliseconds: number;
  }>,
  ScopePublicationResourceError
> {
  if (clock.record.lastCommitSeq >= MAX_PERSISTED_SIGNED_INT64_V1) {
    return Result.fail(new ScopePublicationResourceError({
      dimension: "commitSequence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    }));
  }
  return Result.succeed(Object.freeze({
    commitSeq: CommitSeqSchema.make(clock.record.lastCommitSeq + 1n),
    publicationTimeMilliseconds,
  }));
}

export async function readScopePublicationDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  options: ScopePublicationOptions,
): Promise<number> {
  const query = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  observeDrizzleQuery("readDatabaseTime", query, options);
  const rows = await sqlCall("readDatabaseTime", () => query);
  return projectScopePublicationResult(
    decodeScopePublicationDatabaseTimeResult(rows[0]?.milliseconds),
  );
}

function decodeScopePublicationDatabaseTimeResult(
  text: unknown,
): Result.Result<number, ScopePublicationCorruptionError> {
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  const value = Number(text);
  if (!isPositiveSafeInteger(value)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  return Result.succeed(value);
}

export function requirePointCommitClockPublicationResult(
  rows: ReadonlyArray<Readonly<{
    readonly lastCommitSeq: CommitSeq;
  }>>,
  expectedCommitSeq: CommitSeq,
): Result.Result<void, ScopePublicationCorruptionError> {
  if (
    rows.length !== 1 ||
    rows[0]?.lastCommitSeq !== expectedCommitSeq
  ) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(undefined);
}

const corruption = (reason: ScopePublicationCorruptionError["reason"]) => new ScopePublicationCorruptionError({ reason });

// This is the existing native Promise publication boundary. Effect participants
// join it through their owned bridge; it neither creates a runtime nor settles SQL.
async function sqlCall<Value>(operation: ScopePublicationSqlOperation, call: () => PromiseLike<Value>): Promise<Value> {
  try { return await call(); } catch (cause) { throw scopePublicationProcedureFailure(cause) ?? new ScopePublicationSqlFailure({ operation, cause }); }
}
function observeDrizzleQuery(name: ScopePublicationSqlOperation, query: { toSQL: () => { sql: string; params: unknown[] } }, options: ScopePublicationOptions): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

/** Throwing projection at the existing native/Drizzle Promise transaction boundary. */
function projectScopePublicationResult<Value, Failure>(result: Result.Result<Value, Failure>): Value {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: transaction - projects typed publication failures into the existing Drizzle Promise rollback boundary without creating a nested Effect runtime.
  return Result.getOrThrow(result);
}
