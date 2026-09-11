import { ValidationError } from "payload";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Fiber } from "effect";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { payloadScalarScenario } from "./payloadScalarScenario";
import { runEffect } from "./effectTestRuntime";
import { fxSystemCommits } from "../src/schema";

describe.skipIf(postgresUrl === null)("pinned Payload scalar Local API (PostgreSQL)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves supported Local API behavior, delete refusal and native settlement", () => withPersistence(persistence =>
    payloadScalarScenario(persistence, makePostgresRelationalSession(persistence), async ({ conformance, host, hostInput, inventory }) => {
      expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
      const sameKey = host.newRequestKey();
      const input = { data: { title: "native-duplicate", publishedAt: "2026-01-01" } };
      const before = await persistence.drizzle.select().from(fxSystemCommits);
      const calls = conformance.observations.executions();
      const duplicated = await Promise.allSettled([runEffect(host.run(sameKey, conformance.runtime.commands.create, input)), runEffect(host.run(sameKey, conformance.runtime.commands.create, input))]);
      expect(duplicated.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
      expect(duplicated[0]).toEqual(duplicated[1]);
      expect(conformance.observations.executions()).toBe(calls + 1);
      expect(await persistence.drizzle.select().from(fxSystemCommits)).toHaveLength(before.length + 1);
      const race = { data: { title: "native-unique", publishedAt: "2026-01-01" } };
      const raced = await Promise.allSettled([runEffect(host.run(host.newRequestKey(), conformance.runtime.commands.create, race)), runEffect(host.run(host.newRequestKey(), conformance.runtime.commands.create, race))]);
      expect(raced.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(raced.filter(result => result.status === "rejected")).toHaveLength(1);
      for (const result of raced) if (result.status === "rejected") expect(result.reason.cause).toBeInstanceOf(ValidationError);
      let failedPid = 0;
      const pids: number[] = [];
      const recovering = await runEffect(conformance.runtime.bind({ ...hostInput, session: makePostgresRelationalSession(persistence, { lifecycleFault: event => {
        const pid: unknown = Reflect.get(event.client, "processID");
        if (typeof pid !== "number") throw new Error("Expected backend PID");
        if (event.phase === "begin" && event.edge === "after") pids.push(pid);
        if (event.phase === "commit" && event.edge === "after" && failedPid === 0) { failedPid = pid; throw new Error("Lost Payload COMMIT acknowledgement"); }
      } }) }));
      const recoverCalls = conformance.observations.executions();
      const recoverKey = recovering.newRequestKey();
      const recoverInput = { data: { title: "native-recovery", publishedAt: "2026-01-01" } };
      const recovered = await runEffect(recovering.run(recoverKey, conformance.runtime.commands.create, recoverInput));
      expect(recovered).toMatchObject({ title: "native-recovery" });
      expect(conformance.observations.executions()).toBe(recoverCalls + 1);
      expect(pids.length).toBeGreaterThanOrEqual(2);
      expect(pids[1]).not.toBe(failedPid);
      expect(await runEffect(recovering.run(recoverKey, conformance.runtime.commands.create, recoverInput))).toEqual(recovered);
      expect(conformance.observations.executions()).toBe(recoverCalls + 1);
      const stable = await inventory();
      const pendingBefore = conformance.observations.pendingReads();
      const fiber = Effect.runFork(host.run(host.newRequestKey(), conformance.runtime.commands.create, { data: { title: "id-unresolved", publishedAt: "2026-01-01" } }));
      try {
        const deadline = performance.now() + 5000;
        while (conformance.observations.pendingReads() === pendingBefore && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        expect(conformance.observations.pendingReads()).toBe(pendingBefore + 1);
        await runEffect(Fiber.interrupt(fiber));
        expect(Exit.isFailure(await runEffect(Fiber.await(fiber)))).toBe(true);
      } finally { await runEffect(Fiber.interrupt(fiber)); }
      expect(await inventory()).toEqual(stable);
    })), 180_000);
});
