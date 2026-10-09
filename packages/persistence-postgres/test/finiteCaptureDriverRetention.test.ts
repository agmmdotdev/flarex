import { Effect, Exit } from "effect";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../src/postgres";
import * as physicalOwner from "../src/physicalSession/postgres";
import { makePhysicalDeadlineOperations } from "../src/physicalSession/deadline";
import { physicalSessionErrors } from "../src/physicalSession/errors";
import { PhysicalSessionObservation } from "../src/physicalSession/observation";
import { flarexSchema } from "../src/schema";
import { runEffect } from "./effectTestRuntime";

it("retains genuine pool mechanics by exact diagnostic resolver while each target and acquisition stays fresh", async () => {
  const pool = new Pool();
  const otherPool = new Pool();
  const database = drizzle.mock({ schema: flarexSchema });
  const drivers: physicalOwner.PostgresPhysicalSessionDriver<unknown>[] = [];
  const original = physicalOwner.makePostgresPhysicalSessionDriver;
  const create = vi.spyOn(physicalOwner, "makePostgresPhysicalSessionDriver").mockImplementation((...args) => {
    const driver = original(...args);
    drivers.push(driver);
    return driver;
  });
  const observationA = new PhysicalSessionObservation({ record: () => undefined });
  const observationB = new PhysicalSessionObservation({ record: () => undefined });
  const resolverA = () => observationA;
  const resolverB = () => observationB;
  const target = (actualPool: Pool, resolver?: () => PhysicalSessionObservation | undefined, schemaName = "capture_driver") =>
    createPostgresLocatedPointMutationSessionActivationTargetV1({ drizzle: database, pool: actualPool }, {
      kind: "shared_database", databaseKey: "capture-driver-pool", schemaName,
    }, resolver === undefined ? {} : { physicalSessionObservation: resolver });
  try {
    const first = target(pool);
    const second = target(pool, undefined, "another_capture_driver");
    expect(second).not.toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
    const quiet = drivers[0];
    if (quiet === undefined) throw new Error("Missing actual retained quiet driver");
    target(pool, resolverA);
    target(pool, resolverA);
    target(pool, resolverB);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[1]?.[2]?.observation).toBe(resolverA);
    expect(create.mock.calls[2]?.[2]?.observation).toBe(resolverB);
    expect(create.mock.results[1]?.value).not.toBe(create.mock.results[2]?.value);
    target(otherPool);
    expect(create).toHaveBeenCalledTimes(4);
    await pool.end();
    target(pool);
    expect(create).toHaveBeenCalledTimes(4);
    // The retained object does not cache a healthy acquisition or revive a
    // closed pool. Its real node-postgres owner refuses before business work.
    let callbacks = 0;
    const deadlines = makePhysicalDeadlineOperations(physicalSessionErrors);
    const closed = await runEffect(Effect.exit(Effect.gen(function* () {
      const deadline = yield* deadlines.start("read", 1000);
      return yield* quiet.runReadEffect({ deadline }, () => Effect.sync(() => { callbacks++; }));
    })));
    expect(Exit.isFailure(closed)).toBe(true);
    expect(callbacks).toBe(0);
  } finally {
    create.mockRestore();
    if (!pool.ended) await pool.end();
    await otherPool.end();
  }
});
