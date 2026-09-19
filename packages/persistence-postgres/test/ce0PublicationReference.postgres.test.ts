import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { readCe0Environment } from "./ce0Environment";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import {
  createScopePublicationFixture,
  type PublicationCandidate,
} from "./scopePublicationBatchScenario";

describe.skipIf(postgresUrl === null)(
  "CE0 publication persistence reference",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it("compares identical committed facts and outcomes through the common transaction owner", async () => {
      await withPersistence(async (persistence) => {
        const environment = await readCe0Environment(persistence, [
          "./ce0PublicationReference.postgres.test.ts",
          "./ce0PublicationReference.ts",
          "./scopePublicationBatchScenario.ts",
        ]);
        const samples = [];
        for (const rowCount of [0, 1, 8, 32, 128]) {
          for (let pair = -1; pair < 5; pair += 1) {
            let expected: string | undefined;
            const order: readonly PublicationCandidate[] =
              pair % 2 === 0 ? ["core", "reference"] : ["reference", "core"];
            for (const candidate of order) {
              const fixture = await createScopePublicationFixture(
                persistence,
                rowCount,
              );
              const measured = await withPostgresExecutionObservation(
                persistence.pool,
                async (markPhase) => {
                  await fixture.publish(candidate, {
                    beforePublication: () => markPhase("publication"),
                    afterPublication: () => markPhase("beforeCommit"),
                    observeParameters: false,
                  }).work;
                },
              );
              expect(measured.observation.commands.begin).toBe(1);
              expect(measured.observation.commands.commit).toBe(1);
              expect(measured.observation.phases.publication?.queryCalls).toBe(
                4 + Math.ceil(rowCount / 500),
              );
              await fixture.verify();
              const state = fixture.normalize(await fixture.readState());
              if (expected === undefined) expected = state;
              else expect(state).toBe(expected);
              if (pair >= 0)
                samples.push({
                  rowCount,
                  pair,
                  candidate,
                  observation: measured.observation,
                });
            }
          }
        }
        const report = {
          ...environment,
          workload:
            "trusted Application publication persistence; no native admission, OCC, row/index materialization, session teardown or recovery",
          boundary:
            "publication phase is prefix plus clock advancement; total also includes the common transaction, clock lock, prepared tombstone fixture writes and COMMIT",
          comparison:
            "same Drizzle execution bridge and physical layout; explicit SQL versus core statement builders; both instrumented; no full-request overhead ratio",
          warmupPairs: 1,
          measuredPairs: 5,
          samples,
        };
        if (
          process.env.FLAREX_CE0_PUBLICATION_REFERENCE_REPORT_PATH !== undefined
        )
          await writeFile(
            process.env.FLAREX_CE0_PUBLICATION_REFERENCE_REPORT_PATH,
            JSON.stringify(report, null, 2) + "\n",
          );
        console.info(
          "CE0 publication persistence reference",
          JSON.stringify(report),
        );
      });
    }, 180_000);
  },
);
