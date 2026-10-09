import { inspectPayloadRuntimeForTest } from "../../../../payload-adapter/src/testing";
import { ValidationError } from "payload";
import { describe, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { payloadScalarContentIdentity } from "../../../../payload-adapter/src/testing/profiles";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { payloadScalarScenario } from "./payloadScalarScenario";
import { payloadSelectiveLookupScenario } from "./payloadSelectiveLookupScenario";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { fxSystemCommits } from "../../../src/database/schema";

describe.skipIf(postgresUrl === null)("pinned Payload scalar Local API (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves supported Local API behavior, delete refusal and native settlement", () => withPersistence(persistence =>
    payloadScalarScenario(persistence, makePostgresRelationalSession(persistence), async ({ conformance, host, hostInput, createBinding, inventory }) => {
      expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
      const sameKey = host.newRequestKey();
      const input = { collection: "posts", data: { title: "native-duplicate", publishedAt: "2026-01-01" } };
      const before = await persistence.drizzle.select().from(fxSystemCommits);
      const calls = conformance.observations.executions();
      const duplicated = await Promise.allSettled([runEffect(host.create(sameKey, input)), runEffect(host.create(sameKey, input))]);
      expect(duplicated.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(duplicated[0]).toEqual(duplicated[1]);
      expect(conformance.observations.executions()).toBe(calls + 1);
      expect(await persistence.drizzle.select().from(fxSystemCommits)).toHaveLength(before.length + 1);
      const race = { collection: "posts", data: { title: "native-unique", publishedAt: "2026-01-01" } };
      const closed = await runEffect(Deferred.make<void>());
      let closedCount = 0;
      const concurrent = await runEffect(makeCmsHost({ ...hostInput, commands: Object.values(inspectPayloadRuntimeForTest(conformance.runtime).commands),
        expectedContentIdentity: payloadScalarContentIdentity }, { afterDocumentClosure: () => Effect.gen(function* () {
          closedCount++;
          if (closedCount === 2) yield* Deferred.succeed(closed, undefined);
          yield* Deferred.await(closed).pipe(Effect.timeout(5_000));
        }).pipe(Effect.orDie) }));
      const raceKeys = [host.newRequestKey(), host.newRequestKey()];
      const raceCalls = conformance.observations.executions();
      const raceBefore = await persistence.drizzle.select().from(fxSystemCommits);
      const raced = await runEffect(Effect.all(raceKeys.map(key => concurrent.run(key, inspectPayloadRuntimeForTest(conformance.runtime).commands.create, race).pipe(Effect.result)),
        { concurrency: "unbounded" }).pipe(Effect.timeout(10_000)));
      expect(closedCount).toBe(2);
      expect(conformance.observations.executions()).toBe(raceCalls + 2);
      expect(raced.filter(Result.isSuccess)).toHaveLength(1);
      expect(raced.filter(Result.isFailure)).toHaveLength(1);
      for (const result of raced) if (Result.isFailure(result)) expect(result.failure).toMatchObject({ reason: "writeConflict" });
      expect(await persistence.drizzle.select().from(fxSystemCommits)).toHaveLength(raceBefore.length + 1);
      const lostKey = raceKeys[raced.findIndex(Result.isFailure)];
      if (lostKey === undefined) throw new Error("Missing losing request key");
      const raceStable = await inventory();
      const duplicate = await runEffectFailure(concurrent.run(lostKey, inspectPayloadRuntimeForTest(conformance.runtime).commands.create, race));
      expect(duplicate).toMatchObject({ reason: "documentInvalid" });
      expect(duplicate.cause).toBeInstanceOf(ValidationError);
      expect(await inventory()).toEqual(raceStable);
      let failedPid = 0;
      const pids: number[] = [];
      const recovering = await runEffect(conformance.runtime.bind(await createBinding(makePostgresRelationalSession(persistence, { lifecycleFault: event => {
        const pid: unknown = Reflect.get(event.client, "processID");
        if (typeof pid !== "number") throw new Error("Expected backend PID");
        if (event.phase === "begin" && event.edge === "after") pids.push(pid);
        if (event.phase === "commit" && event.edge === "after" && failedPid === 0) { failedPid = pid; throw new Error("Lost Payload COMMIT acknowledgement"); }
      } }))));
      const recoverCalls = conformance.observations.executions();
      const recoverKey = recovering.newRequestKey();
      const recoverInput = { collection: "posts", data: { title: "native-recovery", publishedAt: "2026-01-01" } };
      const recovered = await runEffect(recovering.create(recoverKey, recoverInput));
      expect(recovered).toMatchObject({ title: "native-recovery" });
      expect(conformance.observations.executions()).toBe(recoverCalls + 1);
      expect(pids.length).toBeGreaterThanOrEqual(2);
      expect(pids[1]).not.toBe(failedPid);
      expect(await runEffect(recovering.create(recoverKey, recoverInput))).toEqual(recovered);
      expect(conformance.observations.executions()).toBe(recoverCalls + 1);
      const stable = await inventory();
      const pendingBefore = conformance.observations.pendingReads();
      const fiber = Effect.runFork(host.create(host.newRequestKey(), { collection: "posts", data: { title: "id-unresolved", publishedAt: "2026-01-01" } }));
      try {
        const deadline = performance.now() + 5000;
        while (conformance.observations.pendingReads() === pendingBefore && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        expect(conformance.observations.pendingReads()).toBe(pendingBefore + 1);
        await runEffect(Fiber.interrupt(fiber));
        expect(Exit.isFailure(await runEffect(Fiber.await(fiber)))).toBe(true);
      } finally { await runEffect(Fiber.interrupt(fiber)); }
      expect(await inventory()).toEqual(stable);
      await payloadSelectiveLookupScenario({ conformance, host, hostInput, createBinding, inventory });
    })), 180_000);
});
