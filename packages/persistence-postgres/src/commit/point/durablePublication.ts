import {
  and,
  eq,
} from "drizzle-orm";
import {
  Effect,
  Exit,
  Result,
} from "effect";
import {
  type CommitSeq,
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";
import { validateApplicationWriteOwnershipForCommit } from "../../application/ownership/Commit";
import { hasApplicationRelationCommitAuthorityForPointCommit } from "../../application/relations/applicationRelationCommit";
import { type StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../authority/postgresLoader";
import {
  type CommittedPointOutcomeResolutionV1,
  type CommittedPointOutcomeTokenV1,
  createCommittedPointOutcomeResolverV1,
  type ResolveCommittedPointOutcomeInputV1,
} from "../committedPointOutcome";
import {
  CommittedPointOutcomeSqlErrorV1,
  type ResolveCommittedPointOutcomeErrorV1,
} from "../committedPointOutcomeErrors";
import { commitEventsDigest } from "../events/digest";
import {
  inspectCommittedOutcomeInTransaction,
  lockPointCommitClock,
  lockPointCommitJournalRoot,
  lockPointCommitLease,
  lockPointCommitSession,
  preliminaryAuthorityFailure,
  preparedApplicationRelationsForFiniteCommit,
  requireAttemptIsLiveResult,
  requireFinitePointCommitReservation,
  requireLockedClockAuthorityResult,
  resolvePointCommitAuthority,
  validateActiveApplicationSchemaForPointCommit,
  validateActiveRelationSelectionForPointCommit,
} from "./attemptAcceptance";
import { captureCommittedOutcomeLookup } from "./capture";
import { type PointCommitTransactionProofOptionsV1 } from "./constructionContracts";
import {
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitPublicationResultV1,
  type PointCommitPublisherPortV1,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
} from "./contracts";
import {
  AppDocumentInsertionConflictError,
  corruption,
  PointCommitConflictV1Error,
  type PointCommitCorruptionV1Error,
  type PointCommitDecisionUncertainV1Error,
  type PointCommitPublicationV1Error,
} from "./errors";
import {
  type PointCommitKernelResultV1,
  type PointCommitPublicationDecisionV1,
  type PointCommitPublicationRunDecisionV1,
} from "./lockedState";
import {
  lowerAcceptedPointCommit,
  requirePointCommitReadyForPublicationResult,
} from "./lowering";
import {
  observePointCommitPublicationEffect,
  observePointCommitPublicationPromise,
} from "./observation";
import {
  findPointCommitIndexRangeConflict,
  findPointCommitRelationConflict,
} from "./occ";
import { validateAdmittedParticipantOperations } from "./participantProof";
import {
  preparePointCommitMixedDefinitions,
  preparePointCommitPublicationCommand,
} from "./preparation";
import {
  type PointCommitTransactionModeV1,
  type PreparedPointCommitPublicationCommandV1,
  type PreparedPointCommitTransactionCommandV1,
} from "./preparedCommands";
import {
  projectPointCommitTransactionResult,
  runPointCommitInTransactionEffect,
  runPointCommitPromiseEffect,
} from "./promiseBoundary";
import {
  decisionUncertain,
  mapPublicationTransactionFailure,
  PointCommitSqlFailureMarkerV1,
  type PointCommitTransactionDecisionUncertainV1Error,
  sqlCall,
} from "./sqlFailures";
import {
  advanceScopePublicationClock,
  readPointCommitDatabaseTime,
  reproveScopePublicationPrefix,
  writeScopePublicationPrefix,
} from "../publication/pointCommitProjection";
import { type ScopePublicationContribution } from "../publication/scopePublicationModel";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "../../database/schema";
import { captureExecutionDiagnosticContext } from "../../execution/diagnostics/operation";
import { validateConsumedMetadataDependencies } from "../../execution/finiteMetadataDependencies";
import {
  isLocatedPointCommitPublicationTargetV1,
  type LocatedPointCommitPublicationTargetV1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
} from "../../execution/session/kernelContracts";
import {
  type LocatedReadCommittedAttemptTargetV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import { type TrustedScopeAuthority } from "../../scope/scopeAuthorityResolution";
import { closeExactAttemptScopeClockObservation } from "../../scope/scopeClock";
import { hasAppSchemaCandidateWriteGuardComposition } from "../../storage/catalog/appSchemaCandidateValidation";
import { type AppRowTransaction } from "../../storage/documents/appRows";
import { type LocatedAppIndexDefinitionV1 } from "../../storage/indexes/appIndexDefinitions";
import {
  emitTransactionStep,
  loadApplicationDocumentPriorState,
  loadPointCommitHeads,
  lockPointCommitDeveloperIndexBuilds,
  lockPointCommitIntrinsicIndexBuilds,
  prepareApplicationRelationDefinitions,
  prepareCandidateSchemaWriteGuard,
  prepareIntrinsicIndexDefinitions,
  validatePointCommitDependenciesResult,
} from "../../storage/materialization/materialization";
import {
  type LoadedPointCommitHeadV1,
  type PointCommitDependencyV1,
  type PreparedPointCommitApplicationRelations,
  type PreparedPointCommitCandidateSchemaWriteGuard,
} from "../../storage/materialization/model";
import { captureOriginalApplicationPublicationBuildLocks } from "../../storage/materialization/originalBuildLocks";
import { acceptApplicationPublication } from "../../storage/materialization/publicationAcceptance";
import { prepareApplicationDocumentSettlementFromOriginalsEffect } from "../../storage/materialization/settlementPlan";
import { type LocatedAppUniqueConstraintDefinitionV1 } from "../../storage/unique/appUniqueConstraintDefinitions";

export function awaitPointCommitPublicationSettlement<Decision>(
  transaction: Promise<Decision>,
): Effect.Effect<
  Decision,
  PointCommitPublicationV1Error |
  PointCommitTransactionDecisionUncertainV1Error
> {
  return Effect.uninterruptibleMask((restore) =>
    restore(runPointCommitPromiseEffect(() => transaction, mapPublicationTransactionFailure)).pipe(
      Effect.onInterrupt(() =>
        // oxlint-disable-next-line flarex/no-unreviewed-effect-promise -- REVIEW: lifecycle - interrupt drain maps fulfillment and rejection to void so the waiter cannot reject
        Effect.promise(() =>
          transaction.then(
            () => undefined,
            () => undefined,
          )
        )),
    )
  );
}

export async function runPointCommitPublication(
  target: LocatedPointCommitPublicationTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitPublicationCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
  diagnosticContext: ReturnType<typeof captureExecutionDiagnosticContext>,
): Promise<PointCommitPublicationDecisionV1> {
  return observePointCommitPublicationPromise(options.publicationObservation, "transaction", () =>
    target[RUN_LOCATED_READ_COMMITTED_V1](async (tx) => {
      try {
        const kernel = await runPointCommitTransactionKernel(
          tx,
          target,
          preliminaryAuthority,
          command,
          intrinsicDefinitions,
          developerDefinitions,
          uniqueDefinitions,
          applicationRelations,
          candidateSchemaWriteGuard,
          options,
          "publish",
          diagnosticContext,
        );
        if (kernel.kind === "existing") return kernel;
        const ready = projectPointCommitTransactionResult(
          requirePointCommitReadyForPublicationResult(kernel),
        );
        await observePointCommitPublicationPromise(options.publicationObservation, "durablePublication", () => publishPointCommitInTransaction(
          tx,
          command,
          ready,
          options,
        ));
        await emitTransactionStep(options, command, "beforeCommit");
        return Object.freeze({
          kind: "published",
          token: Object.freeze({
            scopeUuid: ready.clock.scopeUuid,
            epochUuid: ready.clock.epochUuid,
            commitSeq: ready.commitSeq,
          }),
        });
      } finally { closeExactAttemptScopeClockObservation(tx); }
    }));
}

export async function runPointCommitTransactionKernel(
  tx: AppRowTransaction,
  target: LocatedReadCommittedAttemptTargetV1,
  preliminaryAuthority: TrustedScopeAuthority,
  command: PreparedPointCommitTransactionCommandV1,
  intrinsicDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  developerDefinitions: ReadonlyArray<LocatedAppIndexDefinitionV1>,
  uniqueDefinitions: ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1>,
  applicationRelations: PreparedPointCommitApplicationRelations | null,
  candidateSchemaWriteGuard:
    PreparedPointCommitCandidateSchemaWriteGuard | null,
  options: PointCommitTransactionProofOptionsV1,
  mode: PointCommitTransactionModeV1,
  diagnosticContext: ReturnType<typeof captureExecutionDiagnosticContext>,
): Promise<PointCommitKernelResultV1> {
  // Only lifecycle-stable metadata may be read before publication exclusion.
  // Session/build locks stay below the upgrade: their other owners are clock-first.
  const admissionClock = await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => lockPointCommitClock(
    tx, command, options, "key share",
  ));
  await emitTransactionStep(options, command, "lifecycleProtected");
  if (
    mode === "publish" &&
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
      // The shared resolver captures the outcome and its ceiling in one query.
      // admissionClock may precede a concurrent duplicate's publication.
      createCommittedPointOutcomeResolverV1(tx).resolve(
        captureCommittedOutcomeLookup(command),
      ).pipe(
        Effect.mapError(error => error instanceof CommittedPointOutcomeSqlErrorV1
          ? new PointCommitSqlFailureMarkerV1("recheckOutcome", error.cause)
          : error),
      ), diagnosticContext,
    )).kind !== "missing"
  ) {
    await emitTransactionStep(options, command, "outcomeRechecked");
    return Object.freeze({ kind: "existing" });
  }
  projectPointCommitTransactionResult(
    requireLockedClockAuthorityResult(
      admissionClock, preliminaryAuthority, command,
    ),
  );
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    observePointCommitPublicationEffect(options.publicationObservation, "lifecycleAcceptance", validateApplicationWriteOwnershipForCommit(tx, {
      scopeId: command.authorityPins.scopeId,
      generation: command.authorityPins.executionAuthorityGeneration,
      authenticatedAttemptedTables: command.attemptedTableIds,
      materialTables: command.rowIntents.filter(row => !command.participantMaterialDocumentIds.has(row.documentId))
        .map(row => row.tableId)
    }, options.uniqueConstraints, target).pipe(
      Effect.mapError(error => error.reason === "resourceFailure"
        ? new PointCommitSqlFailureMarkerV1("validateActiveApplicationSchema", error.cause ?? error)
        : corruption(error.reason === "writeDenied" ? "applicationWritePolicyDenied" : "applicationWritePolicyEvidenceInvalid")))),
    diagnosticContext,
  ));
  await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => validateActiveRelationSelectionForPointCommit(tx, command));
  if (command.relationDependencies.length > 0) {
    await emitTransactionStep(
      options,
      command,
      "activeRelationSelectionValidated",
    );
  }
  const validatedApplicationRelations =
    command.finiteMetadataReservationSha256Hex !== null ? preparedApplicationRelationsForFiniteCommit(applicationRelations) :
      await observePointCommitPublicationPromise(options.publicationObservation, "lifecycleAcceptance", () => validateActiveApplicationSchemaForPointCommit(
        tx,
        command,
        applicationRelations,
        options,
      ));
  if (
    validatedApplicationRelations !== null &&
    command.authorityPins.executionAuthorityGeneration === "application_v1"
  ) {
    await emitTransactionStep(options, command, "relationBindingValidated");
  }
  if (command.authorityPins.executionAuthorityGeneration === "application_v1") {
    await emitTransactionStep(
      options,
      command,
      "activeApplicationSchemaValidated",
    );
  }
  const clock = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitClock(tx, command, options));
  await emitTransactionStep(options, command, "clockLocked");
  if (
    mode === "publish" &&
    await inspectCommittedOutcomeInTransaction(tx, clock, command, options) !== null
  ) {
    await emitTransactionStep(options, command, "outcomeRechecked");
    return Object.freeze({ kind: "existing" });
  }
  projectPointCommitTransactionResult(
    requireLockedClockAuthorityResult(clock, preliminaryAuthority, command),
  );
  const intrinsicBuilds = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(observePointCommitPublicationEffect(options.publicationObservation, "lockedAttemptAcceptance", lockPointCommitIntrinsicIndexBuilds(
    tx,
    clock,
    intrinsicDefinitions,
    command,
  )), diagnosticContext));
  if (intrinsicBuilds.length > 0) {
    await emitTransactionStep(options, command, "intrinsicIndexBuildLocked");
  }
  const developerBuilds = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(observePointCommitPublicationEffect(options.publicationObservation, "lockedAttemptAcceptance", lockPointCommitDeveloperIndexBuilds(
    tx,
    clock,
    developerDefinitions,
    command,
  )), diagnosticContext));
  if (developerBuilds.length > 0) {
    await emitTransactionStep(options, command, "developerIndexBuildLocked");
  }

  const session = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitSession(
    tx,
    command,
    options,
    mode,
  ));
  await emitTransactionStep(options, command, "sessionLocked");
  const lease = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitLease(tx, command, options));
  await emitTransactionStep(options, command, "leaseLocked");
  await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => lockPointCommitJournalRoot(tx, command, options));
  await emitTransactionStep(options, command, "journalRootLocked");

  const databaseNowMilliseconds = await observePointCommitPublicationPromise(options.publicationObservation, "lockedAttemptAcceptance", () => readPointCommitDatabaseTime(
    tx,
    command.authorityPins.scopeId,
    options,
  ));
  projectPointCommitTransactionResult(
    requireAttemptIsLiveResult(session, lease, databaseNowMilliseconds),
  );
  const finiteReservation = command.finiteMetadataReservationSha256Hex === null ? null :
    projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(requireFinitePointCommitReservation(command, lease.row), diagnosticContext));
  if (finiteReservation !== null) projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    validateConsumedMetadataDependencies(tx, command.authorityPins.scopeId, finiteReservation.metadataWatermark, command.metadataDependencies)
      .pipe(Effect.mapError(error => error.reason === "writeConflict" && error.dependency !== undefined &&
        error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined
        ? new PointCommitConflictV1Error({
          conflict: {
            kind: "metadata", ...error.dependency,
            capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence
          },
          snapshotCommitSeq: command.authorityPins.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq
        })
        : error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("validateIndexRanges", error.cause ?? error)
          : corruption("dependencySetInvalid"))), diagnosticContext));

  const admittedParticipants = await observePointCommitPublicationPromise(options.publicationObservation, "participantProof", () =>
    validateAdmittedParticipantOperations(tx, preliminaryAuthority, command, clock.record,
      developerDefinitions, uniqueDefinitions, options, finiteReservation));

  let loadedHeads: ReadonlyArray<LoadedPointCommitHeadV1>;
  options.publicationObservation?.record({ kind: "phase", phase: "occProof", edge: "begin" });
  try {
    loadedHeads = projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(loadPointCommitHeads(
      tx,
      clock,
      command,
      options,
    ), diagnosticContext));
    // A generated guard is insertion intent, never an observed missing read.
    // Genuine reads (including a prior same-ID read) keep their original OCC
    // validation before the separate insertion collision verdict.
    const observedDependencies: PointCommitDependencyV1[] = [];
    const observedHeads: LoadedPointCommitHeadV1[] = [];
    let insertionConflict: AppDocumentInsertionConflictError | undefined;
    for (let ordinal = 0; ordinal < command.dependencies.length; ordinal++) {
      const dependency = command.dependencies[ordinal];
      const head = loadedHeads[ordinal];
      if (dependency === undefined || head === undefined) throw corruption("dependencySetInvalid");
      if (!command.generatedOnlyPoints.has(dependency.documentId)) {
        observedDependencies.push(dependency); observedHeads.push(head);
      }
      if (command.generatedInsertions.has(dependency.documentId) && head.head.kind !== "missing")
        insertionConflict ??= new AppDocumentInsertionConflictError({ documentId: dependency.documentId });
    }
    projectPointCommitTransactionResult(validatePointCommitDependenciesResult(
      { authorityPins: command.authorityPins, dependencies: observedDependencies }, observedHeads));
    if (insertionConflict !== undefined) throw insertionConflict;
    const rangeConflict = await findPointCommitIndexRangeConflict(
      tx,
      clock,
      command,
    );
    if (rangeConflict !== null) throw rangeConflict;
    const relationConflict = await findPointCommitRelationConflict(
      tx,
      clock,
      command,
      options,
    );
    if (relationConflict !== null) throw relationConflict;
  } finally {
    options.publicationObservation?.record({ kind: "phase", phase: "occProof", edge: "end" });
  }
  await emitTransactionStep(options, command, "dependenciesValidated");

  if (mode === "rollbackProof" && command.rowIntents.length === 0) {
    return Object.freeze({
      kind: "ready",
      clock,
      commitSeq: null,
      publicationTimeMilliseconds: null,
      relationAdjacencyChanges: Object.freeze([]),
    });
  }
  return projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(Effect.gen(function* () {
    const originalBuildLocks = yield* Effect.fromResult(captureOriginalApplicationPublicationBuildLocks(tx, clock, intrinsicDefinitions, developerDefinitions));
    const originals = yield* Effect.exit(observePointCommitPublicationEffect(options.publicationObservation, "priorDocuments",
      loadApplicationDocumentPriorState(tx, command, loadedHeads, developerBuilds, uniqueDefinitions, validatedApplicationRelations, options)));
    const settlement = yield* prepareApplicationDocumentSettlementFromOriginalsEffect(command,
      Exit.isSuccess(originals) ? originals.value.originalRows ?? [] : [], originals, developerDefinitions, uniqueDefinitions,
      validatedApplicationRelations, intrinsicDefinitions);
    const acceptedPublication = yield* acceptApplicationPublication(tx, {
clock, settlement, intrinsic: intrinsicDefinitions, developer: developerDefinitions,
      unique: uniqueDefinitions, relations: validatedApplicationRelations, indexRanges: command.indexRangeDependencies,
      relationDependencies: command.relationDependencies, candidate: candidateSchemaWriteGuard !== null, oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq,
      generatedInsertions: command.generatedInsertions, generatedOnlyPoints: command.generatedOnlyPoints,
      originalBuildLocks, observeQuery: options.observeQuery, deadline: new Date(Math.min(session.authorizationGrantExpiresAtMilliseconds, session.hardExpiresAtMilliseconds, lease.expiresAtMilliseconds))
});
    return yield* lowerAcceptedPointCommit(tx, command, clock, acceptedPublication, candidateSchemaWriteGuard, preliminaryAuthority, admittedParticipants, options);
  }), diagnosticContext));
}

export async function publishPointCommitInTransaction(
  tx: AppRowTransaction,
  command: PreparedPointCommitPublicationCommandV1,
  kernel: Extract<PointCommitKernelResultV1, { readonly kind: "ready" }> & {
    readonly commitSeq: CommitSeq;
    readonly publicationTimeMilliseconds: number;
  },
  options: PointCommitTransactionProofOptionsV1,
): Promise<void> {
  const events = command.participantEventIntents;
  const eventSha256 = events.length === 0 ? null : projectPointCommitTransactionResult(
    await runPointCommitInTransactionEffect(commitEventsDigest(events).pipe(Effect.mapError(error =>
      error.reason === "resourceFailure" ? new PointCommitSqlFailureMarkerV1("writeCommitChange", error.cause ?? error)
        : corruption("commandInvalid")))));
  const contribution: ScopePublicationContribution = {
    authorityPins: command.authorityPins,
    rowIntents: command.rowIntents,
    identityAccessPolicySha256: command.session.identityAccessPolicySha256,
    requestSha256: command.session.requestSha256,
    resultSha256: command.sealIdentity.resultSha256,
    successfulResult: { ...command.successfulResult, encoding: "application-value" },
    ...(events.length === 0 ? {} : { events: { values: events, sha256: eventSha256 } }),
  };
  const prefix = await writeScopePublicationPrefix(tx, contribution, kernel, options);
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const scopeUuid = kernel.clock.scopeUuid;
  const journal = await sqlCall("deleteJournal", () =>
    tx.delete(fxSystemTransactionJournals).where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionJournals.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionJournals.attemptFence,
        command.authorityPins.attemptFence,
      ),
    )).returning({ sessionId: fxSystemTransactionJournals.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    journal,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "journalDeleted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "journalDeletes", counts: { rows: journal.length } });

  const lease = await sqlCall("deleteLease", () =>
    tx.delete(fxSystemSnapshotLeases).where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid),
      eq(
        fxSystemSnapshotLeases.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemSnapshotLeases.attemptFence,
        command.authorityPins.attemptFence,
      ),
    )).returning({ sessionId: fxSystemSnapshotLeases.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    lease,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "leaseDeleted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "leaseDeletes", counts: { rows: lease.length } });

  const session = await sqlCall("commitSession", () =>
    tx.update(fxSystemTransactionSessions).set({
      validatedArgsJson: null,
      validatedArgsCanonicalBytes: null,
      authorizationGrantJson: null,
      authorizationGrantCanonicalBytes: null,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      lifecycle: "committed",
      updatedAt: publicationTime,
    }).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(
        fxSystemTransactionSessions.sessionId,
        command.authorityPins.sessionId,
      ),
      eq(
        fxSystemTransactionSessions.attemptFence,
        command.authorityPins.attemptFence,
      ),
      eq(fxSystemTransactionSessions.lifecycle, "finishing"),
    )).returning({ sessionId: fxSystemTransactionSessions.sessionId }));
  projectPointCommitTransactionResult(requireSinglePublicationWriteResult(
    session,
    command.authorityPins.sessionId,
    "sessionId",
  ));
  await emitTransactionStep(options, command, "sessionCommitted");
  if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "batch", owner: "sessionCommits", counts: { rows: session.length } });

  await reproveScopePublicationPrefix(prefix);
  projectPointCommitTransactionResult(await runPointCommitInTransactionEffect(
    advanceScopePublicationClock(tx, contribution, kernel, options)));
}

export function requireSinglePublicationWriteResult<
  Key extends "commitSeq" | "sessionId",
  Value,
>(
  rows: ReadonlyArray<Readonly<Record<Key, Value>>>,
  expected: Value,
  key: Key,
): Result.Result<void, PointCommitCorruptionV1Error> {
  return rows.length === 1 && rows[0]?.[key] === expected
    ? Result.succeed(undefined)
    : Result.fail(corruption("publicationInvariantInvalid"));
}

export function publicationResultFromOutcomeResult(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): Result.Result<
  PointCommitPublicationResultV1,
  PointCommitCorruptionV1Error
> {
  if (outcome.kind === "missing") {
    return Result.fail(corruption("committedOutcomeMissing"));
  }
  if (
    expectedToken !== undefined &&
    (
      outcome.token.scopeUuid !== expectedToken.scopeUuid ||
      outcome.token.epochUuid !== expectedToken.epochUuid ||
      outcome.token.commitSeq !== expectedToken.commitSeq
    )
  ) {
    return Result.fail(corruption("publishedOutcomeInvalid"));
  }
  if (outcome.kind === "expired") {
    if (disposition === "published") {
      return Result.fail(corruption("publishedOutcomeInvalid"));
    }
    return Result.succeed(
      Object.freeze({ kind: "expired", token: outcome.token }),
    );
  }
  return Result.succeed(
    Object.freeze({
      kind: disposition,
      token: outcome.token,
      successfulResult: outcome.successfulResult,
    }),
  );
}

export function publicationResultFromOutcomeEffect(
  outcome: CommittedPointOutcomeResolutionV1,
  disposition: "published" | "replayed",
  expectedToken?: CommittedPointOutcomeTokenV1,
): Effect.Effect<
  PointCommitPublicationResultV1,
  PointCommitCorruptionV1Error
> {
  return Effect.fromResult(
    publicationResultFromOutcomeResult(
      outcome,
      disposition,
      expectedToken,
    ),
  );
}

export function bindPointCommitPublication(ports: StoredCommitAuthorityEvidenceLoaderPortsV1, capturedOptions: PointCommitTransactionProofOptionsV1, hasOrderedIndexes: boolean): Pick<PointCommitPublisherPortV1, "publish"> & PointCommitOutcomeResolutionPortV1 {
  const resolveOutcome = Effect.fn(
    "PointCommitTransaction.resolveCommittedOutcome",
  )((
    target: LocatedPointCommitPublicationTargetV1,
    input: ResolveCommittedPointOutcomeInputV1,
  ): Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    ResolveCommittedPointOutcomeErrorV1
  > => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](input));

  const publish: PointCommitPublisherPortV1["publish"] = Effect.fn(
    "PointCommitTransaction.publish",
  )(function* (input) {
    const observation = capturedOptions.publicationObservation;
    const command = yield* observePointCommitPublicationEffect(observation, "commandPreparation",
      preparePointCommitPublicationCommand(input));
    if (observation?.detail) {
      observation.record({
        kind: "counts", owner: "plan", counts: {
          rows: command.rowIntents.length,
          liveRows: command.rowIntents.filter(row => row.kind === "live").length,
          tombstones: command.rowIntents.filter(row => row.kind === "deleted").length,
          tables: new Set(command.rowIntents.map(row => row.tableId)).size,
          canonicalBytes: command.rowIntents.reduce((sum, row) => sum + (row.kind === "live" ? row.document.canonicalBytes.byteLength : 0), 0),
          semanticBytes: command.rowIntents.reduce((sum, row) => sum + (row.kind === "live" ? row.document.semanticSizeBytes : 0), 0),
          journalBytes: command.journalBytes?.byteLength ?? 0,
          resultBytes: command.successfulResult.canonicalBytes.byteLength,
          pointDependencies: command.dependencies.length,
          rangeDependencies: command.indexRangeDependencies.length,
          relationDependencies: command.relationDependencies.length,
          writeOperations: command.sealIdentity.writeOperations,
          participantOperations: command.participantOperations.length,
          sourceContributions: command.participantOperations.reduce((sum, operation) => sum + operation.sourceContributions.length, 0),
          effectOccurrences: command.participantOperations.reduce((sum, operation) => sum + operation.sourceContributions.reduce((sourceSum, source) => sourceSum + source.effects.length, 0), 0),
          eventIntents: command.participantEventIntents.length,
        }
      });
    }
    const located = yield* observePointCommitPublicationEffect(observation, "authorityResolution", resolvePointCommitAuthority(
      command.authorityPins,
      ports,
    ));
    const target = isLocatedPointCommitPublicationTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    const lookup = captureCommittedOutcomeLookup(command);
    const existing = yield* observePointCommitPublicationEffect(observation, "initialOutcome", resolveOutcome(target, lookup));
    if (existing.kind !== "missing") {
      return yield* publicationResultFromOutcomeEffect(existing, "replayed");
    }

    const preliminaryFailure = preliminaryAuthorityFailure(
      command,
      located.authority,
    );
    if (preliminaryFailure !== null) {
      return yield* Effect.fail(preliminaryFailure);
    }

    if (command.authorityPins.executionAuthorityGeneration === "application_v1" &&
      command.rowIntents.length > 0 && !hasOrderedIndexes) {
      return yield* Effect.fail(corruption("orderedIndexCompositionInvalid"));
    }
    const definitions = yield* observePointCommitPublicationEffect(observation, "definitionPreparation", Effect.gen(function* () {
      const intrinsicDefinitions = yield* prepareIntrinsicIndexDefinitions(
        command,
        capturedOptions,
      );
      const mixedDefinitions = yield* observePointCommitPublicationEffect(observation, "mixedDefinitions", preparePointCommitMixedDefinitions(command, capturedOptions));
      const developerDefinitions = mixedDefinitions.developerDefinitions;
      const uniqueDefinitions = mixedDefinitions.uniqueDefinitions;
      const mixedCommand = Object.freeze({
        ...command,
        sourceSchemaVersionByTable: mixedDefinitions.sourceSchemaVersionByTable
      });
      const applicationRelations = yield* prepareApplicationRelationDefinitions(
        command,
        { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
        capturedOptions,
      );
      const candidateSchemaWriteGuard = yield* prepareCandidateSchemaWriteGuard(
        command,
        { hasRelationAuthority: port => hasApplicationRelationCommitAuthorityForPointCommit(port, ports), hasCandidateGuardAuthority: port => hasAppSchemaCandidateWriteGuardComposition(port, ports) },
        capturedOptions,
      );
      return { intrinsicDefinitions, developerDefinitions, uniqueDefinitions, mixedCommand, applicationRelations, candidateSchemaWriteGuard };
    }));
    const { intrinsicDefinitions, developerDefinitions, uniqueDefinitions, mixedCommand, applicationRelations, candidateSchemaWriteGuard } = definitions;
    if (observation?.detail) observation.record({
      kind: "counts", owner: "definitions", counts: {
        intrinsicDefinitions: intrinsicDefinitions.length, developerDefinitions: developerDefinitions.length,
        uniqueDefinitions: uniqueDefinitions.length,
      }
    });

    const diagnosticContext = yield* Effect.withFiber(fiber => Effect.succeed(captureExecutionDiagnosticContext(fiber)));
    const runPublication = awaitPointCommitPublicationSettlement(
      runPointCommitPublication(
        target,
        located.authority,
        mixedCommand,
        intrinsicDefinitions,
        developerDefinitions,
        uniqueDefinitions,
        applicationRelations,
        candidateSchemaWriteGuard,
        capturedOptions,
        diagnosticContext,
      ),
    );
    const decision: PointCommitPublicationRunDecisionV1 = yield*
      runPublication.pipe(
        Effect.catchTag(
          "PointCommitTransactionDecisionUncertainV1Error",
          (uncertainty) =>
            observePointCommitPublicationEffect(observation, "finalOutcome", resolveOutcome(target, lookup)).pipe(
              Effect.catchTag(
                "CommittedPointOutcomeSqlErrorV1",
                (error) => Effect.fail(decisionUncertain(
                  uncertainty.cause,
                  Object.freeze({ kind: "lookupFailed", error }),
                )),
              ),
              Effect.flatMap((recovered): Effect.Effect<
                PointCommitPublicationRunDecisionV1,
                PointCommitDecisionUncertainV1Error
              > => recovered.kind === "missing"
                  ? Effect.fail(decisionUncertain(
                    uncertainty.cause,
                    Object.freeze({ kind: "missing" }),
                  ))
                  : Effect.succeed(Object.freeze({
                    kind: "recovered" as const,
                    outcome: recovered,
                  }))),
            ),
        ),
      );
    if (decision.kind === "recovered") {
      return yield* publicationResultFromOutcomeEffect(
        decision.outcome,
        "replayed",
      );
    }

    const resolved = yield* observePointCommitPublicationEffect(observation, "finalOutcome", resolveOutcome(target, lookup));
    if (decision.kind === "existing") {
      return yield* publicationResultFromOutcomeEffect(resolved, "replayed");
    }
    return yield* publicationResultFromOutcomeEffect(
      resolved,
      "published",
      decision.token,
    );
  }, effect => observePointCommitPublicationEffect(capturedOptions.publicationObservation, "publisher", effect));

  const resolvePointCommitOutcome: PointCommitOutcomeResolutionPortV1[
    typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
  ] = Effect.fn(
    "PointCommitTransaction.resolvePointCommitOutcome",
  )(function* (deploymentId, input) {
    const located = yield* resolvePointCommitAuthority({
      deploymentId,
      scopeId: replacementScopeIdV1FromUuid(input.scopeUuid),
    }, ports);
    const target = isLocatedPointCommitPublicationTargetV1(located.target)
      ? located.target
      : null;
    if (target === null) {
      return yield* Effect.fail(corruption(
        "readCommittedCapabilityMissing",
      ));
    }
    return yield* resolveOutcome(target, input);
  });
  return { publish, [RESOLVE_POINT_COMMIT_OUTCOME_V1]: resolvePointCommitOutcome };
}
