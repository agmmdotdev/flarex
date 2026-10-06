import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { AppRowTransaction } from "../appRows";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { fxSystemApplicationActiveHeads } from "../applicationActivationSchema";
import { fxSystemScopeClocks } from "../schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError } from "./Model";
import { ApplicationWriteOwnershipHistoryBudget, denyManagedApplicationTableWrites } from "./Policy";
import { readApplicationOwnershipForUniqueDefinitions, type AppUniqueConstraintDefinitionPortV1 } from "../appUniqueConstraintCommitV1";
import { fxSystemApplicationWriteOwnership } from "./Schema";

const ApplicationWriteOwnershipCommitStatusSchema = Schema.Struct({
  contract: Schema.NullOr(Schema.Int), retained: Schema.Boolean,
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeApplicationWriteOwnershipCommitStatus = Schema.decodeUnknownEffect(ApplicationWriteOwnershipCommitStatusSchema);

/** Decisive guard on the existing point-commit transaction, under its scope-clock lock. */
export const validateApplicationWriteOwnershipForCommit = Effect.fn("ApplicationWriteOwnership.validateCommit")(
  function* (tx: AppRowTransaction, input: Readonly<{
    scopeId: ScopeId;
    generation: "application_v1" | "legacy_dynamic_worker_v1";
    authenticatedAttemptedTables: ReadonlyArray<CatalogTableId> | null;
    materialTables: ReadonlyArray<CatalogTableId>;
  }>, uniqueConstraints?: AppUniqueConstraintDefinitionPortV1, target?: LocatedReadCommittedAttemptTargetV1,
    observedStatus?: unknown): Effect.fn.Return<void, ApplicationWriteOwnershipError> {
    const rows = observedStatus === undefined ? yield* runDrizzleStatementEffect(tx.select({
      contract: fxSystemApplicationActiveHeads.readinessContractVersion,
      retained: sql<boolean>`exists (select 1 from ${fxSystemApplicationWriteOwnership}
        where ${fxSystemApplicationWriteOwnership.scopeId} = ${input.scopeId})`,
    }).from(fxSystemScopeClocks).leftJoin(fxSystemApplicationActiveHeads,
      eq(fxSystemApplicationActiveHeads.scopeId, fxSystemScopeClocks.scopeId))
      .where(eq(fxSystemScopeClocks.scopeId, input.scopeId)).limit(1),
    cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause })) : [yield* decodeApplicationWriteOwnershipCommitStatus(observedStatus)
      .pipe(Effect.mapError(cause => new ApplicationWriteOwnershipError({ reason: "invalidEvidence", cause })))];
    const status = rows[0];
    if (status === undefined) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "authorityChanged" }));
    // The scope clock orders this status against activation. A legacy attempt
    // cannot certify the active Application's complete maintenance selection.
    if (status.contract !== null && input.generation === "legacy_dynamic_worker_v1" &&
      (input.authenticatedAttemptedTables === null || input.authenticatedAttemptedTables.length > 0 || input.materialTables.length > 0)) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "writeDenied" }));
    }
    if (!status.retained && (status.contract === null || status.contract === 1 || status.contract === 2)) return;
    const budget = new ApplicationWriteOwnershipHistoryBudget();
    if (uniqueConstraints !== undefined && target === undefined)
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
    const snapshot = yield* readApplicationOwnershipForUniqueDefinitions(uniqueConstraints, tx, input.scopeId, budget, target);
    if (snapshot.ownership === null || snapshot.active?.head.readinessContractVersion !== 3) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }));
    }
    if (input.generation !== "application_v1" || input.authenticatedAttemptedTables === null) {
      return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "writeDenied" }));
    }
    yield* Effect.fromResult(denyManagedApplicationTableWrites(
      [...input.authenticatedAttemptedTables, ...input.materialTables], snapshot.ownership.frame.claims));
  },
);
