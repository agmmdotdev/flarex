import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";
import { Effect, Exit, Scope } from "effect";
import { sql } from "drizzle-orm";
import { BasePayload, buildConfig } from "payload";
import { it } from "vitest";
import { createPayloadHost } from "../src/payload-host.ts";
import { fixture, newsCollection } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import * as tables from "../src/schema.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const quantile = (values, fraction) => values.toSorted((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];
const nativePools = new WeakMap();
async function closeNative(payload) {
  await payload.destroy();
  // Same retained bootstrap-checkout disposition as the existing native
  // benchmark. No request is in flight when these public Pool events drain.
  for (const pool of nativePools.get(payload) ?? []) {
    for (const client of pool.held) client.release();
    await pool.end();
  }
}

async function sourceFingerprint() {
  const files = [];
  const visit = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".reports", ".scratch", "validation"].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (/\.(ts|mjs|js|json|sql|yaml)$/.test(item.name)) files.push(path);
    }
  };
  await visit(root);
  // This conservative fingerprint also detects concurrent edits in active code.
  // Dirty files participate; Git HEAD alone cannot identify the executing tree.
  const packages = fileURLToPath(new URL("../../../packages", import.meta.url));
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await visit(join(packages, entry.name, "src")); }
    catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  }
  await visit(join(packages, "executor/test/performance/support"));
  await visit(join(packages, "persistence-postgres/test"));
  await visit(join(packages, "persistence-postgres/drizzle"));
  // Hash the executing installed dependencies too, including the separate
  // native adapter island. Package versions alone do not identify dirty bytes.
  const require = createRequire(import.meta.url);
  const nativeRequire = createRequire(new URL("../../../work/native-business-baseline/dependencies/package.json", import.meta.url));
  for (const [resolver, names] of [[require, ["payload", "effect", "drizzle-orm", "pg"]],
    [nativeRequire, ["@payloadcms/db-postgres", "@payloadcms/drizzle", "payload", "drizzle-orm", "pg"]]]) {
    for (const name of names) {
      const entry = resolver.resolve(name);
      await visit(dirname(entry));
    }
  }
  const digest = createHash("sha256");
  for (const path of files.toSorted()) { digest.update(relative(root, path)); digest.update(await readFile(path)); }
  return { sha256: digest.digest("hex"), files: files.length };
}

it.skipIf(process.env.FLAREX_EXPERIMENT_COMPARE !== "1")("compares complete Payload create across native, active and experimental cores", async () => {
  const nativePg = createRequire(import.meta.url)("../../../work/native-business-baseline/dependencies/node_modules/pg/lib/index.js");
  const { postgresAdapter } = await import("../../../work/native-business-baseline/dependencies/node_modules/@payloadcms/db-postgres/dist/index.js");
  const { preparePayloadFlows } = await import("../../../packages/executor/test/performance/support/payloadFlows.ts");
  const fingerprintBefore = await sourceFingerprint();
  const postgres = await startPostgres();
  let experimental, nativeDatabase, active, nativePayload, bodyFailure;
  let stage = "disposable-installations";
  const scope = await Effect.runPromise(Scope.make());
  try {
    experimental = await fixture(postgres.connectionString);
    nativeDatabase = await fixture(postgres.connectionString);
    const makeNative = async (connectionString, push) => {
      const payload = new BasePayload();
      const pools = []; nativePools.set(payload, pools);
      class OwnedPool extends nativePg.Pool {
        held = new Set();
        constructor(options) {
          super(options); pools.push(this);
          this.on("acquire", client => this.held.add(client));
          this.on("release", (_error, client) => this.held.delete(client));
        }
      }
      try {
        await payload.init({ disableOnInit: true, config: await buildConfig({
          secret: "disposable-native-reference-not-a-deployment-secret",
          db: postgresAdapter({ pool: { connectionString, max: 2 }, schemaName: "native_payload", idType: "uuid", push, disableCreateDatabase: true, pg: { ...nativePg, Pool: OwnedPool } }),
          collections: [newsCollection(), { slug: "users", auth: true, lockDocuments: false, fields: [] }],
          admin: { user: "users", disable: true }, globals: [], folders: false, telemetry: false,
          jobs: { tasks: [], workflows: [] }, typescript: { autoGenerate: false },
          email: () => ({ name: "disabled", defaultFromAddress: "disabled@example.invalid", defaultFromName: "Disabled",
            sendEmail: async () => { throw new Error("Email is outside the admitted reference"); } }),
        }) });
        return payload;
      } catch (cause) { await closeNative(payload); throw cause; }
    };
    const bootstrap = await makeNative(nativeDatabase.ownerUrl, true);
    await closeNative(bootstrap);
    await nativeDatabase.admin(async db => {
      await db.execute(sql.raw(`grant usage on schema native_payload to ${nativeDatabase.role}`));
      await db.execute(sql.raw(`grant select,insert,update,delete on all tables in schema native_payload to ${nativeDatabase.role}`));
      await db.execute(sql.raw(`grant usage,select on all sequences in schema native_payload to ${nativeDatabase.role}`));
    });
    nativePayload = await makeNative(nativeDatabase.servingUrl, false);
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
      active?.dispose(), nativePayload === undefined ? undefined : closeNative(nativePayload),
    ]);
    outcomes.push(...await Promise.allSettled([experimental?.close(), nativeDatabase?.close()]));
    outcomes.push(...await Promise.allSettled([postgres.close()]));
    const failed = outcomes.filter(outcome => outcome.status === "rejected");
    if (failed.length) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]), ...failed.map(outcome => outcome.reason)], "Comparison body/cleanup failed", { cause: bodyFailure });
  }
}, 600_000);
