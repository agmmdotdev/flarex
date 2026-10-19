import { copyBytes } from "@flarex/utils/bytes";
import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { sql } from "drizzle-orm";
import {
  Cause,
  Effect,
  Encoding,
  Exit,
  Result,
  Schema,
} from "effect";
import { CanonicalSuccessfulResultBytesV1Schema } from "flarex-protocol/commit-protocol";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueSha256V1Schema,
} from "flarex-protocol/value";
import { validateApplicationWriteOwnershipForCommit } from "../../application/ownership/Commit";
import { type StoredCommitAuthorityEvidenceLoaderPortsV1 } from "../authority/postgresLoader";
import {
  finitePublicationAnchorQuery,
  observeFinitePublicationMetadata,
} from "../finitePublicationObservation";
import {
  acceptObservedCommittedOutcomeResult,
  decodeLockedPointCommitClockResult,
  inspectCommittedOutcomeInTransaction,
  lockPointCommitClock,
  preliminaryAuthorityFailure,
  preparedApplicationRelationsForFiniteCommit,
  requireLockedClockAuthorityResult,
  resolvePointCommitAuthority,
  validateActiveRelationSelectionForPointCommit,
  validatePointCommitSessionRowsResult,
} from "./attemptAcceptance";
import { recordFinitePublicationTerminalRefusal } from "./capabilities";
import { captureCommittedOutcomeLookup } from "./capture";
import { type PointCommitTransactionProofOptionsV1 } from "./constructionContracts";
import {
  type PointFiniteCommitCommand,
  type PointFiniteCommitPublisherPort,
} from "./contracts";
import { publicationResultFromOutcomeEffect } from "./durablePublication";
import {
  corruption,
  PointCommitConflictV1Error,
  type PointCommitPublicationV1Error,
  PointFiniteAttemptRetryBudgetExhaustedError,
} from "./errors";
import {
  lowerAcceptedPointCommit,
  requirePointCommitReadyForPublicationResult,
} from "./lowering";
import {
  prepareFiniteAttemptResolutionCommand,
  prepareFiniteCommitCommand,
  prepareFiniteCommitDefinitions,
  prepareFiniteCommitSettlement,
  requireFrozenFiniteAttemptOrigin,
} from "./preparation";
import { runPointCommitPromiseEffect } from "./promiseBoundary";
import {
  decisionUncertain,
  findSqlState,
  finiteCommitSqlFailure,
  mapFiniteAnchorFailure,
  mapPointCommitCallbackFailure,
  mapPublicationTransactionFailure,
  observeDrizzleQuery,
  routeAuthorityResolutionFailure,
  sqlCall,
  sqlError,
  stale,
} from "./sqlFailures";
import {
  advanceScopePublicationClock,
  readPointCommitDatabaseTime,
  requireScopePublicationStrongReferences,
  writeScopePublicationPrefix,
} from "../publication/pointCommitProjection";
import {
  scopePublicationMetadataChanged,
  scopePublicationProcedureFailure,
} from "../publication/prefixProjection";
import {
  requirePointCommitClockPublicationResult,
  scopePublicationClockAdvanceSource,
} from "../publication/publication";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { runEffectTransactionSettlement } from "../../database/effectTransaction";
import { fxSystemScopeClocks } from "../../database/schema";
import { observeExecution } from "../../execution/diagnostics/operation";
import {
  confirmFiniteAttemptNonacceptance,
  fenceFiniteAttemptNonacceptanceInTransaction,
  lendComparedFinitePublicationAnchor,
  lockFiniteAttemptAnchorRowByIdentityInTransaction,
  MAX_FINITE_ATTEMPT_COUNT,
  observeFencedFiniteAttemptNonacceptance,
  type PendingFiniteAttemptNonacceptance,
  readFiniteAttemptAnchorRow,
  rejectFiniteAttemptNonacceptanceInTransaction,
  requireFiniteAttemptIsLive,
} from "../../execution/finiteAttemptAnchor";
import {
  acceptFiniteMetadataComparisonVerdict,
  acceptFiniteTableWriteClosureComparison,
  prepareConsumedFiniteMetadataComparison,
  prepareFiniteTableWriteClosureComparison,
} from "../../execution/finiteMetadataDependencies";
import {
  acceptProtectedMetadataFinalGuardBatch,
  closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope,
  prepareProtectedMetadataFinalGuardBatch,
} from "../../execution/preparation/preparedMetadataEpoch";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import {
  isLocatedPointCommitPublicationTargetV1,
  type LocatedPointCommitPublicationTargetV1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
} from "../../execution/session/kernelContracts";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
} from "../../database/locatedTransactionIdentity";
import {
  closeInstallationAdmission,
  lockInstallationForCurrentTransaction,
} from "../../installation/installationLifecycle";
import {
  ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION,
  isInstalledAttemptScopeAuthorityTarget,
  RUN_INSTALLED_ACCEPTING_READ_COMMITTED,
} from "../../scope/scopeAuthorityControlRead";
import {
  resolveTrustedScopeAuthoritySnapshotResult,
  resolveTrustedScopePlacementSnapshotResult,
  type TrustedScopeAuthority,
  TrustedScopeAuthorityPortError,
  TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import {
  closeExactAttemptScopeClockObservation,
  openExactAttemptScopeClockObservation,
} from "../../scope/scopeClock";
import { scopePhysicalLocatorsEqual } from "../../scope/scopePhysicalLocator";
import { type AppRowTransaction } from "../../storage/documents/appRows";
import { validateLogicalDocumentChanges } from "../../storage/documents/logicalDocuments/contribution";
import {
  inspectFiniteOperationCommitAuthority,
  prepareFiniteOperationCommitObservation,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import { type LogicalSearchDefinition } from "../../storage/documents/logicalDocuments/searchEntries";
import { withSharedLogicalSourceBindingChecks } from "../../storage/documents/logicalDocuments/sourceAdmission";
import { emitTransactionStep } from "../../storage/materialization/materialization";
import {
  acceptApplicationPublication,
  readAcceptedApplicationPublication,
} from "../../storage/materialization/publicationAcceptance";

export const FinitePublicationSourceObservationPagesSchema = Schema.Array(Schema.Unknown);

export const decodeFinitePublicationSourceObservationPages = Schema.decodeUnknownEffect(FinitePublicationSourceObservationPagesSchema);

export function runFiniteCommitTransactionEffect<Value, Failure>(target: LocatedPointCommitPublicationTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
  runTransaction: LocatedPointCommitPublicationTargetV1[typeof RUN_LOCATED_READ_COMMITTED_V1] = target[RUN_LOCATED_READ_COMMITTED_V1]) {
  return runEffectTransactionSettlement<Value, Failure, ReturnType<typeof mapPublicationTransactionFailure>, AppRowTransaction>(
    callback => runTransaction(callback).catch(cause => {
      if (cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack")
        throw cause.issue.callbackCause;
      throw cause;
    }), "Finite point mutation callback rolled back", tx => body(tx).pipe(
      Effect.ensuring(Effect.sync(() => {
        closeExactAttemptScopeClockObservation(tx);
        closeProtectedMetadataFinalGuardScope(tx);
        // Installed admission remains live through the accepting runner's
        // post-callback assertion; that same runner closes it in its finally.
        if (!isInstalledAttemptScopeAuthorityTarget(target)) closeInstallationAdmission(tx);
      }))), mapPublicationTransactionFailure);
}

export function finiteCommitPromiseEffect<Value>(work: () => PromiseLike<Value>) {
  return runPointCommitPromiseEffect(work, mapPointCommitCallbackFailure);
}

export function createFinitePublisherOperations(ports: StoredCommitAuthorityEvidenceLoaderPortsV1,
  options: PointCommitTransactionProofOptionsV1): PointFiniteCommitPublisherPort {
  const publishFiniteOperation = Effect.fnUntraced(function* (input: PointFiniteCommitCommand) {
    const outcomeCommand = yield* prepareFiniteAttemptResolutionCommand(input);
    const located = (yield* requireFrozenFiniteAttemptOrigin(input, outcomeCommand)).resolvedTarget;
    if (!isLocatedPointCommitPublicationTargetV1(located.target)) return yield* Effect.fail(corruption("readCommittedCapabilityMissing"));
    const target = located.target;
    const lookup = captureCommittedOutcomeLookup(outcomeCommand);
    const existing = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
    if (existing.kind !== "missing") return yield* publicationResultFromOutcomeEffect(existing, "replayed");
    const command = yield* prepareFiniteCommitCommand(input, options);
    if (!isInstalledAttemptScopeAuthorityTarget(target)) {
      // The explicit full-proof profile cannot lend installed placement proof.
      // Authenticate its current authority while retaining the original target.
      const current = yield* Effect.gen(function* () {
        const selection = command.authorityPins;
        const scope = yield* Effect.tryPromise({
          try: () => ports.scopeMetadata.getScopeMetadata(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "scopeMetadataRead", cause })
        });
        if (scope === null || !scopePhysicalLocatorsEqual(scope.physicalLocator, target.physicalLocator))
          return yield* Effect.fail(new TrustedScopeAuthorityResolutionError({
            reason: "scopeClockTargetPlacementMismatch",
            scopeId: selection.scopeId, expected: scope?.physicalLocator ?? located.authority.physicalLocator, actual: target.physicalLocator
          }));
        const receipt = scope.physicalLocator.kind === "shared_database" ? null : yield* Effect.tryPromise({
          try: () => ports.provisioningReceipts.getScopeAuthorityProvisioningReceipt(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "provisioningReceiptRead", cause })
        });
        yield* Effect.fromResult(resolveTrustedScopePlacementSnapshotResult(selection, scope, receipt, target.physicalLocator));
        const clock = yield* Effect.tryPromise({
          try: () => target.getCurrentClock(selection.scopeId),
          catch: cause => new TrustedScopeAuthorityPortError({ operation: "scopeClockRead", cause })
        });
        return yield* Effect.fromResult(resolveTrustedScopeAuthoritySnapshotResult(selection, scope, receipt, target.physicalLocator, clock));
      }).pipe(Effect.catchTag("TrustedScopeAuthorityResolutionError", routeAuthorityResolutionFailure),
        Effect.catchTag("TrustedScopeAuthorityPortError", routeAuthorityResolutionFailure));
      const currentFailure = preliminaryAuthorityFailure(command, current);
      if (currentFailure !== null) return yield* Effect.fail(currentFailure);
    }
    const preliminaryFailure = preliminaryAuthorityFailure(command, located.authority);
    if (preliminaryFailure !== null) return yield* Effect.fail(preliminaryFailure);
    const definitions = yield* prepareFiniteCommitDefinitions(command, ports, options);
    const settlement = yield* prepareFiniteCommitSettlement(definitions);
    const transaction = runFinitePointCommitPublication(target, located.authority, settlement, options);
    const decision = yield* transaction.pipe(Effect.catchTag(
      "PointCommitTransactionDecisionUncertainV1Error", uncertainty => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup).pipe(
        Effect.catchTag("CommittedPointOutcomeSqlErrorV1", error => Effect.fail(decisionUncertain(uncertainty.cause, { kind: "lookupFailed", error }))),
        Effect.flatMap(recovered => recovered.kind === "missing" ? Effect.fail(decisionUncertain(uncertainty.cause, { kind: "missing" })) :
          Effect.succeed({ kind: "recovered" as const, outcome: recovered })),
      )));
    if (decision.kind === "recovered") return yield* publicationResultFromOutcomeEffect(decision.outcome, "replayed");
    if (decision.kind === "existing") return yield* publicationResultFromOutcomeEffect(
      yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup), "replayed");
    const result = command.frozen.successfulResult;
    const digest = yield* Effect.fromResult(Encoding.decodeHex(result.evidence.sha256Hex).pipe(Result.mapError(() => corruption("successfulResultInvalid"))));
    return Object.freeze({
      kind: "published" as const, token: decision.token, successfulResult: Object.freeze({
        valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1, valueJson: structuredClone(result.valueJson), semanticSizeBytes: result.semanticSizeBytes,
        canonicalText: result.canonicalText, canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(copyBytes(result.canonicalBytes)), sha256: FlarexValueSha256V1Schema.make(digest),
      })
    });
  }, work => observeExecution("PointCommitTransaction.publishFinite", work));
  const publishFinite: PointFiniteCommitPublisherPort["publishFinite"] = input => publishFiniteOperation(input).pipe(
    Effect.tapError(error => Effect.sync(() => recordFinitePublicationTerminalRefusal(error, input))));
  const resolveFinite: PointFiniteCommitPublisherPort["resolveFinite"] = Effect.fn("PointCommitTransaction.resolveFinite")(function* (input) {
    const command = yield* prepareFiniteAttemptResolutionCommand(input);
    const located = "frozenAttempt" in input
      ? (yield* requireFrozenFiniteAttemptOrigin(input, command)).resolvedTarget
      : yield* resolvePointCommitAuthority(command.authorityPins, ports);
    if (!isLocatedPointCommitPublicationTargetV1(located.target)) return yield* Effect.fail(corruption("readCommittedCapabilityMissing"));
    const target = located.target;
    const lookup = captureCommittedOutcomeLookup(command);
    const observed = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
    if (observed.kind !== "missing") return Object.freeze({ kind: "committed" as const, outcome: observed });
    const transaction = runFiniteCommitTransactionEffect(target, tx => Effect.gen(function* () {
      const clock = yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, options));
      const selector = {
        deploymentId: command.authorityPins.deploymentId, scopeId: command.authorityPins.scopeId,
        sessionId: command.authorityPins.sessionId, attemptFence: command.authorityPins.attemptFence
      };
      const lockedRow = yield* lockFiniteAttemptAnchorRowByIdentityInTransaction(tx, selector).pipe(Effect.mapError(mapFiniteAnchorFailure));
      // A final publisher retains these same authority/sequencer/anchor locks
      // through COMMIT. Absence after this wait conclusively excludes it.
      if ((yield* finiteCommitPromiseEffect(() => inspectCommittedOutcomeInTransaction(tx, clock, command, options))) !== null)
        return { kind: "existing" as const };
      const anchor = yield* readFiniteAttemptAnchorRow(lockedRow).pipe(Effect.mapError(mapFiniteAnchorFailure));
      const row = anchor.session;
      if (row.attemptFence !== selector.attemptFence) return yield* Effect.fail(stale("attemptReplaced"));
      if (anchor.reservation === null) return yield* Effect.fail(corruption("occEvidenceInvalid"));
      yield* Effect.fromResult(validatePointCommitSessionRowsResult([{
        ...row,
        validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes?.byteLength ?? null,
        authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes?.byteLength ?? null,
      }], command, "resolveFinite"));
      const databaseNow = yield* finiteCommitPromiseEffect(() => readPointCommitDatabaseTime(tx, command.authorityPins.scopeId, options));
      if (!Number.isSafeInteger(databaseNow)) return yield* Effect.fail(corruption("scopeClockInvalid"));
      if (row.updatedAt.getTime() > databaseNow) return yield* Effect.fail(corruption("sessionInvalid"));
      if (row.lifecycle === "aborted" || row.lifecycle === "expired") {
        if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence < command.executionClaim.claimFence)
          return yield* Effect.fail(stale("attemptReplaced"));
        return { kind: "rejected" as const, error: command.terminalRefusal ?? stale(row.lifecycle === "expired" ? "expired" : "lifecycleChanged") };
      }
      if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner ||
        anchor.executionClaim.claimFence !== command.executionClaim.claimFence + (row.lifecycle === "retrying" ? 1n : 0n))
        return yield* Effect.fail(stale("attemptReplaced"));
      const currentAuthority = requireLockedClockAuthorityResult(clock, located.authority, command);
      const expired = databaseNow >= row.authorizationGrantExpiresAt.getTime() || databaseNow >= row.hardExpiresAt.getTime();
      const budget = row.attemptFence >= MAX_FINITE_ATTEMPT_COUNT ? new PointFiniteAttemptRetryBudgetExhaustedError({
        attemptFence: row.attemptFence, maximumAttempts: MAX_FINITE_ATTEMPT_COUNT,
      }) : undefined;
      if (Result.isFailure(currentAuthority) || expired || command.terminalRefusal !== undefined || budget !== undefined) {
        const error = command.terminalRefusal ?? budget ?? (Result.isFailure(currentAuthority) ? currentAuthority.failure : stale("expired"));
        yield* rejectFiniteAttemptNonacceptanceInTransaction(tx, anchor, expired ? "expired" : "aborted")
          .pipe(Effect.mapError(mapFiniteAnchorFailure));
        return { kind: "rejected" as const, error };
      }
      let candidate: PendingFiniteAttemptNonacceptance;
      if (row.lifecycle === "retrying") candidate = yield* Effect.fromResult(
        observeFencedFiniteAttemptNonacceptance(selector, command.executionClaim, anchor).pipe(Result.mapError(mapFiniteAnchorFailure)));
      else {
        if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence !== command.executionClaim.claimFence)
          return yield* Effect.fail(stale("attemptReplaced"));
        candidate = yield* fenceFiniteAttemptNonacceptanceInTransaction(tx, selector, anchor).pipe(Effect.mapError(mapFiniteAnchorFailure));
      }
      return { kind: "fenced" as const, candidate };
    }));
    const decision = yield* transaction.pipe(Effect.catchTag(
      "PointCommitTransactionDecisionUncertainV1Error", uncertainty => target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup).pipe(
        Effect.catchTag("CommittedPointOutcomeSqlErrorV1", error => Effect.fail(decisionUncertain(uncertainty.cause, { kind: "lookupFailed", error }))),
        Effect.flatMap(outcome => outcome.kind === "missing" ? Effect.fail(decisionUncertain(uncertainty.cause, { kind: "missing" })) :
          Effect.succeed({ kind: "recovered" as const, outcome })),
      )));
    if (decision.kind === "recovered") return Object.freeze({ kind: "committed" as const, outcome: decision.outcome });
    if (decision.kind === "rejected") return Object.freeze({ kind: "rejected" as const, error: decision.error });
    if (decision.kind === "existing") {
      const outcome = yield* target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](lookup);
      if (outcome.kind === "missing") return yield* Effect.fail(corruption("committedOutcomeMissing"));
      return Object.freeze({ kind: "committed" as const, outcome });
    }
    const proof = yield* Effect.fromResult(confirmFiniteAttemptNonacceptance(decision.candidate).pipe(Result.mapError(error =>
      error.reason === "resourceFailure" ? sqlError("lockSession", error.cause ?? error) : corruption("sessionInvalid"))));
    return Object.freeze({ kind: "noncommit" as const, proof });
  });
  return Object.freeze({ publishFinite, resolveFinite });
}

export function runFinitePointCommitPublication(target: LocatedPointCommitPublicationTargetV1, preliminaryAuthority: TrustedScopeAuthority,
  settlement: Effect.Success<ReturnType<typeof prepareFiniteCommitSettlement>>, options: PointCommitTransactionProofOptionsV1,
) {
  const { mixedCommand: command, intrinsicDefinitions, developerDefinitions, uniqueDefinitions, applicationRelations, candidateSchemaWriteGuard,
    originalIssuer, expectedSession, sourceAcceptance, documentSettlement, publicationContribution } = settlement;
  return runFiniteCommitTransactionEffect(target, tx => Effect.gen(function* () {
    if (!isInstalledAttemptScopeAuthorityTarget(target))
      yield* lockInstallationForCurrentTransaction(tx, preliminaryAuthority.physicalLocator.schemaName).pipe(
        Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("lockScopeClock", error.cause ?? error)
          : stale("scopeChanged")));
    yield* Effect.sync(() => openProtectedMetadataFinalGuardScope(tx));
    const accepted = isInstalledAttemptScopeAuthorityTarget(target)
      ? yield* target[ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION](tx, command.authorityPins)
        .pipe(Effect.mapError(error => "reason" in error && error.reason === "resourceFailure"
          ? finiteCommitSqlFailure("lockScopeClock", error.cause ?? error) : stale("scopeChanged")))
      : undefined;
    const clock = accepted === undefined
      ? yield* finiteCommitPromiseEffect(() => lockPointCommitClock(tx, command, options))
      : yield* Effect.fromResult(decodeLockedPointCommitClockResult(accepted.row));
    yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "clockLocked"));
    const namespace = sql.identifier(preliminaryAuthority.physicalLocator.schemaName);
    if (options.afterTransactionStep !== undefined) {
      const [locked] = yield* finiteCommitPromiseEffect(() => sqlCall("lockSession", () => tx.select({
        found: sql<boolean>`${namespace}.fx_lock_finite_publication_anchor(${command.scopeUuid}::uuid,
            ${command.authorityPins.sessionId}::uuid)`,
      }).from(sql`(values(1)) as publication_lock`)));
      if (locked?.found !== true) return yield* Effect.fail(stale("attemptMissing"));
      yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "sessionLocked"));
    }
    const lookup = captureCommittedOutcomeLookup(command);
    const observationQuery = finitePublicationAnchorQuery(tx, preliminaryAuthority.physicalLocator.schemaName, {
      ...lookup, sessionId: command.authorityPins.sessionId, expectedSession,
    });
    observeDrizzleQuery("lockSession", observationQuery, options);
    const observedRows = yield* finiteCommitPromiseEffect(() => sqlCall("lockSession", () => observationQuery));
    const observed = observedRows[0];
    if (observedRows.length !== 1 || observed === undefined) return yield* Effect.fail(corruption("sessionInvalid"));
    if (options.afterTransactionStep === undefined)
      yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "sessionLocked"));
    if (observed.reason === "attemptMissing") return yield* Effect.fail(stale("attemptMissing"));
    // A real outcome snapshot follows the actual stable lock. Its existing
    // canonical scalar/header decoder precedes every new anchor refusal.
    if (observed.reason === "replay") {
      yield* Effect.fromResult(acceptObservedCommittedOutcomeResult(observed.outcome, clock, command));
      return Object.freeze({ kind: "existing" as const });
    }
    if (observed.reason !== "accepted") return yield* Effect.fail(corruption("sessionInvalid"));
    const anchor = yield* lendComparedFinitePublicationAnchor(command.frozen.originalEntry, originalIssuer,
      observed.mutable).pipe(Effect.mapError(mapFiniteAnchorFailure));
    yield* Effect.fromResult(requireLockedClockAuthorityResult(clock, preliminaryAuthority, command));
    if (accepted !== undefined) {
      const authorityFailure = preliminaryAuthorityFailure(command, accepted.authority);
      if (authorityFailure !== null) return yield* Effect.fail(authorityFailure);
      if (!scopePhysicalLocatorsEqual(accepted.authority.physicalLocator, preliminaryAuthority.physicalLocator))
        return yield* Effect.fail(stale("scopeChanged"));
    }
    const acceptedAuthority = accepted?.authority ?? preliminaryAuthority;
    if (anchor.executionClaim.claimOwner !== command.executionClaim.claimOwner || anchor.executionClaim.claimFence !== command.executionClaim.claimFence)
      return yield* Effect.fail(stale("attemptReplaced"));
    const row = anchor.session;
    yield* Effect.fromResult(validatePointCommitSessionRowsResult([{
      ...row,
      validatedArgsCanonicalByteLength: row.validatedArgsCanonicalBytes?.byteLength ?? null,
      authorizationGrantCanonicalByteLength: row.authorizationGrantCanonicalBytes?.byteLength ?? null,
    }], command, "publishFinite"));
    if (anchor.reservation === null || anchor.snapshotToken.epoch !== command.authorityPins.snapshotToken.epoch ||
      anchor.snapshotToken.commitSeq !== command.authorityPins.snapshotToken.commitSeq ||
      anchor.snapshotToken.commitSeq < clock.oldestAvailableCommitSeq) return yield* Effect.fail(corruption("sessionInvalid"));
    const now = finiteDateMilliseconds(observed.databaseNow);
    if (now === undefined) return yield* Effect.fail(corruption("sessionInvalid"));
    yield* Effect.fromResult(requireFiniteAttemptIsLive(anchor, new Date(now)).pipe(Result.mapError(mapFiniteAnchorFailure)));
    // The ordinary full-artifact lock owner already issued this observation.
    // Installed acceptance supplies its actual clock row without that scope.
    if (accepted !== undefined) yield* Effect.sync(() => openExactAttemptScopeClockObservation(tx,
      clock.record, clock.authorizationRevocationEpoch, "attempt"));
    const capturedWatermark = anchor.reservation.metadataWatermark;
    const admittedParticipants = yield* withSharedLogicalSourceBindingChecks(tx, () => Effect.gen(function* () {
      const watermark = capturedWatermark;
      const consumedExpected = yield* Effect.fromResult(prepareConsumedFiniteMetadataComparison(watermark,
        command.frozen.graph.metadataDependencies ?? [])).pipe(Effect.mapError(() => corruption("dependencySetInvalid")));
      const applicationExpected = prepareFiniteTableWriteClosureComparison(command.frozen.applicationMetadataProjection, command.attemptedTableIds);
      const sourceExpectations = sourceAcceptance.map(({ source, touchedTables }) =>
        prepareFiniteOperationCommitObservation(source.token, source.admission, command.frozen.attempt,
          source.operation.participant, source.methods, tx, acceptedAuthority, clock.record, touchedTables));
      const metadata = yield* observeFinitePublicationMetadata(tx, preliminaryAuthority.physicalLocator.schemaName,
        command.authorityPins.scopeId, watermark, consumedExpected,
        Result.match(applicationExpected, { onFailure: () => [], onSuccess: prepared => prepared.pages }),
        sourceExpectations.map(expected => Result.match(expected, { onFailure: () => [], onSuccess: prepared => prepared.pages }))).pipe(Effect.mapError(error =>
          error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateIndexRanges", error.cause ?? error) : corruption("dependencySetInvalid")));
      yield* Effect.fromResult(acceptFiniteMetadataComparisonVerdict(metadata.consumed, consumedExpected, watermark)).pipe(Effect.mapError(error =>
        error.reason === "writeConflict" && error.dependency !== undefined && error.capturedMetadataWatermark !== undefined && error.lastChangedMetadataSequence !== undefined
          ? new PointCommitConflictV1Error({
            conflict: {
              kind: "metadata", ...error.dependency,
              capturedMetadataWatermark: error.capturedMetadataWatermark, lastChangedMetadataSequence: error.lastChangedMetadataSequence
            },
            snapshotCommitSeq: anchor.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq
          })
          : error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateIndexRanges", error.cause ?? error) : corruption("dependencySetInvalid")));
      const applicationPlan = yield* Effect.fromResult(applicationExpected).pipe(Effect.mapError(() => stale("activeSchemaChanged")));
      yield* Effect.fromResult(acceptFiniteTableWriteClosureComparison(applicationPlan, metadata.application)).pipe(
        Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error)
          : stale("activeSchemaChanged")));
      yield* validateApplicationWriteOwnershipForCommit(tx,
        {
          scopeId: command.authorityPins.scopeId, generation: command.authorityPins.executionAuthorityGeneration,
          authenticatedAttemptedTables: command.attemptedTableIds,
          materialTables: command.rowIntents.filter(intent => !command.participantMaterialDocumentIds.has(intent.documentId)).map(intent => intent.tableId)
        },
        options.uniqueConstraints, target, metadata.ownership).pipe(Effect.mapError(error => error.reason === "resourceFailure"
          ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : corruption("applicationWritePolicyDenied")));
      yield* finiteCommitPromiseEffect(() => validateActiveRelationSelectionForPointCommit(tx, command));
      const acceptedSources: Readonly<{ search: readonly LogicalSearchDefinition[] }>[] = [];
      for (const source of command.sources) {
        // Every receipt retains its exact method/admission check. Only the
        // genuine issuer token identifies shared final validation ownership.
        const selected = inspectFiniteOperationCommitAuthority(source.token, source.admission, command.frozen.attempt,
          source.operation.participant, source.methods);
        if (selected === null) return yield* Effect.fail(corruption("commandInvalid"));
      }
      const sourceObservations = yield* decodeFinitePublicationSourceObservationPages(metadata.sources)
        .pipe(Effect.mapError(() => stale("activeSchemaChanged")));
      let sourceOrdinal = 0;
      for (const { source, touchedTables, documentResults, definitionResults } of sourceAcceptance) {
        const sourceExpectation = sourceExpectations[sourceOrdinal];
        if (sourceExpectation === undefined) return yield* Effect.fail(stale("activeSchemaChanged"));
        const sourcePrepared = yield* Effect.fromResult(sourceExpectation).pipe(Effect.mapError(() => stale("activeSchemaChanged")));
        yield* sourcePrepared.accept(sourceObservations[sourceOrdinal] ?? null)
          .pipe(Effect.mapError(error => error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error)
            : stale("activeSchemaChanged")));
        for (const result of documentResults) {
          if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
          yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "finiteParticipantDocumentValidated"));
        }
        for (const result of definitionResults) if (Exit.isFailure(result)) return yield* Effect.failCause(result.cause);
        acceptedSources.push({ search: source.selected.search.filter(search => touchedTables.includes(search.tableId)) });
        sourceOrdinal++;
      }
      if (sourceObservations.length !== sourceOrdinal) return yield* Effect.fail(stale("activeSchemaChanged"));
      return acceptedSources;
    }));
    const allowed = new Set([...command.attemptedTableIds, ...command.sources.flatMap(source => [...source.selected.tableIds])]);
    yield* validateLogicalDocumentChanges({
      // Only the admitted finite working-set issuer can produce causal proofs.
      // Acceptance of that proof does not grant a command capability or journal mode.
      detachDeletedReferences: true,
      tx,
      scopeId: command.authorityPins.scopeId, tables: allowed, maximumIndexEntries: 4096,
      conflict: observation => new PointCommitConflictV1Error({
        conflict: { kind: "finiteRootGraph", observation },
        snapshotCommitSeq: anchor.snapshotToken.commitSeq, currentCommitSeq: clock.record.lastCommitSeq
      }),
      error: (reason, cause): PointCommitPublicationV1Error => reason === "statementFailure" || reason === "resourceFailure"
        ? finiteCommitSqlFailure("validateIndexRanges", cause ?? reason) : corruption("dependencySetInvalid"),
    }, command.frozen.graph);
    if (documentSettlement === null) return yield* Effect.fail(corruption("commandInvalid"));
    const acceptedPublication = yield* acceptApplicationPublication(tx, {
clock, settlement: documentSettlement, intrinsic: intrinsicDefinitions,
      developer: developerDefinitions, unique: uniqueDefinitions, relations: preparedApplicationRelationsForFiniteCommit(applicationRelations),
      indexRanges: command.indexRangeDependencies, relationDependencies: command.relationDependencies, candidate: candidateSchemaWriteGuard !== null,
      oldestAvailableCommitSeq: clock.oldestAvailableCommitSeq, observeQuery: options.observeQuery,
      generatedInsertions: command.generatedInsertions, generatedOnlyPoints: command.generatedOnlyPoints,
      deadline: new Date(Math.min(anchor.leaseExpiresAt.getTime(), Date.parse(anchor.executionClaim.claimExpiresAt),
        anchor.session.authorizationGrantExpiresAt.getTime(), anchor.session.hardExpiresAt.getTime()))
})
      .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapPointCommitCallbackFailure))));
    const acceptedState = yield* Effect.fromResult(readAcceptedApplicationPublication(tx, acceptedPublication));
    yield* Effect.fromResult(requireFiniteAttemptIsLive(anchor, new Date(acceptedState.databaseNowMilliseconds)).pipe(Result.mapError(mapFiniteAnchorFailure)));
    const kernel = yield* lowerAcceptedPointCommit(tx, command, clock, acceptedPublication, candidateSchemaWriteGuard, acceptedAuthority,
      admittedParticipants, options).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapPointCommitCallbackFailure))));
    const ready = yield* Effect.fromResult(requirePointCommitReadyForPublicationResult(kernel));
    if (publicationContribution === null) return yield* Effect.fail(corruption("commandInvalid"));
    if (Exit.isFailure(publicationContribution)) return yield* Effect.failCause(publicationContribution.cause);
    const contribution = publicationContribution.value;
    yield* finiteCommitPromiseEffect(() => writeScopePublicationPrefix(tx, contribution, ready, options, undefined, anchor.session));
    if (accepted !== undefined && options.afterTransactionStep === undefined) {
      yield* requireScopePublicationStrongReferences(tx, ready, options).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapPointCommitCallbackFailure))));
      const guard = yield* prepareProtectedMetadataFinalGuardBatch(tx).pipe(Effect.mapError(error =>
        error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
      yield* Effect.sync(() => closeExactAttemptScopeClockObservation(tx));
      const query = tx.select({
        lastCommitSeq: sql`advanced.last_commit_seq`.mapWith(fxSystemScopeClocks.lastCommitSeq),
        valid: sql<boolean>`case when advanced.reason = 'accepted' then
            case when (select metadata_guard.valid from ${guard.source} as metadata_guard)
              then true else ${namespace}.fx_refuse_scope_publication_metadata() end else false end`,
      }).from(sql`${scopePublicationClockAdvanceSource(preliminaryAuthority.physicalLocator.schemaName, ready)} advanced`);
      observeDrizzleQuery("advanceScopeClock", query, options);
      yield* Effect.sync(() => options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "begin" }));
      const rows = yield* runDrizzleStatementEffect(query, cause => {
        if (scopePublicationMetadataChanged(cause) || findSqlState(cause) === "55P03") return stale("activeSchemaChanged");
        const refused = scopePublicationProcedureFailure(cause);
        return refused === null ? finiteCommitSqlFailure("advanceScopeClock", cause) : corruption(refused.reason);
      }).pipe(Effect.ensuring(Effect.sync(() => options.publicationObservation?.record({ kind: "phase", phase: "clockAdvance", edge: "end" }))));
      yield* Effect.fromResult(requirePointCommitClockPublicationResult(rows, ready.commitSeq).pipe(Result.mapError(error => corruption(error.reason))));
      yield* acceptProtectedMetadataFinalGuardBatch(tx, rows.map(guardRow => ({ valid: guardRow.valid }))).pipe(Effect.mapError(error =>
        error.reason === "resourceFailure" ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
    } else {
      yield* advanceScopePublicationClock(tx, contribution, ready, options).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, mapPointCommitCallbackFailure))));
      yield* finiteCommitPromiseEffect(() => emitTransactionStep(options, command, "beforeCommit"));
      yield* flushProtectedMetadataFinalGuards(tx).pipe(Effect.mapError(error => error.reason === "resourceFailure"
        ? finiteCommitSqlFailure("validateActiveApplicationSchema", error.cause ?? error) : stale("activeSchemaChanged")));
    }
    return { kind: "published" as const, token: { scopeUuid: ready.clock.scopeUuid, epochUuid: ready.clock.epochUuid, commitSeq: ready.commitSeq } };
  }), isInstalledAttemptScopeAuthorityTarget(target)
    ? callback => target[RUN_INSTALLED_ACCEPTING_READ_COMMITTED](command.authorityPins, callback)
    : target[RUN_LOCATED_READ_COMMITTED_V1]);
}
