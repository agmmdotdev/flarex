import { sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import type { fxSystemIndexBuildStates as indexes, fxSystemUniqueConstraintBuilds as unique } from "../schema";
import type { AppRowTransaction } from "../appRows";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import { requireAdmittedTargetInstallationSchema } from "../installationLifecycle";
import { applicationDomainFailureDetail, applicationIndexCoverageArray, applicationUniqueCoverageArray } from "./domainApplication";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";

export const APPLICATION_COVERAGE_MAX_ROWS = 512;
export type IndexCoverageWrite = Pick<typeof indexes.$inferSelect,
  "scopeId" | "indexDefinitionId" | "attemptFence" | "epoch" | "storageGenerationFence">;
export type UniqueCoverageWrite = Pick<typeof unique.$inferSelect,
  "scopeId" | "uniqueConstraintDefinitionId" | "attemptFence" | "epoch" | "storageGenerationFence">;
export type CoverageProof<Row> = Readonly<{ row: Row; stored: string }>;
export type ApplicationCoverageProofs = Readonly<{
  indexes: readonly CoverageProof<IndexCoverageWrite>[];
  unique: readonly CoverageProof<UniqueCoverageWrite>[];
}>;
export class ApplicationCoverageRefusal extends Data.TaggedError("ApplicationCoverageRefusal")<{
  readonly reason: "invalidBatch" | "concurrentStateChange" | "storedCorruption";
  readonly family: "index" | "unique"; readonly stage: "write" | "verify"; readonly ordinal: number;
  readonly cause: unknown;
}> {}
export class ApplicationCoveragePersistenceError extends Data.TaggedError("ApplicationCoveragePersistenceError")<{
  readonly cause: unknown;
}> {}
const decodeRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "concurrentStateChange", "storedCorruption"]),
  family: Schema.Literals(["index", "unique"]), stage: Schema.Literals(["write", "verify"]), ordinal: Schema.Number,
})), { onExcessProperty: "error" });
const decodeSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), family: Schema.Null, ordinal: Schema.Number,
  index_proofs: Schema.Array(Schema.String), unique_proofs: Schema.Array(Schema.String),
}), { onExcessProperty: "error" });
const emptyProofs: ApplicationCoverageProofs = { indexes: [], unique: [] };

export function applicationCoverageFailure(cause: unknown, indexCount: number, uniqueCount: number,
  priorIndexCount: number, priorUniqueCount: number, capturedDetail?: string) {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_advance_app_coverage");
  if (detail === null) return new ApplicationCoveragePersistenceError({ cause });
  return Result.match(decodeRefusal(detail), {
    onFailure: () => new ApplicationCoveragePersistenceError({ cause }),
    onSuccess: refusal => {
      const current = refusal.family === "index" ? indexCount : uniqueCount;
      const prior = refusal.family === "index" ? priorIndexCount : priorUniqueCount;
      return Number.isSafeInteger(refusal.ordinal) && refusal.ordinal >= 0 &&
        refusal.ordinal < current + (refusal.stage === "verify" ? prior : 0) &&
        (refusal.stage !== "verify" || refusal.reason === "storedCorruption")
        ? new ApplicationCoverageRefusal({ ...refusal, cause }) : new ApplicationCoveragePersistenceError({ cause });
    },
  });
}

/** The procedure returns exact complete stored projections after trigger agreement.
 * These transaction-local proofs avoid timestamptz precision loss through JS Date;
 * genuine fence pins still select each actual row for the final page's fresh proof. */
export const applyApplicationCoverage = Effect.fn("ApplicationCoverage.apply")(
  function* (tx: AppRowTransaction, indexRows: readonly IndexCoverageWrite[],
    uniqueRows: readonly UniqueCoverageWrite[], commitSeq: CommitSeq, expectedPrior?: CommitSeq,
    verification: ApplicationCoverageProofs = emptyProofs) {
    if (indexRows.length + uniqueRows.length + verification.indexes.length + verification.unique.length > APPLICATION_COVERAGE_MAX_ROWS)
      return yield* Effect.fail(new ApplicationCoveragePersistenceError({ cause: "coverageRowCountExceeded" }));
    const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(
      Result.mapError(cause => new ApplicationCoveragePersistenceError({ cause }))));
    const statement = sql`select reason, family, ordinal, index_proofs, unique_proofs from ${sql.identifier(schemaName)}.fx_advance_app_coverage(
        ${applicationIndexCoverageArray(indexRows, schemaName)}, ${applicationUniqueCoverageArray(uniqueRows, schemaName)}, ${commitSeq}::bigint,
        ${expectedPrior ?? null}::bigint, ${expectedPrior !== undefined}::boolean,
        ${applicationIndexCoverageArray(verification.indexes.map(proof => proof.row), schemaName)}, ${applicationUniqueCoverageArray(verification.unique.map(proof => proof.row), schemaName)},
        array[${sql.join(verification.indexes.map(proof => sql`${proof.stored}`), sql`, `)}]::text[],
        array[${sql.join(verification.unique.map(proof => sql`${proof.stored}`), sql`, `)}]::text[])`;
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => tx.execute(statement),
      catch: cause => applicationCoverageFailure(cause, indexRows.length, uniqueRows.length, verification.indexes.length, verification.unique.length),
    }));
    const rows = rowsFromDriverExecuteResult(result, () => { throw new ApplicationCoveragePersistenceError({ cause: result }); });
    if (rows.length !== 1) return yield* Effect.fail(new ApplicationCoveragePersistenceError({ cause: result }));
    const accepted = yield* Effect.fromResult(decodeSuccess(rows[0]).pipe(
      Result.mapError(cause => new ApplicationCoveragePersistenceError({ cause }))));
    if (accepted.ordinal !== indexRows.length + uniqueRows.length || accepted.index_proofs.length !== indexRows.length ||
      accepted.unique_proofs.length !== uniqueRows.length)
      return yield* Effect.fail(new ApplicationCoveragePersistenceError({ cause: accepted }));
    return {
      indexes: indexRows.map((row, ordinal) => ({ row, stored: accepted.index_proofs[ordinal]! })),
      unique: uniqueRows.map((row, ordinal) => ({ row, stored: accepted.unique_proofs[ordinal]! })),
    } satisfies ApplicationCoverageProofs;
  },
);
