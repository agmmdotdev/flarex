import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { prepareIndexBuildReadinessWitness } from "../../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";
import { preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { runPrivatePayloadSaveServing } from "./privatePayloadSaveServing";
import { makePrivateSaveExecution } from "./privatePayloadSaveExecution";
import { privatePayloadBindingMetadataScenario } from "./privatePayloadBindingMetadataScenario";
import { publishedScopeCounts, successfulValue } from "./payloadCommerceReferenceFixture";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

const document = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const opaque = { kind: "error", name: "PointMutationExactRuntimeJournalBoundaryV1Error",
  message: "Exact point-mutation journal boundary failed.", cause: "The journal RPC capability is unavailable." };

/** Schedule genuine owners between entry, capability binding, receipt and
 * publication. No acceptance, metadata dependency or retry is implemented here. */
export async function privatePayloadBindingFreshnessScenario(fixture: PrivatePayloadSaveFixture) {
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const counts = () => publishedScopeCounts(db, scopeId);
  const product = document(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Fresh binding Product", handle: "private-binding-freshness" })));
  const policy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true },
    assign: [product.id], retain: [product.id] });
  expect(await policy.root.publish()).toMatchObject({ kind: "published" });
  const { binding, frame } = fixture.schemaBinding;
  let request = 0;
  const activate = async (preferences: boolean) => {
    const application = await Effect.runPromise(binding.readApplicationReference());
    const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
    const candidate = await Effect.runPromise(binding.prepare({ ...frame, application,
      payloadLifecycle: preferences ? frame.payloadLifecycle : null }));
    const report = await Effect.runPromise(binding.activate(dataBindingActivationRequest(scopeId, application.storageGeneration,
      `private-freshness-${++request}`, candidate.sha256, current.head)));
    expect(Result.getOrThrow(report.current).selected).toBe(true);
    return report;
  };
  const create = `await ctx.privateMixed.call("payload", "payload-create", { collection: "posts",
    data: { title: "Freshness article", featuredProduct: ${JSON.stringify(product.id)} } })`;
  const body = `const userId = await ctx.db.insert("users", { name: "Pending Application write" });
    const article = ${create}; await ctx.db.patch(userId, { name: article.title }); return article;`;
  const methods: string[] = [], responses: unknown[] = [];
  const hooks = { onNative: (method: string) => { methods.push(method); }, onResponse: (value: unknown) => { responses.push(value); } };

  // A genuine current entry after an unchanged rebind is usable. Rebinding
  // again after a native receipt must not become a blanket head-sequence conflict.
  await activate(true);
  const beforeUnchanged = await counts();
  const unchanged = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, {
    ...hooks, fresh: true, observations: { afterReceipt: async () => { await activate(true); } },
  }));
  expect(unchanged.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
  expect(methods).toEqual(["payload-create"]);
  expect(await counts()).toMatchObject({ rows: beforeUnchanged.rows + 2, revisions: beforeUnchanged.revisions + 2,
    commits: beforeUnchanged.commits + 1, outcomes: beforeUnchanged.outcomes + 1 });

  // Borrowed entry and source preparations do not survive their enclosing
  // current-generation callback, even if the durable binding is unchanged.
  const escaped = await Effect.runPromise(fixture.withFreshPreparation(preparation =>
    makePrivateSaveExecution(fixture, preparation, { run: () => Effect.die(new Error("Expired preparation entered Worker")) })));
  const beforeExpired = await counts();
  const expired = await Effect.runPromise(escaped.owner.executePreparedFiniteAttempt(escaped.prepared).pipe(Effect.result));
  expect(expired).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationMutationAdmissionError", reason: "invalidComposition" } });
  expect(await counts()).toEqual(beforeExpired);

  await privatePayloadBindingMetadataScenario(fixture, policy.documentId, product.id, async () => { await activate(true); });

  const beforeEntry = await counts(), entryCalls = methods.length, entryReplies = responses.length;
  const withdrawnEntry = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, {
    ...hooks, beforeEntry: async () => { await activate(false); },
  }));
  expect(withdrawnEntry.result).toMatchObject({ _tag: "Failure", failure: {
    _tag: "PointMutationSessionActivationV1Error", issue: { reason: "authorizationRevocationEpochChanged" } } });
  expect(methods).toHaveLength(entryCalls);
  expect(responses).toHaveLength(entryReplies);
  expect(await counts()).toEqual(beforeEntry);
  await activate(true);

  // Withdrawal after native receipt cannot publish either native or ordinary
  // Application changes. Restoration preserves the revocation/ABA boundary.
  for (const restore of [false, true]) {
    const baseline = await counts(), calls = methods.length, replies = responses.length;
    let receipt = false;
    const stale = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, {
      ...hooks, observations: { afterReceipt: async () => {
        receipt = true;
        await activate(false);
        if (restore) await activate(true);
      } },
    }));
    expect(receipt).toBe(true);
    expect(methods.length - calls).toBe(1);
    expect(stale.result).toMatchObject({ _tag: "Failure", failure: {
      _tag: "PointCommitStaleAuthorityV1Error", reason: "revocationEpochChanged" } });
    expect(responses.slice(replies)).toHaveLength(1);
    expect(await successfulValue(responses[replies])).toMatchObject({ title: "Freshness article", featuredProduct: product.id });
    expect(await counts()).toEqual(baseline);
    if (!restore) {
      let freshEntered = false;
      expect(await Effect.runPromise(fixture.withFreshPreparation(() => Effect.sync(() => { freshEntered = true; })).pipe(Effect.result)))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CmsTransactionError", reason: "unsupportedProfile" } });
      expect(freshEntered).toBe(false);
      const workerCalls = methods.length, workerResponses = responses.length;
      const refused = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, hooks));
      expect(refused.result).toMatchObject({ _tag: "Failure", failure: { _tag: "LogicalParticipantAdmissionError", reason: "invalidAuthority",
        cause: { _tag: "LogicalDocumentSourceAdmissionError", reason: "invalidAuthority", cause: { _tag: "CmsTransactionError", reason: "bindingChanged" } } } });
      expect(methods).toHaveLength(workerCalls);
      expect(responses).toHaveLength(workerResponses);
      expect(await counts()).toEqual(baseline);
      await activate(true);
    }
    const fresh = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, { ...hooks, fresh: true }));
    expect(fresh.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
  }

  // A capability issued before withdrawal may retain snapshot-compatible work;
  // it cannot grant fresh publication. A caught RPC refusal cannot free writes.
  const beforeCapability = await counts(), capabilityCalls = methods.length, capabilityReplies = responses.length;
  const staleCapability = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId,
    `try { ${create}; } catch {} await ctx.db.insert("users", { name: "Caught stale capability" }); return null;`, {
      ...hooks, beforeWorker: async () => { await activate(false); },
    }));
  expect(staleCapability.result).toMatchObject({ _tag: "Failure", failure: { _tag: "ApplicationPointMutationRunnerHostV1Error", reason: "terminalFailed",
    cause: { _tag: "ApplicationPointMutationRunnerHostV1Error", cause: { _tag: "PointMutationJournalPersistenceV1Error",
      cause: { _tag: "FiniteStorageCaptureError", reason: "authorizationRevocationEpochChanged" } } } } });
  expect(methods).toHaveLength(capabilityCalls + 1);
  expect(responses.slice(capabilityReplies)).toEqual([opaque]);
  expect(await counts()).toEqual(beforeCapability);
  await activate(true);

  // This derived reverse index is required by publication. Pending native and
  // Application work is allowed, but no committed result can pass its build guard.
  const active = await activate(true);
  const reference = active.receipt.frame.strongReferences[0];
  if (reference === undefined) throw new Error("Missing real reference readiness dependency");
  const readiness = await prepareIndexBuildReadinessWitness(db, scopeId, reference.reverseIndex.indexDefinitionId);
  const baseline = await counts(), calls = methods.length, replies = responses.length;
  await readiness.retire();
  try {
    const refused = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, { ...hooks, fresh: true }));
    expect(refused.result).toMatchObject({ _tag: "Failure", failure: { _tag: "PointCommitCorruptionV1Error", reason: "developerIndexBuildInvalid" } });
    expect(methods).toHaveLength(calls + 1);
    expect(responses.slice(replies)).toHaveLength(1);
    expect(await successfulValue(responses[replies])).toMatchObject({ title: "Freshness article", featuredProduct: product.id });
    expect(await counts()).toEqual(baseline);
  } finally { await readiness.restore(); }
  const restored = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, { ...hooks, fresh: true }));
  expect(restored.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
}
