import { Effect, Result } from "effect";
import { expect } from "vitest";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { preparePrivateReverseReadPolicy, preparePrivateReverseReadProfile } from "./privatePayloadReverseReadCommands";
import { privatePayloadReverseSeed } from "./privatePayloadReverseSeed";
import type { PrivateSaveExecution } from "./privatePayloadSaveExecution";
import { runPrivatePayloadReverseServing } from "./privatePayloadReverseServing";
import { makePayloadReferencePages } from "../../../payload-adapter/src/runtime/referencePages";
import type { PrivateBindingRecoveryConfiguration, PrivateBindingRecoveryOwners } from "./privatePayloadBindingRecoveryOwners";
import type { PrivateBindingCommitLossTarget } from "./privatePayloadBindingCommitLoss";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

type Lose = (target: PrivateBindingCommitLossTarget, run: () => Promise<void>, afterDurable: () => Promise<void>) => Promise<void>;
/** Restart receives durable configuration and selector only. It has no old
 * native instance, page cursor, permission evidence or prepared read graph. */
export async function privatePayloadReverseRestartScenario(fixture: PrivatePayloadSaveFixture, input: Readonly<{
  lose?: Lose;
  observe: (configuration: PrivateBindingRecoveryConfiguration) => Promise<PrivateBindingRecoveryOwners>;
  closeProducer: () => Promise<void>;
  reopen: (configuration: PrivateBindingRecoveryConfiguration) => Promise<PrivateBindingRecoveryOwners>;
}>) {
  const seed = await privatePayloadReverseSeed(fixture, "rr3-restart");
  const { binding, frame } = fixture.schemaBinding;
  if (frame.logicalSchema === null || frame.application.physicalLocator.kind === "shared_database") throw new Error("Missing split joint schema");
  const configuration: PrivateBindingRecoveryConfiguration = { deploymentId: fixture.fixture.application.deploymentId,
    scopeId: fixture.fixture.application.authority.scopeId, physicalLocator: frame.application.physicalLocator, schemaVersionId: frame.logicalSchema.schemaVersionId };
  const observer = await input.observe(configuration), baseline = await observer.snapshot();
  const profile = await Effect.runPromise(preparePrivateReverseReadProfile(fixture, seed.principal, seed.productId));
  let execution: PrivateSaveExecution | undefined;
  let hooks = 0, enumerations = 0;
  let settled: Effect.Success<ReturnType<PrivateSaveExecution["owner"]["executePreparedFiniteAttempt"]>> | undefined;
  const publish = async () => {
    const served = await Effect.runPromise(runPrivatePayloadReverseServing(fixture, profile, seed.policyId,
      'const page = await ctx.privateMixed.call("payload", "private-reference-page", { limit: 1 });' +
      'const userId = await ctx.db.insert("users", { name: JSON.stringify(page) }); return { userId, page };', {
        makeNative: Effect.fn("PrivateReverseReadRestart.native")(function* (compiled, attempt, access) {
          return yield* makePayloadReferencePages(compiled, attempt, access, {
            hooks: { afterRead: [({ doc }) => { hooks++; return doc; }] },
            documentReads: { afterReferencePage: () => { enumerations++; } },
          });
        }),
      }));
    execution = served.execution;
    settled = Result.getOrThrow(served.result);
  };
  const withdraw = async () => {
    const durable = await observer.snapshot();
    expect(durable.published).toMatchObject({ rows: baseline.published.rows + 1, commits: baseline.published.commits + 1,
      outcomes: baseline.published.outcomes + 1, rowFacts: baseline.published.rowFacts + 1, events: baseline.published.events });
    const revoke = await preparePrivateReverseReadPolicy(fixture, { enumerate: [], articles: [] }, seed.policyId);
    await revoke.root.publish();
    const application = await Effect.runPromise(binding.readApplicationReference());
    const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
    const candidate = await Effect.runPromise(binding.prepare({ ...frame, application, payloadLifecycle: null }));
    const report = await Effect.runPromise(binding.activate(dataBindingActivationRequest(configuration.scopeId, application.storageGeneration,
      "rr3-recovery-withdraw", candidate.sha256, current.head)));
    expect(Result.getOrThrow(report.current).selected).toBe(true);
  };
  if (input.lose === undefined) { await publish(); await withdraw(); }
  else await input.lose({ kind: "save", baselineCommits: baseline.published.commits }, publish, withdraw);
  if (execution === undefined || settled === undefined) throw new Error("Missing actual committed reverse read");
  expect(settled).toMatchObject({ kind: input.lose === undefined ? "published" : "replayed" });
  if (settled.kind !== "published" && settled.kind !== "replayed") throw new Error("Missing durable successful outcome");
  const anchor = execution.currentRoot().context.anchor;
  const selector = { deploymentId: anchor.deploymentId, scopeId: anchor.scopeId, sessionId: anchor.sessionId, attemptFence: anchor.attemptFence };
  const committed = await observer.snapshot();
  expect(hooks).toBe(2); expect(enumerations).toBe(1);
  await input.closeProducer();
  expect(await Effect.runPromise(fixture.withPreparation(() => Effect.void).pipe(Effect.result))).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
  for (let restart = 0; restart < 2; restart++) {
    const fresh = await input.reopen(configuration);
    expect((await Effect.runPromise(fresh.binding.withCurrent(readAdmittedDataBinding))).frame.payloadLifecycle).toBeNull();
    expect(await Effect.runPromise(fresh.recovery.acquireEffect(selector))).toMatchObject({ kind: "replayed",
      outcome: { kind: "available", token: settled.token, successfulResult: settled.successfulResult } });
    expect(await fresh.snapshot()).toEqual(committed);
    expect(hooks).toBe(2); expect(enumerations).toBe(1);
  }
}
