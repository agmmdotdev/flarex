import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { AppRowTransaction } from "../appRows";
import { fxSystemApplicationActiveHeads } from "../applicationActivationSchema";
import { fxSystemScopeClocks } from "../schema";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { ApplicationWriteOwnershipError } from "./Model";
import { ApplicationWriteOwnershipHistoryBudget, denyManagedApplicationTableWrites } from "./Policy";
import { readApplicationWriteOwnershipInTransaction } from "./Repository";
import { fxSystemApplicationWriteOwnership } from "./Schema";

/** Decisive guard on the existing point-commit transaction, under its scope-clock lock. */
export const validateApplicationWriteOwnershipForCommit = Effect.fn("ApplicationWriteOwnership.validateCommit")(
  function* (tx: AppRowTransaction, input: Readonly<{
    scopeId: ScopeId;
    generation: "application_v1" | "legacy_dynamic_worker_v1";
    authenticatedAttemptedTables: ReadonlyArray<CatalogTableId> | null;
    materialTables: ReadonlyArray<CatalogTableId>;
  }>): Effect.fn.Return<void, ApplicationWriteOwnershipError> {
    const rows = yield* runDrizzleStatementEffect(tx.select({
      contract: fxSystemApplicationActiveHeads.readinessContractVersion,
      retained: sql<boolean>`exists (select 1 from ${fxSystemApplicationWriteOwnership}
        where ${fxSystemApplicationWriteOwnership.scopeId} = ${input.scopeId})`,
    }).from(fxSystemScopeClocks).leftJoin(fxSystemApplicationActiveHeads,
      eq(fxSystemApplicationActiveHeads.scopeId, fxSystemScopeClocks.scopeId))
      .where(eq(fxSystemScopeClocks.scopeId, input.scopeId)).limit(1),
    cause => new ApplicationWriteOwnershipError({ reason: "resourceFailure", cause }));
    const status = rows[0];
    if (status === undefined) return yield* Effect.fail(new ApplicationWriteOwnershipError({ reason: "authorityChanged" }));
    if (!status.retained && (status.contract === null || status.contract === 1 || status.contract === 2)) return;
    const budget = new ApplicationWriteOwnershipHistoryBudget();
    const snapshot = yield* readApplicationWriteOwnershipInTransaction(tx, input.scopeId, budget);
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
