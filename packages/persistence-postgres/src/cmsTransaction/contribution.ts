import { Effect, Result } from "effect";
import { validateLogicalDocumentChanges } from "../logicalDocuments/contribution";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission } from "../logicalDocuments/documentAdmission";
import { enterLogicalDocumentMaterialization } from "../logicalDocuments/materialization";
import type { ApplicationDocumentMaterializationOptions } from "../applicationDocumentMaterialization/model";
import type { LogicalDocumentChanges } from "../logicalDocuments/workingSet";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import type { CmsClosedDocuments } from "./documents";
import { cmsError, cmsLimits } from "./model";

/** CMS admission supplies the allowed tables; the shared owner validates the
 * complete read/write contribution, including decisions without final writes. */
export const validateCmsDocumentContribution = Effect.fn("CmsCommit.validateContribution")(function* (
  admission: CmsAdmission, closed: CmsClosedDocuments,
) {
  const state = yield* requireCmsAdmission(admission);
  const selected = new Set(state.frame.payloadContent?.tables.map(table => table.tableId));
  const tables = new Set(state.schema.tables.filter(table => selected.has(table.tableId.toString())).map(table => table.tableId));
  return yield* validateLogicalDocumentChanges({ tx: state.tx, scopeId: state.authority.scopeId, tables,
    maximumIndexEntries: cmsLimits.identities, error: cmsError }, closed);
});

/** The selected Payload source, rather than an Application write-policy slice,
 * confines all pending decisions before a root combines its write set. */
export const validateSourceCmsDocumentContribution = Effect.fn("CmsCommit.validateSourceContribution")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction, closed: LogicalDocumentChanges,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  return yield* validateLogicalDocumentChanges({ tx, scopeId: state.authority.scopeId,
    tables: new Set(state.tables.map(table => table.tableId)), maximumIndexEntries: cmsLimits.identities,
    error: cmsError }, closed);
});

/** Standalone source-bound CMS lowering. The caller still owns publication and
 * the only transaction; this participant cannot allocate or settle a commit. */
export const prepareSourceCmsDocumentDelta = Effect.fn("CmsCommit.prepareSourceDelta")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
  clock: ScopeClockRecord, closed: LogicalDocumentChanges,
  options: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const contribution = yield* validateSourceCmsDocumentContribution(admission, tx, closed);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.authority.scopeId)).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const requireAdmission = requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.asVoid, Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const core = yield* enterLogicalDocumentMaterialization({
    coverage: "sourceBound",
    command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(state.authority.deploymentId),
      scopeId: scope.scopeId, schemaVersionId: state.schemaVersionId },
    rowIntents: state.tables.map(table => ({ tableId: table.tableId })) },
    intrinsic: state.indexes.filter(index => index.access.kind === "by_creation_time"),
    developer: state.indexes.filter(index => index.access.kind === "developer"),
    unique: state.unique, relations: null, options, requireAdmission,
    validateWrites: (_, changes) => Effect.forEach(changes, change => {
      if (change.kind === "deleted") return Effect.void;
      const table = state.tables.find(member => member.tableId === change.tableId);
      if (table === undefined) return Effect.fail(cmsError("invalidAuthority"));
      return Effect.fromResult(state.validate({ operation: "replace", tableName: table.localName,
        tableId: table.tableId, documentId: change.documentId, creationTime: change.creationTime,
        document: change.document }).pipe(Result.mapError(cause =>
        cmsError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause))));
    }, { discard: true }),
  }, tx, state.authority, clock).pipe(Effect.catchTag("LogicalDocumentMaterializationError", cause =>
    Effect.fail(cmsError(cause.reason, cause.cause))));
  const delta = yield* core.prepareDelta(contribution.changes, contribution.dependencies).pipe(
    Effect.catchTag("LogicalDocumentMaterializationError", cause => Effect.fail(cmsError(cause.reason, cause.cause))));
  return Object.freeze({ changes: contribution.changes,
    lower: (commitSeq: Parameters<typeof delta.lower>[0]) => delta.lower(commitSeq).pipe(
      Effect.catchTag("LogicalDocumentMaterializationError", cause => Effect.fail(cmsError(cause.reason, cause.cause)))) });
});
