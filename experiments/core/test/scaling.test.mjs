import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Effect, Exit, Scope } from "effect";
import { it } from "vitest";
import { createApplicationHost } from "../src/application.ts";
import { createApplicationStorage } from "../src/application-storage.ts";
import { compileDefinition } from "../src/definition.ts";
import * as tables from "../src/schema.ts";
import { fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import { scalingFunctions } from "./scaling-corpus.ts";
import { seed, settings, install } from "./measurement-fixture.mjs";
import { sourceFingerprint } from "./measurement-source.mjs";
import { recordMeasurement } from "./measurement-report.mjs";
import { failureEvidence } from "./measurement-errors.mjs";
import { createMixedMutationPerformanceTrace } from "../../../packages/persistence-postgres/test/performance/mixedMutationPerformanceTrace.ts";

const directory = fileURLToPath(new URL("../validation/", import.meta.url));
const quantile = (values, fraction) => values.toSorted((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const distribution = values => ({ median: quantile(values, 0.5), p95: quantile(values, 0.95), maximum: Math.max(...values) });
const captured = async specification => Effect.runPromise(Effect.fromResult(compileDefinition(specification)));
const health = record => {
  assert.equal(record.aggregationComplete, true); assert.equal(record.outcome, "ok"); assert.ok(record.dispatches.length > 0);
  for (const key of ["observationErrors", "droppedObservations", "lostContextDispatches", "unobservedDispatches", "unknownStatementDispatches", "incompleteSpans"])
    assert.equal(record[key], 0, `Incomplete scaling observation: ${key}`);
  assert.equal(record.transactions.some(transaction => transaction.outcome === "open-at-end"), false);
};
const observation = record => {
  health(record);
  const { dispatches, checkouts, transactions, observerIntervals: _observers, ...groups } = record;
  return { ...groups, exchanges: dispatches.length, checkouts: checkouts.length, explicitTransactions: transactions.length,
    returnedRows: dispatches.reduce((sum, row) => sum + (row.returnedRowCount ?? 0), 0),
    decodedJsonBytes: dispatches.reduce((sum, row) => sum + (row.decodedResultJsonUtf8Bytes ?? 0), 0),
    transactionIntervals: transactions };
};

it.skipIf(process.env.FLAREX_EXPERIMENT_SCALE !== "1")("measures actual SDK batches and independent scope contention", async () => {
  const report = { status: "preparing", startedAt: new Date().toISOString(), batches: [], contention: [], failures: [],
    contract: "MEASUREMENT.md", sizes: [1, 16, 64], concurrency: [1, 4, 8], requestsPerCell: 128,
    target: { meaning: "diagnostic only, predeclared", concurrency: 4, successfulRequestsPerSecond: 100, p95Ms: 100, exhaustedAttempts: 0 },
    unavailable: ["Matched active/native Application baseline", "Exact server lock hold/wait and WAL", "Exclusive per-owner allocation/key-lowering CPU"],
    timing: "Batch latency and SQL observations are separate; contention uses no SQL observer" };
  report.retryProfile = "Automatic retries disabled; reported retries cover successful outcomes only; failed commands may refuse before an attempt";
  const scope = await Effect.runPromise(Scope.make()); let postgres, database, trace, bodyFailure;
  try {
    report.sourceAtStart = await sourceFingerprint();
    postgres = await startPostgres(); database = await fixture(postgres.connectionString); report.settings = await settings(database);
    report.poolMax = database.servingPool.options.max;
    const definition = await captured({ table: "tasks", tableId: 7,
      fields: [{ name: "name", kind: "text", unique: true }, { name: "priority", kind: "number", unique: false }, { name: "note", kind: "text", unique: false }],
      indexes: [{ name: "by_priority", field: "priority" }] });
    await install(database, [definition]);
    const host = async label => {
      const name = `scale-${label}-${randomUUID()}`;
      await database.admin(async db => {
        await db.insert(tables.authorities).values({ scope: name }); await db.insert(tables.clocks).values({ scope: name });
        await db.insert(tables.grants).values({ scope: name, principal: database.role });
      });
      return Effect.runPromise(createApplicationHost(definition, createApplicationStorage(database.persistence), name, scalingFunctions)
        .pipe(Effect.provideService(Scope.Scope, scope)));
    };
    const range = (application, lower, upper) => Effect.runPromise(application.query("range", { lower, upper })).then(result => result.value);
    const prepare = async (kind, size, position) => {
      const stem = `${kind}-${size}-${position}`; const application = await host(stem); let ids;
      if (kind === "indexed" || kind === "nonindexed") {
        await Effect.runPromise(application.mutate("batch", randomUUID(), { count: size, stem }));
        ids = (await range(application, 0, size)).map(row => row._id);
      }
      const request = randomUUID();
      return { request, run: () => Effect.runPromise(application.mutate(kind === "overlay" ? "overlay" : ids === undefined ? "batch" : "edit", request,
        ids === undefined ? { count: size, stem } : { ids, indexed: kind === "indexed", stem })),
      async verify(result) {
        assert.equal(result.attempts, 1);
        const rows = await range(application, 0, 2000); const expected = [];
        for (let index = 0; index < size; index++) {
          if (kind === "overlay" && index % 4 === 2) continue;
          expected.push({ name: kind === "overlay" && index % 4 === 1 ? `${stem}-edited-${index}` : `${stem}-${index}`,
            note: kind === "nonindexed" ? `${stem}-edited-${index}` : "original",
            priority: kind === "indexed" ? 1000 + index : kind === "overlay" && index % 4 === 0 ? size + index : index });
        }
        assert.deepEqual(rows.map(({ name, priority, note }) => ({ name, priority, note })).toSorted((a, b) => a.priority - b.priority), expected.toSorted((a, b) => a.priority - b.priority));
        for (const row of rows) {
          assert.deepEqual(Object.keys(row).toSorted(), ["_id", "_creationTime", "name", "priority", "note"].toSorted());
          assert.match(row._id, /^7:/); assert.ok(Number.isFinite(row._creationTime));
        }
        if (kind === "overlay") {
          assert.equal(result.value.ids.length, size);
          assert.deepEqual(result.value.rows, rows.filter(row => row.priority < size));
        } else assert.equal(result.value, ids === undefined ? size : null);
      } };
    };
    const warm = await host("engine-warm");
    const inserted = await Effect.runPromise(warm.mutate("overlay", randomUUID(), { count: 1, stem: "engine-warm" }));
    for (const indexed of [false, true]) await Effect.runPromise(warm.mutate("edit", randomUUID(), { ids: inserted.value.ids, indexed, stem: "engine-warm" }));
    await range(warm, 0, 2000);
    report.source = { before: await sourceFingerprint() };
    const warmSource = new Map(report.source.before.inventory.map(item => [item.path, item.sha256]));
    assert.deepEqual(report.sourceAtStart.inventory.filter(item => warmSource.get(item.path) !== item.sha256), []);
    // Separate quiet batch timings from the later observer installation.
    for (const kind of ["insert", "overlay", "indexed", "nonindexed"]) for (const size of report.sizes) {
      const cell = { kind, size, samples: [] }; report.batches.push(cell);
      for (let position = -5; position < 5; position++) {
        const sample = { position, status: "preparing" }; cell.samples.push(sample); report.current = { kind, size, position, stage: "prepare" };
        const prepared = await prepare(kind, size, position); sample.request = prepared.request; sample.status = "executing";
        report.current.stage = "execute"; const started = performance.now(); let result;
        try { result = await prepared.run(); } finally { sample.elapsedMs = performance.now() - started; }
        report.current.stage = "verify";
        await prepared.verify(result); sample.status = "verified";
      }
      cell.latencyMs = distribution(cell.samples.filter(sample => sample.position >= 0).map(sample => sample.elapsedMs));
    }
    for (const concurrency of report.concurrency) for (const distributionName of ["same", "different"]) {
      report.current = { stage: "contention", concurrency, distribution: distributionName };
      const cell = { concurrency, distribution: distributionName, samples: [] }; report.contention.push(cell);
      const hosts = await Promise.all(Array.from({ length: distributionName === "same" ? 1 : concurrency }, (_, index) => host(`load-${distributionName}-${concurrency}-${index}`)));
      for (let index = 0; index < 5; index++) for (const application of hosts)
        await Effect.runPromise(application.mutate("seed", randomUUID(), { name: `warm-${index}`, priority: -1 }));
      const started = performance.now();
      await Promise.all(Array.from({ length: concurrency }, async (_, worker) => {
        for (let index = worker; index < report.requestsPerCell; index += concurrency) {
          const sample = { index, request: randomUUID(), status: "executing" }; cell.samples.push(sample); const application = hosts[worker % hosts.length];
          const before = performance.now();
          const result = await Effect.runPromiseExit(application.mutate("seed", sample.request, { name: `request-${index}`, priority: index }));
          sample.elapsedMs = performance.now() - before;
          if (Exit.isSuccess(result)) { sample.status = "success"; sample.result = result.value; }
          else { sample.status = "failure"; sample.failure = failureEvidence(result.cause); }
        }
      }));
      cell.elapsedMs = performance.now() - started;
      const success = cell.samples.filter(sample => sample.status === "success");
      cell.successfulRequestsPerSecond = success.length * 1000 / cell.elapsedMs; cell.failed = cell.samples.length - success.length;
      cell.latencyMs = distribution(cell.samples.map(sample => sample.elapsedMs));
      cell.retries = success.reduce((sum, sample) => sum + sample.result.attempts - 1, 0);
      cell.targetMet = concurrency !== 4 ? null : cell.successfulRequestsPerSecond >= 100 && cell.latencyMs.p95 < 100 && cell.failed === 0;
      const rows = (await Promise.all(hosts.map(application => range(application, 0, report.requestsPerCell)))).flat();
      assert.equal(rows.length, success.length); assert.equal(new Set(rows.map(row => row._id)).size, success.length);
      for (const sample of success) {
        const row = rows.find(item => item._id === sample.result.value); assert.ok(row);
        assert.equal(row.name, `request-${sample.index}`); assert.equal(row.priority, sample.index); assert.equal(row.note, "original"); assert.ok(Number.isFinite(row._creationTime));
      }
      assert.equal(database.servingPool.totalCount, database.servingPool.idleCount); assert.equal(database.servingPool.waitingCount, 0);
    }
    trace = createMixedMutationPerformanceTrace({ controlPool: database.servingPool, targetPool: database.servingPool });
    for (const cell of report.batches) {
      const prepared = await prepare(cell.kind, cell.size, "sql");
      cell.sqlRecords = []; report.current = { kind: cell.kind, size: cell.size, request: prepared.request, stage: "sql" }; let result;
      try { result = await trace.withInvocation({ id: `${cell.kind}-${cell.size}`, mode: "recon" }, prepared.run); }
      finally { cell.sqlRecords.push(...trace.drainRecords()); }
      cell.sql = observation(cell.sqlRecords[0]); delete cell.sqlRecords; await prepared.verify(result);
    }
    report.unrelated = [];
    for (const count of [0, 64]) {
      report.current = { count, stage: "unrelated-setup" };
      if (count !== 0) {
        const extras = [];
        for (let index = 0; index < count; index++) extras.push(await captured({ table: `unrelated-${index}`, fields: [{ name: "value", kind: "number", unique: false }] }));
        await install(database, extras);
        await seed(database, [extras[0]], Array.from({ length: 256 }, (_, index) => ({ table: extras[0].table,
          body: { id: `unrelated-${index}`, value: index, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z" } })));
      }
      const prepared = await prepare("insert", 1, `unrelated-${count}`);
      const cell = { definitions: count, retainedUnrelatedRows: count === 0 ? 0 : 256, sqlRecords: [] }; report.unrelated.push(cell); let result;
      report.current = { count, request: prepared.request, stage: "unrelated-sql" };
      try { result = await trace.withInvocation({ id: `unrelated-${count}`, mode: "recon" }, prepared.run); }
      finally { cell.sqlRecords.push(...trace.drainRecords()); }
      cell.sql = observation(cell.sqlRecords[0]); delete cell.sqlRecords; await prepared.verify(result);
    }
    trace.close(); trace = undefined;
    report.source.after = await sourceFingerprint(); report.stableSource = report.source.before.sha256 === report.source.after.sha256;
    assert.equal(report.stableSource, true); report.status = "complete-diagnostic-profile";
    console.log(JSON.stringify({ batches: report.batches.map(({ kind, size, latencyMs, sql }) => ({ kind, size, latencyMs, exchanges: sql.exchanges })),
      contention: report.contention.map(({ concurrency, distribution, successfulRequestsPerSecond, latencyMs, failed, retries, targetMet }) => ({ concurrency, distribution, successfulRequestsPerSecond, latencyMs, failed, retries, targetMet })),
      unrelated: report.unrelated.map(({ definitions, retainedUnrelatedRows, sql }) => ({ definitions, retainedUnrelatedRows, exchanges: sql.exchanges })) }));
  } catch (cause) { bodyFailure = cause; report.status = "failed-no-assessment"; report.failures.push(failureEvidence(cause)); throw cause; }
  finally {
    const failures = [];
    try { trace?.close(); } catch (cause) { failures.push(cause); }
    try { await Effect.runPromise(Scope.close(scope, Exit.void)); } catch (cause) { failures.push(cause); }
    for (const resource of [database, postgres]) if (resource !== undefined) try { await resource.close(); } catch (cause) { failures.push(cause); }
    report.cleanup = failures.length ? "failed" : "complete"; report.finishedAt = new Date().toISOString();
    if (failures.length) report.status = "failed-cleanup";
    report.failures.push(...failures.map(cause => ({ stage: "cleanup", evidence: failureEvidence(cause) })));
    report.source ??= {};
    const sourceFailures = [];
    if (report.source.after === undefined) try { report.source.after = await sourceFingerprint(); }
    catch (cause) { sourceFailures.push(cause); report.status = "failed-source-evidence"; report.failures.push({ stage: "closing-source", evidence: failureEvidence(cause) }); }
    const recording = await recordMeasurement(directory, "scaling.json", report);
    if (failures.length || sourceFailures.length || recording.length) throw new AggregateError([...(bodyFailure === undefined ? [] : [bodyFailure]), ...failures,
      ...sourceFailures, ...recording], "Scaling body/cleanup/recording failed", { cause: bodyFailure });
  }
}, 600_000);
