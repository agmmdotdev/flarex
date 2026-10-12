import { inspect } from "node:util";
import { and, eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemCommits, fxSystemTransactionSessions, fxSystemSnapshotLeases,
  fxSystemTransactionJournals, fxSystemTransactionExecutionClaims } from "../../persistence-postgres/src/database/schema";
import { readFiniteAttemptAnchorRow } from "../../persistence-postgres/src/execution/finiteAttemptAnchor";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import {
  createPointCommitPublisherPortV1,
} from "../../persistence-postgres/src/commit/point/construction";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createMixedMutationProductFixture } from "./support/mixedMutationWorkerdFixture";
import { installOneCommitResponseFault } from "./support/postgresCommitResponseFault";

const describePostgres = postgresUrl === null ? describe.skip : describe;
async function runMixedAttempt(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>) {
  const database = fixture.currency.persistence.drizzle;
  const selector = fixture.activation.anchor;
  const scopeUuid = projectScopeIdUuidV1(selector.scopeId).scopeUuid;
  const sessions = await database.select().from(fxSystemTransactionSessions).where(and(
    eq(fxSystemTransactionSessions.scopeUuid, scopeUuid), eq(fxSystemTransactionSessions.sessionId, selector.sessionId)));
  const session = sessions[0];
  if (session === undefined || sessions.length !== 1) throw new Error("Missing exact finite attempt anchor");
  expect(session.executionProfile).toBe("finiteRoot");
  const captured = await Effect.runPromise(readFiniteAttemptAnchorRow(session));
  expect(captured.reservation).not.toBeNull();
  expect(captured.snapshotToken).toEqual(selector.snapshotToken);
  for (const table of [fxSystemSnapshotLeases, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims]) {
    expect(await database.select().from(table).where(and(
      eq(table.scopeUuid, scopeUuid), eq(table.sessionId, selector.sessionId)))).toHaveLength(0);
  }
  const raw = await fixture.runExecution();
  const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
    result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
  return (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
    success.result.result))).value;
}

async function committedMixedFacts(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>) {
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const database = fixture.currency.persistence.drizzle;
  const commits = await database.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid));
  const events = await database.select().from(fxSystemCommitEvents)
    .where(eq(fxSystemCommitEvents.scopeUuid, scopeUuid));
  return { commits: commits.length, productEvents: events.filter(event =>
    event.envelope.group === fixture.eventGroup &&
    event.envelope.contract === fixture.binding.metadata.product.updatedEvent).length };
}

async function waitForBlockedScopeClock(
  fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>,
): Promise<void> {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await fixture.currency.resource.target.pool.query<{ blocked: number }>(`
      select count(*)::int as blocked
      from pg_stat_activity
      where datname = current_database()
        and application_name = 'flarex_product_standalone'
        and cardinality(pg_blocking_pids(pid)) > 0
    `);
    if ((result.rows[0]?.blocked ?? 0) >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Native standalone Product writer did not wait on the scope clock");
}

type StandaloneOutcome = Readonly<{ kind: "succeeded"; value: unknown }> |
  Readonly<{ kind: "failed"; error: unknown }>;

describePostgres("mixed Product commit recovery on real PostgreSQL", () => {
  it("serializes a native standalone Product writer behind mixed publication on the same scope", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "standalone-lock" });
    try {
      const returnedValue = await runMixedAttempt(fixture);
      const before = await committedMixedFacts(fixture);
      let enteredClock: () => void = () => undefined;
      const clockLocked = new Promise<void>(resolve => { enteredClock = resolve; });
      let releaseClock: () => void = () => undefined;
      const release = new Promise<void>(resolve => { releaseClock = resolve; });
      const publisher = createPointCommitPublisherPortV1(fixture.pointCommitPorts, {
        ...fixture.publisherOptions,
        afterTransactionStep: async event => {
          if (event.step !== "clockLocked") return;
          enteredClock();
          await release;
        },
      });
      const publishing = Effect.runFork(await fixture.preparePublication(returnedValue, publisher));
      let standalone: Promise<StandaloneOutcome> | undefined;
      let clockTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          clockLocked,
          Effect.runPromise(Fiber.await(publishing)).then(() => {
            throw new Error("Mixed publisher settled before locking the scope clock");
          }),
          new Promise<never>((_, reject) => {
            clockTimeout = setTimeout(() => reject(new Error("Mixed publisher did not lock the scope clock")), 30_000);
          }),
        ]);
        if (clockTimeout !== undefined) {
          clearTimeout(clockTimeout);
          clockTimeout = undefined;
        }
        let standaloneSettled = false;
        standalone = fixture.runStandaloneProductUpdate({
          title: `${fixture.seed.newTitle} later`,
          handle: `${fixture.seed.newHandle}-later`,
        }).then(value => ({ kind: "succeeded" as const, value }),
          error => ({ kind: "failed" as const, error })).finally(() => { standaloneSettled = true; });
        await Promise.race([waitForBlockedScopeClock(fixture), standalone.then(outcome => {
          if (outcome.kind === "failed") throw outcome.error;
          throw new Error("Standalone Product writer settled before the scope-clock wait");
        })]);
        expect(standaloneSettled).toBe(false);
        releaseClock();
        expect(Exit.isSuccess(await Effect.runPromise(Fiber.await(publishing)))).toBe(true);
        const standaloneOutcome = await standalone;
        expect(standaloneOutcome, inspect(standaloneOutcome, { depth: 10 }))
          .toMatchObject({ kind: "failed", error: { reason: "writeConflict" } });
        expect(await committedMixedFacts(fixture)).toEqual({ commits: before.commits + 1,
          productEvents: before.productEvents + 1 });
        expect(await fixture.readCurrentProduct()).toMatchObject({ id: fixture.seed.productId,
          title: fixture.seed.newTitle, handle: fixture.seed.newHandle });
      } finally {
        if (clockTimeout !== undefined) clearTimeout(clockTimeout);
        releaseClock();
        await Effect.runPromise(Fiber.interrupt(publishing));
        if (standalone !== undefined) await Promise.allSettled([standalone]);
      }
    } finally { await fixture.close(); }
  }, 180_000);

  it("rejects a mixed attempt after a separate native Product commit changes its historical row and handle", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "standalone-conflict" });
    try {
      const returnedValue = await runMixedAttempt(fixture);
      const before = await committedMixedFacts(fixture);
      const standalone = await fixture.runStandaloneProductUpdate({
        title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone`,
      });
      expect(standalone).toMatchObject({ id: fixture.seed.productId,
        title: `${fixture.seed.newTitle} standalone`,
        handle: `${fixture.seed.newHandle}-standalone` });
      const afterStandalone = await committedMixedFacts(fixture);
      expect(afterStandalone).toEqual({ commits: before.commits + 1,
        productEvents: before.productEvents });
      const publication = await fixture.preparePublication(returnedValue);
      const outcome = await Effect.runPromise(Effect.result(publication));
      expect(outcome).toMatchObject({
        _tag: "Failure", failure: { _tag: "PointCommitConflictV1Error" },
      });
      expect(await committedMixedFacts(fixture)).toEqual(afterStandalone);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1,
        retrieve: 1, listByHandle: 1 });
    } finally { await fixture.close(); }
  }, 180_000);

  it("resolves a forwarded COMMIT response loss without another native call or event", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "commit-response" });
    try {
      const returnedValue = await runMixedAttempt(fixture);
      const before = await committedMixedFacts(fixture);
      const lost = new Error("forwarded mixed COMMIT response lost");
      const publication = await fixture.preparePublication(returnedValue);
      const fault = await installOneCommitResponseFault(fixture, before.commits, () => { throw lost; });
      const first = await Effect.runPromise(publication).finally(fault.restore);
      expect(fault.fired()).toBe(true);
      expect(first).toMatchObject({ kind: "replayed" });
      const after = await committedMixedFacts(fixture);
      expect(after).toEqual({ commits: before.commits + 1, productEvents: before.productEvents + 1 });
      expect(await fixture.replayPublication())
        .toMatchObject({ kind: "replayed" });
      expect(await committedMixedFacts(fixture)).toEqual(after);
      expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1,
        retrieve: 1, listByHandle: 1 });
    } finally { await fixture.close(); }
  }, 180_000);

  it("drains interruption after a forwarded COMMIT before reporting the durable outcome", async () => {
    const fixture = await createMixedMutationProductFixture({ driver: "postgres", suffix: "commit-interrupt" });
    try {
      const returnedValue = await runMixedAttempt(fixture);
      const before = await committedMixedFacts(fixture);
      let signalCommitted: () => void = () => undefined;
      const committed = new Promise<void>(resolve => { signalCommitted = resolve; });
      let releaseResponse: () => void = () => undefined;
      const release = new Promise<void>(resolve => { releaseResponse = resolve; });
      const publication = await fixture.preparePublication(returnedValue);
      const fault = await installOneCommitResponseFault(fixture, before.commits,
        async () => {
          signalCommitted();
          await release;
          throw new Error("forwarded mixed COMMIT response lost after interruption");
        });
      const fiber = Effect.runFork(publication);
      let signalTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          committed,
          Effect.runPromise(Fiber.await(fiber)).then(() => { throw new Error("Publish settled before COMMIT"); }),
          new Promise<never>((_, reject) => {
            signalTimeout = setTimeout(() => reject(new Error("COMMIT was not reached")), 30_000);
          }),
        ]);
        let interruptionSettled = false;
        const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(exit => {
          interruptionSettled = true;
          return exit;
        });
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(interruptionSettled).toBe(false);
        releaseResponse();
        await interruption;
        expect(fault.fired()).toBe(true);
        expect(Exit.hasInterrupts(await Effect.runPromise(Fiber.await(fiber)))).toBe(true);
        expect(await fixture.replayPublication())
          .toMatchObject({ kind: "replayed" });
        expect(await committedMixedFacts(fixture)).toEqual({
          commits: before.commits + 1, productEvents: before.productEvents + 1,
        });
        expect(Object.fromEntries(fixture.nativeInvokeCount)).toMatchObject({ update: 1,
          retrieve: 1, listByHandle: 1 });
      } finally {
        if (signalTimeout !== undefined) clearTimeout(signalTimeout);
        releaseResponse();
        await Effect.runPromise(Fiber.interrupt(fiber));
        fault.restore();
      }
    } finally { await fixture.close(); }
  }, 180_000);
});
