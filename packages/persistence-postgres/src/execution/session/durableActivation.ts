import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "../../commit/point/promiseBoundary";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionExecutionClaims,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import { deriveTransactionExecutionClaimV1 } from "../claims/transactionExecutionClaimPersistence";
import { readFiniteAttemptAnchorRow } from "../finiteAttemptAnchor";
import { isTerminalTransactionSessionLifecycleV1 } from "../transactionSessionAttemptFacet";
import {
  INITIAL_ATTEMPT_FENCE,
  deriveInitialLeaseExpiry,
  lockPointMutationSessionClock,
  readDatabaseNow,
  requireStableAuthority,
  type LockedPointMutationSessionClockV1,
  type PointMutationSessionAttemptFailureFactoryV1,
} from "./attemptAuthority";
import {
  loadLockedRunningAttempt,
  observePointMutationSessionAttemptFacet,
  runningAttemptKernelContextResult,
} from "./attemptLoad";
import type {
  LocatedPointMutationSessionActivationInputV1,
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./constructionContracts";
import type {
  PointMutationSessionActivationResultV1,
  PreparedStoredMutationSessionActivationV1,
  PreparedStoredMutationSessionEvidenceV1,
} from "./contracts";
import {
  activationError,
  corruptionError,
  projectTransactionSessionActivationResult,
  type PointMutationSessionActivationV1Error,
} from "./errors";
import {
  finiteEntryAttemptContextFromAnchor,
} from "./finiteSession";
import {
  activationResult,
  cloneValidDate,
  nullableBytesEqual,
  nullableJsonEqual,
} from "./inputCapture";
import { bytesEqual } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  SESSION_JOURNAL_FORMAT,
} from "flarex-protocol/commit-protocol";
import {
  FlarexDbV1StorageGenerationSchema,
  SnapshotTokenSchema,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

export async function activateInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const clock = await lockPointMutationSessionClock(
    tx,
    input.prepared.scopeId,
  );
  projectTransactionSessionActivationResult(requireStableAuthority(clock, input));
  return activateAfterLockedClock(tx, input, clock, afterWrite);
}

export async function activateAfterLockedClock(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const matchingSessions = await lockSessionsByRequestKey(tx, input, clock);
  if (matchingSessions.length > 1) {
    throw corruptionError(input.prepared.scopeId, "duplicateRequestAnchors");
  }
  const existing = matchingSessions[0];
  if (existing !== undefined) {
    return replayExistingSession(tx, input.prepared, clock, existing);
  }
  if (clock.record.lastCommitSeq !== input.preliminaryAuthority.lastCommitSeq) {
    throw activationError({ reason: "snapshotCommitSeqChanged" });
  }
  return createSession(
    tx,
    input,
    clock,
    await readDatabaseNow(tx, input.prepared.scopeId),
    afterWrite,
  );
}

export async function replayApplicationSessionIfPresent(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
): Promise<PointMutationSessionActivationResultV1 | null> {
  const matchingSessions = await lockSessionsByRequestKey(tx, input, clock);
  if (matchingSessions.length > 1) {
    throw corruptionError(input.prepared.scopeId, "duplicateRequestAnchors");
  }
  const existing = matchingSessions[0];
  return existing === undefined
    ? null
    : replayExistingSession(tx, input.prepared, clock, existing);
}

function lockSessionsByRequestKey(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
) {
  return tx.select().from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
    eq(fxSystemTransactionSessions.requestKey, input.prepared.evidence.requestKey),
  )).orderBy(asc(fxSystemTransactionSessions.sessionId)).limit(2).for("update");
}

async function createSession(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
  databaseNow: Date,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  if (input.prepared.executionProfile !== "durableOperations") {
    return Promise.reject(activationError({ reason: "invalidPreparedEvidence" }));
  }
  const evidence = input.prepared.evidence;
  const hardExpiresAt = cloneValidDate(evidence.authorizationGrantExpiresAt);
  const leaseExpiresAt = projectTransactionSessionActivationResult(deriveInitialLeaseExpiry(
    databaseNow,
    hardExpiresAt,
    input.leaseDurationMilliseconds,
  ));
  const sessionRow = {
      executionProfile: "durableOperations" as const, finiteAttemptBytes: null, finiteAttemptSha256: null,
      finiteSnapshotEpochUuid: null, finiteSnapshotCommitSeq: null, finiteMetadataWatermark: null,
      finiteLeaseExpiresAt: null, finiteClaimOwner: null, finiteClaimFence: null, finiteClaimedAt: null, finiteClaimExpiresAt: null,
      scopeUuid: clock.scopeUuid,
      sessionId: input.candidateSessionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.record.storageGenerationFence,
      ...evidence,
      lifecycle: "running",
      attemptFence: INITIAL_ATTEMPT_FENCE,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      hardExpiresAt,
      createdAt: databaseNow,
      updatedAt: databaseNow,
    } satisfies typeof fxSystemTransactionSessions.$inferSelect;
  const inserted = await tx
    .insert(fxSystemTransactionSessions)
    .values(sessionRow)
    .onConflictDoNothing({
      target: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
      ],
    })
    .returning({ sessionId: fxSystemTransactionSessions.sessionId });
  if (inserted[0] === undefined) {
    throw activationError({ reason: "sessionIdCollision" });
  }
  await afterWrite?.("sessionInserted");

  const leaseRow = {
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: clock.record.lastCommitSeq,
    metadataWatermark: null, finiteMetadataReservationBytes: null, finiteMetadataReservationSha256: null,
    leaseExpiresAt,
  } satisfies typeof fxSystemSnapshotLeases.$inferSelect;
  await tx.insert(fxSystemSnapshotLeases).values(leaseRow);
  await afterWrite?.("leaseInserted");

  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (databaseNowMilliseconds === undefined) {
    throw corruptionError(input.prepared.scopeId, "databaseClockInvalid");
  }
  const creationTimeSeed = decodeAppCreationTimeV1(databaseNowMilliseconds);
  const journalRow = {
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    journalFormat: SESSION_JOURNAL_FORMAT,
    executionProfile: input.prepared.executionProfile,
    state: "open",
    lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n),
    receiptEvidenceBytes: 0,
    participantWorkBytes: 0,
    participantWorkCalls: 0,
    creationTimeSeed,
    nextCreationTime: creationTimeSeed,
    readDocuments: 0,
    readSemanticBytes: 0,
    pointDependencyCount: 0,
    indexedQuerySyscalls: 0,
    indexRangeDependencyCount: 0,
    indexRangeDependencyEvidenceBytes: 0,
    relationReadSyscalls: 0,
    relationDependencyCount: 0,
    relationBaseOccurrences: 0,
    writeOperations: 0,
    writeSemanticBytes: 0,
    materialWriteEventEvidenceBytes:
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
    createdAt: databaseNow,
    updatedAt: databaseNow,
    failureDimension: null, sealedJournalBytes: null, sealedJournalSha256: null,
    sealedResultValueCodecVersion: null, sealedResultSemanticBytes: null, sealedResultBytes: null,
    sealedResultSha256: null, sealedAt: null,
  } satisfies typeof fxSystemTransactionJournals.$inferSelect;
  await tx.insert(fxSystemTransactionJournals).values(journalRow);
  await afterWrite?.("journalRootInserted");

  const executionClaim = deriveTransactionExecutionClaimV1({
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    claimFence: 1n,
    claimOwner: input.executionClaimOwner,
    databaseNow,
    durationMilliseconds: input.executionClaimDurationMilliseconds,
    leaseExpiresAt,
    authorizationGrantExpiresAt: evidence.authorizationGrantExpiresAt,
    hardExpiresAt,
  });
  const claimRow = Result.match(executionClaim, {
    onSuccess: (claim) => claim,
    onFailure: (failure) => {
      throw failure === "authorityExpired"
        ? activationError({ reason: "authorizationGrantExpired" })
        : corruptionError(input.prepared.scopeId, "sessionRecordInvalid");
    },
  });
  await tx.insert(fxSystemTransactionExecutionClaims).values(
    claimRow,
  );
  await afterWrite?.("executionClaimInserted");

  return activationResult("created", {
    deploymentId: input.prepared.deploymentId,
    scopeId: input.prepared.scopeId,
    sessionId: input.candidateSessionId,
    requestKey: evidence.requestKey,
    executionProfile: input.prepared.executionProfile,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: clock.record.storageGenerationFence,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotToken: SnapshotTokenSchema.make({
      scopeId: input.prepared.scopeId,
      epoch: clock.record.epoch,
      commitSeq: clock.record.lastCommitSeq,
    }),
    hardExpiresAt: hardExpiresAt.toISOString(),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    createdAt: databaseNow.toISOString(),
    updatedAt: databaseNow.toISOString(),
  }, Object.freeze({
    claimOwner: claimRow.claimOwner,
    claimFence: claimRow.claimFence,
    claimedAt: claimRow.claimedAt.toISOString(),
    claimExpiresAt: claimRow.claimExpiresAt.toISOString(),
  }));
}

export async function replayExistingSession(
  tx: AppRowTransaction,
  prepared: PreparedStoredMutationSessionActivationV1,
  clock: LockedPointMutationSessionClockV1,
  session: typeof fxSystemTransactionSessions.$inferSelect,
  acceptedDatabaseNow?: Date,
): Promise<PointMutationSessionActivationResultV1> {
  if (!sessionEvidenceMatches(session, prepared.evidence)) {
    throw activationError({ reason: "requestKeyConflict" });
  }
  if (session.executionProfile === "finiteRoot") {
    if (prepared.executionProfile !== "finiteRoot") {
      return Promise.reject(activationError({ reason: "requestKeyConflict" }));
    }
    const anchor = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(readFiniteAttemptAnchorRow(session).pipe(
      Effect.mapError(cause => corruptionError(prepared.scopeId, "sessionRecordInvalid", cause)))));
    const databaseNow = acceptedDatabaseNow ?? await readDatabaseNow(tx, prepared.scopeId);
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(finiteEntryAttemptContextFromAnchor(anchor, prepared.deploymentId, clock.record, databaseNow)));
    return activationResult("busy", context.anchor);
  }
  const loaded = await loadLockedRunningAttempt(
    tx,
    {
      deploymentId: prepared.deploymentId,
      scopeId: prepared.scopeId,
      failures: activationAttemptFailures,
      afterLeaseLock: undefined,
      claimRequirement: "present",
    },
    clock,
    session,
  );
  await observePointMutationSessionAttemptFacet(
    tx, loaded.clock, loaded.session, loaded.locked, loaded.journalRoot,
  );
  const context = projectTransactionSessionActivationResult(runningAttemptKernelContextResult(loaded));
  if (context.anchor.executionProfile !== prepared.executionProfile) {
    return Promise.reject(activationError({ reason: "requestKeyConflict" }));
  }
  return activationResult("busy", context.anchor);
}

const activationAttemptFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    activationError({ reason: "terminalRequest", lifecycle }),
  unsupportedStorageGeneration: () =>
    activationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    activationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    activationError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => activationError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    activationError({ reason: "activeAttemptExpired" }),
  executionClaimUnavailable: () =>
    activationError({ reason: "executionClaimUnavailable" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1<
  PointMutationSessionActivationV1Error
>);

function sessionEvidenceMatches(
  session: typeof fxSystemTransactionSessions.$inferSelect,
  expected: PreparedStoredMutationSessionEvidenceV1,
): boolean {
  const terminal = isTerminalTransactionSessionLifecycleV1(session.lifecycle);
  const logicalEvidenceMatches = session.executionAuthorityGeneration ===
      expected.executionAuthorityGeneration &&
    (terminal || (nullableJsonEqual(
      session.applicationExecutionAuthorityJson,
      expected.applicationExecutionAuthorityJson,
    ) && nullableBytesEqual(
      session.applicationExecutionAuthorityCanonicalBytes,
      expected.applicationExecutionAuthorityCanonicalBytes,
    ))) &&
    nullableBytesEqual(
      session.applicationExecutionAuthoritySha256,
      expected.applicationExecutionAuthoritySha256,
    ) &&
    session.packageId === expected.packageId &&
    session.artifactRuntime === expected.artifactRuntime &&
    session.artifactId === expected.artifactId &&
    session.sourcePackageHash === expected.sourcePackageHash &&
    session.executionModule === expected.executionModule &&
    session.functionPath === expected.functionPath &&
    session.functionKind === expected.functionKind &&
    session.schemaVersionId === expected.schemaVersionId &&
    session.policyVersion === expected.policyVersion &&
    bytesEqual(
      session.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) &&
    (terminal || nullableJsonEqual(session.validatedArgsJson, expected.validatedArgsJson)) &&
    session.validatedArgsValueCodecVersion ===
      expected.validatedArgsValueCodecVersion &&
    (terminal || nullableBytesEqual(
      session.validatedArgsCanonicalBytes,
      expected.validatedArgsCanonicalBytes,
    )) &&
    bytesEqual(session.validatedArgsSha256, expected.validatedArgsSha256) &&
    session.authorizationRevocationEpoch ===
      expected.authorizationRevocationEpoch &&
    session.requestKey === expected.requestKey &&
    bytesEqual(session.requestSha256, expected.requestSha256);
  if (!logicalEvidenceMatches) return false;
  // Application admission has already authenticated the fresh grant against
  // every logical pin above. Retain the first stored grant as execution
  // authority so a newly signed retry of the same request is busy/replay, not
  // a false request-key conflict. Legacy callers still replay exact grant
  // evidence because their external preparation contract reuses that grant.
  if (expected.executionAuthorityGeneration === "application_v1") return true;
  const actualGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const expectedGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    expected.authorizationGrantExpiresAt,
  );
  return (
    session.authorizationGrantId === expected.authorizationGrantId &&
    (terminal || nullableJsonEqual(
      session.authorizationGrantJson,
      expected.authorizationGrantJson,
    )) &&
    session.authorizationGrantValueCodecVersion ===
      expected.authorizationGrantValueCodecVersion &&
    (terminal || nullableBytesEqual(
      session.authorizationGrantCanonicalBytes,
      expected.authorizationGrantCanonicalBytes,
    )) &&
    bytesEqual(
      session.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) &&
    actualGrantExpiresAtMilliseconds !== undefined &&
    actualGrantExpiresAtMilliseconds === expectedGrantExpiresAtMilliseconds
  );
}
