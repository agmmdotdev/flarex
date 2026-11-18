import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
} from "../../commit/point/promiseBoundary";
import {
  fxSystemScopeClocks,
  fxSystemTransactionJournalIndexRanges,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalRelationIncomingDependencies,
  fxSystemTransactionJournalWriteEvents,
  type fxSystemTransactionExecutionClaims,
  type fxSystemTransactionJournals,
} from "../../database/schema";
import {
  TrustedScopeAuthorityPortError,
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import {
  openFiniteExecutionAuthorityObservation,
  readFiniteExecutionAuthorityObservation,
} from "../../scope/scopeClock";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "../claims/transactionExecutionClaimErrors";
import type {
  TransactionExecutionClaimObservationV1,
} from "../claims/transactionExecutionClaimModel";
import {
  inspectTransactionExecutionClaimV1Result,
  requireLiveTransactionExecutionClaimV1Result,
} from "../claims/transactionExecutionClaimPersistence";
import { readRunningAttemptTail, type RunningAttemptTailIssue } from "../exactRunningAttemptTail";
import { lockFiniteAttemptAnchorInTransaction } from "../finiteAttemptAnchor";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from "../transactionSessionAttemptFacet";
import {
  databaseNowFromEpochMilliseconds,
  lockExactPointMutationSession,
  lockPointMutationSessionAttemptStructure,
  lockPointMutationSessionClock,
  lockPointMutationSessionClockForShare,
  readDatabaseNow,
  requireStableAttemptLoadAuthority,
  type LockedPointMutationSessionAttemptLoadV1,
  type LockedPointMutationSessionAttemptStructureV1,
  type LockedPointMutationSessionClockV1,
  type PointMutationSessionAttemptFailureFactoryV1,
  type PointMutationSessionExactSessionFailureFactoryV1,
} from "./attemptAuthority";
import {
  LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  requireAttemptLoadTarget,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type LocatedPointMutationSessionAttemptLoadInputV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "./constructionContracts";
import type {
  CheckedTransactionSessionRow,
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptFacetObservationV1,
  PointMutationSessionAttemptLoadPersistenceV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
} from "./contracts";
import {
  PointMutationSessionAttemptLoadPersistenceV1Error,
  attemptLoadError,
  corruptionError,
  projectTransactionSessionActivationResult,
  type PointMutationSessionAttemptLoadEffectErrorV1,
  type PointMutationSessionAttemptLoadV1Error,
  type PointMutationSessionAuthorityCorruptionV1Error,
} from "./errors";
import {
  finiteEntryAttemptContextFromAnchor,
  seedFiniteEntryLeaseExpectation,
} from "./finiteSession";
import {
  captureAttemptSelector,
  captureSessionAnchor,
  decodeCheckedSchemaVersionIdResult,
} from "./inputCapture";
import type {
  ExactRunningAttemptKernelContextV1,
  ExactRunningAttemptKernelInputV1,
} from "./kernelContracts";
import { encodeBytesToLowercaseHex, isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  FlarexDbV1StorageGenerationSchema,
  SnapshotTokenSchema,
  type ReplacementScopeIdV1,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type { TransactionSessionLifecycleV1 } from "flarex-protocol/transaction-session";

export function createPointMutationSessionAttemptLoadPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptLoadPersistenceV1 {
  const loadEffect = Effect.fn(
    function* (
      input: PointMutationSessionAttemptSelectorV1,
    ): Effect.fn.Return<
      PointMutationSessionAttemptLoadResultV1,
      PointMutationSessionAttemptLoadEffectErrorV1
    > {
      const selector = yield* Effect.fromResult(captureAttemptSelector(input));
      const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
        { deploymentId: selector.deploymentId, scopeId: selector.scopeId },
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapAttemptLoadAuthorityError));
      if (located.authority.scopeId !== selector.scopeId) {
        return yield* Effect.fail(
          attemptLoadError({ reason: "selectorScopeMismatch" }),
        );
      }
      const target = yield* Effect.fromResult(
        requireAttemptLoadTarget(located.target, selector.scopeId),
      );
      return yield* target[LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]({
        selector,
        preliminaryAuthority: located.authority,
      });
    },
  );

  return Object.freeze({ loadEffect });
}

export async function loadAttemptInTransaction(
  tx: AppRowTransaction,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
): Promise<PointMutationSessionAttemptLoadResultV1> {
  const clock = await lockPointMutationSessionClock(tx, input.selector.scopeId);
  await afterLoadLock?.("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptLoadAuthority(clock, input));
  const session = await lockExactPointMutationSession(tx, input.selector, clock, attemptLoadExactSessionFailures, afterLoadLock);
  if (session.executionProfile === "finiteRoot") {
    const finiteAttempt = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(lockFiniteAttemptAnchorInTransaction(tx, input.selector).pipe(
      Effect.mapError(cause => corruptionError(input.selector.scopeId, "sessionRecordInvalid", cause)))));
    if (finiteAttempt.session.lifecycle !== "running") throw attemptLoadFailures.terminal(finiteAttempt.session.lifecycle);
    const databaseNow = await readDatabaseNow(tx, input.selector.scopeId);
    const context = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(finiteEntryAttemptContextFromAnchor(finiteAttempt, input.selector.deploymentId, clock.record, databaseNow)));
    // A recovered finite root has no retained callback graph. This observation
    // cannot authorize execution; outcome resolution and fencing must come first.
    return Object.freeze({ status: "loaded", lastMetadataSequence: clock.record.lastMetadataSequence,
      anchor: captureSessionAnchor(context.anchor), executionPin: context.executionPin, attemptFacet: { kind: "nonPristine" as const } });
  }
  const loaded = await loadLockedRunningAttempt(tx, {
    deploymentId: input.selector.deploymentId,
    scopeId: input.selector.scopeId,
    failures: attemptLoadFailures,
    afterLeaseLock: afterLoadLock,
    claimRequirement: "live",
  }, clock, session);
  const attemptFacet = await observePointMutationSessionAttemptFacet(
    tx, loaded.clock, loaded.session, loaded.locked, loaded.journalRoot,
  );
  return attemptLoadResult(projectTransactionSessionActivationResult(runningAttemptKernelContextResult(loaded)), attemptFacet);
}

export async function lockExactRunningAttemptInTransaction(
  tx: AppRowTransaction,
  input:
    | ExactRunningAttemptKernelInputV1
    | LocatedPointMutationSessionAttemptLoadInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
  clockProtection: "share" | "attempt",
  observedClock?: LockedPointMutationSessionClockV1,
): Promise<LockedRunningPointMutationSessionAttemptV1> {
  const selector = input.selector;
  const clock = observedClock ?? (clockProtection === "share"
    ? await lockPointMutationSessionClockForShare(tx, selector.scopeId)
    : await lockPointMutationSessionClock(tx, selector.scopeId));
  await afterLoadLock?.("clockLocked");
  projectTransactionSessionActivationResult(requireStableAttemptLoadAuthority(clock, input));
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptLoadExactSessionFailures,
    afterLoadLock,
  );

  return loadLockedRunningAttempt(
    tx,
    {
      deploymentId: selector.deploymentId,
      scopeId: selector.scopeId,
      failures: attemptLoadFailures,
      afterLeaseLock: afterLoadLock,
      claimRequirement: "live",
      ...(!("executionClaim" in input) || input.executionClaim === undefined
        ? {}
        : { executionClaim: input.executionClaim }),
    },
    clock,
    session,
  );
}

export interface LockedRunningPointMutationSessionAttemptV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly clock: LockedPointMutationSessionClockV1;
  readonly session: CheckedTransactionSessionRow;
  readonly locked: Extract<
    LockedPointMutationSessionAttemptStructureV1,
    { readonly leaseState: "present" }
  >;
  readonly journalRoot: typeof fxSystemTransactionJournals.$inferSelect;
  readonly executionClaim: TransactionExecutionClaimObservationV1;
  readonly authorizationGrantExpiresAtMilliseconds: number;
  readonly hardExpiresAtMilliseconds: number;
  readonly databaseNow: Date;
}

export async function loadLockedRunningAttempt<Failure extends Error>(
  tx: AppRowTransaction,
  input: LockedPointMutationSessionAttemptLoadV1<Failure>,
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
): Promise<LockedRunningPointMutationSessionAttemptV1> {
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    { ...input, authorityProfile: "liveExecution" },
    clock,
    session,
    "requireRetainedSnapshot",
  );
  if (session.lifecycle !== "running") {
    throw input.failures.terminal(session.lifecycle);
  }
  if (locked.leaseState === "absent") {
    throw corruptionError(input.scopeId, "snapshotLeaseMissing");
  }

  const tail = projectTransactionSessionActivationResult(
    (await readRunningAttemptTail(tx, {
      scopeId: input.scopeId,
      scopeUuid: clock.scopeUuid,
      sessionId: locked.sessionId,
      attemptFence: locked.attemptFence,
    })).pipe(Result.mapError(issue => runningAttemptTailError(input.scopeId, issue))),
  );
  await input.afterLeaseLock?.("attemptTailLocked");
  const journalRoot = tail.journalRoot;
  const claim = tail.executionClaim;
  const databaseNow = databaseNowFromEpochMilliseconds(input.scopeId, tail.databaseNowEpochMilliseconds);
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }
  if (
    journalRoot.state === "sealed" &&
    locked.leaseExpiresAtMilliseconds !== Math.min(
      authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds,
    )
  ) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    locked.leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw input.failures.activeAttemptExpired();
  }
  const executionClaim = projectTransactionSessionActivationResult(
    validateLockedRunningAttemptExecutionClaimResult(
      input,
      claim,
      databaseNow,
      databaseNowMilliseconds,
    ),
  );
  return {
    deploymentId: input.deploymentId,
    scopeId: input.scopeId,
    clock,
    session,
    locked,
    journalRoot,
    executionClaim,
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    databaseNow,
  };
}

function runningAttemptTailError(scopeId: ScopeId, issue: RunningAttemptTailIssue):
  PointMutationSessionAuthorityCorruptionV1Error | TransactionExecutionClaimCorruptionV1Error {
  switch (issue.reason) {
    case "journalRootMissing": return corruptionError(scopeId, "activeJournalRootMissing");
    case "journalRootInvalid": return corruptionError(scopeId, "journalRootInvalid", issue.cause);
    case "executionClaimMissingOrDuplicate": return new TransactionExecutionClaimCorruptionV1Error({
      scopeId, reason: "claimMissingOrDuplicate",
    });
    case "databaseClockInvalid": return corruptionError(scopeId, "databaseClockInvalid");
  }
}

export function runningAttemptKernelContextResult(
  loaded: LockedRunningPointMutationSessionAttemptV1,
  tx?: AppRowTransaction,
): Result.Result<ExactRunningAttemptKernelContextV1, PointMutationSessionAuthorityCorruptionV1Error> {
  const { clock, session, locked, journalRoot } = loaded;
  if (tx !== undefined && journalRoot.executionProfile === "finiteRoot") {
    seedFiniteEntryLeaseExpectation(tx, locked.lease);
    if (readFiniteExecutionAuthorityObservation(tx, clock.record.scopeId) === undefined)
      openFiniteExecutionAuthorityObservation(tx, { scopeId: clock.record.scopeId, scopeUuid: clock.scopeUuid,
        storageGeneration: clock.record.storageGeneration, storageGenerationFence: clock.record.storageGenerationFence,
        epoch: clock.record.epoch, epochUuid: clock.epochUuid, oldestAvailableCommitSeq: clock.record.oldestAvailableCommitSeq,
        authorizationRevocationEpoch: clock.authorizationRevocationEpoch }, { sessionId: session.sessionId,
          attemptFence: locked.attemptFence, snapshotToken: SnapshotTokenSchema.make({ scopeId: loaded.scopeId,
            epoch: locked.snapshotEpoch, commitSeq: locked.snapshotCommitSeq }) });
  }
  const finiteAuthority = tx === undefined ? undefined : readFiniteExecutionAuthorityObservation(tx, loaded.scopeId);
  return decodeCheckedSchemaVersionIdResult(session.schemaVersionId).pipe(
    Result.mapError(cause => corruptionError(loaded.scopeId, "sessionRecordInvalid", cause)),
    Result.flatMap(schemaVersionId => !isUint8ArrayWithByteLength(session.identityAccessPolicySha256, 32)
      ? Result.fail(corruptionError(loaded.scopeId, "sessionRecordInvalid"))
      : Result.succeed(Object.freeze({
      scopeUuid: clock.scopeUuid,
      snapshotLease: Object.freeze({ ...locked.lease }),
      ...(finiteAuthority === undefined ? {} : { finiteAuthority }),
      scopeClock: Object.freeze({
        ...clock.record,
        updatedAt: new Date(clock.record.updatedAt.getTime()),
      }),
      anchor: Object.freeze({
        deploymentId: loaded.deploymentId,
        scopeId: loaded.scopeId,
        sessionId: locked.sessionId,
        requestKey: session.requestKey,
        executionProfile: journalRoot.executionProfile,
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: locked.storageGenerationFence,
        attemptFence: locked.attemptFence,
        snapshotToken: SnapshotTokenSchema.make({
          scopeId: loaded.scopeId,
          epoch: locked.snapshotEpoch,
          commitSeq: locked.snapshotCommitSeq,
        }),
        hardExpiresAt: session.hardExpiresAt.toISOString(),
        leaseExpiresAt: locked.lease.leaseExpiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      } satisfies PointMutationSessionAnchorV1),
      executionPin: Object.freeze({ schemaVersionId, functionPath: session.functionPath, functionKind: session.functionKind, executionModule: session.executionModule }),
      executionAuthorityGeneration: session.executionAuthorityGeneration,
      principalDigest: encodeBytesToLowercaseHex(session.identityAccessPolicySha256),
      authorizationGrantExpiresAtMilliseconds:
        loaded.authorizationGrantExpiresAtMilliseconds,
      hardExpiresAtMilliseconds: loaded.hardExpiresAtMilliseconds,
      databaseNow: loaded.databaseNow,
      journalRoot: Object.freeze({ ...journalRoot }),
      executionClaim: loaded.executionClaim,
      } satisfies ExactRunningAttemptKernelContextV1))),
  );
}

function validateLockedRunningAttemptExecutionClaimResult<
  Failure extends Error,
>(
  input: LockedPointMutationSessionAttemptLoadV1<Failure>,
  claim: typeof fxSystemTransactionExecutionClaims.$inferSelect,
  databaseNow: Date,
  databaseNowMilliseconds: number,
): Result.Result<
  TransactionExecutionClaimObservationV1,
  Failure | PointMutationSessionAuthorityCorruptionV1Error
> {
  const inspected = input.claimRequirement === "live"
    ? requireLiveTransactionExecutionClaimV1Result(
        input.scopeId,
        claim,
        input.executionClaim,
        databaseNow,
      )
    : inspectTransactionExecutionClaimV1Result(input.scopeId, claim);
  return inspected.pipe(
    Result.flatMap((observation) =>
      input.claimRequirement === "present" &&
        Date.parse(observation.claimedAt) > databaseNowMilliseconds
        ? Result.fail(new TransactionExecutionClaimCorruptionV1Error({
            scopeId: input.scopeId,
            reason: "claimEvidenceInvalid",
          }))
        : Result.succeed(observation)
    ),
    Result.mapError((cause) =>
      cause instanceof TransactionExecutionClaimStaleV1Error
        ? input.failures.executionClaimUnavailable()
        : corruptionError(
            input.scopeId,
            "executionClaimInvalid",
            cause,
          )
    ),
  );
}

export async function observePointMutationSessionAttemptFacet(
  tx: FlarexMetadataDatabase,
  clock: LockedPointMutationSessionClockV1,
  session: CheckedTransactionSessionRow,
  locked: Extract<
    LockedPointMutationSessionAttemptStructureV1,
    { readonly leaseState: "present" }
  >,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Promise<PointMutationSessionAttemptFacetObservationV1> {
  const sessionUpdatedAtMilliseconds = finiteDateMilliseconds(
    session.updatedAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    sessionUpdatedAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined
  ) {
    throw corruptionError(clock.record.scopeId, "sessionRecordInvalid");
  }
  const expectedFacet = buildFreshTransactionAttemptFacetV1({
    scopeUuid: clock.scopeUuid,
    sessionId: locked.sessionId,
    attemptFence: locked.attemptFence,
    executionProfile: root.executionProfile,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: locked.snapshotCommitSeq,
    databaseNowMilliseconds: sessionUpdatedAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    leaseDurationMilliseconds:
      locked.leaseExpiresAtMilliseconds - sessionUpdatedAtMilliseconds,
  });
  if (
    Result.isFailure(expectedFacet) ||
    !isPristineFreshTransactionAttemptJournalRootV1(
      root,
      expectedFacet.success.journalRoot,
    )
  ) {
    return Object.freeze({ kind: "nonPristine" });
  }

  const rows = await tx.select({
    receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalReceipts}
      where ${fxSystemTransactionJournalReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalReceipts.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalReceipts.attemptFence} =
          ${locked.attemptFence}
    )`,
    pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} = ${locked.sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} =
          ${locked.attemptFence}
    )`,
    indexRangeExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalIndexRanges}
      where ${fxSystemTransactionJournalIndexRanges.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalIndexRanges.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalIndexRanges.attemptFence} =
          ${locked.attemptFence}
    )`,
    relationDependencyExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalRelationIncomingDependencies}
      where ${fxSystemTransactionJournalRelationIncomingDependencies.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalRelationIncomingDependencies.attemptFence} =
          ${locked.attemptFence}
    )`,
    eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${locked.attemptFence}
    )`,
  }).from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeUuid,
    clock.scopeUuid,
  )).limit(1);
  const observation = rows[0];
  if (
    rows.length !== 1 ||
    observation === undefined ||
    typeof observation.receiptExists !== "boolean" ||
    typeof observation.pointExists !== "boolean" ||
    typeof observation.indexRangeExists !== "boolean" ||
    typeof observation.relationDependencyExists !== "boolean" ||
    typeof observation.eventExists !== "boolean"
  ) {
    throw corruptionError(clock.record.scopeId, "journalRootInvalid");
  }
  return Object.freeze({
    kind: observation.receiptExists ||
        observation.pointExists ||
        observation.indexRangeExists ||
        observation.relationDependencyExists ||
        observation.eventExists
      ? "nonPristine"
      : "pristineOpen",
  });
}

const attemptLoadFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    attemptLoadError({ reason: "attemptNotRunning", lifecycle }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptLoadError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    attemptLoadError({ reason: "activeAttemptExpired" }),
  executionClaimUnavailable: () =>
    attemptLoadError({ reason: "executionClaimUnavailable" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1<
  PointMutationSessionAttemptLoadV1Error
>);

const attemptLoadExactSessionFailures = Object.freeze({
  sessionMissing: () => attemptLoadError({ reason: "sessionMissing" }),
  staleAttemptFence: () => attemptLoadError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

function mapAttemptLoadAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptLoadPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptLoadPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function attemptLoadResult(
  loaded: ExactRunningAttemptKernelContextV1,
  attemptFacet: PointMutationSessionAttemptFacetObservationV1,
): PointMutationSessionAttemptLoadResultV1 {
  return Object.freeze({
    status: "loaded",
    lastMetadataSequence: loaded.scopeClock.lastMetadataSequence,
    anchor: captureSessionAnchor(loaded.anchor),
    executionPin: Object.freeze({
      ...loaded.executionPin,
    }),
    attemptFacet: Object.freeze({ kind: attemptFacet.kind }),
  });
}
