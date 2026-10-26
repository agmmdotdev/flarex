import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Effect, Exit, Scope } from "effect";
import { it } from "vitest";
import { createPayloadHost } from "../src/payload-host.ts";
import { fixture, newsCollection } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { nativePayloadFixture } from "./native-payload.mjs";
import { sourceFingerprint } from "./measurement-source.mjs";
import * as tables from "../src/schema.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const quantile = (values, fraction) => values.toSorted((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];

it.skipIf(process.env.FLAREX_EXPERIMENT_COMPARE !== "1")("compares complete Payload create across native, active and experimental cores", async () => {
  const { preparePayloadFlows } = await import("../../../packages/executor/test/performance/support/payloadFlows.ts");
  let fingerprintBefore = await sourceFingerprint();
  const postgres = await startPostgres();
  let experimental, native, active, bodyFailure;
  let stage = "disposable-installations";
  const scope = await Effect.runPromise(Scope.make());
  try {
    experimental = await fixture(postgres.connectionString);
    native = await nativePayloadFixture(postgres.connectionString);
    const nativePayload = native.payload;
    stage = "active-core-preparation";
    active = await preparePayloadFlows("postgres", "scalar", "small", {
      connectionString: postgres.connectionString, provisioningConnectionString: postgres.connectionString,
    });
    stage = "candidate-and-comparison";
    const host = await Effect.runPromise(createPayloadHost(newsCollection(), experimental.persistence, "shop-a").pipe(Effect.provideService(Scope.Scope, scope)));
    const samples = [];
    const smoke = process.env.FLAREX_EXPERIMENT_COMPARE_SMOKE === "1";
    const warmups = smoke ? 0 : 5;
    const pairs = smoke ? 1 : 30;
    for (let index = 0; index < warmups + pairs; index++) {
      if (index === warmups) fingerprintBefore = await sourceFingerprint();
      const headline = `experimental-slice-${index}`;
      const prepared = await active.prepareSample("payload-create", headline);
      const times = {};
      const operations = {
        native: () => nativePayload.create({ collection: "news-items", data: { headline }, depth: 0, overrideAccess: false }),
        active: () => prepared.run(),
        experimental: () => Effect.runPromise(host.create(randomUUID(), { headline })),
      };
      const results = {};
      const order = index % 2 === 0 ? ["native", "active", "experimental"] : ["experimental", "active", "native"];
      for (const lane of order) {
        const started = performance.now(); results[lane] = await operations[lane](); times[lane] = performance.now() - started;
      }
      for (const document of Object.values(results)) {
        assert.deepEqual(Object.keys(document).toSorted(), ["id", "headline", "score", "createdAt", "updatedAt"].toSorted());
        assert.equal(document.headline, headline); assert.equal(document.score, 0);
      }
      await prepared.verify(results.active);
      assert.deepEqual(await Effect.runPromise(host.read(results.experimental.id)), results.experimental);
      assert.deepEqual(await nativePayload.findByID({ collection: "news-items", id: results.native.id, depth: 0, overrideAccess: false }), results.native);
      if (index >= warmups) samples.push(times);
      await prepared.cleanup();
      await nativePayload.delete({ collection: "news-items", id: results.native.id, overrideAccess: false });
      await experimental.admin(async db => {
        await db.delete(tables.eventIntents); await db.delete(tables.uniqueClaims);
        await db.delete(tables.history); await db.delete(tables.documents); await db.delete(tables.commands);
      });
    }
    const fingerprintAfter = await sourceFingerprint();
    const summary = Object.fromEntries(["native", "active", "experimental"].map(lane => [lane, {
      medianMs: quantile(samples.map(sample => sample[lane]), 0.5), p95Ms: quantile(samples.map(sample => sample[lane]), 0.95),
    }]));
    const excess = samples.map(sample => sample.experimental - sample.native);
    const report = { workload: "payload-create", scope: "bounded first slice; no Application OCC or full-core acceptance claim",
      head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      mode: smoke ? "diagnostic-smoke" : "quiet-latency", warmups, pairs, source: { before: fingerprintBefore, after: fingerprintAfter },
      stableSource: fingerprintBefore.sha256 === fingerprintAfter.sha256, summary,
      pairedExcess: { medianMs: quantile(excess, 0.5), p95Ms: quantile(excess, 0.95) }, samples };
    await mkdir(join(root, "validation"), { recursive: true });
    await writeFile(join(root, smoke ? "validation/payload-create-smoke.json" : "validation/payload-create.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify({ summary, excess: report.pairedExcess, stableSource: report.stableSource }));
    if (!smoke) assert.equal(report.stableSource, true, "Executing source changed during measurement; retain but reject this cohort");
  } catch (cause) {
    bodyFailure = cause;
    try {
      const failure = { workload: "payload-create", stage, status: "failed-no-performance-result",
        head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
        source: { before: fingerprintBefore, after: await sourceFingerprint() },
        error: { name: cause?.name, message: String(cause), stack: cause?.stack } };
      await mkdir(join(root, "validation"), { recursive: true });
      await writeFile(join(root, "validation/payload-create-failure.json"), JSON.stringify(failure, null, 2) + "\n");
    } catch (recording) {
      bodyFailure = new AggregateError([cause, recording], "Comparison failed and its report could not be recorded", { cause });
    }
    throw bodyFailure;
  }
  finally {
    const outcomes = await Promise.allSettled([
      Effect.runPromise(Scope.close(scope, Exit.void)),
      active?.dispose(), native?.close(),
    ]);
    outcomes.push(...await Promise.allSettled([experimental?.close()]));
    outcomes.push(...await Promise.allSettled([postgres.close()]));
    const failed = outcomes.filter(outcome => outcome.status === "rejected");
    if (failed.length) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]), ...failed.map(outcome => outcome.reason)], "Comparison body/cleanup failed", { cause: bodyFailure });
  }
}, 600_000);
