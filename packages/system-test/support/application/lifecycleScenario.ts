import {
  composeApplicationNativeMutationReadiness,
  inspectApplicationNativeMutationLifecycleForTest,
  type ApplicationNativeMutationFixture,
  type ApplicationNativeMutationPersistence,
} from "@flarex/persistence-postgres/internal/system-test/application-native-mutation-fixture";
import {
  constructApplicationLegacyServingOwners,
} from "@flarex/persistence-postgres/internal/application-serving";
import {
  makeApplicationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation-construction";
import { ApplicationActivationError, claimApplicationActiveSelection } from "@flarex/persistence-postgres/internal/application-activation";
import {
  installAppSchemaCandidateValidationEffect,
  advanceAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "@flarex/persistence-postgres/internal/app-schema-candidate-validation";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedReadCommittedAttemptTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import { createLocatedPointMutationSessionActivationTargetV1 } from "@flarex/persistence-postgres/transaction-session-activation";
import { LocatedReadCommittedTransactionFailureV1 } from "@flarex/persistence-postgres/internal/read-committed-transaction-failure";
import { prepareStandardApplicationDefinitionV1 } from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Cause, Effect, Exit, Result } from "effect";
import { expect } from "vitest";
import {
  makeStandardApplicationCurrentAnalysisV1,
  MiniflareApplicationAnalysisWorkerLoader,
  produceStandardApplicationCurrentSourceBundleV1,
} from "../standardApplicationCurrentAnalysisHarness";
import { runSystemTestEffectV1 } from "../systemTestEffectBoundaryV1";

export const APPLICATION_LIFECYCLE_OPTIONS = Object.freeze({
  runtimeHostIdentity: "flarex-application-runtime-host-v1",
  compatibilityDate: "2026-06-14",
});

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type Active = Effect.Success<ReturnType<Fixture["activation"]["readActive"]>>;
type Ready = Effect.Success<ReturnType<Fixture["readiness"]["settle"]>>;
type Activated = Effect.Success<ReturnType<Fixture["activation"]["activate"]>>;
type ActivationFailure = Effect.Error<ReturnType<Fixture["activation"]["activate"]>>;

export interface ApplicationLifecycleProof {
  readonly prior: Active;
  readonly second: Awaited<ReturnType<Fixture["registerRevision"]>>;
  readonly notReady: Ready;
  readonly pending: Ready;
  readonly ready: Ready;
  readonly readyReplay: Ready;
  readonly inserted: Activated;
  readonly replay: Activated;
  readonly uncertain: Exit.Exit<Activated, ActivationFailure>;
  readonly recovered: Activated;
  readonly finalActive: Active;
  readonly faultCauses: ReadonlyArray<Cause.Cause<ActivationFailure>>;
  readonly afterRecovery: Awaited<ReturnType<typeof inspectApplicationNativeMutationLifecycleForTest>>;
  readonly analysisWorkerLoads: number;
}

/** Current lifecycle composition; historical FSV frames and outcomes are separate. */
export async function proveApplicationLifecycle(createFixture: () => Promise<Fixture>): Promise<ApplicationLifecycleProof> {
  const fixture = await createFixture();
  const loader = new MiniflareApplicationAnalysisWorkerLoader();
  try {
    const prior = await runSystemTestEffectV1(fixture.activation.readActive());
    const register = async (ordinal: number) => {
      const definition = Result.getOrThrow(prepareStandardApplicationDefinitionV1(lifecycleDefinition(ordinal)));
      const source = await produceStandardApplicationCurrentSourceBundleV1(definition);
      const beforeLoads = loader.loads;
      const registered = await fixture.registerRevision({
        requestKey: `current-lifecycle:${ordinal}`,
        analysis: makeStandardApplicationCurrentAnalysisV1(source, loader, "current-lifecycle"),
      });
      // The actual analysis host cold-loads twice to prove deterministic registration.
      expect(loader.loads).toBe(beforeLoads + 2);
      return registered;
    };
    const second = await register(2);
    const input = { deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      revisionId: second.publication.revisionId };
    const beforeReadiness = await inspectApplicationNativeMutationLifecycleForTest(fixture, input.revisionId);
    const notReady = await runSystemTestEffectV1(fixture.readiness.settle(input));
    expect(notReady).toMatchObject({ status: "not_ready", reason: "candidateValidationWrongSchema" });
    const notReadyActivation = await runSystemTestEffectV1(Effect.result(fixture.activation.activate({
      revisionId: input.revisionId, expectedActiveHead: prior.expectedActiveHead,
    })));
    expect(Result.isFailure(notReadyActivation)).toBe(true);
    if (Result.isFailure(notReadyActivation)) expect(notReadyActivation.failure).toMatchObject({ reason: "notReady" });
    const schema = await fixture.preparePublishedSchema(second.manifest);
    const validationInput = { deploymentId: input.deploymentId, scopeId: input.scopeId,
      schemaVersionId: schema.schemaVersionId };
    await runSystemTestEffectV1(installAppSchemaCandidateValidationEffect(fixture.candidateValidation, validationInput));
    const pending = await runSystemTestEffectV1(fixture.readiness.settle(input));
    expect(pending).toMatchObject({ status: "not_ready", reason: "candidateValidationInProgress" });
    for (let step = 0; ; step += 1) {
      if (step === 64) throw new Error("Current lifecycle validation did not converge.");
      const advanced = await runSystemTestEffectV1(advanceAppSchemaCandidateValidationEffect(fixture.candidateValidation, validationInput));
      if (advanced.disposition !== "readyToSettle") continue;
      await runSystemTestEffectV1(settleAppSchemaCandidateValidationEffect(fixture.candidateValidation, validationInput));
      break;
    }
    const ready = await runSystemTestEffectV1(fixture.readiness.settle(input));
    expect(ready).toMatchObject({ status: "ready", disposition: "inserted" });
    const afterReadiness = await inspectApplicationNativeMutationLifecycleForTest(fixture, input.revisionId);
    expect(afterReadiness.history).toEqual(beforeReadiness.history);
    expect(afterReadiness.heads).toEqual(beforeReadiness.heads);
    expect(afterReadiness.readiness).toHaveLength(1);
    expect(afterReadiness.revisionSchemas).toHaveLength(1);
    expect((await runSystemTestEffectV1(fixture.activation.readActive())).expectedActiveHead).toEqual(prior.expectedActiveHead);

    const coldReadiness = composeApplicationNativeMutationReadiness(APPLICATION_LIFECYCLE_OPTIONS,
      fixture.control, fixture.authorityPorts, fixture.sessionAuthority).readiness;
    const readyReplay = await runSystemTestEffectV1(coldReadiness.settle(input));
    expect(readyReplay).toMatchObject({ ...ready, disposition: "replayed" });
    const activationContext = { activation: fixture.activationProfile, deploymentId: fixture.deploymentId,
      scopeId: fixture.authority.scopeId, readiness: coldReadiness, authority: fixture.authorityPorts };
    const request = { revisionId: input.revisionId, expectedActiveHead: prior.expectedActiveHead };
    const copiedIssuer = makeApplicationActivationRepository({ ...activationContext,
      readiness: Object.freeze({ ...coldReadiness }) });
    const copiedIssuerResult = await runSystemTestEffectV1(Effect.result(copiedIssuer.activate(request)));
    expect(Result.isFailure(copiedIssuerResult)).toBe(true);
    if (Result.isFailure(copiedIssuerResult)) expect(copiedIssuerResult.failure).toMatchObject({ reason: "invalidComposition" });
    expect(await inspectApplicationNativeMutationLifecycleForTest(fixture, input.revisionId)).toEqual(afterReadiness);
    const faultCauses: Array<Cause.Cause<ActivationFailure>> = [];
    for (const boundary of ["activationInserted", "headWritten"] as const) {
      const defect = new Error(`current-lifecycle:${boundary}`);
      const faulty = makeApplicationActivationRepository({ ...activationContext,
        faultAfter: point => { if (point === boundary) throw defect; } });
      const exit = await runSystemTestEffectV1(Effect.exit(faulty.activate(request)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.findErrorOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ApplicationActivationError);
          if (failure.value instanceof ApplicationActivationError) {
            expect(failure.value.reason).toBe("resourceFailure");
            expect(failure.value.cause).toBe(defect);
          }
        }
        faultCauses.push(exit.cause);
      }
      const after = await inspectApplicationNativeMutationLifecycleForTest(fixture, input.revisionId);
      expect(after).toEqual(afterReadiness);
    }
    const coldActivation = makeApplicationActivationRepository(activationContext);
    const inserted = await runSystemTestEffectV1(coldActivation.activate(request));
    const replay = await runSystemTestEffectV1(makeApplicationActivationRepository(activationContext).activate(request));
    expect(inserted).toMatchObject({ disposition: "inserted", activationSequence: prior.basis.activationSequence + 1n });
    expect(replay).toMatchObject({ ...inserted, disposition: "replayed" });
    const secondActive = await runSystemTestEffectV1(coldActivation.readActive());
    expect(secondActive.basis.revisionId).toBe(input.revisionId);
    expect(Result.isSuccess(claimApplicationActiveSelection(secondActive.selection))).toBe(true);
    expect(Result.isFailure(claimApplicationActiveSelection({ ...secondActive.selection }))).toBe(true);

    const third = await register(3);
    const thirdInput = { ...input, revisionId: third.publication.revisionId };
    const thirdReady = await runSystemTestEffectV1(fixture.readiness.settle(thirdInput));
    expect(thirdReady.status).toBe("ready");
    const beforeUncertain = await inspectApplicationNativeMutationLifecycleForTest(fixture, thirdInput.revisionId);
    const stale = await runSystemTestEffectV1(Effect.result(coldActivation.activate({
      revisionId: thirdInput.revisionId, expectedActiveHead: prior.expectedActiveHead,
    })));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) expect(stale.failure).toMatchObject({ reason: "expectedHead" });
    expect(await inspectApplicationNativeMutationLifecycleForTest(fixture, thirdInput.revisionId)).toEqual(beforeUncertain);

    const original = fixture.servingOwners.target;
    const run = original[RUN_LOCATED_READ_COMMITTED_V1];
    const lostResponse = new Error("current-lifecycle:lost-activation-response");
    const uncertainFailure = new LocatedReadCommittedTransactionFailureV1({ kind: "decisionUncertain", settlementCause: lostResponse });
    let injected = false;
    const target = createLocatedPointMutationSessionActivationTargetV1(fixture.target.drizzle, original.physicalLocator, {
      [LOCATED_READ_COMMITTED_RUNNER_V1]: async <Value>(work: Parameters<typeof run<Value>>[0]): Promise<Value> => {
        const result = await run(work);
        if (!injected && typeof result === "object" && result !== null && Reflect.get(result, "status") === "activated") {
          injected = true;
          throw uncertainFailure;
        }
        return result;
      },
    });
    if (!isLocatedReadCommittedAttemptTargetV1(target)) throw new Error("Expected the genuine located uncertainty target.");
    const uncertainOwners = constructApplicationLegacyServingOwners({ ...fixture.servingOwners, target });
    const thirdRequest = { revisionId: thirdInput.revisionId, expectedActiveHead: secondActive.expectedActiveHead };
    const uncertain = await runSystemTestEffectV1(Effect.exit(uncertainOwners.application.activate(thirdRequest)));
    expect(injected).toBe(true);
    expect(Exit.isFailure(uncertain)).toBe(true);
    if (Exit.isFailure(uncertain)) {
      const failure = Cause.findErrorOption(uncertain.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toMatchObject({ reason: "decisionUncertain" });
        expect(failure.value).toBeInstanceOf(ApplicationActivationError);
        if (failure.value instanceof ApplicationActivationError) expect(failure.value.cause).toBe(uncertainFailure);
      }
    }
    expect(uncertainFailure.issue).toMatchObject({ settlementCause: lostResponse });
    const recovered = await runSystemTestEffectV1(makeApplicationActivationRepository(activationContext).activate(thirdRequest));
    expect(recovered).toMatchObject({ disposition: "replayed", activationSequence: inserted.activationSequence + 1n });
    const finalActive = await runSystemTestEffectV1(makeApplicationActivationRepository(activationContext).readActive());
    const afterRecovery = await inspectApplicationNativeMutationLifecycleForTest(fixture, thirdInput.revisionId);
    expect(afterRecovery.history).toHaveLength(beforeReadiness.history.length + 2);
    expect(afterRecovery.heads).toHaveLength(1);
    expect(finalActive.basis.revisionId).toBe(thirdInput.revisionId);
    expect(afterRecovery.history.slice(0, beforeUncertain.history.length)).toEqual(beforeUncertain.history);
    return { prior, second, notReady, pending, ready, readyReplay, inserted, replay, uncertain, recovered,
      finalActive, faultCauses, afterRecovery, analysisWorkerLoads: loader.loads };
  } finally {
    await loader.dispose();
  }
}

function lifecycleDefinition(ordinal: number) {
  return {
    programBudgetInput: { maximumModules: 1, maximumFunctions: 1, maximumIdentifierUtf8Bytes: 1024,
      maximumValidatorNodes: 64, maximumValidatorDepth: 8, maximumValidatorStringUtf8Bytes: 1024 },
    programInput: { format: "flarex.declarative-program/v1", version: 1,
      schema: { tables: ["users", "lifecycle"].map(logicalName => ({ logicalName,
        definition: { kind: "appDocument" as const, definitionVersion: 1 as const,
          documentType: { type: "object" as const, value: { name: { fieldType: { type: "string" as const }, optional: false } } } } })), indexes: [] },
      modules: [{ modulePath: "lifecycle", functions: [{ exportName: "get", kind: "query", visibility: "public",
        argsValidator: { type: "object", value: {} }, returnsValidator: { type: "string" } }] }] },
    materializationBudgetInput: { maximumModules: 1, maximumEntryBindings: 1, maximumSourceBytes: 4096,
      maximumSourceMapBytes: 0, maximumBytesMaterialized: 32768, maximumSemanticRecords: 64,
      maximumSemanticRecordBytes: 8192, maximumSemanticStreamBytes: 32768 },
    graphInput: { modules: [{ path: "functions/lifecycle.js", roles: ["function", "execution"],
      sourceBytes: new TextEncoder().encode(`export async function get() { return "revision-${ordinal}"; }\n`), sourceMapBytes: null }],
      functionEntries: [{ logicalModulePath: "lifecycle", artifactModulePath: "functions/lifecycle.js" }],
      executionPath: "functions/lifecycle.js", schemaPath: null, authPath: null },
  } as const;
}
