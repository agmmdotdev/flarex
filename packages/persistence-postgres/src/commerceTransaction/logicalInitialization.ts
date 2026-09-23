import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { fxSystemLogicalSourceInitializations } from "../logicalStorageInitialization";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { commerceError } from "./model";
import { projectCommerceRequestFailure } from "./request";
import type { CommerceInitialization } from "./initializationContract";

/** Fresh first-data evidence for an authenticated logical participant. The
 * receipt is read inside its borrowed request transaction before any callback. */
export const requireLogicalCommerceInitialization = Effect.fn("LogicalCommerce.requireInitialization")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
  initialization: CommerceInitialization, contractSha256: string,
) {
  const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
  const recorded = yield* runDrizzleStatementEffect(tx.select().from(fxSystemLogicalSourceInitializations).where(and(
    eq(fxSystemLogicalSourceInitializations.scopeUuid, scope.scopeUuid),
    eq(fxSystemLogicalSourceInitializations.sourceKey, state.sourceKey),
    eq(fxSystemLogicalSourceInitializations.stepId, initialization.stepId),
  )).limit(2), cause => commerceError("statementFailure", cause));
  if (recorded.length === 0) return yield* Effect.fail(commerceError("seedRequired"));
  if (recorded.length !== 1) return yield* Effect.fail(commerceError("storedCorruption"));
  const receipt = recorded[0];
  if (receipt?.sourceSha256 !== state.sourceSha256 || receipt.contractSha256 !== contractSha256 ||
    receipt.datasetSha256 !== initialization.datasetSha256 || receipt.rowCount !== initialization.expectedRowCount)
    return yield* Effect.fail(commerceError("seedMismatch"));
});
