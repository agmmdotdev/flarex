import { describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { eq, sql } from "drizzle-orm";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../src/schema";
import type { PoolClient } from "pg";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost, defineCmsCommand } from "../src/cmsTransaction/host";
import { cmsError } from "../src/cmsTransaction/model";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { runEffect } from "./effectTestRuntime";
import { cmsHostScenario } from "./cmsHostScenario";

describe.skipIf(postgresUrl === null)("private scalar CMS host (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("runs the shared document and publication contract", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    const tested = await cmsHostScenario(persistence, makePostgresRelationalSession(persistence));
    let failedPid = 0;
    const acquiredPids: number[] = [];
    const ambiguous = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
      const pid: unknown = Reflect.get(event.client, "processID");
      if (typeof pid !== "number") throw new Error("Expected backend PID");
      if (event.phase === "begin" && event.edge === "after") acquiredPids.push(pid);
      if (event.phase === "commit" && event.edge === "after" && failedPid === 0) {
        failedPid = pid;
        throw new Error("Lost COMMIT acknowledgement");
      }
    } });
    const recovering = await runEffect(makeCmsHost({ ...tested.input, session: ambiguous }));
    const beforeCallbacks = tested.callbackCount();
    const recoveredKey = recovering.newRequestKey();
    const recovered = await runEffect(recovering.run(recoveredKey, tested.create, { title: "recovered" }));
    expect(recovered).toMatchObject({ title: "updated" });
    expect(tested.callbackCount()).toBe(beforeCallbacks + 1);
    expect(acquiredPids.length).toBeGreaterThanOrEqual(2);
    expect(acquiredPids[1]).not.toBe(failedPid);
    expect(await runEffect(recovering.run(recoveredKey, tested.create, { title: "recovered" }))).toEqual(recovered);
    expect(tested.callbackCount()).toBe(beforeCallbacks + 1);

    const duplicateKey = tested.host.newRequestKey();
    const beforeDuplicate = await tested.inventory();
    const duplicate = await Promise.all([runEffect(tested.host.run(duplicateKey, tested.netZero, null)), runEffect(tested.host.run(duplicateKey, tested.netZero, null))]);
    expect(duplicate).toEqual([null, null]);
    expect((await tested.inventory()).commits).toHaveLength(beforeDuplicate.commits.length + 1);

    let activePid = 0;
    const controlled = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
      if (event.phase === "begin" && event.edge === "after") {
        const pid: unknown = Reflect.get(event.client, "processID");
        if (typeof pid !== "number") throw new Error("Expected backend PID");
        activePid = pid;
      }
    } });
    const waitForQuery = async (pid: number, fragment: string, blocked = false) => {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline) {
        const found = await persistence.query<{ matched: boolean }>(
          "select exists(select 1 from pg_stat_activity where pid=$1 and state='active' and position($2 in query)>0 and (not $3::boolean or cardinality(pg_blocking_pids(pid))>0)) as matched", [pid, fragment, blocked]);
        if (found.rows[0]?.matched) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Backend ${pid} did not reach ${fragment}`);
    };
    const sleeping = await runEffect(makeCmsHost({ ...tested.input, session: controlled }, {
      afterAdmission: tx => runDrizzleStatementEffect(tx.execute(sql`select pg_sleep(30)`), cause => cmsError("statementFailure", cause)).pipe(Effect.asVoid),
    }));
    const stable = await tested.inventory();
    const fiber = Effect.runFork(sleeping.run(sleeping.newRequestKey(), tested.netZero, null));
    try {
      const startDeadline = performance.now() + 5000;
      while (activePid === 0 && performance.now() < startDeadline) await new Promise(resolve => setTimeout(resolve, 10));
      expect(activePid).toBeGreaterThan(0);
      await waitForQuery(activePid, "pg_sleep");
      await runEffect(Fiber.interrupt(fiber));
      const interrupted = await runEffect(Fiber.await(fiber));
      expect(Exit.isFailure(interrupted)).toBe(true);
    } finally {
      await runEffect(Fiber.interrupt(fiber));
    }
    expect(await tested.inventory()).toEqual(stable);
    expect((await persistence.query<{ active: boolean }>("select exists(select 1 from pg_stat_activity where pid=$1 and state='active' and position($2 in query)>0) as active", [activePid, "pg_sleep"]))
      .rows[0]?.active).toBe(false);

    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const heldCommand = defineCmsCommand({ name: "held", mode: "write", run: () => Deferred.succeed(entered, undefined)
      .pipe(Effect.andThen(Deferred.await(release)), Effect.as(null)) });
    const holding = await runEffect(makeCmsHost({ ...tested.input, session: controlled, commands: [...tested.input.commands, heldCommand] }));
    const held = Effect.runFork(holding.run(holding.newRequestKey(), heldCommand, null));
    let other: PoolClient | undefined;
    let buildClient: PoolClient | undefined;
    let buildDrain: Promise<unknown> | undefined;
    let activationFiber: ReturnType<typeof Effect.runFork<unknown, unknown>> | undefined;
    const separateScope = ScopeIdSchema.make(`scope_${crypto.randomUUID()}`);
    let blockedDrain: Promise<unknown> | undefined;
    try {
      await runEffect(Deferred.await(entered));
      other = await persistence.pool.connect();
      const pid = (await other.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
      if (pid === undefined) throw new Error("Expected competing PID");
      const blocked = other.query("select scope_id from fx_system_scope_clock where scope_id=$1 for update", [tested.fixture.authority.scopeId]);
      blockedDrain = blocked.catch(() => undefined);
      await waitForQuery(pid, "fx_system_scope_clock", true);
      buildClient = await persistence.pool.connect();
      const buildPid = (await buildClient.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]?.pid;
      if (buildPid === undefined) throw new Error("Expected build contender PID");
      const buildBlocked = buildClient.query("select index_definition_id from fx_system_index_build_state where scope_id=$1 for update", [tested.fixture.authority.scopeId]);
      buildDrain = buildBlocked.catch(() => undefined);
      await waitForQuery(buildPid, "fx_system_index_build_state", true);
      activationFiber = Effect.runFork(tested.bindings.activate({ ...tested.activationRequest, requestId: "competing-activation" }).pipe(Effect.exit));
      const activationDeadline = performance.now() + 5000;
      let activationBlocked = false;
      while (performance.now() < activationDeadline) {
        const found = await persistence.query<{ blocked: boolean }>(
          "select exists(select 1 from pg_stat_activity where pid<>$1 and pid<>$2 and ($3=any(pg_blocking_pids(pid)) or $1=any(pg_blocking_pids(pid))) and position('fx_system_scope_clock' in query)>0) as blocked", [pid, buildPid, activePid]);
        if (found.rows[0]?.blocked) { activationBlocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      const waiters = await persistence.query<{ pid: number; query: string; blockers: number[] }>(
        "select pid, query, pg_blocking_pids(pid) as blockers from pg_stat_activity where datname=current_database() and state='active' and cardinality(pg_blocking_pids(pid))>0");
      expect(activationBlocked, JSON.stringify({ heldPid: activePid, waiters: waiters.rows })).toBe(true);
      // A distinct scope progresses while the CMS scope and build locks are held.
      await persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: separateScope,
        storageGeneration: tested.fixture.authority.storageGeneration, storageGenerationFence: tested.fixture.authority.storageGenerationFence,
        epoch: tested.fixture.authority.epoch });
      const progressed = await persistence.query<{ scope_id: string }>("select scope_id from fx_system_scope_clock where scope_id=$1 for update nowait", [separateScope]);
      expect(progressed.rows[0]?.scope_id).toBe(separateScope);
      await runEffect(Deferred.succeed(release, undefined));
      await runEffect(Fiber.join(held));
      await blocked;
      await buildBlocked;
      expect(await runEffect(Fiber.join(activationFiber))).toMatchObject({ _tag: "Failure" });
    } finally {
      await runEffect(Deferred.succeed(release, undefined));
      await runEffect(Fiber.interrupt(held));
      if (activationFiber !== undefined) await runEffect(Fiber.interrupt(activationFiber));
      await blockedDrain;
      await buildDrain;
      other?.release();
      buildClient?.release();
      await persistence.drizzle.delete(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, separateScope));
    }

    let cleanupFault = true;
    const cleanup = makePostgresRelationalSession(persistence, { lifecycleFault: event => {
      if (cleanupFault && event.phase === "rollback" && event.edge === "before") { cleanupFault = false; throw new Error("Rollback transport failure"); }
    } });
    const primary = cmsError("documentInvalid");
    const failingCommand = defineCmsCommand({ name: "fails", mode: "write", run: () => Effect.fail(primary) });
    const failing = await runEffect(makeCmsHost({ ...tested.input, session: cleanup, commands: [...tested.input.commands, failingCommand] }));
    const beforeFailure = await tested.inventory();
    const failed = await runEffect(Effect.exit(failing.run(failing.newRequestKey(), failingCommand, null)));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) {
      const errors = failed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(errors).toContain(primary);
      expect(errors).toContainEqual(expect.objectContaining({ reason: "resourceFailure" }));
    }
    expect(await tested.inventory()).toEqual(beforeFailure);
  }), 180_000);
});
