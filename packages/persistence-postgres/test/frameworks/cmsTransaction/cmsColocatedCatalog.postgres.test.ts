import { Effect, Schema } from "effect";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { runEffect } from "../../support/effectTestRuntime";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";

const decodeDocuments = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ _id: Schema.String })),
);

describe.skipIf(postgresUrl === null)("colocated CMS admission catalog", () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it(
    "settles cold and warm requests, readback and replay with one available connection",
    () =>
      withPersistence(async (persistence) => {
        const tested = await cmsExecutionMeasurementFixture(
          persistence,
          makePostgresRelationalSession(persistence),
        );
        expect(persistence.pool.options.max).toBe(10);
        const reserved: PoolClient[] = [];
        try {
          // Reserve nine idle clients without transactions. A request must progress
          // using the remaining client, including all of its catalog acceptance.
          for (let index = 0; index < 9; index++)
            reserved.push(await persistence.pool.connect());
          for (const prefix of ["cold-catalog", "warm-catalog"]) {
            const before = await tested.inventory();
            const key = tested.host.newRequestKey();
            const args = { count: 8, prefix };
            const value = await runEffect(
              tested.host
                .run(key, tested.insert, args)
                .pipe(Effect.timeout("25 seconds")),
            );
            const after = await tested.verifyInsert(before, value, 8, prefix);
            const executions = tested.executionCount();
            const ids = decodeDocuments(value).map((row) => row._id);
            expect(
              await runEffect(
                tested.host
                  .read(tested.read, ids)
                  .pipe(Effect.timeout("25 seconds")),
              ),
            ).toEqual(value);
            expect(
              await runEffect(
                tested.host
                  .run(key, tested.insert, args)
                  .pipe(Effect.timeout("25 seconds")),
              ),
            ).toEqual(value);
            expect(tested.executionCount()).toBe(executions);
            expect(await tested.inventory()).toEqual(after);
            expect(persistence.pool.waitingCount).toBe(0);
            expect(
              persistence.pool.totalCount - persistence.pool.idleCount,
            ).toBe(reserved.length);
          }
        } finally {
          for (const client of reserved) client.release();
        }
        expect(persistence.pool.waitingCount).toBe(0);
        expect(persistence.pool.totalCount).toBe(persistence.pool.idleCount);
      }),
    120_000,
  );
});
