import { Cause, Effect, Result } from "effect";
import { validateLogicalDocumentChanges } from "../../storage/documents/logicalDocuments/contribution";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission, type LogicalDocumentSourcePreparation } from "../../storage/documents/logicalDocuments/documentAdmission";
import { enterLogicalDocumentMaterialization } from "../../storage/documents/logicalDocuments/materialization";
import type { ApplicationDocumentMaterializationOptions } from "../../storage/materialization/model";
import type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result } from "flarex-protocol/storage-authority";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import type { CmsClosedDocuments } from "./documents";
import { cmsError, cmsLimits } from "./model";
import { captureHostPreparationLifetime } from "../../execution/preparation/preparedHostRuntime";
import type { LogicalDocumentMaterializationInput } from "../../storage/documents/logicalDocuments/materialization";
import type { CmsTransactionError } from "./model";

interface SourceCmsTemplate {
  readonly source: LogicalDocumentSourcePreparation;
  readonly input: Omit<LogicalDocumentMaterializationInput<CmsTransactionError>, "requireAdmission">;
}
/** Mechanics are owned by the original source allocation. The live source
 * admission remains the only authority at use; disposal clears this retained loan. */
export interface PreparedSourceCmsDocumentMaterialization {
  readonly read: Effect.Effect<SourceCmsTemplate, CmsTransactionError>;
}
const sourceFailure = (cause: unknown) => cmsError("invalidAuthority", cause);
const sourceTemplateDisposal = (cell: { value: SourceCmsTemplate | undefined }) => () => { cell.value = undefined; };
function sourceTemplateLoan(cell: { value: SourceCmsTemplate | undefined }): PreparedSourceCmsDocumentMaterialization {
  return Object.freeze({ read: Effect.suspend(() => {
    const retained = cell.value;
    return retained === undefined ? Effect.fail(cmsError("invalidAuthority")) : retained.source.requirePrepared.pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, sourceFailure))), Effect.as(retained));
  }) });
}
export const prepareSourceCmsDocumentMaterialization = Effect.fn("CmsCommit.prepareSourceMaterialization")(function* (
  source: LogicalDocumentSourcePreparation,
  options: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">,
) {
  yield* source.requirePrepared.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, sourceFailure))));
  const allocation = yield* captureHostPreparationLifetime();
  if (allocation === undefined || allocation.charge !== source.lifetime.charge || allocation.onDispose !== source.lifetime.onDispose)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(source.scopeId)).pipe(Effect.mapError(sourceFailure));
  const input: SourceCmsTemplate["input"] = Object.freeze({
    coverage: "sourceBound", command: Object.freeze({
      authorityPins: Object.freeze({ deploymentId: TransactionGrantDeploymentIdV1Schema.make(source.deploymentId),
        scopeId: scope.scopeId, schemaVersionId: source.schemaVersionId }),
      rowIntents: Object.freeze(source.tables.map(table => Object.freeze({ tableId: table.tableId }))),
    }),
    intrinsic: Object.freeze(source.indexes.filter(index => index.access.kind === "by_creation_time")),
    developer: Object.freeze(source.indexes.filter(index => index.access.kind === "developer")),
    unique: source.unique, relations: null, options,
    validateWrites: (_, changes) => Effect.forEach(changes, change => {
      if (change.kind === "deleted") return Effect.void;
      const table = source.tablesById.get(change.tableId);
      if (table === undefined) return Effect.fail(cmsError("invalidAuthority"));
      return Effect.fromResult(source.validate({ operation: "replace", tableName: table.localName,
        tableId: table.tableId, documentId: change.documentId, creationTime: change.creationTime,
        document: change.document }).pipe(Result.mapError(cause =>
        cmsError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause))));
    }, { discard: true }),
  });
  yield* Effect.fromResult(allocation.charge({ command: input.command,
    intrinsic: input.intrinsic.map(index => index.indexDefinitionId), developer: input.developer.map(index => index.indexDefinitionId) }))
    .pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  const cell = { value: Object.freeze({ source, input }) } satisfies Parameters<typeof sourceTemplateDisposal>[0];
  const dispose = sourceTemplateDisposal(cell);
  const registered = allocation.onDispose(dispose);
  if (Result.isFailure(registered)) dispose();
  yield* Effect.fromResult(registered).pipe(Effect.mapError(cause => cmsError("resourceFailure", cause)));
  return sourceTemplateLoan(cell);
});

export const requireSourceCmsDocumentMaterialization = Effect.fn("CmsCommit.requireSourceMaterialization")(function* (
  prepared: PreparedSourceCmsDocumentMaterialization, admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, sourceFailure))));
  const template = yield* prepared.read;
  const source = template.source;
  if (source.scopeId !== state.authority.scopeId || source.deploymentId !== state.authority.deploymentId ||
    source.schemaVersionId !== state.schemaVersionId || source.sourceKey !== state.sourceKey || source.sourceSha256 !== state.sourceSha256 ||
    source.tables !== state.tables || source.indexes !== state.indexes || source.unique !== state.unique ||
    source.validate !== state.validate || source.writeMechanics !== state.writeMechanics)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  return template;
});

/** CMS admission supplies the allowed tables; the shared owner validates the
 * complete read/write contribution, including decisions without final writes. */
export const validateCmsDocumentContribution = Effect.fn("CmsCommit.validateContribution")(function* (
  admission: CmsAdmission, closed: CmsClosedDocuments,
) {
  const state = yield* requireCmsAdmission(admission);
  return yield* validateLogicalDocumentChanges({ tx: state.tx, scopeId: state.authority.scopeId, tables: state.preparation.tableIds,
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
    tables: state.tableIds, maximumIndexEntries: cmsLimits.identities,
    error: cmsError }, closed);
});

/** Standalone source-bound CMS lowering. The caller still owns publication and
 * the only transaction; this participant cannot allocate or settle a commit. */
export const prepareSourceCmsDocumentDelta = Effect.fn("CmsCommit.prepareSourceDelta")(function* (
  admission: LogicalDocumentSourceAdmission, tx: FlarexMetadataTransaction,
  clock: ScopeClockRecord, closed: LogicalDocumentChanges,
  prepared: PreparedSourceCmsDocumentMaterialization,
) {
  const state = yield* requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const template = yield* requireSourceCmsDocumentMaterialization(prepared, admission, tx);
  const contribution = yield* validateSourceCmsDocumentContribution(admission, tx, closed);
  const requireAdmission = requireLogicalDocumentSourceAdmission(admission, tx).pipe(
    Effect.asVoid, Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const core = yield* enterLogicalDocumentMaterialization({
    ...template.input, requireAdmission,
  }, tx, state.authority, clock).pipe(Effect.catchTag("LogicalDocumentMaterializationError", cause =>
    Effect.fail(cmsError(cause.reason, cause.cause))));
  const delta = yield* core.prepareDelta(contribution.changes, contribution.dependencies).pipe(
    Effect.catchTag("LogicalDocumentMaterializationError", cause => Effect.fail(cmsError(cause.reason, cause.cause))));
  return Object.freeze({ changes: contribution.changes,
    lower: (commitSeq: Parameters<typeof delta.lower>[0]) => delta.lower(commitSeq).pipe(
      Effect.catchTag("LogicalDocumentMaterializationError", cause => Effect.fail(cmsError(cause.reason, cause.cause)))) });
});
