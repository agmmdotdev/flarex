import { Effect, Result, Schema } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { expect } from "vitest";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { runPrivatePayloadSaveServing } from "./privatePayloadSaveServing";
import { successfulValue } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";
import type { PrivateBindingRecoveryConfiguration, PrivateBindingRecoveryOwners } from "./privatePayloadBindingRecoveryOwners";
import type { PrivateBindingCommitLossTarget } from "./privatePayloadBindingCommitLoss";

const productResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const savedResult = Schema.decodeUnknownSync(Schema.Struct({ articleId: Schema.String, userId: Schema.String }));
type Serving = Effect.Success<ReturnType<typeof runPrivatePayloadSaveServing>>;
type Loss = (target: PrivateBindingCommitLossTarget, run: () => Promise<void>, afterDurable: () => Promise<void>) => Promise<void>;
export type PrivateBindingRecoveryMode = Readonly<{ kind: "reconstruction" }> |
  Readonly<{ kind: "activation" | "save"; lose: Loss }>;

/** The producer runs the selected consumer. Reconstruction receives durable
 * configuration and a selector only, with the original native/host scopes closed. */
export async function privatePayloadBindingRecoveryScenario(fixture: PrivatePayloadSaveFixture, input: Readonly<{
  mode: PrivateBindingRecoveryMode;
  observe: (configuration: PrivateBindingRecoveryConfiguration) => Promise<PrivateBindingRecoveryOwners>;
  closeProducer: () => Promise<void>;
  reopen: (configuration: PrivateBindingRecoveryConfiguration) => Promise<PrivateBindingRecoveryOwners>;
}>) {
  const { application } = fixture.fixture;
  const scopeId = application.authority.scopeId;
  const { binding, frame } = fixture.schemaBinding;
  if (frame.logicalSchema === null) throw new Error("Missing real joint schema selection");
  if (frame.application.physicalLocator.kind === "shared_database") throw new Error("Private fixture requires its real split locator");
  const configuration: PrivateBindingRecoveryConfiguration = { deploymentId: application.deploymentId, scopeId,
    physicalLocator: frame.application.physicalLocator, schemaVersionId: frame.logicalSchema.schemaVersionId };
  const observer = await input.observe(configuration);
  const product = productResult(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Recovery Product", handle: "private-binding-recovery" })));
  const policy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true },
    assign: [product.id], retain: [product.id] });
  expect(await policy.root.publish()).toMatchObject({ kind: "published" });
  const baseline = await observer.snapshot();
  let nextRequest = 0;
  const prepareActivation = async (preferences: boolean) => {
    const application = await Effect.runPromise(binding.readApplicationReference());
    const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
    const candidate = await Effect.runPromise(binding.prepare({ ...frame, application,
      payloadLifecycle: preferences ? frame.payloadLifecycle : null }));
    return dataBindingActivationRequest(scopeId, application.storageGeneration,
      `private-recovery-${++nextRequest}`, candidate.sha256, current.head);
  };
  let withdrawal: Effect.Success<ReturnType<typeof binding.activate>> | undefined;
  const withdraw = async () => {
    withdrawal = await Effect.runPromise(binding.activate(await prepareActivation(false)));
    expect(Result.getOrThrow(withdrawal.current).selected).toBe(true);
  };
  const calls: string[] = [], responses: unknown[] = [];
  let disposed = 0;
  let served: Serving | undefined;
  const runSave = async () => {
    served = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId,
      `const userId = await ctx.db.insert("users", { name: "Recovery Application write" });
       const article = await ctx.privateMixed.call("payload", "payload-create", { collection: "posts",
         data: { title: "Recovery article", featuredProduct: ${JSON.stringify(product.id)} } });
       await ctx.db.patch(userId, { name: article.title }); return { articleId: article.id, userId };`, {
        onNative: method => { calls.push(method); }, onResponse: response => { responses.push(response); },
        observations: { onDisposed: () => { disposed++; } },
      }));
  };
  const expectOneSave = async () => {
    expect(calls).toEqual(["payload-create"]);
    expect(responses).toHaveLength(1);
    expect(disposed).toBe(1);
    const snapshot = await observer.snapshot();
    expect(snapshot.published).toMatchObject({ rows: baseline.published.rows + 2, revisions: baseline.published.revisions + 2,
      rowFacts: baseline.published.rowFacts + 2, commits: baseline.published.commits + 1,
      outcomes: baseline.published.outcomes + 1, events: baseline.published.events });
    return snapshot;
  };
  const historicalRequest = await prepareActivation(true);
  let activationResult: Result.Result<Effect.Success<ReturnType<typeof binding.activate>>,
    Effect.Error<ReturnType<typeof binding.activate>>> | undefined;
  if (input.mode.kind === "save") {
    // Retain a real earlier activation while the later native save loses its ack.
    activationResult = await Effect.runPromise(binding.activate(historicalRequest).pipe(Effect.result));
    await input.mode.lose({ kind: "save", baselineCommits: baseline.published.commits }, runSave, async () => {
      await expectOneSave(); // independently durable before authority changes
      await withdraw();
    });
  } else {
    await runSave();
    await expectOneSave();
    const activate = async () => { activationResult = await Effect.runPromise(binding.activate(historicalRequest).pipe(Effect.result)); };
    if (input.mode.kind === "activation") await input.mode.lose({ kind: "activation", requestId: historicalRequest.requestId },
      activate, async () => {
        const durable = await expectOneSave();
        expect(durable.activations.find(row => row.requestId === historicalRequest.requestId)).toBeDefined();
        expect(durable.heads[0]?.candidateSha256).toBe(historicalRequest.candidateSha256);
        await withdraw();
      });
    else { await activate(); await withdraw(); }
  }
  if (served === undefined || withdrawal === undefined || activationResult === undefined) throw new Error("Missing actual recovery stimulus");
  expect(served.result).toMatchObject({ _tag: "Success", success: { kind: input.mode.kind === "save" ? "replayed" : "published" } });
  expect(activationResult).toMatchObject(input.mode.kind === "activation" ? { _tag: "Failure",
    failure: { _tag: "DataBindingError", reason: "decisionUncertain" } } : { _tag: "Success" });
  if (Result.isSuccess(activationResult)) expect(Result.getOrThrow(activationResult.success.current).selected).toBe(true);
  const successful = Result.getOrThrow(served.result);
  if (successful.kind !== "published" && successful.kind !== "replayed") throw new Error("Expected durable successful result");
  const value = savedResult(successful.successfulResult.valueJson);
  expect(value).toEqual(savedResult(await successfulValue(responses[0])));
  const anchor = served.execution.currentRoot().context.anchor;
  const selector = { deploymentId: anchor.deploymentId, scopeId: anchor.scopeId, sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence };
  const committed = await expectOneSave();
  expect(committed.activations).toHaveLength(baseline.activations.length + 2);
  expect(committed.authority[0]?.authorizationRevocationEpoch).toBe(baseline.authority[0]!.authorizationRevocationEpoch + 1n);
  const storedHistorical = committed.activations.find(row => row.requestId === historicalRequest.requestId);
  if (storedHistorical === undefined) throw new Error("Lost activation has no durable historical receipt");
  const withdrawnReceipt = withdrawal.receipt;
  await input.closeProducer();
  expect(await Effect.runPromise(fixture.withPreparation(() => Effect.void).pipe(Effect.result)))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "PreparedHostRuntimeError", reason: "closed" } });
  for (let restart = 0; restart < 2; restart++) {
    const fresh = await input.reopen(configuration);
    expect((await Effect.runPromise(fresh.binding.withCurrent(readAdmittedDataBinding))).frame.payloadLifecycle).toBeNull();
    const recovered = await Effect.runPromise(fresh.binding.recover(historicalRequest));
    expect(recovered.receipt).toMatchObject({ sha256: storedHistorical.sha256,
      frame: { request: historicalRequest, sequence: storedHistorical.sequence.toString() } });
    expect(Result.getOrThrow(recovered.current).selected).toBe(false);
    const currentReceipt = await Effect.runPromise(fresh.binding.recover(withdrawnReceipt.frame.request));
    expect(currentReceipt.receipt).toEqual(withdrawnReceipt);
    expect(Result.getOrThrow(currentReceipt.current).selected).toBe(true);
    expect(await Effect.runPromise(fresh.binding.recover({ ...historicalRequest, candidateSha256: "f".repeat(64) }).pipe(Effect.result)))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "DataBindingError", reason: "requestConflict" } });
    const replay = await Effect.runPromise(fresh.recovery.acquireEffect(selector));
    expect(replay).toMatchObject({ kind: "replayed", outcome: { kind: "available", token: successful.token,
      successfulResult: successful.successfulResult } });
    const recoveredState = await fresh.snapshot();
    for (const id of [value.articleId, value.userId]) {
      const identity = decodeAppDocumentIdentityV1(id);
      expect(recoveredState.rows.filter(row => row.tableId === identity.tableId &&
        bytesEqual(row.rowId, appRowIdHexV1ToBytes(identity.rowId)))).toHaveLength(1);
    }
    expect(recoveredState).toEqual(committed);
    expect(calls).toEqual(["payload-create"]); // recovery cannot rerun write hooks through native invocation
    expect(responses).toHaveLength(1); expect(disposed).toBe(1);
  }
}
