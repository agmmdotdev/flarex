import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import {
  ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
  ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
  encodeAdmittedFrameworkOperationV1Result,
} from "flarex-protocol/internal/admitted-framework-operation-v1";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { fxAppRowRevisions, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals, fxSystemTransactionSessions, fxSystemCommits } from "../../persistence-postgres/src/schema";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/finiteAttemptAnchor";
import { readFrozenFiniteAttempt } from "../../persistence-postgres/src/sessionJournalStore";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";

type MixedFixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

async function successfulValue(workerd: unknown) {
  const success = Schema.decodeUnknownSync(Schema.Struct({
    kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }),
  }))(workerd);
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
    success.result.result))).value;
}

async function waitUntil(observe: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!observe()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function readCommittedPost(fixture: MixedFixture, id: string) {
  const identity = decodeAppDocumentIdentityV1(id);
  const committed = await fixture.currency.persistence.drizzle.select()
    .from(fxAppRowRevisions).where(and(eq(fxAppRowRevisions.scopeUuid,
      projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid),
    eq(fxAppRowRevisions.tableId, identity.tableId),
    eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId))));
  const revision = committed.at(-1);
  if (revision?.valueBytes === null || revision?.valueBytes === undefined ||
    revision.valueSha256 === null) throw new Error("Missing committed Payload post");
  return decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: revision.valueBytes,
    sha256: revision.valueSha256, profile: "appDocument" });
}

function heldPayloadCreateRequest(fixture: MixedFixture, title: string) {
  const participant = fixture.payload?.profile.participant;
  if (participant === undefined) throw new Error("Missing selected Payload participant");
  const encoded = Result.getOrThrow(encodeAdmittedFrameworkOperationV1Result({
    format: ADMITTED_FRAMEWORK_OPERATION_FORMAT_V1,
    version: ADMITTED_FRAMEWORK_OPERATION_VERSION_V1,
    participant, operation: "payload-create",
    args: { collection: "posts", data: { title, publishedAt: "2026-01-01" } },
  }));
  return { syscallSequence: CommitSyscallSequenceV1Schema.make(3n),
    operation: encoded.operation, requestBytes: encoded.bytes,
    requestSha256: createHash("sha256").update(encoded.bytes).digest() };
}

async function assertPoisonedFiniteRoot(fixture: MixedFixture): Promise<void> {
  const roots = await fixture.currency.persistence.drizzle.select()
    .from(fxSystemTransactionJournals)
    .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
  expect(roots).toEqual([]);
  const [session] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
    .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
  if (session === undefined) throw new Error("Missing genuine finite anchor");
  expect(session).toMatchObject({ lifecycle: "running", executionProfile: "finiteRoot" });
  expect((await Effect.runPromise(readFiniteAttemptAnchorRow(session))).reservation).not.toBeNull();
  const receipts = await fixture.currency.persistence.drizzle.select()
    .from(fxSystemTransactionJournalReceipts)
    .where(eq(fxSystemTransactionJournalReceipts.sessionId,
      fixture.activation.anchor.sessionId));
  expect(receipts).toHaveLength(0);
  const accepted = fixture.getUpdateRequest();
  if (accepted === undefined) throw new Error("Missing accepted Product operation");
  await expect(Effect.runPromise(fixture.runAdmitted(accepted))).rejects.toBeDefined();
  await expect(Effect.runPromise(fixture.freeze(null)))
    .rejects.toMatchObject({ _tag: "SessionJournalSealV1Error", reason: "journalFailed" });
}

describe.each(drivers)("mixed native Payload recovery on %s", driver => {
  it("replays a tentative Payload create result and freezes the mixed root without another hook", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-receipt-${driver}`, payloadProfile: "success" });
    try {
      const returnedValue = await successfulValue(await fixture.runExecution());
      const payload = fixture.payload;
      const runtime = payload?.current();
      if (payload === undefined || runtime === undefined) throw new Error("Missing fixed Payload runtime");
      expect(runtime.observations.hookRuns()).toBe(1);
      expect(runtime.observations.nestedReads()).toBe(1);
      expect(runtime.observations.caughtValidationErrors()).toBe(0);
      const createRequest = fixture.getAdmittedRequest(payload.profile.participant, "payload-create");
      if (createRequest === undefined) throw new Error("Missing exact Payload create request");
      const beforeReplay = fixture.nativeInvokeCount.get("payload-create");
      const receipt = await Effect.runPromise(fixture.runAdmitted(createRequest));
      expect(receipt).toMatchObject({ score: 0, enabled: false });
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(beforeReplay);
      expect(runtime.observations.hookRuns()).toBe(1);
      const receipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(receipts.filter(row => row.outcomeKind === "admittedLogicalResult")).toHaveLength(0);

      const frozen = await Effect.runPromise(fixture.freeze(returnedValue));
      const captured = readFrozenFiniteAttempt(frozen);
      if (captured === undefined) throw new Error("Missing issued frozen graph");
      expect(captured.operations.filter(operation => operation.kind === "participant")).toHaveLength(7);
      expect(captured.operations.filter(operation => operation.kind === "participant" &&
        operation.participant === payload.profile.participant && operation.method === "payload-create")).toHaveLength(1);
      const publication = await fixture.prepareFrozenPublication(frozen);
      const roots = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournals)
        .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
      expect(roots).toEqual([]);
      const persistedReceipts = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemTransactionJournalReceipts)
        .where(eq(fxSystemTransactionJournalReceipts.sessionId,
          fixture.activation.anchor.sessionId));
      expect(persistedReceipts.filter(row => row.outcomeKind === "admittedLogicalResult")).toHaveLength(0);
      expect(await Effect.runPromise(publication)).toMatchObject({ kind: "published" });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(runtime.observations.hookRuns()).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(beforeReplay);
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid,
          projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(1);
      const final = Schema.decodeUnknownSync(Schema.Struct({ final: Schema.Struct({
        id: Schema.String, title: Schema.String, score: Schema.Number, enabled: Schema.Boolean,
      }) }))(returnedValue).final;
      expect(final).toMatchObject({ title: fixture.seed.newTitle, score: 1, enabled: true });
      const post = await readCommittedPost(fixture, final.id);
      expect(post.value).toMatchObject({ title: final.title, score: 1, enabled: true });
      expect(payload.runtimeHistory).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 180_000);

  it("accepts an owned promised transaction ID in a native nested read", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-promised-id-${driver}`, payloadProfile: "promisedId" });
    try {
      const returnedValue = await successfulValue(await fixture.runExecution());
      expect(fixture.payload?.current()?.observations.hookRuns()).toBe(1);
      expect(fixture.payload?.current()?.observations.nestedReads()).toBe(1);
      expect(await fixture.publish(returnedValue)).toMatchObject({ kind: "published" });
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.skipIf(postgresUrl === null)("mixed native Payload final COMMIT ambiguity on PostgreSQL", () => {
  it("recovers a lost COMMIT response from durable evidence without rerunning the native hook", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres",
      suffix: "payload-commit-response", payloadProfile: "success" });
    try {
      const returnedValue = await successfulValue(await fixture.runExecution());
      const runtime = fixture.payload?.current();
      if (runtime === undefined) throw new Error("Missing fixed Payload runtime");
      expect(runtime.observations.hookRuns()).toBe(1);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const before = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)
        .where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      const publication = await fixture.preparePublication(returnedValue);
      const fault = await installOneCommitResponseFault(fixture, before.length,
        () => { throw new Error("forwarded mixed Payload COMMIT response lost"); });
      const first = await Effect.runPromise(publication).finally(fault.restore);
      expect(fault.fired()).toBe(true);
      expect(first).toMatchObject({ kind: "replayed" });
      const after = await fixture.currency.persistence.drizzle.select().from(fxSystemCommits)
        .where(eq(fxSystemCommits.scopeUuid, scopeUuid));
      expect(after).toHaveLength(before.length + 1);
      const final = Schema.decodeUnknownSync(Schema.Struct({ final: Schema.Struct({
        id: Schema.String, title: Schema.String,
      }) }))(returnedValue).final;
      expect((await readCommittedPost(fixture, final.id)).value).toMatchObject({
        title: final.title, score: 1, enabled: true,
      });
      expect(await fixture.replayPublication()).toMatchObject({ kind: "replayed" });
      expect(runtime.observations.hookRuns()).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
      expect(fixture.payload?.runtimeHistory).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.each(drivers)("mixed native Payload refusal and interruption on %s", driver => {
  it("rejects a different pinned Payload revision before invoking native code", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-wrong-revision-${driver}`, payloadProfile: "success" });
    try {
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing selected Payload participant");
      const wrongRevision = `${participant.slice(0, -1)}${participant.endsWith("0") ? "1" : "0"}`;
      const outcome = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          return ctx.privateMixed.call(${JSON.stringify(wrongRevision)}, "payload-create",
            { collection: "posts", data: { title: "wrong-revision", publishedAt: "2026-01-01" } });
        },
      } } };`).catch(cause => cause);
      if (!(outcome instanceof Error)) expect(outcome).not.toMatchObject({ kind: "result",
        result: { kind: "success" } });
      expect(fixture.nativeInvokeCount.get("payload-create") ?? 0).toBe(0);
      expect(fixture.payload?.runtimeHistory).toHaveLength(0);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
    } finally { await fixture.close(); }
  }, 180_000);

  it.each(["foreignId", "removedId", "denied"] as const)(
    "poisons the whole root for fixed %s profile and leaves staged writes unpublished", async payloadProfile => {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: `payload-${payloadProfile.toLowerCase()}-${driver}`, payloadProfile });
      try {
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const before = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
        const outcome = await fixture.runExecution().catch(cause => cause);
        if (!(outcome instanceof Error)) expect(outcome).not.toMatchObject({ kind: "result",
          result: { kind: "success" } });
        const runtime = fixture.payload?.runtimeHistory.at(-1);
        if (runtime === undefined) throw new Error(`Payload runtime absent for ${payloadProfile}; ` +
          `native calls ${JSON.stringify([...fixture.nativeInvokeCount])}; ` +
          `Worker ${String(outcome)}; bridge ${fixture.bridgeFailures.join(" | ")}`);
        expect(runtime.observations.hookRuns()).toBe(payloadProfile === "denied" ? 0 : 1);
        expect(fixture.bridgeFailures.join("\n")).toContain(payloadProfile === "denied"
          ? "reason: 'invalidInput'" : "reason: 'invalidAuthority'");
        expect(await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid))).toEqual(before);
        await assertPoisonedFiniteRoot(fixture);
      } finally { await fixture.close(); }
    }, 180_000);

  it("revokes a held native hook after cancellation and refuses its resumed same-request read", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-held-cancel-${driver}`, payloadProfile: "unresolvedId" });
    let fiber: ReturnType<typeof Effect.runFork<unknown, unknown>> | undefined;
    try {
      const staged = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          return { staged: true };
        },
      } } };`);
      await successfulValue(staged);
      fiber = Effect.runFork(fixture.runAdmitted(heldPayloadCreateRequest(fixture, "cancelled-post")));
      await waitUntil(() => fixture.payload?.current()?.observations.heldIdReadEntered() === true,
        "held native nested Payload read");
      const runtime = fixture.payload?.current();
      if (runtime === undefined) throw new Error("Missing held Payload runtime");
      expect(runtime.observations.heldIdPending()).toBe(true);
      await Effect.runPromise(Fiber.interrupt(fiber));
      const interrupted = await Effect.runPromise(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted)).toBe(true);
      runtime.observations.releaseHeldId();
      await waitUntil(runtime.observations.postCancelProbeHeld,
        "continued native Payload hook after cancellation");
      runtime.observations.releasePostCancelProbe();
      await waitUntil(() => runtime.observations.postCancellationRefusals() === 1,
        "revoked native Payload request refusal");
      expect(runtime.observations.hookRuns()).toBe(1);
      if (fixture.hasSqlObserver) expect(fixture.getOpenTransactionDepth()).toBe(0);
      await assertPoisonedFiniteRoot(fixture);
    } finally {
      fixture.payload?.current()?.observations.releaseHeldId();
      fixture.payload?.current()?.observations.releasePostCancelProbe();
      if (fiber !== undefined) await Effect.runPromise(Fiber.interrupt(fiber));
      await fixture.close();
    }
  }, 180_000);

  it("expires a held native Payload ID and refuses its continuation after the original deadline", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-held-deadline-${driver}`, payloadProfile: "unresolvedId" });
    try {
      await successfulValue(await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          return { staged: true };
        },
      } } };`));
      const running = Effect.runPromise(fixture.runAdmitted(
        heldPayloadCreateRequest(fixture, "deadline-post"))).catch(cause => cause);
      await waitUntil(() => fixture.payload?.current()?.observations.heldIdReadEntered() === true,
        "held native nested Payload read");
      const runtime = fixture.payload?.current();
      if (runtime === undefined) throw new Error("Missing held Payload runtime");
      const outcome = await running;
      expect(outcome).toBeInstanceOf(Error);
      expect(outcome).toMatchObject({ cause: { reason: "deadlineExceeded" } });
      runtime.observations.releaseHeldId();
      await waitUntil(runtime.observations.postCancelProbeHeld,
        "continued native Payload hook after deadline");
      runtime.observations.releasePostCancelProbe();
      await waitUntil(() => runtime.observations.postCancellationRefusals() === 1,
        "expired native Payload request refusal");
      expect(runtime.observations.hookRuns()).toBe(1);
      await assertPoisonedFiniteRoot(fixture);
    } finally {
      fixture.payload?.current()?.observations.releaseHeldId();
      fixture.payload?.current()?.observations.releasePostCancelProbe();
      await fixture.close();
    }
  }, 180_000);
});
