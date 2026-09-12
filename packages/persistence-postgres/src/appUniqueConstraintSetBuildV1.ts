import type { Json } from "flarex-protocol/json";
import {
  readCommitFeedPageInTransactionV1Effect,
  CommitFeedSqlErrorV1,
  MAX_COMMIT_FEED_PAGE_COMMITS_V1,
} from "./commitFeed";
import {
  isPhysicalUniqueBuildActiveInTransactionEffect,
  PhysicalDefinitionLifecyclePersistenceError,
} from "./physicalDefinitionLifecycle";
import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  type LocatedAppUniqueConstraintDefinitionV1,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import {
  ensureAppUniqueKeyBackfillClaimInTransactionEffect,
  applyAppUniqueKeyMutationInTransactionEffect,
  readAppUniqueKeyOwnersInTransactionEffect,
  drainInitialAppUniqueKeyClaimsInTransactionEffect,
  type ApplyAppUniqueKeyMutationV1Error,
  type EnsureAppUniqueKeyBackfillClaimV1Error,
  validateAppUniqueKeyClaimInTransactionEffect,
  type ValidateAppUniqueKeyClaimV1Error,
} from "./appUniqueKeys";
import {
  readAppUniqueConstraintSetClosureV1Effect,
  type LocatedAppUniqueConstraintSetClosureV1,
  type ReadAppUniqueConstraintSetClosureV1Error,
} from "./appUniqueConstraintSetClosureV1";
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
} from "./appSchemaCandidateValidation";
import { readApplicationActiveRevisionForShareInTransactionEffect } from "./applicationActiveHeadRead";
import {
  readCurrentAppRowInTransactionEffect,
  AppRowReadPersistenceError,
  readAppTableWriteFrontierInTransactionEffect,
  type AppRowReadResultV1,
  type AppRowTransaction,
  type ReadAppRowError,
} from "./appRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  getScopeClock,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import { fxSystemUniqueConstraintBuilds } from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from "./transactionSessionActivation";

const INPUT_KEYS = Object.freeze(["deploymentId", "schemaVersionId"] as const);
const BACKFILL_INPUT_KEYS = Object.freeze([
  "deploymentId",
  "schemaVersionId",
  "pageSize",
] as const);
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);

export interface ReconcileAppUniqueConstraintSetBuildV1Input {
  readonly deploymentId: string;
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
  runReadCommitted: RunLocatedReadCommittedTransactionV1 = createDefaultLocatedReadCommittedTransactionRunnerV1(
    db,
  ),
): LocatedAppUniqueConstraintSetBuildTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
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
const eligibilityEvidenceSnapshots = new WeakMap<object, BuildSnapshot>();
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

/** Exact issuer composition for consumers that combine eligibility evidence. */
export function hasAppUniqueConstraintSetEligibilityEvidenceCompositionV1(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts,
): value is AppUniqueConstraintSetEligibilityEvidenceV1 {
  if (typeof value !== "object" || value === null) return false;
  const port = eligibilityEvidencePorts.get(value);
  return (
    port !== undefined &&
    hasAppUniqueConstraintSetEligibilityCompositionV1(
      port,
      controlDb,
      authority,
    )
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
      return yield* loadEligibilityWithClockLock(port, input, "share");
    },
  );

const loadEligibilityWithClockLock = Effect.fn(
  "AppUniqueConstraintSetBuild.loadEligibilityWithClockLock",
)(function* (
  port: AppUniqueConstraintSetEligibilityPortV1,
  input: AppUniqueConstraintSetEligibilityInputV1,
  clockLock: "share" | "update",
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
  const closure = yield* readAppUniqueConstraintSetClosureV1Effect(
    ports.controlDb,
    input.deploymentId,
    input.schemaVersionId,
  );
  if (closure === null) {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "setNotClosed" as const,
      blocksAllTables: true,
      tableIds: [] as const,
    });
  }
  if (closure.members.length === 0) {
    return Object.freeze({
      status: "not_required" as const,
      tableIds: [] as const,
    });
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    input.deploymentId,
    ports.authority,
  );
  if (located.authority.scopeId !== input.scopeId) {
    return yield* Effect.fail(
      new AppUniqueConstraintSetEligibilityV1Error({
        reason: "scopeMismatch",
        retryable: false,
      }),
    );
  }
  const snapshot = buildSnapshot(input, closure);
  const tableIds = uniqueConstraintTableIds(closure);
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
    "invalidInputShape" | "invalidDeploymentId" | "invalidSchemaVersionId";
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
type BuildState = typeof BuildStateSchema.Type;
const decodeBuildStateResult = Schema.decodeUnknownResult(
  Schema.toType(BuildStateSchema),
);

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
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
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
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    ports.authority,
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
  const definitions =
    yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(
      ports.controlDb,
      decoded.deploymentId,
      located.authority.scopeId,
      decoded.schemaVersionId,
      tableIds,
      locatedClosure.members.length,
    );
  if (
    definitions === null ||
    !definitionsMatchClosure(definitions, locatedClosure)
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
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    state.ports.authority,
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
    return Object.freeze({
      deploymentId: input.deploymentId,
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

function definitionsMatchClosure(
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  closure: LocatedAppUniqueConstraintSetClosureV1,
): boolean {
  if (definitions.length !== closure.members.length) return false;
  return definitions.every((definition, index) => {
    const member = closure.members[index];
    return (
      member !== undefined &&
      definition.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId &&
      definition.logicalUniqueConstraintId ===
        member.logicalUniqueConstraintId &&
      definition.tableId === member.tableId &&
      definition.physicalSpecSha256Hex === member.physicalSpecSha256Hex
    );
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
  clockLock: "share" | "update",
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  | AppUniqueConstraintSetEligibilityV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | LockScopeClockForShareError
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
  clockLock: "share" | "update",
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError
> {
  const clock = yield* clockLock === "share"
    ? lockScopeClockForShareInTransactionEffect(tx, authority.scopeId)
    : lockScopeClockForUpdateInTransactionEffect(tx, authority.scopeId);
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  return yield* inspectEligibilityWithLockedClock(
    tx,
    authority,
    snapshot,
    tableIds,
    clock,
    port,
  );
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
      eligibilityEvidenceSnapshots.get(evidence)!,
      evidence.tableIds,
      clock,
      port,
      evidence,
    );
  });

const inspectEligibilityWithLockedClock = Effect.fn(
  "AppUniqueConstraintSetBuild.inspectEligibilityWithLockedClock",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  tableIds: ReadonlyArray<CatalogTableId>,
  clock: ScopeClockRecord,
  port: AppUniqueConstraintSetEligibilityPortV1,
  expectedEvidence?: AppUniqueConstraintSetEligibilityEvidenceV1,
) {
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
  const identities: AppUniqueConstraintBuildIdentity[] = [];
  for (const member of snapshot.members) {
    const state = states.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId,
    );
    const reason =
      state === undefined
        ? "buildMissing"
        : !buildAuthorityIsCurrent(state, clock)
          ? "buildStale"
          : state.lifecycle !== "enabled"
            ? "buildNotEnabled"
            : !(yield* hasDefinitionCoverage(
                  tx,
                  authority,
                  snapshot,
                  state,
                  member.tableId,
                  clock.lastCommitSeq,
                ))
              ? "buildStale"
              : null;
    if (reason !== null)
      return Object.freeze({
        status: "not_ready" as const,
        reason,
        blocksAllTables: false,
        tableIds,
        ...(state === undefined ? {} : { lifecycle: state.lifecycle }),
      });
    if (state === undefined)
      return yield* Effect.die(
        "Selected build disappeared after readiness inspection",
      );
    const identity = buildIdentity(state, member.tableId);
    const expected = expectedEvidence?.definitionBuilds.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId,
    );
    if (
      expectedEvidence !== undefined &&
      (expected === undefined ||
        expected.tableId !== identity.tableId ||
        expected.startCommitSeq !== identity.startCommitSeq ||
        expected.attemptFence !== identity.attemptFence)
    )
      return Object.freeze({
        status: "not_ready" as const,
        reason: "buildStale" as const,
        blocksAllTables: false,
        tableIds,
        lifecycle: state.lifecycle,
      });
    identities.push(identity);
  }
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
    storageGenerationFence: clock.storageGenerationFence,
    epoch: authority.epoch,
    definitionBuilds: Object.freeze(identities),
    [eligibilityEvidenceBrand]: true as const,
  });
  eligibilityEvidencePorts.set(evidence, port);
  eligibilityEvidenceSnapshots.set(evidence, snapshot);
  return Object.freeze({ status: "eligible" as const, evidence });
});

const loadSelectedBuildStates = Effect.fn(
  "AppUniqueConstraintBuild.loadSelected",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  clock: ScopeClockRecord,
) {
  if (snapshot.members.length === 0) return Object.freeze([]);
  const rows = yield* queryEffect(
    tx
      .select()
      .from(fxSystemUniqueConstraintBuilds)
      .where(
        and(
          eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
          inArray(
            fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
            snapshot.members.map((value) => value.uniqueConstraintDefinitionId),
          ),
        ),
      )
      .orderBy(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId)
      .limit(snapshot.members.length + 1)
      .for("share"),
  );
  if (rows.length > snapshot.members.length)
    return yield* Effect.fail(
      stateError(authority, snapshot, "storedStateInvalid"),
    );
  const states: BuildState[] = [];
  for (const row of rows)
    states.push(
      yield* decodeBuildStateEffect(
        authority,
        snapshot,
        row,
        clock.lastCommitSeq,
      ),
    );
  return Object.freeze(states);
});

const hasDefinitionCoverage = Effect.fn("AppUniqueConstraintBuild.hasCoverage")(
  function* (
    tx: AppRowTransaction,
    authority: TrustedScopeAuthority,
    snapshot: BuildSnapshot,
    state: BuildState,
    tableId: CatalogTableId,
    head: CommitSeq,
  ) {
    if (state.coveredThroughCommitSeq === null) return false;
    if (state.coveredThroughCommitSeq >= head) return true;
    const frontier = yield* readAppTableWriteFrontierInTransactionEffect(
      tx,
      authority.scopeId,
      tableId,
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof AppRowReadPersistenceError
          ? new AppUniqueConstraintSetBuildIntegrationV1Error({
              phase: "targetTransaction",
              retryable: true,
              cause,
            })
          : stateError(authority, snapshot, "storedStateInvalid", cause),
      ),
    );
    return frontier === null || frontier <= state.coveredThroughCommitSeq;
  },
);

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
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
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
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
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
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
  let selected:
    | { state: BuildState; definition: LocatedAppUniqueConstraintDefinitionV1 }
    | undefined;
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
      !(yield* hasDefinitionCoverage(
        tx,
        authority,
        snapshot,
        state,
        definition.tableId,
        clock.lastCommitSeq,
      ))
    ) {
      pending += 1;
      selected ??= { state, definition };
    } else if (state.coveredThroughCommitSeq !== clock.lastCommitSeq) {
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
    !(yield* hasDefinitionCoverage(
      tx,
      authority,
      snapshot,
      state,
      definition.tableId,
      clock.lastCommitSeq,
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
    for (const owner of owners)
      yield* applyAppUniqueKeyMutationInTransactionEffect(tx, {
        scopeId: authority.scopeId,
        constraintId: owner.constraintId,
        tableId: owner.tableId,
        rowId: owner.rowId,
        writeEpoch: authority.epoch,
        previous: owner.projection,
        next: null,
      });
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
        lowered.canonical.kind === "claim" ? lowered.projection : null,
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

/** Selected active definitions alone participate in ordinary document publication. */
export const prepareActiveUniqueCoverageInTransactionEffect = Effect.fn(
  "AppUniqueConstraintBuild.prepareActiveCoverage",
)(function* (
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
  schemaVersionId: CatalogSchemaVersionId,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
) {
  if (definitions.length === 0) return Object.freeze([]);
  const snapshot = { schemaVersionId, members: definitions };
  const rows = yield* queryEffect(
    tx
      .select()
      .from(fxSystemUniqueConstraintBuilds)
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
      .for("update"),
  );
  if (rows.length !== definitions.length)
    return yield* Effect.fail(stateError(clock, snapshot, "buildMissing"));
  const states: BuildState[] = [];
  for (const row of rows) {
    const state = yield* decodeBuildStateEffect(
      clock,
      snapshot,
      row,
      clock.lastCommitSeq,
    );
    if (
      state.lifecycle !== "enabled" ||
      state.coveredThroughCommitSeq === null ||
      !buildAuthorityIsCurrent(state, clock)
    )
      return yield* Effect.fail(stateError(clock, snapshot, "coverageMissing"));
    const definition = definitions.find(
      (value) =>
        value.uniqueConstraintDefinitionId ===
        state.uniqueConstraintDefinitionId,
    )!;
    if (state.coveredThroughCommitSeq < clock.lastCommitSeq) {
      const frontier = yield* readAppTableWriteFrontierInTransactionEffect(
        tx,
        clock.scopeId,
        definition.tableId,
      ).pipe(
        Effect.mapError((cause) =>
          cause instanceof AppRowReadPersistenceError
            ? new AppUniqueConstraintSetBuildIntegrationV1Error({
                phase: "targetTransaction",
                retryable: true,
                cause,
              })
            : stateError(clock, snapshot, "storedStateInvalid", cause),
        ),
      );
      if (frontier !== null && frontier > state.coveredThroughCommitSeq)
        return yield* Effect.fail(
          stateError(clock, snapshot, "coverageMissing"),
        );
    }
    states.push(state);
  }
  return Object.freeze(states);
});

export const advanceActiveUniqueCoverageInTransactionEffect = Effect.fn(
  "AppUniqueConstraintBuild.advanceActiveCoverage",
)(function* (
  tx: AppRowTransaction,
  states: ReadonlyArray<BuildState>,
  commitSeq: CommitSeq,
  schemaVersionId: CatalogSchemaVersionId,
) {
  for (const state of states) {
    const rows = yield* queryEffect(
      tx
        .update(fxSystemUniqueConstraintBuilds)
        .set({
          coveredThroughCommitSeq: commitSeq,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(fxSystemUniqueConstraintBuilds.scopeId, state.scopeId),
            eq(
              fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
              state.uniqueConstraintDefinitionId,
            ),
            eq(fxSystemUniqueConstraintBuilds.lifecycle, "enabled"),
            eq(fxSystemUniqueConstraintBuilds.attemptFence, state.attemptFence),
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
    if (rows.length !== 1)
      return yield* Effect.fail(
        stateError(state, { schemaVersionId }, "concurrentStateChange"),
      );
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
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
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
            tx
              .insert(fxSystemUniqueConstraintBuilds)
              .values({
                scopeId: authority.scopeId,
                uniqueConstraintDefinitionId:
                  member.uniqueConstraintDefinitionId,
                ...values,
              })
              .returning(),
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
    const state = yield* decodeBuildStateEffect(
      authority,
      snapshot,
      written[0],
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
  const states = yield* loadSelectedBuildStates(tx, authority, snapshot, clock);
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

const decodeBuildStateEffect = Effect.fn(
  "AppUniqueConstraintBuild.decodeState",
)(function* (
  authority: Pick<TrustedScopeAuthority, "scopeId">,
  snapshot: Pick<BuildSnapshot, "schemaVersionId" | "members">,
  row: unknown,
  currentLastCommitSeq: bigint,
) {
  const state = yield* Effect.fromResult(decodeBuildStateResult(row)).pipe(
    Effect.mapError((cause) =>
      stateError(authority, snapshot, "storedStateInvalid", cause),
    ),
  );
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
    return yield* Effect.fail(
      stateError(authority, snapshot, "storedStateInvalid"),
    );
  if (
    state.startCommitSeq > currentLastCommitSeq ||
    (state.coveredThroughCommitSeq !== null &&
      state.coveredThroughCommitSeq > currentLastCommitSeq)
  )
    return yield* Effect.fail(
      stateError(authority, snapshot, "frontierAheadOfClock"),
    );
  return Object.freeze({
    ...state,
    cursorRowId:
      state.cursorRowId === null ? null : new Uint8Array(state.cursorRowId),
  });
});

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
          retryable: true,
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
