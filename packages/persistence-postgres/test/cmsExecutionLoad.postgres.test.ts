import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { readCe0Environment } from "./ce0Environment";
import { cmsExecutionLoadScenario } from "./cmsExecutionLoadScenario";

describe.skipIf(postgresUrl === null)("CE0 concurrent CMS core load", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it(
    "accounts for every settlement above the connection-pool size",
    () =>
      withPersistence(async (persistence) => {
        await cmsExecutionLoadScenario(
          persistence,
          makePostgresRelationalSession(persistence),
          { scopes: 1, concurrency: 12, requests: 24, samples: 1 },
        );
      }),
    120_000,
  );
  it(
    "measures bounded complete-request bursts over hot and independent scopes",
    () =>
      withPersistence(async (persistence) => {
        const environment = await readCe0Environment(persistence, [
          "./cmsExecutionLoad.postgres.test.ts",
          "./cmsExecutionLoadScenario.ts",
          "./cmsExecutionMeasurementFixture.ts",
          "./cmsHostFixture.ts",
        ]);
        expect(environment.poolMax).toBe(10);
        const workloads = [];
        for (const concurrency of [1, 4, 12] as const) {
          for (const scopes of [1, 4] as const) {
            workloads.push(
              await cmsExecutionLoadScenario(
                persistence,
                makePostgresRelationalSession(persistence),
                { scopes, concurrency, requests: 24, samples: 3 },
              ),
            );
          }
        }
      const report = {
        environment,
        placement: "fixture control metadata and scoped application data share this database and ten-connection pool",
          workload:
            "eight-row active private CMS inserts through host.run and physical COMMIT; two maintained indexes and one unique constraint",
          arrival:
            "finite burst: all 24 requests offered together; bounded request slots; no automatic retry; three measured bursts per configuration",
          target:
            "zero refusals is recorded per burst, not assumed; only verified SQLSTATE 55P03 lock refusals are accepted by correctness checks; explicit confirmed-rollback retries are untimed and excluded from throughput",
          timing:
            "queue before request slot + host execution = response; fixture setup, keys, assertions, readback and replay excluded",
          observation:
            "all PostgreSQL samples instrumented; aggregate SQL/transport, pool occupancy sampled every 5ms and request boundaries; peaks and wait duration are not exact",
          limitations:
            "short local Node bursts on growing small catalogs, not sustained capacity, neutral timing, Payload Local API, native mixed traffic, hosted execution or an independent reference",
          workloads,
        };
        if (process.env.FLAREX_CE0_CMS_LOAD_REPORT_PATH !== undefined)
          await writeFile(
            process.env.FLAREX_CE0_CMS_LOAD_REPORT_PATH,
            JSON.stringify(report, null, 2) + "\n",
          );
        console.info("CE0 concurrent CMS core load", JSON.stringify(report));
        expect(persistence.pool.waitingCount).toBe(0);
        expect(persistence.pool.totalCount).toBe(persistence.pool.idleCount);
      }),
    360_000,
  );
});
