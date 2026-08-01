import {
  bytesEqualFullScan,
  copyBytes,
} from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Cause, Data, Effect, Exit, Result, Scope } from "effect";
import {
  APPLICATION_REVISION_READINESS_RECEIPT_CODEC_VERSION_V1,
  decodeApplicationRevisionReadinessReceiptV1,
  encodeApplicationRevisionReadinessReceiptV1,
  type ApplicationRevisionReadinessColdReceiptV1,
  type ApplicationRevisionReadinessReceiptFrameV1,
} from "flarex-protocol/internal/application-revision-readiness-v1";
import {
  decodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import {
  decodeDeclarativeV2VerifierProgressFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import {
  makeCandidateRuntimePublicationRepositoryV1,
  type CandidateRuntimePublicationRepositoryV1Error,
  type LoadedCandidateRuntimePublicationV1,
} from "./candidateRuntimePublicationRepositoryV1";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  type IndexBuildReconciliationCatalogV1Error,
  type PublishedPhysicalRequirementSnapshotV1,
} from "./indexBuildReconciliation";
import {
  makeLiveDeclarativeV2Sha256V1,
  type DeclarativeV2Sha256V1Error,
} from "./declarativeV2Sha256";
import {
  getScopeClock,
  lockScopeClockForUpdateInTransactionEffect,
  type LockScopeClockForUpdateError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  fxSystemApplicationRevisionsV1,
  fxSystemDeclarativeV2Candidates,
  fxSystemDeclarativeV2VerifierAttemptsV2,
  fxSystemDeclarativeV2VerifierCommandAuthorityV1,
  fxSystemDeclarativeV2VerifierCommandsV2,
  fxSystemDeclarativeV2Verdicts,
  fxSystemIndexBuildStates,
} from "./schema";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedTrustedScopeAuthority,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import type {
  ReadAppIndexDefinitionError,
  ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import type { ReadSchemaVersionArtifactError } from "./schemaVersionArtifacts";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const READINESS_TARGET_DB: unique symbol = Symbol(
  "FlarexDB/applicationRevisionReadinessTargetDbV1",
);
const FRAME_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const PROGRESS_BUDGET = Object.freeze({
  maximumFrameBytes: 64 * 1_048_576,
  maximumCanonicalBytes: 64 * 1_048_576,
});
const HASH_BUDGET = Object.freeze({ maximumInputBytes: 64 * 1_048_576 });
const ROOT_DOMAIN = new TextEncoder().encode(
  "flarex.system/application-revision-readiness-receipt/v1/root\0",
);
const UTF8 = new TextEncoder();
const MAX_REQUIRED_BUILDS = 256;

export interface LocatedApplicationRevisionReadinessTargetV1
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [READINESS_TARGET_DB]: FlarexMetadataDatabase;
}

export function createLocatedApplicationRevisionReadinessTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedApplicationRevisionReadinessTargetV1 {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [READINESS_TARGET_DB]: db,
  });
}

/** Package-private lifecycle composition only; never export from package root. */
export function getApplicationRevisionReadinessTargetDatabaseV1(
  target: LocatedApplicationRevisionReadinessTargetV1,
): FlarexMetadataDatabase {
  return target[READINESS_TARGET_DB];
}

export interface ApplicationRevisionReadinessColdMaterializationPortV1<E> {
  readonly probe: (
    publication: LoadedCandidateRuntimePublicationV1,
  ) => Effect.Effect<
    ReadonlyArray<ApplicationRevisionReadinessColdReceiptV1>,
    E,
    Scope.Scope
  >;
}

export interface ApplicationRevisionReadinessContextV1<E> {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedApplicationRevisionReadinessTargetV1
  >;
  readonly coldMaterialization:
    ApplicationRevisionReadinessColdMaterializationPortV1<E>;
  readonly faultAfter?: (
    point: "afterVerdictInsert" | "afterAttemptReady",
  ) => void;
}

export type ApplicationRevisionReadinessNotReadyReasonV1 =
  | "registrationIncomplete"
  | "physicalBuildMissing"
  | "physicalBuildNotEnabled";

export type SettleApplicationRevisionReadinessV1Result =
  | Readonly<{
      readonly status: "not_ready";
      readonly revisionId: string;
      readonly reason: ApplicationRevisionReadinessNotReadyReasonV1;
      readonly indexDefinitionId?: number;
      readonly lifecycle?: string;
    }>
  | Readonly<{
      readonly status: "ready";
      readonly disposition: "inserted" | "replayed";
      readonly revisionId: string;
      readonly scopeId: ScopeId;
      readonly candidateSha256: Uint8Array;
      readonly attemptSha256: Uint8Array;
      readonly readinessReceiptSha256: Uint8Array;
      readonly readinessReceiptBytes: Uint8Array;
      readonly readyAt: string;
    }>;

export class InvalidApplicationRevisionReadinessInputV1Error
  extends Data.TaggedError("InvalidApplicationRevisionReadinessInputV1Error")<{
    readonly reason: "invalidRevisionId";
  }> {}

export class ApplicationRevisionReadinessRevisionV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessRevisionV1Error")<{
    readonly revisionId: string;
    readonly reason: "missing" | "deploymentMismatch";
  }> {}

export class ApplicationRevisionReadinessStaleAuthorityV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessStaleAuthorityV1Error")<{
    readonly revisionId: string;
    readonly reason:
      | "storageGeneration"
      | "storageGenerationFence"
      | "epoch"
      | "candidate"
      | "evidence"
      | "buildState";
  }> {}

export class ApplicationRevisionReadinessCorruptionV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessCorruptionV1Error")<{
    readonly revisionId: string;
    readonly detail: string;
    readonly cause?: unknown;
  }> {}

export class ApplicationRevisionReadinessIntegrationV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessIntegrationV1Error")<{
    readonly phase: "loadRevision" | "targetTransaction";
    readonly retryable: boolean;
    readonly cause: unknown;
  }> {}

export class ApplicationRevisionReadinessDecisionUncertainV1Error
  extends Data.TaggedError("ApplicationRevisionReadinessDecisionUncertainV1Error")<{
    readonly revisionId: string;
    readonly cause: unknown;
  }> {}

export type SettleApplicationRevisionReadinessV1Error<E> =
  | InvalidApplicationRevisionReadinessInputV1Error
  | ApplicationRevisionReadinessRevisionV1Error
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | ApplicationRevisionReadinessIntegrationV1Error
  | ApplicationRevisionReadinessDecisionUncertainV1Error
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError
  | CandidateRuntimePublicationRepositoryV1Error
  | IndexBuildReconciliationCatalogV1Error
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | DeclarativeV2Sha256V1Error
  | E;

type RevisionRow = typeof fxSystemApplicationRevisionsV1.$inferSelect;

export interface ApplicationRevisionReadinessPreparedEvidenceV1 {
  readonly revision: RevisionRow;
  readonly authority: TrustedScopeAuthority;
  readonly target: LocatedApplicationRevisionReadinessTargetV1;
  readonly candidate: DeclarativeV2CandidateFrameV1;
  readonly publication: LoadedCandidateRuntimePublicationV1;
  readonly requirements: PublishedPhysicalRequirementSnapshotV1;
  readonly coldReceipts: ReadonlyArray<ApplicationRevisionReadinessColdReceiptV1>;
  readonly runtimePublicationRootSha256: Uint8Array;
  readonly coldMaterializationRootSha256: Uint8Array;
}

export const settleApplicationRevisionReadinessV1 = Effect.fn(
  "ApplicationRevisionReadiness.settleV1",
)(function* <E>(
  revisionId: unknown,
  context: ApplicationRevisionReadinessContextV1<E>,
): Effect.fn.Return<
  SettleApplicationRevisionReadinessV1Result,
  SettleApplicationRevisionReadinessV1Error<E>,
  Scope.Scope
> {
  if (!isNonBlankString(revisionId) || UTF8.encode(revisionId).byteLength > 1_024) {
    return yield* new InvalidApplicationRevisionReadinessInputV1Error({
      reason: "invalidRevisionId",
    });
  }
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  const db = located.target[READINESS_TARGET_DB];
  const revision = yield* loadRevision(db, revisionId);
  if (revision === null) {
    return yield* new ApplicationRevisionReadinessRevisionV1Error({
      revisionId,
      reason: "missing",
    });
  }
  if (revision.deploymentId !== context.deploymentId) {
    return yield* new ApplicationRevisionReadinessRevisionV1Error({
      revisionId,
      reason: "deploymentMismatch",
    });
  }
  const runtimeRepository = makeCandidateRuntimePublicationRepositoryV1(
    located.target,
  );
  const publication = yield* runtimeRepository.load(
    located.authority.scopeId,
    revision.candidateSha256,
  );
  const candidate = publication.candidate;
  yield* Effect.fromResult(requireCandidateCorrelation(
    revision,
    located.authority,
    publication,
  ));
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
    context.controlDb,
    Object.freeze({
      deploymentId: revision.deploymentId,
      schemaVersionId: revision.schemaVersionId,
    }),
  );
  if (requirements === null) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the registered schema publication is missing",
    });
  }
  if (!bytesEqualFullScan(
    requirements.manifestSha256,
    revision.schemaArtifactSha256,
  )) {
    return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "evidence",
    });
  }
  if (requirements.definitions.length > MAX_REQUIRED_BUILDS) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the physical definition set exceeds the readiness bound",
    });
  }
  const existingVerdict = yield* loadExistingVerdict(
    db,
    located.authority.scopeId,
    revision.attemptSha256,
  );
  if (existingVerdict !== null) {
    const prepared = yield* prepareStoredApplicationRevisionReadinessEvidenceV1(
      revision,
      located.authority,
      located.target,
      publication,
      requirements,
      existingVerdict,
    );
    return yield* runReadinessTransaction(prepared, context);
  }
  const runtimePublicationRootSha256 = yield* hashRoot(
    "runtime-publication",
    runtimePublicationRootItems(publication),
  );
  const coldReceipts = yield* context.coldMaterialization.probe(publication);
  const normalizedColdReceipts = yield* validateColdReceipts(
    revisionId,
    publication,
    coldReceipts,
  );
  const coldMaterializationRootSha256 = yield* hashRoot(
    "cold-materialization",
    normalizedColdReceipts.flatMap(receipt => [
      UTF8.encode(receipt.group),
      receipt.sha256,
      receipt.canonicalBytes,
    ]),
  );
  const prepared = Object.freeze({
    revision,
    authority: located.authority,
    target: located.target,
    candidate,
    publication,
    requirements,
    coldReceipts: normalizedColdReceipts,
    runtimePublicationRootSha256,
    coldMaterializationRootSha256,
  });
  return yield* runReadinessTransaction(prepared, context);
});

const loadRevision = Effect.fn("ApplicationRevisionReadiness.loadRevision")(
  function* (db: FlarexMetadataDatabase, revisionId: string) {
    const rows = yield* Effect.tryPromise({
      try: () => db.select().from(fxSystemApplicationRevisionsV1).where(
        eq(fxSystemApplicationRevisionsV1.revisionId, revisionId),
      ).limit(1),
      catch: cause => new ApplicationRevisionReadinessIntegrationV1Error({
        phase: "loadRevision",
        retryable: true,
        cause,
      }),
    });
    return rows[0] ?? null;
  },
);

const loadExistingVerdict = Effect.fn(
  "ApplicationRevisionReadiness.loadExistingVerdict",
)(function* (
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
  attemptSha256: Uint8Array,
) {
  const rows = yield* Effect.tryPromise({
    try: () => db.select().from(fxSystemDeclarativeV2Verdicts).where(and(
      eq(fxSystemDeclarativeV2Verdicts.scopeId, scopeId),
      eq(fxSystemDeclarativeV2Verdicts.attemptSha256, attemptSha256),
    )).limit(1),
    catch: cause => new ApplicationRevisionReadinessIntegrationV1Error({
      phase: "loadRevision",
      retryable: true,
      cause,
    }),
  });
  return rows[0] ?? null;
});

/**
 * Package-private FSV04 evidence projection reused by activation and coherent
 * active reads. It performs no writes and never probes R2: the durable cold
 * receipts are decoded from the already-settled readiness receipt, then
 * rebound to the immutable candidate publication using the exact FSV04 roots.
 */
export const prepareStoredApplicationRevisionReadinessEvidenceV1 = Effect.fn(
  "ApplicationRevisionReadiness.prepareStoredEvidence",
)(function* (
  revision: RevisionRow,
  authority: TrustedScopeAuthority,
  target: LocatedApplicationRevisionReadinessTargetV1,
  publication: LoadedCandidateRuntimePublicationV1,
  requirements: PublishedPhysicalRequirementSnapshotV1,
  existingVerdict: typeof fxSystemDeclarativeV2Verdicts.$inferSelect,
): Effect.fn.Return<
  ApplicationRevisionReadinessPreparedEvidenceV1,
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | DeclarativeV2Sha256V1Error
> {
  const revisionId = revision.revisionId;
  yield* Effect.fromResult(requireCandidateCorrelation(
    revision,
    authority,
    publication,
  ));
  if (!bytesEqualFullScan(
    requirements.manifestSha256,
    revision.schemaArtifactSha256,
  )) {
    return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "evidence",
    });
  }
  if (requirements.definitions.length > MAX_REQUIRED_BUILDS) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the physical definition set exceeds the readiness bound",
    });
  }
  const runtimePublicationRootSha256 = yield* hashRoot(
    "runtime-publication",
    runtimePublicationRootItems(publication),
  );
  const decoded = yield* Effect.fromResult(
    decodeApplicationRevisionReadinessReceiptV1(existingVerdict.frameBytes),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the stored readiness receipt is corrupt",
      cause,
    })
  ));
  const frame = decoded.frame;
  if (
    frame.revisionId !== revisionId ||
    frame.scopeId !== authority.scopeId ||
    frame.storageGeneration !== authority.storageGeneration ||
    frame.storageGenerationFence !== authority.storageGenerationFence ||
    frame.scopeEpoch !== authority.epoch ||
    !bytesEqualFullScan(frame.candidateSha256, revision.candidateSha256) ||
    !bytesEqualFullScan(frame.attemptSha256, revision.attemptSha256) ||
    !bytesEqualFullScan(
      frame.runtimePublicationRootSha256,
      runtimePublicationRootSha256,
    )
  ) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
    revisionId,
    reason: "evidence",
  });
  const coldReceipts = yield* validateColdReceipts(
    revisionId,
    publication,
    frame.coldMaterializationReceipts,
  );
  const coldMaterializationRootSha256 = yield* hashRoot(
    "cold-materialization",
    coldReceipts.flatMap(receipt => [
      UTF8.encode(receipt.group),
      receipt.sha256,
      receipt.canonicalBytes,
    ]),
  );
  if (!bytesEqualFullScan(
    frame.coldMaterializationRootSha256,
    coldMaterializationRootSha256,
  )) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
    revisionId,
    reason: "evidence",
  });
  return Object.freeze({
    revision,
    authority,
    target,
    candidate: publication.candidate,
    publication,
    requirements,
    coldReceipts,
    runtimePublicationRootSha256,
    coldMaterializationRootSha256,
  });
});

export type LoadStoredApplicationRevisionReadinessEvidenceV1Error =
  | ApplicationRevisionReadinessRevisionV1Error
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | ApplicationRevisionReadinessIntegrationV1Error
  | CandidateRuntimePublicationRepositoryV1Error
  | IndexBuildReconciliationCatalogV1Error
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | DeclarativeV2Sha256V1Error;

export const loadStoredApplicationRevisionReadinessEvidenceV1 = Effect.fn(
  "ApplicationRevisionReadiness.loadStoredEvidence",
)(function* (
  revisionId: string,
  deploymentId: string,
  controlDb: FlarexMetadataDatabase,
  located: LocatedTrustedScopeAuthority<
    LocatedApplicationRevisionReadinessTargetV1
  >,
): Effect.fn.Return<
  ApplicationRevisionReadinessPreparedEvidenceV1 | null,
  LoadStoredApplicationRevisionReadinessEvidenceV1Error
> {
  const db = located.target[READINESS_TARGET_DB];
  const revision = yield* loadRevision(db, revisionId);
  if (revision === null) {
    return yield* new ApplicationRevisionReadinessRevisionV1Error({
      revisionId,
      reason: "missing",
    });
  }
  if (revision.deploymentId !== deploymentId) {
    return yield* new ApplicationRevisionReadinessRevisionV1Error({
      revisionId,
      reason: "deploymentMismatch",
    });
  }
  const publication = yield* makeCandidateRuntimePublicationRepositoryV1(
    located.target,
  ).load(located.authority.scopeId, revision.candidateSha256);
  const requirements = yield* loadPublishedPhysicalRequirementSnapshotV1(
    controlDb,
    Object.freeze({
      deploymentId: revision.deploymentId,
      schemaVersionId: revision.schemaVersionId,
    }),
  );
  if (requirements === null) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the registered schema publication is missing",
    });
  }
  const existingVerdict = yield* loadExistingVerdict(
    db,
    located.authority.scopeId,
    revision.attemptSha256,
  );
  if (existingVerdict === null) return null;
  return yield* prepareStoredApplicationRevisionReadinessEvidenceV1(
    revision,
    located.authority,
    located.target,
    publication,
    requirements,
    existingVerdict,
  );
});

const runReadinessTransaction = Effect.fn(
  "ApplicationRevisionReadiness.runTransaction",
)(function* <E>(
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  context: ApplicationRevisionReadinessContextV1<E>,
): Effect.fn.Return<
  SettleApplicationRevisionReadinessV1Result,
  SettleApplicationRevisionReadinessV1Error<E>
> {
  const started = startLocatedEffectTransaction(
    prepared.target,
    (tx) => settleInTransaction(tx, prepared, context),
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
    const replay = yield* observeReadinessReplay(
      prepared,
      started.callbackValue(),
    );
    if (replay !== null) return replay;
    return yield* new ApplicationRevisionReadinessDecisionUncertainV1Error({
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
    Cause.die(new ApplicationRevisionReadinessIntegrationV1Error({
      phase: "targetTransaction",
      retryable: false,
      cause,
    })),
  ));
  return yield* new ApplicationRevisionReadinessIntegrationV1Error({
    phase: "targetTransaction",
    retryable: cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind !== "decisionUncertain",
    cause,
  });
});

const settleInTransaction = Effect.fn(
  "ApplicationRevisionReadiness.settleInTransaction",
)(function* <E>(
  tx: AppRowTransaction,
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  context: ApplicationRevisionReadinessContextV1<E>,
): Effect.fn.Return<
  SettleApplicationRevisionReadinessV1Result,
  | LockScopeClockForUpdateError
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | ApplicationRevisionReadinessIntegrationV1Error
  | DeclarativeV2Sha256V1Error
> {
  const clock = yield* lockScopeClockForUpdateInTransactionEffect(
    tx,
    prepared.authority.scopeId,
  );
  return yield* settleWithLockedClock(
    tx,
    prepared,
    context,
    clock,
    "update",
    false,
  );
});

const settleWithLockedClock = Effect.fn(
  "ApplicationRevisionReadiness.settleWithLockedClock",
)(function* <E>(
  tx: AppRowTransaction,
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  context: ApplicationRevisionReadinessContextV1<E> | undefined,
  clock: ScopeClockRecord,
  evidenceLock: "update" | "share",
  requireExisting: boolean,
): Effect.fn.Return<
  SettleApplicationRevisionReadinessV1Result,
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | ApplicationRevisionReadinessIntegrationV1Error
  | DeclarativeV2Sha256V1Error
> {
  const revisionId = prepared.revision.revisionId;
  yield* Effect.fromResult(requireExactClock(
    revisionId,
    prepared.authority,
    clock,
  ));
  const revisionRows = yield* query(tx.select()
    .from(fxSystemApplicationRevisionsV1)
    .where(and(
      eq(fxSystemApplicationRevisionsV1.scopeId, prepared.authority.scopeId),
      eq(fxSystemApplicationRevisionsV1.revisionId, revisionId),
    ))
    .limit(1)
    .for(evidenceLock));
  const revision = revisionRows[0];
  if (revision === undefined || !revisionRowsEqual(revision, prepared.revision)) {
    return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "evidence",
    });
  }
  const candidateRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2Candidates)
    .where(and(
      eq(fxSystemDeclarativeV2Candidates.scopeId, prepared.authority.scopeId),
      eq(fxSystemDeclarativeV2Candidates.candidateSha256, revision.candidateSha256),
    ))
    .limit(1));
  const candidateRow = candidateRows[0];
  if (
    candidateRow === undefined ||
    candidateRow.storageGeneration !== clock.storageGeneration ||
    candidateRow.storageGenerationFence !== clock.storageGenerationFence ||
    candidateRow.epoch !== clock.epoch ||
    !bytesEqualFullScan(candidateRow.frameSha256, revision.candidateSha256)
  ) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
    revisionId,
    reason: "candidate",
  });

  const attemptRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2VerifierAttemptsV2)
    .where(and(
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, prepared.authority.scopeId),
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256, revision.attemptSha256),
    ))
    .limit(1)
    .for(evidenceLock));
  const attempt = attemptRows[0];
  if (attempt === undefined ||
    !bytesEqualFullScan(attempt.candidateSha256, revision.candidateSha256)) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the registered V2 attempt lineage is missing or contradictory",
    });
  }
  const progress = yield* Effect.fromResult(
    decodeDeclarativeV2VerifierProgressFrameV2(
      attempt.progressBytes,
      PROGRESS_BUDGET,
    ),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the V2 attempt progress frame is corrupt",
      cause,
    })
  ));
  if (
    attempt.lifecycle !== "registering" && attempt.lifecycle !== "ready"
  ) return notReady(revisionId, "registrationIncomplete");
  if (
    progress.frame.kind !== "progress_cursor" ||
    progress.frame.phase !== "verdict" ||
    attempt.pendingKind !== null
  ) return notReady(revisionId, "registrationIncomplete");

  const terminalRows = yield* query(tx.select({
    command: fxSystemDeclarativeV2VerifierCommandsV2,
    authority: fxSystemDeclarativeV2VerifierCommandAuthorityV1,
  }).from(fxSystemDeclarativeV2VerifierCommandsV2).innerJoin(
    fxSystemDeclarativeV2VerifierCommandAuthorityV1,
    and(
      eq(fxSystemDeclarativeV2VerifierCommandAuthorityV1.scopeId,
        fxSystemDeclarativeV2VerifierCommandsV2.scopeId),
      eq(fxSystemDeclarativeV2VerifierCommandAuthorityV1.attemptSha256,
        fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256),
      eq(fxSystemDeclarativeV2VerifierCommandAuthorityV1.sequence,
        fxSystemDeclarativeV2VerifierCommandsV2.sequence),
    ),
  ).where(and(
    eq(fxSystemDeclarativeV2VerifierCommandsV2.scopeId, prepared.authority.scopeId),
    eq(fxSystemDeclarativeV2VerifierCommandsV2.attemptSha256, revision.attemptSha256),
    eq(fxSystemDeclarativeV2VerifierCommandsV2.commandKind, "registration_page"),
  )).orderBy(asc(fxSystemDeclarativeV2VerifierCommandsV2.sequence)));
  if (terminalRows.length !== 1) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the registered revision does not have exactly one terminal registration command",
    });
  }
  const terminal = terminalRows[0]!;
  if (
    terminal.command.receiptSha256 === null ||
    terminal.authority.terminalProofSha256 === null ||
    terminal.authority.terminalProofBytes === null ||
    terminal.command.settledAt === null ||
    terminal.authority.settledAt === null ||
    !bytesEqualFullScan(terminal.command.receiptSha256, revision.receiptSha256)
  ) return yield* new ApplicationRevisionReadinessCorruptionV1Error({
    revisionId,
    detail: "the terminal registration receipt or analyzer proof is absent or contradictory",
  });
  const terminalProofSha256 = yield* hashBytes(terminal.authority.terminalProofBytes);
  if (!bytesEqualFullScan(terminalProofSha256, terminal.authority.terminalProofSha256)) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the terminal analyzer proof digest does not match its canonical bytes",
    });
  }
  const [functionMetadataSha256, receiptSha256, outputManifestSha256,
    nextProgressSha256] = yield* Effect.all([
      hashBytes(revision.functionMetadataBytes),
      hashBytes(terminal.command.receiptBytes ?? new Uint8Array()),
      hashBytes(terminal.command.outputManifestBytes ?? new Uint8Array()),
      hashBytes(terminal.command.nextProgressBytes ?? new Uint8Array()),
    ]);
  if (
    !bytesEqualFullScan(functionMetadataSha256, revision.functionMetadataSha256) ||
    !bytesEqualFullScan(receiptSha256, revision.receiptSha256) ||
    !bytesEqualFullScan(outputManifestSha256, revision.outputManifestSha256) ||
    !bytesEqualFullScan(nextProgressSha256, revision.nextProgressSha256)
  ) return yield* new ApplicationRevisionReadinessCorruptionV1Error({
    revisionId,
    detail: "registered function or terminal command canonical evidence has a digest mismatch",
  });

  const definitionIds = prepared.requirements.definitions.map(
    definition => definition.indexDefinitionId,
  );
  const buildRows = definitionIds.length === 0 ? [] : yield* query(tx.select()
    .from(fxSystemIndexBuildStates)
    .where(and(
      eq(fxSystemIndexBuildStates.scopeId, prepared.authority.scopeId),
      inArray(fxSystemIndexBuildStates.indexDefinitionId, definitionIds),
    ))
    .orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId))
    .for(evidenceLock));
  for (const definitionId of definitionIds) {
    const build = buildRows.find(row => row.indexDefinitionId === definitionId);
    if (build === undefined) {
      return notReady(revisionId, "physicalBuildMissing", definitionId);
    }
    if (
      build.storageGeneration !== clock.storageGeneration ||
      build.storageGenerationFence !== clock.storageGenerationFence ||
      build.epoch !== clock.epoch
    ) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "buildState",
    });
    if (build.lifecycle !== "enabled") {
      return notReady(
        revisionId,
        "physicalBuildNotEnabled",
        definitionId,
        build.lifecycle,
      );
    }
  }
  const enabledBuildRootSha256 = yield* hashRoot(
    "enabled-builds",
    buildRows.flatMap(build => {
      const definition = prepared.requirements.definitions.find(
        item => item.indexDefinitionId === build.indexDefinitionId,
      );
      if (definition === undefined) return [];
      return [
      u64(BigInt(build.indexDefinitionId)),
      u64(BigInt(definition.physicalSpecCodecVersion)),
      UTF8.encode(definition.physicalSpecBytesHex),
      UTF8.encode(definition.physicalSpecSha256Hex),
      UTF8.encode(build.storageGeneration),
      u64(build.storageGenerationFence),
      UTF8.encode(build.epoch),
      u64(build.startCommitSeq),
      UTF8.encode(build.lifecycle),
      u64(BigInt(build.cursorCodecVersion)),
      build.backfillCursorRowId ?? new Uint8Array(),
      u64(build.attemptFence),
      ];
    }),
  );
  const existingRows = yield* query(tx.select()
    .from(fxSystemDeclarativeV2Verdicts)
    .where(and(
      eq(fxSystemDeclarativeV2Verdicts.scopeId, prepared.authority.scopeId),
      eq(fxSystemDeclarativeV2Verdicts.attemptSha256, revision.attemptSha256),
    ))
    .limit(1)
    .for(evidenceLock));
  const existing = existingRows[0];
  if (existing !== undefined) {
    if (attempt.lifecycle !== "ready") {
      return yield* new ApplicationRevisionReadinessCorruptionV1Error({
        revisionId,
        detail: "a readiness receipt exists while its V2 attempt is not ready",
      });
    }
    return yield* validateStoredApplicationRevisionReadinessReceiptV1(
      existing,
      prepared,
      terminal.authority.terminalProofSha256,
      enabledBuildRootSha256,
    );
  }
  if (requireExisting) {
    return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "evidence",
    });
  }
  if (attempt.lifecycle !== "registering") {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "the V2 attempt is ready without a durable readiness receipt",
    });
  }
  const timeRows = yield* query(
    tx.select({ readyAt: sql<Date>`current_timestamp` })
      .from(fxSystemApplicationRevisionsV1)
      .where(eq(fxSystemApplicationRevisionsV1.revisionId, revisionId))
      .limit(1),
  );
  const readyAt = databaseTimestamp(timeRows[0]?.readyAt);
  if (readyAt === null) {
    return yield* new ApplicationRevisionReadinessIntegrationV1Error({
      phase: "targetTransaction",
      retryable: false,
      cause: new Error("PostgreSQL did not return a finite readiness timestamp."),
    });
  }
  const receipt = yield* encodeAndHashReceipt(
    prepared,
    terminal.authority.terminalProofSha256,
    enabledBuildRootSha256,
    readyAt.toISOString(),
  );
  yield* query(tx.insert(fxSystemDeclarativeV2Verdicts).values({
    scopeId: prepared.authority.scopeId,
    attemptSha256: revision.attemptSha256,
    candidateSha256: revision.candidateSha256,
    revisionId,
    verdictSha256: receipt.sha256,
    verdict: "ready",
    failureCode: null,
    frameCodecVersion:
      APPLICATION_REVISION_READINESS_RECEIPT_CODEC_VERSION_V1,
    frameByteLength: BigInt(receipt.bytes.byteLength),
    frameSha256: receipt.sha256,
    frameBytes: receipt.bytes,
    createdAt: readyAt,
  }).returning({ verdictSha256: fxSystemDeclarativeV2Verdicts.verdictSha256 }));
  if (context !== undefined) yield* runFault(context, "afterVerdictInsert");
  const updated = yield* query(tx.update(fxSystemDeclarativeV2VerifierAttemptsV2)
    .set({ lifecycle: "ready", updatedAt: readyAt })
    .where(and(
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.scopeId, prepared.authority.scopeId),
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256, revision.attemptSha256),
      eq(fxSystemDeclarativeV2VerifierAttemptsV2.lifecycle, "registering"),
    )).returning({ attemptSha256: fxSystemDeclarativeV2VerifierAttemptsV2.attemptSha256 }));
  if (updated.length !== 1) {
    return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "evidence",
    });
  }
  if (context !== undefined) yield* runFault(context, "afterAttemptReady");
  return readyResult("inserted", prepared, receipt.sha256, receipt.bytes, readyAt.toISOString());
});

export type ValidateStoredApplicationRevisionReadinessEvidenceV1Error =
  | ApplicationRevisionReadinessStaleAuthorityV1Error
  | ApplicationRevisionReadinessCorruptionV1Error
  | ApplicationRevisionReadinessIntegrationV1Error
  | DeclarativeV2Sha256V1Error;

export const validateStoredApplicationRevisionReadinessEvidenceInTransactionV1 =
  Effect.fn("ApplicationRevisionReadiness.validateStoredEvidenceInTransaction")(
    function* (
      tx: AppRowTransaction,
      prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
      lockedClock: ScopeClockRecord,
      evidenceLock: "update" | "share",
    ) {
      return yield* settleWithLockedClock(
        tx,
        prepared,
        undefined,
        lockedClock,
        evidenceLock,
        true,
      );
    },
  );

function requireCandidateCorrelation(
  revision: RevisionRow,
  authority: TrustedScopeAuthority,
  publication: LoadedCandidateRuntimePublicationV1,
): Result.Result<void, ApplicationRevisionReadinessStaleAuthorityV1Error> {
  const candidate = publication.candidate;
  const fail = (reason: ApplicationRevisionReadinessStaleAuthorityV1Error["reason"]) =>
    Result.fail(new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId: revision.revisionId,
      reason,
    }));
  if (
    candidate.scopeId !== authority.scopeId ||
    candidate.storageGeneration !== authority.storageGeneration
  ) return fail("storageGeneration");
  if (candidate.storageGenerationFence !== authority.storageGenerationFence) {
    return fail("storageGenerationFence");
  }
  if (candidate.scopeEpoch !== authority.epoch) return fail("epoch");
  if (
    !bytesEqualFullScan(publication.candidateSha256, revision.candidateSha256) ||
    !bytesEqualFullScan(candidate.schemaArtifactSha256, revision.schemaArtifactSha256) ||
    !bytesEqualFullScan(candidate.schemaBindingSha256, revision.schemaBindingSha256) ||
    !bytesEqualFullScan(candidate.validatorRootSha256, revision.validatorRootSha256) ||
    !bytesEqualFullScan(candidate.declaredHandlerSetSha256, revision.declaredHandlerSetSha256)
  ) return fail("candidate");
  return Result.succeed(undefined);
}

const validateColdReceipts = Effect.fn(
  "ApplicationRevisionReadiness.validateColdReceipts",
)(function* (
  revisionId: string,
  publication: LoadedCandidateRuntimePublicationV1,
  receipts: ReadonlyArray<ApplicationRevisionReadinessColdReceiptV1>,
) {
  const candidate = publication.candidate;
  const expectedProjections = new Map(
    publication.publication.projections.map(projection => [
      projection.frame.group,
      projection.reference.sha256,
    ]),
  );
  if (
    receipts.length !== expectedProjections.size ||
    receipts.length < 1 ||
    receipts.length > 2
  ) {
    return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "cold materialization did not return one receipt per execution group",
    });
  }
  const ordered = [...receipts].sort((left, right) =>
    left.group === right.group ? 0 : left.group === "transaction" ? -1 : 1
  );
  const groups = new Set<string>();
  for (const receipt of ordered) {
    if (groups.has(receipt.group)) {
      return yield* new ApplicationRevisionReadinessCorruptionV1Error({
        revisionId,
        detail: "cold materialization returned a duplicate execution group",
      });
    }
    groups.add(receipt.group);
    const digest = yield* hashBytes(receipt.canonicalBytes);
    if (!bytesEqualFullScan(digest, receipt.sha256)) {
      return yield* new ApplicationRevisionReadinessCorruptionV1Error({
        revisionId,
        detail: "cold materialization receipt digest mismatch",
      });
    }
    const decoded = yield* Effect.fromResult(
      decodeDeclarativeV2PhysicalFrameV1(
        receipt.canonicalBytes,
        FRAME_BUDGET,
      ),
    ).pipe(Effect.mapError(cause =>
      new ApplicationRevisionReadinessCorruptionV1Error({
        revisionId,
        detail: "cold materialization receipt is not canonical",
        cause,
      })
    ));
    if (
      decoded.frame.kind !== "cold_materialization_receipt" ||
      decoded.frame.group !== receipt.group ||
      !bytesEqualFullScan(decoded.frame.candidateSha256,
        publication.candidateSha256) ||
      !bytesEqualFullScan(decoded.frame.functionGroupManifestSha256,
        candidate.functionGroupManifestSha256) ||
      !bytesEqualFullScan(
        decoded.frame.projectionSha256,
        expectedProjections.get(receipt.group) ?? new Uint8Array(),
      )
    ) return yield* new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId,
      detail: "cold materialization receipt does not bind the candidate publication",
    });
  }
  return Object.freeze(ordered.map(receipt => Object.freeze({
    codecIdentity: receipt.codecIdentity,
    group: receipt.group,
    sha256: copyBytes(receipt.sha256),
    canonicalBytes: copyBytes(receipt.canonicalBytes),
  })));
});

function runtimePublicationRootItems(
  loaded: LoadedCandidateRuntimePublicationV1,
): ReadonlyArray<Uint8Array> {
  const items: Uint8Array[] = [
    loaded.candidateSha256,
    ...referenceRootItems(loaded.publication.projectionSetReference),
    ...referenceRootItems(loaded.publication.manifestReference),
  ];
  for (const projection of loaded.publication.projections) {
    items.push(
      UTF8.encode(projection.frame.group),
      ...referenceRootItems(projection.reference),
    );
    for (const module of projection.modules) {
      items.push(
        u64(module.moduleOrdinal),
        UTF8.encode(module.modulePath),
        u64(module.roles),
        u64(module.sourceByteLength),
        module.sourceSha256,
        ...referenceRootItems(module.reference),
      );
    }
  }
  for (const entry of loaded.publication.functionEntries) {
    items.push(
      UTF8.encode(entry.frame.functionPath),
      ...referenceRootItems(entry.reference),
    );
  }
  return items;
}

function referenceRootItems(reference: {
  readonly storeIdentity: string;
  readonly kind: string;
  readonly codecIdentity: string;
  readonly objectKey: string;
  readonly byteLength: bigint;
  readonly sha256: Uint8Array;
}): ReadonlyArray<Uint8Array> {
  return [
    UTF8.encode(reference.storeIdentity),
    UTF8.encode(reference.kind),
    UTF8.encode(reference.codecIdentity),
    UTF8.encode(reference.objectKey),
    u64(reference.byteLength),
    reference.sha256,
  ];
}

const encodeAndHashReceipt = Effect.fn(
  "ApplicationRevisionReadiness.encodeAndHashReceipt",
)(function* (
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  terminalProofSha256: Uint8Array,
  enabledBuildRootSha256: Uint8Array,
  readyAt: string,
) {
  const revision = prepared.revision;
  const encoded = yield* Effect.fromResult(
    encodeApplicationRevisionReadinessReceiptV1(Object.freeze({
      kind: "application_revision_readiness_receipt",
      revisionId: revision.revisionId,
      scopeId: prepared.authority.scopeId,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: prepared.authority.storageGenerationFence,
      scopeEpoch: prepared.authority.epoch,
      candidateSha256: revision.candidateSha256,
      attemptSha256: revision.attemptSha256,
      registrationInputSha256: revision.registrationInputSha256,
      verifierReceiptSha256: revision.receiptSha256,
      verifierTerminalProofSha256: terminalProofSha256,
      schemaArtifactSha256: revision.schemaArtifactSha256,
      schemaBindingSha256: revision.schemaBindingSha256,
      functionMetadataSha256: revision.functionMetadataSha256,
      validatorRootSha256: revision.validatorRootSha256,
      declaredHandlerSetSha256: revision.declaredHandlerSetSha256,
      registrationRootSha256: revision.registrationRootSha256,
      enabledBuildRootSha256,
      runtimeProjectionSetSha256:
        prepared.candidate.runtimeProjectionSetSha256,
      functionGroupManifestSha256:
        prepared.candidate.functionGroupManifestSha256,
      runtimePublicationRootSha256:
        prepared.runtimePublicationRootSha256,
      coldMaterializationRootSha256:
        prepared.coldMaterializationRootSha256,
      coldMaterializationReceipts: prepared.coldReceipts,
      readyAt,
    } satisfies ApplicationRevisionReadinessReceiptFrameV1)),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId: revision.revisionId,
      detail: "the readiness receipt could not be encoded",
      cause,
    })
  ));
  const bytes = copyBytes(encoded.canonicalBytes);
  return Object.freeze({ bytes, sha256: yield* hashBytes(bytes) });
});

export const validateStoredApplicationRevisionReadinessReceiptV1 = Effect.fn(
  "ApplicationRevisionReadiness.validateStoredReceipt",
)(function* (
  existing: typeof fxSystemDeclarativeV2Verdicts.$inferSelect,
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  terminalProofSha256: Uint8Array,
  enabledBuildRootSha256: Uint8Array,
) {
  const decoded = yield* Effect.fromResult(
    decodeApplicationRevisionReadinessReceiptV1(existing.frameBytes),
  ).pipe(Effect.mapError(cause =>
    new ApplicationRevisionReadinessCorruptionV1Error({
      revisionId: prepared.revision.revisionId,
      detail: "the stored readiness receipt is corrupt",
      cause,
    })
  ));
  const replayColdReceipts = yield* validateColdReceipts(
    prepared.revision.revisionId,
    prepared.publication,
    decoded.frame.coldMaterializationReceipts,
  );
  const replayColdRoot = yield* hashRoot(
    "cold-materialization",
    replayColdReceipts.flatMap(receipt => [
      UTF8.encode(receipt.group),
      receipt.sha256,
      receipt.canonicalBytes,
    ]),
  );
  if (!bytesEqualFullScan(
    replayColdRoot,
    decoded.frame.coldMaterializationRootSha256,
  )) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
    revisionId: prepared.revision.revisionId,
    reason: "evidence",
  });
  const replayPrepared = Object.freeze({
    ...prepared,
    coldReceipts: replayColdReceipts,
    coldMaterializationRootSha256: replayColdRoot,
  });
  const expected = yield* encodeAndHashReceipt(
    replayPrepared,
    terminalProofSha256,
    enabledBuildRootSha256,
    decoded.frame.readyAt,
  );
  if (
    existing.verdict !== "ready" ||
    existing.failureCode !== null ||
    existing.revisionId !== prepared.revision.revisionId ||
    !bytesEqualFullScan(existing.frameSha256, expected.sha256) ||
    !bytesEqualFullScan(existing.verdictSha256, expected.sha256) ||
    !bytesEqualFullScan(existing.frameBytes, expected.bytes)
  ) return yield* new ApplicationRevisionReadinessStaleAuthorityV1Error({
    revisionId: prepared.revision.revisionId,
    reason: "evidence",
  });
  return readyResult(
    "replayed",
    replayPrepared,
    expected.sha256,
    expected.bytes,
    decoded.frame.readyAt,
  );
});

const observeReadinessReplay = Effect.fn(
  "ApplicationRevisionReadiness.observeReplay",
)(function* (
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  callbackValue: SettleApplicationRevisionReadinessV1Result | undefined,
) {
  if (callbackValue?.status !== "ready") return null;
  const db = prepared.target[READINESS_TARGET_DB];
  const rows = yield* Effect.tryPromise({
    try: () => db.select().from(fxSystemDeclarativeV2Verdicts).where(and(
      eq(fxSystemDeclarativeV2Verdicts.scopeId, prepared.authority.scopeId),
      eq(fxSystemDeclarativeV2Verdicts.attemptSha256, prepared.revision.attemptSha256),
    )).limit(1),
    catch: cause => new ApplicationRevisionReadinessIntegrationV1Error({
      phase: "loadRevision",
      retryable: true,
      cause,
    }),
  });
  const existing = rows[0];
  if (existing === undefined) return null;
  const frameDigest = yield* hashBytes(existing.frameBytes);
  if (
    existing.verdict !== "ready" ||
    existing.failureCode !== null ||
    existing.revisionId !== prepared.revision.revisionId ||
    !bytesEqualFullScan(frameDigest, existing.frameSha256) ||
    !bytesEqualFullScan(existing.verdictSha256, existing.frameSha256) ||
    !bytesEqualFullScan(
      existing.verdictSha256,
      callbackValue.readinessReceiptSha256,
    ) ||
    !bytesEqualFullScan(
      existing.frameBytes,
      callbackValue.readinessReceiptBytes,
    )
  ) return null;
  return readyResult(
    "replayed",
    prepared,
    existing.verdictSha256,
    existing.frameBytes,
    callbackValue.readyAt,
  );
});

function requireExactClock(
  revisionId: string,
  expected: TrustedScopeAuthority,
  current: {
    readonly storageGeneration: string;
    readonly storageGenerationFence: bigint;
    readonly epoch: string;
  },
): Result.Result<void, ApplicationRevisionReadinessStaleAuthorityV1Error> {
  if (current.storageGeneration !== expected.storageGeneration) {
    return Result.fail(new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "storageGeneration",
    }));
  }
  if (current.storageGenerationFence !== expected.storageGenerationFence) {
    return Result.fail(new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "storageGenerationFence",
    }));
  }
  return current.epoch === expected.epoch
    ? Result.succeed(undefined)
    : Result.fail(new ApplicationRevisionReadinessStaleAuthorityV1Error({
      revisionId,
      reason: "epoch",
    }));
}

function revisionRowsEqual(left: RevisionRow, right: RevisionRow): boolean {
  const digests = [
    [left.candidateSha256, right.candidateSha256],
    [left.attemptSha256, right.attemptSha256],
    [left.registrationInputSha256, right.registrationInputSha256],
    [left.schemaArtifactSha256, right.schemaArtifactSha256],
    [left.schemaBindingSha256, right.schemaBindingSha256],
    [left.functionMetadataSha256, right.functionMetadataSha256],
    [left.validatorRootSha256, right.validatorRootSha256],
    [left.declaredHandlerSetSha256, right.declaredHandlerSetSha256],
    [left.registrationRootSha256, right.registrationRootSha256],
    [left.receiptSha256, right.receiptSha256],
  ] satisfies ReadonlyArray<readonly [Uint8Array, Uint8Array]>;
  return left.revisionId === right.revisionId &&
    left.deploymentId === right.deploymentId &&
    left.schemaVersionId === right.schemaVersionId &&
    left.status === "inactive" &&
    digests.every(([leftDigest, rightDigest]) =>
      bytesEqualFullScan(leftDigest, rightDigest)
    );
}

function readyResult(
  disposition: "inserted" | "replayed",
  prepared: ApplicationRevisionReadinessPreparedEvidenceV1,
  digest: Uint8Array,
  bytes: Uint8Array,
  readyAt: string,
): SettleApplicationRevisionReadinessV1Result {
  return Object.freeze({
    status: "ready",
    disposition,
    revisionId: prepared.revision.revisionId,
    scopeId: prepared.authority.scopeId,
    candidateSha256: copyBytes(prepared.revision.candidateSha256),
    attemptSha256: copyBytes(prepared.revision.attemptSha256),
    readinessReceiptSha256: copyBytes(digest),
    readinessReceiptBytes: copyBytes(bytes),
    readyAt,
  });
}

function notReady(
  revisionId: string,
  reason: ApplicationRevisionReadinessNotReadyReasonV1,
  indexDefinitionId?: number,
  lifecycle?: string,
): SettleApplicationRevisionReadinessV1Result {
  return Object.freeze({
    status: "not_ready",
    revisionId,
    reason,
    ...(indexDefinitionId === undefined ? {} : { indexDefinitionId }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
  });
}

const hashBytes = (bytes: Uint8Array) =>
  makeLiveDeclarativeV2Sha256V1()(bytes, HASH_BUDGET);

const hashRoot = Effect.fn("ApplicationRevisionReadiness.hashRoot")(
  function* (label: string, items: ReadonlyArray<Uint8Array>) {
    const labelBytes = UTF8.encode(label);
    const total = ROOT_DOMAIN.byteLength + 4 + labelBytes.byteLength + 4 +
      items.reduce((sum, item) => sum + 4 + item.byteLength, 0);
    if (total > HASH_BUDGET.maximumInputBytes) {
      return yield* new ApplicationRevisionReadinessCorruptionV1Error({
        revisionId: "unknown",
        detail: "readiness root preimage exceeds the bounded hash budget",
      });
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(ROOT_DOMAIN, offset);
    offset += ROOT_DOMAIN.byteLength;
    offset = writeLengthAndBytes(bytes, offset, labelBytes);
    new DataView(bytes.buffer).setUint32(offset, items.length, false);
    offset += 4;
    for (const item of items) offset = writeLengthAndBytes(bytes, offset, item);
    return yield* hashBytes(bytes);
  },
);

function writeLengthAndBytes(
  output: Uint8Array,
  offset: number,
  value: Uint8Array,
): number {
  new DataView(output.buffer).setUint32(offset, value.byteLength, false);
  output.set(value, offset + 4);
  return offset + 4 + value.byteLength;
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function databaseTimestamp(value: unknown): Date | null {
  const date = copyFiniteDate(value);
  if (date !== undefined) return date;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function runFault<E>(
  context: ApplicationRevisionReadinessContextV1<E>,
  point: "afterVerdictInsert" | "afterAttemptReady",
) {
  return context.faultAfter === undefined
    ? Effect.void
    : Effect.try({
        try: () => context.faultAfter?.(point),
        catch: cause => new ApplicationRevisionReadinessIntegrationV1Error({
          phase: "targetTransaction",
          retryable: true,
          cause,
        }),
      });
}

function query<Row>(query: PromiseLike<ReadonlyArray<Row>>) {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: cause => new ApplicationRevisionReadinessIntegrationV1Error({
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
  target: LocatedApplicationRevisionReadinessTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedTransaction<Value, Failure> {
  let observedCause: Cause.Cause<Failure> | undefined;
  let observedValue: Value | undefined;
  const rollbackSignal = new Error("FSV04 readiness transaction rolled back.");
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
