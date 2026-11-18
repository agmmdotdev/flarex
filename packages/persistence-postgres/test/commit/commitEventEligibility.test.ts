import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import { createPGliteLocatedIndexBuildReconciliationTargetV1 } from "../../src/database/pglite";
import { createPostgresLocatedIndexBuildReconciliationTargetV1 } from "../../src/database/postgres";
import { makePostgresRelationalSession } from "../../src/database/relationalTransaction/session";
import { fxSystemCommits } from "../../src/database/schema/commitHeaders";
import { fxSystemCommitEventDeliveries, fxSystemCommitEvents } from "../../src/commit/events/schema";
import { fxSystemCommitEventEligibilityMembers as members } from "../../src/commit/events/eligibilitySchema";
import { decodeStoredCommitEventEligibilityGroup, makeCommitEventEligibilityStore, prepareCommitEventEligibility, bindCommitEventEligibility,
  enrollCommitEventEligibilityInTransaction, validatePreparedCommitEventEligibilityInTransaction, inspectCommitEventEligibility, type CommitEventEligibilityGroup } from "../../src/commit/events/eligibility";
import { makeCommitEventTransactionRunner, type CommitEventTransactionInput } from "../../src/commit/events/transaction";
import { makeCommitEventStore } from "../../src/commit/events/store";
import { makeCommitEventPump } from "../../src/commit/events/pump";
import { commitEventsDigest } from "../../src/commit/events/digest";
import { eventError, type CommittedEvent } from "../../src/commit/events/model";
import { runDrizzleStatementEffect } from "../../src/database/drizzleStatementEffect";
import { insertCurrentScopeClockFixture } from "../scope/scopeClockFixture";
import { createRelationalPGliteFixture } from "../database/relationalPGliteWorkerTestSupport";
import { withTemporaryPostgresPersistence } from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";
import { TASK_LOCATOR } from "../tasks/taskSystemRunAttemptStoreTestSupport";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
const subscriber = { id: "eligibility-witness", revision: "c".repeat(64) };
const event: CommittedEvent = { contract: "eligibility-witness", contractRevision: "a".repeat(64), producerRevision: "b".repeat(64),
  internal: false, group: "native-descriptive-string", message: { id: "retained" }, subscribers: [subscriber] };
const definition = (groupId: string, maximumCommits = 16) => ({ groupId, ownerIdentity: "d".repeat(64), policyRevision: "e".repeat(64), maximumCommits });
const statement = <A>(query: PromiseLike<A>) => runDrizzleStatementEffect(query, cause => eventError("statementFailure", cause));

describe("stored event eligibility projection", () => {
  it("decodes held and terminal states and ignores columns owned by the scoped query", async () => {
    const held = { ...definition("stored"), memberCount: 0, state: "held", decidedAt: null };
    expect(await runEffect(decodeStoredCommitEventEligibilityGroup({ ...held, scopeUuid: "query-owned", epochUuid: "query-owned" }))).toEqual(held);
    const decidedAt = new Date(0);
    for (const state of ["released", "cleared"]) {
      const terminal = { ...held, state, decidedAt, memberCount: 16 };
      expect(await runEffect(decodeStoredCommitEventEligibilityGroup(terminal))).toEqual(terminal);
    }
  });

  it.each([
    ["fractional member count", { memberCount: 0.5 }],
    ["negative member count", { memberCount: -1 }],
    ["member count above owner ceiling", { memberCount: 17 }],
    ["member count above selected bound", { maximumCommits: 1, memberCount: 2 }],
    ["numeric member count string", { memberCount: "1" }],
    ["NaN member count", { memberCount: Number.NaN }],
    ["unknown state", { state: "pending" }],
    ["held with decision time", { decidedAt: new Date(0) }],
    ["released without decision time", { state: "released" }],
    ["cleared without decision time", { state: "cleared" }],
    ["invalid terminal Date", { state: "released", decidedAt: new Date(Number.NaN) }],
    ["terminal time text", { state: "cleared", decidedAt: "1970-01-01T00:00:00.000Z" }],
    ["malformed owner identity", { ownerIdentity: "bad" }],
    ["malformed policy revision", { policyRevision: "bad" }],
    ["blank group identity", { groupId: "" }],
    ["zero maximum commits", { maximumCommits: 0 }],
    ["maximum above owner ceiling", { maximumCommits: 17 }],
    ["missing required state", { state: undefined }],
  ])("refuses %s as stored corruption", async (_label, malformed) => {
    const row = { ...definition("stored"), memberCount: 0, state: "held", decidedAt: null, ...malformed };
    expect(await runEffect(Effect.result(decodeStoredCommitEventEligibilityGroup(row))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });
});

describe(`bounded committed event eligibility - ${driver}`, () => {
  it("holds real membership across restart, releases conjunctions, clears immutably and preserves ordinary delivery", async () => {
    await withFixture(async input => {
      const eligibility = await runEffect(makeCommitEventEligibilityStore(input));
      const transact = await runEffect(makeCommitEventTransactionRunner(input));
      const parent = await runEffect(eligibility.open(definition("parent")));
      const notification = await runEffect(eligibility.open(definition("notification")));
      const publication = (sequence: number, selected: readonly CommitEventEligibilityGroup[] = []) => Effect.gen(function* () {
        const prepared = selected.length === 0 ? undefined : Result.getOrThrow(prepareCommitEventEligibility(selected));
        const contribution = prepared === undefined ? { values: [event], sha256: yield* commitEventsDigest([event]) } : yield* bindCommitEventEligibility([event], prepared);
        const commitSeq = CommitSeqSchema.make(BigInt(sequence));
        yield* transact((tx, pins, now) => Effect.gen(function* () {
          if (prepared !== undefined) yield* validatePreparedCommitEventEligibilityInTransaction(tx, pins, prepared);
          yield* statement(tx.insert(fxSystemCommits).values({ ...pins, commitSeq, changeCount: 0, eventCount: 1, eventSha256: contribution.sha256 }));
          const envelope = contribution.values[0];
          if (envelope === undefined) return yield* Effect.die("Missing fixture event");
          yield* statement(tx.insert(fxSystemCommitEvents).values({ ...pins, commitSeq, eventOrdinal: 0, envelope }));
          yield* statement(tx.insert(fxSystemCommitEventDeliveries).values({ ...pins, commitSeq, eventOrdinal: 0,
            subscriberId: subscriber.id, handlerRevision: subscriber.revision, state: "pending", nextAttemptAt: now }));
          if (prepared !== undefined) yield* enrollCommitEventEligibilityInTransaction(tx, { ...pins, commitSeq }, prepared);
        }));
        return commitSeq;
      });
      const publish = (sequence: number, selected: readonly CommitEventEligibilityGroup[] = []) => runEffect(publication(sequence, selected));
      const held = await publish(1, [parent, notification]);
      await publish(2); // Same descriptive `group` confers no hold authority.
      const store = await runEffect(makeCommitEventStore(input));
      const verified = await runEffect(store.verifyFamily(held));
      expect(await runEffect(store.claimVerifiedBatch(verified, [subscriber], 8))).toEqual([]);
      expect(await runEffect(store.claimBatch(held, [subscriber], 8))).toEqual([]);
      expect(await runEffect(eligibility.decide(notification, "released"))).toBe("applied");
      expect(await runEffect(store.claimVerifiedBatch(verified, [subscriber], 8))).toEqual([]);
      const deliveries: string[] = [];
      const pump = await runEffect(makeCommitEventPump(input, [{ ...subscriber, handle: message => Effect.sync(() => { deliveries.push(message.eventId); }) }]));
      const first = await runEffect(pump.runNext());
      expect(first).toMatchObject({ done: false, cursor: 1n, delivered: 0 });
      expect(await runEffect(pump.runNext(first.cursor))).toMatchObject({ cursor: 2n, delivered: 1 });
      expect(await runEffect(pump.runNext(2n))).toMatchObject({ done: true, cursor: 0n });
      // A new trusted store can recover the same durable identity; no in-process deferred owns the hold.
      const restarted = await runEffect(makeCommitEventEligibilityStore(input));
      const recovered = await runEffect(restarted.open(definition("parent")));
      expect(await runEffect(restarted.decide(recovered, "released"))).toBe("applied");
      expect(await runEffect(restarted.decide(recovered, "released"))).toBe("replayed");
      expect(await runEffect(Effect.result(restarted.decide(recovered, "cleared")))).toMatchObject({ _tag: "Failure", failure: { reason: "groupConflict" } });
      expect(await runEffect(pump.runNext())).toMatchObject({ cursor: 1n, delivered: 1 });
      expect(deliveries).toHaveLength(2);
      // Cached family tokens reacquire the current decision before selecting claims.
      expect(await runEffect(store.claimVerifiedBatch(verified, [subscriber], 8))).toEqual([]);
      expect(await runEffect(Effect.result(publication(3, [parent])))).toMatchObject({ _tag: "Failure", failure: { reason: "groupClosed" } });
      const clearedGroup = await runEffect(eligibility.open(definition("cleared")));
      const cleared = await publish(4, [clearedGroup]);
      const clearedVerified = await runEffect(store.verifyFamily(cleared));
      const before = await input.database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.commitSeq, cleared));
      expect(await runEffect(eligibility.decide(clearedGroup, "cleared"))).toBe("applied");
      expect(await runEffect(eligibility.decide(clearedGroup, "cleared"))).toBe("replayed");
      expect(await runEffect(store.claimBatch(cleared, [subscriber], 8))).toEqual([]);
      expect(await input.database.select().from(fxSystemCommitEvents).where(eq(fxSystemCommitEvents.commitSeq, cleared))).toEqual(before);
      expect(await runEffect(Effect.result(eligibility.open({ ...definition("cleared"), policyRevision: "f".repeat(64) })))).toMatchObject({ _tag: "Failure", failure: { reason: "groupConflict" } });
      const bounded = await runEffect(eligibility.open(definition("bounded", 1)));
      await publish(5, [bounded]);
      expect(await runEffect(Effect.result(publication(6, [bounded])))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(await input.database.select().from(fxSystemCommits).where(eq(fxSystemCommits.commitSeq, CommitSeqSchema.make(6n)))).toEqual([]);
      expect(Result.isFailure(prepareCommitEventEligibility([bounded, bounded]))).toBe(true);
      expect(Result.isFailure(prepareCommitEventEligibility([{} as CommitEventEligibilityGroup]))).toBe(true);
      let getterCalls = 0;
      const unsafe = [bounded];
      Object.defineProperty(unsafe, "0", { get: () => { getterCalls++; return bounded; } });
      expect(Result.isFailure(prepareCommitEventEligibility(unsafe))).toBe(true);
      expect(getterCalls).toBe(0);
      const prepared = Result.getOrThrow(prepareCommitEventEligibility([bounded]));
      const canonA = Result.getOrThrow(inspectCommitEventEligibility(Result.getOrThrow(prepareCommitEventEligibility([notification, parent]))));
      const canonB = Result.getOrThrow(inspectCommitEventEligibility(Result.getOrThrow(prepareCommitEventEligibility([parent, notification]))));
      expect(canonA).toEqual(canonB);
      const bound = await runEffect(bindCommitEventEligibility([event], prepared));
      expect(bound.additionalBytes).toBeGreaterThan(0);
      expect(bound.sha256).not.toBe(await runEffect(commitEventsDigest([event])));
      const zero = await runEffect(eligibility.open(definition("zero-events")));
      const zeroPrepared = Result.getOrThrow(prepareCommitEventEligibility([zero]));
      await runEffect(transact((tx, pins) => validatePreparedCommitEventEligibilityInTransaction(tx, pins, zeroPrepared)));
      expect(await runEffect(eligibility.decide(zero, "released"))).toBe("applied");
      expect(await runEffect(Effect.result(transact((tx, pins) => validatePreparedCommitEventEligibilityInTransaction(tx, pins, zeroPrepared))))).toMatchObject({ _tag: "Failure", failure: { reason: "groupClosed" } });
      const race = await runEffect(eligibility.open(definition("terminal-race")));
      const raced = await Promise.all([runEffect(Effect.result(eligibility.decide(race, "released"))), runEffect(Effect.result(eligibility.decide(race, "cleared")))]);
      expect(raced.filter(Result.isSuccess)).toHaveLength(1);
      expect(raced.filter(Result.isFailure)).toMatchObject([{ failure: { reason: "groupConflict" } }]);
      const releaseRace = await runEffect(eligibility.open(definition("release-claim-race")));
      const racedCommit = await publish(7, [releaseRace]);
      const [racedClaims] = await Promise.all([runEffect(store.claimBatch(racedCommit, [subscriber], 8)), runEffect(eligibility.decide(releaseRace, "released"))]);
      const claims = racedClaims.length === 0 ? await runEffect(store.claimBatch(racedCommit, [subscriber], 8)) : racedClaims;
      expect(claims).toHaveLength(1);
      expect(await runEffect(Effect.result(eligibility.decide(releaseRace, "cleared")))).toMatchObject({ _tag: "Failure", failure: { reason: "groupConflict" } });
      if (claims[0] === undefined) throw new Error("Expected release-race claim");
      await runEffect(store.settle(claims[0]));
      expect(await runEffect(Effect.result(bindCommitEventEligibility([], prepared)))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      // Removing a membership cannot silently turn held intent into ordinary eligible work.
      await runEffect(transact((tx, pins) => statement(tx.delete(members).where(and(eq(members.scopeUuid, pins.scopeUuid), eq(members.epochUuid, pins.epochUuid), eq(members.commitSeq, cleared))))));
      expect(await runEffect(Effect.result(store.claimBatch(cleared, [subscriber], 8)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
      expect(await runEffect(Effect.result(store.claimVerifiedBatch(clearedVerified, [subscriber], 8)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
    });
  }, 480_000);
});

async function withFixture(run: (input: CommitEventTransactionInput) => Promise<void>) {
  const scopeId = ScopeIdSchema.make(`scope_${randomUUID()}`), epoch = `epoch_${randomUUID()}`;
  const deploymentId = "eligibility-fixture";
  const prepare = async (database: CommitEventTransactionInput["database"], session: CommitEventTransactionInput["session"], target: ReturnType<typeof createPGliteLocatedIndexBuildReconciliationTargetV1>) => {
    await insertCurrentScopeClockFixture(database, { scopeId, epoch, lastCommitSeq: 32n });
    const metadata = { scopeId, deploymentId, activeSchemaVersionId: null, createdAt: new Date(), isolationKind: "shared_database" as const, physicalLocator: TASK_LOCATOR };
    return { database, session, scopeId, deploymentId, authority: {
      scopeMetadata: { getScopeMetadata: async () => metadata }, provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => null },
      scopeClockTargets: { resolve: async () => target },
    } } satisfies CommitEventTransactionInput;
  };
  if (driver === "postgres") {
    await withTemporaryPostgresPersistence(async persistence => {
      await run(await prepare(persistence.drizzle, makePostgresRelationalSession(persistence), createPostgresLocatedIndexBuildReconciliationTargetV1(persistence, TASK_LOCATOR)));
    });
  } else if (driver === "pglite") {
    const cleanup: Array<() => Promise<void>> = [];
    const fixture = await createRelationalPGliteFixture({ registerCleanup: close => cleanup.push(close) });
    try { await run(await prepare(fixture.persistence.drizzle, fixture.session, createPGliteLocatedIndexBuildReconciliationTargetV1(fixture.persistence, TASK_LOCATOR))); }
    finally { for (const close of cleanup.reverse()) await close(); }
  } else throw new Error("Invalid eligibility test driver");
}
