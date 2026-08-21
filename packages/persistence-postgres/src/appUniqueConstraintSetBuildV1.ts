import { bytesEqual, isUint8Array } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Option, Result, Schema } from "effect";
import {
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import type {
  CatalogTableId,
  CatalogUniqueConstraintDefinitionId,
} from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
  APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
  AppUniqueConstraintSetBuildAttemptFenceV1Schema,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1,
  appUniqueConstraintSetSha256HexV1ToBytes,
  type AppUniqueConstraintSetBuildAttemptFenceV1,
  type AppUniqueConstraintSetSha256HexV1,
} from "flarex-protocol/internal/app-unique-constraint-set-v1";
import {
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
import {
  readApplicationActiveRevisionForShareInTransactionEffect,
} from "./applicationActiveHeadRead";
import {
  readCurrentAppRowInTransactionEffect,
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
import {
  fxSystemUniqueConstraintSetBuilds,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "./transactionSessionActivation";

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

export interface AdvanceAppUniqueConstraintSetBackfillV1Input
  extends ReconcileAppUniqueConstraintSetBuildV1Input {
  readonly pageSize: number;
}

export interface LocatedAppUniqueConstraintSetBuildTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedAppUniqueConstraintSetBuildTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedAppUniqueConstraintSetBuildTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
}

export interface ResetAppUniqueConstraintSetValidationV1Input {
  readonly scopeId: ScopeId;
}

export const MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 = 32;

export type ResetAppUniqueConstraintSetValidationV1Result = Readonly<{
  readonly status: "reset" | "unchanged";
}>;

export class AppUniqueConstraintSetBuildDirectoryV1Error
  extends Data.TaggedError(
    "AppUniqueConstraintSetBuildDirectoryV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly reason: "tooManyBuildRows" | "concurrentStateChange";
    readonly maximumBuilds: number;
  }> {}

export type ReclaimSupersededAppUniqueConstraintSetBuildResult =
  | Readonly<{
      readonly status: "reclaimed";
      readonly disposition: "deleted";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly schemaVersionId: CatalogSchemaVersionId;
      readonly lifecycle: Exclude<BuildState["lifecycle"], "enabled">;
    }>
  | Readonly<{
      readonly status: "reclaimed";
      readonly disposition:
        | "already_absent"
        | "replayedAfterUncertainCompletion";
      readonly deploymentId: string;
      readonly scopeId: ScopeId;
      readonly schemaVersionId: CatalogSchemaVersionId;
    }>;

export class AppUniqueConstraintSetBuildReclamationError
  extends Data.TaggedError("AppUniqueConstraintSetBuildReclamationError")<{
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

export type InstallAppSchemaCandidateWithWorkspaceReclamationResult =
  Readonly<{
    readonly installation: InstallAppSchemaCandidateValidationResult;
    readonly workspace:
      | Readonly<{ readonly disposition: "not_applicable" }>
      | Readonly<{
          readonly disposition: "already_absent" | "deleted";
          readonly schemaVersionId: CatalogSchemaVersionId;
        }>
      | Readonly<{
          readonly disposition: "retained";
          readonly reason: "activeSchema" | "buildEnabled";
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

/**
 * Same-transaction invalidation hook for the existing point-commit owner.
 * Reset only moves a validating cursor backward to the start of its pass; it
 * cannot create, advance, enable, or otherwise confer build authority.
 */
export const resetAppUniqueConstraintSetValidationInTransactionEffect =
  Effect.fn("AppUniqueConstraintSetBuild.resetValidationInTransaction")(
    function* (
      tx: AppRowTransaction,
      input: ResetAppUniqueConstraintSetValidationV1Input,
    ): Effect.fn.Return<
      ResetAppUniqueConstraintSetValidationV1Result,
      AppUniqueConstraintSetBuildIntegrationV1Error |
        AppUniqueConstraintSetBuildDirectoryV1Error
    > {
      const targets = yield* loadBuildDirectoryForUpdate(tx, input.scopeId);
      if (targets.length > MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1) {
        return yield* Effect.fail(
          new AppUniqueConstraintSetBuildDirectoryV1Error({
            scopeId: input.scopeId,
            reason: "tooManyBuildRows",
            maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
          }),
        );
      }
      const resetTargets = targets.filter((target) =>
        target.lifecycle === "validating" &&
        target.cursorDefinitionId !== null
      );
      if (resetTargets.length === 0) {
        return Object.freeze({ status: "unchanged" });
      }
      const updated = yield* queryEffect(
        tx.update(fxSystemUniqueConstraintSetBuilds).set({
          cursorDefinitionId: null,
          cursorRowId: null,
          updatedAt: sql`clock_timestamp()`,
        }).where(and(
          eq(fxSystemUniqueConstraintSetBuilds.scopeId, input.scopeId),
          eq(fxSystemUniqueConstraintSetBuilds.lifecycle, "validating"),
          isNotNull(
            fxSystemUniqueConstraintSetBuilds.cursorDefinitionId,
          ),
          inArray(
            fxSystemUniqueConstraintSetBuilds.schemaVersionId,
            resetTargets.map((target) => target.schemaVersionId),
          ),
        )).returning({
          schemaVersionId: fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        }),
      );
      if (updated.length !== resetTargets.length) {
        return yield* Effect.fail(
          new AppUniqueConstraintSetBuildDirectoryV1Error({
            scopeId: input.scopeId,
            reason: "concurrentStateChange",
            maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
          }),
        );
      }
      return Object.freeze({
        status: "reset" as const,
      });
    },
  );

const loadBuildDirectoryForUpdate = Effect.fn(
  "AppUniqueConstraintSetBuild.loadBuildDirectoryForUpdate",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
) {
  return yield* queryEffect(
    tx.select({
      schemaVersionId: fxSystemUniqueConstraintSetBuilds.schemaVersionId,
      lifecycle: fxSystemUniqueConstraintSetBuilds.lifecycle,
      cursorDefinitionId:
        fxSystemUniqueConstraintSetBuilds.cursorDefinitionId,
    }).from(fxSystemUniqueConstraintSetBuilds).where(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, scopeId),
    ).orderBy(
      fxSystemUniqueConstraintSetBuilds.schemaVersionId,
    ).limit(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 + 1,
    ).for("update"),
  );
});

export interface AppUniqueConstraintSetBuildPortsV1 {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedAppUniqueConstraintSetBuildTargetV1
  >;
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
  readonly startCommitSeq: CommitSeq;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
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
        | "setNotClosed"
        | "buildMissing"
        | "buildNotEnabled"
        | "buildStale";
      readonly blocksAllTables: boolean;
      readonly tableIds: ReadonlyArray<CatalogTableId>;
      readonly lifecycle?: BuildState["lifecycle"];
    }>
  | Readonly<{
      readonly status: "eligible";
      readonly evidence: AppUniqueConstraintSetEligibilityEvidenceV1;
    }>;

export class AppUniqueConstraintSetEligibilityV1Error
  extends Data.TaggedError("AppUniqueConstraintSetEligibilityV1Error")<{
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
    eligibilityPortStates.set(port, Object.freeze({
      ports: Object.freeze({
        controlDb,
        authority,
      }),
      uniqueConstraints,
    }));
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
  return state !== undefined &&
    state.ports.controlDb === controlDb &&
    state.ports.authority === authority;
}

export function hasAppUniqueConstraintSetEligibilityPortV1(
  value: unknown,
): value is AppUniqueConstraintSetEligibilityPortV1 {
  return typeof value === "object" && value !== null &&
    // SAFETY: the typeof guard above proved the value is a non-null
    // object; the cast only narrows it to the WeakMap's registered brand.
    eligibilityPortStates.has(value as AppUniqueConstraintSetEligibilityPortV1);
}

export function hasAppUniqueConstraintSetEligibilityEvidenceV1(
  value: unknown,
): value is AppUniqueConstraintSetEligibilityEvidenceV1 {
  return typeof value === "object" && value !== null &&
    eligibilityEvidencePorts.has(value);
}

/** Exact issuer composition for consumers that combine eligibility evidence. */
export function hasAppUniqueConstraintSetEligibilityEvidenceCompositionV1(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts,
): value is AppUniqueConstraintSetEligibilityEvidenceV1 {
  if (typeof value !== "object" || value === null) return false;
  const port = eligibilityEvidencePorts.get(value);
  return port !== undefined &&
    hasAppUniqueConstraintSetEligibilityCompositionV1(
      port,
      controlDb,
      authority,
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
  Effect.fn(
    "AppUniqueConstraintSetBuild.loadEligibilityForReadiness",
  )(function* (
    port: AppUniqueConstraintSetEligibilityPortV1,
    input: AppUniqueConstraintSetEligibilityInputV1,
  ): Effect.fn.Return<
    AppUniqueConstraintSetEligibilityResultV1,
    LoadAppUniqueConstraintSetEligibilityV1Error
  > {
    return yield* loadEligibilityWithClockLock(port, input, "share");
  });

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
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({
      reason: "invalidPort",
      retryable: false,
    }));
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
    return Object.freeze({ status: "not_required" as const, tableIds: [] as const });
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    input.deploymentId,
    ports.authority,
  );
  if (located.authority.scopeId !== input.scopeId) {
    return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({
      reason: "scopeMismatch",
      retryable: false,
    }));
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
      readonly startCommitSeq: CommitSeq;
      readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
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
  readonly cursorDefinitionId: CatalogUniqueConstraintDefinitionId | null;
  readonly cursorRowId: AppRowIdHexV1 | null;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
}

export class InvalidAppUniqueConstraintSetBuildInputV1Error
  extends Data.TaggedError("InvalidAppUniqueConstraintSetBuildInputV1Error")<{
    readonly reason:
      | "invalidInputShape"
      | "invalidDeploymentId"
      | "invalidSchemaVersionId";
  }> {}

export class AppUniqueConstraintSetBuildStaleAuthorityV1Error
  extends Data.TaggedError(
    "AppUniqueConstraintSetBuildStaleAuthorityV1Error",
  )<{
    readonly scopeId: ScopeId;
    readonly reason: "storageGeneration" | "storageGenerationFence" | "epoch";
  }> {}

export class AppUniqueConstraintSetBuildStateV1Error
  extends Data.TaggedError("AppUniqueConstraintSetBuildStateV1Error")<{
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
      | "validationMismatch";
    readonly cause?: unknown;
  }> {}

export class AppUniqueConstraintSetBuildIntegrationV1Error
  extends Data.TaggedError("AppUniqueConstraintSetBuildIntegrationV1Error")<{
    readonly phase: "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class AppUniqueConstraintSetBuildDecisionUncertainV1Error
  extends Data.TaggedError(
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
  | LockScopeClockForUpdateError
  | TrustedScopeAuthorityError;

interface BuildSnapshot {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly definitionCount: number;
  readonly definitionSetSha256Hex: AppUniqueConstraintSetSha256HexV1;
}

interface BuildState {
  readonly startCommitSeq: CommitSeq;
  readonly attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1;
  readonly storageGeneration: string;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: string;
  readonly lifecycle: "declared" | "building" | "backfilling" | "validating" | "enabled";
  readonly cursorDefinitionId: CatalogUniqueConstraintDefinitionId | null;
  readonly cursorRowId: Uint8Array | null;
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
  const snapshot = Object.freeze({
    ...decoded,
    definitionCount: locatedClosure.closure.definitionCount,
    definitionSetSha256Hex:
      locatedClosure.closure.definitionSetSha256Hex,
  } satisfies BuildSnapshot);
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
    return yield* Effect.fail(new AppUniqueConstraintSetBuildStateV1Error({
      scopeId: located.authority.scopeId,
      schemaVersionId: decoded.schemaVersionId,
      reason: "definitionAuthorityMismatch",
    }));
  }
  const snapshot = buildSnapshot(decoded, locatedClosure);
  const tableIds = [...new Set(
    locatedClosure.members.map((member) => member.tableId),
  )].toSorted((left, right) => left - right);
  const definitions = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(
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
    return yield* Effect.fail(stateError(
      located.authority,
      snapshot,
      "definitionAuthorityMismatch",
    ));
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
    return yield* Effect.fail(new AppUniqueConstraintSetBuildReclamationError({
      deploymentId: decoded.deploymentId,
      schemaVersionId: decoded.schemaVersionId,
      reason: "invalidPort",
      retryable: false,
    }));
  }
  const locatedClosure = yield* readAppUniqueConstraintSetClosureV1Effect(
    state.ports.controlDb,
    decoded.deploymentId,
    decoded.schemaVersionId,
  );
  if (locatedClosure === null) {
    return yield* Effect.fail(new AppUniqueConstraintSetBuildReclamationError({
      deploymentId: decoded.deploymentId,
      schemaVersionId: decoded.schemaVersionId,
      reason: "schemaAuthorityMissing",
      retryable: false,
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    decoded.deploymentId,
    state.ports.authority,
  );
  const snapshot = buildSnapshot(decoded, locatedClosure);
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
        return yield* Effect.fail(new AppUniqueConstraintSetBuildReclamationError({
          deploymentId: decoded.deploymentId,
          schemaVersionId: decoded.schemaVersionId,
          reason: "invalidPort",
          retryable: false,
        }));
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
      const displacedSchemaVersionId = current !== null &&
          current.schemaVersionId !== decoded.schemaVersionId
        ? current.schemaVersionId
        : null;
      const displacedClosure = displacedSchemaVersionId === null
        ? null
        : yield* readAppUniqueConstraintSetClosureV1Effect(
            state.ports.controlDb,
            decoded.deploymentId,
            displacedSchemaVersionId,
          );
      const displacedSnapshot = displacedClosure === null ||
          displacedSchemaVersionId === null
        ? null
        : buildSnapshot(Object.freeze({
            deploymentId: decoded.deploymentId,
            schemaVersionId: displacedSchemaVersionId,
          }), displacedClosure);
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
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidInputShape",
      }));
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidDeploymentId",
      }));
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() =>
      new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidSchemaVersionId",
      })
    ));
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
    });
  });
}

function decodeBackfillInputResult(input: unknown) {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, BACKFILL_INPUT_KEYS)) {
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidInputShape",
      }));
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
      return yield* Result.fail(new InvalidAppUniqueConstraintSetBuildInputV1Error({
        reason: "invalidInputShape",
      }));
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
    definitionSetSha256Hex:
      locatedClosure.closure.definitionSetSha256Hex,
  });
}

function definitionsMatchClosure(
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  closure: LocatedAppUniqueConstraintSetClosureV1,
): boolean {
  if (definitions.length !== closure.members.length) return false;
  return definitions.every((definition, index) => {
    const member = closure.members[index];
    return member !== undefined &&
      definition.uniqueConstraintDefinitionId ===
        member.uniqueConstraintDefinitionId &&
      definition.logicalUniqueConstraintId ===
        member.logicalUniqueConstraintId &&
      definition.tableId === member.tableId &&
      definition.physicalSpecSha256Hex === member.physicalSpecSha256Hex;
  });
}

function uniqueConstraintTableIds(
  closure: LocatedAppUniqueConstraintSetClosureV1,
): ReadonlyArray<CatalogTableId> {
  return Object.freeze([...new Set(
    closure.members.map((member) => member.tableId),
  )].toSorted((left, right) => left - right));
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
    (tx) => inspectEligibilityInTransaction(
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
  ) return yield* Effect.failCause(callbackCause);
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) return yield* Effect.failCause(Cause.combine(
    callbackCause,
    Cause.die(new AppUniqueConstraintSetEligibilityV1Error({
      reason: "targetTransaction",
      retryable: false,
      cause,
    })),
  ));
  return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({
    reason: "targetTransaction",
    retryable: cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind !== "decisionUncertain",
    cause,
  }));
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
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({
        reason: "invalidPort",
        retryable: false,
      }));
    }
    if (
      evidence.scopeId !== authority.scopeId ||
      evidence.storageGeneration !== authority.storageGeneration ||
      evidence.storageGenerationFence !== authority.storageGenerationFence ||
      evidence.epoch !== authority.epoch ||
      evidence.scopeId !== clock.scopeId
    ) {
      return yield* Effect.fail(new AppUniqueConstraintSetEligibilityV1Error({
        reason: "scopeMismatch",
        retryable: false,
      }));
    }
    yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
    return yield* inspectEligibilityWithLockedClock(
      tx,
      authority,
      Object.freeze({
        deploymentId: evidence.deploymentId,
        schemaVersionId: evidence.schemaVersionId,
        definitionCount: evidence.definitionCount,
        definitionSetSha256Hex: evidence.definitionSetSha256Hex,
      }),
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
): Effect.fn.Return<
  AppUniqueConstraintSetEligibilityResultV1,
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildStateV1Error
> {
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("share"),
  );
  const row = rows[0];
  if (row === undefined) {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "buildMissing" as const,
      blocksAllTables: false,
      tableIds,
    });
  }
  const state = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    row,
    clock.lastCommitSeq,
  );
  if (!buildAuthorityIsCurrent(state, clock)) {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "buildStale" as const,
      blocksAllTables: false,
      tableIds,
      lifecycle: state.lifecycle,
    });
  }
  if (state.lifecycle !== "enabled") {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "buildNotEnabled" as const,
      blocksAllTables: false,
      tableIds,
      lifecycle: state.lifecycle,
    });
  }
  if (
    expectedEvidence !== undefined &&
    (
      state.storageGeneration !== expectedEvidence.storageGeneration ||
      state.storageGenerationFence !== expectedEvidence.storageGenerationFence ||
      state.epoch !== expectedEvidence.epoch ||
      state.startCommitSeq !== expectedEvidence.startCommitSeq ||
      state.attemptFence !== expectedEvidence.attemptFence
    )
  ) {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "buildStale" as const,
      blocksAllTables: false,
      tableIds,
      lifecycle: state.lifecycle,
    });
  }
  if (expectedEvidence !== undefined) {
    return Object.freeze({
      status: "eligible" as const,
      evidence: expectedEvidence,
    });
  }
  const evidence = Object.freeze({
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    definitionCount: snapshot.definitionCount,
    definitionSetSha256Hex: snapshot.definitionSetSha256Hex,
    tableIds,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: state.storageGenerationFence,
    epoch: authority.epoch,
    startCommitSeq: state.startCommitSeq,
    attemptFence: state.attemptFence,
    [eligibilityEvidenceBrand]: true as const,
  } satisfies AppUniqueConstraintSetEligibilityEvidenceV1);
  eligibilityEvidencePorts.set(evidence, port);
  return Object.freeze({ status: "eligible" as const, evidence });
});

const runReconciliationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  Extract<ReconcileAppUniqueConstraintSetBuildV1Result, { status: "reconciled" }>,
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
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
});

const runWorkspaceReclamationTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.runWorkspaceReclamationTransaction",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
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
    (tx) => reclaimWorkspaceInTransaction(
      tx,
      authority,
      snapshot,
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
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
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
  displacedSnapshot: BuildSnapshot | null,
  options: InstallAppSchemaCandidateWithWorkspaceReclamationOptions,
): Effect.fn.Return<
  InstallAppSchemaCandidateWithWorkspaceReclamationResult,
  InstallAppSchemaCandidateWithWorkspaceReclamationError
> {
  const started = startLocatedEffectTransaction(
    target,
    "M05-A2 candidate supersession and workspace reclamation rolled back.",
    (tx) => installCandidateAndReclaimWorkspaceInTransaction(
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
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "decisionUncertain" ||
      cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
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
  displacedSnapshot: BuildSnapshot | null,
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
  const installation = yield*
    installPreparedAppSchemaCandidateValidationInTransactionEffect(
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
    return yield* Effect.fail(new AppUniqueConstraintSetBuildReclamationError({
      deploymentId: installation.head.deploymentId,
      schemaVersionId: displacedSchemaVersionId,
      scopeId: authority.scopeId,
      reason: "concurrentStateChange",
      retryable: true,
    }));
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
  "AppUniqueConstraintSetBuild.reclaimDisplacedWorkspaceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  snapshot: BuildSnapshot | null,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  InstallAppSchemaCandidateWithWorkspaceReclamationResult["workspace"],
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildDirectoryV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | LockScopeClockForUpdateError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const directory = yield* loadBuildDirectoryForUpdate(tx, authority.scopeId);
  if (directory.length > MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1) {
    return yield* Effect.fail(new AppUniqueConstraintSetBuildDirectoryV1Error({
      scopeId: authority.scopeId,
      reason: "tooManyBuildRows",
      maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    }));
  }
  if (snapshot === null) {
    const authorityDisposition = yield* inspectDisplacedSchemaAuthority(
      tx,
      authority,
      deploymentId,
      schemaVersionId,
    );
    if (authorityDisposition === "activeSchema") {
      return Object.freeze({
        disposition: "retained" as const,
        reason: "activeSchema" as const,
        schemaVersionId,
      });
    }
    const row = yield* queryEffect(
      tx.select({
        schemaVersionId: fxSystemUniqueConstraintSetBuilds.schemaVersionId,
      }).from(fxSystemUniqueConstraintSetBuilds).where(and(
        eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
        eq(fxSystemUniqueConstraintSetBuilds.schemaVersionId, schemaVersionId),
      )).limit(1).for("update"),
    );
    if (row.length !== 0) {
      return yield* Effect.fail(new AppUniqueConstraintSetBuildReclamationError({
        deploymentId,
        schemaVersionId,
        scopeId: authority.scopeId,
        reason: "schemaAuthorityMissing",
        retryable: false,
      }));
    }
    return Object.freeze({
      disposition: "already_absent" as const,
      schemaVersionId,
    });
  }
  const selection = yield* inspectSelectedWorkspaceReclamation(
    tx,
    authority,
    snapshot,
  );
  if (selection === "activeSchema") {
    return Object.freeze({
      disposition: "retained" as const,
      reason: "activeSchema" as const,
      schemaVersionId,
    });
  }
  const deletion = yield* attemptWorkspaceDeletionInTransaction(
    tx,
    authority,
    snapshot,
    clock,
    options,
  );
  if (deletion.disposition === "enabled") {
    return Object.freeze({
      disposition: "retained" as const,
      reason: "buildEnabled" as const,
      schemaVersionId,
    });
  }
  return Object.freeze({
    disposition: deletion.disposition,
    schemaVersionId,
  });
});

const inspectDisplacedSchemaAuthority = Effect.fn(
  "AppUniqueConstraintSetBuild.inspectDisplacedSchemaAuthority",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  "eligible" | "activeSchema",
  AppUniqueConstraintSetBuildReclamationError |
    AppUniqueConstraintSetBuildIntegrationV1Error
> {
  return yield* inspectSelectedWorkspaceReclamation(
    tx,
    authority,
    Object.freeze({ deploymentId, schemaVersionId }),
  );
});

const reclaimWorkspaceInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.reclaimWorkspaceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  options: AppUniqueConstraintSetBuildOptionsV1,
): Effect.fn.Return<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  | AppUniqueConstraintSetBuildReclamationError
  | AppUniqueConstraintSetBuildDirectoryV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
  | AppUniqueConstraintSetBuildStateV1Error
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | LockScopeClockForUpdateError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(authority, clock));
  const directory = yield* loadBuildDirectoryForUpdate(tx, authority.scopeId);
  if (directory.length > MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1) {
    return yield* Effect.fail(new AppUniqueConstraintSetBuildDirectoryV1Error({
      scopeId: authority.scopeId,
      reason: "tooManyBuildRows",
      maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    }));
  }
  const selection = yield* inspectSelectedWorkspaceReclamation(
    tx,
    authority,
    snapshot,
  );
  if (selection === "activeSchema") {
    return yield* Effect.fail(reclamationError(
      authority,
      snapshot,
      "activeSchema",
      false,
    ));
  }
  const deletion = yield* attemptWorkspaceDeletionInTransaction(
    tx,
    authority,
    snapshot,
    clock,
    options,
  );
  if (deletion.disposition === "already_absent") {
    return reclamationAbsentResult(authority, snapshot, "already_absent");
  }
  if (deletion.disposition === "enabled") {
    return yield* Effect.fail(reclamationError(
      authority,
      snapshot,
      "buildEnabled",
      false,
    ));
  }
  return Object.freeze({
    status: "reclaimed" as const,
    disposition: "deleted" as const,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    lifecycle: deletion.lifecycle,
  });
});

const attemptWorkspaceDeletionInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.attemptWorkspaceDeletionInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  clock: ScopeClockRecord,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  if (row === undefined) {
    return Object.freeze({ disposition: "already_absent" as const });
  }
  const state = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    row,
    clock.lastCommitSeq,
  );
  yield* Effect.fromResult(
    requireCurrentBuildAuthorityResult(authority, state, clock),
  );
  if (state.lifecycle === "enabled") {
    return Object.freeze({ disposition: "enabled" as const });
  }
  const deleted = yield* queryEffect(
    tx.delete(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
      eq(
        fxSystemUniqueConstraintSetBuilds.storageGenerationFence,
        state.storageGenerationFence,
      ),
      eq(fxSystemUniqueConstraintSetBuilds.epoch, state.epoch),
      eq(fxSystemUniqueConstraintSetBuilds.startCommitSeq, state.startCommitSeq),
      eq(fxSystemUniqueConstraintSetBuilds.lifecycle, state.lifecycle),
      eq(fxSystemUniqueConstraintSetBuilds.attemptFence, state.attemptFence),
    )).returning({
      schemaVersionId: fxSystemUniqueConstraintSetBuilds.schemaVersionId,
    }),
  );
  if (
    deleted.length !== 1 ||
    deleted[0]?.schemaVersionId !== snapshot.schemaVersionId
  ) {
    return yield* Effect.fail(reclamationError(
      authority,
      snapshot,
      "concurrentStateChange",
      true,
    ));
  }
  yield* runFault(options, "afterWorkspaceDelete");
  return Object.freeze({
    disposition: "deleted" as const,
    lifecycle: state.lifecycle,
  });
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
  const active = yield*
    readApplicationActiveRevisionForShareInTransactionEffect(
      tx,
      authority.scopeId,
    ).pipe(Effect.mapError(cause => reclamationError(
      authority,
      snapshot,
      "activeSchemaStateInvalid",
      cause.retryable,
      cause,
    )));
  if (active !== null) {
    if (active.deploymentId !== snapshot.deploymentId) {
      return yield* Effect.fail(reclamationError(
        authority,
        snapshot,
        "activeSchemaStateInvalid",
        false,
      ));
    }
    if (active.schemaVersionId === snapshot.schemaVersionId) {
      return "activeSchema" as const;
    }
  }
  const candidate = yield*
    readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
      tx,
      authority.scopeId,
      "load",
    ).pipe(Effect.mapError(cause => reclamationError(
      authority,
      snapshot,
      "candidateSchemaStateInvalid",
      cause instanceof AppSchemaCandidateValidationPersistenceError,
      cause,
    )));
  if (candidate !== null && (
    candidate.deploymentId !== snapshot.deploymentId ||
    candidate.scopeId !== authority.scopeId
  )) {
    return yield* Effect.fail(reclamationError(
      authority,
      snapshot,
      "candidateSchemaStateInvalid",
      false,
    ));
  }
  if (candidate?.schemaVersionId === snapshot.schemaVersionId) {
    return yield* Effect.fail(reclamationError(
      authority,
      snapshot,
      "currentCandidate",
      false,
    ));
  }
  return "eligible" as const;
});

const observeWorkspaceReclamationAfterUncertainCompletion = Effect.fn(
  "AppUniqueConstraintSetBuild.observeWorkspaceReclamationAfterUncertainCompletion",
)(function* (
  target: LocatedAppUniqueConstraintSetBuildTargetV1,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  transactionCause: unknown,
): Effect.fn.Return<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  | AppUniqueConstraintSetBuildIntegrationV1Error
  | AppUniqueConstraintSetBuildDecisionUncertainV1Error
  | AppUniqueConstraintSetBuildStaleAuthorityV1Error
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
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction",
          retryable: false,
          cause,
        })),
      ));
    }
    return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }));
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
  "AppUniqueConstraintSetBuild.observeWorkspaceAbsenceInTransaction",
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
  const rows = yield* queryEffect(
    tx.select({
      schemaVersionId: fxSystemUniqueConstraintSetBuilds.schemaVersionId,
    }).from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("share"),
  );
  return rows.length === 0;
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
    (tx) => advanceBackfillInTransaction(
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
    return yield* Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: false,
        cause,
      })),
    ));
  }
  const retryable = cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    (cause.issue.kind === "infrastructureFailure" ||
      cause.issue.kind === "callbackRolledBack");
  return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
    phase: "targetTransaction",
    retryable,
    cause,
  }));
});

const advanceBackfillInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.advanceBackfillInTransaction",
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
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("update"),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "buildMissing",
    ));
  }
  const state = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    row,
    clock.lastCommitSeq,
  );
  yield* Effect.fromResult(requireCurrentBuildAuthorityResult(
    authority,
    state,
    clock,
  ));
  switch (state.lifecycle) {
    case "declared":
      yield* transitionBuildLifecycle(
        tx,
        authority,
        snapshot,
        state,
        "building",
        null,
        null,
        options,
        "afterBackfillLifecycleTransition",
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
        null,
      );
    case "building":
      yield* transitionBuildLifecycle(
        tx,
        authority,
        snapshot,
        state,
        "backfilling",
        null,
        null,
        options,
        "afterBackfillLifecycleTransition",
      );
      return backfillResult(
        authority,
        snapshot,
        state,
        "advanced",
        "backfilling",
        0,
        0,
        0,
        0,
        null,
        null,
      );
    case "backfilling":
      return yield* backfillUniqueSetPage(
        tx,
        authority,
        snapshot,
        state,
        definitions,
        pageSize,
        options,
      );
    case "validating":
      return yield* validateUniqueSetPage(
        tx,
        authority,
        snapshot,
        state,
        definitions,
        pageSize,
        options,
      );
    case "enabled":
      return backfillResult(
        authority,
        snapshot,
        state,
        "replayed",
        "enabled",
        0,
        0,
        0,
        0,
        null,
        null,
      );
  }
});

const validateUniqueSetPage = Effect.fn(
  "AppUniqueConstraintSetBuild.validatePage",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  const cursorRowId = yield* Effect.fromResult(
    decodeCursorRowIdResult(state, authority, snapshot),
  );
  if ((state.cursorDefinitionId === null) !== (cursorRowId === null)) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "backfillCursorInvalid",
    ));
  }
  const definitionById = new Map(
    definitions.map((definition) => [
      definition.uniqueConstraintDefinitionId,
      definition,
    ] as const),
  );
  if (
    state.cursorDefinitionId !== null &&
    !definitionById.has(state.cursorDefinitionId)
  ) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "backfillCursorInvalid",
    ));
  }
  yield* ensureValidationClaimDimensions(
    tx,
    authority,
    snapshot,
    definitions,
  );
  const candidates = yield* loadValidationCandidates(
    tx,
    authority,
    snapshot,
    definitions,
    state,
    cursorRowId,
    pageSize,
  );
  const page = candidates.slice(0, pageSize);
  let lastDefinitionId = state.cursorDefinitionId;
  let lastRowId = cursorRowId;
  for (const candidate of page) {
    lastDefinitionId = candidate.definition.uniqueConstraintDefinitionId;
    lastRowId = candidate.rowId;
    const current = yield* readCurrentAppRowInTransactionEffect(tx, {
      scopeId: authority.scopeId,
      tableId: candidate.definition.tableId,
      rowId: candidate.rowId,
    });
    const expected = current.kind === "live"
      ? yield* lowerValidationExpectation(
          authority,
          snapshot,
          candidate.definition,
          current,
        )
      : null;
    const validated = yield* validateAppUniqueKeyClaimInTransactionEffect(
      tx,
      {
        scopeId: authority.scopeId,
        constraintId:
          candidate.definition.uniqueConstraintDefinitionId,
        tableId: candidate.definition.tableId,
        rowId: candidate.rowId,
        authorityEpoch: authority.epoch,
        expected,
      },
    );
    if (validated.status === "mismatched") {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "validationMismatch",
        validated,
      ));
    }
    yield* runFault(options, "afterValidationRow");
  }
  const done = candidates.length <= pageSize;
  if (!done) {
    yield* transitionBuildLifecycle(
      tx,
      authority,
      snapshot,
      state,
      "validating",
      lastDefinitionId,
      lastRowId,
      options,
      "afterValidationLifecycleTransition",
    );
    return backfillResult(
      authority,
      snapshot,
      state,
      "advanced",
      "validating",
      page.length,
      0,
      0,
      0,
      lastDefinitionId,
      lastRowId,
    );
  }
  yield* runFault(options, "beforeEnable");
  yield* transitionBuildLifecycle(
    tx,
    authority,
    snapshot,
    state,
    "enabled",
    null,
    null,
    options,
    "afterValidationLifecycleTransition",
  );
  return backfillResult(
    authority,
    snapshot,
    state,
    "advanced",
    "enabled",
    page.length,
    0,
    0,
    0,
    null,
    null,
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
      Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "loweringInvalid",
        cause,
      )),
      Result.map((lowered) => lowered.canonical.kind === "claim"
        ? Object.freeze({
            schemaVersionId: current.schemaVersionId,
            parentWriteEpochUuid: current.writeEpochUuid,
            commitSeq: current.commitSeq,
            claim: lowered.projection,
          })
        : null),
    ),
  );
}

interface BackfillCandidateV1 {
  readonly definition: LocatedAppUniqueConstraintDefinitionV1;
  readonly rowId: AppRowIdHexV1;
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
  AppUniqueConstraintSetBuildIntegrationV1Error |
    AppUniqueConstraintSetBuildStateV1Error
> {
  if (definitions.length === 0) return;
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId).pipe(
      Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "storedStateInvalid",
        cause,
      )),
    ),
  );
  const definitionValues = sql.join(
    definitions.map((definition) => sql`(
      ${definition.uniqueConstraintDefinitionId}::integer,
      ${definition.tableId}::integer
    )`),
    sql`, `,
  );
  const driverResult = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(sql`
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
    catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
  const invalidDriverResult = stateError(
    authority,
    snapshot,
    "storedStateInvalid",
  );
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(driverResult, () => {
      throw invalidDriverResult;
    }),
    catch: (cause) => cause === invalidDriverResult
      ? invalidDriverResult
      : new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
  });
  if (rows.length > 0) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "validationMismatch",
      Object.freeze({ reason: "claimIdentityMismatch" as const }),
    ));
  }
});

const backfillUniqueSetPage = Effect.fn(
  "AppUniqueConstraintSetBuild.backfillPage",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  pageSize: number,
  options: AppUniqueConstraintSetBuildOptionsV1,
) {
  const cursorRowId = yield* Effect.fromResult(
    decodeCursorRowIdResult(state, authority, snapshot),
  );
  if ((state.cursorDefinitionId === null) !== (cursorRowId === null)) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "backfillCursorInvalid",
    ));
  }
  const definitionById = new Map(
    definitions.map((definition) => [
      definition.uniqueConstraintDefinitionId,
      definition,
    ] as const),
  );
  if (
    state.cursorDefinitionId !== null &&
    !definitionById.has(state.cursorDefinitionId)
  ) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "backfillCursorInvalid",
    ));
  }
  const candidates = yield* loadBackfillCandidates(
    tx,
    authority,
    snapshot,
    definitions,
    definitionById,
    state,
    cursorRowId,
    pageSize,
  );
  const page = candidates.slice(0, pageSize);
  const currentRows = new Map<string, AppRowReadResultV1>();
  let claimed = 0;
  let replayed = 0;
  let omitted = 0;
  let lastDefinitionId = state.cursorDefinitionId;
  let lastRowId = cursorRowId;
  for (const candidate of page) {
    lastDefinitionId = candidate.definition.uniqueConstraintDefinitionId;
    lastRowId = candidate.rowId;
    const cacheKey = `${candidate.definition.tableId}:${candidate.rowId}`;
    let current = currentRows.get(cacheKey);
    if (current === undefined) {
      current = yield* readCurrentAppRowInTransactionEffect(tx, {
        scopeId: authority.scopeId,
        tableId: candidate.definition.tableId,
        rowId: candidate.rowId,
      });
      currentRows.set(cacheKey, current);
    }
    if (current.kind !== "live") {
      omitted += 1;
      continue;
    }
    const lowered = yield* Effect.fromResult(
      lowerCanonicalAppUniqueConstraintV1Result(
        candidate.definition,
        current.document,
      ).pipe(Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "loweringInvalid",
        cause,
      ))),
    );
    if (lowered.canonical.kind !== "claim") {
      omitted += 1;
      continue;
    }
    const ensured = yield* ensureAppUniqueKeyBackfillClaimInTransactionEffect(
      tx,
      {
        scopeId: authority.scopeId,
        constraintId:
          candidate.definition.uniqueConstraintDefinitionId,
        tableId: candidate.definition.tableId,
        rowId: candidate.rowId,
        authorityEpoch: authority.epoch,
        parentWriteEpochUuid: current.writeEpochUuid,
        commitSeq: current.commitSeq,
        rowPrevCommitSeq: current.prevCommitSeq,
        claim: lowered.projection,
      },
    );
    if (ensured.status === "claimed") {
      claimed += 1;
      yield* runFault(options, "afterBackfillClaim");
    } else {
      replayed += 1;
    }
  }
  const done = candidates.length <= pageSize;
  const lifecycle = done ? "validating" as const : "backfilling" as const;
  const nextDefinitionId = done ? null : lastDefinitionId;
  const nextRowId = done ? null : lastRowId;
  yield* transitionBuildLifecycle(
    tx,
    authority,
    snapshot,
    state,
    lifecycle,
    nextDefinitionId,
    nextRowId,
    options,
    "afterBackfillLifecycleTransition",
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
    nextDefinitionId,
    nextRowId,
  );
});

const loadValidationCandidates = Effect.fn(
  "AppUniqueConstraintSetBuild.loadValidationCandidates",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  state: BuildState,
  cursorRowId: AppRowIdHexV1 | null,
  pageSize: number,
): Effect.fn.Return<
  ReadonlyArray<BackfillCandidateV1>,
  AppUniqueConstraintSetBuildIntegrationV1Error |
    AppUniqueConstraintSetBuildStateV1Error
> {
  if (definitions.length === 0) return Object.freeze([]);
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId).pipe(
      Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "storedStateInvalid",
        cause,
      )),
    ),
  );
  const definitionValues = sql.join(
    definitions.map((definition) => sql`(
      ${definition.uniqueConstraintDefinitionId}::integer,
      ${definition.tableId}::integer
    )`),
    sql`, `,
  );
  const currentAfterCursor = state.cursorDefinitionId === null ||
      cursorRowId === null
    ? sql`true`
    : sql`(
        definition.definition_id > ${state.cursorDefinitionId}
        or (
          definition.definition_id = ${state.cursorDefinitionId}
          and current_row.row_id > ${appRowIdHexV1ToBytes(cursorRowId)}::bytea
        )
      )`;
  const claimAfterCursor = state.cursorDefinitionId === null ||
      cursorRowId === null
    ? sql`true`
    : sql`(
        definition.definition_id > ${state.cursorDefinitionId}
        or (
          definition.definition_id = ${state.cursorDefinitionId}
          and claim.row_id > ${appRowIdHexV1ToBytes(cursorRowId)}::bytea
        )
      )`;
  const statement = sql`
    with definition(definition_id, table_id) as (
      values ${definitionValues}
    )
    select
      definition.definition_id as "definitionId",
      candidate.row_id as "rowId"
    from definition
    cross join lateral (
      select identity.row_id
      from (
        (
          select current_row.row_id
          from fx_app_row_current as current_row
          where current_row.scope_uuid = ${scopeUuid.scopeUuid}
            and current_row.table_id = definition.table_id
            and ${currentAfterCursor}
          order by current_row.row_id asc
          limit ${pageSize + 1}
        )
        union
        (
          select claim.row_id
          from fx_app_unique_key as claim
          where claim.scope_uuid = ${scopeUuid.scopeUuid}
            and claim.constraint_id = definition.definition_id
            and claim.locale_key = ''
            and claim.table_id = definition.table_id
            and ${claimAfterCursor}
          order by claim.row_id asc
          limit ${pageSize + 1}
        )
      ) as identity
      order by identity.row_id asc
      limit ${pageSize + 1}
    ) as candidate
    order by definition.definition_id asc, candidate.row_id asc
    limit ${pageSize + 1}
  `;
  const driverResult = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
  const invalidDriverResult = stateError(
    authority,
    snapshot,
    "storedStateInvalid",
  );
  const rawRows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(driverResult, () => {
      throw invalidDriverResult;
    }),
    catch: (cause) => cause === invalidDriverResult
      ? invalidDriverResult
      : new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction",
          retryable: true,
          cause,
        }),
  });
  const candidates: BackfillCandidateV1[] = [];
  let previousDefinitionId: CatalogUniqueConstraintDefinitionId | null = null;
  let previousRowId: AppRowIdHexV1 | null = null;
  for (const raw of rawRows) {
    if (!isNonArrayRecord(raw) ||
        !Number.isSafeInteger(raw.definitionId) ||
        !isUint8Array(raw.rowId)) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "storedStateInvalid",
      ));
    }
    const definition = definitions.find((candidate) =>
      candidate.uniqueConstraintDefinitionId === raw.definitionId
    );
    if (definition === undefined) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "definitionAuthorityMismatch",
      ));
    }
    const rowId = yield* Effect.fromResult(
      appRowIdHexV1FromBytesResult(raw.rowId).pipe(
        Result.mapError((cause) => stateError(
          authority,
          snapshot,
          "storedStateInvalid",
          cause,
        )),
      ),
    );
    if (
      previousDefinitionId !== null &&
      (definition.uniqueConstraintDefinitionId < previousDefinitionId ||
        (definition.uniqueConstraintDefinitionId === previousDefinitionId &&
          previousRowId !== null && rowId <= previousRowId))
    ) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "storedStateInvalid",
      ));
    }
    previousDefinitionId = definition.uniqueConstraintDefinitionId;
    previousRowId = rowId;
    candidates.push(Object.freeze({ definition, rowId }));
  }
  return Object.freeze(candidates);
});

const loadBackfillCandidates = Effect.fn(
  "AppUniqueConstraintSetBuild.loadBackfillCandidates",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  definitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  definitionById: ReadonlyMap<
    CatalogUniqueConstraintDefinitionId,
    LocatedAppUniqueConstraintDefinitionV1
  >,
  state: BuildState,
  cursorRowId: AppRowIdHexV1 | null,
  pageSize: number,
): Effect.fn.Return<
  ReadonlyArray<BackfillCandidateV1>,
  AppUniqueConstraintSetBuildIntegrationV1Error |
    AppUniqueConstraintSetBuildStateV1Error
> {
  if (definitions.length === 0) return Object.freeze([]);
  const scopeUuid = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(authority.scopeId).pipe(
      Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "storedStateInvalid",
        cause,
      )),
    ),
  );
  const definitionValues = sql.join(
    definitions.map((definition) => sql`(
      ${definition.uniqueConstraintDefinitionId}::integer,
      ${definition.tableId}::integer
    )`),
    sql`, `,
  );
  const afterCursor = state.cursorDefinitionId === null || cursorRowId === null
    ? sql`true`
    : sql`(
        definition.definition_id > ${state.cursorDefinitionId}
        or (
          definition.definition_id = ${state.cursorDefinitionId}
          and revision.row_id > ${appRowIdHexV1ToBytes(cursorRowId)}::bytea
        )
      )`;
  const statement = sql`
    with definition(definition_id, table_id) as (
      values ${definitionValues}
    )
    select
      definition.definition_id as "definitionId",
      candidate.row_id as "rowId"
    from definition
    cross join lateral (
      select distinct revision.row_id
      from fx_app_row_rev as revision
      where revision.scope_uuid = ${scopeUuid.scopeUuid}
        and revision.table_id = definition.table_id
        and revision.commit_seq <= ${state.startCommitSeq}
        and ${afterCursor}
      order by revision.row_id asc
      limit ${pageSize + 1}
    ) as candidate
    order by definition.definition_id asc, candidate.row_id asc
    limit ${pageSize + 1}
  `;
  const driverResult = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
  const invalidDriverResult = stateError(
    authority,
    snapshot,
    "storedStateInvalid",
  );
  const rawRows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(driverResult, () => {
      throw invalidDriverResult;
    }),
    catch: (cause) => cause === invalidDriverResult
      ? invalidDriverResult
      : new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
  });
  const candidates: BackfillCandidateV1[] = [];
  let previousDefinitionId: CatalogUniqueConstraintDefinitionId | null = null;
  let previousRowId: AppRowIdHexV1 | null = null;
  for (const raw of rawRows) {
    if (!isNonArrayRecord(raw) ||
        !Number.isSafeInteger(raw.definitionId) ||
        !isUint8Array(raw.rowId)) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "storedStateInvalid",
      ));
    }
    const definition = definitions.find((candidate) =>
      candidate.uniqueConstraintDefinitionId === raw.definitionId
    );
    if (definition === undefined) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "definitionAuthorityMismatch",
      ));
    }
    const rowId = yield* Effect.fromResult(
      appRowIdHexV1FromBytesResult(raw.rowId).pipe(
        Result.mapError((cause) => stateError(
          authority,
          snapshot,
          "storedStateInvalid",
          cause,
        )),
      ),
    );
    if (
      previousDefinitionId !== null &&
      (definition.uniqueConstraintDefinitionId < previousDefinitionId ||
        (definition.uniqueConstraintDefinitionId === previousDefinitionId &&
          previousRowId !== null && rowId <= previousRowId))
    ) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "storedStateInvalid",
      ));
    }
    previousDefinitionId = definition.uniqueConstraintDefinitionId;
    previousRowId = rowId;
    candidates.push(Object.freeze({ definition, rowId }));
  }
  return Object.freeze(candidates);
});

const transitionBuildLifecycle = Effect.fn(
  "AppUniqueConstraintSetBuild.transitionLifecycle",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  lifecycle: "building" | "backfilling" | "validating" | "enabled",
  cursorDefinitionId: CatalogUniqueConstraintDefinitionId | null,
  cursorRowId: AppRowIdHexV1 | null,
  options: AppUniqueConstraintSetBuildOptionsV1,
  faultPoint:
    | "afterBackfillLifecycleTransition"
    | "afterValidationLifecycleTransition",
) {
  const updated = yield* queryEffect(
    tx.update(fxSystemUniqueConstraintSetBuilds).set({
      lifecycle,
      cursorDefinitionId,
      cursorRowId: cursorRowId === null
        ? null
        : appRowIdHexV1ToBytes(cursorRowId),
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
      eq(fxSystemUniqueConstraintSetBuilds.attemptFence, state.attemptFence),
      eq(fxSystemUniqueConstraintSetBuilds.lifecycle, state.lifecycle),
    )).returning({
      attemptFence: fxSystemUniqueConstraintSetBuilds.attemptFence,
    }),
  );
  if (updated.length !== 1 ||
      updated[0]?.attemptFence !== state.attemptFence) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "concurrentStateChange",
    ));
  }
  yield* runFault(options, faultPoint);
});

function decodeCursorRowIdResult(
  state: BuildState,
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
): Result.Result<AppRowIdHexV1 | null, AppUniqueConstraintSetBuildStateV1Error> {
  return state.cursorRowId === null
    ? Result.succeed(null)
    : appRowIdHexV1FromBytesResult(state.cursorRowId).pipe(
      Result.mapError((cause) => stateError(
        authority,
        snapshot,
        "backfillCursorInvalid",
        cause,
      )),
    );
}

function backfillResult(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  state: BuildState,
  status: AdvanceAppUniqueConstraintSetBackfillV1Result["status"],
  lifecycle: AdvanceAppUniqueConstraintSetBackfillV1Result["lifecycle"],
  scanned: number,
  claimed: number,
  replayed: number,
  omitted: number,
  cursorDefinitionId: CatalogUniqueConstraintDefinitionId | null,
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
    cursorDefinitionId,
    cursorRowId,
    attemptFence: state.attemptFence,
  });
}

const reconcileInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.reconcileInTransaction",
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
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1).for("update"),
  );
  const existingRow = rows[0];
  if (existingRow === undefined) {
    const directory = yield* loadBuildDirectoryForUpdate(
      tx,
      authority.scopeId,
    );
    if (directory.length >= MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1) {
      return yield* Effect.fail(
        new AppUniqueConstraintSetBuildDirectoryV1Error({
          scopeId: authority.scopeId,
          reason: "tooManyBuildRows",
          maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
        }),
      );
    }
    const initialAttemptFence =
      AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(1n);
    const inserted = yield* queryEffect(
      tx.insert(fxSystemUniqueConstraintSetBuilds).values({
        scopeId: authority.scopeId,
        schemaVersionId: snapshot.schemaVersionId,
        setCodecVersion: APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1,
        definitionCount: snapshot.definitionCount,
        definitionSetSha256: appUniqueConstraintSetSha256HexV1ToBytes(
          snapshot.definitionSetSha256Hex,
        ),
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: clock.storageGenerationFence,
        epoch: clock.epoch,
        startCommitSeq: clock.lastCommitSeq,
        lifecycle: "declared",
        cursorCodecVersion:
          APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
        cursorDefinitionId: null,
        cursorRowId: null,
        attemptFence: initialAttemptFence,
      }).returning(),
    );
    if (inserted.length !== 1) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "concurrentStateChange",
      ));
    }
    yield* runFault(options, "afterBuildInsert");
    return result(
      authority,
      snapshot,
      "created",
      clock.lastCommitSeq,
      initialAttemptFence,
    );
  }

  const existing = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    existingRow,
    clock.lastCommitSeq,
  );
  if (buildAuthorityIsCurrent(existing, clock)) {
    return result(
      authority,
      snapshot,
      "replayed",
      existing.startCommitSeq,
      existing.attemptFence,
    );
  }
  if (existing.attemptFence >= MAX_APP_UNIQUE_CONSTRAINT_SET_BUILD_ATTEMPT_FENCE_V1) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "attemptFenceExhausted",
    ));
  }
  const nextAttemptFence = AppUniqueConstraintSetBuildAttemptFenceV1Schema.make(
    existing.attemptFence + 1n,
  );
  const updated = yield* queryEffect(
    tx.update(fxSystemUniqueConstraintSetBuilds).set({
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      startCommitSeq: clock.lastCommitSeq,
      lifecycle: "declared",
      cursorCodecVersion:
        APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1,
      cursorDefinitionId: null,
      cursorRowId: null,
      attemptFence: nextAttemptFence,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
      eq(
        fxSystemUniqueConstraintSetBuilds.storageGenerationFence,
        existing.storageGenerationFence,
      ),
      eq(fxSystemUniqueConstraintSetBuilds.epoch, existing.epoch),
      eq(fxSystemUniqueConstraintSetBuilds.attemptFence, existing.attemptFence),
    )).returning(),
  );
  if (updated.length !== 1) {
    return yield* Effect.fail(stateError(
      authority,
      snapshot,
      "concurrentStateChange",
    ));
  }
  yield* runFault(options, "afterStaleBuildRedeclare");
  return result(
    authority,
    snapshot,
    "redeclared",
    clock.lastCommitSeq,
    nextAttemptFence,
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
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(new AppUniqueConstraintSetBuildIntegrationV1Error({
          phase: "targetTransaction",
          retryable: false,
          cause,
        })),
      ));
    }
    return yield* Effect.fail(new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }));
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
    observed.startCommitSeq,
    observed.attemptFence,
  );
});

const observeInTransaction = Effect.fn(
  "AppUniqueConstraintSetBuild.observeInTransaction",
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
  const rows = yield* queryEffect(
    tx.select().from(fxSystemUniqueConstraintSetBuilds).where(and(
      eq(fxSystemUniqueConstraintSetBuilds.scopeId, authority.scopeId),
      eq(
        fxSystemUniqueConstraintSetBuilds.schemaVersionId,
        snapshot.schemaVersionId,
      ),
    )).limit(1),
  );
  const row = rows[0];
  if (row === undefined) return null;
  const state = yield* decodeBuildStateEffect(
    authority,
    snapshot,
    row,
    clock.lastCommitSeq,
  );
  return buildAuthorityIsCurrent(state, clock) ? state : null;
});

function decodeBuildStateEffect(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
  row: typeof fxSystemUniqueConstraintSetBuilds.$inferSelect,
  currentLastCommitSeq: bigint,
) {
  return Effect.gen(function* () {
    const definitionSetMatches =
      row.definitionCount === snapshot.definitionCount &&
      isUint8Array(row.definitionSetSha256) &&
      bytesEqual(
        row.definitionSetSha256,
        appUniqueConstraintSetSha256HexV1ToBytes(
          snapshot.definitionSetSha256Hex,
        ),
      );
    const lifecycleAndCursorAreValid =
      isValidLifecycle(row.lifecycle) &&
      row.cursorCodecVersion ===
        APP_UNIQUE_CONSTRAINT_SET_BUILD_CURSOR_CODEC_VERSION_V1 &&
      isValidCursor(row.lifecycle, row.cursorDefinitionId, row.cursorRowId);
    const createdAt = copyFiniteDate(row.createdAt);
    const updatedAt = copyFiniteDate(row.updatedAt);
    if (
      row.scopeId !== authority.scopeId ||
      row.schemaVersionId !== snapshot.schemaVersionId ||
      row.setCodecVersion !== APP_UNIQUE_CONSTRAINT_SET_CODEC_VERSION_V1 ||
      !definitionSetMatches ||
      row.storageGeneration !== "flarexdb_v1" ||
      row.storageGenerationFence < 1n ||
      !isNonBlankString(row.epoch) ||
      row.startCommitSeq < 0n ||
      !lifecycleAndCursorAreValid ||
      row.attemptFence < 1n ||
      createdAt === undefined ||
      updatedAt === undefined ||
      updatedAt.getTime() < createdAt.getTime()
    ) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        definitionSetMatches
          ? "storedStateInvalid"
          : "definitionSetMismatch",
      ));
    }
    if (row.startCommitSeq > currentLastCommitSeq) {
      return yield* Effect.fail(stateError(
        authority,
        snapshot,
        "frontierAheadOfClock",
      ));
    }
    return Object.freeze({
      startCommitSeq: row.startCommitSeq,
      attemptFence: row.attemptFence,
      storageGeneration: row.storageGeneration,
      storageGenerationFence: row.storageGenerationFence,
      epoch: row.epoch,
      // SAFETY: the persisted lifecycle column is constrained to the
      // build-state lifecycle spellings at write time.
      lifecycle: row.lifecycle as BuildState["lifecycle"],
      cursorDefinitionId: row.cursorDefinitionId,
      cursorRowId: row.cursorRowId === null
        ? null
        : new Uint8Array(row.cursorRowId),
    } satisfies BuildState);
  });
}

function isValidLifecycle(value: string): boolean {
  return value === "declared" ||
    value === "building" ||
    value === "backfilling" ||
    value === "validating" ||
    value === "enabled";
}

function isValidCursor(
  lifecycle: string,
  definitionId: number | null,
  rowId: Uint8Array | null,
): boolean {
  const definitionIsValid = definitionId === null ||
    (Number.isSafeInteger(definitionId) &&
      definitionId >= 1 && definitionId <= 2_147_483_647);
  const rowIsValid = rowId === null ||
    (isUint8Array(rowId) && rowId.byteLength === 16);
  if (!definitionIsValid || !rowIsValid) return false;
  if (definitionId === null && rowId !== null) return false;
  return lifecycle === "backfilling" || lifecycle === "validating"
    ? true
    : definitionId === null && rowId === null;
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
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGeneration",
    }));
  }
  if (current.storageGenerationFence !== expected.storageGenerationFence) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "storageGenerationFence",
    }));
  }
  if (current.epoch !== expected.epoch) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: expected.scopeId,
      reason: "epoch",
    }));
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
  return state.storageGeneration === clock.storageGeneration &&
    state.storageGenerationFence === clock.storageGenerationFence &&
    state.epoch === clock.epoch;
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
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: authority.scopeId,
      reason: "storageGeneration",
    }));
  }
  if (state.storageGenerationFence !== clock.storageGenerationFence) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: authority.scopeId,
      reason: "storageGenerationFence",
    }));
  }
  if (state.epoch !== clock.epoch) {
    return Result.fail(new AppUniqueConstraintSetBuildStaleAuthorityV1Error({
      scopeId: authority.scopeId,
      reason: "epoch",
    }));
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
      catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
        phase: "targetTransaction",
        retryable: true,
        cause,
      }),
    });
}

function queryEffect<Row>(query: PromiseLike<ReadonlyArray<Row>>) {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) => new AppUniqueConstraintSetBuildIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
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
  return yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => promise,
    catch: (cause) => cause,
  })));
});

function stateError(
  authority: TrustedScopeAuthority,
  snapshot: BuildSnapshot,
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
  disposition: Extract<
    ReclaimSupersededAppUniqueConstraintSetBuildResult,
    { disposition: "already_absent" | "replayedAfterUncertainCompletion" }
  >["disposition"],
): Extract<
  ReclaimSupersededAppUniqueConstraintSetBuildResult,
  { disposition: "already_absent" | "replayedAfterUncertainCompletion" }
> {
  return Object.freeze({
    status: "reclaimed" as const,
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
  startCommitSeq: CommitSeq,
  attemptFence: AppUniqueConstraintSetBuildAttemptFenceV1,
): Extract<
  ReconcileAppUniqueConstraintSetBuildV1Result,
  { status: "reconciled" }
> {
  return Object.freeze({
    status: "reconciled" as const,
    disposition,
    deploymentId: snapshot.deploymentId,
    scopeId: authority.scopeId,
    schemaVersionId: snapshot.schemaVersionId,
    definitionCount: snapshot.definitionCount,
    definitionSetSha256Hex: snapshot.definitionSetSha256Hex,
    startCommitSeq,
    attemptFence,
  });
}
