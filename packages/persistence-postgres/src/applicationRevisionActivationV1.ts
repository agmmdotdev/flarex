import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Scope } from "effect";
import {
  decodeApplicationRevisionActivationRequestV1,
  encodeApplicationRevisionActivationRequestV1,
  MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1,
  type ApplicationRevisionExpectedActiveV1,
} from "flarex-protocol/internal/application-revision-activation-request-v1";
import {
  DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
  decodeDeclarativeV2PhysicalFrameV1,
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2ActivationHeadFrameV1,
  type DeclarativeV2ActivationRevisionFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  createLocatedApplicationRevisionReadinessTargetV1,
  getApplicationRevisionReadinessTargetDatabaseV1,
  loadStoredApplicationRevisionReadinessEvidenceV1,
  type LoadStoredApplicationRevisionReadinessEvidenceV1Error,
  type LocatedApplicationRevisionReadinessTargetV1,
  type ValidateStoredApplicationRevisionReadinessEvidenceV1Error,
  validateStoredApplicationRevisionReadinessEvidenceInTransactionV1,
} from "./applicationRevisionReadinessV1";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForShareError,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  fxSystemDeclarativeV2ActivationHeads,
  fxSystemDeclarativeV2ActivationRevisions,
  fxSystemDeclarativeV2Verdicts,
} from "./schema";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import type { SchemaManifestAppSchemaV1 } from
  "flarex-protocol/schema-manifest";
import {
  inspectActiveApplicationRevisionSelectionStateV1,
  issueActiveApplicationRevisionSelectionV1,
  claimActiveApplicationRevisionSyscallValidatorBasisV1,
  copyActiveApplicationRevisionMetadataV1,
  InvalidActiveApplicationRevisionSelectionV1Error,
  revokeActiveApplicationRevisionSelectionV1,
} from "./applicationRevisionActiveSelectionStateV1";
export { InvalidActiveApplicationRevisionSelectionV1Error } from
  "./applicationRevisionActiveSelectionStateV1";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const UTF8 = new TextEncoder();
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const SUPPORTED_LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const);

export type LocatedApplicationRevisionActivationTargetV1 =
  LocatedApplicationRevisionReadinessTargetV1;

export function createLocatedApplicationRevisionActivationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted?: RunLocatedReadCommittedTransactionV1,
): LocatedApplicationRevisionActivationTargetV1 {
  return runReadCommitted === undefined
    ? createLocatedApplicationRevisionReadinessTargetV1(db, physicalLocator)
    : createLocatedApplicationRevisionReadinessTargetV1(
        db,
        physicalLocator,
        runReadCommitted,
      );
}

export interface ApplicationRevisionActivationContextV1 {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  /** Exact C08-B1/B2 point-commit composition used by FSV04 replay. */
  readonly pointCommit: unknown;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedApplicationRevisionActivationTargetV1
  >;
  readonly faultAfter?: (
    point:
      | "afterActivationRevisionInsert"
      | "afterActivationHeadWrite"
      | "beforeUncertaintyObservation",
  ) => void;
  readonly beforeActiveReadTransaction?: () => Promise<void>;
}

export interface ApplicationRevisionActiveCasTokenV1
  extends ApplicationRevisionExpectedActiveV1 {}

export interface ActiveApplicationRevisionMetadataV1 {
  readonly scopeId: ScopeId;
  readonly applicationRevisionId: string;
  readonly activationRevision: bigint;
  readonly candidateSha256: Uint8Array;
  readonly readinessReceiptSha256: Uint8Array;
  readonly activationHeadSha256: Uint8Array;
  readonly schemaVersionId: string;
  readonly packageSha256: Uint8Array;
  readonly artifactSha256: Uint8Array;
  readonly sourceRootSha256: Uint8Array;
  readonly semanticRootSha256: Uint8Array;
  readonly schemaArtifactSha256: Uint8Array;
  readonly schemaBindingSha256: Uint8Array;
  readonly functionMetadataSha256: Uint8Array;
  readonly validatorRootSha256: Uint8Array;
  readonly declaredHandlerSetSha256: Uint8Array;
  readonly runtimeProjectionSetSha256: Uint8Array;
  readonly functionGroupManifestSha256: Uint8Array;
}

declare const activeSelectionBrand: unique symbol;
export interface AuthenticatedActiveApplicationRevisionSelectionV1 {
  readonly [activeSelectionBrand]: true;
}

export interface CoherentActiveApplicationRevisionV1 {
  readonly selection: AuthenticatedActiveApplicationRevisionSelectionV1;
  readonly expectedActiveRevision: ApplicationRevisionActiveCasTokenV1;
  readonly metadata: ActiveApplicationRevisionMetadataV1;
}

export interface ActivatedApplicationRevisionReceiptV1 {
  readonly status: "activated";
  readonly disposition: "inserted" | "replayed";
  readonly scopeId: ScopeId;
  readonly applicationRevisionId: string;
  readonly activationRevision: bigint;
  readonly previousActivationRevision: bigint | null;
  readonly candidateSha256: Uint8Array;
  readonly readinessReceiptSha256: Uint8Array;
  readonly activationRequestSha256: Uint8Array;
  readonly activationRevisionFrameSha256: Uint8Array;
  readonly activationRevisionFrameBytes: Uint8Array;
  readonly expectedActiveRevision: ApplicationRevisionActiveCasTokenV1;
  readonly activatedAt: string;
}

export class InvalidApplicationRevisionActivationInputV1Error
  extends Data.TaggedError("InvalidApplicationRevisionActivationInputV1Error")<{
    readonly reason: "invalidRevisionId" | "invalidExpectedActiveRevision";
  }> {}

export class UnsupportedApplicationRevisionActivationTargetV1Error
  extends Data.TaggedError(
    "UnsupportedApplicationRevisionActivationTargetV1Error",
  )<{
    readonly actual: ScopePhysicalLocator;
  }> {}

export class ApplicationRevisionActivationNotReadyV1Error
  extends Data.TaggedError("ApplicationRevisionActivationNotReadyV1Error")<{
    readonly revisionId: string;
    readonly reason:
      | "readinessMissing"
      | "registrationIncomplete"
      | "physicalBuildMissing"
      | "physicalBuildNotEnabled"
      | "uniqueConstraintSetNotClosed"
      | "uniqueConstraintBuildMissing"
      | "uniqueConstraintBuildNotEnabled";
  }> {}

export class ApplicationRevisionAlreadyActiveV1Error
  extends Data.TaggedError("ApplicationRevisionAlreadyActiveV1Error")<{
    readonly revisionId: string;
    readonly activationRevision: bigint;
  }> {}

export class ApplicationRevisionActivationStaleV1Error
  extends Data.TaggedError("ApplicationRevisionActivationStaleV1Error")<{
    readonly revisionId: string;
    readonly reason: "expectedHead" | "scopeAuthority" | "concurrentHead";
  }> {}

export class ApplicationRevisionActivationCorruptionV1Error
  extends Data.TaggedError("ApplicationRevisionActivationCorruptionV1Error")<{
    readonly revisionId: string;
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class ApplicationRevisionActivationIntegrationV1Error
  extends Data.TaggedError("ApplicationRevisionActivationIntegrationV1Error")<{
    readonly phase:
      | "loadActiveHint"
      | "targetTransaction"
      | "activeReadBarrier"
      | "observeReplay";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class ApplicationRevisionActivationDecisionUncertainV1Error
  extends Data.TaggedError(
    "ApplicationRevisionActivationDecisionUncertainV1Error",
  )<{
    readonly revisionId: string;
    readonly cause: unknown;
  }> {}

export class ActiveApplicationRevisionMissingV1Error
  extends Data.TaggedError("ActiveApplicationRevisionMissingV1Error")<{
    readonly deploymentId: string;
  }> {}

export type ActivateApplicationRevisionV1Error =
  | InvalidApplicationRevisionActivationInputV1Error
  | UnsupportedApplicationRevisionActivationTargetV1Error
  | ApplicationRevisionActivationNotReadyV1Error
  | ApplicationRevisionAlreadyActiveV1Error
  | ApplicationRevisionActivationStaleV1Error
  | ApplicationRevisionActivationCorruptionV1Error
  | ApplicationRevisionActivationIntegrationV1Error
  | ApplicationRevisionActivationDecisionUncertainV1Error
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | LoadStoredApplicationRevisionReadinessEvidenceV1Error
  | ValidateStoredApplicationRevisionReadinessEvidenceV1Error;

export type ReadActiveApplicationRevisionV1Error =
  | UnsupportedApplicationRevisionActivationTargetV1Error
  | ActiveApplicationRevisionMissingV1Error
  | ApplicationRevisionActivationNotReadyV1Error
  | ApplicationRevisionActivationStaleV1Error
  | ApplicationRevisionActivationCorruptionV1Error
  | ApplicationRevisionActivationIntegrationV1Error
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LoadStoredApplicationRevisionReadinessEvidenceV1Error
  | ValidateStoredApplicationRevisionReadinessEvidenceV1Error;

export function inspectActiveApplicationRevisionSelectionV1(
  selection: unknown,
): Result.Result<
  ActiveApplicationRevisionMetadataV1,
  InvalidActiveApplicationRevisionSelectionV1Error
> {
  return inspectActiveApplicationRevisionSelectionStateV1(selection);
}

export interface ActiveApplicationRevisionInvocationBasisV1 {
  readonly deploymentId: string;
  readonly metadata: ActiveApplicationRevisionMetadataV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
}

/**
 * Private FSV06 projection from the same scope-owned selection state used by
 * C03-V and FSV06-A1. It exposes only the immutable metadata and schema
 * manifest needed to construct the already-owned point-mutation target.
 */
export function claimActiveApplicationRevisionInvocationBasisV1(
  selection: unknown,
): Result.Result<
  ActiveApplicationRevisionInvocationBasisV1,
  InvalidActiveApplicationRevisionSelectionV1Error
> {
  return claimActiveApplicationRevisionSyscallValidatorBasisV1(selection).pipe(
    Result.map((basis) => Object.freeze({
      deploymentId: basis.authority.deploymentId,
      metadata: copyActiveApplicationRevisionMetadataV1(basis.metadata),
      schemaManifest: basis.schemaManifest,
    })),
  );
}

export const activateApplicationRevisionV1 = Effect.fn(
  "ApplicationRevisionActivation.activateV1",
)(function* (
  revisionId: unknown,
  expectedActiveRevision: ApplicationRevisionExpectedActiveV1 | null,
  context: ApplicationRevisionActivationContextV1,
): Effect.fn.Return<
  ActivatedApplicationRevisionReceiptV1,
  ActivateApplicationRevisionV1Error,
  Scope.Scope
> {
  if (
    !isNonBlankString(revisionId) || revisionId.includes("\0") ||
    UTF8.encode(revisionId).byteLength > 1_024
  ) {
    return yield* new InvalidApplicationRevisionActivationInputV1Error({
      reason: "invalidRevisionId",
    });
  }
  const capturedExpected = yield* Effect.fromResult(
    captureExpectedActiveRevision(expectedActiveRevision),
  );
  const pointCommit = context.pointCommit;
  const controlDb = context.controlDb;
  const authorityPorts = context.authority;
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    authorityPorts,
  );
  yield* requireSupportedTarget(located.authority.physicalLocator);
  const prepared = yield* loadStoredApplicationRevisionReadinessEvidenceV1(
    revisionId,
    context.deploymentId,
    controlDb,
    pointCommit,
    authorityPorts,
    located,
  );
  if (prepared === null) {
    return yield* new ApplicationRevisionActivationNotReadyV1Error({
      revisionId,
      reason: "readinessMissing",
    });
  }
  return yield* runActivationTransaction(
    prepared,
    capturedExpected,
    context,
  );
});

export const readActiveApplicationRevisionV1 = Effect.fn(
  "ApplicationRevisionActivation.readActiveV1",
)(function* (
  context: ApplicationRevisionActivationContextV1,
): Effect.fn.Return<
  CoherentActiveApplicationRevisionV1,
  ReadActiveApplicationRevisionV1Error,
  Scope.Scope
> {
  const pointCommit = context.pointCommit;
  const controlDb = context.controlDb;
  const authorityPorts = context.authority;
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    authorityPorts,
  );
  yield* requireSupportedTarget(located.authority.physicalLocator);
  const hint = yield* loadActiveRevisionHint(
    context.deploymentId,
    located.authority.scopeId,
    getApplicationRevisionReadinessTargetDatabaseV1(located.target),
  );
  const prepared = yield* loadStoredApplicationRevisionReadinessEvidenceV1(
    hint.applicationRevisionId,
    context.deploymentId,
    controlDb,
    pointCommit,
    authorityPorts,
    located,
  );
  if (prepared === null) {
    return yield* new ApplicationRevisionActivationNotReadyV1Error({
      revisionId: hint.applicationRevisionId,
      reason: "readinessMissing",
    });
  }
  const state = yield* runActiveReaderTransaction(prepared, context);
  const metadata = copyActiveApplicationRevisionMetadataV1(state.metadata);
  const selection = yield* Effect.acquireRelease(
    Effect.sync(() => {
      return issueActiveApplicationRevisionSelectionV1(
        metadata,
        prepared.authority,
        prepared.requirements.manifest,
        Object.freeze({
          attemptSha256: copyBytes(prepared.revision.attemptSha256),
          functionMetadataBytes: copyBytes(
            prepared.revision.functionMetadataBytes,
          ),
          candidate: prepared.candidate,
          candidateSha256: copyBytes(prepared.publication.candidateSha256),
          candidateFrameBytes: copyBytes(
            prepared.publication.candidateFrameBytes,
          ),
          publication: prepared.publication.publication,
        }),
      );
    }),
    issued => Effect.sync(() => {
      revokeActiveApplicationRevisionSelectionV1(issued);
    }),
  );
  return Object.freeze({
    selection,
    expectedActiveRevision: copyCasToken(state.expectedActiveRevision),
    metadata: copyActiveApplicationRevisionMetadataV1(metadata),
  });
});

/**
 * Package-private C03-V revalidation inside the already-owned point-operation
 * transaction. The caller has locked the scope clock first; this read locks
 * only the exact active head and does not expose raw activation storage.
 */
export const validateActiveApplicationRevisionSelectionInTransactionV1 =
  Effect.fn("ApplicationRevisionActivation.validateSelectionInTransaction")(
    function* (
      selection: AuthenticatedActiveApplicationRevisionSelectionV1,
      tx: AppRowTransaction,
      currentClock: ScopeClockRecord,
    ): Effect.fn.Return<
      ActiveApplicationRevisionMetadataV1,
      | InvalidActiveApplicationRevisionSelectionV1Error
      | ApplicationRevisionActivationStaleV1Error
      | ApplicationRevisionActivationCorruptionV1Error
      | ApplicationRevisionActivationIntegrationV1Error
    > {
      const basis = yield* Effect.fromResult(
        claimActiveApplicationRevisionSyscallValidatorBasisV1(selection),
      );
      if (
        currentClock.scopeId !== basis.authority.scopeId ||
        currentClock.storageGeneration !== basis.authority.storageGeneration ||
        currentClock.storageGenerationFence !==
          basis.authority.storageGenerationFence ||
        currentClock.epoch !== basis.authority.epoch
      ) {
        return yield* new ApplicationRevisionActivationStaleV1Error({
          revisionId: basis.metadata.applicationRevisionId,
          reason: "scopeAuthority",
        });
      }
      const rows = yield* query(tx.select()
        .from(fxSystemDeclarativeV2ActivationHeads)
        .where(eq(
          fxSystemDeclarativeV2ActivationHeads.scopeId,
          basis.authority.scopeId,
        ))
        .limit(1)
        .for("share"));
      const row = rows[0];
      if (row === undefined) {
        return yield* new ApplicationRevisionActivationStaleV1Error({
          revisionId: basis.metadata.applicationRevisionId,
          reason: "concurrentHead",
        });
      }
      const head = yield* decodeStoredHead(
        basis.metadata.applicationRevisionId,
        row,
      ).pipe(Effect.mapError(error =>
        error instanceof ApplicationRevisionActivationCorruptionV1Error
          ? error
          : new ApplicationRevisionActivationCorruptionV1Error({
            revisionId: basis.metadata.applicationRevisionId,
            detail: "the active head digest could not be verified",
            cause: error,
          })
      ));
      if (
        head.currentRevision !== basis.metadata.activationRevision ||
        !bytesEqualFullScan(
          head.candidateSha256,
          basis.metadata.candidateSha256,
        ) ||
        !bytesEqualFullScan(
          head.verdictSha256,
          basis.metadata.readinessReceiptSha256,
        ) ||
        !bytesEqualFullScan(head.sha256, basis.metadata.activationHeadSha256)
      ) {
        return yield* new ApplicationRevisionActivationStaleV1Error({
          revisionId: basis.metadata.applicationRevisionId,
          reason: "concurrentHead",
        });
      }
      return copyActiveApplicationRevisionMetadataV1(basis.metadata);
    },
  );

function captureExpectedActiveRevision(
  input: ApplicationRevisionExpectedActiveV1 | null,
): Result.Result<
  ApplicationRevisionExpectedActiveV1 | null,
  InvalidApplicationRevisionActivationInputV1Error
> {
  if (input === null) return Result.succeed(null);
  const activationRevisionDescriptor = typeof input === "object" &&
      input !== null
    ? Object.getOwnPropertyDescriptor(input, "activationRevision")
    : undefined;
  const activationHeadDescriptor = typeof input === "object" && input !== null
    ? Object.getOwnPropertyDescriptor(input, "activationHeadSha256")
    : undefined;
  if (
    typeof input !== "object" || input === null || Array.isArray(input) ||
    Reflect.ownKeys(input).length !== 2 ||
    activationRevisionDescriptor === undefined ||
    activationRevisionDescriptor.enumerable !== true ||
    !("value" in activationRevisionDescriptor) ||
    activationHeadDescriptor === undefined ||
    activationHeadDescriptor.enumerable !== true ||
    !("value" in activationHeadDescriptor) ||
    typeof activationRevisionDescriptor.value !== "bigint" ||
    activationRevisionDescriptor.value < 1n ||
    activationRevisionDescriptor.value >
      MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1 ||
    !isUint8ArrayWithByteLength(activationHeadDescriptor.value, 32)
  ) {
    return Result.fail(new InvalidApplicationRevisionActivationInputV1Error({
      reason: "invalidExpectedActiveRevision",
    }));
  }
  return Result.succeed(Object.freeze({
    activationRevision: activationRevisionDescriptor.value,
    activationHeadSha256: copyBytes(activationHeadDescriptor.value),
  }));
}

function requireSupportedTarget(locator: ScopePhysicalLocator) {
  return locator.kind === SUPPORTED_LOCATOR.kind &&
      locator.databaseKey === SUPPORTED_LOCATOR.databaseKey &&
      locator.schemaName === SUPPORTED_LOCATOR.schemaName
    ? Effect.void
    : Effect.fail(new UnsupportedApplicationRevisionActivationTargetV1Error({
        actual: Object.freeze({ ...locator }),
      }));
}

type ReadinessPrepared = import("./applicationRevisionReadinessV1")
  .ApplicationRevisionReadinessPreparedEvidenceV1;

const runActivationTransaction = Effect.fn(
  "ApplicationRevisionActivation.runTransaction",
)(function* (
  prepared: ReadinessPrepared,
  expected: ApplicationRevisionExpectedActiveV1 | null,
  context: ApplicationRevisionActivationContextV1,
): Effect.fn.Return<
  ActivatedApplicationRevisionReceiptV1,
  ActivateApplicationRevisionV1Error
> {
  const started = startLocatedEffectTransaction(
    prepared.target,
    tx => activateInTransaction(tx, prepared, expected, context),
  );
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (error._tag === "None") return yield* Effect.die(settled.cause);
  const cause = error.value;
  const callbackCause = started.callbackCause();
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack" &&
    cause.issue.callbackCause === started.rollbackSignal &&
    callbackCause !== undefined
  ) return yield* Effect.failCause(callbackCause);
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "decisionUncertain"
  ) {
    const callback = started.callbackValue();
    if (callback !== undefined) {
      const observation = yield* Effect.exit(observeActivationReplay(
        prepared,
        callback,
        context,
      ));
      if (Exit.isSuccess(observation) && observation.value !== null) {
        return observation.value;
      }
      return yield* new ApplicationRevisionActivationDecisionUncertainV1Error({
        revisionId: prepared.revision.revisionId,
        cause: Object.freeze({
          settlementCause: cause,
          observationCause: Exit.isFailure(observation)
            ? observation.cause
            : null,
        }),
      });
    }
    return yield* new ApplicationRevisionActivationDecisionUncertainV1Error({
      revisionId: prepared.revision.revisionId,
      cause,
    });
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackCleanupFailed" &&
    callbackCause !== undefined
  ) return yield* Effect.failCause(Cause.combine(
    callbackCause,
    Cause.die(new ApplicationRevisionActivationIntegrationV1Error({
      phase: "targetTransaction",
      retryable: false,
      cause,
    })),
  ));
  return yield* new ApplicationRevisionActivationIntegrationV1Error({
    phase: "targetTransaction",
    retryable: cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind !== "decisionUncertain",
    cause,
  });
});

const activateInTransaction = Effect.fn(
  "ApplicationRevisionActivation.activateInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: ReadinessPrepared,
  expected: ApplicationRevisionExpectedActiveV1 | null,
  context: ApplicationRevisionActivationContextV1,
) {
  const revisionId = prepared.revision.revisionId;
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    prepared.authority.scopeId,
  );
  yield* requireExactClock(revisionId, prepared.authority, clock);
  const headRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2ActivationHeads)
    .where(eq(
      fxSystemDeclarativeV2ActivationHeads.scopeId,
      prepared.authority.scopeId,
    ))
    .limit(1)
    .for("update"));
  const head = headRows[0];
  const decodedHead = head === undefined
    ? null
    : yield* decodeStoredHead(revisionId, head);
  const readiness = yield*
    validateStoredApplicationRevisionReadinessEvidenceInTransactionV1(
      tx,
      prepared,
      clock,
      "update",
    );
  if (readiness.status !== "ready") {
    return yield* new ApplicationRevisionActivationNotReadyV1Error({
      revisionId,
      reason: readiness.reason,
    });
  }
  const request = yield* encodeAndHashActivationRequest(
    prepared.authority.scopeId,
    revisionId,
    prepared.revision.candidateSha256,
    readiness.readinessReceiptSha256,
    expected,
  );
  const replayRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2ActivationRevisions)
    .where(and(
      eq(
        fxSystemDeclarativeV2ActivationRevisions.scopeId,
        prepared.authority.scopeId,
      ),
      eq(
        fxSystemDeclarativeV2ActivationRevisions.activationRequestSha256,
        request.sha256,
      ),
    ))
    .limit(1)
    .for("update"));
  if (replayRows[0] !== undefined) {
    return yield* replayActivationRevision(
      replayRows[0],
      prepared,
      readiness.readinessReceiptSha256,
      request.sha256,
    );
  }
  if (
    decodedHead !== null &&
    bytesEqualFullScan(
      decodedHead.frame.candidateSha256!,
      prepared.revision.candidateSha256,
    ) &&
    bytesEqualFullScan(
      decodedHead.frame.verdictSha256!,
      readiness.readinessReceiptSha256,
    )
  ) {
    return yield* new ApplicationRevisionAlreadyActiveV1Error({
      revisionId,
      activationRevision: decodedHead.frame.currentRevision!,
    });
  }
  if (!expectedMatchesHead(expected, decodedHead)) {
    return yield* new ApplicationRevisionActivationStaleV1Error({
      revisionId,
      reason: "expectedHead",
    });
  }
  const previousRevision = decodedHead?.currentRevision ?? null;
  if (
    previousRevision !== null &&
    previousRevision >= MAX_APPLICATION_REVISION_ACTIVATION_REVISION_V1
  ) {
    return yield* corruption(
      revisionId,
      "the activation revision counter is exhausted",
    );
  }
  const activationRevision = previousRevision === null
    ? 1n
    : previousRevision + 1n;
  const activatedAt = yield* databaseTime(tx, revisionId);
  const activationFrame = yield* encodeAndHashPhysicalFrame(
    revisionId,
    Object.freeze({
      kind: "activation_revision",
      scopeId: prepared.authority.scopeId,
      revision: activationRevision,
      previousRevision,
      action: "activate",
      candidateSha256: prepared.revision.candidateSha256,
      verdictSha256: readiness.readinessReceiptSha256,
      activationRequestSha256: request.sha256,
    } satisfies DeclarativeV2ActivationRevisionFrameV1),
  );
  yield* query(tx.insert(fxSystemDeclarativeV2ActivationRevisions).values({
    scopeId: prepared.authority.scopeId,
    revision: activationRevision,
    previousRevision,
    action: "activate",
    candidateSha256: prepared.revision.candidateSha256,
    verdictSha256: readiness.readinessReceiptSha256,
    activationRequestSha256: request.sha256,
    frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
    frameByteLength: BigInt(activationFrame.bytes.byteLength),
    frameSha256: activationFrame.sha256,
    frameBytes: activationFrame.bytes,
    activatedAt,
  }).returning({
    revision: fxSystemDeclarativeV2ActivationRevisions.revision,
  }));
  yield* runFault(context, "afterActivationRevisionInsert");
  const nextHeadFrame = yield* encodeAndHashPhysicalFrame(
    revisionId,
    Object.freeze({
      kind: "activation_head",
      scopeId: prepared.authority.scopeId,
      revisionCounter: activationRevision,
      currentRevision: activationRevision,
      candidateSha256: prepared.revision.candidateSha256,
      verdictSha256: readiness.readinessReceiptSha256,
    } satisfies DeclarativeV2ActivationHeadFrameV1),
  );
  if (head === undefined) {
    yield* query(tx.insert(fxSystemDeclarativeV2ActivationHeads).values({
      scopeId: prepared.authority.scopeId,
      revisionCounter: activationRevision,
      currentRevision: activationRevision,
      candidateSha256: prepared.revision.candidateSha256,
      verdictSha256: readiness.readinessReceiptSha256,
      frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
      frameByteLength: BigInt(nextHeadFrame.bytes.byteLength),
      frameSha256: nextHeadFrame.sha256,
      frameBytes: nextHeadFrame.bytes,
      createdAt: activatedAt,
      updatedAt: activatedAt,
    }).returning({
      currentRevision: fxSystemDeclarativeV2ActivationHeads.currentRevision,
    }));
  } else {
    if (decodedHead === null) {
      return yield* corruption(
        revisionId,
        "the locked activation head could not be decoded",
      );
    }
    const updated = yield* query(tx.update(fxSystemDeclarativeV2ActivationHeads)
      .set({
        revisionCounter: activationRevision,
        currentRevision: activationRevision,
        candidateSha256: prepared.revision.candidateSha256,
        verdictSha256: readiness.readinessReceiptSha256,
        frameCodecVersion: DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1,
        frameByteLength: BigInt(nextHeadFrame.bytes.byteLength),
        frameSha256: nextHeadFrame.sha256,
        frameBytes: nextHeadFrame.bytes,
        updatedAt: activatedAt,
      })
      .where(and(
        eq(
          fxSystemDeclarativeV2ActivationHeads.scopeId,
          prepared.authority.scopeId,
        ),
        eq(
          fxSystemDeclarativeV2ActivationHeads.currentRevision,
          decodedHead.currentRevision,
        ),
        eq(
          fxSystemDeclarativeV2ActivationHeads.frameSha256,
          decodedHead!.sha256,
        ),
      ))
      .returning({
        currentRevision: fxSystemDeclarativeV2ActivationHeads.currentRevision,
      }));
    if (updated.length !== 1) {
      return yield* new ApplicationRevisionActivationStaleV1Error({
        revisionId,
        reason: "concurrentHead",
      });
    }
  }
  yield* runFault(context, "afterActivationHeadWrite");
  return activatedReceipt(
    "inserted",
    prepared,
    readiness.readinessReceiptSha256,
    request.sha256,
    activationFrame,
    nextHeadFrame.sha256,
    activationRevision,
    previousRevision,
    activatedAt.toISOString(),
  );
});

function expectedMatchesHead(
  expected: ApplicationRevisionExpectedActiveV1 | null,
  head: DecodedStoredHead | null,
): boolean {
  if (expected === null) return head === null;
  return head !== null &&
    head.frame.currentRevision === expected.activationRevision &&
    bytesEqualFullScan(head.sha256, expected.activationHeadSha256);
}

interface DecodedStoredHead {
  readonly frame: DeclarativeV2ActivationHeadFrameV1;
  readonly currentRevision: bigint;
  readonly candidateSha256: Uint8Array;
  readonly verdictSha256: Uint8Array;
  readonly sha256: Uint8Array;
}

const decodeStoredHead = Effect.fn(
  "ApplicationRevisionActivation.decodeStoredHead",
)(function* (
  revisionId: string,
  row: typeof fxSystemDeclarativeV2ActivationHeads.$inferSelect,
) {
  if (
    row.currentRevision === null || row.candidateSha256 === null ||
    row.verdictSha256 === null
  ) {
    return yield* corruption(
      revisionId,
      "the activation head is dormant or only partially populated",
    );
  }
  const digest = yield* hash(row.frameBytes);
  if (
    row.frameCodecVersion !== DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 ||
    row.frameByteLength !== BigInt(row.frameBytes.byteLength) ||
    !bytesEqualFullScan(digest, row.frameSha256)
  ) return yield* corruption(
    revisionId,
    "the activation head frame envelope is corrupt",
  );
  const decoded = yield* Effect.fromResult(
    decodeDeclarativeV2PhysicalFrameV1(row.frameBytes, FRAME_BUDGET),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionActivationCorruptionV1Error({
      revisionId,
      detail: "the activation head frame is not canonical",
      cause,
    })
  ));
  if (
    decoded.frame.kind !== "activation_head" ||
    decoded.frame.scopeId !== row.scopeId ||
    decoded.frame.revisionCounter !== row.revisionCounter ||
    decoded.frame.currentRevision !== row.currentRevision ||
    !bytesEqualFullScan(decoded.frame.candidateSha256!, row.candidateSha256) ||
    !bytesEqualFullScan(decoded.frame.verdictSha256!, row.verdictSha256)
  ) return yield* corruption(
    revisionId,
    "the activation head row does not match its canonical frame",
  );
  return Object.freeze({
    frame: decoded.frame,
    currentRevision: row.currentRevision,
    candidateSha256: copyBytes(row.candidateSha256),
    verdictSha256: copyBytes(row.verdictSha256),
    sha256: copyBytes(digest),
  });
});

const replayActivationRevision = Effect.fn(
  "ApplicationRevisionActivation.replayRevision",
)(function* (
  row: typeof fxSystemDeclarativeV2ActivationRevisions.$inferSelect,
  prepared: ReadinessPrepared,
  readinessReceiptSha256: Uint8Array,
  activationRequestSha256: Uint8Array,
) {
  const decoded = yield* decodeStoredActivationRevision(
    prepared.revision.revisionId,
    row,
  );
  if (
    decoded.frame.action !== "activate" ||
    !bytesEqualFullScan(
      decoded.frame.candidateSha256,
      prepared.revision.candidateSha256,
    ) ||
    !bytesEqualFullScan(
      decoded.frame.verdictSha256,
      readinessReceiptSha256,
    ) ||
    !bytesEqualFullScan(
      decoded.frame.activationRequestSha256,
      activationRequestSha256,
    )
  ) return yield* corruption(
    prepared.revision.revisionId,
    "the activation request replay resolves contradictory evidence",
  );
  const headFrame = yield* encodeAndHashPhysicalFrame(
    prepared.revision.revisionId,
    Object.freeze({
      kind: "activation_head",
      scopeId: row.scopeId,
      revisionCounter: row.revision,
      currentRevision: row.revision,
      candidateSha256: row.candidateSha256,
      verdictSha256: row.verdictSha256,
    } satisfies DeclarativeV2ActivationHeadFrameV1),
  );
  const activatedAt = databaseTimestamp(row.activatedAt);
  if (activatedAt === null) {
    return yield* corruption(
      prepared.revision.revisionId,
      "the activation timestamp is invalid",
    );
  }
  return activatedReceipt(
    "replayed",
    prepared,
    readinessReceiptSha256,
    activationRequestSha256,
    Object.freeze({ bytes: copyBytes(row.frameBytes), sha256: decoded.sha256 }),
    headFrame.sha256,
    row.revision,
    row.previousRevision,
    activatedAt.toISOString(),
  );
});

const decodeStoredActivationRevision = Effect.fn(
  "ApplicationRevisionActivation.decodeStoredRevision",
)(function* (
  revisionId: string,
  row: typeof fxSystemDeclarativeV2ActivationRevisions.$inferSelect,
) {
  const digest = yield* hash(row.frameBytes);
  if (
    row.frameCodecVersion !== DECLARATIVE_V2_PHYSICAL_CODEC_VERSION_V1 ||
    row.frameByteLength !== BigInt(row.frameBytes.byteLength) ||
    !bytesEqualFullScan(digest, row.frameSha256)
  ) return yield* corruption(
    revisionId,
    "the activation revision frame envelope is corrupt",
  );
  const decoded = yield* Effect.fromResult(
    decodeDeclarativeV2PhysicalFrameV1(row.frameBytes, FRAME_BUDGET),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionActivationCorruptionV1Error({
      revisionId,
      detail: "the activation revision frame is not canonical",
      cause,
    })
  ));
  if (
    decoded.frame.kind !== "activation_revision" ||
    decoded.frame.scopeId !== row.scopeId ||
    decoded.frame.revision !== row.revision ||
    decoded.frame.previousRevision !== row.previousRevision ||
    decoded.frame.action !== row.action ||
    !bytesEqualFullScan(decoded.frame.candidateSha256, row.candidateSha256) ||
    !bytesEqualFullScan(decoded.frame.verdictSha256, row.verdictSha256) ||
    !bytesEqualFullScan(
      decoded.frame.activationRequestSha256,
      row.activationRequestSha256,
    )
  ) return yield* corruption(
    revisionId,
    "the activation revision row does not match its canonical frame",
  );
  return Object.freeze({ frame: decoded.frame, sha256: copyBytes(digest) });
});

const runActiveReaderTransaction = Effect.fn(
  "ApplicationRevisionActivation.runActiveReaderTransaction",
)(function* (
  prepared: ReadinessPrepared,
  context: ApplicationRevisionActivationContextV1,
) {
  const beforeActiveReadTransaction = context.beforeActiveReadTransaction;
  if (beforeActiveReadTransaction !== undefined) {
    yield* Effect.tryPromise({
      try: beforeActiveReadTransaction,
      catch: cause => new ApplicationRevisionActivationIntegrationV1Error({
        phase: "activeReadBarrier",
        retryable: true,
        cause,
      }),
    });
  }
  const started = startLocatedEffectTransaction(
    prepared.target,
    tx => readActiveInTransaction(tx, prepared, context),
  );
  const settled = yield* Effect.uninterruptible(Effect.exit(Effect.tryPromise({
    try: () => started.promise,
    catch: cause => cause,
  })));
  if (Exit.isSuccess(settled)) return settled.value;
  const error = Cause.findErrorOption(settled.cause);
  if (error._tag === "None") return yield* Effect.die(settled.cause);
  const cause = error.value;
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
    Cause.die(new ApplicationRevisionActivationIntegrationV1Error({
      phase: "targetTransaction",
      retryable: false,
      cause,
    })),
  ));
  return yield* new ApplicationRevisionActivationIntegrationV1Error({
    phase: "targetTransaction",
    retryable: true,
    cause,
  });
});

const readActiveInTransaction = Effect.fn(
  "ApplicationRevisionActivation.readActiveInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: ReadinessPrepared,
  context: ApplicationRevisionActivationContextV1,
) {
  const revisionId = prepared.revision.revisionId;
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    prepared.authority.scopeId,
  );
  yield* requireExactClock(revisionId, prepared.authority, clock);
  const headRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2ActivationHeads)
    .where(eq(
      fxSystemDeclarativeV2ActivationHeads.scopeId,
      prepared.authority.scopeId,
    ))
    .limit(1)
    .for("share"));
  const headRow = headRows[0];
  if (headRow === undefined) {
    return yield* new ActiveApplicationRevisionMissingV1Error({
      deploymentId: context.deploymentId,
    });
  }
  const head = yield* decodeStoredHead(revisionId, headRow);
  if (
    !bytesEqualFullScan(
      head.frame.candidateSha256!,
      prepared.revision.candidateSha256,
    )
  ) {
    return yield* new ApplicationRevisionActivationStaleV1Error({
      revisionId,
      reason: "concurrentHead",
    });
  }
  const revisionRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2ActivationRevisions)
    .where(and(
      eq(
        fxSystemDeclarativeV2ActivationRevisions.scopeId,
        prepared.authority.scopeId,
      ),
      eq(
        fxSystemDeclarativeV2ActivationRevisions.revision,
        head.frame.currentRevision!,
      ),
    ))
    .limit(1)
    .for("share"));
  const activationRow = revisionRows[0];
  if (activationRow === undefined || activationRow.action !== "activate") {
    return yield* corruption(
      revisionId,
      "the active head does not resolve one activate revision",
    );
  }
  const activation = yield* decodeStoredActivationRevision(
    revisionId,
    activationRow,
  );
  const readiness = yield*
    validateStoredApplicationRevisionReadinessEvidenceInTransactionV1(
      tx,
      prepared,
      clock,
      "share",
    );
  if (readiness.status !== "ready") {
    return yield* new ApplicationRevisionActivationNotReadyV1Error({
      revisionId,
      reason: readiness.reason,
    });
  }
  if (
    activation.frame.revision !== head.frame.currentRevision ||
    !bytesEqualFullScan(
      activation.frame.candidateSha256,
      head.frame.candidateSha256!,
    ) ||
    !bytesEqualFullScan(
      activation.frame.verdictSha256,
      head.frame.verdictSha256!,
    ) ||
    !bytesEqualFullScan(
      activation.frame.candidateSha256,
      prepared.revision.candidateSha256,
    ) ||
    !bytesEqualFullScan(
      activation.frame.verdictSha256,
      readiness.readinessReceiptSha256,
    )
  ) return yield* corruption(
    revisionId,
    "the active head mixes activation, revision, or readiness evidence",
  );
  const expectedActiveRevision = Object.freeze({
    activationRevision: activation.frame.revision,
    activationHeadSha256: copyBytes(head.sha256),
  });
  return Object.freeze({
    expectedActiveRevision,
    metadata: activeMetadata(
      prepared,
      activation.frame.revision,
      readiness.readinessReceiptSha256,
      head.sha256,
    ),
  });
});

const loadActiveRevisionHint = Effect.fn(
  "ApplicationRevisionActivation.loadActiveHint",
)(function* (
  deploymentId: string,
  scopeId: ScopeId,
  db: FlarexMetadataDatabase,
) {
  const rows = yield* Effect.tryPromise({
    try: () => db.select({
      currentRevision: fxSystemDeclarativeV2ActivationHeads.currentRevision,
      verdictSha256: fxSystemDeclarativeV2ActivationHeads.verdictSha256,
      revisionId: fxSystemDeclarativeV2Verdicts.revisionId,
    }).from(fxSystemDeclarativeV2ActivationHeads).leftJoin(
      fxSystemDeclarativeV2Verdicts,
      and(
        eq(
          fxSystemDeclarativeV2Verdicts.scopeId,
          fxSystemDeclarativeV2ActivationHeads.scopeId,
        ),
        eq(
          fxSystemDeclarativeV2Verdicts.verdictSha256,
          fxSystemDeclarativeV2ActivationHeads.verdictSha256,
        ),
      ),
    ).where(eq(fxSystemDeclarativeV2ActivationHeads.scopeId, scopeId)).limit(1),
    catch: cause => new ApplicationRevisionActivationIntegrationV1Error({
      phase: "loadActiveHint",
      retryable: true,
      cause,
    }),
  });
  const row = rows[0];
  if (row === undefined) {
    return yield* new ActiveApplicationRevisionMissingV1Error({ deploymentId });
  }
  if (
    row.currentRevision === null || row.verdictSha256 === null ||
    row.revisionId === null
  ) return yield* corruption(
    "unknown",
    "the active head hint is dormant, partial, or disconnected from readiness",
  );
  return Object.freeze({ applicationRevisionId: row.revisionId });
});

const observeActivationReplay = Effect.fn(
  "ApplicationRevisionActivation.observeReplay",
)(function* (
  prepared: ReadinessPrepared,
  callback: ActivatedApplicationRevisionReceiptV1,
  context: ApplicationRevisionActivationContextV1,
) {
  yield* runFault(context, "beforeUncertaintyObservation");
  const db = getApplicationRevisionReadinessTargetDatabaseV1(prepared.target);
  const rows = yield* Effect.tryPromise({
    try: () => db.select()
      .from(fxSystemDeclarativeV2ActivationRevisions)
      .where(and(
        eq(
          fxSystemDeclarativeV2ActivationRevisions.scopeId,
          prepared.authority.scopeId,
        ),
        eq(
          fxSystemDeclarativeV2ActivationRevisions.activationRequestSha256,
          callback.activationRequestSha256,
        ),
      ))
      .limit(1),
    catch: cause => new ApplicationRevisionActivationIntegrationV1Error({
      phase: "observeReplay",
      retryable: true,
      cause,
    }),
  });
  const row = rows[0];
  if (row === undefined) return null;
  const replay = yield* replayActivationRevision(
    row,
    prepared,
    callback.readinessReceiptSha256,
    callback.activationRequestSha256,
  );
  return replay.activationRevision === callback.activationRevision &&
      bytesEqualFullScan(
        replay.activationRevisionFrameSha256,
        callback.activationRevisionFrameSha256,
      )
    ? replay
    : null;
});

const encodeAndHashActivationRequest = Effect.fn(
  "ApplicationRevisionActivation.encodeAndHashRequest",
)(function* (
  scopeId: ScopeId,
  revisionId: string,
  candidateSha256: Uint8Array,
  readinessReceiptSha256: Uint8Array,
  expectedActiveRevision: ApplicationRevisionExpectedActiveV1 | null,
) {
  const encoded = yield* Effect.fromResult(
    encodeApplicationRevisionActivationRequestV1({
      action: "activate",
      scopeId,
      revisionId,
      candidateSha256,
      readinessReceiptSha256,
      expectedActiveRevision,
    }),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionActivationCorruptionV1Error({
      revisionId,
      detail: "the activation request could not be canonically encoded",
      cause,
    })
  ));
  const decoded = yield* Effect.fromResult(
    decodeApplicationRevisionActivationRequestV1(encoded.canonicalBytes),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionActivationCorruptionV1Error({
      revisionId,
      detail: "the activation request did not decode canonically",
      cause,
    })
  ));
  if (!bytesEqualFullScan(decoded.canonicalBytes, encoded.canonicalBytes)) {
    return yield* corruption(
      revisionId,
      "the activation request canonical round trip changed bytes",
    );
  }
  return Object.freeze({
    bytes: copyBytes(encoded.canonicalBytes),
    sha256: yield* hash(encoded.canonicalBytes),
  });
});

const encodeAndHashPhysicalFrame = Effect.fn(
  "ApplicationRevisionActivation.encodeAndHashPhysicalFrame",
)(function* (
  revisionId: string,
  frame: DeclarativeV2ActivationRevisionFrameV1 |
    DeclarativeV2ActivationHeadFrameV1,
) {
  const encoded = yield* Effect.fromResult(
    encodeDeclarativeV2PhysicalFrameV1(frame, FRAME_BUDGET),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionActivationCorruptionV1Error({
      revisionId,
      detail: "the activation physical frame could not be encoded",
      cause,
    })
  ));
  const bytes = copyBytes(encoded.canonicalBytes);
  return Object.freeze({ bytes, sha256: yield* hash(bytes) });
});

function requireExactClock(
  revisionId: string,
  expected: TrustedScopeAuthority,
  current: ScopeClockRecord,
) {
  return current.storageGeneration === expected.storageGeneration &&
      current.storageGenerationFence === expected.storageGenerationFence &&
      current.epoch === expected.epoch
    ? Effect.void
    : Effect.fail(new ApplicationRevisionActivationStaleV1Error({
        revisionId,
        reason: "scopeAuthority",
      }));
}

function activeMetadata(
  prepared: ReadinessPrepared,
  activationRevision: bigint,
  readinessReceiptSha256: Uint8Array,
  activationHeadSha256: Uint8Array,
): ActiveApplicationRevisionMetadataV1 {
  const candidate = prepared.candidate;
  const receipt = prepared.revision;
  return Object.freeze({
    scopeId: prepared.authority.scopeId,
    applicationRevisionId: receipt.revisionId,
    activationRevision,
    candidateSha256: copyBytes(receipt.candidateSha256),
    readinessReceiptSha256: copyBytes(readinessReceiptSha256),
    activationHeadSha256: copyBytes(activationHeadSha256),
    schemaVersionId: receipt.schemaVersionId,
    packageSha256: copyBytes(receipt.packageSha256),
    artifactSha256: copyBytes(receipt.artifactSha256),
    sourceRootSha256: copyBytes(candidate.sourceRootSha256),
    semanticRootSha256: copyBytes(candidate.semanticRootSha256),
    schemaArtifactSha256: copyBytes(receipt.schemaArtifactSha256),
    schemaBindingSha256: copyBytes(receipt.schemaBindingSha256),
    functionMetadataSha256: copyBytes(receipt.functionMetadataSha256),
    validatorRootSha256: copyBytes(receipt.validatorRootSha256),
    declaredHandlerSetSha256: copyBytes(receipt.declaredHandlerSetSha256),
    runtimeProjectionSetSha256: copyBytes(candidate.runtimeProjectionSetSha256),
    functionGroupManifestSha256: copyBytes(
      candidate.functionGroupManifestSha256,
    ),
  });
}

function copyCasToken(
  token: ApplicationRevisionActiveCasTokenV1,
): ApplicationRevisionActiveCasTokenV1 {
  return Object.freeze({
    activationRevision: token.activationRevision,
    activationHeadSha256: copyBytes(token.activationHeadSha256),
  });
}

function activatedReceipt(
  disposition: "inserted" | "replayed",
  prepared: ReadinessPrepared,
  readinessReceiptSha256: Uint8Array,
  activationRequestSha256: Uint8Array,
  frame: Readonly<{ readonly bytes: Uint8Array; readonly sha256: Uint8Array }>,
  headSha256: Uint8Array,
  activationRevision: bigint,
  previousActivationRevision: bigint | null,
  activatedAt: string,
): ActivatedApplicationRevisionReceiptV1 {
  return Object.freeze({
    status: "activated",
    disposition,
    scopeId: prepared.authority.scopeId,
    applicationRevisionId: prepared.revision.revisionId,
    activationRevision,
    previousActivationRevision,
    candidateSha256: copyBytes(prepared.revision.candidateSha256),
    readinessReceiptSha256: copyBytes(readinessReceiptSha256),
    activationRequestSha256: copyBytes(activationRequestSha256),
    activationRevisionFrameSha256: copyBytes(frame.sha256),
    activationRevisionFrameBytes: copyBytes(frame.bytes),
    expectedActiveRevision: Object.freeze({
      activationRevision,
      activationHeadSha256: copyBytes(headSha256),
    }),
    activatedAt,
  });
}

function databaseTime(tx: AppRowTransaction, revisionId: string) {
  return query(tx.select({ now: sql<Date>`current_timestamp` })
    .from(fxSystemDeclarativeV2Verdicts)
    .limit(1)).pipe(Effect.flatMap(rows => {
      const value = databaseTimestamp(rows[0]?.now);
      return value === null
        ? corruption(revisionId, "PostgreSQL returned an invalid activation time")
        : Effect.succeed(value);
    }));
}

function databaseTimestamp(value: unknown): Date | null {
  const date = copyFiniteDate(value);
  if (date !== undefined) return date;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function runFault(
  context: ApplicationRevisionActivationContextV1,
  point:
    | "afterActivationRevisionInsert"
    | "afterActivationHeadWrite"
    | "beforeUncertaintyObservation",
) {
  return context.faultAfter === undefined
    ? Effect.void
    : Effect.try({
        try: () => context.faultAfter?.(point),
        catch: cause => new ApplicationRevisionActivationIntegrationV1Error({
          phase: point === "beforeUncertaintyObservation"
            ? "observeReplay"
            : "targetTransaction",
          retryable: true,
          cause,
        }),
      });
}

function corruption(revisionId: string, detail: string) {
  return Effect.fail(new ApplicationRevisionActivationCorruptionV1Error({
    revisionId,
    detail,
  }));
}

const hash = (bytes: Uint8Array): Effect.Effect<
  Uint8Array,
  DeclarativeV2Sha256V1Error
> => makeLiveDeclarativeV2Sha256V1()(bytes, {
  maximumInputBytes: HASH_BUDGET.maximumInputBytes,
});

function query<Row>(queryValue: PromiseLike<ReadonlyArray<Row>>) {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => queryValue,
    catch: cause => new ApplicationRevisionActivationIntegrationV1Error({
      phase: "targetTransaction",
      retryable: true,
      cause,
    }),
  }));
}

interface StartedTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
  readonly callbackValue: () => Value | undefined;
}

/** The single audited Effect runtime bridge for the Drizzle callback owner. */
function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedApplicationRevisionActivationTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  let observedValue: Value | undefined;
  const rollbackSignal = new Error("FSV05 activation transaction rolled back.");
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      observedCause = exit.cause;
      throw rollbackSignal;
    }
    observedValue = exit.value;
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => observedCause,
    callbackValue: () => observedValue,
  });
}
