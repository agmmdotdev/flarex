import { Effect, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationWriteOwnershipCatalog } from "./Catalog";
import { buildApplicationOwnershipUniqueClosureReadStatement, decodeCapturedAppUniqueConstraintSetClosureEffect, type ReadAppUniqueConstraintSetClosureV1Error } from "../appUniqueConstraintSetClosureV1";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError } from "./Model";
import type { ApplicationWriteOwnershipHistoryBudget } from "./Policy";

const projectFailure = (cause: ReadAppUniqueConstraintSetClosureV1Error) => new ApplicationWriteOwnershipError({
  reason: cause._tag === "AppUniqueConstraintSetClosurePersistenceV1Error" ||
    cause._tag === "AppUniqueConstraintSetClosureResourceError" ||
    cause._tag === "AppUniqueConstraintCatalogPersistenceError" ? "resourceFailure" : "invalidEvidence", cause,
});

/** Closed catalog sets are immutable. Reserve each binding/definition before restoring its payload. */
export const readOwnershipUniqueClosure = Effect.fn("ApplicationWriteOwnership.readUniqueClosure")(function* (
  catalog: ApplicationWriteOwnershipCatalog, deploymentId: string, schemaVersionId: CatalogSchemaVersionId, budget: ApplicationWriteOwnershipHistoryBudget,
) {
  const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(catalog.transaction.execute(
    buildApplicationOwnershipUniqueClosureReadStatement(deploymentId, schemaVersionId, budget.remaining())),
    cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause })));
  const rows = rowsFromDriverExecuteResult(result, () => {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - a resolved SQL catalog read must expose the driver rows wrapper.
    throw new Error("Ownership unique closure driver result has no rows");
  });
  return yield* decodeCapturedOwnershipUniqueClosure(deploymentId, schemaVersionId, rows, budget);
});

const CapturedUniqueSizeSchema = Schema.Struct({ ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  evidenceLength: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) });
const decodeCapturedUniqueSizeResult = Schema.decodeUnknownResult(CapturedUniqueSizeSchema);

export const decodeCapturedOwnershipUniqueClosure = Effect.fn("ApplicationWriteOwnership.decodeCapturedUniqueClosure")(function* (
  deploymentId: string, schemaVersionId: CatalogSchemaVersionId, rawRows: readonly unknown[], budget: ApplicationWriteOwnershipHistoryBudget,
) {
  const definitions = rawRows.filter(row => isNonArrayRecord(row) && row.kind === "definition");
  const sizes = [];
  for (const [ordinal, row] of definitions.entries()) {
    const size = yield* Effect.fromResult(decodeCapturedUniqueSizeResult(row)).pipe(Effect.mapError(cause =>
      new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })));
    if (size.ordinal !== ordinal) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
    sizes.push(size.evidenceLength);
  }
  yield* Effect.fromResult(budget.consume(1 + sizes.length * 2, 512 + sizes.reduce((bytes, length) => bytes + length + 512, 0)));
  const closure = yield* decodeCapturedAppUniqueConstraintSetClosureEffect(deploymentId, schemaVersionId, sizes.length, rawRows).pipe(Effect.mapError(projectFailure));
  if (closure === null || closure.members.length !== sizes.length) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
  return closure;
});
