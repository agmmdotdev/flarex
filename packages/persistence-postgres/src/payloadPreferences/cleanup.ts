import { Effect, Result, Schema } from "effect";
import { sql } from "drizzle-orm";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { requireCmsAdmission, type CmsAdmission } from "../cmsTransaction/admission";
import { requireCmsPendingDeletion, type CmsPendingDeletions } from "../cmsTransaction/documents";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import { cmsError, cmsLimits, type CmsRequestContext, type CmsPresentedTransactionId, type CmsTransactionError } from "../cmsTransaction/model";
import { capturePrivateJsonData } from "../privateJsonData";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";

export interface PayloadPreferenceCleanup {
  readonly deleteForPendingDocument: (context: CmsRequestContext, transactionId: CmsPresentedTransactionId,
    collectionSlug: string, selector: unknown) => Effect.Effect<void, CmsTransactionError>;
}
interface DeletionEvidence {
  readonly documentId: AppDocumentIdV1;
  readonly collectionSlug: string;
  readonly key: string;
  readonly preferenceIds: readonly string[];
}
declare const receiptBrand: unique symbol;
export interface PayloadPreferenceCleanupReceipt { readonly [receiptBrand]: true }
declare const closureBrand: unique symbol;
export interface PayloadPreferenceCleanupClosure { readonly [closureBrand]: true }
interface ReceiptAuthority {
  readonly admission: CmsAdmission;
  readonly lifetime: CmsRequestLifetime;
  readonly pendingDeletions: CmsPendingDeletions;
}
const receipts = new WeakMap<object, ReceiptAuthority & DeletionEvidence>();
const closures = new WeakMap<object, ReceiptAuthority & Readonly<{ receipts: readonly PayloadPreferenceCleanupReceipt[] }>>();
const decodeSelector = Schema.decodeUnknownEffect(Schema.Struct({ key: Schema.Struct({ in: Schema.Tuple([Schema.String]) }) }),
  { onExcessProperty: "error" });
const decodeIds = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String.check(
  Schema.makeFilter(value => value.length > 0 && value.length <= 512 ? undefined : "Invalid preference identity"),
) })));
const readIds = Effect.fn("PayloadPreferences.readIds")(function* (result: unknown) {
  const rows = yield* Effect.try({ try: () => rowsFromDriverExecuteResult(result, () => { throw cmsError("storedCorruption"); }),
    catch: cause => cmsError("storedCorruption", cause) });
  return (yield* decodeIds(rows).pipe(Effect.mapError(cause => cmsError("storedCorruption", cause)))).map(row => row.id);
});

/** Transaction-owned instance, composed with the authenticated document working set. */
export const makePayloadPreferenceCleanup = Effect.fn("PayloadPreferences.makeCleanup")(function* (
  admission: CmsAdmission, lifetime: CmsRequestLifetime, pendingDeletions: CmsPendingDeletions,
) {
  const state = yield* requireCmsAdmission(admission);
  const issued: PayloadPreferenceCleanupReceipt[] = [];
  const keys = new Set<string>();
  let identityCount = 0;
  let closed = false;
  const authority = Object.freeze({ admission, lifetime, pendingDeletions });
  const deleteForPendingDocument: PayloadPreferenceCleanup["deleteForPendingDocument"] = Effect.fn("PayloadPreferences.deleteForPendingDocument")(
    (context, transactionId, collectionSlug, selector) => lifetime.operation(context, transactionId, "write", Effect.gen(function* () {
      yield* requireCmsAdmission(admission, state.tx);
      if (closed) return yield* Effect.fail(cmsError("closed"));
      const availability = state.preferenceAvailability;
      if (availability === null) return yield* Effect.fail(cmsError("unsupportedProfile"));
      const captured = yield* Effect.fromResult(capturePrivateJsonData(selector, lifetime.remainingBytes(), cmsError));
      yield* Effect.fromResult(lifetime.charge(captured.bytes));
      const value = yield* decodeSelector(captured.value).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      const prefix = `collection-${collectionSlug}-`;
      if (!state.configuration.tables.some(table => table.collectionSlug === collectionSlug) || !value.key.in[0].startsWith(prefix)) {
        return yield* Effect.fail(cmsError("invalidInput"));
      }
      const key = value.key.in[0];
      if (keys.has(key)) return yield* Effect.fail(cmsError("invalidInput"));
      const pending = yield* requireCmsPendingDeletion(pendingDeletions, admission, lifetime, key.slice(prefix.length));
      if (pending.collectionSlug !== collectionSlug || key !== `collection-${pending.collectionSlug}-${pending.documentId}`) {
        return yield* Effect.fail(cmsError("invalidAuthority"));
      }
      const documentId = pending.documentId;
      const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)
        .pipe(Result.mapError(cause => cmsError("invalidAuthority", cause))));
      const layout = availability.installation.plan.plan.physicalLayout.frame;
      const physical = layout.tables[0];
      if (physical === undefined) return yield* Effect.fail(cmsError("storedCorruption"));
      const generation = physical.columns.find(column => column.identity.columnId === "storage_generation");
      const identity = physical.columns.find(column => column.identity.columnId === "id");
      const lookup = physical.columns.find(column => column.identity.columnId === "key");
      if (generation === undefined || identity === undefined || lookup === undefined) return yield* Effect.fail(cmsError("storedCorruption"));
      // Dynamic coordinator-owned identifiers require qualified SQL; values remain parameters.
      const table = sql`${sql.identifier(layout.targetNamespace.schemaName)}.${sql.identifier(physical.name)}`;
      const id = sql.identifier(identity.name);
      const where = sql`${sql.identifier("scope_uuid")} = ${scope.scopeUuid}::uuid and ${sql.identifier(generation.name)} = ${state.authority.storageGeneration}
        and ${sql.identifier(lookup.name)} = ${key}`;
      const budget = cmsLimits.identities - identityCount;
      const selected = yield* runDrizzleStatementEffect(state.tx.execute(sql`select
        case when octet_length(${id}) between 1 and 2048 then ${id} else null end as id
        from ${table} where ${where} order by ${id} limit ${budget + 1} for update`), cause => cmsError("statementFailure", cause)).pipe(Effect.flatMap(readIds));
      if (selected.length > budget) return yield* Effect.fail(cmsError("limitExceeded"));
      yield* Effect.fromResult(lifetime.charge(128 + selected.reduce((bytes, preferenceId) => bytes + preferenceId.length * 4 + 64, 0)));
      if (selected.length > 0) {
        const deleted = yield* runDrizzleStatementEffect(state.tx.execute(sql`delete from ${table} where ${where}
          and ${id} in (${sql.join(selected.map(preferenceId => sql`${preferenceId}`), sql`, `)}) returning ${id} as id`),
        cause => cmsError("statementFailure", cause)).pipe(Effect.flatMap(readIds));
        const exact = new Set(selected);
        if (exact.size !== selected.length || deleted.length !== selected.length || new Set(deleted).size !== deleted.length ||
          deleted.some(preferenceId => !exact.has(preferenceId))) return yield* Effect.fail(cmsError("storedCorruption"));
      }
      // SAFETY: only the owner issues receipts after the actual bounded query/delete.
      const receipt = Object.freeze({}) as PayloadPreferenceCleanupReceipt;
      receipts.set(receipt, Object.freeze({ ...authority, documentId, collectionSlug, key, preferenceIds: Object.freeze(selected) }));
      issued.push(receipt);
      identityCount += selected.length;
      keys.add(key);
    })),
  );
  const close = Effect.fn("PayloadPreferences.closeCleanup")(function* () {
    yield* requireCmsAdmission(admission);
    if (closed || !lifetime.isClosing()) return yield* Effect.fail(cmsError("invalidAuthority"));
    closed = true;
    // SAFETY: the registry binds the complete receipt set to this closing request.
    const closure = Object.freeze({}) as PayloadPreferenceCleanupClosure;
    closures.set(closure, Object.freeze({ ...authority, receipts: Object.freeze([...issued]) }));
    return closure;
  });
  return Object.freeze({ cleanup: Object.freeze({ deleteForPendingDocument }), close });
});

/** Single-use owner evidence only; consuming it grants no publication authority. */
export const consumePayloadPreferenceCleanup = Effect.fn("PayloadPreferences.consumeCleanup")(function* (
  closure: PayloadPreferenceCleanupClosure, admission: CmsAdmission, lifetime: CmsRequestLifetime,
  pendingDeletions: CmsPendingDeletions,
) {
  const state = closures.get(closure);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime || state.pendingDeletions !== pendingDeletions || !lifetime.isClosing()) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  yield* requireCmsAdmission(admission);
  const evidence: DeletionEvidence[] = [];
  for (const receipt of state.receipts) {
    const entry = receipts.get(receipt);
    if (entry === undefined || entry.admission !== admission || entry.lifetime !== lifetime || entry.pendingDeletions !== state.pendingDeletions) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    const pending = yield* requireCmsPendingDeletion(entry.pendingDeletions, admission, lifetime, entry.documentId);
    if (pending.collectionSlug !== entry.collectionSlug || entry.key !== `collection-${pending.collectionSlug}-${pending.documentId}`) {
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }
    evidence.push(Object.freeze({ documentId: entry.documentId, collectionSlug: entry.collectionSlug, key: entry.key, preferenceIds: entry.preferenceIds }));
  }
  closures.delete(closure);
  for (const receipt of state.receipts) receipts.delete(receipt);
  return Object.freeze(evidence);
});
