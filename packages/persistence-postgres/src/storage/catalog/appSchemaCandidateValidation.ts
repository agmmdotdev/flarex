import { AppSchemaCandidateWriteGuardError } from "./appSchemaCandidateWriteGuardErrors";
import { readFiniteEntryPlanningObservation, type FiniteEntryObservation } from "../../execution/finiteEntryObservation";
import { observeExecution } from "../../execution/diagnostics/operation";
import { runEffectTransaction } from "../../database/effectTransaction";
import { SchemaVersionArtifactPersistenceError } from "./schemaVersionArtifacts";
import {
  prepareCandidateDocumentValidator,
  type CandidateDocumentValidator,
} from "@flarex/managed-schema/candidate-document";
import {
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Clock, Data, Effect, Encoding, Exit, Result, Schema } from "effect";
import {
  AppCreationTimeV1Schema,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from
  "flarex-protocol/commit-protocol";
import {
  CatalogTableIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_VERSION_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_SEMANTIC_BYTES_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_SLICE_MILLISECONDS_V1,
  AppSchemaCandidateValidationAttemptFenceV1Schema,
  AppSchemaCandidateValidationFrameSha256HexV1Schema,
  AppSchemaCandidateManifestSha256HexV1Schema,
  AppSchemaCandidateValidationOperationV1Error,
  appSchemaCandidateManifestSha256HexV1FromBytes,
  canonicalizeAppSchemaCandidateValidationFrameV1Effect,
  decodeCanonicalAppSchemaCandidateValidationFrameV1Effect,
  type AppSchemaCandidateValidationAttemptFenceV1,
  type AppSchemaCandidateValidationFailureEntryV1,
  type AppSchemaCandidateValidationFailureEvidenceFrameV1,
  type AppSchemaCandidateValidationFrameV1,
  type AppSchemaCandidateValidationProgressFrameV1,
  type AppSchemaCandidateValidationReceiptFrameV1,
  type CanonicalAppSchemaCandidateValidationFrameV1,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1Result,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  projectScopeIdUuidV1Result,
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeIdSchema,
  type CommitSeq,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

import type { FlarexMetadataDatabase } from "../../application/deployments";
import { databaseTimestampFromUnknown } from "../../database/databaseTimestamp";
import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";
import { hasExactOwnDataKeys } from "../../values/exactOwnDataKeys";
import {
  readLiveAppRowsAtSnapshotInTransactionEffect,
  type AppRowTransaction,
  type LiveAppRowRevisionV1,
  type ReadAppRowError,
} from "../documents/appRows";
import {
  readSchemaVersionArtifactByIdEffect,
  type ReadSchemaVersionArtifactError,
} from "./schemaVersionArtifacts";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import {
  getScopeClock,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "../../scope/scopeAuthorityResolution";
import { makeInstallationProtectedScopeAuthorityControlReader } from "../../scope/scopeAuthorityControlRead";
import { captureHostPreparationLifetime, registerHostPreparationDisposal } from "../../execution/preparation/preparedHostRuntime";
import { getCoLocatedReadInstallationReferencesResult, type PreparedCoLocatedReadInstallation } from "../../installation/installationLifecycle";
import { prepareProtectedMetadata, captureProtectedMetadataEpoch, authenticateProtectedTargetMetadataSnapshot,
  registerProtectedMetadataFinalGuard, guardProtectedMetadataEpoch, type ProtectedTargetMetadataEvidence } from "../../execution/preparation/preparedMetadataEpoch";
import type { ScopePhysicalLocator } from "../../scope/scopeMetadataTypes";
import {
  captureScopePhysicalLocator,
  scopePhysicalLocatorsEqual,
} from "../../scope/scopePhysicalLocator";
import {
  fxSystemAppSchemaCandidateValidations,
} from "../../database/schema";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import { RUN_LOCATED_READ_COMMITTED_V1, registerLocatedReadCommittedTargetDatabaseV1, isLocatedReadCommittedAttemptTargetV1, type LocatedReadCommittedAttemptTargetV1, type RunLocatedReadCommittedTransactionV1 } from "../../execution/transactionSessionAttemptKernel";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../../execution/transactionSessionActivation";
import type { PointMutationSessionAuthorityResolutionPortsV1 } from
  "../../execution/transactionSessionActivation";

const INPUT_KEYS = Object.freeze(["deploymentId", "scopeId", "schemaVersionId"] as const);
const decodeScopeIdResult = Schema.decodeUnknownResult(Schema.toType(ScopeIdSchema));
const PORT_KEYS = Object.freeze(["controlDb", "authority"] as const);
const WRITE_GUARD_DEPENDENCY_KEYS = Object.freeze([
  "candidateValidation",
  "pointCommitAuthority",
] as const);
const POINT_COMMIT_AUTHORITY_KEYS = Object.freeze([
  "scopeMetadata",
  "provisioningReceipts",
  "scopeSessionTargets",
] as const);
const APPLICATION_POINT_COMMIT_AUTHORITY_KEYS = Object.freeze([
  ...POINT_COMMIT_AUTHORITY_KEYS,
  "applicationControlDb",
] as const);
const appSchemaCandidateValidationPortBrand: unique symbol = Symbol(
  "Flarex/AppSchemaCandidateValidationPort",
);
const appSchemaCandidateReadinessPortBrand: unique symbol = Symbol(
  "Flarex/AppSchemaCandidateReadinessPort",
);
const appSchemaCandidateReadinessEvidenceBrand: unique symbol = Symbol(
  "Flarex/AppSchemaCandidateReadinessEvidence",
);
const preparedCandidateInstallBrand: unique symbol = Symbol(
  "Flarex/PreparedAppSchemaCandidateValidationInstall",
);
const expectedCandidateHeadClaimBrand: unique symbol = Symbol(
  "Flarex/ExpectedAppSchemaCandidateValidationHeadClaim",
);
const MAX_LIVE_ROWS_PER_MATERIALIZATION_CHUNK = 8;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const SLICE_NANOSECONDS =
  BigInt(MAX_APP_SCHEMA_CANDIDATE_VALIDATION_SLICE_MILLISECONDS_V1) * 1_000_000n;
const EXHAUSTED_SCAN_CURSOR = Object.freeze({
  afterTableId: CatalogTableIdSchema.make(2_147_483_647),
  afterRowId: decodeAppRowIdHexV1("f".repeat(32)),
});
const decodeSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(AppSchemaCandidateValidationAttemptFenceV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const isAppCreationTime = Schema.is(AppCreationTimeV1Schema);
const FLAREXDB_V1_STORAGE_GENERATION =
  FlarexDbV1StorageGenerationSchema.make("flarexdb_v1");

export interface AppSchemaCandidateValidationInput {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export interface LocatedAppSchemaCandidateValidationTarget
  extends LocatedReadCommittedAttemptTargetV1 {}

export function createLocatedAppSchemaCandidateValidationTarget(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedAppSchemaCandidateValidationTarget {
  const target = Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
  });
  registerLocatedReadCommittedTargetDatabaseV1(target, db);
  return target;
}

export interface AppSchemaCandidateValidationPortDependencies {
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedAppSchemaCandidateValidationTarget
  >;
}

export interface AppSchemaCandidateValidationPort {
  readonly [appSchemaCandidateValidationPortBrand]: true;
}

/**
 * Process-local authority for composing candidate installation into another
 * owner of the same located target transaction. It is not a wire or storage
 * contract and cannot be reconstructed structurally.
 */
export interface PreparedAppSchemaCandidateValidationInstall {
  readonly [preparedCandidateInstallBrand]: true;
}

export interface ExpectedAppSchemaCandidateValidationHeadClaim {
  readonly [expectedCandidateHeadClaimBrand]: true;
}

export interface ClaimedAppSchemaCandidateValidationHead {
  readonly claim: ExpectedAppSchemaCandidateValidationHeadClaim;
  readonly head: StoredAppSchemaCandidateValidationHead | null;
  readonly target: LocatedAppSchemaCandidateValidationTarget;
  readonly authority: TrustedScopeAuthority;
}

interface ExpectedAppSchemaCandidateValidationHead {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly frameSha256Hex: StoredAppSchemaCandidateValidationHead["frameSha256Hex"];
}

const portStates = new WeakMap<
  AppSchemaCandidateValidationPort,
  Readonly<AppSchemaCandidateValidationPortDependencies>
>();
const preparedCandidateInstallStates = new WeakMap<
  PreparedAppSchemaCandidateValidationInstall,
  Readonly<{
    readonly port: AppSchemaCandidateValidationPort;
    readonly snapshot: CandidateSnapshot;
    readonly located: LocatedTrustedScopeAuthority<
      LocatedAppSchemaCandidateValidationTarget
    >;
  }>
>();
const expectedCandidateHeadClaimStates = new WeakMap<
  ExpectedAppSchemaCandidateValidationHeadClaim,
  Readonly<{
    readonly port: AppSchemaCandidateValidationPort;
    readonly prepared: PreparedAppSchemaCandidateValidationInstall;
    readonly head: StoredAppSchemaCandidateValidationHead | null;
  }>
>();
const candidateValidationPointCommitBindings = new WeakMap<
  AppSchemaCandidateValidationPort,
  PointMutationSessionAuthorityResolutionPortsV1
>();

export function createAppSchemaCandidateValidationPort(
  dependencies: AppSchemaCandidateValidationPortDependencies,
): AppSchemaCandidateValidationPort {
  const port = Object.freeze({
    [appSchemaCandidateValidationPortBrand]: true as const,
  });
  if (hasExactOwnDataKeys(dependencies, PORT_KEYS)) {
    portStates.set(port, Object.freeze({
      controlDb: dependencies.controlDb,
      authority: dependencies.authority,
    }));
  }
  return port;
}

export function createAppSchemaCandidateValidationPortForPointCommitAuthority(
  controlDb: FlarexMetadataDatabase,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): AppSchemaCandidateValidationPort {
  if (!hasPointCommitAuthorityOwnDataKeys(pointCommitAuthority)) {
    return Object.freeze({
      [appSchemaCandidateValidationPortBrand]: true as const,
    });
  }
  const scopeMetadata = pointCommitAuthority.scopeMetadata;
  const provisioningReceipts = pointCommitAuthority.provisioningReceipts;
  const scopeSessionTargets = pointCommitAuthority.scopeSessionTargets;
  const port = createAppSchemaCandidateValidationPort({
    controlDb,
    authority: {
      scopeMetadata,
      provisioningReceipts,
      scopeClockTargets: {
        resolve: async (locator) => {
          const target = await scopeSessionTargets.resolve(locator);
          if (!isLocatedReadCommittedAttemptTargetV1(target)) {
            throw new Error(
              "Point-commit target lacks read-committed candidate validation.",
            );
          }
          return target;
        },
      },
    },
  });
  candidateValidationPointCommitBindings.set(port, pointCommitAuthority);
  return port;
}

/** Exact host-composition guard for later commit/readiness consumers. */
export function hasAppSchemaCandidateValidationComposition(
  port: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedAppSchemaCandidateValidationTarget
  >,
): port is AppSchemaCandidateValidationPort {
  if (typeof port !== "object" || port === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  const state = portStates.get(port as AppSchemaCandidateValidationPort);
  return state !== undefined &&
    state.controlDb === controlDb &&
    state.authority === authority;
}

/** Private process-local M03-C readiness capability. */
export interface AppSchemaCandidateReadinessPort {
  readonly [appSchemaCandidateReadinessPortBrand]: true;
}

export interface AppSchemaCandidateReadinessInput {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256Hex: ReturnType<
    typeof AppSchemaCandidateManifestSha256HexV1Schema.make
  >;
}

export interface AppSchemaCandidateReadinessEvidence {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly schemaManifestSha256Hex: ReturnType<
    typeof AppSchemaCandidateManifestSha256HexV1Schema.make
  >;
  readonly receiptSha256Hex: ReturnType<
    typeof AppSchemaCandidateValidationFrameSha256HexV1Schema.make
  >;
  readonly [appSchemaCandidateReadinessEvidenceBrand]: true;
}

export interface AppSchemaCandidateReadinessReceiptExpectation
  extends AppSchemaCandidateReadinessInput {
  readonly receiptSha256Hex: ReturnType<
    typeof AppSchemaCandidateValidationFrameSha256HexV1Schema.make
  >;
}

export type AppSchemaCandidateReadinessResult =
  | Readonly<{
      readonly status: "not_ready";
      readonly reason: "missing" | "inProgress" | "failed" | "wrongSchema";
    }>
  | Readonly<{
      readonly status: "ready";
      readonly evidence: AppSchemaCandidateReadinessEvidence;
    }>;

export class AppSchemaCandidateReadinessError extends Data.TaggedError(
  "AppSchemaCandidateReadinessError",
)<{
  readonly reason:
    | "invalidPort"
    | "scopeMismatch"
    | "concurrentStateChange"
    | "corruption";
}> {}

export type LoadAppSchemaCandidateReadinessError =
  | AppSchemaCandidateReadinessError
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError;

export type ValidateAppSchemaCandidateReadinessError =
  | AppSchemaCandidateReadinessError
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError;

const candidateReadinessPortStates = new WeakMap<
  AppSchemaCandidateReadinessPort,
  Readonly<AppSchemaCandidateValidationPortDependencies>
>();
const candidateReadinessEvidenceStates = new WeakMap<
  AppSchemaCandidateReadinessEvidence,
  Readonly<{
    readonly port: AppSchemaCandidateReadinessPort;
  }>
>();

export function createAppSchemaCandidateReadinessPort(
  candidateValidation: AppSchemaCandidateValidationPort,
): AppSchemaCandidateReadinessPort {
  const port = Object.freeze({
    [appSchemaCandidateReadinessPortBrand]: true as const,
  });
  const state = portStates.get(candidateValidation);
  if (state !== undefined) candidateReadinessPortStates.set(port, state);
  return port;
}

export function hasAppSchemaCandidateReadinessComposition(
  port: unknown,
  controlDb: FlarexMetadataDatabase,
  authority: TrustedScopeAuthorityResolutionPorts,
): port is AppSchemaCandidateReadinessPort {
  if (typeof port !== "object" || port === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  const state = candidateReadinessPortStates.get(
    port as AppSchemaCandidateReadinessPort,
  );
  return state !== undefined &&
    state.controlDb === controlDb &&
    state.authority === authority;
}

export const loadAppSchemaCandidateReadinessEffect = Effect.fn(
  "AppSchemaCandidateValidation.loadReadiness",
)(function* (
  port: AppSchemaCandidateReadinessPort,
  input: AppSchemaCandidateReadinessInput,
): Effect.fn.Return<
  AppSchemaCandidateReadinessResult,
  LoadAppSchemaCandidateReadinessError
> {
  const state = candidateReadinessPortStates.get(port);
  if (state === undefined) {
    return yield* new AppSchemaCandidateReadinessError({
      reason: "invalidPort",
    });
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    input,
    {
      ...state.authority,
      ...makeInstallationProtectedScopeAuthorityControlReader(state.controlDb),
    },
  );
  if (located.authority.scopeId !== input.scopeId) {
    return yield* new AppSchemaCandidateReadinessError({
      reason: "scopeMismatch",
    });
  }
  const loadOnce = () => runLocatedTransaction(
    located.target,
    "load",
    (tx) => Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(
        tx,
        input.scopeId,
      );
      yield* Effect.fromResult(requireExactAuthorityResult(
        located.authority,
        clock,
        "load",
      ));
      const head = yield* readHeadEffect(
        tx,
        input.scopeId,
        "share",
      );
      return yield* inspectCandidateReadinessHead(
        port,
        input,
        clock,
        head,
      );
    }),
  );
  return yield* loadOnce().pipe(Effect.catchTag(
    "AppSchemaCandidateValidationOperationV1Error",
    error => error.operation === "load" && error.reason === "decisionUncertain"
      ? loadOnce()
      : Effect.fail(error),
  ));
});

/** Caller already owns the exact scope-clock lock in its readiness transaction. */
export const validateAppSchemaCandidateReadinessInTransactionEffect = Effect.fn(
  "AppSchemaCandidateValidation.validateReadinessInTransaction",
)(function* (
  tx: AppRowTransaction,
  port: AppSchemaCandidateReadinessPort,
  evidence: AppSchemaCandidateReadinessEvidence,
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  evidenceLock: "share" | "update",
): Effect.fn.Return<
  AppSchemaCandidateReadinessResult,
  ValidateAppSchemaCandidateReadinessError
> {
  const portState = candidateReadinessPortStates.get(port);
  const evidenceState = candidateReadinessEvidenceStates.get(evidence);
  if (portState === undefined || evidenceState?.port !== port) {
    return yield* new AppSchemaCandidateReadinessError({
      reason: "invalidPort",
    });
  }
  if (
    evidence.scopeId !== authority.scopeId ||
    evidence.scopeId !== clock.scopeId ||
    authority.storageGeneration !== clock.storageGeneration ||
    authority.storageGenerationFence !== clock.storageGenerationFence ||
    authority.epoch !== clock.epoch
  ) {
    return yield* new AppSchemaCandidateReadinessError({
      reason: "scopeMismatch",
    });
  }
  return yield* validateExpectedCandidateReadinessInTransaction(
    tx,
    port,
    evidence,
    evidence.receiptSha256Hex,
    clock,
    evidenceLock,
  ).pipe(Effect.map(result => result.status === "ready"
    ? Object.freeze({ status: "ready" as const, evidence })
    : result));
});

/** First activation can recheck a digest already committed by readiness. */
export const validateAppSchemaCandidateReadinessReceiptInTransactionEffect =
  Effect.fn(
    "AppSchemaCandidateValidation.validateReadinessReceiptInTransaction",
  )(function* (
    tx: AppRowTransaction,
    port: AppSchemaCandidateReadinessPort,
    expectation: AppSchemaCandidateReadinessReceiptExpectation,
    authority: TrustedScopeAuthority,
    clock: ScopeClockRecord,
    evidenceLock: "share" | "update",
  ): Effect.fn.Return<
    AppSchemaCandidateReadinessResult,
    ValidateAppSchemaCandidateReadinessError
  > {
    if (!candidateReadinessPortStates.has(port)) {
      return yield* new AppSchemaCandidateReadinessError({
        reason: "invalidPort",
      });
    }
    if (
      expectation.scopeId !== authority.scopeId ||
      expectation.scopeId !== clock.scopeId ||
      authority.storageGeneration !== clock.storageGeneration ||
      authority.storageGenerationFence !== clock.storageGenerationFence ||
      authority.epoch !== clock.epoch
    ) {
      return yield* new AppSchemaCandidateReadinessError({
        reason: "scopeMismatch",
      });
    }
    return yield* validateExpectedCandidateReadinessInTransaction(
      tx,
      port,
      expectation,
      expectation.receiptSha256Hex,
      clock,
      evidenceLock,
    );
  });

const validateExpectedCandidateReadinessInTransaction = Effect.fn(
  "AppSchemaCandidateValidation.validateExpectedReadinessInTransaction",
)(function* (
  tx: AppRowTransaction,
  port: AppSchemaCandidateReadinessPort,
  input: AppSchemaCandidateReadinessInput,
  expectedReceiptSha256Hex: ReturnType<
    typeof AppSchemaCandidateValidationFrameSha256HexV1Schema.make
  >,
  clock: ScopeClockRecord,
  evidenceLock: "share" | "update",
): Effect.fn.Return<
  AppSchemaCandidateReadinessResult,
  ValidateAppSchemaCandidateReadinessError
> {
  const current = yield* readHeadEffect(
    tx,
    input.scopeId,
    evidenceLock,
  );
  const inspected = yield* inspectCandidateReadinessHead(
    port,
    input,
    clock,
    current,
  );
  if (inspected.status !== "ready") return inspected;
  if (inspected.evidence.receiptSha256Hex !== expectedReceiptSha256Hex) {
    return yield* new AppSchemaCandidateReadinessError({
      reason: "concurrentStateChange",
    });
  }
  return inspected;
});

const inspectCandidateReadinessHead = Effect.fn(
  "AppSchemaCandidateValidation.inspectReadinessHead",
)(function* (
  port: AppSchemaCandidateReadinessPort,
  input: AppSchemaCandidateReadinessInput,
  clock: ScopeClockRecord,
  head: StoredAppSchemaCandidateValidationHead | null,
): Effect.fn.Return<
  AppSchemaCandidateReadinessResult,
  AppSchemaCandidateReadinessError | AppSchemaCandidateValidationOperationV1Error
> {
  if (head === null) {
    return Object.freeze({ status: "not_ready" as const, reason: "missing" as const });
  }
  yield* Effect.fromResult(requireHeadAuthorityResult(head, clock, "load"));
  if (head.deploymentId !== input.deploymentId || head.scopeId !== input.scopeId) {
    return yield* new AppSchemaCandidateReadinessError({ reason: "corruption" });
  }
  if (
    head.schemaVersionId !== input.schemaVersionId ||
    head.frame.schemaManifestSha256Hex !== input.schemaManifestSha256Hex
  ) {
    return Object.freeze({
      status: "not_ready" as const,
      reason: "wrongSchema" as const,
    });
  }
  switch (head.frame.kind) {
    case "app_schema_candidate_validation_progress":
      return Object.freeze({
        status: "not_ready" as const,
        reason: "inProgress" as const,
      });
    case "app_schema_candidate_validation_failure_evidence":
      return Object.freeze({
        status: "not_ready" as const,
        reason: "failed" as const,
      });
    case "app_schema_candidate_validation_receipt": {
      const evidence = Object.freeze({
        deploymentId: head.deploymentId,
        scopeId: head.scopeId,
        schemaVersionId: head.schemaVersionId,
        schemaManifestSha256Hex: head.frame.schemaManifestSha256Hex,
        receiptSha256Hex: head.frameSha256Hex,
        [appSchemaCandidateReadinessEvidenceBrand]: true as const,
      } satisfies AppSchemaCandidateReadinessEvidence);
      candidateReadinessEvidenceStates.set(evidence, Object.freeze({ port }));
      return Object.freeze({ status: "ready" as const, evidence });
    }
    default: {
      const unreachable: never = head.frame;
      return unreachable;
    }
  }
});

const appSchemaCandidateWriteGuardBrand: unique symbol = Symbol(
  "Flarex/AppSchemaCandidateWriteGuard",
);
const preparedAppSchemaCandidateWriteGuardBrand: unique symbol = Symbol(
  "Flarex/PreparedAppSchemaCandidateWriteGuard",
);

export interface AppSchemaCandidateWriteGuardPort {
  readonly [appSchemaCandidateWriteGuardBrand]: true;
}

export interface PreparedAppSchemaCandidateWriteGuard {
  readonly [preparedAppSchemaCandidateWriteGuardBrand]: true;
}

export interface AppSchemaCandidateWriteGuardDependencies {
  readonly candidateValidation: AppSchemaCandidateValidationPort;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1;
}

type CandidateWriteGuardState = Readonly<{
  readonly candidateValidation: AppSchemaCandidateValidationPortDependencies;
  readonly pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1;
  readonly finite?: Readonly<{
    authority: TrustedScopeAuthority;
    head: StoredAppSchemaCandidateValidationHead | null;
    validator: CandidateDocumentValidator | null;
    lifetime: NonNullable<Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>>;
    protection?: ProtectedTargetMetadataEvidence;
  }>;
}>;

type PreparedCandidateWriteGuardState = Readonly<{
  readonly guard: AppSchemaCandidateWriteGuardPort;
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly head: StoredAppSchemaCandidateValidationHead | null;
  readonly validator: CandidateDocumentValidator | null;
  readonly finite?: CandidateWriteGuardState["finite"];
  readonly manifest?: SchemaManifestAppSchemaV1;
}>;

const candidateWriteGuardStates = new WeakMap<
  AppSchemaCandidateWriteGuardPort,
  CandidateWriteGuardState
>();
const preparedCandidateWriteGuardStates = new WeakMap<
  PreparedAppSchemaCandidateWriteGuard,
  PreparedCandidateWriteGuardState
>();

const candidatePlanningHeadBrand: unique symbol = Symbol("Flarex/CandidatePlanningHead");
export interface AppSchemaCandidateWriteGuardPlanningHead {
  readonly [candidatePlanningHeadBrand]: true;
}
const candidatePlanningHeads = new WeakMap<AppSchemaCandidateWriteGuardPlanningHead,
  Readonly<{ authority: TrustedScopeAuthority; row: HeadRow | null;
    issuer: PointMutationSessionAuthorityResolutionPortsV1; tx?: AppRowTransaction; decoded?: StoredAppSchemaCandidateValidationHead | null }>>();

/** Fixed publication stage lends its actual locked row to this original owner. */
export function captureAppSchemaCandidateWriteGuardLockedHead(tx: AppRowTransaction,
  guard: AppSchemaCandidateWriteGuardPort, authority: TrustedScopeAuthority, row: HeadRow | null) {
  const state = candidateWriteGuardStates.get(guard);
  if (state === undefined) return Result.fail(new AppSchemaCandidateWriteGuardError({ reason: "notIssued" }));
  const handle = Object.freeze({ [candidatePlanningHeadBrand]: true as const });
  candidatePlanningHeads.set(handle, Object.freeze({ tx, authority: structuredClone(authority),
    issuer: state.pointCommitAuthority, row: row === null ? null : structuredClone(row) }));
  return Result.succeed(handle);
}

/** Exact decoded identity, including negative observation and progress/failure ABA. */
export const readAppSchemaCandidateWriteGuardPlanningHeadIdentity = Effect.fnUntraced(
  function* (handle: AppSchemaCandidateWriteGuardPlanningHead, issuer: PointMutationSessionAuthorityResolutionPortsV1) {
    const captured = candidatePlanningHeads.get(handle);
    if (captured === undefined || captured.issuer !== issuer)
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "notIssued" }));
    const decoded = captured.decoded !== undefined ? captured.decoded : captured.row === null ? null :
      yield* decodeHeadRowEffect(captured.row, "load").pipe(Effect.mapError(mapCandidateWriteGuardError));
    // The decoded original replaces its raw transport; the generation retains
    // and charges this same frame rather than a second hidden byte payload.
    candidatePlanningHeads.set(handle, Object.freeze({ ...captured, row: null, decoded }));
    return decoded === null ? "absent" : JSON.stringify([decoded.deploymentId, decoded.scopeId, decoded.schemaVersionId,
      decoded.frameSha256Hex, decoded.createdAt.getTime(), decoded.updatedAt.getTime()]);
  }, work => observeExecution("AppSchemaCandidateValidation.planningIdentity", work));

/** Internal entry/seal capture. No control read, frame hashing or validator
 * compilation runs while the accepting transaction is open. Its entry/journal
 * owner releases this handle only after that transaction has committed. */
export const captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect =
  Effect.fnUntraced(function* (
    tx: AppRowTransaction, authority: TrustedScopeAuthority,
    issuer: PointMutationSessionAuthorityResolutionPortsV1, finiteEntry?: FiniteEntryObservation,
  ) {
    const observed = finiteEntry === undefined ? undefined : yield* Effect.fromResult(readFiniteEntryPlanningObservation(
      finiteEntry, tx, authority.scopeId, authority.storageGeneration)).pipe(Effect.mapError(cause =>
        new AppSchemaCandidateValidationPersistenceError({ operation: "readHead", cause })));
    const rows = observed === undefined ? yield* queryEffect("readHead", tx.select()
      .from(fxSystemAppSchemaCandidateValidations).where(
        eq(fxSystemAppSchemaCandidateValidations.scopeId, authority.scopeId),
      ).limit(1)) : undefined;
    const handle = Object.freeze({ [candidatePlanningHeadBrand]: true as const });
    candidatePlanningHeads.set(handle, Object.freeze({
      authority: Object.freeze(structuredClone(authority)), issuer,
      row: observed === undefined ? (rows?.[0] === undefined ? null : structuredClone(rows[0])) : observed,
    }));
    return handle;
  }, work => observeExecution("AppSchemaCandidateValidation.capturePlanningHead", work));

export const prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect =
  Effect.fn("AppSchemaCandidateValidation.prepareCapturedWriteGuard")(function* (
    guard: AppSchemaCandidateWriteGuardPort,
    captured: AppSchemaCandidateWriteGuardPlanningHead,
  ): Effect.fn.Return<PreparedAppSchemaCandidateWriteGuard,
    AppSchemaCandidateWriteGuardError> {
    const state = candidateWriteGuardStates.get(guard);
    const capture = candidatePlanningHeads.get(captured);
    if (state === undefined || capture === undefined) {
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "notIssued" }));
    }
    if (state.pointCommitAuthority !== capture.issuer) {
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
    }
    // The original planning owner captured this exact authority under entry.
    // Final application still authenticates the candidate and owning clock.
    const head = capture.decoded !== undefined ? capture.decoded : capture.row === null ? null : yield* decodeHeadRowEffect(
      capture.row, "load",
    ).pipe(Effect.mapError(mapCandidateWriteGuardError));
    const prepared = yield* prepareWriteGuardFromDecodedHeadEffect(guard, state,
      { deploymentId: capture.authority.deploymentId, scopeId: capture.authority.scopeId },
      capture.authority, head);
    const allocation = yield* captureHostPreparationLifetime();
    if (allocation !== undefined) {
      const payload = preparedCandidateWriteGuardStates.get(prepared);
      if (payload === undefined) return yield* Effect.die(new Error("Candidate preparation issuance was lost"));
      const dispose = () => { preparedCandidateWriteGuardStates.delete(prepared); };
      const registered = allocation.onDispose(dispose);
      if (Result.isFailure(registered)) dispose();
      yield* Effect.fromResult(registered).pipe(Effect.mapError(cause =>
        new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
      yield* Effect.fromResult(allocation.charge(JSON.stringify({ head, manifest: payload.manifest },
        (_, value: unknown) => typeof value === "bigint" ? value.toString() : value))).pipe(Effect.mapError(cause =>
        new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
    }
    return prepared;
  });

/** The finite entry lends its issued head capture. Final acceptance rechecks
 * the exact head under its existing authority/sequencer exclusion. */
export const prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect =
  Effect.fn("AppSchemaCandidateValidation.prepareFiniteCapturedWriteGuard")(function* (
    guard: AppSchemaCandidateWriteGuardPort,
    captured: AppSchemaCandidateWriteGuardPlanningHead,
    input: Readonly<{ deploymentId: string; scopeId: ScopeId }>,
  ): Effect.fn.Return<PreparedAppSchemaCandidateWriteGuard, AppSchemaCandidateWriteGuardError> {
    const state = candidateWriteGuardStates.get(guard);
    const capture = candidatePlanningHeads.get(captured);
    if (state === undefined || capture === undefined)
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "notIssued" }));
    if (state.pointCommitAuthority !== capture.issuer || capture.authority.deploymentId !== input.deploymentId ||
      capture.authority.scopeId !== input.scopeId)
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
    const head = capture.decoded !== undefined ? capture.decoded : capture.row === null ? null : yield* decodeHeadRowEffect(capture.row, "load")
      .pipe(Effect.mapError(mapCandidateWriteGuardError));
    const finite = state.finite;
    if (finite === undefined || !trustedAuthoritiesEqual(finite.authority, capture.authority) ||
      !sameCandidateSchemaSelection(finite.head, head))
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "concurrentStateChange" }));
    yield* Effect.fromResult(finite.lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
    // The owner-role lane has no protected writer guarantee. It retains the
    // complete original artifact verification rather than minting epoch proof.
    if (finite.protection === undefined) {
      const fresh = yield* prepareWriteGuardFromDecodedHeadEffect(guard, state, input, capture.authority, head);
      const freshState = preparedCandidateWriteGuardStates.get(fresh);
      if (freshState === undefined) return yield* Effect.die(new Error("Candidate preparation issuance was lost"));
      return issuePreparedCandidateWriteGuard(guard, input, head, freshState.validator, finite, freshState.manifest);
    }
    return issuePreparedCandidateWriteGuard(guard, input, head, finite.validator, finite);
  });

/** Construct once under the existing retained host lease. Exact captured heads
 * select these compiled semantics; current admission and the final metadata
 * epoch lock remain obligations of the accepting transaction. */
export const prepareFiniteAppSchemaCandidateWriteGuardPortEffect = Effect.fn(
  "AppSchemaCandidateValidation.prepareFiniteGuardPort",
)(function* (dependencies: AppSchemaCandidateWriteGuardDependencies,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId } & (
    { profile: "installed"; database: FlarexMetadataDatabase; installation: PreparedCoLocatedReadInstallation } |
    { profile: "fullArtifactProof"; database?: never; installation?: never })>,
): Effect.fn.Return<AppSchemaCandidateWriteGuardPort, AppSchemaCandidateWriteGuardError> {
  const guard = createAppSchemaCandidateWriteGuardPort(dependencies);
  const state = candidateWriteGuardStates.get(guard);
  const lifetime = yield* captureHostPreparationLifetime();
  if (state === undefined || lifetime === undefined)
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(input,
    { ...state.candidateValidation.authority, ...makeInstallationProtectedScopeAuthorityControlReader(state.candidateValidation.controlDb) })
    .pipe(Effect.mapError(mapCandidateWriteGuardError));
  const installed = input.profile === "installed" ? input : undefined;
  const installedPreparation = installed === undefined ? undefined : yield* Effect.gen(function* () {
    const refs = yield* Effect.fromResult(getCoLocatedReadInstallationReferencesResult(installed.installation, installed.database));
    const token = yield* prepareProtectedMetadata(installed.database, refs.controlInstallation);
    return { refs, token, database: installed.database };
  }).pipe(Effect.mapError(cause => new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
  const captured = yield* runLocatedTransaction(located.target, "load", tx => Effect.gen(function* () {
    const head = yield* readHeadEffect(tx, located.authority.scopeId, "planning");
    const protection = installedPreparation === undefined ? undefined : {
      database: installedPreparation.database, token: installedPreparation.token,
      epoch: yield* captureProtectedMetadataEpoch(installedPreparation.token, installedPreparation.database, tx),
    };
    let snapshot: CandidateSnapshot | undefined;
    if (head !== null && head.frame.kind !== "app_schema_candidate_validation_failure_evidence" && installedPreparation !== undefined) {
      yield* Effect.tryPromise({ try: () => tx.execute(sql`select pg_catalog.set_config('search_path',
        pg_catalog.format('%I, pg_temp', ${installedPreparation.refs.control.schemaName}::text), true)`),
        catch: cause => new AppSchemaCandidateValidationPersistenceError({ operation: "readHead", cause }) });
      snapshot = yield* loadCandidateSnapshotInTransaction(tx, { ...input, schemaVersionId: head.schemaVersionId }, "advance");
      yield* Effect.tryPromise({ try: () => tx.execute(sql`select pg_catalog.set_config('search_path',
        pg_catalog.format('%I, pg_temp', ${installedPreparation.refs.target.schemaName}::text), true)`),
        catch: cause => new AppSchemaCandidateValidationPersistenceError({ operation: "readHead", cause }) });
      if (!headMatchesSnapshot(head, located.authority, snapshot))
        return yield* Effect.fail(operationError("load", "corruption"));
    }
    if (protection !== undefined)
      yield* guardProtectedMetadataEpoch(protection.token, protection.database, protection.epoch, tx);
    return { head, protection, snapshot };
  })).pipe(Effect.mapError(cause => new AppSchemaCandidateWriteGuardError({ reason: "persistence", cause })));
  const prepared = installedPreparation === undefined
    ? issuePreparedCandidateWriteGuard(guard, input, captured.head, null)
    : issuePreparedCandidateWriteGuard(guard, input, captured.head,
      captured.snapshot === undefined ? null : prepareCandidateDocumentValidator(captured.snapshot.manifest), undefined, captured.snapshot?.manifest);
  const preparedState = preparedCandidateWriteGuardStates.get(prepared);
  if (preparedState === undefined) return yield* Effect.die(new Error("Candidate preparation issuance was lost"));
  // Charge actual retained semantics, including an empty selection. The live
  // validator's manifest was decoded and hashed by its existing schema owner.
  yield* Effect.fromResult(lifetime.charge(JSON.stringify({ authority: located.authority,
    head: captured.head, manifest: preparedState.manifest }, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value))).pipe(Effect.mapError(cause =>
      new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
  candidateWriteGuardStates.set(guard, Object.freeze({ ...state, finite: Object.freeze({
    authority: located.authority, head: captured.head, validator: preparedState.validator, lifetime,
    ...(captured.protection === undefined ? {} : { protection: captured.protection }),
  }) }));
  yield* registerHostPreparationDisposal(() => {
    candidateWriteGuardStates.delete(guard);
    preparedCandidateWriteGuardStates.delete(prepared);
  }).pipe(Effect.mapError(cause => new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
  return guard;
});

function sameCandidateSchemaSelection(left: StoredAppSchemaCandidateValidationHead | null,
  right: StoredAppSchemaCandidateValidationHead | null): boolean {
  return left === null || right === null ? left === right :
    left.deploymentId === right.deploymentId && left.scopeId === right.scopeId &&
    left.schemaVersionId === right.schemaVersionId &&
    left.frame.schemaManifestSha256Hex === right.frame.schemaManifestSha256Hex &&
    left.frame.storageGeneration === right.frame.storageGeneration &&
    left.frame.storageGenerationFence === right.frame.storageGenerationFence &&
    left.frame.scopeEpoch === right.frame.scopeEpoch && left.frame.attemptFence === right.frame.attemptFence;
}

export function createAppSchemaCandidateWriteGuardPort(
  dependencies: AppSchemaCandidateWriteGuardDependencies,
): AppSchemaCandidateWriteGuardPort {
  const guard = Object.freeze({
    [appSchemaCandidateWriteGuardBrand]: true as const,
  });
  if (hasExactOwnDataKeys(dependencies, WRITE_GUARD_DEPENDENCY_KEYS)) {
    const candidateValidation = portStates.get(
      dependencies.candidateValidation,
    );
    const pointCommitAuthority = dependencies.pointCommitAuthority;
    if (
      hasPointCommitAuthorityOwnDataKeys(pointCommitAuthority) &&
      (
        !hasApplicationPointCommitAuthorityOwnDataKeys(pointCommitAuthority) ||
        candidateValidation?.controlDb ===
          pointCommitAuthority.applicationControlDb
      ) &&
      candidateValidation !== undefined &&
      candidateValidation.authority.scopeMetadata ===
        pointCommitAuthority.scopeMetadata &&
      candidateValidation.authority.provisioningReceipts ===
        pointCommitAuthority.provisioningReceipts &&
      (
        candidateValidation.authority.scopeClockTargets ===
          pointCommitAuthority.scopeSessionTargets ||
        candidateValidationPointCommitBindings.get(
          dependencies.candidateValidation,
        ) === pointCommitAuthority
      )
    ) {
      candidateWriteGuardStates.set(guard, Object.freeze({
        candidateValidation,
        pointCommitAuthority,
      }));
    }
  }
  return guard;
}

export function hasAppSchemaCandidateWriteGuardComposition(
  guard: unknown,
  pointCommitAuthority: PointMutationSessionAuthorityResolutionPortsV1,
): guard is AppSchemaCandidateWriteGuardPort {
  if (typeof guard !== "object" || guard === null) return false;
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered port brand.
  return candidateWriteGuardStates.get(guard as AppSchemaCandidateWriteGuardPort)
    ?.pointCommitAuthority === pointCommitAuthority;
}

function hasPointCommitAuthorityOwnDataKeys(
  value: PointMutationSessionAuthorityResolutionPortsV1,
): boolean {
  return hasExactOwnDataKeys(value, POINT_COMMIT_AUTHORITY_KEYS) ||
    hasApplicationPointCommitAuthorityOwnDataKeys(value);
}

function hasApplicationPointCommitAuthorityOwnDataKeys(
  value: PointMutationSessionAuthorityResolutionPortsV1,
): value is PointMutationSessionAuthorityResolutionPortsV1 & Readonly<{
  readonly applicationControlDb: FlarexMetadataDatabase;
}> {
  return hasExactOwnDataKeys(value, APPLICATION_POINT_COMMIT_AUTHORITY_KEYS);
}

export interface AppSchemaCandidateWriteGuardLiveRow {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly document: CanonicalFlarexValueV1;
}

export type AppSchemaCandidateWriteGuardResult = Readonly<{
  readonly status: "unchanged" | "candidateFailed";
}>;

const UNCHANGED_CANDIDATE_WRITE_GUARD_RESULT = Object.freeze({
  status: "unchanged" as const,
});
const FAILED_CANDIDATE_WRITE_GUARD_RESULT = Object.freeze({
  status: "candidateFailed" as const,
});

export type AppSchemaCandidateValidationFaultPoint =
  | "afterInstallWrite"
  | "afterProgressWrite"
  | "afterFailureWrite"
  | "afterReceiptWrite";

export interface AppSchemaCandidateValidationOptions {
  /** Test-only monotonic clock override; production uses Effect Clock. */
  readonly monotonicNow?: Effect.Effect<bigint>;
  readonly faultAfter?: (point: AppSchemaCandidateValidationFaultPoint) => void;
}

export interface StoredAppSchemaCandidateValidationHead {
  readonly deploymentId: string;
  readonly scopeId: ScopeId;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly frame: AppSchemaCandidateValidationFrameV1;
  readonly frameSha256Hex: ReturnType<
    typeof AppSchemaCandidateValidationFrameSha256HexV1Schema.make
  >;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type InstallAppSchemaCandidateValidationResult = Readonly<{
  readonly disposition: "installed" | "replayed" | "restarted" | "superseded";
  readonly head: StoredAppSchemaCandidateValidationHead;
}>;

export type AdvanceAppSchemaCandidateValidationResult = Readonly<{
  readonly disposition: "advanced" | "readyToSettle" | "failed";
  readonly processedIdentities: number;
  readonly validatedRows: number;
  readonly head: StoredAppSchemaCandidateValidationHead;
}>;

export type LoadAppSchemaCandidateValidationResult =
  | Readonly<{ readonly status: "absent" }>
  | Readonly<{
      readonly status: "present";
      readonly head: StoredAppSchemaCandidateValidationHead;
    }>;

export type AppSchemaCandidateValidationError =
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | ReadSchemaVersionArtifactError
  | ReadAppRowError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError;

export class AppSchemaCandidateValidationPersistenceError
  extends Data.TaggedError("AppSchemaCandidateValidationPersistenceError")<{
    readonly operation: "readHead" | "writeHead" | "scanDirectory" | "readDatabaseClock";
    readonly cause: unknown;
  }> {}

interface CandidateSnapshot {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly manifest: SchemaManifestAppSchemaV1;
  readonly manifestSha256Hex: ReturnType<
    typeof appSchemaCandidateManifestSha256HexV1FromBytes
  >;
}

interface ScanIdentityBase {
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

type ScanIdentity =
  | Readonly<ScanIdentityBase & {
      readonly kind: "postFrontier";
      readonly rootCommitSeq: CommitSeq;
    }>
  | Readonly<ScanIdentityBase & {
      readonly kind: "visible";
      readonly rootCommitSeq: CommitSeq;
      readonly commitSeq: CommitSeq;
      readonly isTombstone: boolean;
    }>;

type CanonicalAppSchemaCandidateValidationFailureEvidenceV1 = Readonly<{
  readonly frame: AppSchemaCandidateValidationFailureEvidenceFrameV1;
  readonly canonicalText: CanonicalAppSchemaCandidateValidationFrameV1["canonicalText"];
  readonly canonicalBytes: CanonicalAppSchemaCandidateValidationFrameV1["canonicalBytes"];
  readonly sha256Hex: CanonicalAppSchemaCandidateValidationFrameV1["sha256Hex"];
}>;

export type InstallAppSchemaCandidateValidationError =
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError;

export type LoadAppSchemaCandidateValidationError =
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError;

export const claimCurrentAppSchemaCandidateValidationHeadEffect = Effect.fn(
  "AppSchemaCandidateValidation.claimCurrentHead",
)(function* (
  port: AppSchemaCandidateValidationPort,
  prepared: PreparedAppSchemaCandidateValidationInstall,
): Effect.fn.Return<
  ClaimedAppSchemaCandidateValidationHead,
  LoadAppSchemaCandidateValidationError
> {
  const state = preparedCandidateInstallStates.get(prepared);
  if (state === undefined || state.port !== port) {
    return yield* Effect.fail(operationError("load", "corruption"));
  }
  const head = yield* runLocatedTransaction(
    state.located.target,
    "load",
    (tx) =>
    Effect.gen(function* () {
      const clock = yield* lockScopeClockForShareInTransactionEffect(
        tx,
        state.located.authority.scopeId,
      );
      yield* Effect.fromResult(requireExactAuthorityResult(
        state.located.authority,
        clock,
        "load",
      ));
      const currentHead = yield*
        readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
          tx,
          state.located.authority.scopeId,
          "load",
        );
      if (currentHead !== null) {
        if (currentHead.deploymentId !== state.located.authority.deploymentId) {
          return yield* Effect.fail(operationError("load", "corruption"));
        }
        yield* Effect.fromResult(requireHeadAuthorityResult(
          currentHead,
          clock,
          "load",
        ));
      }
      return currentHead;
    }),
  );
  const claim = Object.freeze({
    [expectedCandidateHeadClaimBrand]: true as const,
  });
  expectedCandidateHeadClaimStates.set(claim, Object.freeze({
    port,
    prepared,
    head,
  }));
  return Object.freeze({
    claim,
    head,
    target: state.located.target,
    authority: state.located.authority,
  });
});

export type AdvanceAppSchemaCandidateValidationError =
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | ReadSchemaVersionArtifactError
  | ReadAppRowError
  | TrustedScopeAuthorityError;

export type SettleAppSchemaCandidateValidationError =
  | AppSchemaCandidateValidationOperationV1Error
  | AppSchemaCandidateValidationPersistenceError
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError;

export const prepareAppSchemaCandidateValidationInstallEffect = Effect.fn(
  "AppSchemaCandidateValidation.prepareInstall",
)(function* (
  port: AppSchemaCandidateValidationPort,
  input: unknown,
): Effect.fn.Return<
  PreparedAppSchemaCandidateValidationInstall,
  | AppSchemaCandidateValidationOperationV1Error
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
> {
  const { controlDb, authority } = yield* Effect.fromResult(
    requirePortStateResult(port, "install"),
  );
  const decoded = yield* Effect.fromResult(decodeInputResult(input, "install"));
  const snapshot = yield* loadCandidateSnapshot(controlDb, decoded, "install");
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...authority, ...makeInstallationProtectedScopeAuthorityControlReader(controlDb) },
  );
  const prepared = Object.freeze({
    [preparedCandidateInstallBrand]: true as const,
  });
  preparedCandidateInstallStates.set(prepared, Object.freeze({
    port,
    snapshot,
    located,
  }));
  return prepared;
});

/**
 * Installs one previously authenticated candidate inside a transaction owned
 * by an exact higher-level composition. The expected head prevents a stale
 * preflight from superseding a different candidate that won the race.
 */
export const installPreparedAppSchemaCandidateValidationInTransactionEffect =
  Effect.fn("AppSchemaCandidateValidation.installPreparedInTransaction")(
    function* (
      tx: AppRowTransaction,
      port: AppSchemaCandidateValidationPort,
      prepared: PreparedAppSchemaCandidateValidationInstall,
      authority: TrustedScopeAuthority,
      expectedHeadClaim:
        | ExpectedAppSchemaCandidateValidationHeadClaim
        | undefined,
      options: AppSchemaCandidateValidationOptions = {},
    ): Effect.fn.Return<
      InstallAppSchemaCandidateValidationResult,
      InstallAppSchemaCandidateValidationError
    > {
      const state = preparedCandidateInstallStates.get(prepared);
      if (state === undefined || state.port !== port) {
        return yield* Effect.fail(operationError("install", "corruption"));
      }
      const claimState = expectedHeadClaim === undefined
        ? undefined
        : expectedCandidateHeadClaimStates.get(expectedHeadClaim);
      if (
        expectedHeadClaim !== undefined &&
        (claimState === undefined ||
          claimState.port !== port ||
          claimState.prepared !== prepared)
      ) {
        return yield* Effect.fail(operationError("install", "corruption"));
      }
      if (!trustedAuthoritiesEqual(state.located.authority, authority)) {
        return yield* Effect.fail(operationError("install", "superseded"));
      }
      return yield* installInTransaction(
        tx,
        authority,
        state.snapshot,
        options,
        claimState?.head,
      );
    },
  );

export const installAppSchemaCandidateValidationEffect = Effect.fn(
  "AppSchemaCandidateValidation.install",
)(function* (
  port: AppSchemaCandidateValidationPort,
  input: unknown,
  options: AppSchemaCandidateValidationOptions = {},
): Effect.fn.Return<
  InstallAppSchemaCandidateValidationResult,
  InstallAppSchemaCandidateValidationError
> {
  const prepared = yield* prepareAppSchemaCandidateValidationInstallEffect(
    port,
    input,
  );
  const preparedState = preparedCandidateInstallStates.get(prepared);
  if (preparedState === undefined) {
    return yield* Effect.fail(operationError("install", "corruption"));
  }
  return yield* runLocatedTransaction(
    preparedState.located.target,
    "install",
    (tx) => installPreparedAppSchemaCandidateValidationInTransactionEffect(
      tx,
      port,
      prepared,
      preparedState.located.authority,
      undefined,
      options,
    ),
  );
});

export const loadAppSchemaCandidateValidationEffect = Effect.fn(
  "AppSchemaCandidateValidation.load",
)(function* (
  port: AppSchemaCandidateValidationPort,
  input: unknown,
): Effect.fn.Return<
  LoadAppSchemaCandidateValidationResult,
  LoadAppSchemaCandidateValidationError
> {
  const { authority, controlDb } = yield* Effect.fromResult(
    requirePortStateResult(port, "load"),
  );
  const decoded = yield* Effect.fromResult(decodeInputResult(input, "load"));
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...authority, ...makeInstallationProtectedScopeAuthorityControlReader(controlDb) },
  );
  return yield* runLocatedTransaction(located.target, "load", (tx) =>
    loadInTransaction(tx, located.authority, decoded));
});

const prepareWriteGuardFromDecodedHeadEffect = Effect.fn("AppSchemaCandidateValidation.prepareWriteGuardFromHead")(function* (
  guard: AppSchemaCandidateWriteGuardPort,
  state: CandidateWriteGuardState,
  input: Readonly<{ readonly deploymentId: string; readonly scopeId: ScopeId }>,
  authority: TrustedScopeAuthority,
  head: StoredAppSchemaCandidateValidationHead | null,
): Effect.fn.Return<PreparedAppSchemaCandidateWriteGuard, AppSchemaCandidateWriteGuardError> {
  let validator: CandidateDocumentValidator | null = null;
  let manifest: SchemaManifestAppSchemaV1 | undefined;
  if (
    head !== null &&
    head.frame.kind !== "app_schema_candidate_validation_failure_evidence"
  ) {
    const snapshot = yield* loadCandidateSnapshot(
      state.candidateValidation.controlDb,
      Object.freeze({
        deploymentId: input.deploymentId,
        scopeId: input.scopeId,
        schemaVersionId: head.schemaVersionId,
      }),
      "advance",
    ).pipe(Effect.mapError(mapCandidateWriteGuardError));
    if (!headMatchesSnapshot(head, authority, snapshot)) {
      return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
        reason: "corruption",
      }));
    }
    validator = prepareCandidateDocumentValidator(snapshot.manifest);
    manifest = snapshot.manifest;
  }
  return issuePreparedCandidateWriteGuard(guard, input, head, validator, undefined, manifest);
});

function issuePreparedCandidateWriteGuard(guard: AppSchemaCandidateWriteGuardPort,
  input: Readonly<{ deploymentId: string; scopeId: ScopeId }>, head: StoredAppSchemaCandidateValidationHead | null,
  validator: CandidateDocumentValidator | null, finite?: CandidateWriteGuardState["finite"], manifest?: SchemaManifestAppSchemaV1) {
  const prepared = Object.freeze({
    [preparedAppSchemaCandidateWriteGuardBrand]: true as const,
  });
  preparedCandidateWriteGuardStates.set(prepared, Object.freeze({
    guard,
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    head,
    validator,
    ...(finite === undefined ? {} : { finite }),
    ...(manifest === undefined ? {} : { manifest }),
  }));
  return prepared;
}

export const prepareAppSchemaCandidateWriteGuardEffect = Effect.fn(
  "AppSchemaCandidateValidation.prepareWriteGuard",
)(function* (
  guard: AppSchemaCandidateWriteGuardPort,
  input: Readonly<{ readonly deploymentId: string; readonly scopeId: ScopeId }>,
): Effect.fn.Return<
  PreparedAppSchemaCandidateWriteGuard,
  AppSchemaCandidateWriteGuardError
> {
  const state = candidateWriteGuardStates.get(guard);
  if (state === undefined) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "notIssued",
    }));
  }
  if (!isNonBlankString(input.deploymentId)) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "corruption",
    }));
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: input.deploymentId, scopeId: input.scopeId },
    { ...state.candidateValidation.authority, ...makeInstallationProtectedScopeAuthorityControlReader(state.candidateValidation.controlDb) },
  ).pipe(Effect.mapError(mapCandidateWriteGuardError));
  if (located.authority.scopeId !== input.scopeId) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "compositionMismatch",
    }));
  }
  const head = yield* runLocatedTransaction(
    located.target,
    "load",
    (tx) => readHeadEffect(tx, located.authority.scopeId, "planning"),
  ).pipe(Effect.mapError(mapCandidateWriteGuardError));
  return yield* prepareWriteGuardFromDecodedHeadEffect(guard, state, input, located.authority, head);
});

export const applyAppSchemaCandidateWriteGuardInTransactionEffect = Effect.fn(
  "AppSchemaCandidateValidation.applyWriteGuardInTransaction",
)(function* (
  tx: AppRowTransaction,
  guard: AppSchemaCandidateWriteGuardPort,
  prepared: PreparedAppSchemaCandidateWriteGuard,
  authority: TrustedScopeAuthority,
  lockedClock: ScopeClockRecord,
  commitSeq: CommitSeq,
  liveRows: ReadonlyArray<AppSchemaCandidateWriteGuardLiveRow>,
  lockedHead?: AppSchemaCandidateWriteGuardPlanningHead,
): Effect.fn.Return<
  AppSchemaCandidateWriteGuardResult,
  AppSchemaCandidateWriteGuardError
> {
  const guardState = candidateWriteGuardStates.get(guard);
  const preparedState = preparedCandidateWriteGuardStates.get(prepared);
  if (guardState === undefined || preparedState === undefined) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "notIssued",
    }));
  }
  if (
    preparedState.guard !== guard ||
    preparedState.deploymentId !== authority.deploymentId ||
    preparedState.scopeId !== authority.scopeId ||
    lockedClock.scopeId !== authority.scopeId ||
    lockedClock.storageGeneration !== authority.storageGeneration ||
    lockedClock.storageGenerationFence !== authority.storageGenerationFence ||
    lockedClock.epoch !== authority.epoch ||
    commitSeq <= lockedClock.lastCommitSeq
  ) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "compositionMismatch",
    }));
  }
  if (liveRows.length > MAX_POINT_COMMIT_MATERIAL_ROWS_V1) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "corruption",
    }));
  }
  if (preparedState.finite !== undefined) {
    const finite = preparedState.finite;
    yield* Effect.fromResult(finite.lifetime.checkOpen()).pipe(Effect.mapError(cause =>
      new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch", cause })));
    if (finite.protection !== undefined) {
      yield* authenticateProtectedTargetMetadataSnapshot(finite.protection, tx).pipe(Effect.mapError(cause =>
        new AppSchemaCandidateWriteGuardError({ reason: "concurrentStateChange", cause })));
      yield* registerProtectedMetadataFinalGuard(tx, finite.protection.token, finite.protection.database, finite.protection.epoch)
        .pipe(Effect.mapError(cause => new AppSchemaCandidateWriteGuardError({ reason: "concurrentStateChange", cause })));
    }
  }
  const captured = lockedHead === undefined ? undefined : candidatePlanningHeads.get(lockedHead);
  if (lockedHead !== undefined && (captured === undefined || captured.tx !== tx ||
    captured.issuer !== guardState.pointCommitAuthority || !trustedAuthoritiesEqual(captured.authority, authority)))
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({ reason: "compositionMismatch" }));
  // This locked observation belongs to one lowering invocation. A failure
  // evidence write cannot leave a reusable stale head in the same transaction.
  if (lockedHead !== undefined) candidatePlanningHeads.delete(lockedHead);
  const current = captured === undefined ? yield* readHeadForUpdateEffect(
    tx,
    authority.scopeId,
    "advance",
  ).pipe(Effect.mapError(mapCandidateWriteGuardError)) : captured.decoded !== undefined ? captured.decoded : captured.row === null ? null :
    yield* decodeHeadRowEffect(captured.row, "advance").pipe(Effect.mapError(mapCandidateWriteGuardError));
  if (current !== null) {
    yield* Effect.fromResult(requireHeadAuthorityResult(
      current,
      lockedClock,
      "settle",
    )).pipe(Effect.mapError(mapCandidateWriteGuardError));
  }
  const preparedHead = preparedState.head;
  if (preparedHead === null) {
    return current === null
      ? UNCHANGED_CANDIDATE_WRITE_GUARD_RESULT
      : yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
          reason: "concurrentStateChange",
        }));
  }
  if (current === null || !sameCandidateIdentity(preparedHead, current)) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "concurrentStateChange",
    }));
  }
  if (
    preparedHead.frame.kind ===
      "app_schema_candidate_validation_failure_evidence"
  ) {
    return current.frame.kind ===
          "app_schema_candidate_validation_failure_evidence" &&
        current.frameSha256Hex === preparedHead.frameSha256Hex
      ? UNCHANGED_CANDIDATE_WRITE_GUARD_RESULT
      : yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
          reason: "concurrentStateChange",
        }));
  }
  if (current.frame.kind === "app_schema_candidate_validation_failure_evidence") {
    return UNCHANGED_CANDIDATE_WRITE_GUARD_RESULT;
  }
  if (
    preparedHead.frame.kind === "app_schema_candidate_validation_receipt" &&
    (
      current.frame.kind !== "app_schema_candidate_validation_receipt" ||
      current.frameSha256Hex !== preparedHead.frameSha256Hex
    )
  ) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "concurrentStateChange",
    }));
  }
  const validator = preparedState.validator;
  if (validator === null || commitSeq <= current.frame.frontierCommitSeq) {
    return yield* Effect.fail(new AppSchemaCandidateWriteGuardError({
      reason: "corruption",
    }));
  }
  let observedFailureCount = 0n;
  const failures: AppSchemaCandidateValidationFailureEntryV1[] = [];
  for (const row of liveRows) {
    const developerFields = yield* Effect.fromResult(
      projectDeveloperFieldsFromCanonicalDocumentResult(row),
    );
    const validation = validator.validate({
      tableId: row.tableId,
      developerFields,
    });
    if (validation.status === "valid") continue;
    observedFailureCount += 1n;
    if (
      failures.length < MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1
    ) failures.push(Object.freeze({
      tableId: row.tableId,
      rowId: row.rowId,
      observedCommitSeq: commitSeq,
      source: "pointCommit" as const,
      reason: validation.reason,
      validatorPath: validation.validatorPath,
    }));
  }
  if (failures.length === 0) return UNCHANGED_CANDIDATE_WRITE_GUARD_RESULT;
  const predecessorProgressSha = current.frame.kind ===
      "app_schema_candidate_validation_receipt"
    ? current.frame.finalProgressSha256Hex
    : current.frameSha256Hex;
  const failureFrame = yield* canonicalizeBoundedFailureEvidenceFrameEffect(
    current.frame,
    predecessorProgressSha,
    observedFailureCount,
    failures,
  ).pipe(Effect.mapError(mapCandidateWriteGuardError));
  yield* replaceFrameEffect(tx, current, failureFrame, "advance").pipe(
    Effect.mapError(mapCandidateWriteGuardError),
  );
  return FAILED_CANDIDATE_WRITE_GUARD_RESULT;
});

export const advanceAppSchemaCandidateValidationEffect = Effect.fn(
  "AppSchemaCandidateValidation.advance",
)(function* (
  port: AppSchemaCandidateValidationPort,
  input: unknown,
  options: AppSchemaCandidateValidationOptions = {},
): Effect.fn.Return<
  AdvanceAppSchemaCandidateValidationResult,
  AdvanceAppSchemaCandidateValidationError
> {
  const { controlDb, authority } = yield* Effect.fromResult(
    requirePortStateResult(port, "advance"),
  );
  const decoded = yield* Effect.fromResult(decodeInputResult(input, "advance"));
  const snapshot = yield* loadCandidateSnapshot(controlDb, decoded, "advance");
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...authority, ...makeInstallationProtectedScopeAuthorityControlReader(controlDb) },
  );
  return yield* runLocatedTransaction(located.target, "advance", (tx) =>
    advanceInTransaction(
      tx,
      located.authority,
      snapshot,
      options,
    ));
});

export const settleAppSchemaCandidateValidationEffect = Effect.fn(
  "AppSchemaCandidateValidation.settle",
)(function* (
  port: AppSchemaCandidateValidationPort,
  input: unknown,
  options: AppSchemaCandidateValidationOptions = {},
): Effect.fn.Return<
  StoredAppSchemaCandidateValidationHead,
  SettleAppSchemaCandidateValidationError
> {
  const { controlDb, authority } = yield* Effect.fromResult(
    requirePortStateResult(port, "settle"),
  );
  const decoded = yield* Effect.fromResult(decodeInputResult(input, "settle"));
  const snapshot = yield* loadCandidateSnapshot(controlDb, decoded, "settle");
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: decoded.deploymentId, scopeId: decoded.scopeId },
    { ...authority, ...makeInstallationProtectedScopeAuthorityControlReader(controlDb) },
  );
  return yield* runLocatedTransaction(located.target, "settle", (tx) =>
    settleInTransaction(
      tx,
      located.authority,
      snapshot,
      options,
    ));
});

function decodeInputResult(
  input: unknown,
  operation: "install" | "load" | "advance" | "settle",
): Result.Result<
  AppSchemaCandidateValidationInput,
  AppSchemaCandidateValidationOperationV1Error
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(input, INPUT_KEYS)) {
      return yield* Result.fail(operationError(operation, "corruption"));
    }
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(operationError(operation, "corruption"));
    }
    const schemaVersionId = yield* decodeSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError(() => operationError(operation, "corruption")));
    const scopeId = yield* decodeScopeIdResult(input.scopeId).pipe(
      Result.mapError(() => operationError(operation, "corruption")),
    );
    return Object.freeze({
      deploymentId: input.deploymentId,
      scopeId,
      schemaVersionId,
    });
  });
}

function requirePortStateResult(
  port: AppSchemaCandidateValidationPort,
  operation: "install" | "load" | "advance" | "settle",
): Result.Result<
  Readonly<AppSchemaCandidateValidationPortDependencies>,
  AppSchemaCandidateValidationOperationV1Error
> {
  const state = typeof port === "object" && port !== null
    ? portStates.get(port)
    : undefined;
  return state === undefined
    ? Result.fail(operationError(operation, "corruption"))
    : Result.succeed(state);
}

const loadCandidateSnapshot = Effect.fn(
  "AppSchemaCandidateValidation.loadCandidateSnapshot",
)(function* (
  controlDb: FlarexMetadataDatabase,
  input: AppSchemaCandidateValidationInput,
  operation: "install" | "advance" | "settle",
): Effect.fn.Return<CandidateSnapshot, ReadSchemaVersionArtifactError |
  AppSchemaCandidateValidationOperationV1Error> {
  const artifact = yield* runEffectTransaction<Effect.Success<ReturnType<typeof readSchemaVersionArtifactByIdEffect>>,
    ReadSchemaVersionArtifactError, SchemaVersionArtifactPersistenceError, AppRowTransaction>(
    callback => controlDb.transaction(callback),
    "Candidate validation snapshot acquisition failed",
    tx => readSchemaVersionArtifactByIdEffect(tx, input.deploymentId, input.schemaVersionId),
    cause => new SchemaVersionArtifactPersistenceError({ operation: "readById", cause }),
  );
  return yield* decodeCandidateSnapshotArtifact(artifact, input, operation);
});

const loadCandidateSnapshotInTransaction = Effect.fn("AppSchemaCandidateValidation.loadCandidateSnapshotInTransaction")(function* (
  tx: AppRowTransaction, input: AppSchemaCandidateValidationInput, operation: "install" | "advance" | "settle",
) {
  const artifact = yield* readSchemaVersionArtifactByIdEffect(tx, input.deploymentId, input.schemaVersionId);
  return yield* decodeCandidateSnapshotArtifact(artifact, input, operation);
});

const decodeCandidateSnapshotArtifact = Effect.fn("AppSchemaCandidateValidation.decodeCandidateSnapshotArtifact")(function* (
  artifact: Effect.Success<ReturnType<typeof readSchemaVersionArtifactByIdEffect>>, input: AppSchemaCandidateValidationInput,
  operation: "install" | "advance" | "settle",
) {
  if (artifact === null) {
    return yield* Effect.fail(operationError(operation, "corruption"));
  }
  const manifest = yield* Effect.fromResult(
    decodeSchemaManifestAppSchemaV1Result(artifact.manifestJson).pipe(
      Result.mapError(() => operationError(operation, "corruption")),
    ),
  );
  return Object.freeze({
    ...input,
    manifest: snapshotSchemaManifestValue(manifest),
    manifestSha256Hex:
      appSchemaCandidateManifestSha256HexV1FromBytes(artifact.manifestSha256),
  });
});

const installInTransaction = Effect.fn(
  "AppSchemaCandidateValidation.installInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: CandidateSnapshot,
  options: AppSchemaCandidateValidationOptions,
  expectedHead: ExpectedAppSchemaCandidateValidationHead | null | undefined =
    undefined,
): Effect.fn.Return<
  InstallAppSchemaCandidateValidationResult,
  InstallAppSchemaCandidateValidationError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(
    authority,
    clock,
    "install",
  ));
  const existingRow = yield* queryEffect(
    "readHead",
    tx.select().from(fxSystemAppSchemaCandidateValidations).where(
      eq(fxSystemAppSchemaCandidateValidations.scopeId, authority.scopeId),
    ).limit(1).for("update"),
  );
  const existing = existingRow[0] === undefined
    ? null
    : yield* decodeHeadRowEffect(existingRow[0], "install");
  if (
    expectedHead !== undefined &&
    (expectedHead === null
      ? existing !== null
      : existing === null ||
        existing.deploymentId !== expectedHead.deploymentId ||
        existing.schemaVersionId !== expectedHead.schemaVersionId ||
        existing.frameSha256Hex !== expectedHead.frameSha256Hex)
  ) {
    return yield* Effect.fail(operationError("install", "superseded"));
  }
  if (
    existing !== null &&
    headMatchesSnapshot(existing, authority, snapshot) &&
    (
      existing.frame.kind !==
        "app_schema_candidate_validation_failure_evidence" ||
      existing.frame.frontierCommitSeq === clock.lastCommitSeq
    )
  ) {
    return Object.freeze({
      disposition: "replayed" as const,
      head: existing,
    });
  }

  const attemptFence = yield* Effect.fromResult(nextAttemptFenceResult(
    existing?.frame.attemptFence ?? null,
    "install",
  ));
  const canonical = yield* canonicalizeAppSchemaCandidateValidationFrameV1Effect({
    kind: "app_schema_candidate_validation_progress",
    codecVersion: APP_SCHEMA_CANDIDATE_VALIDATION_CODEC_VERSION_V1,
    budgetIdentity: "flarex.app-schema/candidate-validation-budget/v1",
    scopeId: authority.scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: authority.storageGenerationFence,
    scopeEpoch: authority.epoch,
    schemaVersionId: snapshot.schemaVersionId,
    schemaManifestSha256Hex: snapshot.manifestSha256Hex,
    frontierCommitSeq: clock.lastCommitSeq,
    attemptFence,
    progressSequence: 0n,
    previousProgressSha256Hex: null,
    cursor: null,
    validatedRowCount: 0n,
    validatedPageCount: 0n,
    validatedSemanticBytes: 0n,
  }).pipe(Effect.mapError(() => operationError("install", "corruption")));
  const stored = yield* storedFrameValuesEffect(canonical, "install");
  const values = {
    deploymentId: snapshot.deploymentId,
    schemaVersionId: snapshot.schemaVersionId,
    schemaManifestSha256: yield* decodeHexEffect(
      snapshot.manifestSha256Hex,
      "install",
    ),
    storageGeneration: FLAREXDB_V1_STORAGE_GENERATION,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
    frontierCommitSeq: clock.lastCommitSeq,
    attemptFence,
    ...stored,
    createdAt: sql`clock_timestamp()`,
    updatedAt: sql`clock_timestamp()`,
  };
  if (existing === null) {
    yield* queryEffect(
      "writeHead",
      tx.insert(fxSystemAppSchemaCandidateValidations).values({
        scopeId: authority.scopeId,
        ...values,
      }).returning({ scopeId: fxSystemAppSchemaCandidateValidations.scopeId }),
    );
  } else {
    const updated = yield* queryEffect(
      "writeHead",
      tx.update(fxSystemAppSchemaCandidateValidations).set(values).where(
        and(
          eq(fxSystemAppSchemaCandidateValidations.scopeId, authority.scopeId),
          eq(
            fxSystemAppSchemaCandidateValidations.attemptFence,
            existing.frame.attemptFence,
          ),
        ),
      ).returning({ scopeId: fxSystemAppSchemaCandidateValidations.scopeId }),
    );
    if (updated.length !== 1) {
      return yield* Effect.fail(operationError("install", "superseded"));
    }
  }
  yield* runFault(options, "afterInstallWrite", "install");
  const head = yield* readHeadForUpdateEffect(tx, authority.scopeId, "install");
  if (head === null) {
    return yield* Effect.fail(operationError("install", "corruption"));
  }
  return Object.freeze({
    disposition: existing === null
      ? "installed" as const
      : headMatchesSnapshot(existing, authority, snapshot)
      ? "restarted" as const
      : "superseded" as const,
    head,
  });
});

const loadInTransaction = Effect.fn(
  "AppSchemaCandidateValidation.loadInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  input: AppSchemaCandidateValidationInput,
): Effect.fn.Return<
  LoadAppSchemaCandidateValidationResult,
  LoadAppSchemaCandidateValidationError
> {
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(
    authority,
    clock,
    "load",
  ));
  const head = yield*
    readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
      tx,
      authority.scopeId,
      "load",
    );
  if (head === null) return Object.freeze({ status: "absent" as const });
  if (
    head.deploymentId !== input.deploymentId ||
    head.schemaVersionId !== input.schemaVersionId
  ) return yield* Effect.fail(operationError("load", "superseded"));
  yield* Effect.fromResult(requireHeadAuthorityResult(head, clock, "load"));
  return Object.freeze({ status: "present" as const, head });
});

const advanceInTransaction = Effect.fn(
  "AppSchemaCandidateValidation.advanceInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: CandidateSnapshot,
  options: AppSchemaCandidateValidationOptions,
): Effect.fn.Return<
  AdvanceAppSchemaCandidateValidationResult,
  AdvanceAppSchemaCandidateValidationError
> {
  const head = yield* readHeadForUpdateEffect(tx, authority.scopeId, "advance");
  if (head === null) {
    return yield* Effect.fail(operationError("advance", "superseded"));
  }
  yield* Effect.fromResult(requireHeadSnapshotResult(
    head,
    authority,
    snapshot,
    "advance",
  ));
  if (head.frame.kind !== "app_schema_candidate_validation_progress") {
    return head.frame.kind === "app_schema_candidate_validation_failure_evidence"
      ? Object.freeze({
          disposition: "failed" as const,
          processedIdentities: 0,
          validatedRows: 0,
          head,
        })
      : Object.freeze({
          disposition: "readyToSettle" as const,
          processedIdentities: 0,
          validatedRows: 0,
          head,
        });
  }
  const startedAt = yield* monotonicNow(options);
  const identities = yield* loadScanIdentities(
    tx,
    authority.scopeId,
    head.frame,
  );
  const page = identities.slice(
    0,
    MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1,
  );
  const scanned = page.length === 0
    ? emptyExhaustedPage()
    : yield* scanPage(
        tx,
        authority.scopeId,
        prepareCandidateDocumentValidator(snapshot.manifest),
        head.frame,
        page,
        startedAt,
        options,
      );
  if (scanned.failures.length > 0) {
    const failureFrame = yield* canonicalizeBoundedFailureEvidenceFrameEffect(
      head.frame,
      head.frameSha256Hex,
      BigInt(scanned.observedFailureCount),
      scanned.failures,
    );
    yield* replaceFrameEffect(
      tx,
      head,
      failureFrame,
      "advance",
    );
    yield* runFault(options, "afterFailureWrite", "advance");
    const failed = yield* readHeadForUpdateEffect(tx, authority.scopeId, "advance");
    if (failed === null) {
      return yield* Effect.fail(operationError("advance", "corruption"));
    }
    return Object.freeze({
      disposition: "failed" as const,
      processedIdentities: scanned.processedIdentities,
      validatedRows: scanned.validatedRows,
      head: failed,
    });
  }
  const directoryExhausted = identities.length <=
      MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1 &&
    scanned.processedIdentities === page.length;
  if (scanned.processedIdentities === 0 && !directoryExhausted) {
    return Object.freeze({
      disposition: "advanced" as const,
      processedIdentities: 0,
      validatedRows: 0,
      head,
    });
  }
  const progress = yield* canonicalizeAppSchemaCandidateValidationFrameV1Effect({
    kind: "app_schema_candidate_validation_progress",
    ...candidateIdentityFromProgress(head.frame),
    progressSequence: head.frame.progressSequence + 1n,
    previousProgressSha256Hex:
      AppSchemaCandidateValidationFrameSha256HexV1Schema.make(
        head.frameSha256Hex,
      ),
    cursor: directoryExhausted ? EXHAUSTED_SCAN_CURSOR : scanned.cursor,
    validatedRowCount:
      head.frame.validatedRowCount + BigInt(scanned.validatedRows),
    validatedPageCount: head.frame.validatedPageCount + 1n,
    validatedSemanticBytes:
      head.frame.validatedSemanticBytes + BigInt(scanned.semanticBytes),
  }).pipe(Effect.mapError(() => operationError("advance", "corruption")));
  yield* replaceFrameEffect(tx, head, progress, "advance");
  yield* runFault(options, "afterProgressWrite", "advance");
  const advanced = yield* readHeadForUpdateEffect(tx, authority.scopeId, "advance");
  if (advanced === null) {
    return yield* Effect.fail(operationError("advance", "corruption"));
  }
  return Object.freeze({
    disposition: directoryExhausted
      ? "readyToSettle" as const
      : "advanced" as const,
    processedIdentities: scanned.processedIdentities,
    validatedRows: scanned.validatedRows,
    head: advanced,
  });
});

const settleInTransaction = Effect.fn(
  "AppSchemaCandidateValidation.settleInTransaction",
)(function* (
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
  snapshot: CandidateSnapshot,
  options: AppSchemaCandidateValidationOptions,
): Effect.fn.Return<
  StoredAppSchemaCandidateValidationHead,
  SettleAppSchemaCandidateValidationError
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    authority.scopeId,
  );
  yield* Effect.fromResult(requireExactAuthorityResult(
    authority,
    clock,
    "settle",
  ));
  const head = yield* readHeadForUpdateEffect(tx, authority.scopeId, "settle");
  if (head === null) {
    return yield* Effect.fail(operationError("settle", "superseded"));
  }
  yield* Effect.fromResult(requireHeadSnapshotResult(
    head,
    authority,
    snapshot,
    "settle",
  ));
  yield* Effect.fromResult(requireHeadAuthorityResult(head, clock, "settle"));
  if (head.frame.kind === "app_schema_candidate_validation_receipt") {
    return head;
  }
  if (head.frame.kind !== "app_schema_candidate_validation_progress") {
    return yield* Effect.fail(operationError("settle", "superseded"));
  }
  if (!isExhaustedScanCursor(head.frame.cursor)) {
    return yield* Effect.fail(operationError("settle", "superseded"));
  }
  const settledAt = yield* readDatabaseClockEffect(tx);
  const receipt = yield* canonicalizeAppSchemaCandidateValidationFrameV1Effect({
    kind: "app_schema_candidate_validation_receipt",
    ...candidateIdentityFromProgress(head.frame),
    finalProgressSha256Hex:
      AppSchemaCandidateValidationFrameSha256HexV1Schema.make(
        head.frameSha256Hex,
      ),
    validatedRowCount: head.frame.validatedRowCount,
    validatedPageCount: head.frame.validatedPageCount,
    validatedSemanticBytes: head.frame.validatedSemanticBytes,
    settlementCommitSeq: clock.lastCommitSeq,
    scanCompleted: true,
    settledAt: settledAt.toISOString(),
  }).pipe(Effect.mapError(() => operationError("settle", "corruption")));
  yield* replaceFrameEffect(tx, head, receipt, "settle");
  yield* runFault(options, "afterReceiptWrite", "settle");
  const settled = yield* readHeadForUpdateEffect(
    tx,
    authority.scopeId,
    "settle",
  );
  if (settled === null) {
    return yield* Effect.fail(operationError("settle", "corruption"));
  }
  return settled;
});

interface ScannedPage {
  readonly processedIdentities: number;
  readonly validatedRows: number;
  readonly semanticBytes: number;
  readonly observedFailureCount: number;
  readonly failures: ReadonlyArray<AppSchemaCandidateValidationFailureEntryV1>;
  readonly cursor: Readonly<{
    readonly afterTableId: CatalogTableId;
    readonly afterRowId: AppRowIdHexV1;
  }>;
}

const scanPage = Effect.fn(
  "AppSchemaCandidateValidation.scanPage",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  validator: CandidateDocumentValidator,
  progress: AppSchemaCandidateValidationProgressFrameV1,
  identities: ReadonlyArray<ScanIdentity>,
  startedAt: bigint,
  options: AppSchemaCandidateValidationOptions,
): Effect.fn.Return<ScannedPage, ReadAppRowError |
  AppSchemaCandidateValidationOperationV1Error> {
  let processedIdentities = 0;
  let validatedRows = 0;
  let semanticBytes = 0;
  let observedFailureCount = 0;
  const failures: AppSchemaCandidateValidationFailureEntryV1[] = [];
  let cursor = progress.cursor;
  let index = 0;
  while (index < identities.length) {
    if (
      processedIdentities > 0 &&
      (yield* monotonicNow(options)) - startedAt >= SLICE_NANOSECONDS
    ) break;
    const identity = identities[index];
    if (identity === undefined) break;
    if (identity.kind === "postFrontier") {
      cursor = scanCursor(identity);
      processedIdentities += 1;
      index += 1;
      continue;
    }
    const visibleIdentity = Object.freeze({
      tableId: identity.tableId,
      rowId: identity.rowId,
      commitSeq: identity.commitSeq,
      isTombstone: identity.isTombstone,
    });
    if (visibleIdentity.isTombstone) {
      cursor = scanCursor(visibleIdentity);
      processedIdentities += 1;
      index += 1;
      continue;
    }
    if (visibleIdentity.isTombstone !== false) {
      return yield* Effect.fail(operationError("advance", "corruption"));
    }
    if (!validator.hasTable(visibleIdentity.tableId)) {
      observedFailureCount += 1;
      if (failures.length < MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1) {
        failures.push(Object.freeze({
          tableId: visibleIdentity.tableId,
          rowId: visibleIdentity.rowId,
          observedCommitSeq: visibleIdentity.commitSeq,
          source: "snapshotScan" as const,
          reason: "candidateTableRemoved" as const,
          validatorPath: null,
        }));
      }
      cursor = scanCursor(visibleIdentity);
      processedIdentities += 1;
      index += 1;
      continue;
    }
    const chunk: Array<Readonly<{
      readonly tableId: CatalogTableId;
      readonly rowId: AppRowIdHexV1;
      readonly commitSeq: CommitSeq;
      readonly isTombstone: false;
    }>> = [];
    while (
      index + chunk.length < identities.length &&
      chunk.length < MAX_LIVE_ROWS_PER_MATERIALIZATION_CHUNK
    ) {
      const next = identities[index + chunk.length];
      if (
        next === undefined ||
        next.kind !== "visible" ||
        next.tableId !== visibleIdentity.tableId ||
        next.isTombstone ||
        !validator.hasTable(next.tableId)
      ) break;
      chunk.push(Object.freeze({
        tableId: next.tableId,
        rowId: next.rowId,
        commitSeq: next.commitSeq,
        isTombstone: false as const,
      }));
    }
    const revisions = yield* readLiveAppRowsAtSnapshotInTransactionEffect(tx, {
      scopeId,
      tableId: visibleIdentity.tableId,
      rowIds: chunk.map(item => item.rowId),
      snapshotCommitSeq: progress.frontierCommitSeq,
    });
    for (let offset = 0; offset < revisions.length; offset += 1) {
      const revision = revisions[offset];
      const selected = chunk[offset];
      if (revision === undefined || selected === undefined) {
        return yield* Effect.fail(operationError("advance", "corruption"));
      }
      const nextSemanticBytes = semanticBytes + revision.document.semanticSizeBytes;
      if (
        processedIdentities > 0 &&
        nextSemanticBytes >
          MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_SEMANTIC_BYTES_V1
      ) return scanResult(
        processedIdentities,
        validatedRows,
        semanticBytes,
        observedFailureCount,
        failures,
        cursor,
      );
      semanticBytes = nextSemanticBytes;
      const developerFields = yield* Effect.fromResult(
        projectDeveloperFieldsResult(revision),
      );
      const validation = validator.validate({
        tableId: selected.tableId,
        developerFields,
      });
      if (validation.status === "invalid") {
        observedFailureCount += 1;
        if (
          failures.length <
            MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1
        ) failures.push(Object.freeze({
          tableId: selected.tableId,
          rowId: selected.rowId,
          observedCommitSeq: selected.commitSeq,
          source: "snapshotScan" as const,
          reason: validation.reason,
          validatorPath: validation.validatorPath,
        }));
      } else {
        validatedRows += 1;
      }
      cursor = scanCursor(selected);
      processedIdentities += 1;
      index += 1;
      if (
        (yield* monotonicNow(options)) - startedAt >= SLICE_NANOSECONDS
      ) break;
    }
  }
  return scanResult(
    processedIdentities,
    validatedRows,
    semanticBytes,
    observedFailureCount,
    failures,
    cursor,
  );
});

function scanResult(
  processedIdentities: number,
  validatedRows: number,
  semanticBytes: number,
  observedFailureCount: number,
  failures: ReadonlyArray<AppSchemaCandidateValidationFailureEntryV1>,
  cursor: AppSchemaCandidateValidationProgressFrameV1["cursor"],
): ScannedPage {
  if (cursor === null) {
    throw new Error("A non-empty scan result must own a cursor.");
  }
  return Object.freeze({
    processedIdentities,
    validatedRows,
    semanticBytes,
    observedFailureCount,
    failures: Object.freeze([...failures]),
    cursor,
  });
}

function emptyExhaustedPage(): ScannedPage {
  return Object.freeze({
    processedIdentities: 0,
    validatedRows: 0,
    semanticBytes: 0,
    observedFailureCount: 0,
    failures: Object.freeze([]),
    cursor: EXHAUSTED_SCAN_CURSOR,
  });
}

function isExhaustedScanCursor(
  cursor: AppSchemaCandidateValidationProgressFrameV1["cursor"],
): boolean {
  return cursor?.afterTableId === EXHAUSTED_SCAN_CURSOR.afterTableId &&
    cursor.afterRowId === EXHAUSTED_SCAN_CURSOR.afterRowId;
}

export const canonicalizeBoundedFailureEvidenceFrameEffect = Effect.fn(
  "AppSchemaCandidateValidation.canonicalizeBoundedFailureFrame",
)(function* (
  progress:
    | AppSchemaCandidateValidationProgressFrameV1
    | AppSchemaCandidateValidationReceiptFrameV1,
  progressSha256Hex: StoredAppSchemaCandidateValidationHead["frameSha256Hex"],
  observedFailureCount: bigint,
  failures: ReadonlyArray<AppSchemaCandidateValidationFailureEntryV1>,
): Effect.fn.Return<
  CanonicalAppSchemaCandidateValidationFailureEvidenceV1,
  AppSchemaCandidateValidationOperationV1Error
> {
  if (
    failures.length === 0 ||
    failures.length > MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1
  ) return yield* Effect.fail(operationError("advance", "corruption"));
  const orderedFailures = Object.freeze([...failures]);
  const canonicalizePrefix = (
    entryCount: number,
  ): Effect.Effect<
    CanonicalAppSchemaCandidateValidationFailureEvidenceV1,
    AppSchemaCandidateValidationOperationV1Error
  > => {
    if (entryCount === 0) {
      return Effect.fail(operationError("advance", "corruption"));
    }
    const entries = orderedFailures.slice(0, entryCount);
    return canonicalizeAppSchemaCandidateValidationFrameV1Effect({
        kind: "app_schema_candidate_validation_failure_evidence",
        ...candidateIdentityFromFrame(progress),
        progressSha256Hex:
          AppSchemaCandidateValidationFrameSha256HexV1Schema.make(
            progressSha256Hex,
          ),
        observedFailureCount,
        truncated: observedFailureCount > BigInt(entries.length),
        entries,
      }).pipe(
        Effect.flatMap(canonical => canonical.frame.kind ===
            "app_schema_candidate_validation_failure_evidence"
          ? Effect.succeed(Object.freeze({
              frame: canonical.frame,
              canonicalText: canonical.canonicalText,
              canonicalBytes: canonical.canonicalBytes,
              sha256Hex: canonical.sha256Hex,
            }))
          : Effect.fail(operationError("advance", "corruption"))),
        Effect.catchTag(
        "AppSchemaCandidateValidationCodecV1Error",
        (error) => error.issue.reason === "limitExceeded" &&
            error.issue.dimension === "failureEvidenceFrameBytes" &&
            error.issue.maximum ===
              MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_FRAME_BYTES_V1
          ? canonicalizePrefix(entryCount - 1)
          : Effect.fail(operationError("advance", "corruption")),
        ),
      );
  };
  return yield* canonicalizePrefix(orderedFailures.length);
});

function projectDeveloperFieldsResult(
  revision: LiveAppRowRevisionV1,
): Result.Result<
  CanonicalFlarexRuntimeObjectV1,
  AppSchemaCandidateValidationOperationV1Error
> {
  const value = revision.document.value;
  if (!isCanonicalFlarexRuntimeObjectV1(value)) {
    return Result.fail(operationError("advance", "corruption"));
  }
  if (
    typeof value._id !== "string" ||
    typeof value._creationTime !== "number"
  ) return Result.fail(operationError("advance", "corruption"));
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value: item,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Result.succeed(Object.freeze(fields));
}

function projectDeveloperFieldsFromCanonicalDocumentResult(
  row: AppSchemaCandidateWriteGuardLiveRow,
): Result.Result<
  CanonicalFlarexRuntimeObjectV1,
  AppSchemaCandidateWriteGuardError
> {
  const value = row.document.value;
  if (
    !isCanonicalFlarexRuntimeObjectV1(value) ||
    value._id !== appDocumentIdV1FromRowIdentity({
      tableId: row.tableId,
      rowId: row.rowId,
    }) ||
    !isAppCreationTime(value._creationTime)
  ) {
    return Result.fail(new AppSchemaCandidateWriteGuardError({
      reason: "corruption",
    }));
  }
  const fields: Record<string, CanonicalFlarexRuntimeValueV1> = {};
  for (const [field, item] of Object.entries(value)) {
    if (field === "_id" || field === "_creationTime") continue;
    Object.defineProperty(fields, field, {
      value: item,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Result.succeed(Object.freeze(fields));
}

function scanCursor(identity: ScanIdentityBase) {
  return Object.freeze({
    afterTableId: identity.tableId,
    afterRowId: identity.rowId,
  });
}

const loadScanIdentities = Effect.fn(
  "AppSchemaCandidateValidation.loadScanIdentities",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  progress: AppSchemaCandidateValidationProgressFrameV1,
  limit = MAX_APP_SCHEMA_CANDIDATE_VALIDATION_PAGE_ROWS_V1 + 1,
): Effect.fn.Return<
  ReadonlyArray<ScanIdentity>,
  AppSchemaCandidateValidationPersistenceError |
    AppSchemaCandidateValidationOperationV1Error
> {
  const projection = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(() => operationError("advance", "corruption")),
    ),
  );
  const afterCursor = progress.cursor === null
    ? sql`true`
    : sql`(
        (current_row.table_id, current_row.row_id)
          > (
            ${progress.cursor.afterTableId},
            ${appRowIdHexV1ToBytes(progress.cursor.afterRowId)}::bytea
          )
      )`;
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(sql`
      select
        root_revision.commit_seq::text as "rootCommitSeqText",
        current_row.table_id as "tableId",
        current_row.row_id as "rowId",
        visible.commit_seq::text as "commitSeqText",
        visible.is_tombstone as "isTombstone"
      from fx_app_row_current as current_row
      left join lateral (
        select revision.commit_seq
        from fx_app_row_rev as revision
        where revision.scope_uuid = current_row.scope_uuid
          and revision.table_id = current_row.table_id
          and revision.row_id = current_row.row_id
          and revision.prev_commit_seq is null
        limit 1
      ) as root_revision on true
      left join lateral (
        select revision.commit_seq, revision.is_tombstone
        from fx_app_row_rev as revision
        where revision.scope_uuid = current_row.scope_uuid
          and revision.table_id = current_row.table_id
          and revision.row_id = current_row.row_id
          and revision.commit_seq <= ${progress.frontierCommitSeq}
        order by revision.commit_seq desc
        limit 1
      ) as visible on true
      where current_row.scope_uuid = ${projection.scopeUuid}
        and ${afterCursor}
      order by current_row.table_id asc, current_row.row_id asc
      limit ${limit}
    `),
    catch: cause => new AppSchemaCandidateValidationPersistenceError({
      operation: "scanDirectory",
      cause,
    }),
  }));
  const rawRows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => {
      throw operationError("advance", "corruption");
    }),
    catch: cause => cause instanceof AppSchemaCandidateValidationOperationV1Error
      ? cause
      : new AppSchemaCandidateValidationPersistenceError({
          operation: "scanDirectory",
          cause,
        }),
  });
  const identities: ScanIdentity[] = [];
  let previous: ScanIdentity | null = null;
  for (const row of rawRows) {
    const identity = yield* Effect.fromResult(decodeScanIdentityResult(
      row,
      progress.frontierCommitSeq,
    ));
    if (previous !== null && compareScanIdentity(previous, identity) >= 0) {
      return yield* Effect.fail(operationError("advance", "corruption"));
    }
    identities.push(identity);
    previous = identity;
  }
  return Object.freeze(identities);
});

function decodeScanIdentityResult(
  value: unknown,
  frontierCommitSeq: CommitSeq,
): Result.Result<ScanIdentity, AppSchemaCandidateValidationOperationV1Error> {
  return Result.gen(function* () {
    if (
      typeof value !== "object" ||
      value === null ||
      !("rootCommitSeqText" in value) ||
      !("tableId" in value) ||
      !("rowId" in value) ||
      !("commitSeqText" in value) ||
      !("isTombstone" in value)
    ) return yield* Result.fail(operationError("advance", "corruption"));
    const tableId = yield* decodeTableIdResult(value.tableId).pipe(
      Result.mapError(() => operationError("advance", "corruption")),
    );
    const rowId = yield* appRowIdHexV1FromBytesResult(value.rowId).pipe(
      Result.mapError(() => operationError("advance", "corruption")),
    );
    if (
      typeof value.rootCommitSeqText !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(value.rootCommitSeqText)
    ) return yield* Result.fail(operationError("advance", "corruption"));
    const rootCommitSeqValue = BigInt(value.rootCommitSeqText);
    if (rootCommitSeqValue > MAX_POSTGRES_BIGINT) {
      return yield* Result.fail(operationError("advance", "corruption"));
    }
    const rootCommitSeq = yield* decodeCommitSeqResult(rootCommitSeqValue).pipe(
      Result.mapError(() => operationError("advance", "corruption")),
    );
    if (rootCommitSeq > frontierCommitSeq) {
      if (value.commitSeqText !== null || value.isTombstone !== null) {
        return yield* Result.fail(operationError("advance", "corruption"));
      }
      return Object.freeze({
        kind: "postFrontier" as const,
        rootCommitSeq,
        tableId,
        rowId,
      });
    }
    if (
      typeof value.commitSeqText !== "string" ||
      !/^[1-9][0-9]{0,18}$/.test(value.commitSeqText) ||
      typeof value.isTombstone !== "boolean"
    ) return yield* Result.fail(operationError("advance", "corruption"));
    const commitSeqValue = BigInt(value.commitSeqText);
    if (commitSeqValue > MAX_POSTGRES_BIGINT) {
      return yield* Result.fail(operationError("advance", "corruption"));
    }
    const commitSeq = yield* decodeCommitSeqResult(commitSeqValue).pipe(
      Result.mapError(() => operationError("advance", "corruption")),
    );
    if (commitSeq < rootCommitSeq || commitSeq > frontierCommitSeq) {
      return yield* Result.fail(operationError("advance", "corruption"));
    }
    return Object.freeze({
      kind: "visible" as const,
      rootCommitSeq,
      tableId,
      rowId,
      commitSeq,
      isTombstone: value.isTombstone,
    });
  });
}

function compareScanIdentity(left: ScanIdentity, right: ScanIdentity): number {
  if (left.tableId !== right.tableId) return left.tableId - right.tableId;
  return left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;
}

const readHeadForUpdateEffect = Effect.fn(
  "AppSchemaCandidateValidation.readHeadForUpdate",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  operation: "install" | "advance" | "settle",
) {
  const rows = yield* queryEffect(
    "readHead",
    tx.select().from(fxSystemAppSchemaCandidateValidations).where(
      eq(fxSystemAppSchemaCandidateValidations.scopeId, scopeId),
    ).limit(1).for("update"),
  );
  return rows[0] === undefined
    ? null
    : yield* decodeHeadRowEffect(rows[0], operation);
});

export const readAppSchemaCandidateValidationHeadForShareInTransactionEffect =
  Effect.fn(
    "AppSchemaCandidateValidation.readHeadForShare",
  )(function* (
    tx: AppRowTransaction,
    scopeId: ScopeId,
    operation: "load",
  ) {
    const rows = yield* queryEffect(
      "readHead",
      tx.select().from(fxSystemAppSchemaCandidateValidations).where(
        eq(fxSystemAppSchemaCandidateValidations.scopeId, scopeId),
      ).limit(1).for("share"),
    );
    return rows[0] === undefined
      ? null
      : yield* decodeHeadRowEffect(rows[0], operation);
  });

const readHeadEffect = Effect.fn(
  "AppSchemaCandidateValidation.readHead",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  lock: "share" | "update" | "planning",
) {
  const query = tx.select().from(fxSystemAppSchemaCandidateValidations).where(
    eq(fxSystemAppSchemaCandidateValidations.scopeId, scopeId),
  ).limit(1);
  const rows = yield* queryEffect(
    "readHead",
    lock === "planning" ? query : query.for(lock),
  );
  return rows[0] === undefined
    ? null
    : yield* decodeHeadRowEffect(rows[0], "load");
});

type HeadRow = typeof fxSystemAppSchemaCandidateValidations.$inferSelect;

const decodeHeadRowEffect = Effect.fn(
  "AppSchemaCandidateValidation.decodeHeadRow",
)(function* (
  row: HeadRow,
  operation: "install" | "load" | "advance" | "settle",
): Effect.fn.Return<
  StoredAppSchemaCandidateValidationHead,
  AppSchemaCandidateValidationOperationV1Error
> {
  if (
    !isNonBlankString(row.deploymentId) ||
    !isNonBlankString(row.scopeId) ||
    !isNonBlankString(row.schemaVersionId) ||
    !isUint8Array(row.schemaManifestSha256) ||
    row.schemaManifestSha256.byteLength !== 32 ||
    !isUint8Array(row.frameSha256) ||
    row.frameSha256.byteLength !== 32 ||
    !isUint8Array(row.frameBytes) ||
    row.frameBytes.byteLength < 1 ||
    typeof row.frameByteLength !== "bigint" ||
    BigInt(row.frameBytes.byteLength) !== row.frameByteLength
  ) return yield* Effect.fail(operationError(operation, "corruption"));
  const createdAt = copyFiniteDate(row.createdAt);
  const updatedAt = copyFiniteDate(row.updatedAt);
  if (
    createdAt === undefined ||
    updatedAt === undefined ||
    updatedAt.getTime() < createdAt.getTime()
  ) return yield* Effect.fail(operationError(operation, "corruption"));
  const frameSha256Hex = AppSchemaCandidateValidationFrameSha256HexV1Schema.make(
    encodeBytesToLowercaseHex(row.frameSha256),
  );
  const canonical = yield* decodeCanonicalAppSchemaCandidateValidationFrameV1Effect({
    canonicalBytes: row.frameBytes,
    expectedSha256Hex: frameSha256Hex,
  }).pipe(Effect.mapError(() => operationError(operation, "corruption")));
  if (
    canonical.frame.kind !== row.frameKind ||
    canonical.frame.codecVersion !== row.frameCodecVersion ||
    canonical.frame.scopeId !== row.scopeId ||
    canonical.frame.schemaVersionId !== row.schemaVersionId ||
    canonical.frame.schemaManifestSha256Hex !==
      encodeBytesToLowercaseHex(row.schemaManifestSha256) ||
    canonical.frame.storageGeneration !== row.storageGeneration ||
    canonical.frame.storageGenerationFence !== row.storageGenerationFence ||
    canonical.frame.scopeEpoch !== row.epoch ||
    canonical.frame.frontierCommitSeq !== row.frontierCommitSeq ||
    canonical.frame.attemptFence !== row.attemptFence
  ) return yield* Effect.fail(operationError(operation, "corruption"));
  return Object.freeze({
    deploymentId: row.deploymentId,
    scopeId: canonical.frame.scopeId,
    schemaVersionId: canonical.frame.schemaVersionId,
    frame: canonical.frame,
    frameSha256Hex,
    createdAt,
    updatedAt,
  });
});

const replaceFrameEffect = Effect.fn(
  "AppSchemaCandidateValidation.replaceFrame",
)(function* (
  tx: AppRowTransaction,
  previous: StoredAppSchemaCandidateValidationHead,
  canonical: CanonicalAppSchemaCandidateValidationFrameV1,
  operation: "advance" | "settle",
) {
  const stored = yield* storedFrameValuesEffect(canonical, operation);
  const updated = yield* queryEffect(
    "writeHead",
    tx.update(fxSystemAppSchemaCandidateValidations).set({
      ...stored,
      updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(
        fxSystemAppSchemaCandidateValidations.scopeId,
        previous.scopeId,
      ),
      eq(
        fxSystemAppSchemaCandidateValidations.attemptFence,
        previous.frame.attemptFence,
      ),
      eq(
        fxSystemAppSchemaCandidateValidations.frameSha256,
        yield* decodeHexEffect(previous.frameSha256Hex, operation),
      ),
    )).returning({ scopeId: fxSystemAppSchemaCandidateValidations.scopeId }),
  );
  if (updated.length !== 1) {
    return yield* Effect.fail(operationError(operation, "superseded"));
  }
});

const storedFrameValuesEffect = Effect.fn(
  "AppSchemaCandidateValidation.storedFrameValues",
)(function* (
  canonical: CanonicalAppSchemaCandidateValidationFrameV1,
  operation: "install" | "advance" | "settle",
) {
  const frameBytes = copyBytes(canonical.canonicalBytes);
  return Object.freeze({
    frameCodecVersion: canonical.frame.codecVersion,
    frameKind: canonical.frame.kind,
    frameByteLength: BigInt(frameBytes.byteLength),
    frameSha256: yield* decodeHexEffect(canonical.sha256Hex, operation),
    frameBytes,
  });
});

const decodeHexEffect = Effect.fn(
  "AppSchemaCandidateValidation.decodeHex",
)(function* (
  value: string,
  operation: "install" | "advance" | "settle",
) {
  return yield* Effect.fromResult(
    Encoding.decodeHex(value).pipe(
      Result.mapError(() => operationError(operation, "corruption")),
    ),
  );
});

const readDatabaseClockEffect = Effect.fn(
  "AppSchemaCandidateValidation.readDatabaseClock",
)(function* (tx: AppRowTransaction) {
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(sql`select clock_timestamp() as "now"`),
    catch: cause => new AppSchemaCandidateValidationPersistenceError({
      operation: "readDatabaseClock",
      cause,
    }),
  }));
  const rows = yield* Effect.try({
    try: () => rowsFromDriverExecuteResult(result, () => {
      throw operationError("settle", "corruption");
    }),
    catch: cause => cause instanceof AppSchemaCandidateValidationOperationV1Error
      ? cause
      : new AppSchemaCandidateValidationPersistenceError({
          operation: "readDatabaseClock",
          cause,
        }),
  });
  const row = rows[0];
  if (
    rows.length !== 1 ||
    typeof row !== "object" ||
    row === null ||
    !("now" in row)
  ) return yield* Effect.fail(operationError("settle", "corruption"));
  const now = databaseTimestampFromUnknown(row.now);
  return now === null
    ? yield* Effect.fail(operationError("settle", "corruption"))
    : now;
});

function candidateIdentityFromProgress(
  progress: AppSchemaCandidateValidationProgressFrameV1,
) {
  return candidateIdentityFromFrame(progress);
}

function candidateIdentityFromFrame(
  progress:
    | AppSchemaCandidateValidationProgressFrameV1
    | AppSchemaCandidateValidationReceiptFrameV1,
) {
  return Object.freeze({
    codecVersion: progress.codecVersion,
    budgetIdentity: progress.budgetIdentity,
    scopeId: progress.scopeId,
    storageGeneration: progress.storageGeneration,
    storageGenerationFence: progress.storageGenerationFence,
    scopeEpoch: progress.scopeEpoch,
    schemaVersionId: progress.schemaVersionId,
    schemaManifestSha256Hex: progress.schemaManifestSha256Hex,
    frontierCommitSeq: progress.frontierCommitSeq,
    attemptFence: progress.attemptFence,
  });
}

function sameCandidateIdentity(
  left: StoredAppSchemaCandidateValidationHead,
  right: StoredAppSchemaCandidateValidationHead,
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.scopeId === right.scopeId &&
    left.schemaVersionId === right.schemaVersionId &&
    left.frame.schemaManifestSha256Hex ===
      right.frame.schemaManifestSha256Hex &&
    left.frame.storageGeneration === right.frame.storageGeneration &&
    left.frame.storageGenerationFence ===
      right.frame.storageGenerationFence &&
    left.frame.scopeEpoch === right.frame.scopeEpoch &&
    left.frame.frontierCommitSeq === right.frame.frontierCommitSeq &&
    left.frame.attemptFence === right.frame.attemptFence;
}

function mapCandidateWriteGuardError(
  error: AppSchemaCandidateValidationError,
): AppSchemaCandidateWriteGuardError {
  if (error instanceof AppSchemaCandidateValidationOperationV1Error) {
    return new AppSchemaCandidateWriteGuardError({
      reason: error.reason === "superseded"
        ? "concurrentStateChange"
        : error.reason === "corruption"
        ? "corruption"
        : "persistence",
      cause: error,
    });
  }
  if (error instanceof AppSchemaCandidateValidationPersistenceError) {
    return new AppSchemaCandidateWriteGuardError({
      reason: "persistence",
      cause: error.cause,
    });
  }
  return new AppSchemaCandidateWriteGuardError({
    reason: "persistence",
    cause: error,
  });
}

function headMatchesSnapshot(
  head: StoredAppSchemaCandidateValidationHead,
  authority: TrustedScopeAuthority,
  snapshot: CandidateSnapshot,
): boolean {
  return head.deploymentId === snapshot.deploymentId &&
    head.schemaVersionId === snapshot.schemaVersionId &&
    head.frame.schemaManifestSha256Hex === snapshot.manifestSha256Hex &&
    head.frame.storageGeneration === authority.storageGeneration &&
    head.frame.storageGenerationFence === authority.storageGenerationFence &&
    head.frame.scopeEpoch === authority.epoch;
}

function trustedAuthoritiesEqual(
  left: TrustedScopeAuthority,
  right: TrustedScopeAuthority,
): boolean {
  return left.deploymentId === right.deploymentId &&
    left.scopeId === right.scopeId &&
    scopePhysicalLocatorsEqual(left.physicalLocator, right.physicalLocator) &&
    left.storageGeneration === right.storageGeneration &&
    left.storageGenerationFence === right.storageGenerationFence &&
    left.epoch === right.epoch;
}

function requireHeadSnapshotResult(
  head: StoredAppSchemaCandidateValidationHead,
  authority: TrustedScopeAuthority,
  snapshot: CandidateSnapshot,
  operation: "advance" | "settle",
): Result.Result<void, AppSchemaCandidateValidationOperationV1Error> {
  return headMatchesSnapshot(head, authority, snapshot)
    ? Result.succeed(undefined)
    : Result.fail(operationError(operation, "superseded"));
}

function requireExactAuthorityResult(
  authority: TrustedScopeAuthority,
  clock: ScopeClockRecord,
  operation: "install" | "load" | "settle",
): Result.Result<void, AppSchemaCandidateValidationOperationV1Error> {
  return authority.storageGeneration === "flarexdb_v1" &&
      clock.scopeId === authority.scopeId &&
      clock.storageGeneration === authority.storageGeneration &&
      clock.storageGenerationFence === authority.storageGenerationFence &&
      clock.epoch === authority.epoch
    ? Result.succeed(undefined)
    : Result.fail(operationError(operation, "superseded"));
}

function requireHeadAuthorityResult(
  head: StoredAppSchemaCandidateValidationHead,
  clock: ScopeClockRecord,
  operation: "load" | "settle",
): Result.Result<void, AppSchemaCandidateValidationOperationV1Error> {
  return head.frame.storageGeneration === clock.storageGeneration &&
      head.frame.storageGenerationFence === clock.storageGenerationFence &&
      head.frame.scopeEpoch === clock.epoch
    ? Result.succeed(undefined)
    : Result.fail(operationError(operation, "superseded"));
}

function nextAttemptFenceResult(
  previous: AppSchemaCandidateValidationAttemptFenceV1 | null,
  operation: "install",
): Result.Result<
  AppSchemaCandidateValidationAttemptFenceV1,
  AppSchemaCandidateValidationOperationV1Error
> {
  const next = previous === null ? 1n : previous + 1n;
  if (next > MAX_POSTGRES_BIGINT) {
    return Result.fail(operationError(operation, "corruption"));
  }
  return decodeAttemptFenceResult(next).pipe(
    Result.mapError(() => operationError(operation, "corruption")),
  );
}

function operationError(
  operation: "install" | "load" | "advance" | "settle",
  reason: "corruption" | "superseded" | "rollbackConfirmed" |
    "decisionUncertain",
) {
  return new AppSchemaCandidateValidationOperationV1Error({
    operation,
    reason,
  });
}

function monotonicNow(
  options: AppSchemaCandidateValidationOptions,
): Effect.Effect<bigint> {
  return options.monotonicNow ?? Clock.currentTimeNanos;
}

function runFault(
  options: AppSchemaCandidateValidationOptions,
  point: AppSchemaCandidateValidationFaultPoint,
  operation: "install" | "advance" | "settle",
) {
  return options.faultAfter === undefined
    ? Effect.void
    : Effect.try({
        try: () => options.faultAfter?.(point),
        catch: () => operationError(operation, "rollbackConfirmed"),
      });
}

function queryEffect<Row>(
  operation: AppSchemaCandidateValidationPersistenceError["operation"],
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, AppSchemaCandidateValidationPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new AppSchemaCandidateValidationPersistenceError({
      operation,
      cause,
    }),
  }));
}

interface StartedLocatedEffectTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/** The single audited Effect runtime bridge for this transaction owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedAppSchemaCandidateValidationTarget,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedLocatedEffectTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(
    "App-schema candidate validation transaction rolled back.",
  );
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
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

const runLocatedTransaction = Effect.fn(
  "AppSchemaCandidateValidation.runLocatedTransaction",
)(function* <Value, Failure>(
  target: LocatedAppSchemaCandidateValidationTarget,
  operation: "install" | "load" | "advance" | "settle",
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.fn.Return<
  Value,
  Failure | AppSchemaCandidateValidationOperationV1Error
> {
  const started = startLocatedEffectTransaction(target, work);
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: cause => cause,
  })));
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
    cause.issue.kind === "callbackCleanupFailed"
  ) return yield* Effect.fail(operationError(operation, "decisionUncertain"));
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) return yield* Effect.fail(operationError(operation, "decisionUncertain"));
  return yield* Effect.fail(operationError(operation, "rollbackConfirmed"));
});
