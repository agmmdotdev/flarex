import { writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { describe, expect, it } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { Pool } from "pg";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { decodeReadDocuments } from "./ce0CmsReadReferenceScenario";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import { readCe0Environment } from "./ce0Environment";
import { runEffect } from "./effectTestRuntime";

type Observation = Awaited<
  ReturnType<typeof withPostgresExecutionObservation>
>["observation"];
type Candidate = "core" | "reference";
type Mode = "normal" | "instrumented";
type Operation = "read" | "mutation" | "mutationReplay";
interface Sample {
  readonly pair: number;
  readonly candidate: Candidate;
  readonly mode: Mode;
  readonly operation: Operation;
  readonly elapsedMilliseconds: number;
  readonly processCpuMilliseconds: number;
  readonly rssBeforeBytes: number;
  readonly rssAfterBytes: number;
  readonly processPeakRssKilobytes: number;
  readonly observation: Observation | null;
}
const policy = Object.freeze({
  warmupPairs: 2,
  measuredPairs: 5,
  medianRatioTarget: 1.25,
  individualRatioTarget: 1.5,
  minimumPairsWithinTarget: 4,
  observerTolerance: 0.05,
});

// The single outer Vitest boundary owns these wall/CPU/driver observations.
async function measure(
  pool: Pool,
  mode: Mode,
  operation: Operation,
  execute: () => Promise<Json>,
) {
  const rssBeforeBytes = process.memoryUsage().rss;
  const cpu = process.cpuUsage();
  const started = performance.now();
  const measured =
    mode === "instrumented"
      ? await withPostgresExecutionObservation(pool, async (mark) => {
          mark(operation === "mutationReplay" ? "replay" : "cmsRequest");
          return execute();
        })
      : null;
  const value = measured === null ? await execute() : measured.value;
  const elapsedMilliseconds = performance.now() - started;
  const used = process.cpuUsage(cpu);
  return {
    value,
    elapsedMilliseconds,
    processCpuMilliseconds: (used.user + used.system) / 1000,
    rssBeforeBytes,
    rssAfterBytes: process.memoryUsage().rss,
    processPeakRssKilobytes: process.resourceUsage().maxRSS,
    observation: measured?.observation ?? null,
  };
}

function distribution(values: readonly number[]) {
  expect(values).toHaveLength(policy.measuredPairs);
  expect(values.every((value) => Number.isFinite(value) && value > 0)).toBe(
    true,
  );
  const sorted = values.toSorted((left, right) => left - right);
  const minimum = sorted[0];
  const median = sorted[2];
  const maximum = sorted[4];
  if (minimum === undefined || median === undefined || maximum === undefined)
    throw new Error("Missing paired measurement median");
  return { minimum, median, maximum };
}

function verifyObservation(observation: Observation, readOnly: boolean) {
  expect(observation.commands.commit).toBeGreaterThan(0);
  expect(observation.commands.commit).toBe(observation.commands.begin);
  expect(observation.commands.rollback ?? 0).toBe(0);
  if (readOnly) {
    for (const verb of ["insert", "update", "delete"])
      expect(observation.commands[verb] ?? 0).toBe(0);
  }
  for (const family of [
    "fx_system_index_build_state",
    "fx_system_unique_constraint_build",
  ]) {
    for (const verb of ["insert", "update", "delete", "with"])
      expect(observation.familyCommands[family]?.[verb] ?? 0).toBe(0);
  }
}

function summarize(samples: readonly Sample[], operation: Operation) {
  const sample = (pair: number, candidate: Candidate, mode: Mode) => {
    const matches = samples.filter(
      (value) =>
        value.operation === operation &&
        value.pair === pair &&
        value.candidate === candidate &&
        value.mode === mode,
    );
    expect(matches).toHaveLength(1);
    const value = matches[0];
    if (value === undefined) throw new Error("Missing paired sample");
    return value;
  };
  const pairs = Array.from({ length: policy.measuredPairs }, (_, pair) => pair);
  const recordedOrder = pairs.map((pair) =>
    samples.filter(
      (value) => value.operation === operation && value.pair === pair,
    ),
  );
  for (const mode of ["normal", "instrumented"] as const) {
    const firstCandidates = recordedOrder.map(
      (values) => values.find((value) => value.mode === mode)?.candidate,
    );
    for (const candidate of ["core", "reference"] as const) {
      const count = firstCandidates.filter(
        (value) => value === candidate,
      ).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
  }
  expect(
    new Set(
      recordedOrder.map(
        (values) => `${values[0]?.mode}:${values[0]?.candidate}`,
      ),
    ),
  ).toEqual(
    new Set([
      "normal:core",
      "normal:reference",
      "instrumented:core",
      "instrumented:reference",
    ]),
  );
  const normalPairedRatios = pairs.map(
    (pair) =>
      sample(pair, "core", "normal").elapsedMilliseconds /
      sample(pair, "reference", "normal").elapsedMilliseconds,
  );
  const normalRatio = distribution(normalPairedRatios);
  const candidates = (["core", "reference"] as const).map((candidate) => {
    const calibrationRatios = pairs.map(
      (pair) =>
        sample(pair, candidate, "instrumented").elapsedMilliseconds /
        sample(pair, candidate, "normal").elapsedMilliseconds,
    );
    const calibration = distribution(calibrationRatios);
    return {
      candidate,
      normalMilliseconds: distribution(
        pairs.map(
          (pair) => sample(pair, candidate, "normal").elapsedMilliseconds,
        ),
      ),
      instrumentedMilliseconds: distribution(
        pairs.map(
          (pair) => sample(pair, candidate, "instrumented").elapsedMilliseconds,
        ),
      ),
      calibrationRatios,
      calibration,
      observerWithinTolerance:
        Math.abs(calibration.median - 1) <= policy.observerTolerance,
    };
  });
  const pairsWithinTarget = normalPairedRatios.filter(
    (value) => value <= policy.individualRatioTarget,
  ).length;
  return {
    operation,
    recordedOrder: recordedOrder.map((values) =>
      values.map(({ candidate, mode }) => ({ candidate, mode })),
    ),
    normalPairedRatios,
    normalRatio,
    pairsWithinTarget,
    normalLatencyTargetMet:
      normalRatio.median <= policy.medianRatioTarget &&
      pairsWithinTarget >= policy.minimumPairsWithinTarget,
    candidates,
  };
}

describe.skipIf(postgresUrl === null)(
  "CE0 paired complete scalar requests",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it("compares admitted core/reference requests with independent observer calibration", async () => {
      const workloads: {
        kind: "read" | "mutation";
        count: number;
        environment: Awaited<ReturnType<typeof readCe0Environment>>;
        samples: readonly Sample[];
        summary: readonly ReturnType<typeof summarize>[];
      }[] = [];
      for (const kind of ["read", "mutation"] as const) {
        for (const count of [0, 1, 8, 32]) {
          await withPersistence(async (persistence) => {
            const environment = await readCe0Environment(persistence, [
              "./ce0PairedRequestMeasurement.postgres.test.ts",
              "./cmsExecutionMeasurementFixture.ts",
              "./cmsHostFixture.ts",
              "./ce0CmsMutationReference.ts",
              "./ce0CmsReadReference.ts",
              "./ce0FirstInsertDocuments.ts",
              "./ce0FirstInsertMaterialization.ts",
              "./ce0PublicationReference.ts",
              "./ce0CmsReferencePersistence.ts",
            ]);
            const session = makePostgresRelationalSession(persistence);
            const coreFixture = await cmsExecutionMeasurementFixture(
              persistence,
              session,
            );
            const referenceFixture = await cmsExecutionMeasurementFixture(
              persistence,
              session,
            );
            const mutation = await runEffect(
              makeCe0CmsMutationReference(referenceFixture.input),
            );
            const read = await runEffect(
              makeCe0CmsReadReference(referenceFixture.input),
            );
            const entries: {
              candidate: Candidate;
              fixture: typeof coreFixture;
              run: typeof mutation.run;
              read: (ids: string[]) => ReturnType<typeof read.read>;
              writeCount: () => number;
              readCount: () => number;
              ids: string[];
              expected: Json;
            }[] = [
              {
                candidate: "core",
                fixture: coreFixture,
                run: (key: string, args: Json) =>
                  coreFixture.host.run(key, coreFixture.insert, args),
                read: (ids: string[]) =>
                  coreFixture.host.read(coreFixture.read, ids),
                writeCount: coreFixture.executionCount,
                readCount: coreFixture.readExecutionCount,
                ids: [],
                expected: [],
              },
              {
                candidate: "reference",
                fixture: referenceFixture,
                run: mutation.run,
                read: read.read,
                writeCount: mutation.executionCount,
                readCount: read.executionCount,
                ids: [],
                expected: [],
              },
            ];
            for (const entry of entries) {
              if (kind === "read" && count !== 0) {
                const args = { count, prefix: "read-seed" };
                const before = await entry.fixture.inventory();
                const value = await runEffect(
                  entry.fixture.host.run(
                    entry.fixture.host.newRequestKey(),
                    entry.fixture.insert,
                    args,
                  ),
                );
                await entry.fixture.verifyInsert(
                  before,
                  value,
                  count,
                  args.prefix,
                );
                const documents = decodeReadDocuments(value);
                entry.ids = documents.map((document) => document._id);
                entry.expected = documents;
              }
            }
            const samples: Sample[] = [];
            for (
              let pair = -policy.warmupPairs;
              pair < policy.measuredPairs;
              pair++
            ) {
              const modes: readonly Mode[] =
                Math.floor(pair / 2) % 2 === 0
                  ? ["normal", "instrumented"]
                  : ["instrumented", "normal"];
              for (const [modeIndex, mode] of modes.entries()) {
                const order = pair % 2 === 0 ? entries : entries.toReversed();
                const args = {
                  count,
                  prefix: `pair-${String(pair + policy.warmupPairs).padStart(3, "0")}-${modeIndex}`,
                };
                const beforePair = await Promise.all(
                  entries.map((entry) => entry.fixture.inventory()),
                );
                expect(beforePair[0]?.rows.length).toBe(
                  beforePair[1]?.rows.length,
                );
                expect(beforePair[0]?.clock[0]?.lastCommitSeq).toBe(
                  beforePair[1]?.clock[0]?.lastCommitSeq,
                );
                for (const entry of order) {
                  const before = await entry.fixture.inventory();
                  const key = entry.fixture.host.newRequestKey();
                  const callbacks = {
                    writes: entry.writeCount(),
                    reads: entry.readCount(),
                  };
                  const execute = () =>
                    runEffect(
                      kind === "read"
                        ? entry.read(entry.ids)
                        : entry.run(key, args),
                    );
                  const measured = await measure(
                    persistence.pool,
                    mode,
                    kind,
                    execute,
                  );
                  expect(entry.writeCount()).toBe(
                    callbacks.writes + (kind === "mutation" ? 1 : 0),
                  );
                  expect(entry.readCount()).toBe(
                    callbacks.reads + (kind === "read" ? 1 : 0),
                  );
                  const after =
                    kind === "mutation"
                      ? await entry.fixture.verifyInsert(
                          before,
                          measured.value,
                          count,
                          args.prefix,
                        )
                      : await entry.fixture.inventory();
                  if (kind === "read") {
                    expect(measured.value).toEqual(entry.expected);
                    expect(after).toEqual(before);
                  }
                  const { value: _value, ...sample } = measured;
                  if (pair >= 0)
                    samples.push({
                      pair,
                      candidate: entry.candidate,
                      mode,
                      operation: kind,
                      ...sample,
                    });
                  if (measured.observation !== null) {
                    verifyObservation(measured.observation, kind === "read");
                  }
                  if (kind === "mutation") {
                    const counts = {
                      writes: entry.writeCount(),
                      reads: entry.readCount(),
                    };
                    const replayed = await measure(
                      persistence.pool,
                      mode,
                      "mutationReplay",
                      execute,
                    );
                    expect(replayed.value).toEqual(measured.value);
                    expect({
                      writes: entry.writeCount(),
                      reads: entry.readCount(),
                    }).toEqual(counts);
                    expect(await entry.fixture.inventory()).toEqual(after);
                    if (replayed.observation !== null) {
                      verifyObservation(replayed.observation, true);
                    }
                    const { value: _replayedValue, ...replaySample } = replayed;
                    if (pair >= 0)
                      samples.push({
                        pair,
                        candidate: entry.candidate,
                        mode,
                        operation: "mutationReplay",
                        ...replaySample,
                      });
                  }
                  expect(persistence.pool.waitingCount).toBe(0);
                  expect(persistence.pool.idleCount).toBe(
                    persistence.pool.totalCount,
                  );
                }
              }
            }
            workloads.push({
              kind,
              count,
              environment,
              samples,
              summary: [
                summarize(samples, kind),
                ...(kind === "mutation"
                  ? [summarize(samples, "mutationReplay")]
                  : []),
              ],
            });
          });
        }
      }
      const report = {
        workload:
          "paired admitted complete scalar requests over matching logical scope contents",
        policy,
        hardware: {
          cpuModel: cpus()[0]?.model ?? "unavailable",
          logicalCpus: cpus().length,
          totalMemoryBytes: totalmem(),
        },
        boundary:
          "construction/seed/key generation/assertions excluded; admission through physical settlement included; mutation replay separate",
        common:
          "admission, codecs, schema validator, bounded readers/lifetime, build/candidate authority, physical settlement and recovery",
        limitations:
          "single offered request; small growing logical datasets; live generated IDs/times differ; no server CPU/WAL/buffers/lock-hold/received-byte attribution, native OCC, framework lifecycle, hosted transport or capacity proof",
        workloads,
      };
      if (process.env.FLAREX_CE0_PAIRED_REQUEST_REPORT_PATH !== undefined)
        await writeFile(
          process.env.FLAREX_CE0_PAIRED_REQUEST_REPORT_PATH,
          JSON.stringify(report, null, 2) + "\n",
        );
      console.info(
        "CE0 paired scalar request measurement",
        JSON.stringify(report),
      );
    }, 300_000);
  },
);
