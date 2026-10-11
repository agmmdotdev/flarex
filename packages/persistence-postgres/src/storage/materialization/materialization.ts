import {
  Effect,
  Result,
  Data,
  Schema,
  Exit,
  Encoding,
} from "effect";
import type {
  ApplicationDocumentDefinitionCommand,
  ApplicationDocumentMaterializationOptions,
  ApplicationDocumentDefinitionComposition,
  PreparedPointCommitApplicationRelations,
  PointCommitDependencyV1,
  ApplicationDocumentMaterializationCommand,
  LocatedPreparedPointCommitApplicationRelations,
  PreparedPointCommitApplicationRelationPlan,
  PointCommitApplicationRelationMaintenanceError,
  ApplicationDocumentMaterializationClock,
  LoadedPointCommitHeadV1,
  LockedPointCommitDeveloperIndexV1,
  PointCommitUniqueKeyPlanV1,
  PointCommitDeveloperIndexDocumentRequestV1,
  PreparedPointCommitCandidateSchemaWriteGuard,
  LockedPointCommitIntrinsicIndexV1,
  PreparedPointCommitRowIntentV1,
} from "./model";
import type {
  LocatedAppIndexDefinitionV1,
  ReadAppIndexDefinitionError,
} from "../indexes/appIndexDefinitions";
import {
  PointCommitIntrinsicIndexDefinitionUnavailableV1Error,
  type PointCommitCorruptionV1Error,
  corruption,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error,
  PointCommitConflictV1Error,
} from "../../commit/point/errors";
import {
  type CatalogTableId,
  CatalogIndexDefinitionIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
} from "flarex-protocol/catalog";
import {
  observePointCommitPublicationEffect,
  type PointCommitPublicationObservation,
} from "../../commit/point/observation";
import type {
  LocateAppDeveloperIndexDefinitionsV1Error,
} from "../indexes/appDeveloperIndexCommitV1";
import {
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import {
  type LocatedAppUniqueConstraintDefinitionV1,
  isLocatedAppUniqueConstraintDefinitionV1,
} from "../unique/appUniqueConstraintDefinitions";
import type {
  ReadAppUniqueConstraintSetClosureV1Error,
} from "../unique/appUniqueConstraintSetClosureV1";
import {
  hasAppUniqueConstraintDefinitionAuthorityV1,
} from "../unique/appUniqueConstraintCommitV1";
import {
  MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
} from "./limits";
import {
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationCommitCorruptionError,
  type PreparedApplicationRelationCommit,
  ApplicationRelationTargetNotLiveError,
  applyApplicationRelationCommitEdgesInTransactionEffect,
  assertApplicationRelationRestrictProbesInTransactionEffect,
  ApplicationRelationTargetDeleteRestrictedError,
} from "../../application/relations/applicationRelationCommit";
import {
  ReadApplicationRelationBindingError,
} from "../../application/relations/binding";
import {
  type AppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
  prepareAppSchemaCandidateWriteGuardEffect,
  prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
} from "../catalog/appSchemaCandidateValidation";
import {
  AppSchemaCandidateWriteGuardError,
} from "../catalog/appSchemaCandidateWriteGuardErrors";
import {
  type CommitSeq,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
  projectScopeIdUuidV1Result,
  type ReplacementScopeIdV1,
  ScopeUuidV1Schema,
  ScopeEpochUuidV1Schema,
  CommitSeqSchema,
  type ScopeEpoch,
} from "flarex-protocol/storage-authority";
import {
  type PreparedAppRowRevisionApplication,
  preparedAppRowApplicationFailure,
  type AppRowTransaction,
  type AppendPreparedAppRowRevisionV1Input,
  prepareAppRowRevisionApplicationEffect,
  AppRowWritePersistenceError,
  type AppRowPointDependencyV1,
  type LiveAppRowRevisionV1,
} from "../documents/appRows";
import {
  type PreparedAppIndexRevisionApplication,
  preparedAppIndexApplicationFailure,
  prepareAppIndexKeyTransitionAcceptanceInTransactionEffect,
  invalidateAppIndexMembershipPositionsInTransaction,
  prepareAppIndexRevisionApplicationEffect,
  publicationAppIndexApplicationFailure,
} from "../indexes/appIndexEntries";
import {
  type PreparedAppUniqueMutationApplication,
  preparedAppUniqueApplicationFailure,
  recordPreparedAppUniqueApplication,
  prepareAppUniqueCanonicalMutationApplicationEffect,
  AppUniqueKeyParentRowError,
  AppUniqueKeyPreviousClaimMismatchError,
  AppUniqueKeyStorageCorruptionError,
  AppUniqueKeyScopeAuthorityUnavailableError,
  InvalidAppUniqueKeyMutationV1Error,
} from "../unique/appUniqueKeys";
import {
  type IndexCoverageWrite,
  type UniqueCoverageWrite,
  applicationCoverageFailure,
  ApplicationCoverageRefusal,
  type CoverageProof,
  applyApplicationCoverage,
  ApplicationCoveragePersistenceError,
} from "./domainCoverage";
import {
  type PreparedLogicalSearchApplication,
  searchApplicationFailure,
  prepareLogicalSearchApplications,
} from "../documents/logicalDocuments/searchEntries";
import {
  type ApplicationMaterializationValues,
  applicationDomainFailureDetail,
  applicationIndexTransitionScalarArray,
  applicationIndexTransitionByteArray,
  applicationIndexCoverageArray,
} from "./domainApplication";
import { buildApplicationPublicationStatement } from "./domainPublicationSql";
import {
  type AcceptedApplicationPublication,
  readAcceptedApplicationPublication,
} from "./publicationAcceptance";
import {
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
import {
  AppUniqueConstraintSetBuildAttemptFenceV1Schema,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
  readIndexCoverageContextInTransactionEffect,
  publicationModeForIndex,
  publicationModeForTable,
  acceptSelectedIndexBuildLocksInTransactionEffect,
  IndexBuildStatePersistenceError,
  type IndexBuildStateRecord,
} from "../indexes/indexBuildStates";
import {
  PointCommitSqlFailureMarkerV1,
  pointCommitSqlCallFailure,
} from "../../commit/point/sqlFailures";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  type AppDocumentIdV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  requireAdmittedTargetInstallationSchema,
  requireAdmittedTargetInstallationIdentity,
} from "../../installation/installationLifecycle";
import {
  fxSystemIndexBuildStates,
  fxAppRowRevisions,
  fxControlIndexDefinitions,
  fxControlUniqueConstraintDefinitions,
  fxControlSchemaVersionUniqueConstraintBindings,
} from "../../database/schema";
import {
  sql,
  and,
  eq,
  inArray,
} from "drizzle-orm";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
} from "flarex-protocol/index-definition";
import {
  appUniqueConstraintSpecSha256HexV1ToBytes,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  AppIndexEntryReadPersistenceError,
  AppIndexEntryStorageCorruptionError,
  AppIndexEntryWritePersistenceError,
} from "../indexes/appIndexEntryErrors";
import {
  observeDrizzleRawQuery,
} from "../../database/drizzleQueryObservation";
import {
  runDrizzleStatementEffect,
} from "../../database/drizzleStatementEffect";
import {
  observeExecution,
} from "../../execution/diagnostics/operation";
import {
  AppUniqueKeyPersistenceError,
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  CanonicalAppUniqueKeyHashCollisionError,
} from "../unique/appUniqueKeyErrors";
import {
  mapPointCommitUniqueKeyFailure,
} from "./uniqueKeyFailures";
import {
  closeExactAttemptScopeClockObservation,
  exactScopeWriteClockObservationIdentity,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import {
  prepareRelationTransitionsResult,
  type ApplicationDocumentOriginals,
  indexApplicationDocumentRowIntents,
} from "./settlementPlan";
import {
  isNonArrayRecord,
} from "@flarex/utils/records";
import {
  parseNullableCommitSeqTextResult,
  decodePointCommitHeadResult,
  freezeRowIdentity,
} from "./headEvidence";
import {
  AppRelationEdgePersistenceError,
} from "../relations";
import {
  rowsFromDriverExecuteResult,
} from "../../database/driverExecuteResult";
import {
  validateAppRowPointOccV1,
} from "../documents/appRowPointOcc";
import {
  recordOriginalPublicationBuildLocks,
} from "./originalBuildLocks";
import type {
  CanonicalFlarexValueV1,
} from "flarex-protocol/value";
import { decodeStoredAppDocumentEvidenceEffect } from "../documents/appRowCanonicalEvidence";
import type {
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";

export { prepareApplicationDocumentSettlementEffect, preparedApplicationDocumentSettlementHasFailure,
  type PreparedApplicationDocumentSettlement } from "./settlementPlan";

export const prepareIntrinsicIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareIntrinsicIndexDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | ReadAppIndexDefinitionError
  | PointCommitIntrinsicIndexDefinitionUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.intrinsicCreationTimeIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions: LocatedAppIndexDefinitionV1[] = [];
  let previousTableId: CatalogTableId | undefined;
  for (const intent of command.rowIntents) {
    if (intent.tableId === previousTableId) continue;
    previousTableId = intent.tableId;
    const definition = yield* observePointCommitPublicationEffect(options.publicationObservation, "intrinsicDefinition", port.locate({
      deploymentId: command.authorityPins.deploymentId,
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
    }));
    if (definition === null) {
      return yield* Effect.fail(
        new PointCommitIntrinsicIndexDefinitionUnavailableV1Error({
          deploymentId: command.authorityPins.deploymentId,
          scopeId: command.authorityPins.scopeId,
          tableId: intent.tableId,
        }),
      );
    }
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "by_creation_time" ||
      definition.access.tableId !== intent.tableId
    ) {
      return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
    }
    definitions.push(definition);
  }
  return Object.freeze(definitions);
});

export const prepareDeveloperIndexDefinitions = Effect.fn(
  "PointCommitTransaction.prepareDeveloperIndexDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppIndexDefinitionV1>,
  | LocateAppDeveloperIndexDefinitionsV1Error
  | PointCommitDeveloperIndexMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.developerIndexes;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions: MAX_SCHEMA_MANIFEST_APP_INDEXES,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.access.kind !== "developer" ||
      definition.indexDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
    }
    previousDefinitionId = definition.indexDefinitionId;
  }
  return definitions;
});

export const prepareUniqueConstraintDefinitions = Effect.fn(
  "PointCommitTransaction.prepareUniqueConstraintDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  | ReadAppUniqueConstraintSetClosureV1Error
  | PointCommitUniqueConstraintMaintenanceUnavailableV1Error
  | PointCommitCorruptionV1Error
> {
  const port = options.uniqueConstraints;
  if (command.rowIntents.length === 0 || port === undefined) {
    return Object.freeze([]);
  }
  if (!hasAppUniqueConstraintDefinitionAuthorityV1(port)) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionPortInvalid",
      }),
    );
  }
  const definitions = yield* port.locate({
    deploymentId: command.authorityPins.deploymentId,
    scopeId: command.authorityPins.scopeId,
    schemaVersionId: command.authorityPins.schemaVersionId,
    tableIds: Object.freeze([
      ...new Set(command.rowIntents.map((intent) => intent.tableId)),
    ]),
    maximumDefinitions: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
  });
  if (definitions === null) {
    return yield* Effect.fail(
      new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
        reason: "definitionSetUnavailable",
      }),
    );
  }
  let previousDefinitionId = 0;
  for (const definition of definitions) {
    if (
      !isLocatedAppUniqueConstraintDefinitionV1(definition) ||
      definition.scopeId !== command.authorityPins.scopeId ||
      definition.deploymentId !== command.authorityPins.deploymentId ||
      definition.schemaVersionId !== command.authorityPins.schemaVersionId ||
      definition.uniqueConstraintDefinitionId <= previousDefinitionId
    ) {
      return yield* Effect.fail(
        corruption("uniqueConstraintDefinitionInvalid"),
      );
    }
    previousDefinitionId = definition.uniqueConstraintDefinitionId;
  }
  yield* Effect.fromResult(
    validateApplicationUniqueTransitionBudget(command.rowIntents, definitions),
  );
  return definitions;
});

export function validateApplicationUniqueTransitionBudget(
  rows: ApplicationDocumentDefinitionCommand["rowIntents"],
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
): Result.Result<
  void,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error
> {
  const count = definitions.reduce(
    (total, definition) =>
      total + rows.filter((row) => row.tableId === definition.tableId).length,
    0,
  );
  return count > MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1
    ? Result.fail(
        new PointCommitUniqueConstraintMaintenanceUnavailableV1Error({
          reason: "mutationLimitExceeded",
          observed: count,
          maximum: MAX_POINT_COMMIT_UNIQUE_KEY_TRANSITIONS_V1,
        }),
      )
    : Result.succeed(undefined);
}

export const prepareApplicationRelationDefinitions = Effect.fn(
  "PointCommitTransaction.prepareApplicationRelationDefinitions",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  composition: ApplicationDocumentDefinitionComposition,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  PreparedPointCommitApplicationRelations | null,
  | ApplicationRelationCommitUnavailableError
  | PointCommitCorruptionV1Error
  | ReadApplicationRelationBindingError
> {
  const port = options.applicationRelations;
  if (command.rowIntents.length === 0 || port === undefined) return null;
  if (!composition.hasRelationAuthority(port)) {
    return yield* Effect.fail(
      new ApplicationRelationCommitUnavailableError({
        reason: "compositionMissing",
      }),
    );
  }
  const definitions = yield* port
    .locate({
      deploymentId: command.authorityPins.deploymentId,
      schemaVersionId: command.authorityPins.schemaVersionId,
    })
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof ApplicationRelationCommitCorruptionError ||
        (cause instanceof ReadApplicationRelationBindingError &&
          cause.reason !== "resourceFailure")
          ? corruption("relationBindingInvalid")
          : cause,
      ),
    );
  if (definitions === null) {
    return Object.freeze({ port, definitions: null });
  }
  if (
    definitions.deploymentId !== command.authorityPins.deploymentId ||
    definitions.schemaVersionId !== command.authorityPins.schemaVersionId
  ) {
    return yield* Effect.fail(corruption("relationBindingInvalid"));
  }
  return Object.freeze({ port, definitions });
});

export const prepareCandidateSchemaWriteGuard = Effect.fn(
  "PointCommitTransaction.prepareCandidateSchemaWriteGuard",
)(function* (
  command: ApplicationDocumentDefinitionCommand,
  composition: ApplicationDocumentDefinitionComposition,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<
  Readonly<{
    readonly guard: AppSchemaCandidateWriteGuardPort;
    readonly prepared: PreparedAppSchemaCandidateWriteGuard;
  }> | null,
  AppSchemaCandidateWriteGuardError
> {
  const guard = options.candidateSchemaWriteGuard;
  if (command.rowIntents.length === 0 || guard === undefined) return null;
  if (!composition.hasCandidateGuardAuthority(guard)) {
    return yield* Effect.fail(
      new AppSchemaCandidateWriteGuardError({
        reason: "compositionMismatch",
      }),
    );
  }
  const prepared = yield* (command.candidatePlanningHead === undefined
    ? prepareAppSchemaCandidateWriteGuardEffect(guard, { deploymentId: command.authorityPins.deploymentId, scopeId: command.authorityPins.scopeId })
    : prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard, command.candidatePlanningHead));
  return Object.freeze({ guard, prepared });
});

export function hasOwn<T extends object>(
  value: T,
  field: PropertyKey,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

export function pointDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.tableId !== right.tableId ||
    left.rowId !== right.rowId ||
    left.dependency.observed.kind !== right.dependency.observed.kind
  ) {
    return false;
  }
  if (
    left.dependency.observed.kind === "present" &&
    right.dependency.observed.kind === "present"
  ) {
    return (
      left.dependency.observed.revisionCommitSeq ===
      right.dependency.observed.revisionCommitSeq
    );
  }
  if (
    left.dependency.observed.kind !== "missing" ||
    right.dependency.observed.kind !== "missing" ||
    left.dependency.observed.basis.kind !== right.dependency.observed.basis.kind
  ) {
    return false;
  }
  return (
    left.dependency.observed.basis.kind === "noVisibleRevision" ||
    (right.dependency.observed.basis.kind === "tombstone" &&
      left.dependency.observed.basis.revisionCommitSeq ===
        right.dependency.observed.basis.revisionCommitSeq)
  );
}

/** The existing Application row/index/unique lowering order, shared by both participants. */
export interface PreparedApplicationMaterializationBlock {
  readonly commitSeq: CommitSeq;
  readonly scopeUuid: import("flarex-protocol/storage-authority").ScopeUuidV1;
  readonly rows?: PreparedAppRowRevisionApplication;
  readonly indexes?: PreparedAppIndexRevisionApplication;
  readonly unique?: PreparedAppUniqueMutationApplication;
  readonly validation?: readonly IndexCoverageWrite[];
  readonly indexCoverage?: readonly IndexCoverageWrite[];
  readonly uniqueCoverage?: readonly UniqueCoverageWrite[];
  readonly search?: readonly PreparedLogicalSearchApplication[];
}
export class ApplicationMaterializationPersistenceError extends Data.TaggedError("ApplicationMaterializationPersistenceError")<{
  readonly cause: unknown;
}> {}
class ApplicationIndexValidationRefusal extends Data.TaggedError("ApplicationIndexValidationRefusal")<{
  readonly ordinal: number; readonly cause: unknown;
}> {}
const decodeMaterializationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  family: Schema.Literals(["row", "index", "unique", "indexValidation", "indexCoverage", "uniqueCoverage", "search"]),
  pageOffset: Schema.Number, detail: Schema.String,
})), { onExcessProperty: "error" });
const decodeIndexValidationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "storedCorruption"]), ordinal: Schema.Number,
})), { onExcessProperty: "error" });
const decodeIndexValidationSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), rows: Schema.Number,
}), { onExcessProperty: "error" });

function materializationValues(block: PreparedApplicationMaterializationBlock): ApplicationMaterializationValues {
  return { rows: block.rows?.values ?? [], rowPages: block.rows?.pageCounts ?? [], indexes: block.indexes?.values ?? [],
    unique: block.unique ?? { owners: [], previous: [], next: [] }, validation: block.validation ?? [],
    indexCoverage: block.indexCoverage ?? [], uniqueCoverage: block.uniqueCoverage ?? [],
    commitSeq: block.commitSeq, scopeUuid: block.scopeUuid, search: block.search ?? [] };
}

function materializationApplicationFailure(cause: unknown, block: PreparedApplicationMaterializationBlock, capturedDetail?: string) {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_materialization");
  if (detail === null) return new ApplicationMaterializationPersistenceError({ cause });
  return Result.match(decodeMaterializationRefusal(detail), {
    onFailure: () => new ApplicationMaterializationPersistenceError({ cause }),
    onSuccess: refusal => {
      if (!Number.isSafeInteger(refusal.pageOffset) || refusal.pageOffset < 0) return new ApplicationMaterializationPersistenceError({ cause });
      switch (refusal.family) {
        case "row": return block.rows === undefined ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppRowApplicationFailure(cause, block.rows, refusal.pageOffset, refusal.detail);
        case "index": return block.indexes === undefined ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppIndexApplicationFailure(cause, block.indexes, refusal.pageOffset, refusal.detail);
        case "unique": return block.unique === undefined || refusal.pageOffset !== 0 ? new ApplicationMaterializationPersistenceError({ cause })
          : preparedAppUniqueApplicationFailure(cause, block.unique, refusal.detail);
        case "indexValidation": return Result.match(decodeIndexValidationRefusal(refusal.detail), {
          onFailure: () => new ApplicationMaterializationPersistenceError({ cause }),
          onSuccess: proof => refusal.pageOffset !== 0 || !Number.isSafeInteger(proof.ordinal) || proof.ordinal < 0 || proof.ordinal >= (block.validation?.length ?? 0)
            ? new ApplicationMaterializationPersistenceError({ cause }) : new ApplicationIndexValidationRefusal({ ordinal: proof.ordinal, cause }),
        });
        case "indexCoverage":
        case "uniqueCoverage": {
          const rows = refusal.family === "indexCoverage" ? block.indexCoverage ?? [] : block.uniqueCoverage ?? [];
          const offset = refusal.pageOffset;
          if (offset % 32 !== 0 || offset >= rows.length) return new ApplicationMaterializationPersistenceError({ cause });
          const count = Math.min(32, rows.length - offset);
          const prior = offset + count === rows.length ? offset : 0;
          const failure = applicationCoverageFailure(cause, refusal.family === "indexCoverage" ? count : 0,
            refusal.family === "uniqueCoverage" ? count : 0, refusal.family === "indexCoverage" ? prior : 0,
            refusal.family === "uniqueCoverage" ? prior : 0, refusal.detail);
          return failure instanceof ApplicationCoverageRefusal && failure.family !== (refusal.family === "indexCoverage" ? "index" : "unique")
            ? new ApplicationMaterializationPersistenceError({ cause }) : failure;
        }
        case "search": {
          let offset = 0;
          for (const search of block.search ?? []) {
            if (refusal.pageOffset >= offset && refusal.pageOffset < offset + search.ids.length && (refusal.pageOffset - offset) % 32 === 0)
              return searchApplicationFailure(cause, refusal.detail);
            offset += search.ids.length;
          }
          return new ApplicationMaterializationPersistenceError({ cause });
        }
      }
    },
  });
}

function recordPreparedMaterialization(block: PreparedApplicationMaterializationBlock, advancedSearchBuilds: number, observation?: PointCommitPublicationObservation): void {
  if (!observation?.detail) return;
  let rowOffset = 0;
  for (const count of block.rows?.pageCounts ?? []) {
    const rows = block.rows?.decoded.slice(rowOffset, rowOffset + count) ?? [];
    observation.record({ kind: "batch", owner: "rowRevisions", counts: { rows: count,
      canonicalBytes: rows.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0) } });
    const creates = rows.filter(row => row.prevCommitSeq === null).length;
    if (creates > 0) observation.record({ kind: "batch", owner: "rowCreates", counts: { rows: creates } });
    if (creates < count) observation.record({ kind: "batch", owner: "rowUpdates", counts: { rows: count - creates } });
    rowOffset += count;
  }
  for (let offset = 0; offset < (block.indexes?.values.length ?? 0); offset += 32) {
    const rows = block.indexes?.values.slice(offset, offset + 32) ?? [];
    observation.record({ kind: "batch", owner: "indexRevisions", counts: { rows: rows.length, canonicalBytes: rows.reduce((sum, row) => sum + row.row.encodedKey.byteLength, 0) } });
    const creates = rows.filter(row => !row.row.isTombstone).length;
    if (creates > 0) observation.record({ kind: "batch", owner: "indexCreates", counts: { rows: creates } });
    if (creates < rows.length) observation.record({ kind: "batch", owner: "indexDeletes", counts: { rows: rows.length - creates } });
  }
  if (block.unique !== undefined) recordPreparedAppUniqueApplication(block.unique, observation);
  for (const [owner, rows] of [["indexValidation", block.validation ?? []], ["indexCoverage", block.indexCoverage ?? []], ["uniqueCoverage", block.uniqueCoverage ?? []]] as const)
    for (let offset = 0; offset < rows.length; offset += 32) observation.record({ kind: "batch", owner, counts: { rows: Math.min(32, rows.length - offset) } });
  let entries = 0; let textBytes = 0;
  for (const search of block.search ?? []) {
    entries += search.entryCount; textBytes += search.textBytes;
    for (let offset = 0; offset < search.ids.length; offset += 32) {
      observation.record({ kind: "batch", owner: "searchDeletes", counts: { rows: Math.min(32, search.ids.length - offset) } });
      const count = (search.textPages[offset / 32]?.length ?? 0) + (search.jsonPages[offset / 32]?.length ?? 0);
      if (count > 0) observation.record({ kind: "batch", owner: "searchInserts", counts: { entries: count } });
    }
  }
  if (advancedSearchBuilds > 0) observation.record({ kind: "batch", owner: "searchBuilds", counts: { rows: advancedSearchBuilds } });
  if ((block.search?.length ?? 0) > 0) observation.record({ kind: "counts", owner: "searchInserts", counts: { entries, textBytes } });
}

interface AcceptedMaterializationInput {
  readonly accepted: AcceptedApplicationPublication;
  readonly commitSeq: CommitSeq;
  readonly publicationProfile: import("../indexes/indexBuildStates").IndexPublicationProfile;
  readonly options: ApplicationDocumentMaterializationOptions;
  readonly deferCoverage?: boolean;
  readonly searchContribution?: Result.Result<import("./model").ApplicationDocumentSearchContribution, PointCommitCorruptionV1Error>;
}
const decodePublicationApplicationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Union([
  Schema.Struct({ phase: Schema.Literals(["uniqueCoverage", "indexCoverage", "intrinsic"]), reason: Schema.String, ordinal: Schema.Int }),
  Schema.Struct({ phase: Schema.Literal("materialization"), detail: Schema.String, intrinsicTransitions: Schema.Array(Schema.Struct({
    pairOrdinal: Schema.Int, keyOrdinal: Schema.Int, kind: Schema.Literals(["live", "tombstone"]),
  })) }),
])), { onExcessProperty: "error" });
const decodePublicationApplicationSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literals(["accepted", "stopped"]), row_count: Schema.Int, index_count: Schema.Int, unique_count: Schema.Int,
  validation_count: Schema.Int, coverage_count: Schema.Int, search_count: Schema.Int, search_build_count: Schema.Int, intrinsic_count: Schema.Int,
  intrinsic_live_count: Schema.Int, intrinsic_tombstone_count: Schema.Int, intrinsic_key_bytes: Schema.Int,
  index_coverage_count: Schema.Int, unique_coverage_count: Schema.Int,
}));
const decodePublicationApplicationRows = Schema.decodeUnknownResult(Schema.Struct({rows:Schema.Array(Schema.Unknown)}));

/** The genuine first-stage result is the only way to enter this installed owner.
 * Candidate validation precedes the fresh canonical coverage boundary at its caller. */
const PublicationApplicationTerminalReasonSchema = Schema.Struct({ reason: Schema.Literals(["accepted", "stopped"]) });
const decodePublicationApplicationTerminalReason = Schema.decodeUnknownResult(PublicationApplicationTerminalReasonSchema);
const PublicationApplicationCoverageSchema = Schema.Struct({ kind: Schema.Literals(["indexCoverage", "uniqueCoverage"]),
  coverage_ordinal: Schema.Int, coverage_definition: Schema.Int, coverage_attempt: Schema.String,
  coverage_epoch: ScopeEpochSchema, coverage_fence: StorageGenerationFenceSchema });
const decodePublicationApplicationCoverage = Schema.decodeUnknownResult(PublicationApplicationCoverageSchema);
const decodePublicationIndexCoverageAttempt = Schema.decodeUnknownResult(IndexBuildAttemptFenceSchema);
const decodePublicationIndexCoverageDefinition = Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema);
const decodePublicationUniqueCoverageAttempt = Schema.decodeUnknownResult(AppUniqueConstraintSetBuildAttemptFenceV1Schema);
const decodePublicationUniqueCoverageDefinition = Schema.decodeUnknownResult(CatalogUniqueConstraintDefinitionIdSchema);

export const materializeAcceptedApplicationPublicationRows = Effect.fnUntraced(function* (
  tx: AppRowTransaction, input: AcceptedMaterializationInput,
) {
  const state = yield* Effect.fromResult(readAcceptedApplicationPublication(tx,input.accepted));
  const { settlement, clock, intrinsic, developer, unique } = state.input;
  const command = settlement.command;
  const context = yield* readIndexCoverageContextInTransactionEffect(tx,clock.record,undefined,state.capturedCoverage)
    .pipe(Effect.mapError(failure => failure.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("lockDeveloperIndexBuilds",failure.cause)
      : corruption("developerIndexBuildInvalid")));
  const intrinsicPreparation = yield* Effect.exit(Effect.gen(function* () {
    if (settlement.intrinsic === undefined) return yield* Effect.die(new Error("Intrinsic publication preparation was not reached"));
    if (Exit.isFailure(settlement.intrinsic)) return yield* Effect.failCause(settlement.intrinsic.cause);
    const changes = new Map(command.rowIntents.map(row => [row.documentId,row]));
    const heads = new Map(state.heads.map(head => [appDocumentIdV1FromRowIdentity(head.head.identity),head]));
    const pairs = settlement.intrinsic.value.map(key => {
      const id = appDocumentIdV1FromRowIdentity({ tableId:key.definition.access.tableId,rowId:key.rowId });
      const row = changes.get(id); const prior = heads.get(id);
      return { definition:key.definition,rowId:key.rowId,priorCommitSeq:prior?.head.kind === "live" ? prior.head.revisionCommitSeq : null,
        priorKey:row?.kind === "deleted" || prior?.head.kind === "live" ? key.encodedKey : null,
        finalKey:row?.kind === "live" ? key.encodedKey : null };
    });
    const prepared = yield* prepareAppIndexKeyTransitionAcceptanceInTransactionEffect(tx,{ scopeId:command.authorityPins.scopeId,pairs,maximumActions:command.rowIntents.length });
    return { prepared,pairs };
  }));
  const emptyIntrinsic = Exit.isSuccess(intrinsicPreparation) ? intrinsicPreparation.value.prepared
    : yield* prepareAppIndexKeyTransitionAcceptanceInTransactionEffect(tx,{ scopeId:command.authorityPins.scopeId,pairs:[],maximumActions:command.rowIntents.length });
  const rowRevisions: AppendPreparedAppRowRevisionV1Input[] = [];
  const rowPreparation = Exit.isFailure(intrinsicPreparation) ? undefined : yield* Effect.exit(Effect.gen(function* () {
    const ordinals = new Map(command.dependencies.map((row,ordinal) => [row.documentId,ordinal]));
    for (const row of command.rowIntents) rowRevisions.push(yield* Effect.fromResult(prepareTentativePointCommitRowResult(
      clock.record.epoch,input.commitSeq,command,state.heads,row,ordinals.get(row.documentId))));
    return yield* prepareAppRowRevisionApplicationEffect(tx,rowRevisions);
  }));
  const indexPreparation = rowPreparation === undefined || Exit.isFailure(rowPreparation) ? undefined : yield* Effect.exit(
    prepareAppIndexRevisionApplicationEffect(tx,state.developerActions.map(action => ({ ...action,scopeId:command.authorityPins.scopeId,
      writeEpoch:clock.record.epoch,commitSeq:input.commitSeq }))));
  const uniquePreparation = indexPreparation === undefined || Exit.isFailure(indexPreparation) ? undefined : yield* Effect.exit(Effect.gen(function* () {
    if (settlement.unique === undefined) return yield* Effect.die(new Error("Unique publication preparation was not reached"));
    if (Exit.isFailure(settlement.unique)) return yield* Effect.failCause(settlement.unique.cause);
    return yield* prepareAppUniqueCanonicalMutationApplicationEffect(tx,command.authorityPins.scopeId,clock.record.epoch,uniqueCanonicalTransitions(settlement.unique.value));
  }));
  const search: PreparedLogicalSearchApplication[] = [];
  const searchPreparation = uniquePreparation === undefined || Exit.isFailure(uniquePreparation) ? undefined : yield* Effect.exit(Effect.gen(function* () {
    if (input.searchContribution === undefined) return;
    const contribution = yield* Effect.fromResult(input.searchContribution);
    const stages = prepareLogicalSearchApplications(contribution.definitions,contribution.changes,clock.scopeUuid,input.commitSeq);
    for (const selected of stages) search.push(yield* Effect.fromResult(selected));
  }));
  const stop = Exit.isFailure(intrinsicPreparation) ? "intrinsic" : rowPreparation === undefined || Exit.isFailure(rowPreparation) ? "row"
    : indexPreparation === undefined || Exit.isFailure(indexPreparation) ? "index" : uniquePreparation === undefined || Exit.isFailure(uniquePreparation) ? "unique"
      : searchPreparation !== undefined && Exit.isFailure(searchPreparation) ? "search" : null;
  const block: PreparedApplicationMaterializationBlock = { commitSeq:input.commitSeq,scopeUuid:clock.scopeUuid,
    ...(rowPreparation === undefined || Exit.isFailure(rowPreparation) ? {} : { rows:rowPreparation.value }),
    ...(indexPreparation === undefined || Exit.isFailure(indexPreparation) ? {} : { indexes:indexPreparation.value }),
    ...(uniquePreparation === undefined || Exit.isFailure(uniquePreparation) ? {} : { unique:uniquePreparation.value }),search };
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)).pipe(Effect.mapError(cause => new ApplicationMaterializationPersistenceError({cause})));
  const definitions = [...intrinsic,...developer]; const profile = input.publicationProfile;
  const scalar = applicationIndexTransitionScalarArray; const bytes = applicationIndexTransitionByteArray; const buildColumns = fxSystemIndexBuildStates;
  const active = context.active;
  const activeManifest = active === null ? null : yield* Effect.fromResult(Encoding.decodeHex(active.schema.schemaManifestSha256)).pipe(Effect.mapError(() => corruption("developerIndexBuildInvalid")));
  const prefix = sql`${sql.param(command.authorityPins.scopeId,buildColumns.scopeId)}::text, ${sql.param(clock.record.storageGeneration,buildColumns.storageGeneration)}::text,
    ${sql.param(clock.record.storageGenerationFence,buildColumns.storageGenerationFence)}::bigint, ${sql.param(clock.record.epoch,buildColumns.epoch)}::text,
    ${sql.param(clock.record.lastCommitSeq,buildColumns.coveredThroughCommitSeq)}::bigint, ${command.authorityPins.deploymentId}::text, ${command.authorityPins.schemaVersionId}::text,
    ${typeof profile !== "string"}::boolean, ${profile === "sourceBound"}::boolean, ${active !== null}::boolean,
    ${active?.schema.deploymentId ?? null}::text, ${active?.schema.schemaVersionId ?? null}::text,
    ${sql.param(activeManifest,fxAppRowRevisions.valueSha256)}::bytea, ${active?.head.activationSequence ?? null}::bigint,
    ${sql.param(active?.head.activationSha256 ?? null,fxAppRowRevisions.valueSha256)}::bytea, ${sql.param(active?.head.headSha256 ?? null,fxAppRowRevisions.valueSha256)}::bytea,
    ${scalar(definitions.map(definition=>definition.indexDefinitionId),"integer",buildColumns.indexDefinitionId)},
    ${scalar(definitions.map(definition=>definition.access.tableId),"integer",fxControlIndexDefinitions.tableId)},
    ${bytes(definitions.map(definition=>appIndexPhysicalSpecSha256HexV1ToBytes(definition.physicalSpecSha256Hex)),fxControlIndexDefinitions.physicalSpecSha256)},
    ${scalar(definitions.map(definition=>publicationModeForIndex(profile,definition)==="activeApplication"),"boolean",fxAppRowRevisions.isTombstone)},
    ${scalar(unique.map(definition=>definition.uniqueConstraintDefinitionId),"integer",fxControlUniqueConstraintDefinitions.uniqueConstraintDefinitionId)},
    ${scalar(unique.map(definition=>definition.tableId),"integer",fxControlUniqueConstraintDefinitions.tableId)},
    ${bytes(unique.map(definition=>appUniqueConstraintSpecSha256HexV1ToBytes(definition.physicalSpecSha256Hex)),fxControlUniqueConstraintDefinitions.physicalSpecSha256)},
    ${scalar(unique.map(definition=>publicationModeForTable(profile,definition.tableId)==="activeApplication"),"boolean",fxAppRowRevisions.isTombstone)},
    ${scalar(unique.map(definition=>definition.schemaVersionId),"text",fxControlSchemaVersionUniqueConstraintBindings.schemaVersionId)},
    ${scalar(unique.map(definition=>definition.deploymentId),"text",fxControlUniqueConstraintDefinitions.deploymentId)},
    ${input.deferCoverage === true}::boolean`;
  const invocation = (selected:PreparedApplicationMaterializationBlock) =>
    buildApplicationPublicationStatement(schemaName, prefix, emptyIntrinsic.keyParameters, stop, materializationValues(selected));
  const mapFailure = (cause:unknown) => {
    if (applicationDomainFailureDetail(cause,"fx_accept_app_index_transitions") !== null) {
      const failure = emptyIntrinsic.mapFailure(cause);
      return failure instanceof AppIndexEntryReadPersistenceError ? new PointCommitSqlFailureMarkerV1("loadIntrinsicIndexEntryHeads",failure.cause)
        : failure instanceof AppIndexEntryStorageCorruptionError ? failure
        : corruption("intrinsicIndexTransitionInvalid");
    }
    const detail = applicationDomainFailureDetail(cause,"fx_apply_app_publication");
    if (detail === null) return materializationApplicationFailure(cause,block);
    return Result.match(decodePublicationApplicationRefusal(detail), {
      onFailure: () => new ApplicationMaterializationPersistenceError({cause}),
      onSuccess: refusal => {
        if (refusal.phase !== "materialization") return refusal.reason === "indexCoverageMissing"
          ? new PointCommitDeveloperIndexMaintenanceUnavailableV1Error({reason:"definitionSetUnavailable"})
          : corruption(refusal.phase === "uniqueCoverage" ? "uniqueConstraintBuildInvalid" : refusal.phase === "intrinsic" ? "intrinsicIndexTransitionInvalid" : "developerIndexBuildInvalid");
        return Result.match(decodeMaterializationRefusal(refusal.detail), {
          onFailure: () => new ApplicationMaterializationPersistenceError({cause}),
          onSuccess: failure => {
            if (failure.family === "index") {
              if (Exit.isFailure(intrinsicPreparation)) return new ApplicationMaterializationPersistenceError({cause});
              const identities: import("../indexes/appIndexEntries").AppIndexEntryIdentityV1[]=[];
              for (const transition of refusal.intrinsicTransitions) {
                const pair=intrinsicPreparation.value.pairs[transition.pairOrdinal];
                const key=transition.keyOrdinal===0 ? pair?.priorKey : transition.keyOrdinal===1 ? pair?.finalKey : null;
                if (pair===undefined || key===null || key===undefined) return new ApplicationMaterializationPersistenceError({cause});
                identities.push({scopeId:command.authorityPins.scopeId,indexDefinitionId:pair.definition.indexDefinitionId,tableId:pair.definition.access.tableId,encodedKey:key,rowId:pair.rowId});
              }
              identities.push(...state.developerActions.map(action=>({scopeId:command.authorityPins.scopeId,indexDefinitionId:action.definition.indexDefinitionId,
                tableId:action.definition.access.tableId,encodedKey:action.encodedKey,rowId:action.rowId})));
              return publicationAppIndexApplicationFailure(cause,identities,input.commitSeq,failure.pageOffset,failure.detail);
            }
            if (failure.family === "indexValidation") return corruption("intrinsicIndexBuildInvalid");
            if (failure.family === "indexCoverage" || failure.family === "uniqueCoverage") return corruption(failure.family === "indexCoverage" ? "developerIndexBuildInvalid" : "uniqueConstraintBuildInvalid");
            return materializationApplicationFailure(cause,block,refusal.detail);
          },
        });
      },
    });
  };
  if (stop === null && Exit.isSuccess(intrinsicPreparation) && intrinsicPreparation.value.pairs.length > 0)
    invalidateAppIndexMembershipPositionsInTransaction(tx, intrinsicPreparation.value.pairs.flatMap(pair =>
      [pair.priorKey, pair.finalKey].flatMap(encodedKey => encodedKey === null ? [] : [{ scopeUuid: clock.scopeUuid,
        identity: { scopeId: command.authorityPins.scopeId, indexDefinitionId: pair.definition.indexDefinitionId,
          tableId: pair.definition.access.tableId, encodedKey, rowId: pair.rowId } }])));
  const statement=tx.execute(invocation(block));
  observeDrizzleRawQuery("applyPublication",statement,input.options.observeQuery);
  const result=yield* runDrizzleStatementEffect(statement,mapFailure);
  const {rows:driverRows}=yield* Effect.fromResult(decodePublicationApplicationRows(result))
    .pipe(Effect.mapError(cause=>new ApplicationMaterializationPersistenceError({cause})));
  const terminal=driverRows.at(-1);
  const terminalReason=yield* Effect.fromResult(decodePublicationApplicationTerminalReason(terminal))
    .pipe(Effect.mapError(cause=>new ApplicationMaterializationPersistenceError({cause})));
  if (terminalReason.reason === "stopped") {
    if (Exit.isFailure(intrinsicPreparation)) return yield* Effect.failCause(intrinsicPreparation.cause);
    if (rowPreparation!==undefined && Exit.isFailure(rowPreparation)) return yield* Effect.failCause(rowPreparation.cause);
    if (indexPreparation!==undefined && Exit.isFailure(indexPreparation)) return yield* Effect.failCause(indexPreparation.cause);
    if (uniquePreparation!==undefined && Exit.isFailure(uniquePreparation)) return yield* Effect.failCause(uniquePreparation.cause);
    if (searchPreparation!==undefined && Exit.isFailure(searchPreparation)) return yield* Effect.failCause(searchPreparation.cause);
    return yield* Effect.die(new Error("Materialization stopped without its retained Cause"));
  }
  const proof=yield* Effect.fromResult(decodePublicationApplicationSuccess(terminal)).pipe(Effect.mapError(cause=>new ApplicationMaterializationPersistenceError({cause})));
  const values=materializationValues(block);
  if (stop!==null || proof.row_count!==values.rows.length || proof.index_count!==values.indexes.length+proof.intrinsic_count ||
    proof.unique_count!==values.unique.owners.length || proof.search_count!==values.search.reduce((count,selected)=>count+selected.entryCount,0) ||
    proof.intrinsic_count<0 || proof.intrinsic_count>command.rowIntents.length || proof.validation_count<0 || proof.validation_count>intrinsic.length ||
    proof.coverage_count<0 || proof.coverage_count>definitions.length+unique.length || proof.search_build_count<0 || proof.search_build_count>search.length ||
    proof.intrinsic_live_count<0 || proof.intrinsic_tombstone_count<0 || proof.intrinsic_key_bytes<0 ||
    proof.intrinsic_live_count+proof.intrinsic_tombstone_count!==proof.intrinsic_count ||
    proof.index_coverage_count<0 || proof.unique_coverage_count<0 || proof.index_coverage_count>definitions.length || proof.unique_coverage_count>unique.length ||
    proof.index_coverage_count+proof.unique_coverage_count!==proof.coverage_count)
    return yield* Effect.fail(corruption("rowWriteInvalid"));
  recordPreparedMaterialization(block,proof.search_build_count,input.options.publicationObservation);
  const observation=input.options.publicationObservation;
  if(observation?.detail){
    // These are proved server totals, never invented driver calls or child pages.
    for(const [owner,count]of [["indexRevisions",proof.intrinsic_count],["indexCreates",proof.intrinsic_live_count],
      ["indexDeletes",proof.intrinsic_tombstone_count],["indexValidation",proof.validation_count],
      ["indexCoverage",proof.index_coverage_count],["uniqueCoverage",proof.unique_coverage_count]] as const)
      if(count>0) observation.record({kind:"counts",owner,counts:{rows:count,...(owner==="indexRevisions"?{canonicalBytes:proof.intrinsic_key_bytes}:{})}});
  }
  const indexCoverage:IndexCoverageWrite[]=[]; const uniqueCoverage:UniqueCoverageWrite[]=[];
  for (const raw of driverRows.slice(0,-1)) {
    const selected=yield* Effect.fromResult(decodePublicationApplicationCoverage(raw)).pipe(Effect.mapError(()=>corruption("developerIndexBuildInvalid")));
    const pins={scopeId:clock.record.scopeId,epoch:selected.coverage_epoch,storageGenerationFence:selected.coverage_fence};
    if (selected.kind==="indexCoverage") {
      if (selected.coverage_ordinal!==indexCoverage.length || !definitions.some(definition=>definition.indexDefinitionId===selected.coverage_definition)) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
      const attemptFence=yield* Effect.fromResult(decodePublicationIndexCoverageAttempt(selected.coverage_attempt))
        .pipe(Effect.mapError(()=>corruption("developerIndexBuildInvalid")));
      const indexDefinitionId=yield* Effect.fromResult(decodePublicationIndexCoverageDefinition(selected.coverage_definition))
        .pipe(Effect.mapError(()=>corruption("developerIndexBuildInvalid")));
      indexCoverage.push({...pins,attemptFence,indexDefinitionId});
    } else {
      if (selected.coverage_ordinal!==uniqueCoverage.length || !unique.some(definition=>definition.uniqueConstraintDefinitionId===selected.coverage_definition)) return yield* Effect.fail(corruption("uniqueConstraintBuildInvalid"));
      const attemptFence=yield* Effect.fromResult(decodePublicationUniqueCoverageAttempt(selected.coverage_attempt))
        .pipe(Effect.mapError(()=>corruption("uniqueConstraintBuildInvalid")));
      const uniqueConstraintDefinitionId=yield* Effect.fromResult(decodePublicationUniqueCoverageDefinition(selected.coverage_definition))
        .pipe(Effect.mapError(()=>corruption("uniqueConstraintBuildInvalid")));
      uniqueCoverage.push({...pins,attemptFence,uniqueConstraintDefinitionId});
    }
  }
  if (input.deferCoverage!==true && driverRows.length!==1) return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
  if (input.deferCoverage===true) return Effect.gen(function* () {
    yield* Effect.fromResult(readAcceptedApplicationPublication(tx,input.accepted));
    const indexProofs:CoverageProof<IndexCoverageWrite>[]=[]; const uniqueProofs:CoverageProof<UniqueCoverageWrite>[]=[];
    const pages:Array<{indexes:IndexCoverageWrite[];unique:UniqueCoverageWrite[];finalIndexes:boolean;finalUnique:boolean}>=[];
    for(let offset=0;offset<indexCoverage.length;offset+=32)pages.push({indexes:indexCoverage.slice(offset,offset+32),unique:[],
      finalIndexes:offset+32>=indexCoverage.length,finalUnique:false});
    for(let offset=0;offset<uniqueCoverage.length;offset+=32)pages.push({indexes:[],unique:uniqueCoverage.slice(offset,offset+32),
      finalIndexes:false,finalUnique:offset+32>=uniqueCoverage.length});
    for(const page of pages){
      // Each family's final native page proves its earlier complete stored rows,
      // retaining the original index-before-unique order and512-row proof bound.
      const proofs=yield* applyApplicationCoverage(tx,page.indexes,page.unique,input.commitSeq,undefined,
        page.finalIndexes?{indexes:indexProofs,unique:[]}:page.finalUnique?{indexes:[],unique:uniqueProofs}:undefined)
        .pipe(Effect.mapError(failure=>failure instanceof ApplicationCoveragePersistenceError
          ? new PointCommitSqlFailureMarkerV1("maintainUniqueConstraintCoverage",failure.cause) : corruption(failure.family==="index" ? "developerIndexBuildInvalid" : "uniqueConstraintBuildInvalid")));
      indexProofs.push(...proofs.indexes);uniqueProofs.push(...proofs.unique);
      if(observation?.detail) for(const [owner,count]of [["indexCoverage",page.indexes.length],["uniqueCoverage",page.unique.length]] as const)
        if(count>0)observation.record({kind:"batch",owner,counts:{rows:count}});
    }
  });
},(effect,tx)=>observeExecution("ApplicationDocument.materializeAcceptedPublication",effect)
  .pipe(Effect.mapError(failure=>{
    if (failure instanceof ApplicationMaterializationPersistenceError) return new PointCommitSqlFailureMarkerV1("applyPublication",failure.cause);
    if (failure instanceof AppRowWritePersistenceError) return pointCommitSqlCallFailure("writeTentativeRow",failure.cause);
    if (failure instanceof AppIndexEntryReadPersistenceError || failure instanceof AppIndexEntryWritePersistenceError)
      return pointCommitSqlCallFailure("writeIndexEntries",failure.cause);
    if (failure instanceof AppUniqueKeyPersistenceError || failure instanceof AppUniqueKeyConflictError || failure instanceof AppUniqueKeyHashError ||
      failure instanceof CanonicalAppUniqueKeyHashCollisionError || failure instanceof AppUniqueKeyParentRowError ||
      failure instanceof AppUniqueKeyPreviousClaimMismatchError || failure instanceof AppUniqueKeyStorageCorruptionError ||
      failure instanceof AppUniqueKeyScopeAuthorityUnavailableError || failure instanceof InvalidAppUniqueKeyMutationV1Error)
      return mapPointCommitUniqueKeyFailure(failure);
    return failure;
  }),
  Effect.onError(()=>Effect.sync(()=>closeExactAttemptScopeClockObservation(tx)))));

export const preparePointCommitApplicationRelationPlan = Effect.fn("ApplicationDocument.prepareRelationPlan")(function* (
  tx: AppRowTransaction, command: ApplicationDocumentMaterializationCommand,
  priorState: ApplicationDocumentPriorState, relations: LocatedPreparedPointCommitApplicationRelations | null,
  lastCommitSeq: bigint, options: ApplicationDocumentMaterializationOptions,
) {
  const plan = yield* Effect.fromResult(prepareRelationTransitionsResult(command, priorState, relations));
  if (plan === null) return null;
  yield* validatePointCommitApplicationRelationTargetsEffect(tx, command, plan.prepared, lastCommitSeq, options);
  return plan;
});

const decodeRelationTargetDriverRows = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));
const validatePointCommitApplicationRelationTargetsEffect = Effect.fn("ApplicationDocument.validateRelationTargets")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  prepared: PreparedApplicationRelationCommit,
  lastCommitSeq: bigint,
  options: ApplicationDocumentMaterializationOptions,
) {
  const checks = prepared.storedTargetChecks;
  if (checks.length === 0) return;
  const scopeUuid = (yield* Effect.fromResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
    ),
  )).scopeUuid;
  const values = sql.join(
    checks.map(
      (check, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${check.tableId}::integer,
      ${appRowIdHexV1ToBytes(check.rowId)}::bytea
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      revision.commit_seq::text as "revisionCommitSeqText",
      revision.is_tombstone as "isTombstone"
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join fx_app_row_rev as revision
      on revision.scope_uuid = ${scopeUuid}
      and revision.table_id = requested.table_id
      and revision.row_id = requested.row_id
      and revision.commit_seq = current_row.commit_seq
    order by requested.ordinal asc
  `;
  options.observeQuery?.(
    Object.freeze({
      name: "loadRelationTargets",
      sql: "bounded VALUES with exact current-pointer relation-target evidence",
      params: Object.freeze([]),
    }),
  );
  const result = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => tx.execute(statement),
    catch: cause => new PointCommitSqlFailureMarkerV1("loadRelationTargets", cause) }));
  const { rows } = yield* Effect.fromResult(decodeRelationTargetDriverRows(result).pipe(Result.mapError(() => corruption("relationTargetEvidenceInvalid"))));
  if (rows.length !== checks.length) {
    return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
  }
  for (let ordinal = 0; ordinal < checks.length; ordinal += 1) {
    const raw = rows[ordinal];
    const check = checks[ordinal];
    if (
      !isNonArrayRecord(raw) ||
      check === undefined ||
      raw.ordinalText !== String(ordinal)
    ) {
      return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
    }
    const pointerCommitSeq = yield* Effect.fromResult(
      parseNullableCommitSeqTextResult(raw.pointerCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    const revisionCommitSeq = yield* Effect.fromResult(
      parseNullableCommitSeqTextResult(raw.revisionCommitSeqText).pipe(
        Result.mapError(() => corruption("relationTargetEvidenceInvalid")),
      ),
    );
    if (
      pointerCommitSeq === null &&
      revisionCommitSeq === null &&
      raw.isTombstone === null
    ) {
      return yield* Effect.fail(new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      }));
    }
    if (
      pointerCommitSeq === null ||
      revisionCommitSeq === null ||
      pointerCommitSeq !== revisionCommitSeq ||
      revisionCommitSeq > lastCommitSeq ||
      typeof raw.isTombstone !== "boolean"
    ) {
      return yield* Effect.fail(corruption("relationTargetEvidenceInvalid"));
    }
    if (raw.isTombstone) {
      return yield* Effect.fail(new ApplicationRelationTargetNotLiveError({
        targetDocumentId: check.documentId,
      }));
    }
  }
});

export const maintainPointCommitApplicationRelationsEffect = Effect.fn(
  "PointCommitTransaction.maintainApplicationRelations",
)(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  commitSeq: CommitSeq,
  plan: PreparedPointCommitApplicationRelationPlan,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<void, PointCommitApplicationRelationMaintenanceError> {
  if (plan.prepared.actions.length > 0) {
    yield* applyApplicationRelationCommitEdgesInTransactionEffect(
      plan.port,
      tx,
      {
        scopeId: command.authorityPins.scopeId,
        schemaVersionId: command.authorityPins.schemaVersionId,
        commitSeq,
        prepared: plan.prepared,
      },
    ).pipe(
      Effect.mapError((cause) => {
        if (cause instanceof ApplicationRelationCommitUnavailableError) {
          return cause;
        }
        if (cause instanceof AppRelationEdgePersistenceError) {
          return new PointCommitSqlFailureMarkerV1(
            "writeRelationEdges",
            cause.cause,
          );
        }
        return corruption("relationEdgeInvalid");
      }),
    );
    // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - proof-hook rejection aborts the transaction and preserves cause identity
    yield* Effect.promise(() =>
      emitTransactionStep(options, command, "relationEdgeWritten"),
    );
  }

  yield* assertApplicationRelationRestrictProbesInTransactionEffect(
    plan.port,
    tx,
    command.authorityPins.scopeId,
    plan.prepared,
  ).pipe(
    Effect.mapError((cause) => {
      if (
        cause instanceof ApplicationRelationCommitUnavailableError ||
        cause instanceof ApplicationRelationTargetDeleteRestrictedError
      ) {
        return cause;
      }
      if (cause instanceof AppRelationEdgePersistenceError) {
        return new PointCommitSqlFailureMarkerV1(
          "validateRelationRestrict",
          cause.cause,
        );
      }
      return corruption("relationEdgeInvalid");
    }),
  );
  if (plan.prepared.restrictProbes.length > 0) {
    // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: transaction - proof-hook rejection aborts the transaction and preserves cause identity
    yield* Effect.promise(() =>
      emitTransactionStep(options, command, "relationRestrictValidated"),
    );
  }
});

export const loadPointCommitHeads = Effect.fn("ApplicationDocument.loadPointCommitHeads")((
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  options: ApplicationDocumentMaterializationOptions,
) => selectPointCommitHeads(tx, clock, command, options).pipe(Effect.map(captured => captured.heads)));

/** The actual writer capture retains predecessor envelopes behind the original
 * head/OCC gate. This does not accept originals or publication in advance. */
export const captureApplicationDocumentHeadsAndOriginals = Effect.fn("ApplicationDocument.captureHeadsAndOriginals")(function* (
  tx: AppRowTransaction, clock: ApplicationDocumentMaterializationClock,
  command: ApplicationDocumentMaterializationCommand,
  developer: readonly LockedPointCommitDeveloperIndexV1[],
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  options: ApplicationDocumentMaterializationOptions,
) {
  const identity = exactScopeWriteClockObservationIdentity(tx, command.authorityPins.scopeId);
  const installation = Result.getOrElse(requireAdmittedTargetInstallationIdentity(tx), () => undefined);
  const tables = predecessorDocumentTableIds(developer, unique, relations);
  const captured = yield* selectPointCommitHeads(tx, clock, command, options, tables,
    new Set(command.rowIntents.map(intent => intent.documentId)));
  const readPriorState = Effect.fn("ApplicationDocument.acceptCapturedOriginals")(function* () {
    if (identity === undefined || installation === undefined ||
      identity !== exactScopeWriteClockObservationIdentity(tx, command.authorityPins.scopeId) ||
      installation !== Result.getOrElse(requireAdmittedTargetInstallationIdentity(tx), () => undefined))
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    const headsByDocumentId = yield* Effect.fromResult(priorDocumentHeadsResult(command, captured.heads));
    const requests = yield* Effect.fromResult(priorDocumentRequestsResult(command, headsByDocumentId, tables));
    const ordinals = new Map(command.dependencies.map((point, ordinal) => [point.documentId, ordinal]));
    const rows = requests.map(request => captured.rows[ordinals.get(request.documentId) ?? -1]);
    const expectedOrdinals = requests.map(request => ordinals.get(request.documentId));
    const originals = yield* decodePointCommitOriginalDocuments(command, requests, rows, expectedOrdinals);
    return Object.freeze({ headsByDocumentId, ...originals, rowsByTable: indexApplicationDocumentRowIntents(command) });
  });
  return Object.freeze({ heads: captured.heads, readPriorState });
});

const selectPointCommitHeads = Effect.fn("ApplicationDocument.selectPointCommitHeads")(function* (
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  command: Pick<ApplicationDocumentMaterializationCommand, "authorityPins" | "dependencies">,
  options: ApplicationDocumentMaterializationOptions,
  originalTables?: ReadonlySet<CatalogTableId>,
  originalDocumentIds?: ReadonlySet<AppDocumentIdV1>,
) {
  if (command.dependencies.length === 0) return { heads: Object.freeze([]), rows: Object.freeze([]) };
  const values = sql.join(
    command.dependencies.map(
      (dependency, ordinal) => sql`
      (
        ${ordinal}::integer,
        ${dependency.tableId}::integer,
        ${appRowIdHexV1ToBytes(dependency.rowId)}::bytea,
        ${originalTables?.has(dependency.tableId) === true && originalDocumentIds?.has(dependency.documentId) === true}::boolean
      )
    `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id, original_demanded) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      current_row.commit_seq::text as "pointerCommitSeqText",
      latest.commit_seq::text as "latestCommitSeqText",
      latest.is_tombstone as "latestIsTombstone",
      latest.creation_time::text as "latestCreationTimeText"
      ${originalTables === undefined ? sql`` : sql`,
      latest.is_tombstone as "isTombstone", latest.creation_time::text as "creationTimeText",
      latest.value_codec_version as "valueCodecVersion", latest.value_bytes as "valueBytes",
      latest.value_sha256 as "valueSha256", latest.scope_uuid as "scopeUuid",
      latest.write_epoch_uuid as "writeEpochUuid", latest.prev_commit_seq::text as "prevCommitSeq",
      latest.schema_version_id as "schemaVersionId"`}
    from requested
    left join fx_app_row_current as current_row
      on current_row.scope_uuid = ${clock.scopeUuid}
      and current_row.table_id = requested.table_id
      and current_row.row_id = requested.row_id
    left join lateral (
      select revision.commit_seq, revision.is_tombstone, revision.creation_time
      ${originalTables === undefined ? sql`` : sql`, revision.value_codec_version,
        case when requested.original_demanded and not revision.is_tombstone
          and octet_length(revision.value_bytes) <= 1048576 then revision.value_bytes else null end as value_bytes,
        revision.value_sha256, revision.scope_uuid, revision.write_epoch_uuid,
        revision.prev_commit_seq, revision.schema_version_id`}
      from fx_app_row_rev as revision
      where revision.scope_uuid = ${clock.scopeUuid}
        and revision.table_id = requested.table_id
        and revision.row_id = requested.row_id
      order by revision.commit_seq desc
      limit 1
    ) as latest on true
    order by requested.ordinal asc
  `;
  options.observeQuery?.(
    Object.freeze({
      name: "loadRowHeads",
      sql: "bounded VALUES with current-pointer and latest-revision correlation",
      params: Object.freeze([]),
    }),
  );
  const result = yield* runDrizzleStatementEffect(tx.execute(statement),
    cause => pointCommitSqlCallFailure("loadRowHeads", cause));
  // The existing driver extractor throws for invalid wrappers. Only that
  // deliberate refusal enters E; unexpected accessor failures remain defects.
  const invalidRows = corruption("rowHeadInvalid");
  const rows = yield* Result.match(Result.try({
    try: () => rowsFromDriverExecuteResult(result, () => { throw invalidRows; }),
    catch: cause => cause,
  }), {
    onSuccess: extractedRows => Effect.succeed(extractedRows),
    onFailure: cause => cause === invalidRows ? Effect.fail(invalidRows) : Effect.die(cause),
  });
  const heads = yield* Effect.fromResult(capturePointCommitHeadsResult(rows, command, clock.record.lastCommitSeq));
  return { heads, rows };
});

function capturePointCommitHeadsResult(
  rows: ReadonlyArray<unknown>,
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  lastCommitSeq: CommitSeq,
): Result.Result<
  ReadonlyArray<LoadedPointCommitHeadV1>,
  PointCommitCorruptionV1Error
> {
  return Result.gen(function* () {
    const rowCount = rows.length;
    if (rowCount !== command.dependencies.length) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const heads: LoadedPointCommitHeadV1[] = [];
    for (let ordinal = 0; ordinal < rowCount; ordinal += 1) {
      if (!Object.hasOwn(rows, ordinal)) {
        return yield* Result.fail(corruption("dependencySetInvalid"));
      }
      heads.push(
        yield* decodePointCommitHeadResult(
          rows[ordinal],
          ordinal,
          command.dependencies[ordinal],
          command.authorityPins.scopeId,
          lastCommitSeq,
        ),
      );
    }
    return Object.freeze(heads);
  });
}

export function validatePointCommitDependenciesResult(
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  void,
  PointCommitConflictV1Error | PointCommitCorruptionV1Error
> {
  return findPointCommitConflictAfterEvidenceValidationResult(
    command,
    heads,
  ).pipe(
    Result.flatMap((conflict) =>
      conflict === null ? Result.succeed(undefined) : Result.fail(conflict),
    ),
  );
}

export function findPointCommitConflictAfterEvidenceValidationResult(
  command: Pick<
    ApplicationDocumentMaterializationCommand,
    "authorityPins" | "dependencies"
  >,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
): Result.Result<
  PointCommitConflictV1Error | null,
  PointCommitCorruptionV1Error
> {
  if (heads.length !== command.dependencies.length) {
    return Result.fail(corruption("dependencySetInvalid"));
  }
  let firstConflict: PointCommitConflictV1Error | null = null;
  for (let index = 0; index < command.dependencies.length; index += 1) {
    const dependency = command.dependencies[index];
    const loaded = heads[index];
    if (dependency === undefined || loaded === undefined) {
      return Result.fail(corruption("dependencySetInvalid"));
    }
    const validation = validateAppRowPointOccV1({
      snapshotToken: command.authorityPins.snapshotToken,
      dependency: adaptPointDependency(
        command.authorityPins.scopeId,
        dependency,
      ),
      head: loaded.head,
    });
    switch (validation.kind) {
      case "valid":
        break;
      case "conflict":
        firstConflict ??= new PointCommitConflictV1Error({
          conflict: Object.freeze({
            kind: "appRowPoint",
            documentId: dependency.documentId,
          }),
          snapshotCommitSeq: validation.conflict.snapshotCommitSeq,
          currentCommitSeq: validation.conflict.currentState.revisionCommitSeq,
        });
        break;
      case "invalidEvidence":
        return Result.fail(corruption("occEvidenceInvalid"));
    }
  }
  return Result.succeed(firstConflict);
}

function adaptPointDependency(
  scopeId: ReplacementScopeIdV1,
  input: PointCommitDependencyV1,
): AppRowPointDependencyV1 {
  const identity = freezeRowIdentity(input, scopeId);
  switch (input.dependency.observed.kind) {
    case "present":
      return Object.freeze({
        kind: "present",
        identity,
        revisionCommitSeq: input.dependency.observed.revisionCommitSeq,
      });
    case "missing":
      switch (input.dependency.observed.basis.kind) {
        case "noVisibleRevision":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({ kind: "noVisibleRevision" }),
          });
        case "tombstone":
          return Object.freeze({
            kind: "missing",
            identity,
            basis: Object.freeze({
              kind: "tombstone",
              revisionCommitSeq:
                input.dependency.observed.basis.revisionCommitSeq,
            }),
          });
      }
  }
}

export const lockPointCommitDeveloperIndexBuilds = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  definitions: readonly LocatedAppIndexDefinitionV1[],
  command: ApplicationDocumentMaterializationCommand,
) {
  if (clock.record.scopeId !== command.authorityPins.scopeId)
    return yield* Effect.fail(corruption("developerIndexBuildInvalid"));
  yield* acceptSelectedIndexBuildLocksInTransactionEffect(tx, clock.record, definitions, "definition").pipe(
    Effect.mapError(failure => failure instanceof IndexBuildStatePersistenceError
      ? new PointCommitSqlFailureMarkerV1("lockDeveloperIndexBuilds", failure.cause)
      : corruption("developerIndexBuildInvalid")));
  recordOriginalPublicationBuildLocks(tx, clock, "developer", definitions);
  return Object.freeze(definitions.map(definition => Object.freeze({ definition })));
});

function uniqueCanonicalTransitions(plans: readonly PointCommitUniqueKeyPlanV1[]) {
  return plans.map(plan => ({ constraintId: plan.definition.uniqueConstraintDefinitionId, tableId: plan.definition.tableId,
    rowId: plan.rowId, localeKey: plan.previousCanonical?.localeKey ?? plan.nextCanonical?.localeKey ?? "",
    previous: plan.previousCanonical, next: plan.nextCanonical, rowPrevCommitSeq: plan.rowPrevCommitSeq }));
}

export type ApplicationDocumentPriorState = ApplicationDocumentOriginals;

function predecessorDocumentTableIds(
  developer: readonly LockedPointCommitDeveloperIndexV1[],
  unique: readonly LocatedAppUniqueConstraintDefinitionV1[],
  relations: LocatedPreparedPointCommitApplicationRelations | null,
): ReadonlySet<CatalogTableId> {
  return new Set([
    ...developer.map(index => index.definition.access.tableId),
    ...unique.map(definition => definition.tableId),
    ...(relations?.definitions.definitions.map(definition => definition.binding.sourceTableId) ?? []),
  ]);
}

function priorDocumentHeadsResult(command: ApplicationDocumentMaterializationCommand,
  heads: readonly LoadedPointCommitHeadV1[]): Result.Result<ReadonlyMap<AppDocumentIdV1, LoadedPointCommitHeadV1>, PointCommitCorruptionV1Error> {
  const byId = new Map<AppDocumentIdV1, LoadedPointCommitHeadV1>();
  if (heads.length !== command.dependencies.length) return Result.fail(corruption("priorDocumentInvalid"));
  for (const [index, dependency] of command.dependencies.entries()) {
    const loaded = heads[index];
    if (loaded === undefined || byId.has(dependency.documentId)) return Result.fail(corruption("priorDocumentInvalid"));
    byId.set(dependency.documentId, loaded);
  }
  return Result.succeed(byId);
}
/** Exact predecessor evidence for one command in its protected transaction. */
export const loadApplicationDocumentPriorState = Effect.fn("ApplicationDocument.loadPriorState")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>,
  developer: ReadonlyArray<LockedPointCommitDeveloperIndexV1>,
  unique: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  relations: LocatedPreparedPointCommitApplicationRelations | null,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<ApplicationDocumentPriorState, PointCommitCorruptionV1Error | PointCommitSqlFailureMarkerV1> {
  const headsByDocumentId = yield* Effect.fromResult(priorDocumentHeadsResult(command, loadedHeads));
  const tableIds = predecessorDocumentTableIds(developer, unique, relations);
  const {documents,originalRows} = yield* loadPointCommitDocumentsForTables(tx, command, headsByDocumentId, tableIds, options);
  return Object.freeze({ headsByDocumentId, documents, originalRows, rowsByTable: indexApplicationDocumentRowIntents(command) });
});

const decodePriorDocumentRowsResult = Schema.decodeUnknownResult(Schema.Struct({
  rows: Schema.Array(Schema.Unknown),
}));
const decodeStoredPriorDocumentResult = Schema.decodeUnknownResult(Schema.Struct({
  ordinalText: Schema.String,
  isTombstone: Schema.Literal(false),
  creationTimeText: Schema.String,
  valueCodecVersion: Schema.Literal(1),
  valueBytes: Schema.Uint8Array,
  valueSha256: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32)),
  scopeUuid:ScopeUuidV1Schema,writeEpochUuid:ScopeEpochUuidV1Schema,
  prevCommitSeq:Schema.NullOr(CommitSeqSchema),schemaVersionId:CatalogSchemaVersionIdSchema,
}));

function priorDocumentRequestsResult(
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<AppDocumentIdV1, LoadedPointCommitHeadV1>,
  indexedTableIds: ReadonlySet<CatalogTableId>,
): Result.Result<readonly PointCommitDeveloperIndexDocumentRequestV1[], PointCommitCorruptionV1Error> {
  return Result.gen(function* () {
    const requests: PointCommitDeveloperIndexDocumentRequestV1[] = [];
    for (const intent of command.rowIntents) {
      if (!indexedTableIds.has(intent.tableId)) continue;
      const loaded = loadedHeadsByDocumentId.get(intent.documentId);
      if (loaded === undefined) return yield* Result.fail(corruption("priorDocumentInvalid"));
      if (loaded.head.kind !== "live") continue;
      if (loaded.creationTime === null) return yield* Result.fail(corruption("priorDocumentInvalid"));
      requests.push(Object.freeze({ documentId: intent.documentId, tableId: intent.tableId,
        rowId: intent.rowId, commitSeq: loaded.head.revisionCommitSeq, creationTime: loaded.creationTime }));
    }
    return Object.freeze(requests);
  });
}

const loadPointCommitDocumentsForTables = Effect.fn("ApplicationDocument.loadPriorDocuments")(function* (
  tx: AppRowTransaction,
  command: ApplicationDocumentMaterializationCommand,
  loadedHeadsByDocumentId: ReadonlyMap<
    AppDocumentIdV1,
    LoadedPointCommitHeadV1
  >,
  indexedTableIds: ReadonlySet<CatalogTableId>,
  options: ApplicationDocumentMaterializationOptions,
): Effect.fn.Return<Readonly<{documents:ReadonlyMap<AppDocumentIdV1,CanonicalFlarexValueV1>;originalRows:readonly LiveAppRowRevisionV1[]}>, PointCommitCorruptionV1Error | PointCommitSqlFailureMarkerV1> {
  const requests = yield* Effect.fromResult(priorDocumentRequestsResult(command, loadedHeadsByDocumentId, indexedTableIds));
  if (requests.length === 0) return {documents:new Map(),originalRows:[]};
  const { scopeUuid } = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(command.authorityPins.scopeId).pipe(
      Result.mapError(() => corruption("priorDocumentInvalid")),
    ),
  );
  const values = sql.join(
    requests.map(
      (request, ordinal) => sql`
    (
      ${ordinal}::integer,
      ${request.tableId}::integer,
      ${appRowIdHexV1ToBytes(request.rowId)}::bytea,
      ${request.commitSeq}::bigint
    )
  `,
    ),
    sql`, `,
  );
  const statement = sql`
    with requested(ordinal, table_id, row_id, commit_seq) as (
      values ${values}
    )
    select
      requested.ordinal::text as "ordinalText",
      revision.is_tombstone as "isTombstone",
      revision.creation_time::text as "creationTimeText",
      revision.value_codec_version as "valueCodecVersion",
      revision.value_bytes as "valueBytes",
      revision.value_sha256 as "valueSha256",
      revision.scope_uuid as "scopeUuid", revision.write_epoch_uuid as "writeEpochUuid",
      revision.prev_commit_seq::text as "prevCommitSeq", revision.schema_version_id as "schemaVersionId"
    from requested
    left join fx_app_row_rev as revision
      on revision.scope_uuid = ${scopeUuid}
      and revision.table_id = requested.table_id
      and revision.row_id = requested.row_id
      and revision.commit_seq = requested.commit_seq
    order by requested.ordinal asc
  `;
  options.observeQuery?.(Object.freeze({
    name: "loadPriorDocuments", sql: "bounded VALUES with exact predecessor document evidence",
    params: Object.freeze([]),
  }));
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: cause => new PointCommitSqlFailureMarkerV1("loadPriorDocuments", cause),
  }));
  const { rows } = yield* Effect.fromResult(decodePriorDocumentRowsResult(result).pipe(
    Result.mapError(() => corruption("priorDocumentInvalid")),
  ));
  return yield* decodePointCommitOriginalDocuments(command, requests, rows);
});

/** Shared exact predecessor decoder for both actual capture shapes. */
const decodePointCommitOriginalDocuments = Effect.fnUntraced(function* (
  command: ApplicationDocumentMaterializationCommand,
  requests: readonly PointCommitDeveloperIndexDocumentRequestV1[], rows: readonly unknown[],
  expectedOrdinals?: readonly (number | undefined)[],
) {
  if (rows.length !== requests.length) {
    return yield* Effect.fail(corruption("priorDocumentInvalid"));
  }
  const documents = new Map<AppDocumentIdV1, CanonicalFlarexValueV1>();
  const originalRows:LiveAppRowRevisionV1[]=[];
  for (let ordinal = 0; ordinal < requests.length; ordinal += 1) {
    const raw = yield* Effect.fromResult(decodeStoredPriorDocumentResult(rows[ordinal]).pipe(
      Result.mapError(() => corruption("priorDocumentInvalid")),
    ));
    const request = requests[ordinal];
    if (
      request === undefined ||
      raw.ordinalText !== String(expectedOrdinals === undefined ? ordinal : expectedOrdinals[ordinal]) ||
      raw.creationTimeText !== String(request.creationTime)
    ) {
      return yield* Effect.fail(corruption("priorDocumentInvalid"));
    }
    const document = yield* decodeStoredAppDocumentEvidenceEffect({
      tableId: request.tableId,
      rowId: request.rowId,
      creationTime: request.creationTime,
      codecVersion: raw.valueCodecVersion,
      canonicalBytes: raw.valueBytes,
      sha256: raw.valueSha256,
    }).pipe(Effect.mapError(() => corruption("priorDocumentInvalid")));
    documents.set(request.documentId, document);
    originalRows.push({kind:"live",scopeId:command.authorityPins.scopeId,scopeUuid:raw.scopeUuid,writeEpochUuid:raw.writeEpochUuid,
      tableId:request.tableId,rowId:request.rowId,commitSeq:request.commitSeq,prevCommitSeq:raw.prevCommitSeq,schemaVersionId:raw.schemaVersionId,
      creationTime:request.creationTime,document});
  }
  return {documents,originalRows};
});

export const runCandidateSchemaWriteGuard = Effect.fn(
  "ApplicationDocumentMaterialization.runCandidateSchemaWriteGuard",
)(
  (
    tx: AppRowTransaction,
    candidate: PreparedPointCommitCandidateSchemaWriteGuard,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    commitSeq: CommitSeq,
    liveRows: ReadonlyArray<
      Readonly<{
        readonly tableId: CatalogTableId;
        readonly rowId: AppRowIdHexV1;
        readonly document: CanonicalFlarexValueV1;
      }>
    >,
    lockedHead?: import("../catalog/appSchemaCandidateValidation").AppSchemaCandidateWriteGuardPlanningHead,
  ) =>
    applyAppSchemaCandidateWriteGuardInTransactionEffect(
      tx,
      candidate.guard,
      candidate.prepared,
      authority,
      clock,
      commitSeq,
      liveRows,
      lockedHead,
    ).pipe(
      Effect.mapError((failure) =>
        failure.reason === "persistence"
          ? new PointCommitSqlFailureMarkerV1(
              "validateCandidateSchema",
              failure.cause ?? failure,
            )
          : corruption("candidateSchemaValidationInvalid"),
      ),
    ),
);

function developerIndexValidationInvalid(): PointCommitCorruptionV1Error {
  return corruption("developerIndexBuildInvalid");
}

export const resetPointCommitDeveloperIndexValidations = Effect.fn("ApplicationDocument.resetDeveloperValidation")(function* (
  tx: AppRowTransaction, builds: readonly (IndexCoverageWrite & Pick<IndexBuildStateRecord,"lifecycle">)[],
  publicationObservation?: PointCommitPublicationObservation,
) {
  const selected = builds.filter(build => build.lifecycle === "validating");
  if (selected.length === 0) return;
  const operation = "resetDeveloperIndexValidation";

    const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)
      .pipe(Result.mapError(cause => pointCommitSqlCallFailure(operation, cause))));
    const statement = sql`select reason, rows from ${sql.identifier(schemaName)}.fx_reset_app_index_validation(
      ${applicationIndexCoverageArray(selected, schemaName)})`;
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => tx.execute(statement),
      catch: cause => {
        const detail = applicationDomainFailureDetail(cause, "fx_reset_app_index_validation");
        if (detail === null) return pointCommitSqlCallFailure(operation, cause);
        return Result.match(decodeIndexValidationRefusal(detail), {
          onFailure: () => pointCommitSqlCallFailure(operation, cause),
          onSuccess: refusal => Number.isSafeInteger(refusal.ordinal) && refusal.ordinal >= 0 && refusal.ordinal < selected.length
            ? developerIndexValidationInvalid() : pointCommitSqlCallFailure(operation, cause),
        });
      },
    }));
    const rows = rowsFromDriverExecuteResult(result, () => { throw developerIndexValidationInvalid(); });
    if (rows.length !== 1) return yield* Effect.fail(developerIndexValidationInvalid());
    const proof = yield* Effect.fromResult(decodeIndexValidationSuccess(rows[0]).pipe(Result.mapError(developerIndexValidationInvalid)));
    if (proof.rows !== selected.length) return yield* Effect.fail(developerIndexValidationInvalid());
    if (publicationObservation?.detail) for (let offset = 0; offset < selected.length; offset += 32)
      publicationObservation.record({ kind: "batch", owner: "indexValidation", counts: { rows: Math.min(32, selected.length - offset) } });
});

export const lockPointCommitIntrinsicIndexBuilds = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  clock: ApplicationDocumentMaterializationClock,
  definitions: readonly LocatedAppIndexDefinitionV1[],
  command: ApplicationDocumentMaterializationCommand,
) {
  if (clock.record.scopeId !== command.authorityPins.scopeId ||
      new Set(definitions.map(definition => definition.indexDefinitionId)).size !== definitions.length)
    return yield* Effect.fail(corruption("intrinsicIndexBuildInvalid"));
  for (let offset = 0; offset < definitions.length; offset += 32) {
    yield* acceptSelectedIndexBuildLocksInTransactionEffect(tx, clock.record,
      definitions.slice(offset, offset + 32), "input").pipe(
      Effect.mapError(failure => failure instanceof IndexBuildStatePersistenceError
        ? new PointCommitSqlFailureMarkerV1("lockIntrinsicIndexBuild", failure.cause)
        : corruption("intrinsicIndexBuildInvalid")));
  }
  recordOriginalPublicationBuildLocks(tx, clock, "intrinsic", definitions);
  return Object.freeze(definitions.map(definition => Object.freeze({ definition })));
});


function prepareTentativePointCommitRowResult(
  writeEpoch: ScopeEpoch,
  tentativeCommitSeq: CommitSeq,
  command: ApplicationDocumentMaterializationCommand,
  heads: ReadonlyArray<LoadedPointCommitHeadV1>,
  intent: PreparedPointCommitRowIntentV1,
  dependencyIndex: number | undefined,
): Result.Result<
  AppendPreparedAppRowRevisionV1Input,
  PointCommitCorruptionV1Error
> {
  const dependency = dependencyIndex === undefined ? undefined : command.dependencies[dependencyIndex];
  const loaded = dependencyIndex === undefined ? undefined : heads[dependencyIndex];
  if (dependency === undefined || !pointDependenciesEqual(dependency, intent) || loaded === undefined) {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  const observed = intent.dependency.observed;
  if (intent.kind === "deleted") {
    if (
      observed.kind !== "present" ||
      loaded.head.kind !== "live" ||
      loaded.creationTime === null
    ) {
      return Result.fail(corruption("rowTransitionInvalid"));
    }
    const predecessorCommitSeq = loaded.head.revisionCommitSeq;
    const creationTime = loaded.creationTime;
    return Result.succeed({
      kind: "tombstone",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch,
      commitSeq: tentativeCommitSeq,
      prevCommitSeq: predecessorCommitSeq,
      schemaVersionId: command.sourceSchemaVersionByTable?.get(intent.tableId) ?? command.authorityPins.schemaVersionId,
      creationTime,
    });
  }

  let prevCommitSeq: CommitSeq | null;
  if (
    observed.kind === "missing" &&
    observed.basis.kind === "noVisibleRevision" &&
    loaded.head.kind === "missing"
  ) {
    prevCommitSeq = null;
  } else if (observed.kind === "present" && loaded.head.kind === "live") {
    prevCommitSeq = loaded.head.revisionCommitSeq;
  } else {
    return Result.fail(corruption("rowTransitionInvalid"));
  }
  return Result.succeed({
    kind: "live",
    scopeId: command.authorityPins.scopeId,
    tableId: intent.tableId,
    rowId: intent.rowId,
    writeEpoch,
    commitSeq: tentativeCommitSeq,
    prevCommitSeq,
    schemaVersionId: command.sourceSchemaVersionByTable?.get(intent.tableId) ?? command.authorityPins.schemaVersionId,
    creationTime: intent.creationTime,
    document: intent.document,
  });
}

export async function emitTransactionStep<Step extends string>(
  options: {
    readonly afterTransactionStep?: (event: {
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: Step;
    }) => Promise<void>;
  },
  command: Readonly<{
    authorityPins: { readonly scopeId: ReplacementScopeIdV1 };
  }>,
  step: Step,
): Promise<void> {
  await options.afterTransactionStep?.(
    Object.freeze({
      scopeId: command.authorityPins.scopeId,
      step,
    }),
  );
}
