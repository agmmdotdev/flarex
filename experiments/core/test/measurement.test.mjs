import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Scope } from "effect";
import { and, eq } from "drizzle-orm";
import { it } from "vitest";
import { compileDefinition } from "../src/definition.ts";
import { createApplicationHost } from "../src/application.ts";
import { createApplicationStorage } from "../src/application-storage.ts";
import { createPayloadHost } from "../src/payload-host.ts";
import { createProductHost } from "../src/medusa-product.ts";
import { createMixedHost } from "../src/mixed.ts";
import * as tables from "../src/schema.ts";
import { applicationFunctions } from "./application-corpus.ts";
import { fixture, newsCollection } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { nativePayloadFixture } from "./native-payload.mjs";
import { nativeProductFixture } from "./native-product.mjs";
import { sourceFingerprint } from "./measurement-source.mjs";
import { seed, settings, install } from "./measurement-fixture.mjs";
import { failureEvidence } from "./measurement-errors.mjs";
import { writeSourceArtifact } from "./measurement-artifact.mjs";
import { createMixedMutationPerformanceTrace, structuralSql } from "../../../packages/persistence-postgres/test/performance/mixedMutationPerformanceTrace.ts";

const directory = fileURLToPath(new URL("../validation/", import.meta.url));
const json = value => JSON.parse(JSON.stringify(value));
const quantile = (values, fraction) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const distribution = values => ({ median: quantile(values, 0.5), p95: quantile(values, 0.95), minimum: Math.min(...values), maximum: Math.max(...values) });
const timestamp = value => { assert.equal(typeof value, "string"); assert.ok(Number.isFinite(Date.parse(value))); };
const poolState = pool => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
  held: pool.held === undefined ? pool.totalCount - pool.idleCount : pool.held.size });
function healthyObservation(records, expected) {
  assert.equal(records.length, 1);
  const record = records[0]; assert.equal(record.aggregationComplete, true); assert.equal(record.outcome, "ok");
  for (const flag of ["observationErrors", "droppedObservations", "lostContextDispatches", "unobservedDispatches", "unknownStatementDispatches", "incompleteSpans"])
    assert.equal(record[flag], 0, `Incomplete SQL observation: ${flag}`);
  assert.equal(record.transactions.some(transaction => transaction.outcome === "open-at-end"), false);
  assert.equal(record.dispatches.length > 0, expected, "Intended owner query coverage must be observed");
}
function payloadShape(value) {
  assert.deepEqual(Object.keys(value).toSorted(), ["id", "headline", "score", "createdAt", "updatedAt"].toSorted());
  assert.equal(typeof value.id, "string"); timestamp(value.createdAt); timestamp(value.updatedAt);
  const { id: _id, createdAt: _created, updatedAt: _updated, ...body } = value; return body;
}
function productShape(value) {
  timestamp(value.created_at); timestamp(value.updated_at);
  const { created_at: _created, updated_at: _updated, ...body } = value; return body;
}
it.skipIf(process.env.FLAREX_EXPERIMENT_MEASURE === undefined)("measures declared complete native and experimental requests", async () => {
  const mode = process.env.FLAREX_EXPERIMENT_MEASURE;
  assert.ok(["smoke", "latency", "cpu", "sql"].includes(mode), "Select an explicit measurement mode");
  const report = { mode, status: "preparing", startedAt: new Date().toISOString(), samples: [], warmupSamples: [], failures: [],
    contract: "MEASUREMENT.md", activeBaseline: "blocked: validation/payload-create-failure.json",
    semantics: "Product reference independently commits; mixed reference uses standalone candidate Application plus genuine native frameworks. No equivalent atomic native baseline or active speedup claim.",
    head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    host: { node: process.version, v8: process.versions.v8, platform: process.platform, cpuCounterResolution: "Windows counters quantized; zero means below resolution, not zero CPU" } };
  let postgres, candidate, referenceApp, nativePayload, nativeProduct;
  const scope = await Effect.runPromise(Scope.make()); let bodyFailure;
  const traces = [];
  try {
    report.sourceAtStart = await sourceFingerprint();
    postgres = await startPostgres(); candidate = await fixture(postgres.connectionString); referenceApp = await fixture(postgres.connectionString);
    nativePayload = await nativePayloadFixture(postgres.connectionString); nativeProduct = await nativeProductFixture(postgres.connectionString);
    const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "tasks", tableId: 7,
      fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }],
      indexes: [{ name: "by_priority", field: "priority" }] })));
    const owned = work => Effect.runPromise(work.pipe(Effect.provideService(Scope.Scope, scope)));
    const payload = await owned(createPayloadHost(newsCollection(), candidate.persistence, "shop-a"));
    const product = await owned(createProductHost(candidate.persistence, "shop-a"));
    const mixed = await owned(createMixedHost(candidate.persistence, "shop-a", definition, applicationFunctions, newsCollection()));
    const application = await owned(createApplicationHost(definition, createApplicationStorage(referenceApp.persistence), "shop-a", applicationFunctions));
    const candidateApplication = await owned(createApplicationHost(definition, createApplicationStorage(candidate.persistence), "shop-a", applicationFunctions));
    await install(candidate, mixed.definitions); await install(referenceApp, [definition]);
    report.settings = { candidate: await settings(candidate), referenceApplication: await settings(referenceApp),
      nativePayload: await settings(nativePayload.database), nativeProduct: await settings(nativeProduct.database) };
    const user = await nativePayload.payload.create({ collection: "users", data: { email: "fixture@example.invalid", password: "disposable-fixture-password" }, overrideAccess: true });
    const requests = (collection, id) => ({ collection, id, depth: 0, overrideAccess: false });
    const warmups = mode === "smoke" ? 0 : 5; const pairs = mode === "smoke" ? 1 : mode === "sql" ? 2 : 30;
    report.warmups = warmups; report.pairs = pairs;
    const makeTrace = pool => {
      const trace = createMixedMutationPerformanceTrace({ controlPool: pool, targetPool: pool }); traces.push(trace); return trace;
    };
    let candidateTrace, referenceTrace, payloadTrace;
    if (mode === "sql") {
      candidateTrace = makeTrace(candidate.servingPool); referenceTrace = makeTrace(referenceApp.servingPool);
      assert.equal(nativePayload.pools.length, 1); payloadTrace = makeTrace(nativePayload.pools[0]);
    }
    async function prepare(workload, index) {
      const stem = `${mode}-${workload}-${index < 0 ? `warm${-index}` : index}`; const id = `prod_${randomUUID()}`;
      const data = { title: stem, handle: stem, status: "published" };
      if (workload !== "payload-crud") {
        await nativeProduct.product.createProducts({ id, title: "original", handle: id.replaceAll("_", "-") });
        await seed(candidate, [product.prepared.definition], [{ table: "product", body: await Effect.runPromise(product.prepared.seed(id, "original", "2026-10-27T00:00:00.000Z")) }]);
      }
      let old;
      if (workload !== "product") {
        old = await nativePayload.payload.create({ collection: "news-items", data: { headline: `old-${stem}` }, depth: 0, overrideAccess: false });
        const preferences = [];
        for (let index = 0; index < 2; index++) preferences.push(await nativePayload.payload.create({ collection: "payload-preferences", depth: 0,
          user: { ...user, collection: "users" },
          data: { key: `collection-news-items-${old.id}`, user: { relationTo: "users", value: user.id }, value: { index } }, overrideAccess: false }));
        assert.equal(preferences.length, 2);
        assert.notEqual(preferences[0].id, preferences[1].id);
        for (const preference of preferences) assert.deepEqual(preference.user, { relationTo: "users", value: user.id });
        await seed(candidate, [payload.definition, payload.preferenceDefinition], [{ table: payload.definition.table, body: old },
          ...preferences.map(preference => ({ table: payload.preferenceDefinition.table, body: preference }))]);
      }
      const productCall = async () => {
        const updated = await nativeProduct.product.updateProducts(id, data);
        const retrieved = await nativeProduct.product.retrieveProduct(id);
        const listed = await nativeProduct.product.listProducts({ handle: data.handle });
        return { updated, retrieved, listed };
      };
      const payloadCall = async () => {
        const created = await nativePayload.payload.create({ collection: "news-items", data: { headline: stem }, depth: 0, overrideAccess: false });
        const updated = await nativePayload.payload.update({ ...requests("news-items", created.id), data: { score: 7 } });
        const read = await nativePayload.payload.findByID(requests("news-items", created.id));
        const deleted = await nativePayload.payload.delete(requests("news-items", old.id));
        return { created, updated, read, deleted };
      };
      const candidatePayload = async () => {
        const created = await Effect.runPromise(payload.create(randomUUID(), { headline: stem }));
        const updated = await Effect.runPromise(payload.update(randomUUID(), created.id, { score: 7 }));
        const read = await Effect.runPromise(payload.read(created.id));
        const deleted = await Effect.runPromise(payload.delete(randomUUID(), old.id));
        return { created, updated, read, deleted };
      };
      const operations = workload === "product" ? { reference: productCall, candidate: () => Effect.runPromise(product.graph(randomUUID(), id, data)) }
        : workload === "payload-crud" ? { reference: payloadCall, candidate: candidatePayload }
          : { reference: async () => ({ application: (await Effect.runPromise(application.mutate("seed", randomUUID(), { name: stem, priority: 2 }))).value,
            product: await productCall(), payload: await payloadCall() }), candidate: () => Effect.runPromise(mixed.execute(randomUUID(), {
              application: { name: "seed", args: { name: stem, priority: 2 } }, product: { id, data },
              payload: { create: { headline: stem }, update: { score: 7 }, deleteId: old.id } })) };
      return { operations, async verify(results) {
        if (workload !== "payload-crud") {
          const left = workload === "product" ? results.reference : results.reference.product;
          const right = workload === "product" ? results.candidate : results.candidate.product;
          assert.deepEqual(Object.keys(left).toSorted(), ["updated", "retrieved", "listed"].toSorted());
          assert.deepEqual(Object.keys(right).toSorted(), Object.keys(left).toSorted());
          for (const field of ["updated", "retrieved"]) assert.deepEqual(productShape(right[field]), productShape(left[field]));
          assert.deepEqual(right.listed.map(productShape), left.listed.map(productShape));
          assert.equal(right.listed.length, 1); assert.equal(right.updated.handle, stem); assert.equal(right.retrieved.id, id);
          assert.deepEqual(await Effect.runPromise(product.retrieve(id)), right.retrieved);
        }
        if (workload !== "product") {
          const left = workload === "payload-crud" ? results.reference : results.reference.payload;
          const right = workload === "payload-crud" ? results.candidate : results.candidate.payload;
          for (const value of [left, right]) {
            assert.deepEqual(Object.keys(value).toSorted(), ["created", "updated", "read", "deleted"].toSorted());
            assert.deepEqual(payloadShape(value.created), { headline: stem, score: 0 });
            assert.deepEqual(payloadShape(value.updated), { headline: stem, score: 7 });
            assert.equal(value.created.id, value.updated.id); assert.deepEqual(value.read, value.updated); assert.deepEqual(value.deleted, old);
          }
          for (const field of ["created", "updated", "read", "deleted"]) assert.deepEqual(payloadShape(right[field]), payloadShape(left[field]));
          assert.deepEqual(await Effect.runPromise(payload.read(right.created.id)), right.updated);
          assert.deepEqual(await nativePayload.payload.findByID(requests("news-items", left.created.id)), left.updated);
          await assert.rejects(nativePayload.payload.findByID(requests("news-items", old.id)), { status: 404 });
          assert.deepEqual(await candidate.admin(db => db.select().from(tables.documents).where(and(eq(tables.documents.scope, "shop-a"), eq(tables.documents.id, old.id)))), []);
          assert.equal((await nativePayload.payload.find({ collection: "payload-preferences", depth: 0, overrideAccess: true,
            where: { key: { equals: `collection-news-items-${old.id}` } } })).totalDocs, 0);
          const remaining = await candidate.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, payload.preferenceDefinition.table)));
          assert.equal(remaining.some(row => row.body.key === `collection-news-items-${old.id}`), false);
        }
        if (workload === "mixed") for (const lane of ["reference", "candidate"]) {
          assert.deepEqual(Object.keys(results[lane]).toSorted(), ["application", "product", "payload"].toSorted());
          assert.match(results[lane].application, /^7:/);
          const host = lane === "reference" ? application : candidateApplication;
          const { value } = await Effect.runPromise(host.query("point", { id: results[lane].application }));
          assert.equal(value._id, results[lane].application); assert.equal(value.name, stem); assert.equal(value.priority, 2);
          assert.equal(typeof value._creationTime, "number"); assert.ok(Number.isFinite(value._creationTime));
        }
      } };
    }
    for (const phase of ["warmup", "measured"]) {
      if (phase === "measured") {
        report.source = { before: await sourceFingerprint() };
        const current = new Map(report.source.before.inventory.map(item => [item.path, item.sha256]));
        const changed = report.sourceAtStart.inventory.filter(item => current.get(item.path) !== item.sha256);
        assert.deepEqual(changed, [], "Executing input changed during preparation/warmup");
      }
      for (const workload of ["payload-crud", "product", "mixed"]) {
      for (let position = 0; position < (phase === "warmup" ? warmups : pairs); position++) {
        const index = phase === "warmup" ? position - warmups : position;
        const results = {}; const sample = { workload, phase, index, status: "preparing", lanes: {}, results };
        (phase === "warmup" ? report.warmupSamples : report.samples).push(sample);
        report.current = { phase, workload, index, stage: "prepare", lane: null };
        const prepared = await prepare(workload, index);
        const order = index % 2 === 0 ? ["reference", "candidate"] : ["candidate", "reference"];
        for (const lane of order) {
          report.current = { phase, workload, index, stage: "execute", lane }; sample.status = "executing";
          const run = prepared.operations[lane];
          const productQueries = []; const onQuery = query => productQueries.push(structuralSql(query.sql));
          if (mode === "sql" && lane === "reference") nativeProduct.knex.on("query", onQuery);
          const invoke = mode !== "sql" ? run : () => candidateTrace.withInvocation({ id: `${workload}-${index}-${lane}`, mode: "recon" },
            () => referenceTrace.withInvocation({ id: `${workload}-${index}-${lane}`, mode: "recon" },
              () => payloadTrace.withInvocation({ id: `${workload}-${index}-${lane}`, mode: "recon" }, run)));
          const poolsBefore = { candidate: poolState(candidate.servingPool), referenceApplication: poolState(referenceApp.servingPool),
            nativePayload: nativePayload.pools.map(poolState) };
          const cpu = mode === "cpu" ? { process: process.cpuUsage(), thread: process.threadCpuUsage() } : undefined;
          const started = performance.now();
          try { results[lane] = await invoke(); }
          finally {
            const elapsed = performance.now() - started;
            const usage = cpu === undefined ? undefined : { process: process.cpuUsage(cpu.process), thread: process.threadCpuUsage(cpu.thread) };
            nativeProduct.knex.removeListener("query", onQuery);
            sample.lanes[lane] = { elapsedMs: elapsed, ...(usage === undefined ? {} : { cpuMicroseconds: usage }),
              pools: { before: poolsBefore, after: { candidate: poolState(candidate.servingPool), referenceApplication: poolState(referenceApp.servingPool), nativePayload: nativePayload.pools.map(poolState) } },
              ...(mode !== "sql" ? {} : { candidate: candidateTrace.drainRecords(), referenceApplication: referenceTrace.drainRecords(), nativePayload: payloadTrace.drainRecords(), nativeProductKnex: productQueries }) };
          }
          const observation = sample.lanes[lane];
          for (const key of ["candidate", "referenceApplication"]) {
            assert.equal(observation.pools.after[key].held, 0); assert.equal(observation.pools.after[key].waiting, 0);
          }
          assert.deepEqual(observation.pools.after.nativePayload.map(({ held, waiting }) => ({ held, waiting })),
            poolsBefore.nativePayload.map(({ held, waiting }) => ({ held, waiting })), "Native Payload must return to its admitted bootstrap-checkout baseline");
          if (mode === "sql") {
            healthyObservation(observation.candidate, lane === "candidate");
            healthyObservation(observation.referenceApplication, lane === "reference" && workload === "mixed");
            healthyObservation(observation.nativePayload, lane === "reference" && workload !== "product");
            assert.equal(productQueries.length > 0, lane === "reference" && workload !== "payload-crud", "Native Product Knex coverage");
          }
          results[lane] = json(results[lane]);
        }
        report.current = { phase, workload, index, stage: "verify", lane: null };
        await prepared.verify(results); sample.status = "verified";
      }
      }
    }
    report.source.after = await sourceFingerprint(); report.stableSource = report.source.before.sha256 === report.source.after.sha256;
    report.summary = Object.fromEntries(["payload-crud", "product", "mixed"].map(workload => {
      const samples = report.samples.filter(sample => sample.workload === workload);
      return [workload, { diagnosticOnly: mode === "smoke" || mode === "sql",
        [mode === "sql" ? "observedReferenceMs" : "referenceMs"]: distribution(samples.map(sample => sample.lanes.reference.elapsedMs)),
        [mode === "sql" ? "observedCandidateMs" : "candidateMs"]: distribution(samples.map(sample => sample.lanes.candidate.elapsedMs)),
        ...(mode === "sql" ? {} : { pairedAddedMs: distribution(samples.map(sample => sample.lanes.candidate.elapsedMs - sample.lanes.reference.elapsedMs)) }),
        ...(mode !== "cpu" ? {} : { pairedAddedThreadCpuMs: distribution(samples.map(sample => {
          const cpu = sample.lanes.candidate.cpuMicroseconds.thread, reference = sample.lanes.reference.cpuMicroseconds.thread;
          return (cpu.user + cpu.system - reference.user - reference.system) / 1000;
        })) }) }];
    }));
    report.memory = { processResourceUsage: process.resourceUsage(), end: process.memoryUsage(), meaning: "Combined harness/native/candidate process; not per-lane peak memory" };
    report.unavailable = ["Equivalent native atomic mixed execution", "Active Flarex measurements", "Exclusive server CPU/time, WAL attribution and exact serialized-lock hold/wait",
      "Native Product pg checkouts/wire bytes (Knex submitted queries only in SQL mode)", "Per-owner allocations/canonicalization CPU; requires a separate profiler"];
    report.status = report.stableSource ? "complete-declared-profile" : "rejected-source-changed";
    assert.equal(report.stableSource, true, "Retain but reject changed-source measurement");
    console.log(JSON.stringify({ mode, summary: report.summary, stableSource: report.stableSource }));
  } catch (cause) {
    bodyFailure = cause; report.status = "failed-no-acceptance";
    report.failures.push({ stage: report.current ?? "preparing", evidence: failureEvidence(cause) });
    throw cause;
  } finally {
    const failures = [];
    for (const trace of traces) try { trace.close(); } catch (cause) { failures.push(cause); }
    try { await Effect.runPromise(Scope.close(scope, Exit.void)); } catch (cause) { failures.push(cause); }
    for (const resource of [nativeProduct, nativePayload, referenceApp, candidate, postgres]) if (resource !== undefined)
      try { await resource.close(); } catch (cause) { failures.push(cause); }
    report.cleanup = failures.length === 0 ? "complete" : "failed";
    if (failures.length) report.status = "failed-cleanup";
    if (report.source?.after === undefined) {
      report.source ??= { before: null };
      try { report.source.after = await sourceFingerprint(); }
      catch (cause) { report.failures.push({ stage: "failure-source-inventory", evidence: failureEvidence(cause) }); }
    }
    report.finishedAt = new Date().toISOString();
    report.failures.push(...failures.map(cause => ({ stage: "cleanup", evidence: failureEvidence(cause) })));
    let recordingFailure;
    try {
      await mkdir(directory, { recursive: true });
      // One inventory artifact per content digest avoids repeating tens of
      // thousands of unchanged file hashes in every lane/mode receipt.
      if (report.sourceAtStart?.inventory !== undefined) report.sourceAtStart = await writeSourceArtifact(directory, report.sourceAtStart);
      for (const phase of ["before", "after"]) if (report.source?.[phase]?.inventory !== undefined)
        report.source[phase] = await writeSourceArtifact(directory, report.source[phase]);
      await writeFile(`${directory}/connected-${mode}.json`, JSON.stringify(report, null, 2) + "\n");
    } catch (cause) { recordingFailure = cause; }
    if (failures.length || recordingFailure !== undefined) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]),
      ...failures, ...(recordingFailure === undefined ? [] : [recordingFailure])], "Measurement body/cleanup/recording failed", { cause: bodyFailure });
  }
}, 600_000);
