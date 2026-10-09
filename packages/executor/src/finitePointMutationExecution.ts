import { Cause, Data, Duration, Effect, Exit, Random, type Result } from "effect";
import {
  borrowFrozenFiniteCommitValues,
  type FrozenFiniteAttempt,
} from "@flarex/persistence-postgres/session-journal-store";
import type {
  PointFiniteCommitCommand,
  PointFiniteCommitPublisherPort,
  PointCommitPublicationResultV1,
  PointCommitPublicationV1Error,
  PointCommitOutcomeResolutionV1Error,
  PointFiniteAttemptReplacementPort,
  PointFiniteAttemptResolutionCommand,
  PointRecoveredFiniteAttemptReplacementCommand,
  PointMutationAttemptReplacementV1Error,
  PointFiniteAttemptResolution,
  PointFiniteTerminalRefusal,
} from "@flarex/persistence-postgres/point-commit-transaction";
import { PointCommitConflictV1Error, PointCommitDecisionUncertainV1Error, PointMutationAttemptReplacementCommittedOutcomeV1Error,
  isPointFiniteReplacementTerminalRefusal } from "@flarex/persistence-postgres/point-commit-transaction";
import type { FiniteAttemptNonacceptanceProof } from "@flarex/persistence-postgres/finite-attempt-anchor";
import type { PointMutationSessionAttemptTerminalizationPersistenceV1, PointMutationExecutionClaimAcquisitionV1 } from "@flarex/persistence-postgres/transaction-session-activation";
import { PointMutationExecutionClaimAcquisitionInputV1Error } from "@flarex/persistence-postgres/transaction-session-activation";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { isJsonObject } from "flarex-protocol/json";
import { normalizeFlarexValueJsonV1 } from "flarex-protocol/value";
import { requirePointMutationArgumentSemanticSizeV1 } from "flarex-protocol/point-mutation-start";
import { activateConfirmedFiniteReplacement, activateConfirmedFiniteRecoveryReplacement, type ActivatedPointMutationSessionV1,
  type ApplicationPointMutationSessionActivationV1, type ApplicationPointMutationFiniteStartError } from "./pointMutationSessionActivation";
import type { PreparedFiniteApplicationMutationSessionActivation, PointMutationSessionActivationResultV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";
import { getActivatedPointMutationSessionStateV1 } from "./pointMutationSessionActivationState";
import type { PointMutationExecutionClaimVaultV1, InvalidPointMutationExecutionClaimV1Error } from "./pointMutationExecutionClaim";
import { validatePointMutationExecutionLivenessConfigurationV1Result, type PointMutationExecutionLivenessV1Error } from "./pointMutationExecutionClaimLiveness";
import { superviseExecutionClaimWork } from "./pointMutationExecutionClaimSupervision";
import type { PointMutationExecutionClaimLivenessV1 } from "@flarex/persistence-postgres/transaction-execution-claim-liveness";
import type { PointMutationJournalAttemptV1, PointMutationJournalV1, PointMutationJournalBoundaryV1Error } from "./pointMutationJournal";
import type { PointMutationOccExecutionContextFactoryV1, PointMutationOccRuntimeNeutralRunnerInputV1,
  PointMutationOccRuntimeNeutralRunnerV1 } from "./storedAttemptAuthentication";
import { bindPointMutationOccJournal, capturePointMutationOccExecutionContext, capturePointMutationOccBaseExecutionContext, bindPointMutationOccExecutionContext } from "./storedAttemptAuthentication/exactPointMutationExecutionOperations";
import { captureInitialVerificationState, inspectActivatedInitialState } from "./storedAttemptAuthentication/initialPointMutationExecutionOperations";
import { captureCommitInputAuthorityPins, verifyFiniteCommitValuesEffect } from "./storedAttemptAuthentication/commitInputVerification";
import { capturePointCommitAuthorityPins, capturePointCommitSessionScalars } from "./storedAttemptAuthentication/pointCommitRuntimeModel";
import { captureFiniteRecoveryEvidence } from "./finitePointMutationRecovery";
import { applicationGrantPinsResult, sameStoredApplicationGrantEvidence } from "./storedAttemptAuthentication/commitAuthorityVerification";
import type { ApplicationMutationGrantVerificationKernelV1 } from "./applicationMutationGrantVerificationKernel";
import { decodePointMutationSessionAttemptSelectorV1Result } from "./pointMutationSessionAttemptSelector";
import { publishPointCommitWithKnownSettledSqlRetry, PointCommitKnownSettledSqlRetryExhaustedV1Error,
  readPointCommitSqlRetryTerminalRefusal } from "./storedAttemptAuthentication/finishingOperations";

export class FinitePointMutationExecutionError extends Data.TaggedError("FinitePointMutationExecutionError")<{
  readonly reason: "invalidEntry" | "closed" | "invalidFrozenAttempt" | "invalidArguments" | "unprovenRetry";
  readonly cause?: unknown;
}> {}
export class FinitePointMutationOutcomeUnresolvedError extends Data.TaggedError("FinitePointMutationOutcomeUnresolvedError")<{
  readonly primary: PointFiniteTerminalRefusal | PointCommitKnownSettledSqlRetryExhaustedV1Error;
  readonly secondary: PointCommitPublicationV1Error | PointCommitOutcomeResolutionV1Error;
}> {}

export type FinitePointMutationExecutionFailure = FinitePointMutationExecutionError |
  ApplicationPointMutationFiniteStartError |
  Result.Result.Failure<ReturnType<typeof inspectActivatedInitialState>> |
  Result.Result.Failure<ReturnType<typeof captureInitialVerificationState>> |
  Result.Result.Failure<ReturnType<typeof activateConfirmedFiniteReplacement>> |
  Result.Result.Failure<ReturnType<typeof activateConfirmedFiniteRecoveryReplacement>> |
  Result.Result.Failure<ReturnType<typeof capturePointMutationOccExecutionContext>> |
  InvalidPointMutationExecutionClaimV1Error | PointMutationExecutionLivenessV1Error | PointMutationJournalBoundaryV1Error |
  Effect.Error<ReturnType<PointMutationOccRuntimeNeutralRunnerV1["run"]>> |
  Effect.Error<ReturnType<typeof verifyFiniteCommitValuesEffect>> |
  PointCommitKnownSettledSqlRetryExhaustedV1Error |
  FinitePointMutationOutcomeUnresolvedError | PointCommitPublicationV1Error | PointMutationAttemptReplacementV1Error |
  Effect.Error<ReturnType<typeof captureFiniteRecoveryEvidence>> |
  Effect.Error<ReturnType<ApplicationMutationGrantVerificationKernelV1["verify"]>> |
  Result.Result.Failure<ReturnType<typeof applicationGrantPinsResult>> |
  Effect.Error<ReturnType<PointMutationExecutionClaimAcquisitionV1["acquireEffect"]>> |
  Effect.Error<ReturnType<PointMutationSessionAttemptTerminalizationPersistenceV1["abortEffect"]>>;
export interface AuthenticatedFiniteEntry {
  readonly activation: PointMutationSessionActivationResultV1;
  readonly applicationSelection: Result.Result.Success<ReturnType<NonNullable<PointMutationJournalV1["inspectFiniteExecutionEntry"]>>>["applicationSelection"];
  readonly runnerInput: PointMutationOccRuntimeNeutralRunnerInputV1;
  readonly journalAttempt: PointMutationJournalAttemptV1;
  readonly reopenJournalAttempt: Effect.Effect<PointMutationJournalAttemptV1, FinitePointMutationExecutionFailure>;
  readonly prepareFiniteCommit: (result: unknown) => Effect.Effect<FrozenFiniteAttempt, FinitePointMutationExecutionFailure>;
  readonly settleFiniteCommit: (frozen: FrozenFiniteAttempt) => Effect.Effect<PointCommitPublicationResultV1, FinitePointMutationExecutionFailure>;
}
export interface FinitePointMutationExecution {
  readonly runPreparedFiniteAttempt: <A, E, R>(prepared: PreparedFiniteApplicationMutationSessionActivation,
    work: (entry: AuthenticatedFiniteEntry) => Effect.Effect<A, E, R>) =>
    Effect.Effect<A, E | FinitePointMutationExecutionFailure, R>;
  readonly executePreparedFiniteAttempt: (prepared: PreparedFiniteApplicationMutationSessionActivation) =>
    Effect.Effect<PointCommitPublicationResultV1, FinitePointMutationExecutionFailure>;
  readonly retryFailedAttempt: (failure: unknown) => Effect.Effect<PointCommitPublicationResultV1, FinitePointMutationExecutionFailure>;
  readonly redispatchExactPointMutationAttempt: (selector: unknown) => Effect.Effect<PointCommitPublicationResultV1 |
    Readonly<{ kind: "busy" }>, FinitePointMutationExecutionFailure>;
}
export interface FinitePointMutationExecutionDependencies {
  readonly activation: ApplicationPointMutationSessionActivationV1;
  readonly journal: PointMutationJournalV1;
  readonly executionClaims: PointMutationExecutionClaimVaultV1;
  readonly liveness: Readonly<{ persistence: PointMutationExecutionClaimLivenessV1; heartbeatIntervalMilliseconds: number }>;
  readonly contextFactory: PointMutationOccExecutionContextFactoryV1;
  readonly runner: PointMutationOccRuntimeNeutralRunnerV1;
  readonly publisher: PointFiniteCommitPublisherPort;
  readonly replacement: PointFiniteAttemptReplacementPort;
  readonly terminalization: PointMutationSessionAttemptTerminalizationPersistenceV1;
  readonly recovery: Readonly<{ acquisition: PointMutationExecutionClaimAcquisitionV1;
    applicationGrantKernel: ApplicationMutationGrantVerificationKernelV1 }>;
}

/** The confirmed entry supplies immutable execution evidence. There is no sealed-input loader. */
export function createFinitePointMutationExecution(dependencies: FinitePointMutationExecutionDependencies): FinitePointMutationExecution {
  const { journal, executionClaims, liveness, contextFactory, runner, publisher, replacement, terminalization } = dependencies;
  const configuration = validatePointMutationExecutionLivenessConfigurationV1Result(liveness.persistence,
    { heartbeatIntervalMilliseconds: liveness.heartbeatIntervalMilliseconds });
  const prepareRunnerBase = Effect.fn("FinitePointMutationExecution.prepareRunnerBase")(function* (validatedArgsJson: unknown) {
    yield* Effect.fromResult(configuration);
    const context = yield* Effect.fromResult(capturePointMutationOccBaseExecutionContext(yield* contextFactory.make()));
    const args = yield* Effect.try({ try: () => normalizeFlarexValueJsonV1(validatedArgsJson),
      catch: cause => new FinitePointMutationExecutionError({ reason: "invalidArguments", cause }) });
    if (!isJsonObject(args.valueJson)) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidArguments" }));
    const argumentArraySemanticBytes = yield* Effect.try({ try: () => requirePointMutationArgumentSemanticSizeV1(args.semanticSizeBytes),
      catch: cause => new FinitePointMutationExecutionError({ reason: "invalidArguments", cause }) });
    return Object.freeze({ context, argumentsJson: args.valueJson, argumentArraySemanticBytes });
  });
  const retries = new WeakMap<object, { activated: ActivatedPointMutationSessionV1;
    command: PointFiniteCommitCommand; proof: FiniteAttemptNonacceptanceProof }>();
  type ReplacementRequest = Readonly<{ kind: "frozen"; command: PointFiniteCommitCommand }>
    | Readonly<{ kind: "recovered"; command: PointRecoveredFiniteAttemptReplacementCommand }>;
  const replaceOrReplay: (request: ReplacementRequest, proof: FiniteAttemptNonacceptanceProof) => Effect.Effect<
    Effect.Success<ReturnType<PointFiniteAttemptReplacementPort["replaceFinite"]>> |
      Extract<PointFiniteAttemptResolution, { kind: "committed" }>,
    Effect.Error<ReturnType<PointFiniteAttemptReplacementPort["replaceFinite"]>> | PointCommitPublicationV1Error | FinitePointMutationOutcomeUnresolvedError
  > = Effect.fn("FinitePointMutationExecution.replaceOrReplay")(
    (request: ReplacementRequest, proof: FiniteAttemptNonacceptanceProof) => {
      const command = request.command;
      return (request.kind === "recovered"
        ? replacement.replaceRecoveredFinite({ ...request.command, proof })
        : replacement.replaceFinite({ ...request.command, proof })).pipe(Effect.catchCause((cause): Effect.Effect<
        Extract<PointFiniteAttemptResolution, { kind: "committed" }>,
        Effect.Error<ReturnType<PointFiniteAttemptReplacementPort["replaceFinite"]>> |
          PointCommitPublicationV1Error | FinitePointMutationOutcomeUnresolvedError
      > => {
        // Recovery owns only a single settled typed decision. Preserve combined
        // rollback/resource failure, defect and interruption Causes unchanged.
        const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
        if (reason === undefined || !Cause.isFailReason(reason)) return Effect.failCause(cause);
        const failure = reason.error;
        if (failure instanceof PointMutationAttemptReplacementCommittedOutcomeV1Error) return Effect.gen(function* () {
          const resolution = yield* publisher.resolveFinite(command);
          if (resolution.kind === "committed") return resolution;
          if (resolution.kind === "rejected") return yield* Effect.fail(resolution.error);
          return yield* Effect.failCause(cause);
        });
        if (!isPointFiniteReplacementTerminalRefusal(failure, command, proof)) return Effect.failCause(cause);
        return publisher.resolveFinite({ ...command, terminalRefusal: failure, terminalRefusalProof: proof }).pipe(
          Effect.mapError(secondary => new FinitePointMutationOutcomeUnresolvedError({ primary: failure, secondary })),
          Effect.flatMap(resolution => resolution.kind === "committed" ? Effect.succeed(resolution) :
            resolution.kind === "rejected" ? Effect.failCause(cause) :
              Effect.die(new Error("Permanent replacement refusal produced retry authority."))),
        );
      }));
    });
  // Construction-time lifecycle builder: callers attach exact cleanup while
  // ownership is masked, before restoring interruption. Effect.fn suspends its
  // body and would defer that attachment until after the ownership handoff.
  // Execution remains inside the named start/retry/redispatch boundaries.
  const continueCommittedEntry: <A, E, R>(activated: ActivatedPointMutationSessionV1, base: Effect.Success<ReturnType<typeof prepareRunnerBase>>,
    work: (entry: AuthenticatedFiniteEntry) => Effect.Effect<A, E, R>) =>
    Effect.Effect<A, E | FinitePointMutationExecutionFailure, R> =
    <A, E, R>(activated: ActivatedPointMutationSessionV1, base: Effect.Success<ReturnType<typeof prepareRunnerBase>>, work: (entry: AuthenticatedFiniteEntry) => Effect.Effect<A, E, R>) => {
      const original = getActivatedPointMutationSessionStateV1(activated);
      let settlementRequested = false;
      return Effect.gen(function* () {
      const state = yield* Effect.fromResult(inspectActivatedInitialState(activated));
      const finite = original?.finiteEntry;
      if (finite === undefined || finite.journal !== journal || finite.executionClaim !== state.executionClaim ||
        state.prepared.executionAuthorityGeneration !== "application_v1" || !("grant" in state.prepared.evidence) || journal.inspectFiniteExecutionEntry === undefined ||
        journal.openConfirmedFiniteEntry === undefined || journal.freezeFiniteAttempt === undefined)
        return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
      const grant = state.prepared.evidence.grant;
      const captured = yield* Effect.fromResult(journal.inspectFiniteExecutionEntry(finite.capture, finite.preparation));
      const verification = yield* Effect.fromResult(captureInitialVerificationState(state));
      const scope = yield* Effect.fromResult(executionClaims.admission.admit(state.executionClaim, "execute"));
      const claim = yield* Effect.fromResult(executionClaims.admission.inspect(scope, "execute"));
      const anchor = state.inspection.anchor;
      if (captured.context.anchor.deploymentId !== anchor.deploymentId || captured.context.anchor.scopeId !== anchor.scopeId ||
        captured.context.anchor.sessionId !== anchor.sessionId || captured.context.anchor.attemptFence !== anchor.attemptFence ||
        claim.selector.deploymentId !== anchor.deploymentId || claim.selector.scopeId !== anchor.scopeId ||
        claim.selector.sessionId !== anchor.sessionId || claim.selector.attemptFence !== anchor.attemptFence)
        return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
      const openEntry = journal.openConfirmedFiniteEntry.bind(journal);
      const freeze = journal.freezeFiniteAttempt.bind(journal);
      return yield* superviseExecutionClaimWork(Effect.suspend(() => liveness.persistence.renewEffect({ selector: claim.selector,
        executionClaim: { claimOwner: claim.observation.claimOwner, claimFence: claim.observation.claimFence } })),
        liveness.heartbeatIntervalMilliseconds, "execute", control => Effect.gen(function* () {
        const attempt = yield* openEntry(finite.capture, finite.preparation, scope, state.executionClaim);
        let open = true;
        return yield* Effect.gen(function* () {
          const context = bindPointMutationOccExecutionContext(base.context,
            AppCreationTimeV1Schema.make(captured.context.databaseNow.getTime()), anchor.attemptFence, anchor.snapshotToken);
          const runnerInput: PointMutationOccRuntimeNeutralRunnerInputV1 = Object.freeze({ executionAuthorityGeneration: "application_v1",
            argumentsJson: base.argumentsJson, argumentArraySemanticBytes: base.argumentArraySemanticBytes, schemaManifest: captured.schemaManifest,
            stableBindings: captured.stableBindings, application: captured.applicationEvidence,
            verifiedGrant: { evidence: grant, verifiedAtEpochMilliseconds: captured.context.databaseNow.getTime() },
            context, journal: bindPointMutationOccJournal(journal, attempt) });
          const accepted = new WeakSet<FrozenFiniteAttempt>();
          const prepareFiniteCommit: AuthenticatedFiniteEntry["prepareFiniteCommit"] = Effect.fn("FinitePointMutationExecution.prepare")(
            function* (result) {
              if (!open) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "closed" }));
              const frozen = yield* freeze(attempt, result);
              const data = borrowFrozenFiniteCommitValues(frozen);
              if (data === undefined) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidFrozenAttempt" }));
              yield* verifyFiniteCommitValuesEffect({ rowIntents: data.rowIntents, successfulResult: data.successfulResult,
                schemaManifest: captured.schemaManifest, functionValidationAuthority: {
                  path: captured.applicationEvidence.runtimeTarget.function.path,
                  returnsValidator: captured.applicationEvidence.runtimeTarget.function.returns,
                } });
              accepted.add(frozen);
              return frozen;
            });
          const settleFiniteCommit: AuthenticatedFiniteEntry["settleFiniteCommit"] = Effect.fn("FinitePointMutationExecution.settle")(
            function* (frozenAttempt) {
              if (!open || !accepted.has(frozenAttempt)) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidFrozenAttempt" }));
              const command = Object.freeze({ authorityPins: capturePointCommitAuthorityPins(captureCommitInputAuthorityPins(verification.authority, verification.session)),
                session: capturePointCommitSessionScalars(verification.session), executionClaim: claim.observation, frozenAttempt } satisfies PointFiniteCommitCommand);
              settlementRequested = true;
              // This settlement owner reconciles every typed publication failure:
              // a failed acknowledgement may follow a durable COMMIT. It grants
              // no retry from the failure itself. Only OCC/uncertain decisions
              // plus exact locked nonacceptance produce a ticket; every permanent
              // refusal closes the durable anchor. Defects/interruption keep Cause.
              // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: lifecycle - reconciles every typed publication failure before durable retry or terminal disposition
              return yield* control.enterSettlement(publishPointCommitWithKnownSettledSqlRetry(publisher.publishFinite(command)).pipe(Effect.catch(primary =>
                Effect.gen(function* () {
                  const rootRetryEligible = primary instanceof PointCommitConflictV1Error || primary instanceof PointCommitDecisionUncertainV1Error;
                  const terminalRefusal = rootRetryEligible ? undefined : primary instanceof PointCommitKnownSettledSqlRetryExhaustedV1Error
                    ? readPointCommitSqlRetryTerminalRefusal(primary) : primary;
                  if (!rootRetryEligible && terminalRefusal === undefined) return yield* Effect.die(
                    new Error("SQL retry exhaustion lost its actual publisher refusal."));
                  const resolution = yield* publisher.resolveFinite({ ...command,
                    ...(terminalRefusal === undefined ? {} : { terminalRefusal }) }).pipe(
                    Effect.mapError(secondary => new FinitePointMutationOutcomeUnresolvedError({ primary, secondary })));
                  if (resolution.kind === "noncommit") {
                    if (!rootRetryEligible) return yield* Effect.die(new Error("Permanent publication refusal produced retry authority."));
                    retries.set(primary, { activated, command, proof: resolution.proof });
                    return yield* Effect.fail(primary);
                  }
                  if (resolution.kind === "rejected") return yield* Effect.fail(
                    primary instanceof PointCommitKnownSettledSqlRetryExhaustedV1Error ? primary : resolution.error);
                  const outcome = resolution.outcome;
                  return outcome.kind === "expired" ? Object.freeze({ kind: "expired" as const, token: outcome.token }) :
                    Object.freeze({ kind: "replayed" as const, token: outcome.token, successfulResult: outcome.successfulResult });
                }))));
            });
          const entry: AuthenticatedFiniteEntry = Object.freeze({ activation: state.inspection, applicationSelection: captured.applicationSelection,
            runnerInput, journalAttempt: attempt, prepareFiniteCommit, settleFiniteCommit,
            reopenJournalAttempt: Effect.suspend((): Effect.Effect<PointMutationJournalAttemptV1, FinitePointMutationExecutionFailure> => open ? openEntry(finite.capture, finite.preparation, scope, state.executionClaim) :
              Effect.fail(new FinitePointMutationExecutionError({ reason: "closed" }))) });
          return yield* Effect.suspend(() => work(entry));
        }).pipe(Effect.onExit(() => journal.discardTentativeRoot(attempt)),
          Effect.ensuring(Effect.sync(() => { open = false; })));
      }));
      }).pipe(Effect.onExit(() => original?.finiteEntry === undefined || original.inspection.status !== "created" || settlementRequested
        ? Effect.void : terminalization.abortEffect({ selector: { deploymentId: original.inspection.anchor.deploymentId,
          scopeId: original.inspection.anchor.scopeId, sessionId: original.inspection.anchor.sessionId,
          attemptFence: original.inspection.anchor.attemptFence }, expectedSnapshotToken: original.inspection.anchor.snapshotToken,
          executionClaim: original.inspection.executionClaim })));
    };
  const runPreparedFiniteAttempt: FinitePointMutationExecution["runPreparedFiniteAttempt"] =
    Effect.fn("FinitePointMutationExecution.runPreparedAttempt")(function* <A, E, R>(
      prepared: PreparedFiniteApplicationMutationSessionActivation,
      work: (entry: AuthenticatedFiniteEntry) => Effect.Effect<A, E, R>,
    ) {
      const base = yield* prepareRunnerBase(prepared.evidence.validatedArgsJson);
      return yield* dependencies.activation.withFiniteStart(prepared, activated => continueCommittedEntry(activated, base, work));
    });
  const executeCommittedEntry: (activated: ActivatedPointMutationSessionV1, base: Effect.Success<ReturnType<typeof prepareRunnerBase>>) =>
    Effect.Effect<PointCommitPublicationResultV1, FinitePointMutationExecutionFailure> =
    (activated, base) => continueCommittedEntry(activated, base, entry =>
      runner.run(entry.runnerInput).pipe(Effect.flatMap(entry.prepareFiniteCommit), Effect.flatMap(entry.settleFiniteCommit)));
  const executePreparedFiniteAttempt: FinitePointMutationExecution["executePreparedFiniteAttempt"] =
    prepared => runPreparedFiniteAttempt(prepared, entry =>
      runner.run(entry.runnerInput).pipe(Effect.flatMap(entry.prepareFiniteCommit), Effect.flatMap(entry.settleFiniteCommit)));
  const retryFailedAttempt: FinitePointMutationExecution["retryFailedAttempt"] = Effect.fn("FinitePointMutationExecution.retry")(
    function* (failure) {
      const ticket = typeof failure === "object" && failure !== null ? retries.get(failure) : undefined;
      if (ticket === undefined || typeof failure !== "object" || failure === null) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "unprovenRetry" }));
      retries.delete(failure);
      const original = getActivatedPointMutationSessionStateV1(ticket.activated);
      if (original === undefined) return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
      const base = yield* prepareRunnerBase(original.prepared.evidence.validatedArgsJson);
      yield* finiteOccRetryBackoff(ticket.command.authorityPins.attemptFence);
      return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        const replaced = yield* restore(replaceOrReplay({ kind: "frozen", command: ticket.command }, ticket.proof));
        if (replaced.kind === "committed") return recoveredFinitePublication(replaced);
        const fresh = yield* Effect.fromResult(activateConfirmedFiniteReplacement(ticket.activated, replaced, journal, executionClaims.issuer));
        return yield* restore(continueCommittedEntry(fresh, base, entry =>
          runner.run(entry.runnerInput).pipe(Effect.flatMap(entry.prepareFiniteCommit), Effect.flatMap(entry.settleFiniteCommit))));
      }));
    });
  const redispatchExactPointMutationAttempt: FinitePointMutationExecution["redispatchExactPointMutationAttempt"] =
    Effect.fn("FinitePointMutationExecution.redispatch")(function* (selector) {
      const exactSelector = yield* Effect.fromResult(decodePointMutationSessionAttemptSelectorV1Result(selector)).pipe(
        Effect.mapError(cause => new PointMutationExecutionClaimAcquisitionInputV1Error({ reason: "invalidSelector", cause })));
      const acquisition = yield* dependencies.recovery.acquisition.acquireEffect(exactSelector);
      if (acquisition.kind === "busy") return Object.freeze({ kind: "busy" as const });
      if (acquisition.kind === "replayed") {
        const outcome = acquisition.outcome;
        return outcome.kind === "expired" ? Object.freeze({ kind: "expired" as const, token: outcome.token }) :
          Object.freeze({ kind: "replayed" as const, token: outcome.token, successfulResult: outcome.successfulResult });
      }
      if (acquisition.kind !== "finiteRecovery") return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
      const evidence = yield* captureFiniteRecoveryEvidence(acquisition.capture);
      const resolved = yield* publisher.resolveFinite(evidence.command);
      if (resolved.kind === "rejected") return yield* Effect.fail(resolved.error);
      if (resolved.kind === "committed") {
        const outcome = resolved.outcome;
        return outcome.kind === "expired" ? Object.freeze({ kind: "expired" as const, token: outcome.token }) :
          Object.freeze({ kind: "replayed" as const, token: outcome.token, successfulResult: outcome.successfulResult });
      }
      const base = yield* prepareRunnerBase(evidence.prepared.evidence.validatedArgsJson);
      yield* finiteOccRetryBackoff(evidence.command.authorityPins.attemptFence);
      return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const replaced = yield* restore(replaceOrReplay({ kind: "recovered", command: evidence.command }, resolved.proof));
      if (replaced.kind === "committed") return recoveredFinitePublication(replaced);
      if (replaced.kind !== "replaced" || replaced.finiteEntry === undefined || journal.inspectFiniteExecutionEntry === undefined)
        return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
      const fresh = yield* Effect.fromResult(journal.inspectFiniteExecutionEntry(replaced.finiteEntry.capture, replaced.finiteEntry.preparation));
      const activated = yield* restore(Effect.gen(function* () {
        const expectedLogicalPins = yield* Effect.fromResult(applicationGrantPinsResult(evidence.verification, fresh.applicationEvidence));
        const verified = yield* dependencies.recovery.applicationGrantKernel.verify({ jws: evidence.context.session.authorizationGrantJson,
          expectedLogicalPins, trustedNowEpochMilliseconds: fresh.context.databaseNow.getTime() });
        const row = evidence.context.session;
        if (row.authorizationGrantJson === null || row.authorizationGrantCanonicalBytes === null ||
          row.validatedArgsJson === null || row.validatedArgsCanonicalBytes === null ||
          !sameStoredApplicationGrantEvidence({ ...evidence.verification.session, authorizationGrantJson: row.authorizationGrantJson,
            authorizationGrantCanonicalBytes: row.authorizationGrantCanonicalBytes, validatedArgsJson: row.validatedArgsJson,
            validatedArgsCanonicalBytes: row.validatedArgsCanonicalBytes }, verified))
          return yield* Effect.fail(new FinitePointMutationExecutionError({ reason: "invalidEntry" }));
        return yield* Effect.fromResult(activateConfirmedFiniteRecoveryReplacement(acquisition.capture,
          { ...evidence.prepared, evidence: { ...evidence.prepared.evidence, grant: verified.evidence } }, replaced, journal, executionClaims.issuer));
      }).pipe(Effect.onExit(exit => Exit.isFailure(exit) ? terminalization.abortEffect({ selector: { deploymentId: fresh.context.anchor.deploymentId,
        scopeId: fresh.context.anchor.scopeId, sessionId: fresh.context.anchor.sessionId, attemptFence: fresh.context.anchor.attemptFence },
        expectedSnapshotToken: fresh.context.anchor.snapshotToken, executionClaim: replaced.executionClaim }) : Effect.void)));
      return yield* restore(executeCommittedEntry(activated, base));
      }));
    });
  return Object.freeze({ runPreparedFiniteAttempt, executePreparedFiniteAttempt, retryFailedAttempt, redispatchExactPointMutationAttempt });
}

const finiteOccRetryBackoff = Effect.fn("FinitePointMutationExecution.occBackoff")(function* (attemptFence: bigint) {
  const upperBoundMilliseconds = Math.min(100 * 2 ** Number(attemptFence - 1n), 2_000);
  const random = yield* Random.next;
  yield* Effect.sleep(Duration.millis(random * upperBoundMilliseconds));
});

function recoveredFinitePublication(resolution: Extract<PointFiniteAttemptResolution, { kind: "committed" }>): PointCommitPublicationResultV1 {
  const outcome = resolution.outcome;
  return outcome.kind === "expired" ? Object.freeze({ kind: "expired", token: outcome.token }) :
    Object.freeze({ kind: "replayed", token: outcome.token, successfulResult: outcome.successfulResult });
}
