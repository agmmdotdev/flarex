import { eq } from "drizzle-orm";
import { Effect, Exit, Fiber, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodePointMutationExactRuntimeResultV1Effect } from "flarex-protocol/point-mutation-exact-runtime";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { fxSystemCommits } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { createPointCommitPublisherPortV1 } from "../../persistence-postgres/src/pointCommitTransaction";
import type { PostgresLocatedReadCommittedRunnerOptionsV1 } from
  "../../persistence-postgres/src/postgresLocatedReadCommitted";
import { postgresUrl } from "../../persistence-postgres/test/postgresHelpers";
import { createMixedMutationProductFixture } from "./support/mixedMutationProductFixture";

const describePostgres = postgresUrl === null ? describe.skip : describe;
type PoolClient = Parameters<NonNullable<PostgresLocatedReadCommittedRunnerOptionsV1["afterAcquire"]>>[0];

function isPoolClient(value: unknown): value is PoolClient {
  return typeof value === "object" && value !== null && "query" in value &&
    typeof value.query === "function" && "release" in value && typeof value.release === "function";
}

function installCommitResponseFault(client: PoolClient,
  fault: (forward: () => unknown) => unknown): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(client, "query");
  const query = client.query;
  const installed = Reflect.set(client, "query", (...args: ReadonlyArray<unknown>): unknown => {
    const statement = args[0];
    const text = typeof statement === "string" ? statement :
      typeof statement === "object" && statement !== null && "text" in statement &&
        typeof statement.text === "string" ? statement.text : "";
    const forward = () => Reflect.apply(query, client, args);
    return text.trim().toLowerCase() === "commit" ? fault(forward) : forward();
  });
  if (!installed) throw new Error("Could not install PostgreSQL COMMIT response fault");
  return () => {
    if (originalDescriptor === undefined) Reflect.deleteProperty(client, "query");
    else Object.defineProperty(client, "query", originalDescriptor);
  };
}

async function committedCountFromIndependentConnection(
  fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>, schemaName: string): Promise<number> {
  if (fixture.currency.resource.kind !== "postgres" || !/^[a-z_][a-z0-9_]*$/i.test(schemaName))
    throw new Error("Expected isolated PostgreSQL fixture schema");
  const scopeUuid = projectScopeIdUuidV1(fixture.activation.anchor.scopeId).scopeUuid;
  const result = await fixture.currency.resource.control.query<{ count: number }>(
    `select count(*)::int as count from "${schemaName}".fx_system_commit where scope_uuid = $1`, [scopeUuid]);
  return result.rows[0]?.count ?? 0;
}

async function installOneCommitResponseFault(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>,
  baselineCommits: number, fault: () => unknown): Promise<Readonly<{ restore: () => void; fired: () => boolean }>> {
  if (fixture.currency.resource.kind !== "postgres") throw new Error("Expected real PostgreSQL fixture");
  const schemaName = (await fixture.currency.resource.target.query<{ schema: string }>(
    "select current_schema() as schema")).rows[0]?.schema;
  if (schemaName === undefined) throw new Error("Missing PostgreSQL fixture schema");
  const pool = fixture.currency.resource.target.pool;
  const originalDescriptor = Object.getOwnPropertyDescriptor(pool, "connect");
  const connect = pool.connect;
  const restoreQueries: Array<() => void> = [];
  let armed = true;
  let didFire = false;
  const decorate = (candidate: unknown): void => {
    if (!isPoolClient(candidate)) return;
    restoreQueries.push(installCommitResponseFault(candidate, forward => {
      if (!armed) return forward();
      return Promise.resolve(forward()).then(async result => {
        const committed = await committedCountFromIndependentConnection(fixture, schemaName);
        if (committed === baselineCommits) return result;
        if (committed !== baselineCommits + 1)
          throw new Error(`Expected exactly one mixed commit, observed ${committed - baselineCommits}`);
        armed = false;
        didFire = true;
        await fault();
        return result;
      });
    }));
  };
  const installed = Reflect.set(pool, "connect", (...args: ReadonlyArray<unknown>): unknown => {
    const callback = args[0];
    if (args.length === 1 && typeof callback === "function")
      return Reflect.apply(connect, pool, [(...callbackArgs: ReadonlyArray<unknown>) => {
        decorate(callbackArgs[1]);
        return Reflect.apply(callback, undefined, callbackArgs);
      }]);
    if (args.length > 0) return Reflect.apply(connect, pool, args);
    const acquired: unknown = Reflect.apply(connect, pool, args);
    return Promise.resolve(acquired).then(candidate => {
      if (!isPoolClient(candidate)) throw new Error("PostgreSQL pool returned no client");
      decorate(candidate);
      return candidate;
    });
  });
  if (!installed) throw new Error("Could not install PostgreSQL connection fault");
  return Object.freeze({
    fired: () => didFire,
    restore: () => {
      for (const restore of restoreQueries.toReversed()) restore();
      if (originalDescriptor === undefined) Reflect.deleteProperty(pool, "connect");
      else Object.defineProperty(pool, "connect", originalDescriptor);
    },
  });
}

async function runMixedAttempt(fixture: Awaited<ReturnType<typeof createMixedMutationProductFixture>>) {
  const raw = await fixture.runWorkerd();
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
        and wait_event_type = 'Lock'
        and cardinality(pg_blocking_pids(pid)) > 0
        and query ilike '%fx_system_scope_clock%'
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
        await Promise.race([waitForBlockedScopeClock(fixture), standalone.then(() => {
          throw new Error("Standalone Product writer settled before the scope-clock wait");
        })]);
        expect(standaloneSettled).toBe(false);
        releaseClock();
        expect(Exit.isSuccess(await Effect.runPromise(Fiber.await(publishing)))).toBe(true);
        expect(await standalone).toMatchObject({ kind: "failed", error: { reason: "writeConflict" } });
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
      await expect(fixture.publish(returnedValue)).rejects.toMatchObject({
        _tag: "PointCommitConflictV1Error",
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
