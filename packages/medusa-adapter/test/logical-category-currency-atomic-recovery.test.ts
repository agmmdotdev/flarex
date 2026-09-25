import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import { defineAtomicCommerceCommand, getAtomicCommerceCommand, type AtomicCommerceContext } from
  "../../persistence-postgres/src/atomicCommerce/commands";
import { makeAtomicCommerceHost, type AtomicCommerceHostInput } from
  "../../persistence-postgres/src/atomicCommerce/host";
import { expireCommerceResult } from "../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";
import { issueRelationalSession, makePostgresRelationalSession, runRelationalSession } from
  "../../persistence-postgres/src/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/relationalTransaction/model";
import { postgresFailureCode } from "../../persistence-postgres/test/postgresFailureCode";
import { prepareNativeApplicationJournalOnLogicalScope } from
  "../../persistence-postgres/test/nativeApplicationJournalOnLogicalScope";
import { logicalCategoryCurrencyFixture, logicalCategoryCurrencyInventory } from "./support/logical-category-currency-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? process.env.MEDUSA_COMPARISON_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Medusa comparison driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCategoryCurrencyFixture>>;
const args = (prefix: string) => ({ categoryPrefix: prefix, currency: {
  code: "zzz", name: prefix, symbol: "T", symbol_native: "T", decimal_digits: 2, rounding: 0,
} });
const inventory = () => logicalCategoryCurrencyInventory(fixture);
const selected = async (input: AtomicCommerceHostInput<unknown>) => {
  const host = await runEffect(makeAtomicCommerceHost(input));
  cleanup.push(() => runEffect(host.close));
  return host;
};
const business = (context: AtomicCommerceContext, value: Json) => {
  const definition = getAtomicCommerceCommand(fixture.proof.command);
  if (definition === undefined) throw new Error("Missing Category/Currency command");
  return definition.run(context, value);
};
const isInjectedPublicationFailure = (cause: unknown) => {
  const visited = new Set<object>();
  let current = cause;
  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const code: unknown = Reflect.get(current, "code");
    const message: unknown = Reflect.get(current, "message");
    if (code === "P0001" && typeof message === "string" &&
      message.includes("mixed atomic publication failure")) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
};

describe("logical Category/Currency atomic recovery and publication", () => {
  beforeAll(async () => { fixture = await logicalCategoryCurrencyFixture(driver, close => cleanup.push(close),
    { includeUserNameIndex: true }); }, 150_000);
  afterAll(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) await close().catch(cause => { failures.push(cause); });
    if (failures.length > 0) throw new AggregateError(failures, "Mixed atomic recovery cleanup failed");
  }, 120_000);

  it("reconciles a lost commit acknowledgement without repeating either member", async () => {
    const { currency, input } = fixture;
    let executions = 0;
    const command = defineAtomicCommerceCommand("mixedRetained", Effect.fn("MixedAtomic.retained")(function* (context, value) {
      executions++;
      return yield* business(context, value);
    }));
    let lose = true;
    const session = issueRelationalSession(currency.persistence.drizzle, (profile, work) =>
      runRelationalSession(currency.session, profile, work).pipe(
        Effect.catchTag("RelationalTransactionError", cause =>
          Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
        Effect.flatMap(value => {
          if (!lose) return Effect.succeed(value);
          lose = false;
          return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain",
            cause: new Error("Lost mixed COMMIT acknowledgement") }));
        })));
    const host = await selected({ ...input, session, commands: [command] });
    const key = host.newRequestKey();
    const before = await inventory();
    const value = await runEffect(host.run(key, command, args("recover")));
    expect(executions).toBe(1);
    const committed = await inventory();
    expect(committed.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(committed.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
    expect(committed.categories).toHaveLength(before.categories.length + 2);
    expect(await runEffect(host.run(key, command, args("recover")))).toEqual(value);
    expect(executions).toBe(1);
    expect(await runEffectFailure(host.run(key, command, args("different"))))
      .toMatchObject({ reason: "requestConflict" });
    expect(await inventory()).toEqual(committed);
    await expireCommerceResult(currency, key);
    expect(await runEffectFailure(host.run(key, command, args("recover"))))
      .toMatchObject({ reason: "resultUnavailable" });
    expect(executions).toBe(1);
  }, 120_000);

  it("rolls back logical Currency and Product at every publication stage", async () => {
    const { currency, host, proof } = fixture;
    const before = await inventory();
    for (const table of ["fx_system_commit",
      "fx_system_commit_app_row_change", "fx_system_idempotency", "fx_system_commit_wake", "fx_system_scope_clock"]) {
      await currency.persistence.exec("create function fx_test_mixed_atomic_failure() returns trigger language plpgsql as $$ begin raise exception 'mixed atomic publication failure'; end $$");
      try {
        await currency.persistence.exec(`create trigger fx_test_mixed_atomic_failure before ${table === "fx_system_scope_clock" ? "update" : "insert"} on "${table}" for each row execute function fx_test_mixed_atomic_failure()`);
        const failure = await runEffectFailure(host.run(host.newRequestKey(), proof.command, args("publication")));
        expect(isInjectedPublicationFailure(failure)).toBe(true);
        expect(await inventory()).toEqual(before);
      } finally {
        await currency.persistence.exec(`drop trigger if exists fx_test_mixed_atomic_failure on "${table}"`);
        await currency.persistence.exec("drop function fx_test_mixed_atomic_failure()");
      }
    }
  }, 120_000);

  it.runIf(driver === "postgres")("reconciles a real PostgreSQL COMMIT on a new connection", async () => {
    const { currency, input } = fixture;
    const postgres = currency.persistence;
    if (!("pool" in postgres)) throw new Error("Expected real PostgreSQL fixture");
    let failedPid = 0;
    let executions = 0;
    const pids: number[] = [];
    const command = defineAtomicCommerceCommand("mixedNewConnectionRecovery", Effect.fn("MixedAtomic.newConnectionRecovery")(function* (ctx, value) {
      executions++;
      return yield* business(ctx, value);
    }));
    const host = await selected({ ...input, commands: [command],
      session: makePostgresRelationalSession(postgres, { lifecycleFault: event => {
        const pid: unknown = Reflect.get(event.client, "processID");
        if (typeof pid !== "number") throw new Error("Missing backend PID");
        if (event.phase === "begin" && event.edge === "after") pids.push(pid);
        if (event.phase === "commit" && event.edge === "after" && failedPid === 0) {
          failedPid = pid;
          throw new Error("Lost mixed COMMIT acknowledgement");
        }
      } }),
    });
    const before = await inventory();
    const key = host.newRequestKey();
    const value = await runEffect(host.run(key, command, args("logical")));
    expect(executions).toBe(1);
    expect(pids.length).toBeGreaterThanOrEqual(2);
    expect(pids[1]).not.toBe(failedPid);
    expect(await runEffect(host.run(key, command, args("logical")))).toEqual(value);
    expect(executions).toBe(1);
    const after = await inventory();
    expect(after.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(after.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
    expect(after.categories).toHaveLength(before.categories.length + 2);
  }, 120_000);

  it.runIf(driver === "postgres")("shares one outcome and refuses bounded scope-lock contention", async () => {
    const { currency } = fixture;
    const postgres = currency.persistence;
    if (!("pool" in postgres)) throw new Error("Expected real PostgreSQL fixture");
    let executions = 0;
    const command = defineAtomicCommerceCommand("mixedConcurrentReplay", Effect.fn("MixedAtomic.concurrentReplay")(function* (ctx, value) {
      executions++;
      return yield* business(ctx, value);
    }));
    const host = await selected({ ...fixture.input, commands: [command] });
    const key = host.newRequestKey();
    const before = await inventory();
    const results = await runEffect(Effect.all([
      host.run(key, command, args("concurrent")), host.run(key, command, args("concurrent")),
    ], { concurrency: 2 }));
    expect(results[0]).toEqual(results[1]);
    expect(executions).toBe(1);
    const stable = await inventory();
    expect(stable.logical.commits).toHaveLength(before.logical.commits.length + 1);
    expect(stable.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
    const blocker = await postgres.pool.connect();
    try {
      const session = issueRelationalSession(postgres.drizzle, (profile, work) => Effect.gen(function* () {
        yield* Effect.promise(() => blocker.query("begin"));
        yield* Effect.promise(() => blocker.query("select 1 from fx_system_scope_clock for update"));
        return yield* runRelationalSession(currency.session, profile, work).pipe(
          Effect.catchTag("RelationalTransactionError", cause =>
            Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))));
      }));
      const contended = await selected({ ...fixture.input, session, commands: [command] });
      const start = performance.now();
      const failure = await runEffectFailure(contended.run(contended.newRequestKey(), command, args("contended")));
      expect(postgresFailureCode(failure)).toBe("55P03");
      expect(executions).toBe(1);
      process.stdout.write(JSON.stringify({ driver, scopeLockRefusalMs: Math.round(performance.now() - start) }) + "\n");
    } finally {
      try { await blocker.query("rollback"); }
      catch (cause) { blocker.release(true); throw cause; }
      blocker.release();
    }
    expect(await inventory()).toEqual(stable);
  }, 120_000);

  it("publishes a native Application journal after the mixed Commerce commit", async () => {
    const { currency, host, proof } = fixture;
    const native = await runEffect(prepareNativeApplicationJournalOnLogicalScope(currency.application));
    const before = await inventory();
    await runEffect(host.run(host.newRequestKey(), proof.command, args("native")));
    expect(await runEffect(native.publish)).toMatchObject({ kind: "published" });
    await runEffect(native.verifyScrubbed);
    const after = await inventory();
    const commits = after.logical.commits.slice(before.logical.commits.length);
    expect(commits).toHaveLength(2);
    const first = commits[0]; const second = commits[1];
    if (first === undefined || second === undefined) throw new Error("Missing mixed/native commit pair");
    expect(second.commitSeq).toBe(first.commitSeq + 1n);
    expect(first.relationalChangeCount).toBe(0);
    expect(second.relationalChangeCount).toBe(0);
    expect(after.logical.rowChanges).toHaveLength(before.logical.rowChanges.length + 3);
    expect(after.categories).toHaveLength(before.categories.length + 2);
  }, 120_000);
});
