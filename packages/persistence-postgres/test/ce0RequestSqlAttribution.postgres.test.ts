import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import { readCe0Environment } from "./ce0Environment";
import { runEffect } from "./effectTestRuntime";

type Observation = Awaited<
  ReturnType<typeof withPostgresExecutionObservation>
>["observation"];

describe.skipIf(postgresUrl === null)(
  "CE0 complete request SQL attribution",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it("attributes real request statements while preserving rows, publication and replay", async () => {
      const workloads: {
        count: number;
        candidate: "core" | "reference";
        operation: "emptyRead" | "mutation" | "replay";
        observation: Observation;
      }[] = [];
      const constructions: { count: number; candidate: string; observation: Observation }[] = [];
      const environments: Awaited<ReturnType<typeof readCe0Environment>>[] = [];
      for (const count of [0, 1, 8, 32]) {
        await withPersistence(async (persistence) => {
          environments.push(
            await readCe0Environment(persistence, [
              "./ce0RequestSqlAttribution.postgres.test.ts",
              "./cmsExecutionMeasurementFixture.ts",
              "./ce0CmsMutationReference.ts",
              "./ce0CmsReadReference.ts",
              "./ce0FirstInsertMaterialization.ts",
              "./ce0PublicationReference.ts",
            ]),
          );
          const record = (
            candidate: "core" | "reference",
            operation: "emptyRead" | "mutation" | "replay",
            observation: Observation,
          ) => {
            expect(observation.statementShapes).not.toBeNull();
            expect(
              observation.statementShapes
                ?.flatMap((shape) => shape.ordinals)
                .toSorted((a, b) => a - b),
            ).toEqual(
              Array.from(
                { length: observation.queryCalls },
                (_, ordinal) => ordinal,
              ),
            );
            expect(observation.commands.begin).toBe(
              observation.commands.commit,
            );
            expect(observation.commands.rollback ?? 0).toBe(0);
            workloads.push({ count, candidate, operation, observation });
            expect(persistence.pool.waitingCount).toBe(0);
            expect(persistence.pool.idleCount).toBe(
              persistence.pool.totalCount,
            );
          };
          for (const candidate of ["core", "reference"] as const) {
            const fixture = await cmsExecutionMeasurementFixture(
              persistence,
              makePostgresRelationalSession(persistence),
            );
            const constructed = await withPostgresExecutionObservation(
              persistence.pool, () => runEffect(makeCmsHost(fixture.input)),
              { attributeStatements: true },
            );
            const mutationConstruction = await withPostgresExecutionObservation(
              persistence.pool, () => runEffect(makeCe0CmsMutationReference(fixture.input)),
              { attributeStatements: true },
            );
            const readConstruction = await withPostgresExecutionObservation(
              persistence.pool, () => runEffect(makeCe0CmsReadReference(fixture.input)),
              { attributeStatements: true },
            );
            const host = constructed.value;
            const mutation = mutationConstruction.value;
            const read = readConstruction.value;
            if (candidate === "core") constructions.push({ count, candidate, observation: constructed.observation });
            else constructions.push(
              { count, candidate: "mutation-reference", observation: mutationConstruction.observation },
              { count, candidate: "read-reference", observation: readConstruction.observation },
            );
            const before = await fixture.inventory();
            if (count === 0) {
              const observedRead = await withPostgresExecutionObservation(
                persistence.pool,
                () =>
                  runEffect(
                    candidate === "core"
                      ? host.read(fixture.read, [])
                      : read.read([]),
                  ),
                { attributeStatements: true },
              );
              expect(observedRead.value).toEqual([]);
              expect(await fixture.inventory()).toEqual(before);
              record(candidate, "emptyRead", observedRead.observation);
            }
            const key = fixture.host.newRequestKey();
            const args = { count, prefix: "attribution" };
            const execute = () =>
              runEffect(
                candidate === "core"
                  ? host.run(key, fixture.insert, args)
                  : mutation.run(key, args),
              );
            const observed = await withPostgresExecutionObservation(
              persistence.pool,
              execute,
              { attributeStatements: true },
            );
            const after = await fixture.verifyInsert(
              before,
              observed.value,
              count,
              args.prefix,
            );
            const executions =
              candidate === "core"
                ? fixture.executionCount
                : mutation.executionCount;
            expect(executions()).toBe(1);
            record(candidate, "mutation", observed.observation);
            const replay = await withPostgresExecutionObservation(
              persistence.pool,
              execute,
              { attributeStatements: true },
            );
            expect(replay.value).toEqual(observed.value);
            expect(executions()).toBe(1);
            expect(await fixture.inventory()).toEqual(after);
            record(candidate, "replay", replay.observation);
          }
        });
      }
      const report = {
        purpose:
          "SQL attribution only; hashing and classification overhead is not calibrated latency",
        boundary:
          "complete request excluding fixture construction, key generation and verification",
        interpretation:
          "digests group exact SQL text; family mentions are not a SQL parser or affected-row counts; ordinals are invocation order, not server execution duration",
        environments,
        constructions,
        workloads,
      };
      if (process.env.FLAREX_CE0_SQL_ATTRIBUTION_REPORT_PATH !== undefined)
        await writeFile(
          process.env.FLAREX_CE0_SQL_ATTRIBUTION_REPORT_PATH,
          JSON.stringify(report, null, 2) + "\n",
        );
      console.info(
        "CE0 complete request SQL attribution",
        JSON.stringify(report),
      );
    }, 180_000);
  },
);
