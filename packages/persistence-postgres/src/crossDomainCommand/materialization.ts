import { Effect } from "effect";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { projectScopeIdUuidV1Result, type CommitSeq } from "flarex-protocol/storage-authority";
import type { ApplicationDocumentMaterializationOptions } from "../applicationDocumentMaterialization/model";
import type { PreparedPointCommitRowIntentV1 } from "../applicationDocumentMaterialization/model";
import { applicationCommandError } from "../applicationDocumentMaterialization/insertParticipant";
import { requireLogicalApplicationSourceAdmission, type LogicalApplicationSourceAdmission } from "../logicalDocuments/applicationAdmission";
import { requireLogicalDocumentSourceAdmission, type LogicalDocumentSourceAdmission } from "../logicalDocuments/documentAdmission";
import { requireLogicalRelationalAdmission, type LogicalRelationalAdmission } from "../logicalDocuments/relationalAdmission";
import type { LogicalDocumentChanges } from "../logicalDocuments/workingSet";
import { validateLogicalDocumentChanges } from "../logicalDocuments/contribution";
import { enterLogicalDocumentMaterialization, type LogicalDocumentMaterializationInput } from "../logicalDocuments/materialization";
import { validateSourceCmsDocumentContribution } from "../cmsTransaction/contribution";
import { cmsError } from "../cmsTransaction/model";
import { commerceError } from "../commerceTransaction/model";
import { logicalCommerceError } from "../commerceTransaction/model";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopeClockRecord } from "../scopeClock";
import { sameBindingValue } from "../frameworkSchema/binding/canonical";
import { compositeError, type CompositeFailure } from "./model";

interface JointSourceInput {
  readonly tx: FlarexMetadataTransaction;
  readonly clock: ScopeClockRecord;
  readonly application: LogicalApplicationSourceAdmission;
  readonly payload: LogicalDocumentSourceAdmission;
  readonly currency: LogicalRelationalAdmission;
  readonly applicationChanges: readonly PreparedPointCommitRowIntentV1[];
  readonly payloadChanges: LogicalDocumentChanges;
  readonly currencyChanges: LogicalDocumentChanges;
  readonly options: Pick<ApplicationDocumentMaterializationOptions, "afterTransactionStep" | "observeQuery">;
}
const captureChanges = (value: LogicalDocumentChanges): LogicalDocumentChanges => Object.freeze({
  changes: Object.freeze([...value.changes]), attempts: Object.freeze([...value.attempts]),
  lifecycle: Object.freeze([...value.lifecycle]),
  observedRows: Object.freeze([...value.observedRows]),
  noFinalRows: Object.freeze([...value.noFinalRows]), dependencies: Object.freeze([...value.dependencies]),
  scans: Object.freeze([...value.scans]), uniqueReads: Object.freeze([...value.uniqueReads]),
  indexReads: Object.freeze([...value.indexReads]),
});

/** Three source-owned contributions enter one generic row/index delta. This
 * command owns neither a second transaction nor an independent publication. */
export const prepareJointLogicalMaterialization = Effect.fn("CurrencyAnnouncement.prepareJointDelta")(function* (
  input: JointSourceInput,
) {
  const { tx, clock } = input;
  const applicationAdmission = input.application;
  const payloadAdmission = input.payload;
  const currencyAdmission = input.currency;
  const pendingApplicationChanges = Object.freeze([...input.applicationChanges]);
  const payloadChanges = captureChanges(input.payloadChanges);
  const currencyChanges = captureChanges(input.currencyChanges);
  const afterTransactionStep = input.options.afterTransactionStep;
  const observeQuery = input.options.observeQuery;
  const options = Object.freeze({ ...(afterTransactionStep === undefined ? {} : { afterTransactionStep }),
    ...(observeQuery === undefined ? {} : { observeQuery }) });
  const application = yield* requireLogicalApplicationSourceAdmission(applicationAdmission, tx);
  const payload = yield* requireLogicalDocumentSourceAdmission(payloadAdmission, tx);
  const currency = yield* requireLogicalRelationalAdmission(currencyAdmission, tx);
  const sourceClock = application.clock;
  if (application.authority.scopeId !== payload.authority.scopeId ||
    application.authority.scopeId !== currency.authority.scopeId ||
    application.authority.deploymentId !== payload.authority.deploymentId ||
    application.authority.deploymentId !== currency.authority.deploymentId ||
    sourceClock !== payload.clock || sourceClock !== currency.clock ||
    application.schemaVersionId !== payload.schemaVersionId ||
    application.schemaVersionId !== currency.schemaVersionId ||
    !sameBindingValue(application.head, payload.head) ||
    !sameBindingValue(application.head, currency.head) ||
    currency.sourceKey !== "medusa.currency" || currency.tables.length !== 1 ||
    currency.tables[0]?.localName !== "currency" ||
    currency.tables.some(table => table.definition.relationships.length !== 0 ||
      table.definition.constraints.some(constraint => constraint.kind === "foreignKey")) ||
    clock.scopeId !== sourceClock.scopeId || clock.epoch !== sourceClock.epoch ||
    clock.storageGeneration !== sourceClock.storageGeneration ||
    clock.storageGenerationFence !== sourceClock.storageGenerationFence ||
    clock.oldestAvailableCommitSeq !== sourceClock.oldestAvailableCommitSeq ||
    clock.lastCommitSeq < sourceClock.lastCommitSeq)
    return yield* Effect.fail(compositeError("invalidAuthority"));

  const appTables = new Map(application.tables.map(table => [table.tableId, table]));
  const payloadTables = new Map(payload.tables.map(table => [table.tableId, table]));
  const currencyTables = new Map(currency.tables.map(table => [table.tableId, table]));
  const tableIds = [...appTables.keys(), ...payloadTables.keys(), ...currencyTables.keys()];
  if (tableIds.length !== new Set(tableIds).size ||
    pendingApplicationChanges.some(row => row.kind !== "live" || !appTables.has(row.tableId)))
    return yield* Effect.fail(compositeError("invalidAuthority"));

  const payloadContribution = yield* validateSourceCmsDocumentContribution(payloadAdmission, tx, payloadChanges);
  const currencyContribution = yield* validateLogicalDocumentChanges({ tx, scopeId: currency.authority.scopeId,
    tables: new Set(currencyTables.keys()), maximumIndexEntries: 128, error: logicalCommerceError }, currencyChanges);
  const applicationChanges = Object.freeze(pendingApplicationChanges.map(row => Object.freeze({
    ...row, readAt: clock.lastCommitSeq,
  })));
  const changes = Object.freeze([...payloadContribution.changes, ...currencyContribution.changes, ...applicationChanges]
    .toSorted((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId)));
  const dependencies = Object.freeze([...payloadContribution.dependencies, ...currencyContribution.dependencies, ...applicationChanges]
    .toSorted((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId)));
  if (new Set(changes.map(row => row.documentId)).size !== changes.length ||
    new Set(dependencies.map(row => row.documentId)).size !== dependencies.length)
    return yield* Effect.fail(compositeError("invalidAuthority"));

  const requireAdmission = Effect.gen(function* () {
    yield* requireLogicalApplicationSourceAdmission(applicationAdmission, tx);
    yield* requireLogicalDocumentSourceAdmission(payloadAdmission, tx);
    yield* requireLogicalRelationalAdmission(currencyAdmission, tx);
  }).pipe(Effect.mapError(cause => compositeError("invalidAuthority", cause)));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(application.authority.scopeId));
  const indexes = [...application.indexes, ...payload.indexes, ...currency.indexes];
  const validateRow = (row: PreparedPointCommitRowIntentV1): Effect.Effect<void, CompositeFailure> => {
    const app = appTables.get(row.tableId);
    if (app !== undefined) {
      if (row.kind !== "live") return Effect.fail(compositeError("invalidAuthority"));
      return Effect.fromResult(application.validate({ operation: "insert", tableName: app.localName,
        tableId: row.tableId, documentId: row.documentId, creationTime: row.creationTime,
        document: row.document })).pipe(Effect.mapError(cause => applicationCommandError(
          cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)));
    }
    const cms = payloadTables.get(row.tableId);
    if (cms !== undefined) return row.kind === "deleted" ? Effect.void : Effect.fromResult(payload.validate({
      operation: "replace", tableName: cms.localName, tableId: row.tableId, documentId: row.documentId,
      creationTime: row.creationTime, document: row.document,
    })).pipe(Effect.mapError(cause => cmsError(
      cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)));
    const commerce = currencyTables.get(row.tableId);
    if (commerce !== undefined) return row.kind === "deleted" ? Effect.void : Effect.fromResult(
      currency.values.validate(row.tableId, row.document)).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return Effect.fail(compositeError("invalidAuthority"));
  };
  const prepared: LogicalDocumentMaterializationInput<CompositeFailure> = {
    coverage: { kind: "mixedSelectedSources", activeApplicationTables: new Set(appTables.keys()) },
    command: { authorityPins: { deploymentId: TransactionGrantDeploymentIdV1Schema.make(application.authority.deploymentId),
      scopeId: scope.scopeId, schemaVersionId: application.schemaVersionId },
    rowIntents: tableIds.map(tableId => ({ tableId })) },
    intrinsic: indexes.filter(index => index.access.kind === "by_creation_time"),
    developer: indexes.filter(index => index.access.kind === "developer"),
    unique: [...application.unique, ...payload.unique, ...currency.unique],
    relations: null, options, requireAdmission,
    validateWrites: (_commitSeq: CommitSeq, rows) => Effect.forEach(rows, validateRow, { discard: true }),
  };
  const core = yield* enterLogicalDocumentMaterialization(prepared, tx, application.authority, clock);
  const delta = yield* core.prepareDelta(changes, dependencies);
  return Object.freeze({ changes, lower: delta.lower });
});
