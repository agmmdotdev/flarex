import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAppDocumentIdentityV1, appRowIdHexV1ToBytes } from
  "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { decodeCanonicalFlarexValueEvidenceV1 } from "flarex-protocol/value";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { fxAppRowRevisions, fxSystemIdempotency, fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from
  "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

type MixedFixture = Awaited<ReturnType<typeof createMixedMutationProductFixture>>;

async function publishedCounts(fixture: MixedFixture) {
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const rows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
    .where(eq(fxAppRowRevisions.scopeUuid, scopeUuid));
  const outcomes = await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)
    .where(eq(fxSystemIdempotency.scopeUuid, scopeUuid));
  return { rows: rows.length, outcomes: outcomes.length };
}

async function assertNoPublishedMixedOutput(fixture: MixedFixture,
  before: Awaited<ReturnType<typeof publishedCounts>>) {
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  expect(await publishedCounts(fixture)).toEqual(before);
  const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
    .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
  expect(events.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
  const roots = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionJournals)
    .where(eq(fxSystemTransactionJournals.sessionId, fixture.activation.anchor.sessionId));
  expect(roots).toHaveLength(1);
  expect(roots[0]).toMatchObject({ state: "open", lastSyscallSequence: 0n,
    executionProfile: "finiteRoot" });
  const receipts = await fixture.currency.persistence.drizzle.select()
    .from(fxSystemTransactionJournalReceipts)
    .where(eq(fxSystemTransactionJournalReceipts.sessionId, fixture.activation.anchor.sessionId));
  expect(receipts).toHaveLength(0);
  const accepted = fixture.getUpdateRequest();
  if (accepted === undefined) throw new Error("Missing accepted Product operation");
  await expect(Effect.runPromise(fixture.runAdmitted(accepted))).rejects.toBeDefined();
  await expect(Effect.runPromise(fixture.journal.sealSuccessfulResult(
    fixture.attempt, null))).rejects.toBeDefined();
}

async function waitUntil(observe: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!observe()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe.each(drivers)("native Payload Local API in one Product and Application attempt on %s", driver => {
  it("uses the ordinary hook-free runtime for create, update and read in one Application and Product root", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-ordinary-${driver}`, payloadProfile: "ordinary" });
    try {
      const before = await publishedCounts(fixture);
      const workerd = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(workerd);
      const returned = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      expect(returned).toMatchObject({
        pending: { title: fixture.seed.newTitle },
        created: { title: fixture.seed.newTitle, score: 0, enabled: false },
        afterHook: { title: fixture.seed.newTitle, score: 0, enabled: false },
        enabled: { title: fixture.seed.newTitle, score: 0, enabled: true },
        final: { title: fixture.seed.newTitle, score: 0, enabled: true },
      });
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-update")).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-findByID")).toBe(2);
      expect(fixture.payload?.runtimeHistory).toHaveLength(0);
      expect(await publishedCounts(fixture)).toEqual(before);
      expect(await fixture.publish(returned)).toMatchObject({ kind: "published" });
      expect((await publishedCounts(fixture)).outcomes).toBe(before.outcomes + 1);
      expect(await fixture.readCurrentProduct()).toMatchObject({ title: fixture.seed.newTitle });
      const ids = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
        created: Schema.Struct({ id: Schema.String }) }))(returned);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const committed = async (documentId: string) => {
        const identity = decodeAppDocumentIdentityV1(documentId);
        const revisions = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
            eq(fxAppRowRevisions.tableId, identity.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId))));
        const latest = revisions.at(-1);
        if (latest?.valueBytes === null || latest?.valueBytes === undefined || latest.valueSha256 === null)
          throw new Error(`Missing committed row ${documentId}`);
        return (await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: latest.valueBytes,
          sha256: latest.valueSha256, profile: "appDocument" })).value;
      };
      expect(await committed(ids.id)).toMatchObject({ name: fixture.seed.newTitle + ":0" });
      expect(await committed(ids.created.id)).toMatchObject({ title: fixture.seed.newTitle,
        score: 0, enabled: true });
    } finally { await fixture.close(); }
  }, 180_000);

  it("constructs pending-only Payload calls after claim loss and refuses the next Application storage frontier", async () => {
    let fixture: MixedFixture;
    let revoked = false;
    let beforePendingCalls = 0;
    const tentativeMethods: string[] = [];
    fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-pending-claim-loss-${driver}`, payloadProfile: "success",
      hooks: { afterPayloadBeforeAck: (method, result) => Effect.gen(function* () {
        if (method === "payload-create") {
          yield* Effect.tryPromise({ try: async () => {
            const updated = await fixture.currency.persistence.drizzle.update(fxSystemTransactionExecutionClaims)
              .set({ claimedAt: new Date(Date.now() - 120_000), claimExpiresAt: new Date(Date.now() - 60_000) })
              .where(eq(fxSystemTransactionExecutionClaims.sessionId, fixture.activation.anchor.sessionId)).returning();
            expect(updated).toHaveLength(1);
          }, catch: cause => new CmsTransactionError({ reason: "resourceFailure", cause }) });
          revoked = true;
          beforePendingCalls = fixture.getTransactionCounts().beginCount;
        } else {
          expect(revoked).toBe(true);
          expect(result).toMatchObject({ title: fixture.seed.newTitle, score: 1 });
          if (fixture.hasSqlObserver) expect(fixture.getTransactionCounts().beginCount).toBe(beforePendingCalls);
          tentativeMethods.push(method);
        }
      }) } });
    try {
      const before = await publishedCounts(fixture);
      await expect(fixture.runExecution()).rejects.toBeDefined();
      expect(revoked).toBe(true);
      expect(tentativeMethods).toEqual(["payload-findByID", "payload-update", "payload-findByID"]);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(1);
      expect(fixture.nativeInvokeCount.get("payload-findByID")).toBe(2);
      expect(fixture.nativeInvokeCount.get("payload-update")).toBe(1);
      await assertNoPublishedMixedOutput(fixture, before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("runs the selected create hook, nested update/read and outer update on one pending root", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-happy-${driver}`, payloadProfile: "success" });
    try {
      const workerd = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(workerd);
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      expect(returnedValue).toMatchObject({
        pending: { title: fixture.seed.newTitle },
        created: { title: fixture.seed.newTitle, score: 0, enabled: false },
        afterHook: { title: fixture.seed.newTitle, score: 1, enabled: false },
        final: { title: fixture.seed.newTitle, score: 1, enabled: true },
      });
      expect(fixture.payload?.current()?.observations.hookRuns()).toBe(1);
      expect(fixture.payload?.current()?.observations.nestedReads()).toBe(1);
      expect(fixture.payload?.runtimeHistory).toHaveLength(1);
      const published = await fixture.publish(returnedValue);
      expect(published).toMatchObject({ kind: "published" });
      const ids = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
        created: Schema.Struct({ id: Schema.String }) }))(returnedValue);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const committed = async (documentId: string) => {
        const identity = decodeAppDocumentIdentityV1(documentId);
        const revisions = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
            eq(fxAppRowRevisions.tableId, identity.tableId),
            eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(identity.rowId))));
        const latest = revisions.at(-1);
        if (latest?.valueBytes === null || latest?.valueBytes === undefined ||
          latest.valueSha256 === null) throw new Error(`Missing committed row ${documentId}`);
        return (await decodeCanonicalFlarexValueEvidenceV1({ canonicalBytes: latest.valueBytes,
          sha256: latest.valueSha256, profile: "appDocument" })).value;
      };
      expect(await committed(ids.id)).toMatchObject({ name: fixture.seed.newTitle + ":1" });
      expect(await committed(ids.created.id)).toMatchObject({ title: fixture.seed.newTitle,
        score: 1, enabled: true });
      const outcomes = await fixture.currency.persistence.drizzle.select().from(fxSystemIdempotency)
        .where(and(eq(fxSystemIdempotency.scopeUuid, scopeUuid),
          eq(fxSystemIdempotency.requestKey, TransactionRequestKeyV1Schema.make(
            `mixed-product-payload-happy-${driver}`))));
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]).toMatchObject({ resultState: "available" });
      const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
        .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      expect(events.filter(event => event.envelope.group === fixture.eventGroup &&
        event.envelope.contract === fixture.binding.metadata.product.updatedEvent)).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  }, 180_000);

  it("poisons the root when the trusted hook catches a late native validation error", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-caught-late-${driver}`, payloadProfile: "caughtFailure" });
    try {
      const before = await publishedCounts(fixture);
      const failure = await fixture.runExecution().then(() => null, cause => cause);
      expect(failure).toBeInstanceOf(Error);
      const observations = fixture.payload?.runtimeHistory.at(-1)?.observations;
      expect(observations?.hookRuns()).toBe(1);
      expect(observations?.nestedReads()).toBe(1);
      expect(observations?.caughtValidationErrors()).toBe(1);
      expect(fixture.nativeInvokeCount.get("update")).toBe(1);
      await assertNoPublishedMixedOutput(fixture, before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a required title failure after Product work without publishing staged rows", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-required-title-${driver}`, payloadProfile: "success" });
    try {
      const before = await publishedCounts(fixture);
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing selected Payload profile");
      const failure = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          return ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "posts", data: { publishedAt: "2026-01-01" } });
        },
      } } };`).then(() => null, cause => cause);
      expect(failure).toBeInstanceOf(Error);
      expect(fixture.bridgeFailures.join("\n")).toContain("documentInvalid");
      expect(fixture.payload?.runtimeHistory.at(-1)?.observations.hookRuns()).toBe(0);
      await assertNoPublishedMixedOutput(fixture, before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a repeated title in the same pending Payload view", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-unique-title-${driver}`, payloadProfile: "success" });
    try {
      const before = await publishedCounts(fixture);
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing selected Payload profile");
      const failure = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          await ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "posts", data: { title: "same-title", publishedAt: "2026-01-01" } });
          return ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-create",
            { collection: "posts", data: { title: "same-title", publishedAt: "2026-01-01" } });
        },
      } } };`).then(() => null, cause => cause);
      expect(failure).toBeInstanceOf(Error);
      expect(fixture.payload?.runtimeHistory.at(-1)?.observations.hookRuns()).toBe(1);
      await assertNoPublishedMixedOutput(fixture, before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("refuses an unselected Payload method before invoking native code", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-unselected-${driver}`, payloadProfile: "success" });
    try {
      const before = await publishedCounts(fixture);
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing selected Payload profile");
      const outcome = await fixture.runExecution(`export default { users: { create: {
        isMutation: true, isPublic: true, _handler: async (ctx) => {
          await ctx.db.insert("users", { name: "pending" });
          await ctx.privateMixed.call("medusa.product", "update",
            ${JSON.stringify(fixture.seed.updateInput)});
          return ctx.privateMixed.call(${JSON.stringify(participant)}, "payload-delete",
            { collection: "posts", id: "missing" });
        },
      } } };`).then(() => null, cause => cause);
      expect(outcome).toBeInstanceOf(Error);
      expect(fixture.nativeInvokeCount.get("payload-delete") ?? 0).toBe(0);
      expect(fixture.payload?.runtimeHistory).toHaveLength(0);
      expect(await publishedCounts(fixture)).toEqual(before);
    } finally { await fixture.close(); }
  }, 180_000);

  it("leaves no SQL transaction open while the native hook and nested read are held", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-hook-sql-${driver}`, payloadProfile: "inspection" });
    const runtime = () => fixture.payload?.current();
    let running: Promise<unknown> | undefined;
    const checkSql = async (expectedOpenTransactions = 0) => {
      if (fixture.currency.resource.kind === "pglite") {
        expect(fixture.getOpenTransactionDepth()).toBe(0);
        expect(fixture.getTransactionCounts().beginCount).toBeGreaterThan(0);
        expect(fixture.getTransactionCounts().settleCount).toBeGreaterThan(0);
        return;
      }
      const resource = fixture.currency.resource;
      const applicationName = (await resource.target.query<{ applicationName: string }>(
        'select current_setting(\'application_name\') as "applicationName"')).rows[0]?.applicationName;
      if (!applicationName) throw new Error("Missing target PostgreSQL application_name");
      const observed = (await resource.target.query<{ targetBackends: number; openTransactions: number }>(
        `select count(*)::int as "targetBackends",
                count(*) filter (where pid <> pg_backend_pid() and xact_start is not null)::int as "openTransactions"
           from pg_stat_activity
          where datname = current_database()
            and application_name = $1`, [applicationName])).rows[0];
      expect(observed?.targetBackends).toBeGreaterThan(0);
      expect(observed?.openTransactions).toBe(expectedOpenTransactions);
    };
    try {
      if (fixture.currency.resource.kind === "postgres") {
        const witness = await fixture.currency.resource.target.pool.connect();
        try {
          await witness.query("BEGIN");
          await checkSql(1);
        } finally {
          await witness.query("ROLLBACK");
          witness.release();
        }
      }
      running = fixture.runExecution();
      await waitUntil(() => runtime()?.observations.hookEntryHeld() === true,
        "fixed Payload hook entry");
      await checkSql();
      runtime()?.observations.releaseHookEntry();
      await waitUntil(() => runtime()?.observations.nestedResultHeld() === true,
        "fixed Payload nested update and read");
      await checkSql();
      runtime()?.observations.releaseNestedResult();
      const workerd = await running;
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(workerd);
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      expect(await fixture.publish(returnedValue)).toMatchObject({ kind: "published" });
    } finally {
      runtime()?.observations.releaseHookEntry();
      runtime()?.observations.releaseNestedResult();
      if (running !== undefined) await running.catch(() => undefined);
      await fixture.close();
    }
  }, 180_000);
});
