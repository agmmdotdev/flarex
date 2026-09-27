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
import { fxAppRowRevisions, fxSystemIdempotency, fxSystemTransactionJournals } from
  "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { createMixedMutationProductFixture } from "./support/mixedMutationProductFixture";

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
  expect(roots[0]?.state).toBe("operation_failed");
}

async function waitUntil(observe: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!observe()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe.each(drivers)("native Payload Local API in one Product and Application attempt on %s", driver => {
  it("runs the selected create hook, nested update/read and outer update on one pending root", async () => {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-happy-${driver}`, payloadProfile: "success" });
    try {
      const workerd = await fixture.runWorkerd();
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
      const failure = await fixture.runWorkerd().then(() => null, cause => cause);
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
      const failure = await fixture.runWorkerd(`export default { users: { create: {
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
      const failure = await fixture.runWorkerd(`export default { users: { create: {
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
      const outcome = await fixture.runWorkerd(`export default { users: { create: {
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
    const checkSql = async () => {
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
      const observed = (await resource.control.query<{ targetBackends: number; openTransactions: number }>(
        `select count(*)::int as "targetBackends",
                count(*) filter (where xact_start is not null)::int as "openTransactions"
           from pg_stat_activity
          where datname = current_database() and usename = current_user
            and application_name = $1 and pid <> pg_backend_pid()`, [applicationName])).rows[0];
      expect(observed?.targetBackends).toBeGreaterThan(0);
      expect(observed?.openTransactions).toBe(0);
    };
    try {
      running = fixture.runWorkerd();
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
