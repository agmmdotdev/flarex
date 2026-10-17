import { retainLogicalInsertionGraph } from "../../storage/documents/logicalDocuments/insertionOrder";
import { observeExecution } from "../../execution/diagnostics/operation";
import { Effect, Result } from "effect";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { validateApplicationRevisionSyscallDocumentInTransactionV1 } from "../../application/revision/applicationRevisionSyscallValidatorV1";
import { makeLogicalDocumentWorkingSet, type LogicalDocuments, type LogicalDocumentChanges,
  type LogicalDocumentReadTestHooks } from "../../storage/documents/logicalDocuments/workingSet";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission } from "../../storage/documents/logicalDocuments/documentAdmission";
import { requireLogicalDocumentReadAdmission, type LogicalDocumentReadAdmission } from "../../storage/documents/logicalDocuments/documentAdmission";
import type { LogicalReadAdmissionError } from "../../storage/documents/logicalDocuments/readAdmission";
import type { LogicalStorageReadReadiness } from "../../storage/documents/logicalDocuments/model";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import { cmsError, cmsLimits, CmsTransactionError } from "./model";
import type { CmsRequestLifetime } from "./lifetime";

const projectReadAdmission = (cause: LogicalReadAdmissionError) => cmsError(
  cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
    ? "bindingChanged" : cause.reason, cause);

/** Managed reads borrow the selected metadata owner's mechanics and transaction. */
export const makeSourceCmsReadDocuments = Effect.fnUntraced(function* (
  admission: LogicalDocumentReadAdmission, tx: FlarexMetadataTransaction,
  lifetime: CmsRequestLifetime, creationTime: AppCreationTimeV1,
  testHooks?: CmsDocumentReadTestHooks,
) {
  const state = yield* requireLogicalDocumentReadAdmission(admission, tx).pipe(Effect.mapError(projectReadAdmission));
  const selected = state.readReadiness;
  const readReadiness: LogicalStorageReadReadiness<CmsTransactionError> = {
    ...selected,
    requireDemand: (demandTx, demand) => selected.requireDemand(demandTx, demand).pipe(Effect.mapError(projectReadAdmission)),
  };
  const working = yield* makeLogicalDocumentWorkingSet({
    tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: selected.mechanics.tables,
    searchDefinitions: selected.mechanics.searchDefinitions,
    readReadiness,
    requireAdmission: requireLogicalDocumentReadAdmission(admission, tx).pipe(Effect.asVoid, Effect.mapError(projectReadAdmission)),
    validateDocument: () => Effect.fail(cmsError("invalidAuthority")),
    error: cmsError, uniqueConflict: () => cmsError("invalidAuthority"), limits: cmsLimits,
  }, creationTime, [], [], testHooks);
  return working.documents;
}, work => observeExecution("CmsDocuments.makeSourceRead", work, "caller"));

export type CmsDocuments = LogicalDocuments<CmsTransactionError>;
export type CmsDocumentReadTestHooks = LogicalDocumentReadTestHooks<CmsTransactionError>;
export interface CmsClosedDocuments extends LogicalDocumentChanges {
  readonly admission: CmsAdmission;
  readonly lifetime: CmsRequestLifetime;
  readonly pendingDeletions: CmsPendingDeletions;
}
declare const closureBrand: unique symbol;
export interface CmsDocumentClosure { readonly [closureBrand]: true }
const closures = new WeakMap<object, CmsClosedDocuments>();
declare const pendingDeletionsBrand: unique symbol;
export interface CmsPendingDeletions { readonly [pendingDeletionsBrand]: true }
const deletionSets = new WeakMap<object, Readonly<{
  admission: CmsAdmission;
  lifetime: CmsRequestLifetime;
  requireDeletion: (documentId: string) => Effect.Effect<Readonly<{ documentId: AppDocumentIdV1; tableName: string }>, CmsTransactionError>;
  settlementChanges?: LogicalDocumentChanges;
}>>();

/** Payload owns the collection view of a core-attested pending deletion. */
export const requireCmsPendingDeletion = Effect.fnUntraced(function* (
  token: CmsPendingDeletions, admission: CmsAdmission, lifetime: CmsRequestLifetime, documentId: string,
) {
  const state = deletionSets.get(token);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime) return yield* Effect.fail(cmsError("invalidAuthority"));
  const admitted = yield* requireCmsAdmission(admission);
  const row = yield* state.requireDeletion(documentId);
  const collection = admitted.configuration.tables.find(table => table.logicalTableName === row.tableName);
  if (collection === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  return Object.freeze({ ...row, collectionSlug: collection.collectionSlug });
}, work => observeExecution("CmsDocuments.requirePendingDeletion", work, "caller"));

/** Settlement borrows final absence from the exact consumed document closure. */
export const requireCmsClosedPendingDeletion = Effect.fnUntraced(function* (
  token: CmsPendingDeletions, admission: CmsAdmission, lifetime: CmsRequestLifetime, documentId: AppDocumentIdV1,
) {
  const state = deletionSets.get(token);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime ||
    state.settlementChanges === undefined || !lifetime.isClosing()) return yield* Effect.fail(cmsError("invalidAuthority"));
  const admitted = yield* requireCmsAdmission(admission);
  const deleted = state.settlementChanges.changes.find(change => change.documentId === documentId && change.kind === "deleted");
  const row = deleted ?? (state.settlementChanges.noFinalRows.includes(documentId)
    ? state.settlementChanges.dependencies.find(dependency => dependency.documentId === documentId) : undefined);
  if (row === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  const definition = admitted.schema.tables.find(table => table.tableId === row.tableId);
  if (deleted === undefined) {
    const last = state.settlementChanges.attempts.findLast(attempt => attempt.documentId === documentId);
    if (last?.operation !== "delete" || last.after !== null || last.tableId !== row.tableId ||
      last.tableName !== definition?.logicalName) return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  const collection = definition === undefined ? undefined : admitted.configuration.tables.find(table => table.logicalTableName === definition.logicalName);
  if (collection === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  return Object.freeze({ documentId: row.documentId, collectionSlug: collection.collectionSlug });
}, work => observeExecution("CmsDocuments.requireClosedPendingDeletion", work, "caller"));

/** Only a closed, internally derived set can enter Application materialization. */
export const consumeCmsDocumentClosure = Effect.fnUntraced(function* (
  closure: CmsDocumentClosure, admission: CmsAdmission, lifetime: CmsRequestLifetime,
) {
  const state = closures.get(closure);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime || !lifetime.isClosing()) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  yield* requireCmsAdmission(admission);
  const pending = deletionSets.get(state.pendingDeletions);
  if (pending === undefined || pending.admission !== admission || pending.lifetime !== lifetime ||
    pending.settlementChanges !== undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  deletionSets.set(state.pendingDeletions, Object.freeze({ ...pending, settlementChanges: state }));
  closures.delete(closure);
  return state;
}, work => observeExecution("CmsDocuments.consumeClosure", work, "caller"));

/** Framework admission and validation around the shared document owner. */
export const makeCmsDocuments = Effect.fnUntraced(function* (
  admission: CmsAdmission, lifetime: CmsRequestLifetime, creationTime: AppCreationTimeV1,
  testHooks?: CmsDocumentReadTestHooks,
) {
  const state = yield* requireCmsAdmission(admission);
  const preparation = state.preparation;
  const mechanics = preparation.writeMechanics;
  const working = yield* makeLogicalDocumentWorkingSet({
    tx: state.tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: mechanics.tables, writeMechanics: mechanics, searchDefinitions: mechanics.searchDefinitions,
    ...(mechanics.relationalCapabilities === undefined ? {} : { relationalCapabilities: mechanics.relationalCapabilities }),
    limits: cmsLimits, error: cmsError,
    uniqueConflict: uniqueConstraint => new CmsTransactionError({ reason: "uniqueConflict", uniqueConstraint }),
    requireAdmission: requireCmsAdmission(admission, state.tx).pipe(Effect.asVoid),
    validateDocument: write => validateApplicationRevisionSyscallDocumentInTransactionV1(preparation.validator, state.tx, {
      anchor: { scopeId: state.authority.scopeId }, executionPin: { schemaVersionId: state.schema.schemaVersionId }, scopeClock: state.clock,
    }, write).pipe(Effect.mapError(cause => cmsError("documentInvalid", cause))),
  }, creationTime, mechanics.unique, mechanics.indexes, testHooks);
  // SAFETY: the handle carries only this owner-registered admission and working set.
  const pendingDeletions = Object.freeze({}) as CmsPendingDeletions;
  deletionSets.set(pendingDeletions, Object.freeze({ admission, lifetime, requireDeletion: working.requirePendingDeletion }));
  const close = Effect.fnUntraced(function* (): Effect.fn.Return<CmsDocumentClosure, CmsTransactionError> {
    const closed = yield* working.close();
    // SAFETY: only this owner registers a closure from the exact shared working set.
    const closure = Object.freeze({}) as CmsDocumentClosure;
    const enriched = Object.freeze({ ...closed, admission, lifetime, pendingDeletions });
    retainLogicalInsertionGraph(closed, enriched);
    closures.set(closure, enriched);
    return closure;
  }, work => observeExecution("CmsDocuments.close", work, "caller"));
  return Object.freeze({ documents: working.documents, close, pendingDeletions });
}, work => observeExecution("CmsDocuments.make", work, "caller"));

declare const sourceClosureBrand: unique symbol;
export interface SourceCmsDocumentClosure { readonly [sourceClosureBrand]: true }
const sourceClosures = new WeakMap<object, Readonly<{
  admission: LogicalDocumentSourceAdmission;
  tx: FlarexMetadataTransaction;
  lifetime: CmsRequestLifetime;
  changes: LogicalDocumentChanges;
}>>();

/** Payload's selected source supplies tables and validation. The shared working
 * set still owns pending reads, keys, indexes and the request's write set. */
export const makeSourceCmsDocuments = Effect.fnUntraced(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
  lifetime: CmsRequestLifetime, creationTime: AppCreationTimeV1,
  testHooks?: CmsDocumentReadTestHooks,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const requireAdmission = requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.asVoid, Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const sourceReadReadiness = state.readReadiness;
  if (sourceReadReadiness.kind === "finiteQueryRequired") return yield* Effect.fail(cmsError("invalidAuthority"));
  const readReadiness: LogicalStorageReadReadiness<CmsTransactionError> = sourceReadReadiness.kind === "full"
    ? sourceReadReadiness : Object.freeze({ ...sourceReadReadiness,
      requireDemand: (demandTx, demand) => sourceReadReadiness.requireDemand(demandTx, demand).pipe(Effect.mapError(cause =>
          cmsError(cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
            ? "bindingChanged" : cause.reason, cause))),
    });
  const working = yield* makeLogicalDocumentWorkingSet({
    tx, scopeId: state.authority.scopeId, clock: state.clock, lifetime,
    tables: readReadiness.kind === "queryRequired" ? readReadiness.mechanics.tables :
      state.writeMechanics.tables,
    ...(readReadiness.kind === "queryRequired" ? {
      ...(readReadiness.mechanics.relationalCapabilities === undefined ? {} : {
        relationalCapabilities: readReadiness.mechanics.relationalCapabilities,
      }),
      searchDefinitions: readReadiness.mechanics.searchDefinitions,
    } : { writeMechanics: state.writeMechanics, searchDefinitions: state.writeMechanics.searchDefinitions }),
    readReadiness,
    limits: cmsLimits, error: cmsError,
    uniqueConflict: uniqueConstraint => new CmsTransactionError({ reason: "uniqueConflict", uniqueConstraint }),
    requireAdmission,
    validateDocument: write => Effect.fromResult(state.validate(write).pipe(Result.mapError(cause =>
      cmsError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)))),
  }, creationTime, readReadiness.kind === "queryRequired" ? state.unique : state.writeMechanics.unique,
    readReadiness.kind === "queryRequired" ? [] : state.writeMechanics.indexes, testHooks);
  const close = Effect.fnUntraced(function* () {
    const changes = yield* working.close();
    // SAFETY: this token is registered only after the admitted working set closes.
    const closure = Object.freeze({}) as SourceCmsDocumentClosure;
    sourceClosures.set(closure, Object.freeze({ admission, tx, lifetime, changes }));
    return closure;
  }, work => observeExecution("CmsDocuments.closeSource", work, "caller"));
  return Object.freeze({ documents: working.documents, close });
}, work => observeExecution("CmsDocuments.makeSource", work, "caller"));

export const consumeSourceCmsDocumentClosure = Effect.fnUntraced(function* (
  closure: SourceCmsDocumentClosure, admission: LogicalDocumentSourceAdmission,
  tx: FlarexMetadataTransaction, lifetime: CmsRequestLifetime,
) {
  const closed = sourceClosures.get(closure);
  if (closed === undefined || closed.admission !== admission || closed.tx !== tx ||
    closed.lifetime !== lifetime || !lifetime.isClosing()) return yield* Effect.fail(cmsError("invalidAuthority"));
  yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  sourceClosures.delete(closure);
  return closed.changes;
}, work => observeExecution("CmsDocuments.consumeSourceClosure", work, "caller"));
