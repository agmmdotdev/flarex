import { and, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as nativeRuntime from "../../payload-adapter/src/runtime/native";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { decodeAppDocumentIdentityV1 } from "flarex-protocol/app-document-id";
import {
  fxAppRowRevisions,
  fxSystemTransactionSessions,
} from "../../persistence-postgres/src/database/schema";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { PointCommitConflictV1Error } from "../../persistence-postgres/src/commit/pointCommitTransaction";
import {
  PointMutationJournalAdmittedOperationRejectedV1Error,
} from "../../executor/src/mutation/journal/errors";
import { admittedCommerceEventGroup } from
  "@flarex/persistence-postgres/internal/commerce-adapter";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)("standalone Payload credential ownership", () => {
  it("refuses the schema owner's credentials before business work and closes the separate connection", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres",
      suffix: "payload-standalone-owner-credentials", payloadProfile: "success",
      hooks: { standaloneOwnerCredentialFault: true } });
    try {
      if (fixture.currency.resource.kind !== "postgres") throw new Error("Missing PostgreSQL fixture");
      const target = fixture.currency.resource.target;
      const rowsBefore = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions);
      const standaloneBackends = async () => (await target.query<{ count: number }>(
        `select count(*)::int as count from pg_stat_activity
          where datname = current_database() and application_name = 'flarex_payload_standalone'`)).rows[0]?.count;
      expect(await standaloneBackends()).toBe(0);
      const leasedConnectionsBefore = target.pool.totalCount - target.pool.idleCount;
      await expect(fixture.runStandalonePayloadCreate("wrong-credentials-must-not-create"))
        .rejects.toThrow("Standalone Payload credential identity mismatch");
      expect(await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)).toEqual(rowsBefore);
      expect(fixture.standalonePayloadPgConnections).toHaveLength(0);
      expect(fixture.payload?.runtimeHistory).toHaveLength(0);
      expect(fixture.nativeInvokeCount.size).toBe(0);
      expect(await standaloneBackends()).toBe(0);
      expect(target.pool.waitingCount).toBe(0);
      expect(target.pool.totalCount - target.pool.idleCount).toBe(leasedConnectionsBefore);
    } finally { await fixture.close(); }
  }, 180_000);
});

describe.each(drivers)("mixed Payload whole-root retry on %s", driver => {
  it("reexecutes Product, the native Payload hook and Application on a fresh attempt", async () => {
    const lifetimes: Array<Readonly<{ initCalls: () => number; destroyCalls: () => number; restore: () => void }>> = [];
    const makeNative = nativeRuntime.makePayloadNative;
    const construction = vi.spyOn(nativeRuntime, "makePayloadNative").mockImplementation((...args) =>
      makeNative(...args).pipe(Effect.tap(native => Effect.sync(() => {
        const initialize = vi.spyOn(native.payload, "init");
        const destroy = vi.spyOn(native.payload, "destroy");
        lifetimes.push({ initCalls: () => initialize.mock.calls.length,
          destroyCalls: () => destroy.mock.calls.length,
          restore: () => { initialize.mockRestore(); destroy.mockRestore(); } });
      }))));
    try {
    const fixture = await createMixedMutationProductFixture({ driver,
      suffix: `payload-retry-${driver}`, payloadProfile: "success" });
    try {
      expect(lifetimes).toHaveLength(1);
      expect(lifetimes[0]?.initCalls()).toBe(0);
      expect(lifetimes[0]?.destroyCalls()).toBe(0);
      const raw = await fixture.runExecution();
      const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
        result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
      const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
        success.result.result))).value;
      const original = Schema.decodeUnknownSync(Schema.Struct({ created: Schema.Struct({ id: Schema.String }) }))(
        returnedValue);
      const participant = fixture.payload?.profile.participant;
      if (participant === undefined) throw new Error("Missing selected Payload profile");
      const originalCreateRequest = fixture.getAdmittedRequest(participant, "payload-create");
      if (originalCreateRequest === undefined) throw new Error("Missing original Payload create request");
      expect(fixture.payload?.runtimeHistory).toHaveLength(1);
      expect(fixture.payload?.runtimeHistory[0]?.observations.hookRuns()).toBe(1);
      await fixture.runStandaloneProductUpdate({ title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone` });
      if (driver === "postgres") {
        expect(fixture.standaloneProductPgConnections).toHaveLength(1);
        const connection = fixture.standaloneProductPgConnections[0];
        expect(connection?.standalonePid).not.toBe(connection?.primaryTargetPid);
      }
      const conflict = await fixture.prepareOccPublication(returnedValue)
        .then(publication => Effect.runPromise(publication)).then(() => null, cause => cause);
      expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
      const [fenced] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
      if (fenced === undefined) throw new Error("Missing genuine fenced finite anchor");
      expect(fenced).toMatchObject({ executionProfile: "finiteRoot", lifecycle: "retrying",
        finiteClaimFence: fixture.activation.executionClaim.claimFence + 1n });
      expect((await Effect.runPromise(readFiniteAttemptAnchorRow(fenced))).reservation?.snapshotToken)
        .toEqual(fixture.activation.anchor.snapshotToken);
      expect(await fixture.retryWholeAttempt(conflict)).toMatchObject({ kind: "published" });
      expect(fixture.retryContexts).toHaveLength(1);
      const fresh = fixture.retryContexts[0];
      if (fresh === undefined) throw new Error("Missing fresh retry context");
      expect(fresh.attemptFence).toBeGreaterThan(fixture.activation.anchor.attemptFence);
      expect(fresh.snapshotToken.commitSeq).toBeGreaterThan(
        fixture.activation.anchor.snapshotToken.commitSeq);
      const [committedAnchor] = await fixture.currency.persistence.drizzle.select().from(fxSystemTransactionSessions)
        .where(eq(fxSystemTransactionSessions.sessionId, fixture.activation.anchor.sessionId));
      expect(committedAnchor).toMatchObject({ executionProfile: "finiteRoot", lifecycle: "committed",
        attemptFence: fresh.attemptFence, finiteSnapshotCommitSeq: fresh.snapshotToken.commitSeq });
      const history = fixture.payload?.runtimeHistory;
      expect(history).toHaveLength(2);
      expect(history?.[1]).not.toBe(history?.[0]);
      expect(history?.[1]?.runtime).not.toBe(history?.[0]?.runtime);
      expect(history?.[1]?.payload).toBe(history?.[0]?.payload);
      expect(history?.map(runtime => runtime.observations.hookRuns())).toEqual([1, 1]);
      expect(history?.map(runtime => runtime.observations.requests())).toEqual([4, 4]);
      expect(history?.map(runtime => runtime.observations.dataLoaders())).toEqual([4, 4]);
      expect(lifetimes).toHaveLength(1);
      expect(lifetimes[0]?.initCalls()).toBe(0);
      expect(lifetimes[0]?.destroyCalls()).toBe(0);
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(2);
      expect(fixture.nativeInvokeCount.get("update")).toBe(2);
      const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
      const cmsTableId = decodeAppDocumentIdentityV1(original.created.id).tableId;
      const committedPosts = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
        .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, cmsTableId)));
      expect(committedPosts).toHaveLength(1);
      const committedEvents = await fixture.currency.persistence.drizzle.select()
        .from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
      const freshGroup = admittedCommerceEventGroup({ scopeUuid,
        sessionId: fixture.activation.anchor.sessionId, attemptFence: fresh.attemptFence });
      expect(committedEvents.filter(event => event.envelope.group === fixture.eventGroup)).toHaveLength(0);
      expect(committedEvents.filter(event => event.envelope.group === freshGroup)).toHaveLength(1);
      const callsBeforeStale = fixture.nativeInvokeCount.get("payload-create");
      const stale = await Effect.runPromise(fixture.runAdmitted({ ...originalCreateRequest,
        syscallSequence: CommitSyscallSequenceV1Schema.make(10n) })).then(() => null, cause => cause);
      expect(stale).toBeInstanceOf(PointMutationJournalAdmittedOperationRejectedV1Error);
      if (!(stale instanceof PointMutationJournalAdmittedOperationRejectedV1Error))
        throw new Error("Missing exact closed-root Payload refusal", { cause: stale });
      expect(stale.result).toEqual({ kind: "stateRejected", issue: { reason: "journalFailed" } });
      expect(fixture.nativeInvokeCount.get("payload-create")).toBe(callsBeforeStale);
    } finally { await fixture.close(); }
    expect(lifetimes[0]?.destroyCalls()).toBe(1);
    } finally { construction.mockRestore(); for (const lifetime of lifetimes) lifetime.restore(); }
  }, 180_000);
});

describe.each(drivers)("mixed Payload historical title conflict on %s", driver => {
    it("loses to a real standalone Payload create and retries the whole root on a fresh attempt facade", async () => {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: `payload-standalone-title-conflict-${driver}`, payloadProfile: "success" });
      try {
        const raw = await fixture.runExecution();
        const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
          result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
        const returnedValue = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
          success.result.result))).value;
        const standalone = await fixture.runStandalonePayloadCreate(fixture.seed.newTitle);
        const standalonePost = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
          title: Schema.String }))(standalone);
        expect(standalonePost.title).toBe(fixture.seed.newTitle);
        if (driver === "postgres") {
          expect(fixture.standalonePayloadPgConnections).toHaveLength(1);
          const connection = fixture.standalonePayloadPgConnections[0];
          expect(connection?.standalonePid).not.toBe(connection?.primaryTargetPid);
        }
        const conflict = await fixture.prepareOccPublication(returnedValue)
          .then(publication => Effect.runPromise(publication)).then(() => null, cause => cause);
        expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);
        expect(conflict).toMatchObject({ conflict: { kind: "finiteRootGraph", observation: { readKind: "unique" } } });
        const unrelatedTitle = `${fixture.seed.newTitle} unrelated`;
        const unrelated = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
          title: Schema.String }))(await fixture.runStandalonePayloadCreate(unrelatedTitle));
        expect(unrelated.title).toBe(unrelatedTitle);
        expect(unrelated.id).not.toBe(standalonePost.id);
        if (driver === "postgres") expect(fixture.standalonePayloadPgConnections).toHaveLength(2);
        const retryFailure = await fixture.retryWholeAttempt(conflict).then(() => null, cause => cause);
        expect(retryFailure).toBeInstanceOf(Error);
        expect(fixture.retryContexts).toHaveLength(1);
        expect(fixture.bridgeFailures.join("\n")).toContain("documentInvalid");
        expect(fixture.bridgeFailures.join("\n")).toMatch(/unique/i);
        expect(fixture.payload?.runtimeHistory).toHaveLength(2);
        expect(fixture.payload?.runtimeHistory[1]).not.toBe(fixture.payload?.runtimeHistory[0]);
        expect(fixture.payload?.runtimeHistory[1]?.runtime).not.toBe(fixture.payload?.runtimeHistory[0]?.runtime);
        expect(fixture.payload?.runtimeHistory[1]?.payload).toBe(fixture.payload?.runtimeHistory[0]?.payload);
        expect(fixture.payload?.runtimeHistory.map(runtime => runtime.observations.hookRuns())).toEqual([1, 0]);
        const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
        const rows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
          eq(fxAppRowRevisions.tableId, decodeAppDocumentIdentityV1(standalonePost.id).tableId)));
        expect(rows).toHaveLength(2);
        const appRows = await fixture.currency.persistence.drizzle.select().from(fxAppRowRevisions)
          .where(and(eq(fxAppRowRevisions.scopeUuid, scopeUuid),
            eq(fxAppRowRevisions.tableId, CatalogTableIdSchema.make(1))));
        expect(appRows).toHaveLength(0);
        const events = await fixture.currency.persistence.drizzle.select().from(fxSystemCommitEvents)
          .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
        const freshFence = fixture.retryContexts[0]?.attemptFence;
        if (freshFence === undefined) throw new Error("Missing retry attempt fence");
        const freshGroup = admittedCommerceEventGroup({ scopeUuid,
          sessionId: fixture.activation.anchor.sessionId, attemptFence: freshFence });
        expect(events.filter(event => event.envelope.group === fixture.eventGroup ||
          event.envelope.group === freshGroup)).toHaveLength(0);
      } finally { await fixture.close(); }
    }, 180_000);
});
