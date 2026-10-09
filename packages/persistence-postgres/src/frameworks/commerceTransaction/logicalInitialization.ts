import { Effect } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { fxSystemLogicalSourceInitializations } from "../../storage/catalog/logicalStorageInitialization";
import { fxAppRowCurrent, fxAppRowRevisions } from "../../database/schema";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { requireLogicalRelationalReadAdmission, type LogicalRelationalReadAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { commerceError } from "./model";
import { readStandaloneSourceInitialization } from "../../storage/documents/standaloneReadSnapshot";
import { projectCommerceRequestFailure } from "./request";
import type { CommerceInitialization } from "./initializationContract";

/** One indexed existence probe across every table in the selected source.
 * Tombstones do not make a new seed conflict with existing live data. */
export const hasLiveLogicalCommerceRows = Effect.fn("LogicalCommerce.hasLiveRows")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
) {
  const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  if (state.tables.length === 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
  const rows = yield* runDrizzleStatementEffect(tx.select({ tableId: fxAppRowCurrent.tableId }).from(fxAppRowCurrent)
    .innerJoin(fxAppRowRevisions, and(eq(fxAppRowCurrent.scopeUuid, fxAppRowRevisions.scopeUuid),
      eq(fxAppRowCurrent.tableId, fxAppRowRevisions.tableId),
      eq(fxAppRowCurrent.rowId, fxAppRowRevisions.rowId),
      eq(fxAppRowCurrent.commitSeq, fxAppRowRevisions.commitSeq)))
    .where(and(eq(fxAppRowCurrent.scopeUuid, scope.scopeUuid),
      inArray(fxAppRowCurrent.tableId, state.tables.map(table => table.tableId)),
      eq(fxAppRowRevisions.isTombstone, false))).limit(1),
  cause => commerceError("statementFailure", cause));
  return rows.length !== 0;
});

/** Fresh first-data evidence for an authenticated logical participant. The
 * receipt is read inside its borrowed request transaction before any callback. */
export const requireLogicalCommerceInitialization = Effect.fn("LogicalCommerce.requireInitialization")(function* (
  admission: LogicalRelationalAdmission, tx: FlarexMetadataTransaction,
  initialization: CommerceInitialization,
) {
  const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  yield* requireStableInitializationReceipt(state, tx, initialization);
});

export const requireLogicalCommerceReadInitialization = Effect.fn("LogicalCommerce.requireReadInitialization")(function* (
  admission: LogicalRelationalReadAdmission, tx: FlarexMetadataTransaction,
  initialization: CommerceInitialization, contractSha256: string,
) {
  const state = yield* requireLogicalRelationalReadAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
  const receipt = yield* requireStableInitializationReceipt(state, tx, initialization);
  // This reader receives the original installed seed digest explicitly. It is
  // distinct from a full host's current schema-bound operation contract.
  if (receipt.contractSha256 !== contractSha256) return yield* Effect.fail(commerceError("seedMismatch"));
});

/** Source-scoped first-data authority survives unrelated catalog publications.
 * The stored operation digest remains original seed provenance, unchanged. */
const requireStableInitializationReceipt = Effect.fn("LogicalCommerce.requireStableInitializationReceipt")(function* (
  state: Pick<Effect.Success<ReturnType<typeof requireLogicalRelationalAdmission>>, "authority" | "sourceKey" | "sourceSha256">,
  tx: FlarexMetadataTransaction, initialization: CommerceInitialization,
) {
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
  const observed = readStandaloneSourceInitialization(tx, state.authority.scopeId, state.sourceKey, initialization.stepId);
  const recorded = observed === undefined ? yield* runDrizzleStatementEffect(tx.select().from(fxSystemLogicalSourceInitializations).where(and(
    eq(fxSystemLogicalSourceInitializations.scopeUuid, scope.scopeUuid),
    eq(fxSystemLogicalSourceInitializations.sourceKey, state.sourceKey),
    eq(fxSystemLogicalSourceInitializations.stepId, initialization.stepId),
  )).limit(2), cause => commerceError("statementFailure", cause)) : observed === null ? [] : [observed];
  if (recorded.length === 0) return yield* Effect.fail(commerceError("seedRequired"));
  if (recorded.length !== 1) return yield* Effect.fail(commerceError("storedCorruption"));
  const receipt = recorded[0];
  if (receipt?.sourceSha256 !== state.sourceSha256 ||
    receipt.datasetSha256 !== initialization.datasetSha256 || receipt.rowCount !== initialization.expectedRowCount)
    return yield* Effect.fail(commerceError("seedMismatch"));
  return receipt;
});
