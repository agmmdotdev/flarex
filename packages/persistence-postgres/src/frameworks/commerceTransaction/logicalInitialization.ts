import { Effect } from "effect";
import { and, eq, inArray, sql, getTableColumns } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { fxSystemLogicalSourceInitializations } from "../../storage/catalog/logicalStorageInitialization";
import { fxAppRowCurrent, fxAppRowRevisions } from "../../database/schema";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { requireLogicalRelationalReadAdmission, type LogicalRelationalReadAdmission } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { commerceError, type CommerceTransactionError } from "./model";
import { readStandaloneSourceInitialization } from "../../storage/documents/standaloneReadSnapshot";
import { projectCommerceRequestFailure } from "./request";
import type { CommerceInitialization } from "./initializationContract";
import type { TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";

/** One root owns the selected receipt observation. Acquisition remains lazy at
 * the first source's initialization gate; later receipt fields are accepted only
 * after that source's ordinary admission. No receipt lends admission authority. */
export const withLogicalCommerceInitializationReceipts = Effect.fn("LogicalCommerce.withInitializationReceipts")(function* <Value, Failure>(
  tx: FlarexMetadataTransaction, authority: TrustedScopeAuthority,
  selected: readonly Readonly<{ sourceKey: string; initialization: CommerceInitialization }>[],
  work: (requireReceipt: (admission: LogicalRelationalAdmission, initialization: CommerceInitialization) =>
    Effect.Effect<void, CommerceTransactionError>) => Effect.Effect<Value, Failure>,
): Effect.fn.Return<Value, Failure | CommerceTransactionError> {
  let active = true;
  const captures = new Map<number, readonly Readonly<{ ordinal: number;
    receipt: typeof fxSystemLogicalSourceInitializations.$inferSelect | null }>[]>();
  const requireReceipt = Effect.fn("LogicalCommerce.requireRootInitialization")(function* (
    admission: LogicalRelationalAdmission, initialization: CommerceInitialization,
  ) {
    if (!active) return yield* Effect.fail(commerceError("invalidAuthority"));
    const state = yield* requireLogicalRelationalAdmission(admission, tx).pipe(Effect.mapError(projectCommerceRequestFailure));
    const ordinal = selected.findIndex(member => member.sourceKey === state.sourceKey && member.initialization === initialization);
    if (ordinal < 0 || state.authority !== authority) return yield* Effect.fail(commerceError("invalidAuthority"));
    const offset = Math.floor(ordinal / 32) * 32;
    let capture = captures.get(offset);
    if (capture === undefined) {
      const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(authority.scopeId)).pipe(Effect.mapError(projectCommerceRequestFailure));
      const page = selected.slice(offset, offset + 32);
      const requested = sql`(values ${sql.join(page.map((member, index) => sql`(${offset + index}::integer,
        ${member.sourceKey}::text, ${member.initialization.stepId}::text)`), sql`, `)}) as requested(ordinal, source_key, step_id)`;
      capture = yield* runDrizzleStatementEffect(tx.select({ ordinal: sql<number>`requested.ordinal`,
        receipt: getTableColumns(fxSystemLogicalSourceInitializations) }).from(requested)
        .leftJoin(fxSystemLogicalSourceInitializations, and(eq(fxSystemLogicalSourceInitializations.scopeUuid, scope.scopeUuid),
          sql`${fxSystemLogicalSourceInitializations.sourceKey} = requested.source_key`,
          sql`${fxSystemLogicalSourceInitializations.stepId} = requested.step_id`)).orderBy(sql`requested.ordinal`),
      cause => commerceError("statementFailure", cause));
      if (capture.length !== page.length) return yield* Effect.fail(commerceError("storedCorruption"));
      captures.set(offset, capture);
    }
    const observed = capture[ordinal - offset];
    if (observed === undefined || observed.ordinal !== ordinal) return yield* Effect.fail(commerceError("storedCorruption"));
    const receipt = observed.receipt;
    if (receipt === null) return yield* Effect.fail(commerceError("seedRequired"));
    if (receipt.sourceKey !== state.sourceKey || receipt.stepId !== initialization.stepId ||
      receipt.sourceSha256 !== state.sourceSha256 || receipt.datasetSha256 !== initialization.datasetSha256 ||
      receipt.rowCount !== initialization.expectedRowCount) return yield* Effect.fail(commerceError("seedMismatch"));
  });
  return yield* Effect.suspend(() => work(requireReceipt))
    .pipe(Effect.ensuring(Effect.sync(() => { active = false; captures.clear(); })));
});

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
