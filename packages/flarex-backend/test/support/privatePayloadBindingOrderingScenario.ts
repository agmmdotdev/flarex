import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/selection";
import { fxAppRowCurrent, fxSystemMetadataContractObservations } from "../../../persistence-postgres/src/database/schema";
import { finiteMetadataContractKey, finiteMetadataDependencyIdentity } from "../../../persistence-postgres/src/execution/finiteMetadataDependencies";
import { readFrozenFiniteAttempt } from "../../../persistence-postgres/src/testing/sessionJournalInspection";
import { PointCommitConflictV1Error } from "../../../persistence-postgres/src/commit/point/errors";
import type { LogicalMetadataReadDependency } from "flarex-protocol/commit-protocol";
import type { PointCommitAuthorityPinsV1 } from "../../../persistence-postgres/src/commit/point/contracts";
import { deferredSignal, withTimeout } from "../../../persistence-postgres/test/commit/point/support/postgresFaults";
import { preparePrivateSavePolicy } from "./privatePayloadSaveCommands";
import { runPrivatePayloadSaveServing } from "./privatePayloadSaveServing";
import { successfulValue } from "./payloadCommerceReferenceFixture";
import { privatePayloadBindingSnapshot } from "./privatePayloadBindingSnapshot";
import type { PrivatePayloadSaveFixture } from "./privatePayloadSaveFixture";

export interface PrivateBindingSaveOrder {
  readonly first: "activation" | "save";
  readonly mode: "metadata" | "withdrawal";
  readonly scopeId: string;
  readonly requestId: string;
  readonly metadata: typeof fxSystemMetadataContractObservations.$inferSelect;
  readonly activate: () => Promise<void>;
  readonly save: () => Promise<void>;
}
export type PrivateBindingSaveCoordinator = (input: PrivateBindingSaveOrder) => Promise<void>;
const productResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }));
const savedResult = Schema.decodeUnknownSync(Schema.Struct({ articleId: Schema.String, userId: Schema.String }));

/** Serial semantics for PGlite. The PG coordinator instead injects this named
 * drift inside the real activation transaction, after its authority locks. */
export const serialPrivateBindingSaveOrder = (fixture: PrivatePayloadSaveFixture): PrivateBindingSaveCoordinator => async input => {
  const activate = async () => {
    if (input.mode === "metadata") {
      const row = input.metadata;
      await fixture.fixture.application.persistence.drizzle.update(fxSystemMetadataContractObservations)
        .set({ semanticSha256Hex: "f".repeat(64) }).where(and(eq(fxSystemMetadataContractObservations.scopeId, row.scopeId),
          eq(fxSystemMetadataContractObservations.namespace, row.namespace), eq(fxSystemMetadataContractObservations.ownerKey, row.ownerKey),
          eq(fxSystemMetadataContractObservations.contractKey, row.contractKey)));
    }
    await input.activate();
  };
  if (input.first === "activation") { await activate(); await input.save(); }
  else { await input.save(); await activate(); }
};

/** Both orders start with real protected permissions, native Payload and
 * Application work frozen. Coordinators schedule owners, never decide winners. */
export async function privatePayloadBindingOrderingScenario(fixture: PrivatePayloadSaveFixture, coordinate: PrivateBindingSaveCoordinator) {
  const db = fixture.fixture.application.persistence.drizzle;
  const scopeId = fixture.fixture.application.authority.scopeId;
  const product = productResult(await Effect.runPromise(fixture.productHost.run(fixture.productHost.newRequestKey(),
    fixture.productRuntime.commands.internalProductCreate, { title: "Ordering Product", handle: "private-binding-ordering" })));
  const policy = await preparePrivateSavePolicy(fixture, { source: { create: true, update: true, delete: true },
    assign: [product.id], retain: [product.id] });
  expect(await policy.root.publish()).toMatchObject({ kind: "published" });
  const { binding, frame } = fixture.schemaBinding;
  let requestNumber = 0;
  const prepareActivation = async (preferences: boolean) => {
    const application = await Effect.runPromise(binding.readApplicationReference());
    const current = await Effect.runPromise(binding.withCurrent(readAdmittedDataBinding));
    const candidate = await Effect.runPromise(binding.prepare({ ...frame, application,
      payloadLifecycle: preferences ? frame.payloadLifecycle : null }));
    const request = dataBindingActivationRequest(scopeId, application.storageGeneration,
      `private-binding-order-${++requestNumber}`, candidate.sha256, current.head);
    return { request, run: () => Effect.runPromise(binding.activate(request)) };
  };
  const absent = async (id: string) => {
    const identity = decodeAppDocumentIdentityV1(id);
    expect(await db.select({ id: fxAppRowCurrent.rowId }).from(fxAppRowCurrent).where(and(
      eq(fxAppRowCurrent.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid), eq(fxAppRowCurrent.tableId, identity.tableId),
      eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(identity.rowId))))).toHaveLength(0);
  };
  for (const mode of ["metadata", "withdrawal"] as const) for (const first of ["activation", "save"] as const) {
    const activation = await prepareActivation(mode !== "withdrawal");
    const before = await privatePayloadBindingSnapshot(fixture);
    const frozen = deferredSignal(), release = deferredSignal();
    const attempts: { pins: PointCommitAuthorityPinsV1; consumed: LogicalMetadataReadDependency }[] = [];
    const responses: unknown[] = [], calls: string[] = [];
    const body = `const userId = await ctx.db.insert("users", { name: "Pending ordering Application write" });
      const article = await ctx.privateMixed.call("payload", "payload-create", { collection: "posts",
        data: { title: "Ordering article", featuredProduct: ${JSON.stringify(product.id)} } });
      await ctx.db.patch(userId, { name: article.title }); return { articleId: article.id, userId };`;
    const serving = Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, {
      onNative: method => { calls.push(method); }, onResponse: value => { responses.push(value); },
      beforePublication: async command => {
        const actual = readFrozenFiniteAttempt(command.frozenAttempt);
        const consumed = actual?.graph.metadataDependencies?.find(dependency => dependency.namespace === "binding" &&
          dependency.ownerKey === "payload" && dependency.contractKey === finiteMetadataContractKey("writeClosure", "posts"));
        if (consumed === undefined || consumed.observed.kind !== "present") throw new Error("Missing authentic consumed Payload closure");
        attempts.push({ pins: command.authorityPins, consumed });
        if (attempts.length === 1) { frozen.resolve(); await release.promise; }
      },
    }));
    const drained = Promise.allSettled([serving]);
    let report: Awaited<ReturnType<typeof activation.run>> | undefined;
    try {
      await withTimeout(Promise.race([frozen.promise, serving.then(() => { throw new Error("Save settled before freeze barrier"); })]),
        30_000, "actual native and Application frozen work");
      expect(calls).toEqual(["payload-create"]);
      expect(responses).toHaveLength(1);
      const discarded = savedResult(await successfulValue(responses[0]));
      const captured = attempts[0];
      if (captured === undefined) throw new Error("Missing genuine frozen save evidence");
      const rows = await db.select().from(fxSystemMetadataContractObservations).where(eq(fxSystemMetadataContractObservations.scopeId, scopeId));
      const metadata = rows.find(row => finiteMetadataDependencyIdentity(row) === finiteMetadataDependencyIdentity(captured.consumed));
      if (metadata === undefined) throw new Error("Missing captured metadata observation");
      expect(await privatePayloadBindingSnapshot(fixture)).toEqual(before);
      await coordinate({ first, mode, scopeId, requestId: activation.request.requestId, metadata,
        activate: async () => { report = await activation.run(); }, save: async () => {
          release.resolve();
          const outcome = await serving;
          if (first === "save" && Result.isFailure(outcome.result)) throw outcome.result.failure;
        } });
      const served = await serving;
      if (report === undefined) throw new Error("Activation did not complete");
      expect(Result.getOrThrow(report.current).selected).toBe(true);
      expect(report.receipt.frame.request).toEqual(activation.request);
      const after = await privatePayloadBindingSnapshot(fixture);
      expect(after.heads[0]?.sequence).toBe(BigInt(activation.request.expectedHead!.sequence) + 1n);
      expect(after.activations).toHaveLength(before.activations.length + 1);
      expect(after.authority[0]?.authorizationRevocationEpoch).toBe(before.authority[0]!.authorizationRevocationEpoch + (mode === "withdrawal" ? 1n : 0n));
      expect(after.catalogs).toEqual(before.catalogs);
      expect(after.tableIdentities).toEqual(before.tableIdentities);
      // Immutable maintenance openings survive rebinding. Compare the genuine
      // previous/current binding generations, not every retained historical pin.
      const previousIndexes = before.indexes.filter(row => row.authorityKind === "binding" && row.activationSequence === before.heads[0]?.sequence);
      const currentIndexes = after.indexes.filter(row => row.authorityKind === "binding" && row.activationSequence === after.heads[0]?.sequence);
      const previousUnique = before.uniques.filter(row => row.authorityKind === "binding" && row.activationSequence === before.heads[0]?.sequence);
      const currentUnique = after.uniques.filter(row => row.authorityKind === "binding" && row.activationSequence === after.heads[0]?.sequence);
      expect(previousIndexes.length).toBeGreaterThan(0);
      expect(currentIndexes.map(row => row.indexDefinitionId)).toEqual(previousIndexes.map(row => row.indexDefinitionId));
      expect(currentUnique.map(row => row.uniqueConstraintDefinitionId)).toEqual(previousUnique.map(row => row.uniqueConstraintDefinitionId));
      expect(after.indexes).toEqual(expect.arrayContaining([...before.indexes]));
      expect(after.uniques).toEqual(expect.arrayContaining([...before.uniques]));
      expect(after.indexes).toHaveLength(before.indexes.length + currentIndexes.length);
      expect(after.uniques).toHaveLength(before.uniques.length + currentUnique.length);
      const repaired = after.metadata.find(row => finiteMetadataDependencyIdentity(row) === finiteMetadataDependencyIdentity(metadata));
      if (mode === "metadata") {
        expect(repaired).toMatchObject({ present: metadata.present, semanticSha256Hex: metadata.semanticSha256Hex, semanticBytes: metadata.semanticBytes });
        expect(repaired?.lastChangedMetadataSequence).toBeGreaterThan(captured.consumed.capturedWatermark);
      } else expect(after.metadata).toEqual(before.metadata);
      if (first === "save") {
        expect(served.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
        expect(after.published).toMatchObject({ rows: before.published.rows + 2, revisions: before.published.revisions + 2,
          rowFacts: before.published.rowFacts + 2, commits: before.published.commits + 1, outcomes: before.published.outcomes + 1,
          events: before.published.events });
      } else {
        expect(served.result).toMatchObject(mode === "metadata" ? { _tag: "Failure", failure: { _tag: "PointCommitConflictV1Error",
          conflict: { kind: "metadata", namespace: metadata.namespace, ownerKey: metadata.ownerKey, contractKey: metadata.contractKey } } } :
          { _tag: "Failure", failure: { _tag: "PointCommitStaleAuthorityV1Error", reason: "revocationEpochChanged" } });
        expect(after.published).toEqual(before.published);
        expect(after.rows).toEqual(before.rows);
        expect(after.revisions).toEqual(before.revisions);
        await absent(discarded.articleId); await absent(discarded.userId);
        if (Result.isSuccess(served.result)) throw new Error("Losing save published");
        const failure = served.result.failure;
        if (mode === "metadata") {
          if (Result.isSuccess(served.result) || !(served.result.failure instanceof PointCommitConflictV1Error)) throw new Error("Expected genuine OCC ticket");
          await expect(Effect.runPromise(served.execution.owner.retryFailedAttempt({ ...served.result.failure })))
            .rejects.toMatchObject({ reason: "unprovenRetry" });
          expect(await Effect.runPromise(served.execution.owner.retryFailedAttempt(served.result.failure)))
            .toMatchObject({ kind: "published" });
          expect(attempts).toHaveLength(2);
          expect(attempts[1]?.pins).toMatchObject({ sessionId: captured.pins.sessionId, attemptFence: captured.pins.attemptFence + 1n });
          expect(attempts[1]?.consumed.capturedWatermark).toBeGreaterThan(captured.consumed.capturedWatermark);
          expect(calls).toEqual(["payload-create", "payload-create"]);
          expect(responses).toHaveLength(2);
          const retried = savedResult(await successfulValue(responses[1]));
          expect(retried.articleId).not.toBe(discarded.articleId); expect(retried.userId).not.toBe(discarded.userId);
          await absent(discarded.articleId); await absent(discarded.userId);
          expect((await privatePayloadBindingSnapshot(fixture)).published).toMatchObject({ rows: before.published.rows + 2,
            revisions: before.published.revisions + 2, commits: before.published.commits + 1, outcomes: before.published.outcomes + 1 });
        } else {
          await expect(Effect.runPromise(served.execution.owner.retryFailedAttempt(failure))).rejects.toMatchObject({ reason: "unprovenRetry" });
          expect(calls).toHaveLength(1);
          expect(await Effect.runPromise(served.execution.owner.redispatchExactPointMutationAttempt({
            deploymentId: captured.pins.deploymentId, scopeId: captured.pins.scopeId, sessionId: captured.pins.sessionId,
            attemptFence: captured.pins.attemptFence.toString(),
          }).pipe(Effect.result))).toMatchObject({ _tag: "Failure", failure: { reason: "lifecycle" } });
        }
      }
      if (mode === "withdrawal") {
        expect(Result.getOrThrow((await (await prepareActivation(true)).run()).current).selected).toBe(true);
        const restored = await Effect.runPromise(runPrivatePayloadSaveServing(fixture, policy.documentId, body, { fresh: true }));
        expect(restored.result).toMatchObject({ _tag: "Success", success: { kind: "published" } });
      }
    } finally { release.resolve(); await drained; }
  }
}
