import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { cmsExecutionMeasurementCorrectness, cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import { readCe0Environment } from "./ce0Environment";
import { runEffect } from "./effectTestRuntime";

type Observation = Awaited<ReturnType<typeof withPostgresExecutionObservation>>["observation"];
interface Sample {
  readonly pair: number;
  readonly mode: "normal" | "instrumented";
  readonly elapsedMilliseconds: number;
  readonly observation: Observation | null;
  readonly replay: Observation;
}
interface Workload {
  readonly count: number;
  readonly environment: Awaited<ReturnType<typeof readCe0Environment>>;
  readonly samples: readonly Sample[];
  readonly summary: { readonly medianPairedRatio: number; readonly observerWithinTolerance: boolean;
    readonly normalMedianMilliseconds: number; readonly instrumentedMedianMilliseconds: number };
}

describe.skipIf(postgresUrl === null)("CE2 active CMS request measurement", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("proves active request state, replay and conflict rollback", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await cmsExecutionMeasurementCorrectness(persistence, makePostgresRelationalSession(persistence));
  }), 120_000);

  it("measures full active requests and calibrated observation without build progress writes", async () => {
    const workloads: Workload[] = [];
    for (const count of [1, 8, 32]) await withPersistence(async persistence => {
      const environment = await readCe0Environment(persistence, ["./cmsExecutionMeasurement.postgres.test.ts", "./cmsExecutionMeasurementFixture.ts", "./cmsHostFixture.ts"]);
      const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence));
      const samples: Sample[] = [];
      let ordinal = 0;
      for (let pair = -1; pair < 5; pair++) {
        const order = pair % 2 === 0 ? ["normal", "instrumented"] as const : ["instrumented", "normal"] as const;
        for (const mode of order) {
          const before = await tested.inventory();
          const key = tested.host.newRequestKey();
          const args = { count, prefix: `sample-${(ordinal++).toString().padStart(4, "0")}` };
          const execute = () => runEffect(tested.host.run(key, tested.insert, args));
          const measured = mode === "instrumented" ? await withPostgresExecutionObservation(persistence.pool, async mark => {
            mark("cmsRequest");
            return execute();
          }) : null;
          const started = performance.now();
          const value = measured === null ? await execute() : measured.value;
          const elapsedMilliseconds = measured?.observation.elapsedMilliseconds ?? performance.now() - started;
          if (measured !== null) {
            // host.run also prepares catalog/readiness evidence in read
            // transactions. The durable assertions require one publication.
            expect(measured.observation.commands.commit).toBeGreaterThan(0);
            expect(measured.observation.commands.commit).toBe(measured.observation.commands.begin);
            expect(measured.observation.commands.rollback ?? 0).toBe(0);
            for (const family of ["fx_system_index_build_state", "fx_system_unique_constraint_build"]) {
              const commands = measured.observation.familyCommands[family];
              expect(commands?.select).toBeGreaterThan(0);
              for (const verb of ["insert", "update", "delete", "with"]) expect(commands?.[verb] ?? 0).toBe(0);
            }
          }
          const after = await tested.verifyInsert(before, value, count, args.prefix);
          const executed = tested.executionCount();
          const replay = await withPostgresExecutionObservation(persistence.pool, async mark => {
            mark("replay");
            return execute();
          });
          expect(replay.value).toEqual(value);
          expect(tested.executionCount()).toBe(executed);
          for (const verb of ["insert", "update", "delete"]) expect(replay.observation.commands[verb] ?? 0).toBe(0);
          expect(await tested.inventory()).toEqual(after);
          if (pair >= 0) samples.push({ pair, mode, elapsedMilliseconds, observation: measured?.observation ?? null, replay: replay.observation });
        }
      }
      const ratios = Array.from({ length: 5 }, (_, pair) => {
        const normal = samples.find(sample => sample.pair === pair && sample.mode === "normal");
        const instrumented = samples.find(sample => sample.pair === pair && sample.mode === "instrumented");
        if (normal === undefined || instrumented === undefined) throw new Error("Missing paired CMS sample");
        return instrumented.elapsedMilliseconds / normal.elapsedMilliseconds;
      });
      const medianPairedRatio = median(ratios);
      workloads.push({ count, environment, samples, summary: { medianPairedRatio, observerWithinTolerance: Math.abs(medianPairedRatio - 1) <= 0.05,
        normalMedianMilliseconds: median(samples.filter(sample => sample.mode === "normal").map(sample => sample.elapsedMilliseconds)),
        instrumentedMedianMilliseconds: median(samples.filter(sample => sample.mode === "instrumented").map(sample => sample.elapsedMilliseconds)) } });
    });
    const report = { workload: "active private CMS inserts through host.run, admission, materialization, publication and COMMIT",
      boundary: "setup, host construction, request-key generation and assertion/readback excluded; replay measured separately",
      limitations: "single offered request; growing small catalog; no native execution, Payload Local API, Cloudflare transport, independent reference or capacity claim",
      warmupPairs: 1, measuredPairs: 5, observerMedianTolerance: 0.05, workloads };
    if (process.env.FLAREX_CE2_ACTIVE_CMS_REPORT_PATH !== undefined) await writeFile(process.env.FLAREX_CE2_ACTIVE_CMS_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
    console.info("CE2 active CMS request measurement", JSON.stringify(report));
  }, 180_000);
});

function median(values: readonly number[]): number {
  const value = values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  if (value === undefined) throw new Error("Missing CMS measurement samples");
  return value;
}
