import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { cmsExecutionMeasurementCorrectness, cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import { readCe0Environment } from "./ce0Environment";
import { runEffect } from "./effectTestRuntime";
import { makeCmsHost } from "../src/cmsTransaction/host";

type Observation = Awaited<ReturnType<typeof withPostgresExecutionObservation>>["observation"];
interface Sample {
  readonly pair: number;
  readonly mode: "normal" | "instrumented";
  readonly elapsedMilliseconds: number;
  readonly observation: Observation | null;
  readonly followup: { readonly kind: "mutationReplay" | "repeatedRead"; readonly observation: Observation };
}
interface Workload {
  readonly kind: "read" | "mutation";
  readonly count: number;
  readonly environment: Awaited<ReturnType<typeof readCe0Environment>>;
  readonly samples: readonly Sample[];
  readonly summary: { readonly medianPairedRatio: number; readonly observerWithinTolerance: boolean;
    readonly normalMedianMilliseconds: number; readonly instrumentedMedianMilliseconds: number };
}

describe.skipIf(postgresUrl === null)("CE2 active CMS request measurement", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("combines index families while retaining bounded membership SQL", () => withPersistence(async persistence => {
    const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence));
    for (const count of [1, 16, 17, 32]) {
      const before = await tested.inventory();
      const titles = Array.from({ length: count }, (_, index) => `combined-sql-${count}-${index}`);
      let batches = 0;
      const measured = await withPostgresExecutionObservation(persistence.pool, async mark => {
        const host = await runEffect(makeCmsHost({ ...tested.input, materialization: {
          ...tested.input.materialization,
          afterTransactionStep: async event => {
            if (event.step === "indexBatchWriting") { batches++; mark(event.step); }
            else if (event.step === "indexBatchWritten") mark(event.step);
          },
        } }));
        return runEffect(host.run(host.newRequestKey(), tested.insert, { titles }));
      });
      expect(batches).toBe(1);
      expect(measured.observation.phases.indexBatchWriting?.queryCalls).toBe(1 + 4 * Math.ceil((count * 2) / 32));
      await tested.verifyInserts(before, [{ value: measured.value, titles }]);
    }
  }), 120_000);
  it("proves active request state, replay and conflict rollback", () => withPersistence(async persistence => {
    expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
    await cmsExecutionMeasurementCorrectness(persistence, makePostgresRelationalSession(persistence));
  }), 120_000);

  it("measures full active requests and calibrated observation without build progress writes", async () => {
    const workloads: Workload[] = [];
    const profiles = [{ kind: "read", count: 0 }, ...[0, 1, 8, 32].map(count => ({ kind: "mutation" as const, count }))] as const;
    for (const profile of profiles) await withPersistence(async persistence => {
      const { count } = profile;
      const environment = await readCe0Environment(persistence, ["./cmsExecutionMeasurement.postgres.test.ts", "./cmsExecutionMeasurementFixture.ts", "./cmsHostFixture.ts"]);
      const tested = await cmsExecutionMeasurementFixture(persistence, makePostgresRelationalSession(persistence));
      const samples: Sample[] = [];
      let ordinal = 0;
      for (let pair = -1; pair < 5; pair++) {
        const order = pair % 2 === 0 ? ["normal", "instrumented"] as const : ["instrumented", "normal"] as const;
        for (const mode of order) {
          const before = await tested.inventory();
          const callbacksBefore = { writes: tested.executionCount(), reads: tested.readExecutionCount() };
          const key = tested.host.newRequestKey();
          const args = { count, prefix: `sample-${(ordinal++).toString().padStart(4, "0")}` };
          const execute = () => profile.kind === "read" ? runEffect(tested.host.read(tested.read, [])) :
            runEffect(tested.host.run(key, tested.insert, args));
          const measured = mode === "instrumented" ? await withPostgresExecutionObservation(persistence.pool, async mark => {
            mark("cmsRequest");
            return execute();
          }) : null;
          const started = performance.now();
          const value = measured === null ? await execute() : measured.value;
          const elapsedMilliseconds = measured?.observation.elapsedMilliseconds ?? performance.now() - started;
          if (measured !== null) {
            // Request preparation also uses read transactions. Durable state
            // distinguishes a read from a successful empty mutation below.
            expect(measured.observation.commands.commit).toBeGreaterThan(0);
            expect(measured.observation.commands.commit).toBe(measured.observation.commands.begin);
            expect(measured.observation.commands.rollback ?? 0).toBe(0);
            for (const family of ["fx_system_index_build_state", "fx_system_unique_constraint_build"]) {
              const commands = measured.observation.familyCommands[family];
              if (profile.kind === "mutation") expect(commands?.select).toBeGreaterThan(0);
              for (const verb of ["insert", "update", "delete", "with"]) expect(commands?.[verb] ?? 0).toBe(0);
            }
          }
          expect(tested.executionCount()).toBe(callbacksBefore.writes + (profile.kind === "mutation" ? 1 : 0));
          expect(tested.readExecutionCount()).toBe(callbacksBefore.reads + (profile.kind === "read" ? 1 : 0));
          const after = profile.kind === "read" ? await tested.inventory() : await tested.verifyInsert(before, value, count, args.prefix);
          if (profile.kind === "read") {
            expect(value).toEqual([]);
            expect(after).toEqual(before);
          }
          const executed = tested.executionCount();
          const readExecutions = tested.readExecutionCount();
          const followupKind = profile.kind === "read" ? "repeatedRead" : "mutationReplay";
          const followup = await withPostgresExecutionObservation(persistence.pool, async mark => {
            mark(profile.kind === "read" ? "cmsRequest" : "replay");
            return execute();
          });
          expect(followup.value).toEqual(value);
          expect(tested.executionCount()).toBe(executed);
          expect(tested.readExecutionCount()).toBe(readExecutions + (profile.kind === "read" ? 1 : 0));
          for (const verb of ["insert", "update", "delete"]) expect(followup.observation.commands[verb] ?? 0).toBe(0);
          expect(await tested.inventory()).toEqual(after);
          if (pair >= 0) samples.push({ pair, mode, elapsedMilliseconds, observation: measured?.observation ?? null,
            followup: { kind: followupKind, observation: followup.observation } });
        }
      }
      const ratios = Array.from({ length: 5 }, (_, pair) => {
        const normal = samples.find(sample => sample.pair === pair && sample.mode === "normal");
        const instrumented = samples.find(sample => sample.pair === pair && sample.mode === "instrumented");
        if (normal === undefined || instrumented === undefined) throw new Error("Missing paired CMS sample");
        return instrumented.elapsedMilliseconds / normal.elapsedMilliseconds;
      });
      const medianPairedRatio = median(ratios);
      workloads.push({ kind: profile.kind, count, environment, samples, summary: { medianPairedRatio, observerWithinTolerance: Math.abs(medianPairedRatio - 1) <= 0.05,
        normalMedianMilliseconds: median(samples.filter(sample => sample.mode === "normal").map(sample => sample.elapsedMilliseconds)),
        instrumentedMedianMilliseconds: median(samples.filter(sample => sample.mode === "instrumented").map(sample => sample.elapsedMilliseconds)) } });
    });
    const report = { workload: "active private CMS empty read and zero/one/many-row mutations through real host admission, execution and settlement",
      boundary: "setup, host construction, request-key generation and assertion/readback excluded; mutation replay and repeated reads measured separately",
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
