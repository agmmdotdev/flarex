import { invalidateAcceptedApplicationBindingInTransaction } from "../../application/activation/acceptedBinding";
import { invalidateSharedLogicalSourceBindingChecks } from "../documents/logicalDocuments/sourceAdmission";
import { observeExecution } from "../../execution/diagnostics/operation";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import { prepareUniqueReadinessCapture } from "./nativeUniqueBuildAcceptance";
import {
  chargeHostPreparation,
  registerHostPreparationDisposal,
  PreparedHostRuntimeError,
} from "../../execution/preparation/preparedHostRuntime";
import { insertUniqueConstraintBuild } from "../indexes/indexBuildLifecycleDml";
import {
  type PointCommitPublicationObservation,
} from "../../commit/point/observation";
import {
  applyApplicationCoverage,
  ApplicationCoveragePersistenceError,
  APPLICATION_COVERAGE_MAX_ROWS,
  type CoverageProof,
  type UniqueCoverageWrite,
} from "../materialization/domainCoverage";
import type { Json } from "flarex-protocol/json";
import {
  readCommitFeedPageInTransactionV1Effect,
  CommitFeedSqlErrorV1,
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
} from "../../commit/commitFeed";
import {
  isPhysicalUniqueBuildActiveInTransactionEffect,
  PhysicalDefinitionLifecyclePersistenceError,
} from "../../installation/physicalDefinitionLifecycle";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { maintenanceKeyMatchesCoverageContext, maintenanceMatchesCoverageContext, publicationModeForTable, readIndexCoverageContextInTransactionEffect,
  prepareMissingBindingMaintenanceCheck, hasRequiredBindingMaintenance,
  borrowIndexCoverageContextInTransaction, readPreparedIndexCoverageTableFrontiers,
  readIndexCoverageTableFrontiersInTransactionEffect,
  type IndexCoverageContext } from "../indexes/indexBuildStates";
import {
  decodeUniqueMaintenanceObligationEffect,
  UniqueMaintenanceError,
  type UniqueMaintenanceObligation,
} from "../indexes/indexMaintenanceModel";
import { applicationDomainFailureDetail } from "../materialization/domainApplication";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "../../application/applicationActivationSchema";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, getTableColumns, inArray, isNotNull, sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { isRetryableSqlTransactionCause } from "../../database/locatedReadCommittedEffect";
import { Cause, Data, Effect, Exit, Option, Result, Schema } from "effect";
import {
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogUniqueConstraintDefinitionIdSchema,
  type CatalogTableId,
  type CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
  APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
  AppUniqueConstraintSetBuildAttemptFenceV1Schema,
  AppUniqueConstraintSetBuildLifecycleV1Schema,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1,
  MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1,
  appUniqueConstraintSetSha256HexV1ToBytes,
  type AppUniqueConstraintSetBuildAttemptFenceV1,
  type AppUniqueConstraintSetSha256HexV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
  CommitSeqSchema,
  ScopeIdSchema,
  ScopeEpochSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  FlarexDbV1StorageGenerationSchema,
  projectScopeIdUuidV1Result,
  type ScopeId,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import {
  hasAppUniqueConstraintDefinitionAuthorityForControlDbV1,
  lowerCanonicalAppUniqueConstraintV1Result,
  type AppUniqueConstraintDefinitionPortV1,
} from "./appUniqueConstraintCommitV1";
import {
  locateAppUniqueConstraintDefinitionsForSchemaEffect,
  isLocatedAppUniqueConstraintDefinitionV1,
  type LocatedAppUniqueConstraintDefinitionV1,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import {
  ensureAppUniqueKeyBackfillClaimInTransactionEffect,
  applyAppUniqueKeyMutationsInTransactionEffect,
  readAppUniqueKeyOwnersInTransactionEffect,
  drainInitialAppUniqueKeyClaimsInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Error,
  type EnsureAppUniqueKeyBackfillClaimV1Error,
  validateAppUniqueKeyClaimInTransactionEffect,
  type ValidateAppUniqueKeyClaimV1Error,
} from "./appUniqueKeys";
import {
  appUniqueConstraintDefinitionsMatchMembers,
  readAppUniqueConstraintSetClosureV1Effect,
  AppUniqueConstraintSetClosureResourceError,
  AppUniqueConstraintSetClosurePersistenceV1Error,
  type LocatedAppUniqueConstraintSetClosureV1,
  type ReadAppUniqueConstraintSetClosureV1Error,
} from "./appUniqueConstraintSetClosureV1";
import { AppUniqueConstraintCatalogPersistenceError } from "./appUniqueConstraintDefinitions";
import { runEffectTransaction } from "../../database/effectTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import {
  AppSchemaCandidateValidationPersistenceError,
  claimCurrentAppSchemaCandidateValidationHeadEffect,
  hasAppSchemaCandidateValidationComposition,
  installPreparedAppSchemaCandidateValidationInTransactionEffect,
  prepareAppSchemaCandidateValidationInstallEffect,
  readAppSchemaCandidateValidationHeadForShareInTransactionEffect,
  type AppSchemaCandidateValidationOptions,
  type AppSchemaCandidateValidationPort,
  type ExpectedAppSchemaCandidateValidationHeadClaim,
  type InstallAppSchemaCandidateValidationError,
  type InstallAppSchemaCandidateValidationResult,
  type LoadAppSchemaCandidateValidationError,
  type PreparedAppSchemaCandidateValidationInstall,
} from "../catalog/appSchemaCandidateValidation";
import {
  readApplicationActiveRevisionForShareInTransactionEffect,
} from "../../application/applicationActiveHeadRead";
import {
  readCurrentAppRowInTransactionEffect,
  AppRowReadPersistenceError,
  readAppTableWriteFrontierInTransactionEffect,
  readAppTableWriteFrontiersInTransactionEffect,
  type AppRowTableFrontierCorruptionError,
  type AppRowReadResultV1,
  type AppRowTransaction,
  type ReadAppRowError,
} from "../documents/appRows";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";
import { hasExactOwnDataKeys } from "../../values/exactOwnDataKeys";
import {
  getScopeClock,
  lockScopeClockForSnapshotReadInTransactionEffect,
  ScopeAuthorizationRevocationEpochPersistenceError,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import {
  makeInstallationProtectedScopeAuthorityControlReader,
} from "../../scope/scopeAuthorityControlRead";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import { captureScopePhysicalLocator } from "../../scope/scopePhysicalLocator";
import {
  fxSystemUniqueConstraintBuilds,
  fxSystemUniqueMaintenanceObligations,
} from "../../database/schema";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../../execution/readCommittedTransactionFailure";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  registerLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../../database/locatedTransactionIdentity";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../../database/locatedReadCommittedRunner";

const INPUT_KEYS = Object.freeze(["deploymentId", "scopeId", "schemaVersionId"] as const);
const BACKFILL_INPUT_KEYS = Object.freeze([
  "deploymentId",
  "scopeId",
  "schemaVersionId",
  "pageSize",
] as const);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeScopeIdResult = Schema.decodeUnknownResult(Schema.toType(ScopeIdSchema));

export interface ReconcileAppUniqueConstraintSetBuildV1Input {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export const MAX_APP_UNIQUE_CONSTRAINT_SET_BACKFILL_PAGE_SIZE_V1 = 16;

export interface AdvanceAppUniqueConstraintSetBackfillV1Input extends ReconcileAppUniqueConstraintSetBuildV1Input {
  readonly pageSize: number;
}

export interface LocatedAppUniqueConstraintSetBuildTargetV1 extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedAppUniqueConstraintSetBuildTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted?: RunLocatedReadCommittedTransactionV1,
): LocatedAppUniqueConstraintSetBuildTargetV1 {
  const target = Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted ?? createDefaultLocatedReadCommittedTransactionRunnerV1(db),
  });
  if (runReadCommitted === undefined) registerLocatedReadCommittedTargetDatabaseV1(target, db);
  return target;
}

export const MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE = 8192;

export class AppUniqueConstraintSetBuildDirectoryV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetBuildDirectoryV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly reason: "tooManyBuildRows" | "concurrentStateChange";
  readonly maximumBuilds: number;
}> {}

export type ReclaimSupersededAppUniqueConstraintSetBuildResult = Readonly<{
  readonly status: "reclaimed";
  readonly disposition:
    | "deleted"
    | "retained"
    | "already_absent"
    | "replayedAfterUncertainCompletion";
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly deletedDefinitionIds?: ReadonlyArray<CatalogUniqueConstraintDefinitionId>;
  readonly retainedDefinitionIds?: ReadonlyArray<CatalogUniqueConstraintDefinitionId>;
}>;

export class AppUniqueConstraintSetBuildReclamationError extends Data.TaggedError(
  "AppUniqueConstraintSetBuildReclamationError",
)<{
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly scopeId?: ScopeId;
  readonly reason:
    | "invalidPort"
    | "schemaAuthorityMissing"
    | "activeSchema"
    | "currentCandidate"
    | "buildEnabled"
    | "activeSchemaStateInvalid"
    | "candidateSchemaStateInvalid"
    | "concurrentStateChange";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type ReclaimSupersededAppUniqueConstraintSetBuildError =
  | InvalidAppUniqueConstraintSetBuildInputV1Error
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildDirectoryV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

export type InstallAppSchemaCandidateWithWorkspaceReclamationResult = Readonly<{
  readonly installation: InstallAppSchemaCandidateValidationResult;
  readonly workspace:
    | Readonly<{ readonly disposition: "not_applicable" }>
    | Readonly<{
        readonly disposition: "already_absent" | "deleted";
        readonly schemaVersionId: CatalogSchemaVersionId;
      }>
    | Readonly<{
        readonly disposition: "retained";
        readonly reason:
          | "activeSchema"
          | "buildEnabled"
          | "sharedDefinition"
          | "protectedMembershipUnknown";
        readonly schemaVersionId: CatalogSchemaVersionId;
      }>;
}>;

export type InstallAppSchemaCandidateWithWorkspaceReclamationError =
  | InstallAppSchemaCandidateValidationError
  | LoadAppSchemaCandidateValidationError
  | Exclude<
      ReclaimSupersededAppUniqueConstraintSetBuildError,
      AppUniqueConstraintSetBuildDecisionUncertainV1Error
    >;

export interface InstallAppSchemaCandidateWithWorkspaceReclamationOptions {
  readonly candidateValidation?: AppSchemaCandidateValidationOptions;
  readonly uniqueConstraintBuild?: AppUniqueConstraintSetBuildOptionsV1;
}

export interface AppUniqueConstraintSetBuildPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedAppUniqueConstraintSetBuildTargetV1>;
}

const eligibilityPortBrand: unique symbol = Symbol(
  "FlarexDB/AppUniqueConstraintSetEligibilityPortV1",
);
const eligibilityEvidenceBrand: unique symbol = Symbol(
  "FlarexDB/AppUniqueConstraintSetEligibilityEvidenceV1",
);

/** Private, process-local C08-B1 eligibility authority. */
export interface AppUniqueConstraintSetEligibilityPortV1 {
  readonly [eligibilityPortBrand]: true;
}

export interface AppUniqueConstraintSetEligibilityInputV1 {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface AppUniqueConstraintBuildIdentity {
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId;
  readonly tableId: CatalogTableId;
  readonly startCommitSeq: CommitSeq;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
}

export interface AppUniqueConstraintSetEligibilityEvidenceV1 {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly definitionCount: number;
  readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
  readonly tableIds: ReadonlyArray<CatalogTableId>;
  readonly storageGeneration: TrustedScopeAuthority["storageGeneration"];
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: TrustedScopeAuthority["epoch"];
  readonly definitionBuilds: ReadonlyArray<AppUniqueConstraintBuildIdentity>;
  readonly [eligibilityEvidenceBrand]: true;
}

export type AppUniqueConstraintSetEligibilityResultV1 =
  | Readonly<{
      readonly status: "not_required";
      readonly tableIds: readonly [];
    }>
  | Readonly<{
      readonly status: "not_ready";
      readonly reason:
        "setNotClosed" | "buildMissing" | "buildNotEnabled" | "buildStale";
      readonly blocksAllTables: boolean;
      readonly tableIds: ReadonlyArray<CatalogTableId>;
      readonly lifecycle?: BuildState["lifecycle"];
    }>
  | Readonly<{
      readonly status: "eligible";
      readonly evidence: AppUniqueConstraintSetEligibilityEvidenceV1;
    }>;

export class AppUniqueConstraintSetEligibilityV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetEligibilityV1Error",
)<{
  readonly reason: "invalidPort" | "scopeMismatch" | "targetTransaction";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type LoadAppUniqueConstraintSetEligibilityV1Error =
  | AppUniqueConstraintSetEligibilityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

const eligibilityPortStates = new WeakMap<
  AppUniqueConstraintSetEligibilityPortV1,
  Readonly<{
    readonly ports: AppUniqueConstraintSetBuildPortsV1;
    readonly uniqueConstraints: AppUniqueConstraintDefinitionPortV1;
  }>
>();
const eligibilityEvidenceSnapshots = new WeakMap<object, Readonly<{ snapshot: BuildSnapshot;
  tx: AppRowTransaction; clock: ScopeClockRecord }>>();
const uniquePreparationBrand: unique symbol = Symbol("AppUniqueConstraintSetPreparation");
export interface AppUniqueConstraintSetPreparation { readonly [uniquePreparationBrand]: true }
type UniquePreparationState = Readonly<{
  port: AppUniqueConstraintSetEligibilityPortV1;
  scopeId: ScopeId;
  snapshot: BuildSnapshot;
  tableIds: ReadonlyArray<CatalogTableId>;
  membersById: ReadonlyMap<CatalogUniqueConstraintDefinitionId, BuildSnapshot["members"][number]>;
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[];
}>;
const uniquePreparations = new WeakMap<object, UniquePreparationState>();

/** The host allocation meters hidden catalog state without borrowing its ports. */
export const chargeUniqueConstraintPreparation = Effect.fn("AppUniqueConstraintSetBuild.chargePreparation")(
  (preparation: AppUniqueConstraintSetPreparation) => {
    const state = uniquePreparations.get(preparation);
    return state === undefined ? Effect.fail(new PreparedHostRuntimeError({ reason: "invalidPayload" }))
      : chargeHostPreparation({ scopeId: state.scopeId, snapshot: state.snapshot, tableIds: state.tableIds,
          definitionIds: [...state.membersById.keys()], definitions: state.definitions.map(definition =>
            ({ ...definition, createdAt: definition.createdAt.getTime() })) }).pipe(
            Effect.andThen(registerHostPreparationDisposal(() => { uniquePreparations.delete(preparation); })));
  },
);

/** Closed catalog inputs only. No target observation or eligibility is issued. */
export const prepareAppUniqueConstraintSet = Effect.fnUntraced(
  function* (port: AppUniqueConstraintSetEligibilityPortV1, input: AppUniqueConstraintSetEligibilityInputV1,
    reader?: FlarexMetadataTransaction) {
    const state = eligibilityPortStates.get(port);
    if (state === undefined) return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    const captured = Object.freeze({ deploymentId: input.deploymentId, scopeId: input.scopeId, schemaVersionId: input.schemaVersionId });
    const closure = yield* readAppUniqueConstraintSetClosureV1Effect(state.ports.controlDb, captured.deploymentId, captured.schemaVersionId,
      undefined, reader);
    if (closure === null) return Object.freeze({ status: "not_ready" as const, reason: "setNotClosed" as const,
      blocksAllTables: true, tableIds: [] as const });
    const tableIds = uniqueConstraintTableIds(closure);
    const definitions = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(reader ?? state.ports.controlDb,
      captured.deploymentId, captured.scopeId, captured.schemaVersionId, tableIds, closure.members.length);
    if (definitions === null || !appUniqueConstraintDefinitionsMatchMembers(definitions, closure.members))
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    const preparation: AppUniqueConstraintSetPreparation = Object.freeze({ [uniquePreparationBrand]: true as const });
    uniquePreparations.set(preparation, Object.freeze({ port, scopeId: captured.scopeId,
      snapshot: buildSnapshot(captured, closure), tableIds, definitions,
      membersById: new Map(closure.members.map(member => [member.uniqueConstraintDefinitionId, member])) }));
    return Object.freeze({ status: "prepared" as const, preparation });
  }, work => observeExecution("AppUniqueConstraintSetBuild.prepareCatalog", work, "caller"));

const validateUniqueCatalogSnapshot = Effect.fnUntraced(function* (
  controlDb: FlarexMetadataDatabase, retained: UniquePreparationState, catalog: FlarexMetadataTransaction,
) {
  const { snapshot } = retained;
  const closure = yield* readAppUniqueConstraintSetClosureV1Effect(controlDb,
    snapshot.deploymentId, snapshot.schemaVersionId, undefined, catalog);
  if (closure === null || closure.closure.definitionCount !== snapshot.definitionCount ||
    closure.closure.definitionSetSha256Hex !== snapshot.definitionSetSha256Hex ||
    !appUniqueConstraintDefinitionsMatchMembers(retained.definitions, closure.members))
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
  const definitions = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(catalog,
    snapshot.deploymentId, retained.scopeId, snapshot.schemaVersionId, retained.tableIds, snapshot.members.length);
  const originals = new Map(retained.definitions.map(definition => [definition.uniqueConstraintDefinitionId, definition]));
  if (definitions === null || !appUniqueConstraintDefinitionsMatchMembers(definitions, closure.members) ||
    definitions.length !== retained.definitions.length || definitions.some(definition => {
      const original = originals.get(definition.uniqueConstraintDefinitionId);
      return original === undefined || original.logicalUniqueConstraintId !== definition.logicalUniqueConstraintId ||
        original.tableId !== definition.tableId || original.physicalSpecCodecVersion !== definition.physicalSpecCodecVersion ||
        original.physicalSpecBytesHex !== definition.physicalSpecBytesHex || original.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex;
    }))
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
}, work => observeExecution("AppUniqueConstraintSetBuild.validateCatalogSnapshot", work, "caller"));

/** Restore the retained catalog's exact closed set and physical bodies. This
 * grants no eligibility; accepting owners retain all mutable build checks. */
export const validatePreparedAppUniqueConstraintCatalog = Effect.fnUntraced(
  function* (preparation: AppUniqueConstraintSetPreparation, controlDb: FlarexMetadataDatabase,
    reader?: FlarexMetadataTransaction) {
    const retained = uniquePreparations.get(preparation);
    const owner = retained === undefined ? undefined : eligibilityPortStates.get(retained.port);
    if (retained === undefined || owner === undefined || owner.ports.controlDb !== controlDb)
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    const validate = (catalog: FlarexMetadataTransaction) => validateUniqueCatalogSnapshot(controlDb, retained, catalog);
    yield* (reader !== undefined ? validate(reader) :
      runEffectTransaction<Effect.Success<ReturnType<typeof validate>>, Effect.Error<ReturnType<typeof validate>>,
        AppUniqueConstraintSetClosurePersistenceV1Error, FlarexMetadataTransaction>(callback => controlDb.transaction(callback),
        "Prepared unique catalog validation rolled back", validate,
        cause => new AppUniqueConstraintSetClosurePersistenceV1Error({ operation: "readClosureTransaction", cause })));
  }, work => observeExecution("AppUniqueConstraintSetBuild.validatePreparedCatalog", work, "caller"));

/** Lend the exact original located records; no eligibility or target verdict. */
export const lendPreparedAppUniqueConstraintDefinitions = Effect.fnUntraced(
  function* (preparation: AppUniqueConstraintSetPreparation, controlDb: FlarexMetadataDatabase) {
    const state = uniquePreparations.get(preparation);
    const port = state === undefined ? undefined : eligibilityPortStates.get(state.port);
    if (state === undefined || port === undefined || port.ports.controlDb !== controlDb)
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    return state.definitions;
  }, work => observeExecution("AppUniqueConstraintSetBuild.lendPreparedDefinitions", work, "caller"));

/** The caller owns the exact locked clock and accepting target transaction. */
export const acceptPreparedAppUniqueConstraintSet = Effect.fnUntraced(
  function* (port: AppUniqueConstraintSetEligibilityPortV1, preparation: AppUniqueConstraintSetPreparation,
    tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
    progressObservation: "fixed" | "concurrentProgress" = "fixed",
    coverageHint?: IndexCoverageContext) {
    const state = uniquePreparations.get(preparation);
    if (state === undefined || state.port !== port) return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    if (state.scopeId !== authority.scopeId || state.scopeId !== clock.scopeId ||
      state.snapshot.deploymentId !== authority.deploymentId) {
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "scopeMismatch", retryable: false }));
    }
    yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
    if (state.snapshot.members.length === 0) return Object.freeze({ status: "not_required" as const, tableIds: [] as const });
    return yield* inspectEligibilityWithLockedClock(tx, authority, state.snapshot, state.tableIds, clock, port,
      undefined, progressObservation, coverageHint);
  }, work => observeExecution("AppUniqueConstraintSetBuild.acceptPreparedCatalog", work, "caller"));

const inspectSelectedPreparedUniqueCatalog = Effect.fnUntraced(function* (
  state: UniquePreparationState, selection: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  selectedTableIds: readonly CatalogTableId[], tx: AppRowTransaction, authority: TrustedScopeAuthority,
  clock: ScopeClockRecord, coverageHint?: IndexCoverageContext,
) {
  if (state.scopeId !== authority.scopeId || state.scopeId !== clock.scopeId ||
    state.snapshot.deploymentId !== authority.deploymentId)
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "scopeMismatch", retryable: false }));
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const checked = yield* inspectBuildReadinessWithLockedClock(tx, authority, selection, selectedTableIds,
    clock, undefined, "concurrentProgress", coverageHint);
  if (checked.status === "not_ready") return checked;
  return Object.freeze({ status: "ready" as const, definitionCount: selection.members.length });
}, work => observeExecution("AppUniqueConstraintSetBuild.inspectSelectedPreparedCatalog", work, "caller"));

/** Select mutable build checks from the same authenticated complete catalog
 * preparation. Its full canonical closure remains detached under the existing
 * preparation lifetime. No whole-set eligibility evidence is issued. */
export const selectPreparedAppUniqueConstraintSet = Effect.fnUntraced(
  function* (port: AppUniqueConstraintSetEligibilityPortV1, preparation: AppUniqueConstraintSetPreparation,
    tableIds: readonly CatalogTableId[], definitionIds?: readonly CatalogUniqueConstraintDefinitionId[]) {
    const state = uniquePreparations.get(preparation);
    if (state === undefined || state.port !== port)
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
    const tables = new Set(tableIds);
    const members: BuildSnapshot["members"][number][] = [];
    if (definitionIds === undefined) members.push(...state.snapshot.members.filter(member => tables.has(member.tableId)));
    else {
      if (new Set(definitionIds).size !== definitionIds.length)
        return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
      for (const definitionId of definitionIds) {
        const member = state.membersById.get(definitionId);
        if (member === undefined || !tables.has(member.tableId))
          return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
        members.push(member);
      }
    }
    const selection = Object.freeze({ schemaVersionId: state.snapshot.schemaVersionId,
      members: Object.freeze(members) });
    const selectedTableIds = Object.freeze([...new Set(members.map(member => member.tableId))]);
    const inspectSelected = (tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
      coverageHint?: IndexCoverageContext) =>
      inspectSelectedPreparedUniqueCatalog(state, selection, selectedTableIds, tx, authority, clock, coverageHint);
    return Object.freeze({ inspectSelected });
  }, work => observeExecution("AppUniqueConstraintSetBuild.selectPreparedCatalog", work, "caller"));

/** Exact query-selected definitions use the existing build/coverage owner.
 * Complete closure preparation remains with activation and write admission. */
export const inspectSelectedAppUniqueConstraintDefinitions = Effect.fnUntraced(function* (
  input: AppUniqueConstraintSetEligibilityInputV1,
  definitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  tx: AppRowTransaction, authority: TrustedScopeAuthority, clock: ScopeClockRecord,
) {
  if (authority.deploymentId !== input.deploymentId || authority.scopeId !== input.scopeId ||
    definitions.length === 0 || definitions.some(definition => !isLocatedAppUniqueConstraintDefinitionV1(definition) ||
      definition.deploymentId !== input.deploymentId || definition.scopeId !== input.scopeId || definition.schemaVersionId !== input.schemaVersionId))
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const members: BuildSnapshot["members"] = definitions.map(definition => ({
    logicalUniqueConstraintId: definition.logicalUniqueConstraintId,
    uniqueConstraintDefinitionId: definition.uniqueConstraintDefinitionId,
    tableId: definition.tableId, physicalSpecSha256Hex: definition.physicalSpecSha256Hex,
  }));
  const readiness = yield* inspectBuildReadinessWithLockedClock(tx, authority,
    { schemaVersionId: input.schemaVersionId, members }, definitions.map(definition => definition.tableId), clock,
    undefined, "concurrentProgress");
  return readiness.status === "not_ready" ? readiness : Object.freeze({ status: "ready" as const, definitionCount: definitions.length });
}, work => observeExecution("AppUniqueConstraintSetBuild.inspectReadDefinitions", work, "caller"));

const eligibilityEvidencePorts = new WeakMap<
  object,
  AppUniqueConstraintSetEligibilityPortV1
>();

export function createAppUniqueConstraintSetEligibilityPortV1(
  ports: AppUniqueConstraintSetBuildPortsV1,
  uniqueConstraints: AppUniqueConstraintDefinitionPortV1,
): AppUniqueConstraintSetEligibilityPortV1 {
  const controlDb = ports.controlDb;
  const authority = ports.authority;
  const port = Object.freeze({
    [eligibilityPortBrand]: true as const,
  });
  if (
    hasAppUniqueConstraintDefinitionAuthorityForControlDbV1(
      uniqueConstraints,
      controlDb,
    )
  ) {
    eligibilityPortStates.set(
      port,
      Object.freeze({
        ports: Object.freeze({
          controlDb,
          authority,
        }),
        uniqueConstraints,
      }),
    );
  }
  return port;
}

export function hasAppUniqueConstraintSetEligibilityForDefinitionPortV1(
  eligibility: unknown,
  uniqueConstraints: unknown,
): eligibility is AppUniqueConstraintSetEligibilityPortV1 {
  if (typeof eligibility !== "object" || eligibility === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  const state = eligibilityPortStates.get(
    eligibility as AppUniqueConstraintSetEligibilityPortV1,
  );
  return state !== undefined && state.uniqueConstraints === uniqueConstraints;
}

/** Exact readiness composition check; scalar-equivalent catalogs do not pass. */
export function hasAppUniqueConstraintSetEligibilityCompositionV1(
  eligibility: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts,
): eligibility is AppUniqueConstraintSetEligibilityPortV1 {
  if (typeof eligibility !== "object" || eligibility === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  const state = eligibilityPortStates.get(
    eligibility as AppUniqueConstraintSetEligibilityPortV1,
  );
  return (
    state !== undefined &&
    state.ports.controlDb === controlDb &&
    state.ports.authority === authority
  );
}

export function hasAppUniqueConstraintSetEligibilityPortV1(
  value: unknown,
): value is AppUniqueConstraintSetEligibilityPortV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    // SAFETY: the typeof guard above proved the value is a non-null
    // object; the cast only narrows it to the WeakMap's registered brand.
    eligibilityPortStates.has(value as AppUniqueConstraintSetEligibilityPortV1)
  );
}

export function hasAppUniqueConstraintSetEligibilityEvidenceV1(
  value: unknown,
): value is AppUniqueConstraintSetEligibilityEvidenceV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    eligibilityEvidencePorts.has(value)
  );
}

export const loadAppUniqueConstraintSetEligibilityV1Effect = Effect.fn(
  "AppUniqueConstraintSetBuild.loadEligibility",
)(function* (
  port: AppUniqueConstraintSetEligibilityPortV1,
  input: AppUniqueConstraintSetEligibilityInputV1,
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  LoadAppUniqueConstraintSetEligibilityV1Error
> {
  return yield* loadEligibilityWithClockLock(port, input, "update");
});

/** Readiness/replay preparation observes eligibility without writer locking. */
export const loadAppUniqueConstraintSetEligibilityForReadinessV1Effect =
  Effect.fn("AppUniqueConstraintSetBuild.loadEligibilityForReadiness")(
    function* (
      port: AppUniqueConstraintSetEligibilityPortV1,
      input: AppUniqueConstraintSetEligibilityInputV1,
    ): Effect.fn.Return<
      AppUniqueConstraintSetEligibilityResultV1,
      LoadAppUniqueConstraintSetEligibilityV1Error
    > {
      return yield* loadEligibilityWithClockLock(port, input, "snapshotRead");
    },
  );

const loadEligibilityWithClockLock = Effect.fn(
  "AppUniqueConstraintSetBuild.loadEligibilityWithClockLock",
)(function* (
  port: AppUniqueConstraintSetEligibilityPortV1,
  input: AppUniqueConstraintSetEligibilityInputV1,
  clockLock: "snapshotRead" | "update",
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  LoadAppUniqueConstraintSetEligibilityV1Error
> {
  const state = eligibilityPortStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetEligibilityV1Error({
        reason: "invalidPort",
        retryable: false,
      }),
    );
  }
  const ports = state.ports;
  const planned = yield* prepareAppUniqueConstraintSet(port, input);
  if (planned.status === "not_ready") return planned;
  const prepared = uniquePreparations.get(planned.preparation);
  if (prepared === undefined) return yield* Effect.die("Missing issued unique-set preparation");
  if (prepared.snapshot.members.length === 0) return Object.freeze({ status: "not_required" as const, tableIds: [] as const });
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: prepared.snapshot.deploymentId, scopeId: prepared.scopeId },
    {
      ...ports.authority,
      ...makeInstallationProtectedScopeAuthorityControlReader(ports.controlDb),
    },
  );
  if (located.authority.scopeId !== prepared.scopeId) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetEligibilityV1Error({
        reason: "scopeMismatch",
        retryable: false,
      }),
    );
  }
  const { snapshot, tableIds } = prepared;
  return yield* runEligibilityTransaction(
    port,
    located.target,
    located.authority,
    snapshot,
    tableIds,
    clockLock,
  );
});

export type AppUniqueConstraintSetBuildFaultPointV1 =
  | "afterBuildInsert"
  | "afterStaleBuildRedeclare"
  | "afterInitialClaimDrain"
  | "afterBackfillClaim"
  | "afterBackfillLifecycleTransition"
  | "afterValidationRow"
  | "beforeEnable"
  | "afterValidationLifecycleTransition"
  | "afterWorkspaceDelete";

export interface AppUniqueConstraintSetBuildOptionsV1 {
  readonly faultAfter?: (
    point: AppUniqueConstraintSetBuildFaultPointV1,
  ) => void;
}

export type ReconcileAppUniqueConstraintSetBuildV1Result =
  | Readonly<{
      readonly status: "absent";
      readonly reason: "setNotClosed";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly schemaVersionId: CatalogSchemaVersionId;
    }>
  | Readonly<{
      readonly status: "reconciled";
      readonly disposition:
        | "created"
        | "replayed"
        | "redeclared"
        | "replayedAfterUncertainCompletion";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly definitionCount: number;
      readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
      readonly definitionBuilds: ReadonlyArray<AppUniqueConstraintBuildIdentity>;
    }>;

export interface AdvanceAppUniqueConstraintSetBackfillV1Result {
  readonly status: "advanced" | "replayed";
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly lifecycle: "building" | "backfilling" | "validating" | "enabled";
  readonly scanned: number;
  readonly claimed: number;
  readonly replayed: number;
  readonly omitted: number;
  readonly uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionId | null;
  readonly cursorRowId: AppRowIdHexV1 | null;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1 | null;
}

export class InvalidAppUniqueConstraintSetBuildInputV1Error extends Data.TaggedError(
  "InvalidAppUniqueConstraintSetBuildInputV1Error",
)<{
  readonly reason:
    "invalidInputShape" | "invalidDeploymentId" | "invalidScopeId" | "invalidSchemaVersionId";
}> {}

export class AppUniqueConstraintSetBuildStaleAuthorityV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetBuildStaleAuthorityV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly reason: "storageGeneration" | "storageGenerationFence" | "epoch";
}> {}

export class AppUniqueConstraintSetBuildStateV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetBuildStateV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly reason:
    | "storedStateInvalid"
    | "definitionSetMismatch"
    | "frontierAheadOfClock"
    | "attemptFenceExhausted"
    | "concurrentStateChange"
    | "buildMissing"
    | "definitionAuthorityMismatch"
    | "backfillCursorInvalid"
    | "loweringInvalid"
    | "validationMismatch"
    | "coverageMissing"
    | "historyGap"
    | "catchUpLimit"
    | "physicalDefinitionInactive";
  readonly cause?: unknown;
}> {}

export class AppUniqueConstraintSetBuildIntegrationV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetBuildIntegrationV1Error",
)<{
  readonly phase: "targetTransaction";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

export class AppUniqueConstraintSetBuildDecisionUncertainV1Error extends Data.TaggedError(
  "AppUniqueConstraintSetBuildDecisionUncertainV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly cause: unknown;
}> {}

export type ReconcileAppUniqueConstraintSetBuildV1Error =
  | InvalidAppUniqueConstraintSetBuildInputV1Error
  | AppUniqueConstraintSetBuildDirectoryV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

export type AdvanceAppUniqueConstraintSetBackfillV1Error =
  | InvalidAppUniqueConstraintSetBuildInputV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | ReadAppUniqueConstraintSetClosureV1Error
  | ReadAppUniqueConstraintDefinitionV1Error
  | ReadAppRowError
  | EnsureAppUniqueKeyBackfillClaimV1Error
  | ValidateAppUniqueKeyClaimV1Error
  | ApplyAppUniqueKeyMutationV1Error
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

interface BuildSnapshot {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly definitionCount: number;
  readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
  readonly members: LocatedAppUniqueConstraintSetClosureV1["members"];
}

interface ReclamationSnapshot extends BuildSnapshot {
  readonly protection: {
    readonly heads: Effect.Success<ReturnType<typeof readProtectionHeads>>;
    readonly protectedDefinitionIds: ReadonlySet<CatalogUniqueConstraintDefinitionId> | null;
    readonly replacingCandidate: boolean;
  };
}

const BuildStateSchema = Schema.Struct({
  scopeId: ScopeIdSchema,
  uniqueConstraintDefinitionId: CatalogUniqueConstraintDefinitionIdSchema,
  startCommitSeq: CommitSeqSchema,
  coveredThroughCommitSeq: Schema.NullOr(CommitSeqSchema),
  maintenanceActivationSequence: Schema.NullOr(Schema.BigInt),
  maintenanceAuthorityKind: Schema.NullOr(Schema.Literals(["application", "binding"])),
  maintenanceObligation: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
  attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1Schema,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: StorageGenerationFenceSchema,
  epoch: ScopeEpochSchema,
  lifecycle: AppUniqueConstraintSetBuildLifecycleV1Schema,
  cursorRowId: Schema.NullOr(
    Schema.Uint8Array.check(
      Schema.makeFilter((value) => value.byteLength === 16),
    ),
  ),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
type BuildState = Omit<typeof BuildStateSchema.Type, "maintenanceObligation"> & { readonly maintenance: UniqueMaintenanceObligation | null };
const decodeBuildState = Schema.decodeUnknownEffect(
  Schema.toType(BuildStateSchema),
);

export type UniqueConstraintBuildStateRow = typeof fxSystemUniqueConstraintBuilds.$inferSelect & Readonly<{
  maintenanceObligation: typeof fxSystemUniqueMaintenanceObligations.$inferSelect | null;
}>;
export function uniqueConstraintBuildStateSelection() {
  return { ...getTableColumns(fxSystemUniqueConstraintBuilds), maintenanceObligation: getTableColumns(fxSystemUniqueMaintenanceObligations) };
}
export function uniqueMaintenanceBindingPredicate() {
  return and(eq(fxSystemUniqueConstraintBuilds.maintenanceAuthorityKind, fxSystemUniqueMaintenanceObligations.authorityKind), eq(fxSystemUniqueConstraintBuilds.scopeId, fxSystemUniqueMaintenanceObligations.scopeId),
    eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, fxSystemUniqueMaintenanceObligations.uniqueConstraintDefinitionId),
    eq(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence, fxSystemUniqueMaintenanceObligations.activationSequence));
}

const decodeMaintenancePublisherCounts = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({
  closedCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  openedCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})]));
const decodeMaintenancePublisherRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  domain: Schema.Literal("unique"), reason: Schema.Literals(["storedState", "unavailable"]),
})), { onExcessProperty: "error" });

/** Called only through the activation owner's transaction-bound catalog reader. */
export const readUniqueMaintenanceRequirements = Effect.fn("AppUniqueConstraintBuild.readMaintenanceRequirements")(
  function* (db: FlarexMetadataDatabase, deploymentId: string, schemaVersionId: string, reader?: FlarexMetadataTransaction) {
    const id = yield* Effect.fromResult(decodeSchemaVersionIdResult(schemaVersionId))
      .pipe(Effect.mapError(cause => new UniqueMaintenanceError({ reason: "storedState", cause })));
    const closure = yield* readAppUniqueConstraintSetClosureV1Effect(db, deploymentId, id, undefined, reader).pipe(Effect.mapError(cause => {
      if (cause instanceof AppUniqueConstraintSetClosurePersistenceV1Error || cause instanceof AppUniqueConstraintCatalogPersistenceError) {
        const providerCause = cause.cause instanceof DrizzleQueryError ? cause.cause.cause : cause.cause;
        return new UniqueMaintenanceError({ reason: "resourceFailure", retryable: isRetryableSqlTransactionCause(providerCause), cause });
      }
      return new UniqueMaintenanceError({ reason: cause instanceof AppUniqueConstraintSetClosureResourceError
        ? "resourceFailure" : "storedState", retryable: false, cause });
    }));
    if (closure === null) return yield* Effect.fail(new UniqueMaintenanceError({ reason: "unavailable" }));
    return closure;
  },
);
export type ReadUniqueMaintenanceRequirements = (schemaVersionId: string) => ReturnType<typeof readUniqueMaintenanceRequirements>;

function uniqueMaintenancePublisherMembers(requirements: Effect.Success<ReturnType<typeof readUniqueMaintenanceRequirements>> | null) {
  return JSON.stringify((requirements?.members ?? [])
    .toSorted((left, right) => left.uniqueConstraintDefinitionId - right.uniqueConstraintDefinitionId).map(member => ({
      definitionId: member.uniqueConstraintDefinitionId, tableId: member.tableId, physicalSpecSha256: member.physicalSpecSha256Hex,
    })));
}

/** Open/carry/close obligations in the same scope transaction as the active head. */
export const replaceActiveUniqueMaintenanceInTransactionEffect = Effect.fn("AppUniqueConstraintBuild.replaceActiveMaintenance")(
  function* (tx: AppRowTransaction, clock: ScopeClockRecord, readRequirements: ReadUniqueMaintenanceRequirements,
    deploymentId: string, schemaVersionId: string, activationSequence: bigint, activationSha256: Uint8Array, headSha256: Uint8Array) {
    const context = yield* readIndexCoverageContextInTransactionEffect(tx, clock);
    const incoming = yield* readRequirements(schemaVersionId);
    if (incoming.closure.deploymentId !== deploymentId || incoming.closure.schemaVersionId !== schemaVersionId) {
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    }
    const outgoing = context.active === null ? null : yield* readRequirements(context.active.schema.schemaVersionId);
    if (outgoing !== null && (outgoing.closure.deploymentId !== deploymentId || context.active?.schema.deploymentId !== deploymentId)) {
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    }
    const activeRows = yield* queryEffect(tx.select({ id: fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId })
      .from(fxSystemUniqueConstraintBuilds).where(and(eq(fxSystemUniqueConstraintBuilds.scopeId, clock.scopeId),
        eq(fxSystemUniqueConstraintBuilds.maintenanceAuthorityKind, "application"), isNotNull(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence))).limit(MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1 + 1));
    if (activeRows.length > MAX_APP_UNIQUE_CONSTRAINT_SET_MEMBERS_V1) return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    const incomingMembers = new Map(incoming.members.map(member => [member.uniqueConstraintDefinitionId, member]));
    const outgoingMembers = new Map(outgoing?.members.map(member => [member.uniqueConstraintDefinitionId, member]));
    const ids = [...new Set([...incomingMembers.keys(), ...activeRows.map(row => row.id)])].toSorted((a, b) => a - b);
    const allMembers = new Map([...outgoingMembers, ...incomingMembers]);
    const snapshot = { schemaVersionId: incoming.closure.schemaVersionId, members: [...allMembers.values()] };
    const rows = ids.length === 0 ? [] : yield* queryEffect(tx.select(uniqueConstraintBuildStateSelection()).from(fxSystemUniqueConstraintBuilds)
      .leftJoin(fxSystemUniqueMaintenanceObligations, uniqueMaintenanceBindingPredicate()).where(and(
      eq(fxSystemUniqueConstraintBuilds.scopeId, clock.scopeId), inArray(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, ids),
    )).orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId).for("update", { of: fxSystemUniqueConstraintBuilds }));
    if (rows.length !== ids.length) return yield* Effect.fail(new UniqueMaintenanceError({ reason: "unavailable" }));
    const states: BuildState[] = [];
    for (const row of rows) {
      const state = yield* decodeUniqueBuildStateEffect(clock, snapshot, row, clock.lastCommitSeq);
      if (state.lifecycle !== "enabled" || !buildAuthorityIsCurrent(state, clock)) {
        return yield* Effect.fail(new UniqueMaintenanceError({ reason: "unavailable" }));
      }
      if (state.maintenance !== null) {
        if (state.maintenance.authorityKind !== "application") return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
        const member = outgoingMembers.get(state.uniqueConstraintDefinitionId);
        if (member === undefined || outgoing === null ||
          !(yield* inspectDefinitionCoverageEffect(tx, clock, { schemaVersionId: outgoing.closure.schemaVersionId, members: outgoing.members }, state, member.tableId, clock, context))) {
          return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
        }
      }
      const member = incomingMembers.get(state.uniqueConstraintDefinitionId);
      if (member !== undefined && !(yield* inspectDefinitionCoverageEffect(tx, clock, snapshot, state, member.tableId, clock, context))) {
        return yield* Effect.fail(new UniqueMaintenanceError({ reason: "unavailable" }));
      }
      states.push(state);
    }
    const written = yield* runDrizzleStatementEffect(tx.select({ closedCount: sql<number>`written.closed_count`,
      openedCount: sql<number>`written.opened_count` }).from(sql`fx_replace_active_unique_maintenance(
        ${clock.scopeId}::text,
        ${sql.param(context.active?.head.activationSequence ?? null, fxSystemApplicationActivations.activationSequence)}::bigint,
        ${sql.param(context.active?.head.headSha256 ?? null, fxSystemApplicationActiveHeads.headSha256)}::bytea,
        ${sql.param(activationSequence, fxSystemApplicationActivations.activationSequence)}::bigint,
        ${sql.param(activationSha256, fxSystemApplicationActivations.activationSha256)}::bytea,
        ${sql.param(headSha256, fxSystemApplicationActiveHeads.headSha256)}::bytea,
        ${outgoing?.closure.deploymentId ?? null}::text, ${outgoing?.closure.schemaVersionId ?? null}::text,
        ${uniqueMaintenancePublisherMembers(outgoing)}::jsonb, ${incoming.closure.deploymentId}::text, ${incoming.closure.schemaVersionId}::text,
        ${uniqueMaintenancePublisherMembers(incoming)}::jsonb) as written`), uniqueMaintenancePublisherFailure);
    const [counts] = yield* decodeMaintenancePublisherCounts(written).pipe(Effect.mapError(cause => new UniqueMaintenanceError({ reason: "storedState", cause })));
    if (counts.openedCount !== incoming.members.length || counts.closedCount + counts.openedCount !== states.length)
      return yield* Effect.fail(new UniqueMaintenanceError({ reason: "storedState" }));
    return counts;
  },
);

function uniqueMaintenancePublisherFailure(cause: unknown): UniqueMaintenanceError {
  const detail = applicationDomainFailureDetail(cause, "fx_replace_active_unique_maintenance");
  if (detail !== null) return Result.match(decodeMaintenancePublisherRefusal(detail), {
    onFailure: () => new UniqueMaintenanceError({ reason: "resourceFailure", cause }),
    onSuccess: refusal => new UniqueMaintenanceError({ reason: refusal.reason, cause }),
  });
  const provider = cause instanceof DrizzleQueryError ? cause.cause : cause;
  return new UniqueMaintenanceError({ reason: "resourceFailure", retryable: isRetryableSqlTransactionCause(provider), cause });
}

export const reconcileAppUniqueConstraintSetBuildV1Effect = Effect.fn(
  "AppUniqueConstraintSetBuild.reconcile",
)(function* (
  ports: AppUniqueConstraintSetBuildPortsV1,
  input: unknown,
  options: AppUniqueConstraintSetBuildOptionsV1 = {},
): Effect.fn.Return<
  ReconcileAppUniqueConstraintSetBuildV1Result,
  ReconcileAppUniqueConstraintSetBuildV1Error
> {
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const locatedClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    ports.controlDb,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (locatedClosure === null) {
    return Object.freeze({
      status: "absent" as const,
      reason: "setNotClosed" as const,
      ...decoded,
    });
  }
  const snapshot = buildSnapshot(decoded, locatedClosure);
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...ports.authority, ...makeInstallationProtectedScopeAuthorityControlReader(ports.controlDb) },
  );
  return yield* runReconciliationTransaction(
    located.target,
    located.authority,
    snapshot,
    options,
  );
});

export const advanceAppUniqueConstraintSetBackfillV1Effect = Effect.fn(
  "AppUniqueConstraintSetBuild.advanceBackfill",
)(function* (
  ports: AppUniqueConstraintSetBuildPortsV1,
  input: unknown,
  options: AppUniqueConstraintSetBuildOptionsV1 = {},
): Effect.fn.Return<
  AdvanceAppUniqueConstraintSetBackfillV1Result,
  AdvanceAppUniqueConstraintSetBackfillV1Error
> {
  const decoded = yield* Effect.fromResult(decodeBackfillInputResult(input));
  const locatedClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    ports.controlDb,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...ports.authority, ...makeInstallationProtectedScopeAuthorityControlReader(ports.controlDb) },
  );
  if (locatedClosure === null) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildStateV1Error({
        scopeId: located.authority.scopeId,
        schemaVersionId: decoded.schemaVersionId,
        reason: "definitionAuthorityMismatch",
      }),
    );
  }
  const snapshot = buildSnapshot(decoded, locatedClosure);
  const tableIds = [
    ...new Set(locatedClosure.members.map((member) => member.tableId)),
  ].toSorted((left, right) => left - right);
  const definitions = yield* runEffectTransaction<Effect.Success<ReturnType<typeof locateAppUniqueConstraintDefinitionsForSchemaEffect>>,
    Effect.Error<ReturnType<typeof locateAppUniqueConstraintDefinitionsForSchemaEffect>>, AppUniqueConstraintCatalogPersistenceError,
    FlarexMetadataTransaction>(callback => ports.controlDb.transaction(callback),
    "Unique build definition acquisition rolled back", tx => locateAppUniqueConstraintDefinitionsForSchemaEffect(
      tx,
      decoded.deploymentId,
      located.authority.scopeId,
      decoded.schemaVersionId,
      tableIds,
      locatedClosure.members.length,
    ), cause => new AppUniqueConstraintCatalogPersistenceError({ operation: "locateBuildDefinitions", cause }));
  if (
    definitions === null ||
    !appUniqueConstraintDefinitionsMatchMembers(definitions, locatedClosure.members)
  ) {
    return yield* Effect.fail(
      stateError(located.authority, snapshot, "definitionAuthorityMismatch"),
    );
  }
  return yield* runBackfillTransaction(
    located.target,
    located.authority,
    snapshot,
    definitions,
    decoded.pageSize,
    options,
  );
});

/**
 * Reclaims one exact non-enabled build-workspace row. This operation never
 * retires definitions or deletes claims, sidecars, app rows, or immutable
 * readiness/activation evidence.
 */
export const reclaimSupersededAppUniqueConstraintSetBuildEffect = Effect.fn(
  "AppUniqueConstraintSetBuild.reclaimSupersededWorkspace",
)(function* (
  port: AppUniqueConstraintSetEligibilityPortV1,
  input: unknown,
  options: AppUniqueConstraintSetBuildOptionsV1 = {},
): Effect.fn.Return<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  ReclaimSupersededAppUniqueConstraintSetBuildError
> {
  const decoded = yield* Effect.fromResult(decodeInputResult(input));
  const state = eligibilityPortStates.get(port);
  if (state === undefined) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildReclamationError({
        deploymentId: decoded.deploymentId,
        schemaVersionId: decoded.schemaVersionId,
        reason: "invalidPort",
        retryable: false,
      }),
    );
  }
  const locatedClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    state.ports.controlDb,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (locatedClosure === null) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildReclamationError({
        deploymentId: decoded.deploymentId,
        schemaVersionId: decoded.schemaVersionId,
        reason: "schemaAuthorityMissing",
        retryable: false,
      }),
    );
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...state.ports.authority, ...makeInstallationProtectedScopeAuthorityControlReader(state.ports.controlDb) },
  );
  const snapshot = yield* prepareReclamationSnapshot(
    state.ports,
    located.target,
    located.authority,
    buildSnapshot(decoded, locatedClosure),
  );
  return yield* runWorkspaceReclamationTransaction(
    located.target,
    located.authority,
    snapshot,
    options,
  );
});

/**
 * Private M05-A2 composition. The exact candidate observed before the write is
 * authenticated again under the target scope lock, then its rebuildable
 * unique-set workspace is reclaimed in the same transaction that installs the
 * replacement candidate.
 */
export const installAppSchemaCandidateWithWorkspaceReclamationEffect =
  Effect.fn("AppUniqueConstraintSetBuild.installCandidateWithReclamation")(
    function* (
      port: AppUniqueConstraintSetEligibilityPortV1,
      candidateValidation: AppSchemaCandidateValidationPort,
      input: unknown,
      options: InstallAppSchemaCandidateWithWorkspaceReclamationOptions = {},
    ): Effect.fn.Return<
      InstallAppSchemaCandidateWithWorkspaceReclamationResult,
      InstallAppSchemaCandidateWithWorkspaceReclamationError
    > {
      const decoded = yield* Effect.fromResult(decodeInputResult(input));
      const state = eligibilityPortStates.get(port);
      if (
        state === undefined ||
        !hasAppSchemaCandidateValidationComposition(
          candidateValidation,
          state.ports.controlDb,
          state.ports.authority,
        )
      ) {
        return yield* Effect.fail(
          new AppUniqueConstraintSetBuildReclamationError({
            deploymentId: decoded.deploymentId,
            schemaVersionId: decoded.schemaVersionId,
            reason: "invalidPort",
            retryable: false,
          }),
        );
      }
      const prepared = yield* prepareAppSchemaCandidateValidationInstallEffect(
        candidateValidation,
        decoded,
      );
      const claimedCurrent =
        yield* claimCurrentAppSchemaCandidateValidationHeadEffect(
          candidateValidation,
          prepared,
        );
      const current = claimedCurrent.head;
      const displacedSchemaVersionId =
        current !== null && current.schemaVersionId !== decoded.schemaVersionId
          ? current.schemaVersionId
          : null;
      const displacedClosure =
        displacedSchemaVersionId === null
          ? null
          : yield* readAppUniqueConstraintSetClosureV1Effect(
              state.ports.controlDb,
              decoded.deploymentId,
              displacedSchemaVersionId,
            );
      const displacedSnapshot =
        displacedClosure === null || displacedSchemaVersionId === null
          ? null
          : yield* prepareReclamationSnapshot(
              state.ports,
              claimedCurrent.target,
              claimedCurrent.authority,
              buildSnapshot(
                {
                  deploymentId: decoded.deploymentId,
                  scopeId: decoded.scopeId,
                  schemaVersionId: displacedSchemaVersionId,
                },
                displacedClosure,
              ),
              decoded.schemaVersionId,
            );
      return yield* runCandidateSupersessionReclamationTransaction(
        claimedCurrent.target,
        claimedCurrent.authority,
        candidateValidation,
        prepared,
        claimedCurrent.claim,
        displacedSchemaVersionId,
        displacedSnapshot,
        options,
      );
    },
  );

function decodeInputResult(input: unknown) {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(
        new InvalidAppUniqueConstraintSetBuildInputV1Error({
          reason: "invalidInputShape",
        }),
      );
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(
        new InvalidAppUniqueConstraintSetBuildInputV1Error({
          reason: "invalidDeploymentId",
        }),
      );
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(
      Result.mapError(
        () =>
          new InvalidAppUniqueConstraintSetBuildInputV1Error({
            reason: "invalidSchemaVersionId",
          }),
      ),
    );
    const scopeId = yield* decodeScopeIdResult(input.scopeId).pipe(
      Result.mapError(() => new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidScopeId",
      })),
    );
    return Object.freeze({
      deploymentId: input.deploymentId,
      scopeId,
      schemaVersionId,
    });
  });
}

function decodeBackfillInputResult(input: unknown) {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, BACKFILL_INPUT_KEYS)) {
      return yield* Result.fail(
        new InvalidAppUniqueConstraintSetBuildInputV1Error({
          reason: "invalidInputShape",
        }),
      );
    }
    const decoded = yield* decodeInputResult({
      deploymentId: input.deploymentId,
      scopeId: input.scopeId,
      schemaVersionId: input.schemaVersionId,
    });
    const pageSize = input.pageSize;
    if (
      typeof pageSize !== "number" ||
      !Number.isSafeInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_APP_UNIQUE_CONSTRAINT_SET_BACKFILL_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(
        new InvalidAppUniqueConstraintSetBuildInputV1Error({
          reason: "invalidInputShape",
        }),
      );
    }
    return Object.freeze({ ...decoded, pageSize });
  });
}

function buildSnapshot(
  input: ReconcileAppUniqueConstraintSetBuildV1Input,
  locatedClosure: LocatedAppUniqueConstraintSetClosureV1,
): BuildSnapshot {
  return Object.freeze({
    ...input,
    definitionCount: locatedClosure.closure.definitionCount,
    definitionSetSha256Hex: locatedClosure.closure.definitionSetSha256Hex,
    members: locatedClosure.members,
  });
}

function uniqueConstraintTableIds(
  closure: LocatedAppUniqueConstraintSetClosureV1,
): ReadonlyArray<CatalogTableId> {
  return Object.freeze(
    [...new Set(closure.members.map((member) => member.tableId))].toSorted(
      (left, right) => left - right,
    ),
  );
}

const runEligibilityTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runEligibilityTransaction",
)(function* (
  port: AppUniqueConstraintSetEligibilityPortV1,
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  tableIds: ReadonlyArray<CatalogTableId>,
  clockLock: "snapshotRead" | "update",
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  | AppUniqueConstraintSetEligibilityV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | LockScopeClockForUpdateError
> {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set eligibility inspection rolled back.",
    (tx) =>
      inspectEligibilityInTransaction(
        tx,
        port,
        authority,
        snapshot,
        tableIds,
        clockLock,
      ),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (failure._tag === "None") return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  )
    return yield* Effect.failCause(callbackCause);
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  )
    return yield* Effect.failCause(
      Cause.combine(
        callbackCause,
        Cause.die(
          new AppUniqueConstraintSetEligibilityV1Error({
            reason: "targetTransaction",
            retryable: false,
            cause,
          }),
        ),
      ),
    );
  return yield* Effect.fail(
    new AppUniqueConstraintSetEligibilityV1Error({
      reason: "targetTransaction",
      retryable:
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind !== "decisionUncertain",
      cause,
    }),
  );
});

const inspectEligibilityInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.inspectEligibilityInTransaction",
)(function* (
  tx: AppRowTransaction,
  port: AppUniqueConstraintSetEligibilityPortV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  tableIds: ReadonlyArray<CatalogTableId>,
  clockLock: "snapshotRead" | "update",
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | LockScopeClockForUpdateError
> {
  const clock = yield* clockLock === "snapshotRead"
    ? lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId)
    : lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId);
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  if (clockLock !== "snapshotRead") {
    return yield* inspectEligibilityWithLockedClock(
      tx, authority, snapshot, tableIds, clock, port,
    );
  }
  let observed = clock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inspection = yield* inspectEligibilityWithLockedClock(
      tx, authority, snapshot, tableIds, observed, port, undefined,
      "concurrentProgress",
    );
    const after = yield* lockScopeClockForSnapshotReadInTransactionEffect(
      tx, authority.scopeId,
    );
    yield* Effect.fromResult(requireExactAuthorityResult(authority, after));
    if (after.lastCommitSeq === observed.lastCommitSeq) return inspection;
    observed = after;
  }
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable: true,
    cause: new Error("Unique readiness clock advanced during bounded inspection."),
  }));
});

/**
 * Package-private C08-B1 replay validator. The caller must already hold the
 * scope-clock lock in its owning target transaction.
 */
export const validateAppUniqueConstraintSetEligibilityEvidenceInTransactionV1Effect =
  Effect.fn(
    "AppUniqueConstraintSetBuild.validateEligibilityEvidenceInTransaction",
  )(function* (
    tx: AppRowTransaction,
    port: AppUniqueConstraintSetEligibilityPortV1,
    evidence: AppUniqueConstraintSetEligibilityEvidenceV1,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    | AppUniqueConstraintSetEligibilityV1Error
    | AppUniqueConstraintSetBuildStaleAuthorityV1Error
    | AppUniqueConstraintSetBuildIntegrationV1Error
    | AppUniqueConstraintSetBuildStateV1Error
  > {
    const state = eligibilityPortStates.get(port);
    if (
      state === undefined ||
      eligibilityEvidencePorts.get(evidence) !== port
    ) {
      return yield* Effect.fail(
        new AppUniqueConstraintSetEligibilityV1Error({
          reason: "invalidPort",
          retryable: false,
        }),
      );
    }
    if (
      evidence.scopeId !== authority.scopeId ||
      evidence.storageGeneration !== authority.storageGeneration ||
      evidence.storageGenerationFence !== authority.storageGenerationFence ||
      evidence.epoch !== authority.epoch ||
      evidence.scopeId !== clock.scopeId
    ) {
      return yield* Effect.fail(
        new AppUniqueConstraintSetEligibilityV1Error({
          reason: "scopeMismatch",
          retryable: false,
        }),
      );
    }
    yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
    return yield* inspectEligibilityWithLockedClock(
      tx,
      authority,
      eligibilityEvidenceSnapshots.get(evidence)!.snapshot,
      evidence.tableIds,
      clock,
      port,
      evidence,
    );
  });

const inspectEligibilityWithLockedClock = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  tableIds: ReadonlyArray<CatalogTableId>,
  clock: ScopeClockRecord,
  port: AppUniqueConstraintSetEligibilityPortV1,
  expectedEvidence?: AppUniqueConstraintSetEligibilityEvidenceV1,
  progressObservation: "fixed" | "concurrentProgress" = "fixed",
  coverageHint?: IndexCoverageContext,
) {
  const readiness = yield* inspectBuildReadinessWithLockedClock(tx, authority, snapshot, tableIds,
    clock, expectedEvidence, progressObservation, coverageHint);
  if (readiness.status === "not_ready") return readiness;
  const { identities, observedClock } = readiness;
  if (expectedEvidence !== undefined)
    return Object.freeze({
      status: "eligible" as const,
      evidence: expectedEvidence,
    });
  const evidence: AppUniqueConstraintSetEligibilityEvidenceV1 = Object.freeze({
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    definitionCount: snapshot.definitionCount,
    definitionSetSha256Hex: snapshot.definitionSetSha256Hex,
    tableIds,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: observedClock.storageGenerationFence,
    epoch: authority.epoch,
    definitionBuilds: Object.freeze(identities),
    [eligibilityEvidenceBrand]: true as const,
  });
  eligibilityEvidencePorts.set(evidence, port);
  eligibilityEvidenceSnapshots.set(evidence, { snapshot, tx, clock: { ...observedClock, updatedAt: new Date(observedClock.updatedAt.getTime()) } });
  return Object.freeze({ status: "eligible" as const, evidence });
}, work => observeExecution("AppUniqueConstraintSetBuild.inspectEligibilityWithLockedClock", work, "caller"));

const decodeNativeUniqueCapture=Schema.decodeUnknownEffect(Schema.Struct({
  reason:Schema.Literals(["captured","invalid"]),definitionId:Schema.NullOr(CatalogUniqueConstraintDefinitionIdSchema),
  progress:Schema.NullOr(Schema.String),rowCount:Schema.NullOr(Schema.String),hasMaintenance:Schema.NullOr(Schema.Boolean),
}));
const OrdinaryUniqueProgressSchema = Schema.Tuple([
  Schema.Boolean, AppUniqueConstraintSetBuildLifecycleV1Schema, CommitSeqSchema,
  Schema.NullOr(CommitSeqSchema), AppUniqueConstraintSetBuildAttemptFenceV1Schema,
  Schema.NullOr(Schema.Boolean), Schema.NullOr(Schema.String),
]).check(Schema.makeFilter(state =>
  (state[3] === null || state[3] >= state[2]) &&
  ((state[1] !== "declared" && state[1] !== "building") || state[3] === null) &&
  (state[1] !== "enabled" || state[3] !== null) &&
  (state[5] === null) === (state[6] === null) ? undefined : "Invalid captured unique progress"));
const decodeOrdinaryUniqueProgressEnvelope = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));
const decodeOrdinaryUniqueProgress = Schema.decodeUnknownResult(OrdinaryUniqueProgressSchema);
const OrdinaryUniqueMaintenanceKeySchema = Schema.Tuple([
  Schema.NonEmptyString, Schema.NonEmptyString,
  CommitSeqSchema.check(Schema.makeFilter(value => value > 0n ? undefined : "Expected positive activation sequence")),
  Schema.String, Schema.String, Schema.Literals(["application", "binding"]), Schema.NullOr(Schema.String), Schema.NullOr(Schema.String),
]);
const decodeOrdinaryUniqueMaintenanceKey = Schema.decodeUnknownResult(Schema.fromJsonString(OrdinaryUniqueMaintenanceKeySchema));
type UniqueBuildReadinessResult=Readonly<{status:"ready";identities:readonly AppUniqueConstraintBuildIdentity[];observedClock:ScopeClockRecord}>|
  Readonly<{status:"not_ready";reason:"buildMissing"|"buildStale"|"buildNotEnabled";blocksAllTables:false;
    tableIds:readonly CatalogTableId[];lifecycle?:BuildState["lifecycle"]}>;
type UniqueBuildReadinessError=AppUniqueConstraintSetBuildIntegrationV1Error|AppUniqueConstraintSetBuildStateV1Error;

const inspectBuildReadinessWithLockedClock=Effect.fnUntraced(function* (
  tx:AppRowTransaction,authority:TrustedScopeAuthority,snapshot:Pick<BuildSnapshot,"schemaVersionId"|"members">,
  tableIds:readonly CatalogTableId[],clock:ScopeClockRecord,expectedEvidence?:AppUniqueConstraintSetEligibilityEvidenceV1,
  progressObservation:"fixed"|"concurrentProgress"="fixed",coverageHint?:IndexCoverageContext,
):Effect.fn.Return<UniqueBuildReadinessResult,UniqueBuildReadinessError> {
  const rows=yield* queryEffect(prepareUniqueReadinessCapture(tx,clock,snapshot.members,
    progressObservation==="concurrentProgress" ? "key share":"share"));
  const header=yield* decodeNativeUniqueCapture(rows[0]).pipe(Effect.mapError(cause=>stateError(authority,snapshot,"storedStateInvalid",cause)));
  const rowCount=header.rowCount===null ? -1:Number(header.rowCount);
  if (header.reason!=="captured" || header.definitionId!==null || header.progress===null || header.hasMaintenance===null ||
    !Number.isSafeInteger(rowCount) || rowCount<0 || rowCount>snapshot.members.length || String(rowCount)!==header.rowCount)
    return yield* Effect.fail(stateError(authority,snapshot,"storedStateInvalid"));
  const capture=header.progress;
  let previousDefinitionId=0;
  const rawById=new Map<CatalogUniqueConstraintDefinitionId,typeof rows[number]>();
  for (const raw of rows.slice(1)) {
    const member=yield* decodeNativeUniqueCapture(raw).pipe(Effect.mapError(cause=>stateError(authority,snapshot,"storedStateInvalid",cause)));
    if (member.reason!=="invalid" || member.definitionId===null || member.definitionId<=previousDefinitionId || member.progress!==null ||
      member.rowCount!==null || member.hasMaintenance!==null || !snapshot.members.some(value=>value.uniqueConstraintDefinitionId===member.definitionId))
      return yield* Effect.fail(stateError(authority,snapshot,"storedStateInvalid"));
    rawById.set(member.definitionId,raw);previousDefinitionId=member.definitionId;
  }
  // Keep unique's own actual post-lock clock, even when index acceptance lent a
  // prior context. The first intrinsic rejection precedes context construction.
  const observedClock=progressObservation==="concurrentProgress" ? yield* observeSelectedBuildClock(tx,clock,snapshot):clock;
  const captured = yield* Effect.fromResult(decodeOrdinaryUniqueProgressEnvelope(capture).pipe(
    Result.mapError(cause => stateError(authority,snapshot,"storedStateInvalid",cause))));
  const ids = Object.keys(captured).map(id => Number(id)).toSorted((left,right) => left-right);
  if (ids.length !== rowCount || Object.keys(captured).some(key => String(Number(key)) !== key) ||
    ids.some(id => !Number.isSafeInteger(id) || id < 1 ||
    !Object.hasOwn(captured,String(id)) || !snapshot.members.some(member => member.uniqueConstraintDefinitionId === id)))
    return yield* Effect.fail(stateError(authority,snapshot,"storedStateInvalid"));
  const intrinsic = yield* Effect.fromResult(Result.gen(function* () {
    const progress=new Map<number,typeof OrdinaryUniqueProgressSchema.Type>();
    for (const id of ids) {
      const capturedState=captured[String(id)];
      if (capturedState===null) {
        const raw=rawById.get(CatalogUniqueConstraintDefinitionIdSchema.make(id));
        if (raw===undefined) return yield* Result.fail(stateError(authority,snapshot,"storedStateInvalid"));
        return {status:"nativeRefusal" as const,raw};
      }
      if (rawById.has(CatalogUniqueConstraintDefinitionIdSchema.make(id)))
        return yield* Result.fail(stateError(authority,snapshot,"storedStateInvalid"));
      const state=yield* decodeOrdinaryUniqueProgress(capturedState).pipe(
        Result.mapError(cause=>stateError(authority,snapshot,"storedStateInvalid",cause)));
      if (state[2]>observedClock.lastCommitSeq || (state[3]!==null && state[3]>observedClock.lastCommitSeq))
        return yield* Result.fail(stateError(authority,snapshot,"frontierAheadOfClock"));
      progress.set(id,state);
    }
    if ([...rawById.keys()].some(id=>!Object.hasOwn(captured,String(id))))
      return yield* Result.fail(stateError(authority,snapshot,"storedStateInvalid"));
    return {status:"ready" as const,progress};
  }));
  if (intrinsic.status==="nativeRefusal") {
    const raw=intrinsic.raw;
    // This original decoder owns native field order and foreign getter defects.
    Object.defineProperty(raw.rawBuild,"maintenanceObligation",{enumerable:true,configurable:true,
      get:()=>raw.rawMaintenance.scopeId===null ? null:raw.rawMaintenance});
    yield* decodeUniqueBuildStateEffect(authority,snapshot,raw.rawBuild,observedClock.lastCommitSeq);
    return yield* Effect.die("Native unique intrinsic refusal accepted by complete decoder");
  }
  const progress=intrinsic.progress;
  let context=header.hasMaintenance ? yield* readUniqueCoverageContext(tx,observedClock,snapshot,coverageHint) : undefined;
  let requiredChecked = context?.binding === null;
  const identities:AppUniqueConstraintBuildIdentity[]=[];
  const consume=(startAt:number,frontiers:UniqueTableFrontiers|undefined)=>Result.gen(function* () {
    for (let index=startAt;index<snapshot.members.length;index++) {
      const member=snapshot.members[index];
      if (member===undefined) return yield* Result.fail(stateError(authority,snapshot,"storedStateInvalid"));
      const state=progress.get(member.uniqueConstraintDefinitionId);
      if (state===undefined)
        return Object.freeze({status:"not_ready" as const,reason:"buildMissing" as const,blocksAllTables:false as const,tableIds});
      const [current,lifecycle,start,covered,attemptFence,maintenanceMatches,maintenanceActive]=state;
      const notReady=(reason:"buildStale"|"buildNotEnabled")=>Object.freeze({status:"not_ready" as const,
        reason,blocksAllTables:false as const,tableIds,lifecycle});
      if (!current) return notReady("buildStale");
      if (lifecycle!=="enabled") return notReady("buildNotEnabled");
      if (covered===null) return notReady("buildStale");
      if (maintenanceActive!==null) {
        const key=yield* decodeOrdinaryUniqueMaintenanceKey(maintenanceActive).pipe(
          Result.mapError(cause=>stateError(authority,snapshot,"storedStateInvalid",cause)));
        if (context===undefined) return Object.freeze({ status: "coverageContextRequired" as const, index });
        if (maintenanceMatches!==true || !maintenanceKeyMatchesCoverageContext({
          authorityKind:key[5],deploymentId:key[0],schemaVersionId:key[1],activationSequence:key[2],
          activationSha256:key[3],headSha256:key[4],candidateSha256:key[6],schemaManifestSha256:key[7] },context))
          return yield* Result.fail(stateError(authority,snapshot,"storedStateInvalid"));
      } else if (context===undefined) {
        return Object.freeze({ status: "coverageContextRequired" as const, index });
      } else if (!requiredChecked) {
        return Object.freeze({ status: "bindingMaintenanceRequired" as const, index });
      } else if (hasRequiredBindingMaintenance(context, "unique", member.uniqueConstraintDefinitionId)) {
        return yield* Result.fail(stateError(authority, snapshot, "storedStateInvalid"));
      } else if (covered<observedClock.lastCommitSeq) {
        if (frontiers===undefined) return {status:"frontiersRequired" as const,index};
        const capturedFrontier=frontiers.get(member.tableId);
        if (capturedFrontier===undefined) throw new Error("Unique frontier batch lost a selected table");
        const frontier=yield* capturedFrontier.pipe(Result.mapError(cause=>stateError(authority,snapshot,"storedStateInvalid",cause)));
        if (frontier!==null && frontier>covered) return notReady("buildStale");
      }
      const identity=Object.freeze({uniqueConstraintDefinitionId:member.uniqueConstraintDefinitionId,
        tableId:member.tableId,startCommitSeq:start,attemptFence});
      if (expectedEvidence!==undefined) {
        const expected=expectedEvidence.definitionBuilds.find(value=>value.uniqueConstraintDefinitionId===member.uniqueConstraintDefinitionId);
        if (expected===undefined || expected.tableId!==identity.tableId || expected.startCommitSeq!==start ||
          expected.attemptFence!==attemptFence) return notReady("buildStale");
      }
      identities.push(identity);
    }
    return Object.freeze({status:"ready" as const,identities:Object.freeze(identities),observedClock});
  });
  const consumeWithRequiredMaintenance = Effect.fnUntraced(function* (
    startAt: number, frontiers: UniqueTableFrontiers | undefined,
  ) {
    let observed = yield* Effect.fromResult(consume(startAt, frontiers));
    if (observed.status === "coverageContextRequired") {
      context = yield* readUniqueCoverageContext(tx, observedClock, snapshot, coverageHint);
      requiredChecked = context.binding === null;
      observed = yield* Effect.fromResult(consume(observed.index, frontiers));
      if (observed.status === "coverageContextRequired")
        return yield* Effect.die("Unique coverage context repeated its capture demand");
    }
    if (observed.status !== "bindingMaintenanceRequired") return observed;
    if (context === undefined) return yield* Effect.die("Required unique binding maintenance has no coverage context");
    yield* prepareMissingBindingMaintenanceCheck(tx, context).pipe(Effect.mapError(cause => cause.reason === "resourceFailure"
      ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: cause.retryable ?? false, cause })
      : stateError(authority, snapshot, "storedStateInvalid", cause)));
    requiredChecked = true;
    const resumed = yield* Effect.fromResult(consume(observed.index, frontiers));
    if (resumed.status === "bindingMaintenanceRequired" || resumed.status === "coverageContextRequired")
      return yield* Effect.die("Required unique binding maintenance repeated its capture demand");
    return resumed;
  });
  const first=yield* consumeWithRequiredMaintenance(0,undefined);
  if (first.status!=="frontiersRequired") return first;
  const needed=snapshot.members.filter(candidate=> {
    const state=progress.get(candidate.uniqueConstraintDefinitionId);
    return state!==undefined && state[6]===null && state[1]==="enabled" &&
      state[3]!==null && state[3]<observedClock.lastCommitSeq;
  }).map(candidate=>candidate.tableId);
  const frontiers=yield* readUniqueTableFrontiers(tx,authority,snapshot,observedClock,[...new Set(needed)],coverageHint);
  const accepted=yield* consumeWithRequiredMaintenance(first.index,frontiers);
  if (accepted.status==="frontiersRequired") return yield* Effect.die("Unique frontier consumption repeated its capture demand");
  return accepted;
},work=>observeExecution("AppUniqueConstraintSetBuild.inspectBuildReadiness",work,"caller"));
// Code-defined native preparation is shared across checkouts; each invocation
// binds the current transaction, selected members and the original row lock.
const readSelectedBuildsWithShare = defineNativeMetadataRead(db =>
  db.select(uniqueConstraintBuildStateSelection()).from(fxSystemUniqueConstraintBuilds)
    .leftJoin(fxSystemUniqueMaintenanceObligations, uniqueMaintenanceBindingPredicate())
    .where(and(eq(fxSystemUniqueConstraintBuilds.scopeId, sql.placeholder("scopeId")),
      sql`${fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId} = any(${sql.placeholder("definitionIds")}::integer[])`))
    .orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId).limit(sql.placeholder("limit"))
    .for("share", { of: fxSystemUniqueConstraintBuilds }));

const loadSelectedBuildStates = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  clock: ScopeClockRecord,
) {
  if (snapshot.members.length === 0) return Object.freeze({ states: [] as const, clock });
  const rows = yield* queryEffect(readSelectedBuildsWithShare(tx, { scopeId: authority.scopeId,
    definitionIds: snapshot.members.map(value => value.uniqueConstraintDefinitionId), limit: snapshot.members.length + 1 }));
  if (rows.length > snapshot.members.length)
    return yield* Effect.fail(
      stateError(authority, snapshot, "storedStateInvalid"),
    );
  const states: BuildState[] = [];
  for (const row of rows)
    states.push(yield* decodeUniqueBuildStateEffect(authority, snapshot, row, clock.lastCommitSeq));
  return Object.freeze({ states: Object.freeze(states), clock });
}, work => observeExecution("AppUniqueConstraintBuild.loadSelected", work, "caller"));

/** Keep the actual post-lock clock observation and its error contract when a
 * root lends monotonic positive build evidence rather than loading it again. */
const observeSelectedBuildClock = Effect.fnUntraced(function* (
  tx: AppRowTransaction, clock: ScopeClockRecord, snapshot: Pick<BuildSnapshot, "schemaVersionId">,
) {
  const observed = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, clock.scopeId).pipe(Effect.mapError(cause =>
    cause instanceof ScopeAuthorizationRevocationEpochPersistenceError
      ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction",
        retryable: isRetryableSqlTransactionCause(cause.cause instanceof DrizzleQueryError ? cause.cause.cause : cause.cause), cause })
      : stateError(clock, snapshot, "storedStateInvalid", cause)));
  if (observed.storageGeneration !== clock.storageGeneration || observed.storageGenerationFence !== clock.storageGenerationFence ||
    observed.epoch !== clock.epoch || observed.lastCommitSeq < clock.lastCommitSeq)
    return yield* Effect.fail(stateError(clock, snapshot, "storedStateInvalid"));
  return observed;
});

/** Existing evidence issuer authenticates the original transaction and port;
 * lifecycle writers are excluded and publication only advances coverage. */
export function readAcceptedAppUniqueConstraintSetObservedClock(port: AppUniqueConstraintSetEligibilityPortV1,
  evidence: AppUniqueConstraintSetEligibilityEvidenceV1, tx: AppRowTransaction) {
  const issued = eligibilityEvidenceSnapshots.get(evidence);
  return issued === undefined || eligibilityEvidencePorts.get(evidence) !== port || issued.tx !== tx
    ? Result.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }))
    : Result.succeed({ ...issued.clock, updatedAt: new Date(issued.clock.updatedAt.getTime()) });
}

export const refreshAcceptedAppUniqueConstraintSetObservation = Effect.fnUntraced(function* (
  port: AppUniqueConstraintSetEligibilityPortV1, evidence: AppUniqueConstraintSetEligibilityEvidenceV1,
  tx: AppRowTransaction, clock: ScopeClockRecord,
) {
  const issued = eligibilityEvidenceSnapshots.get(evidence);
  if (issued === undefined || eligibilityEvidencePorts.get(evidence) !== port || issued.tx !== tx ||
    issued.clock.scopeId !== clock.scopeId || issued.clock.storageGeneration !== clock.storageGeneration ||
    issued.clock.storageGenerationFence !== clock.storageGenerationFence || issued.clock.epoch !== clock.epoch ||
    clock.lastCommitSeq < issued.clock.lastCommitSeq)
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({ reason: "invalidPort", retryable: false }));
  const observed = yield* observeSelectedBuildClock(tx, clock, issued.snapshot);
  eligibilityEvidenceSnapshots.set(evidence, { ...issued, clock: { ...observed, updatedAt: new Date(observed.updatedAt.getTime()) } });
  return observed;
}, work => observeExecution("AppUniqueConstraintBuild.refreshAcceptedObservation", work, "caller"));

const readUniqueCoverageContext = Effect.fnUntraced(function* (
  tx: AppRowTransaction, clock: ScopeClockRecord, snapshot: Pick<BuildSnapshot, "schemaVersionId">,
  coverageHint?: IndexCoverageContext,
) {
  return yield* Effect.gen(function* () {
    if (coverageHint !== undefined) {
      const borrowed = yield* Effect.fromResult(borrowIndexCoverageContextInTransaction(tx, clock, coverageHint));
      if (borrowed !== null) return borrowed;
    }
    return yield* readIndexCoverageContextInTransactionEffect(tx, clock);
  }).pipe(Effect.mapError(cause => cause.reason === "resourceFailure"
    ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: cause.retryable ?? false, cause })
    : stateError(clock, snapshot, "storedStateInvalid", cause)));
}, work => observeExecution("AppUniqueConstraintBuild.readCoverageContext", work, "caller"));

type UniqueTableFrontiers = ReadonlyMap<CatalogTableId,
  Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>;

const readUniqueTableFrontiers = Effect.fnUntraced(function* (
  tx: AppRowTransaction, authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId">, clock: ScopeClockRecord,
  tableIds: ReadonlyArray<CatalogTableId>, coverageHint?: IndexCoverageContext,
) {
  return yield* Effect.gen(function* () {
    if (coverageHint !== undefined) {
      const cached = yield* Effect.fromResult(readPreparedIndexCoverageTableFrontiers(tx, clock, coverageHint, tableIds));
      if (cached !== null) return cached;
    }
    return yield* readAppTableWriteFrontiersInTransactionEffect(tx, authority.scopeId, tableIds);
  }).pipe(Effect.mapError(cause => cause instanceof AppRowReadPersistenceError
    ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: true, cause })
    : stateError(authority, snapshot, "storedStateInvalid", cause)));
}, work => observeExecution("AppUniqueConstraintBuild.readTableFrontiers", work, "caller"));

function hasDefinitionCoverageResult(
  authority: Pick<TrustedScopeAuthority, "scopeId">, snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  state: BuildState, tableId: CatalogTableId, clock: ScopeClockRecord,
  context: IndexCoverageContext | undefined, frontier: CommitSeq | null,
) {
  if (state.coveredThroughCommitSeq === null) return Result.succeed(false);
  if (state.maintenance !== null) {
    const obligation = state.maintenance;
    // First-member correlation is intentional, including repeated selected IDs.
    const member = snapshot.members.find(value => value.uniqueConstraintDefinitionId === state.uniqueConstraintDefinitionId);
    if (member === undefined || obligation.tableId !== tableId ||
      encodeBytesToLowercaseHex(obligation.physicalSpecSha256) !== member.physicalSpecSha256Hex ||
      context === undefined || !maintenanceMatchesCoverageContext(obligation, context) || !buildAuthorityIsCurrent(state, clock))
      return Result.fail(stateError(authority, snapshot, "storedStateInvalid"));
    return Result.succeed(true);
  }
  if (context !== undefined && hasRequiredBindingMaintenance(context, "unique", state.uniqueConstraintDefinitionId))
    return Result.fail(stateError(authority, snapshot, "storedStateInvalid"));
  return Result.succeed(state.coveredThroughCommitSeq >= clock.lastCommitSeq || frontier === null || frontier <= state.coveredThroughCommitSeq);
}

const inspectDefinitionCoverageEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction, authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">, state: BuildState, tableId: CatalogTableId,
  clock: ScopeClockRecord, coverageContext?: IndexCoverageContext, tableFrontiers?: UniqueTableFrontiers,
) {
  if (state.coveredThroughCommitSeq === null) return false;
  const context = coverageContext ?? (yield* readUniqueCoverageContext(tx, clock, snapshot));
  if (state.maintenance === null)
    yield* prepareMissingBindingMaintenanceCheck(tx, context).pipe(Effect.mapError(cause => cause.reason === "resourceFailure"
      ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: cause.retryable ?? false, cause })
      : stateError(authority, snapshot, "storedStateInvalid", cause)));
  let frontier: CommitSeq | null = null;
  if (state.maintenance === null && state.coveredThroughCommitSeq < clock.lastCommitSeq) {
    const batched = tableFrontiers?.get(tableId);
    frontier = yield* (tableFrontiers === undefined
      ? readAppTableWriteFrontierInTransactionEffect(tx, authority.scopeId, tableId)
      : batched === undefined ? Effect.die("Selected unique table frontier missing from transaction batch")
        : Effect.fromResult(batched)).pipe(Effect.mapError(cause => cause instanceof AppRowReadPersistenceError
          ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: true, cause })
          : stateError(authority, snapshot, "storedStateInvalid", cause)));
  }
  return yield* Effect.fromResult(hasDefinitionCoverageResult(authority, snapshot, state, tableId, clock, context, frontier));
}, work => observeExecution("AppUniqueConstraintBuild.inspectCoverage", work, "caller"));

function buildIdentity(
  state: BuildState,
  tableId: CatalogTableId,
): AppUniqueConstraintBuildIdentity {
  return Object.freeze({
    uniqueConstraintDefinitionId: state.uniqueConstraintDefinitionId,
    tableId,
    startCommitSeq: state.startCommitSeq,
    attemptFence: state.attemptFence,
  });
}

const runReconciliationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  Extract<
    ReconcileAppUniqueConstraintSetBuildV1Result,
    { status: "reconciled" }
  >,
  Exclude<
    ReconcileAppUniqueConstraintSetBuildV1Error,
    | InvalidAppUniqueConstraintSetBuildInputV1Error
    | ReadAppUniqueConstraintSetClosureV1Error
    | TrustedScopeAuthorityError
  >
> {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set reconciliation rolled back.",
    (tx) => reconcileInTransaction(tx, authority, snapshot, options),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (failure._tag === "None") return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* observeUncertainCompletion(
      target,
      authority,
      snapshot,
      cause,
    );
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(
      Cause.combine(
        callbackCause,
        Cause.die(
          new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: false,
            cause,
          }),
        ),
      ),
    );
  }
  const retryable =
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(
    new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable,
      cause,
    }),
  );
});

const runWorkspaceReclamationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runWorkspaceReclamationTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  Exclude<
    ReclaimSupersededAppUniqueConstraintSetBuildError,
    | InvalidAppUniqueConstraintSetBuildInputV1Error
    | ReadAppUniqueConstraintSetClosureV1Error
    | TrustedScopeAuthorityError
  >
> {
  const started = startLocatedEffectTransaction(
    target,
    "M05-A unique-set build workspace reclamation rolled back.",
    (tx) => reclaimWorkspaceInTransaction(tx, authority, snapshot, options),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (Option.isNone(failure)) return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* observeWorkspaceReclamationAfterUncertainCompletion(
      target,
      authority,
      snapshot,
      cause,
    );
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(
      Cause.combine(
        callbackCause,
        Cause.die(
          new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: false,
            cause,
          }),
        ),
      ),
    );
  }
  const retryable =
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(
    new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable,
      cause,
    }),
  );
});

const runCandidateSupersessionReclamationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runCandidateSupersessionReclamationTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  candidateValidation: AppSchemaCandidateValidationPort,
  prepared: PreparedAppSchemaCandidateValidationInstall,
  expectedHeadClaim: ExpectedAppSchemaCandidateValidationHeadClaim,
  displacedSchemaVersionId: CatalogSchemaVersionId | null,
  displacedSnapshot: ReclamationSnapshot | null,
  options: InstallAppSchemaCandidateWithWorkspaceReclamationOptions,
): Effect.fn.Return<
  InstallAppSchemaCandidateWithWorkspaceReclamationResult,
  InstallAppSchemaCandidateWithWorkspaceReclamationError
> {
  const started = startLocatedEffectTransaction(
    target,
    "M05-A2 candidate supersession and workspace reclamation rolled back.",
    (tx) =>
      installCandidateAndReclaimWorkspaceInTransaction(
        tx,
        authority,
        candidateValidation,
        prepared,
        expectedHeadClaim,
        displacedSchemaVersionId,
        displacedSnapshot,
        options,
      ),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (Option.isNone(failure)) return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(
      Cause.combine(
        callbackCause,
        Cause.die(
          new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: false,
            cause,
          }),
        ),
      ),
    );
  }
  const retryable =
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "decisionUncertain" ||
      cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(
    new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable,
      cause,
    }),
  );
});

const installCandidateAndReclaimWorkspaceInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.installCandidateAndReclaimWorkspaceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  candidateValidation: AppSchemaCandidateValidationPort,
  prepared: PreparedAppSchemaCandidateValidationInstall,
  expectedHeadClaim: ExpectedAppSchemaCandidateValidationHeadClaim,
  displacedSchemaVersionId: CatalogSchemaVersionId | null,
  displacedSnapshot: ReclamationSnapshot | null,
  options: InstallAppSchemaCandidateWithWorkspaceReclamationOptions,
): Effect.fn.Return<
  InstallAppSchemaCandidateWithWorkspaceReclamationResult,
  | InstallAppSchemaCandidateValidationError
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildDirectoryV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | LockScopeClockForUpdateError
> {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  invalidateSharedLogicalSourceBindingChecks(tx);
  if (displacedSnapshot !== null) {
    const clock = yield* lockScopeClockForUpdateInTransactionEffect(
      tx,
      authority.scopeId,
    );
    yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
    yield* requireProtectionHeads(tx, authority, displacedSnapshot);
  }
  const installation =
    yield* installPreparedAppSchemaCandidateValidationInTransactionEffect(
      tx,
      candidateValidation,
      prepared,
      authority,
      expectedHeadClaim,
      options.candidateValidation,
    );
  if (displacedSchemaVersionId === null) {
    return Object.freeze({
      installation,
      workspace: Object.freeze({ disposition: "not_applicable" as const }),
    });
  }
  if (installation.disposition !== "superseded") {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildReclamationError({
        deploymentId: installation.head.deploymentId,
        schemaVersionId: displacedSchemaVersionId,
        scopeId: authority.scopeId,
        reason: "concurrentStateChange",
        retryable: true,
      }),
    );
  }
  const workspace = yield* reclaimDisplacedWorkspaceInTransaction(
    tx,
    authority,
    installation.head.deploymentId,
    displacedSchemaVersionId,
    displacedSnapshot,
    options.uniqueConstraintBuild ?? {},
  );
  return Object.freeze({ installation, workspace });
});

const reclaimDisplacedWorkspaceInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.reclaimDisplaced",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  snapshot: ReclamationSnapshot | null,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  InstallAppSchemaCandidateWithWorkspaceReclamationResult["workspace"],
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | LockScopeClockForUpdateError
> {
  if (snapshot === null || snapshot.protection.protectedDefinitionIds === null)
    return Object.freeze({
      disposition: "retained",
      reason: "protectedMembershipUnknown",
      schemaVersionId,
    });
  invalidateAcceptedApplicationBindingInTransaction(tx);
  invalidateSharedLogicalSourceBindingChecks(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const deletion = yield* attemptWorkspaceDeletionInTransaction(
    tx,
    authority,
    snapshot,
    clock,
    options,
  );
  if (
    deletion.retainedDefinitionIds.length > 0 &&
    deletion.deletedDefinitionIds.length === 0
  )
    return Object.freeze({
      disposition: "retained",
      reason: "sharedDefinition",
      schemaVersionId,
    });
  return Object.freeze({
    disposition:
      deletion.deletedDefinitionIds.length > 0 ? "deleted" : "already_absent",
    schemaVersionId,
  });
});

const reclaimWorkspaceInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.reclaimWorkspace",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  invalidateSharedLogicalSourceBindingChecks(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  yield* requireProtectionHeads(tx, authority, snapshot);
  const selection = yield* inspectSelectedWorkspaceReclamation(
    tx,
    authority,
    snapshot,
  );
  if (selection === "activeSchema")
    return yield* Effect.fail(
      reclamationError(authority, snapshot, "activeSchema", false),
    );
  if (snapshot.protection.protectedDefinitionIds === null)
    return yield* Effect.fail(
      reclamationError(authority, snapshot, "schemaAuthorityMissing", false),
    );
  const deletion = yield* attemptWorkspaceDeletionInTransaction(
    tx,
    authority,
    snapshot,
    clock,
    options,
  );
  return Object.freeze({
    status: "reclaimed" as const,
    disposition:
      deletion.deletedDefinitionIds.length > 0
        ? ("deleted" as const)
        : deletion.retainedDefinitionIds.length > 0
          ? ("retained" as const)
          : ("already_absent" as const),
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    ...deletion,
  });
});

const attemptWorkspaceDeletionInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.deleteUnprotectedWorkspaces",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
  clock: ScopeClockRecord,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  const states = (yield* loadSelectedBuildStates(tx, authority, snapshot, clock)).states;
  const deletedDefinitionIds: CatalogUniqueConstraintDefinitionId[] = [];
  const retainedDefinitionIds: CatalogUniqueConstraintDefinitionId[] = [];
  for (const state of states) {
    if (
      state.lifecycle === "enabled" ||
      snapshot.protection.protectedDefinitionIds === null ||
      snapshot.protection.protectedDefinitionIds.has(
        state.uniqueConstraintDefinitionId,
      )
    ) {
      retainedDefinitionIds.push(state.uniqueConstraintDefinitionId);
      continue;
    }
    yield* Effect.fromResult(
      requireCurrentBuildAuthorityResult(authority, state, clock),
    );
    const deleted = yield* queryEffect(
      tx
        .delete(fxSystemUniqueConstraintBuilds)
        .where(
          and(
            eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
            eq(
              fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
              state.uniqueConstraintDefinitionId,
            ),
            eq(fxSystemUniqueConstraintBuilds.attemptFence, state.attemptFence),
            eq(fxSystemUniqueConstraintBuilds.lifecycle, state.lifecycle),
            eq(fxSystemUniqueConstraintBuilds.epoch, state.epoch),
            eq(
              fxSystemUniqueConstraintBuilds.storageGenerationFence,
              state.storageGenerationFence,
            ),
          ),
        )
        .returning({
          id: fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
        }),
    );
    if (deleted.length !== 1)
      return yield* Effect.fail(
        reclamationError(authority, snapshot, "concurrentStateChange", true),
      );
    deletedDefinitionIds.push(state.uniqueConstraintDefinitionId);
    yield* runFault(options, "afterWorkspaceDelete");
  }
  return Object.freeze({
    deletedDefinitionIds: Object.freeze(deletedDefinitionIds),
    retainedDefinitionIds: Object.freeze(retainedDefinitionIds),
  });
});

const readProtectionHeads = Effect.fn(
  "AppUniqueConstraintBuild.readProtectionHeads",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: Pick<BuildSnapshot, "deploymentId" | "schemaVersionId">,
) {
  const active =
    yield* readApplicationActiveRevisionForShareInTransactionEffect(
      tx,
      authority.scopeId,
    ).pipe(
      Effect.mapError((cause) =>
        reclamationError(
          authority,
          snapshot,
          "activeSchemaStateInvalid",
          cause.retryable,
          cause,
        ),
      ),
    );
  const candidate =
    yield* readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
      tx,
      authority.scopeId,
      "load",
    ).pipe(
      Effect.mapError((cause) =>
        reclamationError(
          authority,
          snapshot,
          "candidateSchemaStateInvalid",
          cause instanceof AppSchemaCandidateValidationPersistenceError,
          cause,
        ),
      ),
    );
  if (
    (active !== null && active.deploymentId !== snapshot.deploymentId) ||
    (candidate !== null && candidate.deploymentId !== snapshot.deploymentId)
  )
    return yield* Effect.fail(
      reclamationError(authority, snapshot, "activeSchemaStateInvalid", false),
    );
  return Object.freeze({ active, candidate });
});

const prepareReclamationSnapshot = Effect.fn(
  "AppUniqueConstraintBuild.prepareReclamation",
)(function* (
  ports: AppUniqueConstraintSetBuildPortsV1,
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  replacementSchemaVersionId?: CatalogSchemaVersionId,
) {
  const started = startLocatedEffectTransaction(
    target,
    "Unique workspace protection read rolled back.",
    (tx) =>
      Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          authority.scopeId,
        );
        yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
        return yield* readProtectionHeads(tx, authority, snapshot);
      }),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isFailure(settled)) {
    const failure = Cause.findErrorOption(settled.cause);
    if (Option.isNone(failure)) return yield* Effect.die(settled.cause);
    const cause = failure.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    )
      return yield* Effect.failCause(callbackCause);
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    )
      return yield* Effect.failCause(
        Cause.combine(callbackCause, Cause.die(cause)),
      );
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    );
  }
  const heads = settled.value;
  const protectedDefinitionIds = new Set<CatalogUniqueConstraintDefinitionId>();
  let known = true;
  const schemas = new Set([
    heads.active?.schemaVersionId,
    replacementSchemaVersionId ?? heads.candidate?.schemaVersionId,
  ]);
  for (const schema of schemas) {
    if (schema === undefined) continue;
    const closure = yield* readAppUniqueConstraintSetClosureV1Effect(
      ports.controlDb,
      snapshot.deploymentId,
      schema,
    );
    if (closure === null) known = false;
    else
      for (const member of closure.members)
        protectedDefinitionIds.add(member.uniqueConstraintDefinitionId);
  }
  return Object.freeze({
    ...snapshot,
    protection: Object.freeze({
      heads,
      protectedDefinitionIds: known ? protectedDefinitionIds : null,
      replacingCandidate: replacementSchemaVersionId !== undefined,
    }),
  }) satisfies ReclamationSnapshot;
});

const requireProtectionHeads = Effect.fn(
  "AppUniqueConstraintBuild.requireProtectionHeads",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
) {
  const current = yield* readProtectionHeads(tx, authority, snapshot);
  const expected = snapshot.protection.heads;
  if (
    current.active?.revisionId !== expected.active?.revisionId ||
    current.active?.schemaVersionId !== expected.active?.schemaVersionId ||
    (!snapshot.protection.replacingCandidate &&
      current.candidate?.frameSha256Hex !== expected.candidate?.frameSha256Hex)
  )
    return yield* Effect.fail(
      reclamationError(authority, snapshot, "concurrentStateChange", true),
    );
});

const inspectSelectedWorkspaceReclamation = Effect.fn(
  "AppUniqueConstraintSetBuild.inspectSelectedWorkspaceReclamation",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: Pick<BuildSnapshot, "deploymentId" | "schemaVersionId">,
): Effect.fn.Return<
  "eligible" | "activeSchema",
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildIntegrationV1Error
> {
  const active =
    yield* readApplicationActiveRevisionForShareInTransactionEffect(
      tx,
      authority.scopeId,
    ).pipe(
      Effect.mapError((cause) =>
        reclamationError(
          authority,
          snapshot,
          "activeSchemaStateInvalid",
          cause.retryable,
          cause,
        ),
      ),
    );
  if (active !== null) {
    if (active.deploymentId !== snapshot.deploymentId) {
      return yield* Effect.fail(
        reclamationError(
          authority,
          snapshot,
          "activeSchemaStateInvalid",
          false,
        ),
      );
    }
    if (active.schemaVersionId === snapshot.schemaVersionId) {
      return "activeSchema" as const;
    }
  }
  const candidate =
    yield* readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
      tx,
      authority.scopeId,
      "load",
    ).pipe(
      Effect.mapError((cause) =>
        reclamationError(
          authority,
          snapshot,
          "candidateSchemaStateInvalid",
          cause instanceof AppSchemaCandidateValidationPersistenceError,
          cause,
        ),
      ),
    );
  if (
    candidate !== null &&
    (candidate.deploymentId !== snapshot.deploymentId ||
      candidate.scopeId !== authority.scopeId)
  ) {
    return yield* Effect.fail(
      reclamationError(
        authority,
        snapshot,
        "candidateSchemaStateInvalid",
        false,
      ),
    );
  }
  if (candidate?.schemaVersionId === snapshot.schemaVersionId) {
    return yield* Effect.fail(
      reclamationError(authority, snapshot, "currentCandidate", false),
    );
  }
  return "eligible" as const;
});

const observeWorkspaceReclamationAfterUncertainCompletion = Effect.fn(
  "AppUniqueConstraintSetBuild.observeWorkspaceReclamationAfterUncertainCompletion",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
  transactionCause: unknown,
): Effect.fn.Return<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildStateV1Error
  | LockScopeClockForUpdateError
> {
  const started = startLocatedEffectTransaction(
    target,
    "M05-A unique-set reclamation observation rolled back.",
    (tx) => observeWorkspaceAbsenceInTransaction(tx, authority, snapshot),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isFailure(settled)) {
    const failure = Cause.findErrorOption(settled.cause);
    if (Option.isNone(failure)) return yield* Effect.die(settled.cause);
    const cause = failure.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(
        Cause.combine(
          callbackCause,
          Cause.die(
            new AppUniqueConstraintSetBuildIntegrationV1Error({
              phase: "targetTransaction",
              retryable: false,
              cause,
            }),
          ),
        ),
      );
    }
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    );
  }
  if (!settled.value) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        cause: transactionCause,
      }),
    );
  }
  return reclamationAbsentResult(
    authority,
    snapshot,
    "replayedAfterUncertainCompletion",
  );
});

const observeWorkspaceAbsenceInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.observeWorkspaceAbsence",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: ReclamationSnapshot,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  yield* requireProtectionHeads(tx, authority, snapshot);
  const states = (yield* loadSelectedBuildStates(tx, authority, snapshot, clock)).states;
  return states.every(
    (state) =>
      state.lifecycle === "enabled" ||
      snapshot.protection.protectedDefinitionIds?.has(
        state.uniqueConstraintDefinitionId,
      ),
  );
});

const runBackfillTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runBackfillTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  AdvanceAppUniqueConstraintSetBackfillV1Result,
  Exclude<
    AdvanceAppUniqueConstraintSetBackfillV1Error,
    | InvalidAppUniqueConstraintSetBuildInputV1Error
    | ReadAppUniqueConstraintSetClosureV1Error
    | ReadAppUniqueConstraintDefinitionV1Error
    | TrustedScopeAuthorityError
  >
> {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set backfill page rolled back.",
    (tx) =>
      advanceBackfillInTransaction(
        tx,
        authority,
        snapshot,
        definitions,
        pageSize,
        options,
      ),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isSuccess(settled)) return settled.value;
  const failure = Cause.findErrorOption(settled.cause);
  if (failure._tag === "None") return yield* Effect.die(settled.cause);
  const cause = failure.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(callbackCause);
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        cause,
      }),
    );
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) {
    return yield* Effect.failCause(
      Cause.combine(
        callbackCause,
        Cause.die(
          new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: false,
            cause,
          }),
        ),
      ),
    );
  }
  const retryable =
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(
    new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable,
      cause,
    }),
  );
});

const advanceBackfillInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.advanceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  invalidateSharedLogicalSourceBindingChecks(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const states = (yield* loadSelectedBuildStates(tx, authority, snapshot, clock)).states;
  let selected:
    | { state: BuildState; definition: LocatedAppUniqueConstraintDefinitionV1 }
    | undefined;
  const coverageContext = states.some(state => state.maintenance !== null)
    ? yield* readUniqueCoverageContext(tx, clock, snapshot) : undefined;
  let pending = 0;
  for (const definition of definitions) {
    const state = states.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        definition.uniqueConstraintDefinitionId,
    );
    if (!state)
      return yield* Effect.fail(
        stateError(authority, snapshot, "buildMissing"),
      );
    yield* Effect.fromResult(
      requireCurrentBuildAuthorityResult(authority, state, clock),
    );
    const active = yield* isPhysicalUniqueBuildActiveInTransactionEffect(
      tx,
      authority,
      snapshot.deploymentId,
      definition.uniqueConstraintDefinitionId,
      definition.physicalSpecSha256Hex,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof PhysicalDefinitionLifecyclePersistenceError
          ? new AppUniqueConstraintSetBuildIntegrationV1Error({
              phase: "targetTransaction",
              retryable: true,
              cause,
            })
          : stateError(
              authority,
              snapshot,
              "physicalDefinitionInactive",
              cause,
            ),
      ),
    );
    if (!active)
      return yield* Effect.fail(
        stateError(authority, snapshot, "physicalDefinitionInactive"),
      );
    if (
      state.lifecycle !== "enabled" ||
      !(yield* inspectDefinitionCoverageEffect(
        tx,
        authority,
        snapshot,
        state,
        definition.tableId,
        clock,
        coverageContext,
      ))
    ) {
      pending += 1;
      selected ??= { state, definition };
    } else if (state.maintenance === null && state.coveredThroughCommitSeq !== clock.lastCommitSeq) {
      // The current table frontier proves an unchanged suffix even when its feed expired.
      yield* transitionBuildLifecycle(
        tx,
        authority,
        snapshot,
        state,
        "enabled",
        null,
        options,
        clock.lastCommitSeq,
      );
    }
  }
  if (!selected)
    return backfillResult(
      authority,
      snapshot,
      null,
      "replayed",
      "enabled",
      0,
      0,
      0,
      0,
      null,
    );
  let { state } = selected;
  const { definition } = selected;
  if (state.lifecycle === "declared") {
    yield* transitionBuildLifecycle(
      tx,
      authority,
      snapshot,
      state,
      "building",
      null,
      options,
    );
    return backfillResult(
      authority,
      snapshot,
      state,
      "advanced",
      "building",
      0,
      0,
      0,
      0,
      null,
    );
  }
  if (state.lifecycle === "building") {
    const drain = yield* drainInitialAppUniqueKeyClaimsInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      constraintId: definition.uniqueConstraintDefinitionId,
      authorityEpoch: authority.epoch,
      attemptFence: state.attemptFence,
    });
    yield* runFault(options, "afterInitialClaimDrain");
    const lifecycle = drain.hasMore ? "building" : "backfilling";
    yield* transitionBuildLifecycle(
      tx,
      authority,
      snapshot,
      state,
      lifecycle,
      null,
      options,
      drain.hasMore ? null : clock.lastCommitSeq,
    );
    return backfillResult(
      authority,
      snapshot,
      state,
      "advanced",
      lifecycle,
      drain.drained,
      0,
      0,
      0,
      null,
    );
  }
  // Coverage is a processed-change baseline during population. Only enabled grants admission.
  if (
    !(yield* inspectDefinitionCoverageEffect(
      tx,
      authority,
      snapshot,
      state,
      definition.tableId,
      clock,
      coverageContext,
    ))
  ) {
    const refreshed = yield* reconcileDefinitionGap(
      tx,
      authority,
      snapshot,
      state,
      definition,
      clock,
      options,
    );
    state = Object.freeze({
      ...state,
      coveredThroughCommitSeq: clock.lastCommitSeq,
      cursorRowId: state.lifecycle === "validating" ? null : state.cursorRowId,
    });
    yield* transitionBuildLifecycle(
      tx,
      authority,
      snapshot,
      state,
      state.lifecycle === "declared" ? "building" : state.lifecycle,
      state.cursorRowId === null
        ? null
        : yield* Effect.fromResult(
            appRowIdHexV1FromBytesResult(state.cursorRowId),
          ).pipe(
            Effect.mapError((cause) =>
              stateError(authority, snapshot, "storedStateInvalid", cause),
            ),
          ),
      options,
      clock.lastCommitSeq,
    );
    if (state.lifecycle === "enabled")
      return backfillResult(
        authority,
        snapshot,
        state,
        "advanced",
        pending === 1 ? "enabled" : "building",
        refreshed,
        0,
        0,
        0,
        null,
      );
  }
  const advanced =
    state.lifecycle === "backfilling"
      ? yield* backfillUniqueSetPage(
          tx,
          authority,
          snapshot,
          state,
          definition,
          pageSize,
          options,
          clock.lastCommitSeq,
        )
      : yield* validateUniqueSetPage(
          tx,
          authority,
          snapshot,
          state,
          definition,
          pageSize,
          options,
          clock.lastCommitSeq,
        );
  return advanced.lifecycle === "enabled" && pending > 1
    ? Object.freeze({ ...advanced, lifecycle: "building" as const })
    : advanced;
});

const reconcileDefinitionGap = Effect.fn(
  "AppUniqueConstraintBuild.reconcileGap",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definition: LocatedAppUniqueConstraintDefinitionV1,
  clock: ScopeClockRecord,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  if (state.coveredThroughCommitSeq === null)
    return yield* Effect.fail(
      stateError(authority, snapshot, "coverageMissing"),
    );
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  ).pipe(
    Effect.mapError((cause) =>
      stateError(authority, snapshot, "storedStateInvalid", cause),
    ),
  );
  const page = yield* readCommitFeedPageInTransactionV1Effect(tx, {
    scopeUuid: scope.scopeUuid,
    exclusiveCommitSeq: state.coveredThroughCommitSeq,
    maximumCommits: MAX_COMMIT_FEED_PAGE_COMMITS_V1,
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof CommitFeedSqlErrorV1
        ? new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: true,
            cause,
          })
        : stateError(authority, snapshot, "historyGap", cause),
    ),
  );
  // Prove the entire gap fits before touching ownership: intermediate duplicates may be repaired later.
  if (
    page.continuation.kind !== "complete" ||
    page.observedLastCommitSeq !== clock.lastCommitSeq
  )
    return yield* Effect.fail(stateError(authority, snapshot, "catchUpLimit"));
  const changed = new Set<AppRowIdHexV1>();
  for (const commit of page.commits)
    for (const change of commit.appRowChanges) {
      if (change.tableId === definition.tableId)
        changed.add(
          yield* Effect.fromResult(
            appRowIdHexV1FromBytesResult(change.rowId),
          ).pipe(
            Effect.mapError((cause) =>
              stateError(authority, snapshot, "historyGap", cause),
            ),
          ),
        );
    }
  const rowIds = [...changed].toSorted();
  // Every release precedes every claim, including across owner-read pages.
  for (let offset = 0; offset < rowIds.length; offset += 32) {
    const owners = yield* readAppUniqueKeyOwnersInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      positions: rowIds
        .slice(offset, offset + 32)
        .map((rowId) => ({
          constraintId: definition.uniqueConstraintDefinitionId,
          tableId: definition.tableId,
          rowId,
          componentCount: definition.physicalSpec.orderedFields.length + 1,
        })),
    });
    yield* applyAppUniqueKeyMutationsInTransactionEffect(
      tx,
      owners.map((owner) => ({
        scopeId: authority.scopeId,
        constraintId: owner.constraintId,
        tableId: owner.tableId,
        rowId: owner.rowId,
        writeEpoch: authority.epoch,
        previous: owner.projection,
        next: null,
      })),
    );
  }
  for (const rowId of rowIds) {
    const current = yield* readCurrentAppRowInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      tableId: definition.tableId,
      rowId,
    });
    if (current.kind !== "live") continue;
    const claim = yield* lowerValidationExpectation(
      authority,
      snapshot,
      definition,
      current,
    );
    if (claim !== null) {
      yield* ensureAppUniqueKeyBackfillClaimInTransactionEffect(tx, {
        scopeId: authority.scopeId,
        constraintId: definition.uniqueConstraintDefinitionId,
        tableId: definition.tableId,
        rowId,
        authorityEpoch: authority.epoch,
        claim,
      });
      yield* runFault(options, "afterBackfillClaim");
    }
  }
  return rowIds.length;
});

const validateUniqueSetPage = Effect.fn(
  "AppUniqueConstraintBuild.validatePage",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definition: LocatedAppUniqueConstraintDefinitionV1,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
  head: CommitSeq,
) {
  yield* ensureValidationClaimDimensions(tx, authority, snapshot, [definition]);
  const candidates = yield* loadDefinitionCandidates(
    tx,
    authority,
    snapshot,
    state,
    definition,
    pageSize,
  );
  const page = candidates.slice(0, pageSize);
  for (const rowId of page) {
    const current = yield* readCurrentAppRowInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      tableId: definition.tableId,
      rowId,
    });
    const expected =
      current.kind === "live"
        ? yield* lowerValidationExpectation(
            authority,
            snapshot,
            definition,
            current,
          )
        : null;
    const verdict = yield* validateAppUniqueKeyClaimInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      constraintId: definition.uniqueConstraintDefinitionId,
      tableId: definition.tableId,
      rowId,
      authorityEpoch: authority.epoch,
      expected,
    });
    if (verdict.status === "mismatched")
      return yield* Effect.fail(
        stateError(authority, snapshot, "validationMismatch", verdict),
      );
    yield* runFault(options, "afterValidationRow");
  }
  const done = candidates.length <= pageSize;
  const lifecycle = done ? "enabled" : "validating";
  const cursor = done ? null : page.at(-1)!;
  if (done) yield* runFault(options, "beforeEnable");
  yield* transitionBuildLifecycle(
    tx,
    authority,
    snapshot,
    state,
    lifecycle,
    cursor,
    options,
    head,
  );
  return backfillResult(
    authority,
    snapshot,
    state,
    "advanced",
    lifecycle,
    page.length,
    0,
    0,
    0,
    cursor,
  );
});

function lowerValidationExpectation(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definition: LocatedAppUniqueConstraintDefinitionV1,
  current: Extract<AppRowReadResultV1, { readonly kind: "live" }>,
) {
  return Effect.fromResult(
    lowerCanonicalAppUniqueConstraintV1Result(
      definition,
      current.document,
    ).pipe(
      Result.mapError((cause) =>
        stateError(authority, snapshot, "loweringInvalid", cause),
      ),
      Result.map((lowered) =>
        lowered.kind === "claim" ? lowered.projection : null,
      ),
    ),
  );
}

const ensureValidationClaimDimensions = Effect.fn(
  "AppUniqueConstraintSetBuild.ensureValidationClaimDimensions",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
): Effect.fn.Return<
  void,
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
> {
  if (definitions.length === 0) return;
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId).pipe(
      Result.mapError((cause) =>
        stateError(authority, snapshot, "storedStateInvalid", cause),
      ),
    ),
  );
  const definitionValues = sql.join(
    definitions.map(
      (definition) => sql`(
      ${definition.uniqueConstraintDefinitionId}::integer,
      ${definition.tableId}::integer
    )`,
    ),
    sql`, `,
  );
  const driverResult = yield* queryEffect(
    tx.execute(sql`
      with definition(definition_id, table_id) as (
        values ${definitionValues}
      )
      select definition.definition_id
      from definition
      cross join lateral (
        (
          select 1 as invalid
          from fx_app_unique_key as claim
          where claim.scope_uuid = ${scopeUuid.scopeUuid}
            and claim.constraint_id = definition.definition_id
            and claim.locale_key > ''
          order by claim.locale_key asc, claim.table_id asc, claim.row_id asc
          limit 1
        )
        union all
        (
          select 1 as invalid
          from fx_app_unique_key as claim
          where claim.scope_uuid = ${scopeUuid.scopeUuid}
            and claim.constraint_id = definition.definition_id
            and claim.locale_key = ''
            and claim.table_id < definition.table_id
          order by claim.table_id desc, claim.row_id desc
          limit 1
        )
        union all
        (
          select 1 as invalid
          from fx_app_unique_key as claim
          where claim.scope_uuid = ${scopeUuid.scopeUuid}
            and claim.constraint_id = definition.definition_id
            and claim.locale_key = ''
            and claim.table_id > definition.table_id
          order by claim.table_id asc, claim.row_id asc
          limit 1
        )
        limit 1
      ) as invalid_claim
      limit 1
    `),
  );
  const rows = yield* decodeBuildDriverRows(driverResult, authority, snapshot);
  if (rows.length > 0) {
    return yield* Effect.fail(
      stateError(
        authority,
        snapshot,
        "validationMismatch",
        Object.freeze({ reason: "claimIdentityMismatch" as const }),
      ),
    );
  }
});

const backfillUniqueSetPage = Effect.fn(
  "AppUniqueConstraintBuild.backfillPage",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definition: LocatedAppUniqueConstraintDefinitionV1,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
  head: CommitSeq,
) {
  const candidates = yield* loadDefinitionCandidates(
    tx,
    authority,
    snapshot,
    state,
    definition,
    pageSize,
  );
  const page = candidates.slice(0, pageSize);
  let claimed = 0;
  let replayed = 0;
  let omitted = 0;
  for (const rowId of page) {
    const current = yield* readCurrentAppRowInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      tableId: definition.tableId,
      rowId,
    });
    const claim =
      current.kind === "live"
        ? yield* lowerValidationExpectation(
            authority,
            snapshot,
            definition,
            current,
          )
        : null;
    if (claim === null) {
      omitted += 1;
      continue;
    }
    const ensured = yield* ensureAppUniqueKeyBackfillClaimInTransactionEffect(
      tx,
      {
        scopeId: authority.scopeId,
        constraintId: definition.uniqueConstraintDefinitionId,
        tableId: definition.tableId,
        rowId,
        authorityEpoch: authority.epoch,
        claim,
      },
    );
    if (ensured.status === "claimed") {
      claimed += 1;
      yield* runFault(options, "afterBackfillClaim");
    } else replayed += 1;
  }
  const done = candidates.length <= pageSize;
  const lifecycle = done ? "validating" : "backfilling";
  const cursor = done ? null : page.at(-1)!;
  yield* transitionBuildLifecycle(
    tx,
    authority,
    snapshot,
    state,
    lifecycle,
    cursor,
    options,
    head,
  );
  return backfillResult(
    authority,
    snapshot,
    state,
    "advanced",
    lifecycle,
    page.length,
    claimed,
    replayed,
    omitted,
    cursor,
  );
});

const decodeBuildDriverRows = Effect.fn(
  "AppUniqueConstraintBuild.decodeDriverRows",
)(function* (
  driver: unknown,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
) {
  const invalid = stateError(authority, snapshot, "storedStateInvalid");
  return yield* Effect.try({
    try: () =>
      rowsFromDriverExecuteResult(driver, () => {
        throw invalid;
      }),
    catch: (cause) => cause,
  }).pipe(
    // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: compatibility - Drizzle result wrapper decoding distinguishes the invalid-shape sentinel from getter defects.
    Effect.catch((cause) =>
      cause === invalid ? Effect.fail(invalid) : Effect.die(cause),
    ),
  );
});

const CandidateRowSchema = Schema.Struct({
  rowId: Schema.Uint8Array.check(
    Schema.makeFilter((value) => value.byteLength === 16),
  ),
});
const decodeCandidateRowsResult = Schema.decodeUnknownResult(
  Schema.Array(CandidateRowSchema),
);
const loadDefinitionCandidates = Effect.fn(
  "AppUniqueConstraintBuild.loadCandidates",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definition: LocatedAppUniqueConstraintDefinitionV1,
  pageSize: number,
) {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId),
  ).pipe(
    Effect.mapError((cause) =>
      stateError(authority, snapshot, "storedStateInvalid", cause),
    ),
  );
  const afterCurrent =
    state.cursorRowId === null
      ? sql`true`
      : sql`current_row.row_id > ${state.cursorRowId}::bytea`;
  const afterClaim =
    state.cursorRowId === null
      ? sql`true`
      : sql`claim.row_id > ${state.cursorRowId}::bytea`;
  const query = tx.execute(sql`select identity.row_id as "rowId" from (
      (select current_row.row_id from fx_app_row_current as current_row where current_row.scope_uuid = ${scope.scopeUuid} and current_row.table_id = ${definition.tableId} and ${afterCurrent} order by current_row.row_id limit ${pageSize + 1})
      union
      (select claim.row_id from fx_app_unique_key as claim where claim.scope_uuid = ${scope.scopeUuid} and claim.constraint_id = ${definition.uniqueConstraintDefinitionId} and claim.table_id = ${definition.tableId} and claim.locale_key = '' and ${afterClaim} order by claim.row_id limit ${pageSize + 1})
    ) as identity order by identity.row_id limit ${pageSize + 1}`);
  const driver = yield* queryEffect(query);
  const rawRows = yield* decodeBuildDriverRows(driver, authority, snapshot);
  const rows = yield* Effect.fromResult(
    decodeCandidateRowsResult(rawRows),
  ).pipe(
    Effect.mapError((cause) =>
      stateError(authority, snapshot, "storedStateInvalid", cause),
    ),
  );
  const ids: AppRowIdHexV1[] = [];
  for (const row of rows)
    ids.push(
      yield* Effect.fromResult(appRowIdHexV1FromBytesResult(row.rowId)).pipe(
        Effect.mapError((cause) =>
          stateError(authority, snapshot, "storedStateInvalid", cause),
        ),
      ),
    );
  return ids;
});

const transitionBuildLifecycle = Effect.fn(
  "AppUniqueConstraintBuild.transition",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  lifecycle: Exclude<BuildState["lifecycle"], "declared">,
  cursorRowId: AppRowIdHexV1 | null,
  options: AppUniqueConstraintSetBuildOptionsV1,
  coveredThroughCommitSeq: CommitSeq | null = state.coveredThroughCommitSeq,
) {
  const updated = yield* queryEffect(
    tx
      .update(fxSystemUniqueConstraintBuilds)
      .set({
        lifecycle,
        coveredThroughCommitSeq,
        cursorRowId:
          cursorRowId === null ? null : appRowIdHexV1ToBytes(cursorRowId),
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
          eq(
            fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
            state.uniqueConstraintDefinitionId,
          ),
          eq(fxSystemUniqueConstraintBuilds.attemptFence, state.attemptFence),
          eq(fxSystemUniqueConstraintBuilds.lifecycle, state.lifecycle),
          eq(fxSystemUniqueConstraintBuilds.epoch, authority.epoch),
          eq(
            fxSystemUniqueConstraintBuilds.storageGenerationFence,
            authority.storageGenerationFence,
          ),
        ),
      )
      .returning({ attemptFence: fxSystemUniqueConstraintBuilds.attemptFence }),
  );
  if (updated.length !== 1)
    return yield* Effect.fail(
      stateError(authority, snapshot, "concurrentStateChange"),
    );
  yield* runFault(
    options,
    lifecycle === "validating" || lifecycle === "enabled"
      ? "afterValidationLifecycleTransition"
      : "afterBackfillLifecycleTransition",
  );
});

function backfillResult(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState | null,
  status: AdvanceAppUniqueConstraintSetBackfillV1Result["status"],
  lifecycle: AdvanceAppUniqueConstraintSetBackfillV1Result["lifecycle"],
  scanned: number,
  claimed: number,
  replayed: number,
  omitted: number,
  cursorRowId: AppRowIdHexV1 | null,
): AdvanceAppUniqueConstraintSetBackfillV1Result {
  return Object.freeze({
    status,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    lifecycle,
    scanned,
    claimed,
    replayed,
    omitted,
    uniqueConstraintDefinitionId: state?.uniqueConstraintDefinitionId ?? null,
    cursorRowId,
    attemptFence: state?.attemptFence ?? null,
  });
}

/** Selected serving definitions consume their genuine Application or binding
 * maintenance suffix. Unbound candidates retain explicit build coverage. */
export const prepareActiveUniqueCoverageInTransactionEffect = Effect.fn(
  "AppUniqueConstraintBuild.prepareActiveCoverage",
)(function* (
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  schemaVersionId: CatalogSchemaVersionId,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  context: IndexCoverageContext,
  publicationProfile: import("../indexes/indexBuildStates").IndexPublicationProfile,
  sourceBoundBatch = false,
  indexFrontierTableIds: ReadonlyArray<CatalogTableId> = [],
) {
  if (definitions.length === 0) return Object.freeze([]);
  const snapshot = { schemaVersionId, members: definitions };
  const rows = yield* queryEffect(
    tx
      .select(uniqueConstraintBuildStateSelection())
      .from(fxSystemUniqueConstraintBuilds)
      .leftJoin(fxSystemUniqueMaintenanceObligations, uniqueMaintenanceBindingPredicate())
      .where(
        and(
          eq(fxSystemUniqueConstraintBuilds.scopeId, clock.scopeId),
          inArray(
            fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
            definitions.map((value) => value.uniqueConstraintDefinitionId),
          ),
        ),
      )
      .orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId)
      .limit(definitions.length + 1)
      .for(publicationProfile === "sourceBound" ? "no key update" : context.active === null ? "update" : "share", { of: fxSystemUniqueConstraintBuilds }),
  );
  if (rows.length !== definitions.length)
    return yield* Effect.fail(stateError(clock, snapshot, "buildMissing"));
  const states: BuildState[] = [];
  let frontierBatchPrepared = false;
  for (const row of rows) {
    const definition = definitions.find(value => value.uniqueConstraintDefinitionId === row.uniqueConstraintDefinitionId);
    if (definition === undefined) return yield* Effect.fail(stateError(clock, snapshot, "storedStateInvalid"));
    const selectedSnapshot = { schemaVersionId: definition.schemaVersionId, members: definitions };
    const state = yield* decodeUniqueBuildStateEffect(
      clock,
      selectedSnapshot,
      row,
      clock.lastCommitSeq,
    );
    if (
      state.lifecycle !== "enabled" ||
      state.coveredThroughCommitSeq === null ||
      !buildAuthorityIsCurrent(state, clock)
    )
      return yield* Effect.fail(stateError(clock, selectedSnapshot, "coverageMissing"));
    const mode = publicationModeForTable(publicationProfile, definition.tableId);
    if ((mode === "activeApplication" && context.active !== null && state.maintenance === null) ||
      (mode === "sourceBound" && context.binding?.schemaVersionId === definition.schemaVersionId && state.maintenance === null) ||
      (typeof publicationProfile !== "string" && mode === "activeApplication" && context.active === null)) {
      return yield* Effect.fail(stateError(clock, selectedSnapshot, "coverageMissing"));
    }
    const maintenanceSchemaVersionId = typeof publicationProfile !== "string" && mode === "activeApplication"
      ? context.active?.schema.schemaVersionId : definition.schemaVersionId;
    if (state.maintenance !== null && ((state.maintenance.authorityKind === "binding" && state.maintenance.schemaVersionId !== maintenanceSchemaVersionId) ||
      state.maintenance.deploymentId !== definition.deploymentId)) {
      return yield* Effect.fail(stateError(clock, selectedSnapshot, "storedStateInvalid"));
    }
    let tableFrontiers: UniqueTableFrontiers | undefined;
    if (state.maintenance === null && state.coveredThroughCommitSeq < clock.lastCommitSeq) {
      if (!frontierBatchPrepared) {
        yield* readIndexCoverageTableFrontiersInTransactionEffect(tx, context,
          [...new Set([...indexFrontierTableIds, ...definitions.map(member => member.tableId)])]).pipe(
          Effect.mapError(cause => cause instanceof AppRowReadPersistenceError
            ? new AppUniqueConstraintSetBuildIntegrationV1Error({ phase: "targetTransaction", retryable: true, cause })
            : stateError(clock, selectedSnapshot, "storedStateInvalid", cause)));
        frontierBatchPrepared = true;
      }
      tableFrontiers = (yield* Effect.fromResult(readPreparedIndexCoverageTableFrontiers(
        tx, clock, context, [definition.tableId])).pipe(Effect.mapError(cause =>
          stateError(clock, selectedSnapshot, "storedStateInvalid", cause)))) ?? undefined;
    }
    if (!(yield* inspectDefinitionCoverageEffect(tx, clock, selectedSnapshot, state, definition.tableId,
      clock, context, tableFrontiers))) {
      return yield* Effect.fail(stateError(clock, selectedSnapshot, "coverageMissing"));
    }
    // A source-bound build may lag the scope clock when other tables changed.
    // Record the proved table-local coverage before a batch writes its first
    // page; later pages must not mistake this transaction's own rows for an
    // uncovered committed write.
    if (sourceBoundBatch && mode === "sourceBound" && state.maintenance === null && state.coveredThroughCommitSeq < clock.lastCommitSeq)
      yield* advanceUnboundUniqueCoverageInTransactionEffect(tx,
        [{ state, schemaVersionId: definition.schemaVersionId }], clock.lastCommitSeq);
    states.push(state);
  }
  return Object.freeze(states);
});

export interface PreparedUnboundUniqueCoverageApplication {
  readonly selected: ReadonlyArray<Readonly<{ state: BuildState; schemaVersionId: CatalogSchemaVersionId }>>;
  readonly rows: readonly UniqueCoverageWrite[];
}
export function prepareUnboundUniqueCoverageApplicationResult(selected: PreparedUnboundUniqueCoverageApplication["selected"]) {
  return Result.gen(function* () {
    const seen = new Set<CatalogUniqueConstraintDefinitionId>();
    for (const { state, schemaVersionId } of selected) {
      if (state.maintenance !== null) continue;
      if (seen.has(state.uniqueConstraintDefinitionId))
        return yield* Result.fail(stateError(state, { schemaVersionId }, "storedStateInvalid"));
      seen.add(state.uniqueConstraintDefinitionId);
    }
    const maintained = selected.filter(({ state }) => state.maintenance === null);
    if (maintained.length > APPLICATION_COVERAGE_MAX_ROWS) {
      // SAFETY: the nonnegative bound was exceeded, so the retained input is nonempty.
      const first = maintained[0]!;
      return yield* Result.fail(stateError(first.state, { schemaVersionId: first.schemaVersionId }, "storedStateInvalid"));
    }
    return { selected: maintained, rows: maintained.map(member => member.state) };
  });
}

/** Unmaintained definitions advance explicit progress, including source-bound publication. */
export const advanceUnboundUniqueCoverageInTransactionEffect = Effect.fn(
  "AppUniqueConstraintBuild.advanceUnboundCoverage",
)(function* (
  tx: AppRowTransaction,
  selected: ReadonlyArray<Readonly<{ state: BuildState; schemaVersionId: CatalogSchemaVersionId }>>,
  commitSeq: CommitSeq,
  publicationObservation?: PointCommitPublicationObservation,
) {
  const prepared = yield* Effect.fromResult(prepareUnboundUniqueCoverageApplicationResult(selected));
  const maintained = prepared.selected;
  const proofs: CoverageProof<UniqueCoverageWrite>[] = [];
  // Rows are selected under the publication scope lock. A bounded statement
  // retains the exact fences and freshly proves the complete stored rows.
  for (let offset = 0; offset < maintained.length; offset += 32) {
    const batch = maintained.slice(offset, offset + 32);
    const final = offset + batch.length === maintained.length;
    const applied = yield* applyApplicationCoverage(tx, [], batch.map(member => member.state), commitSeq, undefined,
      final ? { indexes: [], unique: proofs } : undefined).pipe(
      Effect.mapError(cause => {
        if (cause instanceof ApplicationCoveragePersistenceError) return new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction", retryable: isRetryableSqlTransactionCause(
            cause.cause instanceof DrizzleQueryError ? cause.cause.cause : cause.cause), cause: cause.cause });
        const member = cause.stage === "verify" && final ? maintained[cause.ordinal] : batch[cause.ordinal];
        if (member === undefined) return stateError(batch[0]!.state, { schemaVersionId: batch[0]!.schemaVersionId }, "storedStateInvalid", cause);
        return stateError(member.state, { schemaVersionId: member.schemaVersionId },
          cause.reason === "concurrentStateChange" ? "concurrentStateChange" : "storedStateInvalid", cause);
      }));
    proofs.push(...applied.unique);
    if (publicationObservation?.detail) publicationObservation.record({ kind: "batch", owner: "uniqueCoverage", counts: { rows: batch.length } });

  }
});

const reconcileInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.reconcileInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  invalidateAcceptedApplicationBindingInTransaction(tx);
  invalidateSharedLogicalSourceBindingChecks(tx);
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const states = (yield* loadSelectedBuildStates(tx, authority, snapshot, clock)).states;
  const identities: AppUniqueConstraintBuildIdentity[] = [];
  let created = 0;
  let redeclared = 0;
  const missing = snapshot.members.length - states.length;
  if (missing > 0) {
    const directory = yield* queryEffect(
      tx
        .select({
          id: fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
        })
        .from(fxSystemUniqueConstraintBuilds)
        .where(eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId))
        .limit(MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE + 1),
    );
    if (directory.length + missing > MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE)
      return yield* Effect.fail(
        new AppUniqueConstraintSetBuildDirectoryV1Error({
          scopeId: authority.scopeId,
          reason: "tooManyBuildRows",
          maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE,
        }),
      );
  }
  for (const member of snapshot.members) {
    const existing = states.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId,
    );
    if (existing && buildAuthorityIsCurrent(existing, clock)) {
      identities.push(buildIdentity(existing, member.tableId));
      continue;
    }
    if (existing?.lifecycle === "enabled")
      return yield* Effect.fail(
        stateError(
          authority,
          snapshot,
          "concurrentStateChange",
          "An enabled physical constraint cannot be redeclared",
        ),
      );
    if (
      existing &&
      existing.attemptFence >=
        MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1
    )
      return yield* Effect.fail(
        stateError(authority, snapshot, "attemptFenceExhausted"),
      );
    const attemptFence = AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(
      (existing?.attemptFence ?? 0n) + 1n,
    );
    const values = {
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      startCommitSeq: clock.lastCommitSeq,
      coveredThroughCommitSeq: null,
      lifecycle: "declared" as const,
      cursorRowId: null,
      attemptFence,
    };
    const written =
      existing === undefined
        ? yield* queryEffect(
            insertUniqueConstraintBuild(tx, {
                scopeId: authority.scopeId,
                uniqueConstraintDefinitionId:
                  member.uniqueConstraintDefinitionId,
                ...values,
              }),
          )
        : yield* queryEffect(
            tx
              .update(fxSystemUniqueConstraintBuilds)
              .set({ ...values, updatedAt: sql`clock_timestamp()` })
              .where(
                and(
                  eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
                  eq(
                    fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
                    member.uniqueConstraintDefinitionId,
                  ),
                  eq(
                    fxSystemUniqueConstraintBuilds.attemptFence,
                    existing.attemptFence,
                  ),
                ),
              )
              .returning(),
          );
    if (written.length !== 1 || !written[0])
      return yield* Effect.fail(
        stateError(authority, snapshot, "concurrentStateChange"),
      );
    const state = yield* decodeUniqueBuildStateEffect(
      authority,
      snapshot,
      { ...written[0], maintenanceObligation: null },
      clock.lastCommitSeq,
    );
    identities.push(buildIdentity(state, member.tableId));
    if (existing === undefined) {
      created += 1;
      yield* runFault(options, "afterBuildInsert");
    } else {
      redeclared += 1;
      yield* runFault(options, "afterStaleBuildRedeclare");
    }
  }
  return result(
    authority,
    snapshot,
    redeclared > 0 ? "redeclared" : created > 0 ? "created" : "replayed",
    identities,
  );
});

const observeUncertainCompletion = Effect.fn(
  "AppUniqueConstraintSetBuild.observeUncertainCompletion",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  transactionCause: unknown,
) {
  const started = startLocatedEffectTransaction(
    target,
    "C08-B1 unique-set uncertainty observation rolled back.",
    (tx) => observeInTransaction(tx, authority, snapshot),
  );
  const settled = yield* awaitTransactionExit(started.promise);
  if (Exit.isFailure(settled)) {
    const failure = Cause.findErrorOption(settled.cause);
    if (failure._tag === "None") return yield* Effect.die(settled.cause);
    const cause = failure.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(
        Cause.combine(
          callbackCause,
          Cause.die(
            new AppUniqueConstraintSetBuildIntegrationV1Error({
              phase: "targetTransaction",
              retryable: false,
              cause,
            }),
          ),
        ),
      );
    }
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    );
  }
  const observed = settled.value;
  if (observed === null) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetBuildDecisionUncertainV1Error({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        cause: transactionCause,
      }),
    );
  }
  return result(
    authority,
    snapshot,
    "replayedAfterUncertainCompletion",
    observed,
  );
});

const observeInTransaction = Effect.fn(
  "AppUniqueConstraintBuild.observeInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
) {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const states = (yield* loadSelectedBuildStates(tx, authority, snapshot, clock)).states;
  const identities: AppUniqueConstraintBuildIdentity[] = [];
  for (const member of snapshot.members) {
    const state = states.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId,
    );
    if (!state || !buildAuthorityIsCurrent(state, clock)) return null;
    identities.push(buildIdentity(state, member.tableId));
  }
  return Object.freeze(identities);
});

// The accepting readiness/maintenance/publication operation owns diagnostics;
// raw row decoding stays inside that caller's existing quiet observation span.
export const decodeUniqueBuildStateEffect = Effect.fnUntraced(function* (
  authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  row: unknown,
  currentLastCommitSeq: bigint,
) {
  const state = yield* decodeBuildState(row).pipe(
    Effect.mapError((cause) =>
      stateError(authority, snapshot, "storedStateInvalid", cause),
    ),
  );
  yield* Effect.fromResult(acceptUniqueBuildFrontierResult(authority, snapshot, state, currentLastCommitSeq));
  const maintenance = state.maintenanceObligation === null ? null : yield* decodeUniqueMaintenanceObligationEffect(state.maintenanceObligation).pipe(
    Effect.mapError(cause => stateError(authority, snapshot, "storedStateInvalid", cause)));
  return yield* Effect.fromResult(acceptUniqueBuildMaintenanceResult(authority, snapshot, state, maintenance));
});

function acceptUniqueBuildFrontierResult(
  authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  state: typeof BuildStateSchema.Type,
  currentLastCommitSeq: bigint,
) {
  return Result.gen(function* () {
    if (
      state.scopeId !== authority.scopeId ||
      !snapshot.members.some(
        (member) =>
          member.uniqueConstraintDefinitionId ===
          state.uniqueConstraintDefinitionId,
      ) ||
      !Number.isFinite(state.createdAt.getTime()) ||
      !Number.isFinite(state.updatedAt.getTime()) ||
      state.updatedAt.getTime() < state.createdAt.getTime() ||
      ((state.lifecycle === "declared" ||
        state.lifecycle === "building" ||
        state.lifecycle === "enabled") &&
        state.cursorRowId !== null) ||
      ((state.lifecycle === "declared" || state.lifecycle === "building") &&
        state.coveredThroughCommitSeq !== null) ||
      (state.lifecycle === "enabled" && state.coveredThroughCommitSeq === null) ||
      (state.coveredThroughCommitSeq !== null &&
        state.coveredThroughCommitSeq < state.startCommitSeq)
    )
      return yield* Result.fail(
        stateError(authority, snapshot, "storedStateInvalid"),
      );
    if (
      state.startCommitSeq > currentLastCommitSeq ||
      (state.coveredThroughCommitSeq !== null &&
        state.coveredThroughCommitSeq > currentLastCommitSeq)
    )
      return yield* Result.fail(
        stateError(authority, snapshot, "frontierAheadOfClock"),
      );
  });
}

function acceptUniqueBuildMaintenanceResult(
  authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  state: typeof BuildStateSchema.Type,
  maintenance: UniqueMaintenanceObligation | null,
) {
  return Result.gen(function* () {
    if ((state.maintenanceActivationSequence === null) !== (maintenance === null) || (state.maintenanceAuthorityKind === null) !== (maintenance === null))
      return yield* Result.fail(stateError(authority, snapshot, "storedStateInvalid", "Maintenance binding and obligation disagree"));
    if (maintenance !== null) {
      if (state.lifecycle !== "enabled" || maintenance.scopeId !== state.scopeId ||
        maintenance.authorityKind !== state.maintenanceAuthorityKind || maintenance.activationSequence !== state.maintenanceActivationSequence ||
        maintenance.uniqueConstraintDefinitionId !== state.uniqueConstraintDefinitionId || maintenance.storageGeneration !== state.storageGeneration ||
        maintenance.storageGenerationFence !== state.storageGenerationFence || maintenance.epoch !== state.epoch ||
        maintenance.startCommitSeq !== state.startCommitSeq || maintenance.attemptFence !== state.attemptFence ||
        maintenance.openedCommitSeq !== state.coveredThroughCommitSeq) {
        return yield* Result.fail(stateError(authority, snapshot, "storedStateInvalid", "Maintenance obligation does not match build state"));
      }
    }
    return Object.freeze({
      scopeId: state.scopeId,
      uniqueConstraintDefinitionId: state.uniqueConstraintDefinitionId,
      startCommitSeq: state.startCommitSeq,
      coveredThroughCommitSeq: state.coveredThroughCommitSeq,
      maintenanceActivationSequence: state.maintenanceActivationSequence, maintenanceAuthorityKind: state.maintenanceAuthorityKind,
      attemptFence: state.attemptFence,
      storageGeneration: state.storageGeneration,
      storageGenerationFence: state.storageGenerationFence,
      epoch: state.epoch,
      lifecycle: state.lifecycle,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      maintenance,
      cursorRowId:
        state.cursorRowId === null ? null : new Uint8Array(state.cursorRowId),
    });
  });
}

function requireExactAuthorityResult(
  expected: TrustedScopeAuthority,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
) {
  if (
    expected.storageGeneration !== "flarexdb_v1" ||
    current.storageGeneration !== expected.storageGeneration
  ) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: expected.scopeId,
        reason: "storageGeneration",
      }),
    );
  }
  if (current.storageGenerationFence !== expected.storageGenerationFence) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: expected.scopeId,
        reason: "storageGenerationFence",
      }),
    );
  }
  if (current.epoch !== expected.epoch) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: expected.scopeId,
        reason: "epoch",
      }),
    );
  }
  return Result.succeed(undefined);
}

function buildAuthorityIsCurrent(
  state: BuildState,
  clock: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
): boolean {
  return (
    state.storageGeneration === clock.storageGeneration &&
    state.storageGenerationFence === clock.storageGenerationFence &&
    state.epoch === clock.epoch
  );
}

function requireCurrentBuildAuthorityResult(
  authority: TrustedScopeAuthority,
  state: BuildState,
  clock: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: StorageGenerationFence;
    readonly epoch: string;
  },
) {
  if (state.storageGeneration !== clock.storageGeneration) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: authority.scopeId,
        reason: "storageGeneration",
      }),
    );
  }
  if (state.storageGenerationFence !== clock.storageGenerationFence) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: authority.scopeId,
        reason: "storageGenerationFence",
      }),
    );
  }
  if (state.epoch !== clock.epoch) {
    return Result.fail(
      new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
        scopeId: authority.scopeId,
        reason: "epoch",
      }),
    );
  }
  return Result.succeed(undefined);
}

function runFault(
  options: AppUniqueConstraintSetBuildOptionsV1,
  point: AppUniqueConstraintSetBuildFaultPointV1,
) {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.try({
        try: () => options.faultAfter?.(point),
        catch: (cause) =>
          new AppUniqueConstraintSetBuildIntegrationV1Error({
            phase: "targetTransaction",
            retryable: true,
            cause,
          }),
      });
}

function queryEffect<Value>(query: PromiseLike<Value>) {
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => query,
      catch: (cause) =>
        new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction",
          retryable: isRetryableSqlTransactionCause(cause instanceof DrizzleQueryError ? cause.cause : cause),
          cause,
        }),
    }),
  );
}

interface StartedLocatedEffectTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/** The single audited Effect runtime bridge for this driver callback owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  rollbackMessage: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedLocatedEffectTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(rollbackMessage);
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
  });
}

const awaitTransactionExit = Effect.fn(
  "AppUniqueConstraintSetBuild.awaitTransactionExit",
)(function* <Value>(promise: Promise<Value>) {
  return yield* Effect.uninterruptible(
    Effect.exit(
      Effect.tryPromise({
        try: () => promise,
        catch: (cause) => cause,
      }),
    ),
  );
});

function stateError(
  authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId">,
  reason: AppUniqueConstraintSetBuildStateV1Error["reason"],
  cause?: unknown,
) {
  return new AppUniqueConstraintSetBuildStateV1Error({
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    reason,
    cause,
  });
}

function reclamationError(
  authority: TrustedScopeAuthority,
  snapshot: Pick<BuildSnapshot, "deploymentId" | "schemaVersionId">,
  reason: AppUniqueConstraintSetBuildReclamationError["reason"],
  retryable: boolean,
  cause?: unknown,
) {
  return new AppUniqueConstraintSetBuildReclamationError({
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    reason,
    retryable,
    cause,
  });
}

function reclamationAbsentResult(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  disposition: "already_absent" | "replayedAfterUncertainCompletion",
): ReclaimSupersededAppUniqueConstraintSetBuildResult {
  return Object.freeze({
    status: "reclaimed",
    disposition,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
  });
}

function result(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  disposition: Extract<
    ReconcileAppUniqueConstraintSetBuildV1Result,
    { status: "reconciled" }
  >["disposition"],
  definitionBuilds: ReadonlyArray<AppUniqueConstraintBuildIdentity>,
): Extract<
  ReconcileAppUniqueConstraintSetBuildV1Result,
  { status: "reconciled" }
> {
  return Object.freeze({
    status: "reconciled",
    disposition,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    definitionCount: snapshot.definitionCount,
    definitionSetSha256Hex: snapshot.definitionSetSha256Hex,
    definitionBuilds: Object.freeze([...definitionBuilds]),
  });
}

export function appUniqueConstraintEligibilityFrame(
  eligibility: Exclude<
    AppUniqueConstraintSetEligibilityResultV1,
    { readonly status: "not_ready" }
  >,
): Readonly<Record<string, Json>> {
  if (eligibility.status === "not_required") {
    return Object.freeze({
      format: "flarex.application-unique-constraint-eligibility",
      version: 1,
      status: "not_required",
      tableIds: [],
    });
  }
  const evidence = eligibility.evidence;
  return Object.freeze({
    format: "flarex.application-unique-constraint-eligibility",
    version: 1,
    status: "eligible",
    deploymentId: evidence.deploymentId,
    scopeId: evidence.scopeId,
    schemaVersionId: evidence.schemaVersionId,
    definitionCount: evidence.definitionCount,
    definitionSetSha256: evidence.definitionSetSha256Hex,
    tableIds: [...evidence.tableIds],
    storageGeneration: evidence.storageGeneration,
    storageGenerationFence: evidence.storageGenerationFence.toString(),
    epoch: evidence.epoch,
    definitionBuilds: evidence.definitionBuilds.map((build) => ({
      uniqueConstraintDefinitionId: build.uniqueConstraintDefinitionId,
      tableId: build.tableId,
      startCommitSeq: build.startCommitSeq.toString(),
      attemptFence: build.attemptFence.toString(),
    })),
  });
}
