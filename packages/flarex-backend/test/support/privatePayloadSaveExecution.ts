import { Effect, Result, Scope } from "effect";
import { createFinitePointMutationExecution, type FinitePointMutationExecution } from "../../../executor/src/mutation/execution/finitePointMutationExecution";
import { createPointMutationJournalV1, type PointMutationJournalV1, type PointMutationJournalAdmittedParticipantV1 } from "../../../executor/src/mutation/journal/pointMutationJournal";
import { createPointMutationExecutionClaimVaultV1 } from "../../../executor/src/mutation/claims/pointMutationExecutionClaim";
import { createApplicationPointMutationSessionActivationV1 } from "../../../executor/src/mutation/session/pointMutationSessionActivation";
import { createApplicationMutationGrantVerificationKernelV1 } from "../../../executor/src/mutation/authentication/applicationMutationGrantVerificationKernel";
import type { PointMutationOccRuntimeNeutralRunnerV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import { createApplicationMutationSessionActivationPersistenceV1, createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1 } from "@flarex/persistence-postgres/internal/session-construction";
import type { PreparedFiniteApplicationMutationSessionActivation } from "@flarex/persistence-postgres/internal/session";
import { createPointMutationExecutionClaimLivenessV1 } from "../../../persistence-postgres/src/execution/claims/transactionExecutionClaimLiveness";
import { createPointMutationAttemptReplacementPortV1 } from "../../../persistence-postgres/src/commit/point/construction";
import { PointMutationAttemptReplacementFiniteEntryError } from "../../../persistence-postgres/src/commit/point/errors";
import { LogicalParticipantInvocationError } from "../../../persistence-postgres/src/storage/documents/logicalDocuments/participantErrors";
import { cmsError } from "../../../persistence-postgres/src/frameworks/cmsTransaction/model";
import { deriveApplicationSyscallValidator } from "../../../persistence-postgres/src/application/revision/applicationRevisionSyscallValidatorV1";
import { readPreparedFiniteApplicationMutationInputs } from "../../../persistence-postgres/src/application/applicationMutationAdmission";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../../../persistence-postgres/test/execution/session/support/activationEvidence";
import type { PrivatePayloadSaveFixture, PrivateSavePreparation, PrivatePayloadSaveRoot } from "./privatePayloadSaveFixture";
import { makePrivatePayloadSaveConsumer } from "../../src/privatePayloadSaveConsumer";
import { makePrivatePayloadReverseReadConsumer, makePrivatePayloadReverseReadConsumerWithRuntime } from "../../src/privatePayloadReverseReadConsumer";
import type { PrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import type { PointMutationOccBoundJournalV1 } from "../../../executor/src/mutation/authentication/storedAttemptAuthentication";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";

type PolicyFixture = PrivatePayloadSaveFixture["fixture"];
type Confirmed = Result.Result.Success<ReturnType<PolicyFixture["store"]["confirmedFiniteEntryAttempt"]>>;
export interface PrivateSaveExecution {
  readonly owner: FinitePointMutationExecution;
  readonly prepared: PreparedFiniteApplicationMutationSessionActivation;
  readonly currentRoot: () => Pick<PrivatePayloadSaveRoot, "attempt" | "validator" | "principal" | "admissions"> & { readonly context: Confirmed["context"] };
  readonly selectProfile: (revision: string) => void;
  readonly selectReadProfile: (revision: string) => void;
  readonly bindServing: (policyId: AppDocumentIdV1, bound: PointMutationOccBoundJournalV1) => ReturnType<typeof makePrivatePayloadSaveConsumer>;
  readonly bindReverseServing: (policyId: AppDocumentIdV1, bound: PointMutationOccBoundJournalV1, profile: PrivateReverseReadProfile,
    makeNative?: Parameters<typeof makePrivatePayloadReverseReadConsumerWithRuntime>[2]) => ReturnType<typeof makePrivatePayloadReverseReadConsumer>;
}
type ConstructionFailure = Effect.Error<ReturnType<PolicyFixture["prepareEvidence"]>> |
  Effect.Error<ReturnType<typeof deriveApplicationSyscallValidator>> |
  Result.Result.Failure<ReturnType<typeof readPreparedFiniteApplicationMutationInputs>>;

/** Composition only. The real executor owns entry, liveness, retry tickets,
 * replacement, terminalization and recovery. The test supplies native work. */
export const makePrivateSaveExecution: (fixture: PrivatePayloadSaveFixture, preparation: PrivateSavePreparation,
  runner: PointMutationOccRuntimeNeutralRunnerV1, onNative?: (method: string) => void,
  beforePublication?: (command: Parameters<ReturnType<PolicyFixture["makePublisher"]>["publishFinite"]>[0]) => Promise<void>,
  replacementPreparation?: PrivatePayloadSaveFixture["withPreparation"],
  admittedBorrows?: ReadonlyMap<string, PointMutationJournalAdmittedParticipantV1["borrow"]>,
) => Effect.Effect<PrivateSaveExecution, ConstructionFailure> =
  Effect.fn("PrivatePayloadSaveFixture.execution")(function* (fixture, preparation, runner, onNative, beforePublication, replacementPreparation, admittedBorrows) {
    const policy = fixture.fixture;
    const authority = policy.application.pointCommitAuthority;
    const inputs = yield* Effect.fromResult(readPreparedFiniteApplicationMutationInputs(preparation.preparedAdmission, policy.context));
    const validator = yield* Scope.provide(policy.scope)(deriveApplicationSyscallValidator({
      scopeId: policy.application.authority.scopeId, schemaVersionId: inputs.schema.schemaVersionId, schemaManifest: inputs.schema.manifest,
    }));
    const evidence = yield* policy.prepareEvidence();
    const claims = createPointMutationExecutionClaimVaultV1();
    const participants = (fresh: PrivateSavePreparation): readonly PointMutationJournalAdmittedParticipantV1[] =>
      fresh.participants.map(selection => ({ participant: selection.participant, admission: selection,
        // The ordinary facade is deliberately unavailable. Only the private
        // capability selected after the protected read lends a native writer.
        borrow: admittedBorrows?.get(selection.participant) ?? (() => Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: cmsError("unsupportedProfile") }))) }));
    const observed = onNative === undefined ? policy.store : { ...policy.store,
      runAdmittedOperationEffect: (...args: Parameters<PolicyFixture["store"]["runAdmittedOperationEffect"]>) => {
        const borrow = args[3];
        return policy.store.runAdmittedOperationEffect(args[0], args[1], args[2], input => borrow(input).pipe(
          Effect.map(borrowed => ({ ...borrowed, invoke: (method, value) =>
            Effect.sync(() => onNative(method)).pipe(Effect.andThen(borrowed.invoke(method, value))) }))));
      } };
    const base = createPointMutationJournalV1(observed, claims.admission, validator, participants(preparation), "finiteRoot");
    const open = base.openConfirmedFiniteEntry;
    const prepareEntry = base.prepareFiniteEntry;
    const inspect = base.inspectFiniteExecutionEntry;
    if (open === undefined || prepareEntry === undefined || inspect === undefined) return yield* Effect.die(new Error("Missing genuine finite journal owner"));
    let current: Confirmed | undefined;
    let currentHandle: Effect.Success<ReturnType<typeof open>> | undefined;
    const journal: PointMutationJournalV1 = { ...base,
      openConfirmedFiniteEntry: Effect.fn("PrivatePayloadSaveFixture.observeEntry")(function* (capture, prepared, scope, original) {
        const handle = yield* open(capture, prepared, scope, original);
        current = yield* Effect.fromResult(inspect(capture, prepared));
        currentHandle = handle;
        return handle;
      }) };
    let profileFactory = preparation.payloadProfile;
    let profiles = preparation.profiles;
    let readProfiles = preparation.profiles.filter(profile => profile.participant !== "payload");
    const publisher = {
      publishFinite: (command: Parameters<ReturnType<PolicyFixture["makePublisher"]>["publishFinite"]>[0]) =>
        Effect.gen(function* () {
          // Test observation/barrier over the authentic frozen command. A
          // rejected observer is a test defect, never publication policy.
          if (beforePublication !== undefined) yield* Effect.promise(() => beforePublication(command));
          return yield* policy.makePublisher({ logicalOperationProfiles: profiles }).publishFinite(command);
        }),
      resolveFinite: (command: Parameters<ReturnType<PolicyFixture["makePublisher"]>["resolveFinite"]>[0]) =>
        policy.makePublisher().resolveFinite(command),
    };
    const finiteEntry = Effect.fn("PrivatePayloadSaveFixture.prepareReplacement")(function* () {
      return yield* (replacementPreparation ?? fixture.withPreparation)(fresh => Effect.gen(function* () {
        const selected = yield* Effect.fromResult(readPreparedFiniteApplicationMutationInputs(fresh.preparedAdmission, policy.context));
        profileFactory = fresh.payloadProfile;
        readProfiles = fresh.profiles.filter(profile => profile.participant !== "payload");
        return { application: selected.application, prepareEntry: () => prepareEntry(participants(fresh)).pipe(
          Effect.mapError(cause => new PointMutationAttemptReplacementFiniteEntryError({ cause }))) };
      }));
    }, Effect.mapError(cause => new PointMutationAttemptReplacementFiniteEntryError({ cause })));
    const owner = createFinitePointMutationExecution({ journal, executionClaims: claims, publisher, runner,
      contextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(), logScopeId: crypto.randomUUID(),
        randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) },
      activation: createApplicationPointMutationSessionActivationV1(createApplicationMutationSessionActivationPersistenceV1(authority,
        { leaseDurationMilliseconds: 240_000 }), claims.issuer, journal),
      replacement: createPointMutationAttemptReplacementPortV1(authority, { ...policy.publisherOptions,
        leaseDurationMilliseconds: 240_000, executionClaimDurationMilliseconds: 60_000, finiteEntry }),
      terminalization: createPointMutationSessionAttemptTerminalizationPersistenceV1(authority),
      liveness: { persistence: createPointMutationExecutionClaimLivenessV1(authority, {
        claimDurationMilliseconds: 60_000, leaseRenewalDurationMilliseconds: 240_000, grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        finiteApplication: { prepared: preparation.preparedAdmission, context: policy.context },
      }), heartbeatIntervalMilliseconds: 20_000 },
      recovery: { acquisition: createPointMutationExecutionClaimAcquisitionV1(authority, { durationMilliseconds: 60_000 }),
        applicationGrantKernel: createApplicationMutationGrantVerificationKernelV1({ deploymentId: evidence.deploymentId,
          keys: [evidence.verificationKey], grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1 }) },
    });
    return { owner, prepared: { deploymentId: evidence.deploymentId, scopeId: evidence.scopeId, evidence: evidence.evidence,
      preparedAdmission: preparation.preparedAdmission, admissionContext: policy.context, currentEntry: preparation.currentEntry },
      currentRoot: () => {
        if (current === undefined) throw new Error("No genuine executor entry has opened");
        return { attempt: current.attempt, context: current.context, validator, admissions: current.admissions,
          principal: { scopeId: current.context.anchor.scopeId, principalDigest: current.context.principalDigest } };
      },
      selectProfile: revision => { profiles = [profileFactory(revision)]; },
      selectReadProfile: revision => { profiles = [...readProfiles, profileFactory(revision)]; },
      bindReverseServing: Effect.fn("PrivatePayloadSaveFixture.bindReverseServing")(function* (policyId: AppDocumentIdV1,
        bound: PointMutationOccBoundJournalV1, profile: PrivateReverseReadProfile,
        makeNative?: Parameters<typeof makePrivatePayloadReverseReadConsumerWithRuntime>[2]) {
        if (current === undefined || currentHandle === undefined) return yield* Effect.die(new Error("Missing genuine serving entry"));
        const root = current;
        const input: Parameters<typeof makePrivatePayloadReverseReadConsumer>[1] = { store: policy.store, attempt: root.attempt, validator,
          principal: { scopeId: root.context.anchor.scopeId, principalDigest: root.context.principalDigest },
          owner: journal, journalAttempt: currentHandle, journal: bound, policy: { tableName: "audit", documentId: policyId },
          selection: { participant: "payload", collection: "posts", relation: "featuredProduct", productId: profile.productId, nativeProfileRevision: "1".repeat(64) },
          target: { participant: "medusa.product", access: profile.target } };
        const consumer = makeNative === undefined ? makePrivatePayloadReverseReadConsumer(fixture.compiled, input) :
          makePrivatePayloadReverseReadConsumerWithRuntime(fixture.compiled, input, makeNative);
        return yield* consumer.pipe(Effect.tap(selected => Effect.sync(() => { profiles = [...readProfiles, profileFactory(selected.profileRevision)]; })));
      }),
      bindServing: (policyId, bound) => Effect.suspend(() => {
        if (current === undefined || currentHandle === undefined) return Effect.die(new Error("Missing genuine serving entry"));
        const root = current;
        return makePrivatePayloadSaveConsumer(fixture.compiled, { store: policy.store, attempt: root.attempt, validator,
          principal: { scopeId: root.context.anchor.scopeId, principalDigest: root.context.principalDigest },
          owner: journal, journalAttempt: currentHandle, journal: bound,
          policy: { tableName: "audit", documentId: policyId },
          selection: { participant: "payload", collection: "posts", relation: "featuredProduct", nativeProfileRevision: "1".repeat(64) },
        }).pipe(Effect.tap(consumer => Effect.sync(() => { profiles = [profileFactory(consumer.profileRevision)]; })));
      }) };
  });
