import { compilePayloadLatencyCollections, preparePayloadLatencyBinding } from "./payloadLatencyFixture";
import { Clock, Effect, Exit, Scope, Schema, Tracer } from "effect";
import { expect, it } from "vitest";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";

const Nonnegative = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const decodeStats = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({
  calls: Nonnegative.check(Schema.isInt()), serverMs: Nonnegative,
})));
const decodeEnvironment = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({
  version: Schema.String, superuser: Schema.Boolean, bypass: Schema.Boolean, createDb: Schema.Boolean, createRole: Schema.Boolean,
  synchronousCommit: Schema.String, tracking: Schema.Literal("top"), utilityTracking: Schema.Literal("on"),
})));
interface Sample { operation: string; collected: boolean; ms: number; calls: number; serverMs: number; spans: Record<string, number> }
function summary(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("Missing benchmark samples");
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return { n: sorted.length, p50: percentile(0.5), p95: percentile(0.95) };
}
function documentId(value: Json) {
  if (!isJsonObject(value) || typeof value.id !== "string") throw new Error("Missing Payload document ID");
  return value.id;
}

it("summarizes nearest-rank latency quantiles without mutating observations", () => {
  const values = Array.from({ length: 20 }, (_, index) => 20 - index);
  expect(summary(values)).toEqual({ n: 20, p50: 10, p95: 19 });
  expect(values[0]).toBe(20);
  expect(summary([7])).toEqual({ n: 1, p50: 7, p95: 7 });
  expect(() => summary([])).toThrow("Missing benchmark samples");
});

it.skipIf(process.env.FLAREX_PAYLOAD_LATENCY !== "1")("measures the ordinary compiled Payload runtime without changing its owners", async () => {
  const resource = await createFileScopedPostgresFixture();
  const persistence = resource.persistence;
  const servingScope = await runEffect(Scope.make());
  const samples: Sample[] = [];
  try {
    const environment = await runEffect(Effect.promise(() => persistence.query(`select current_setting('server_version') as version,
      rolsuper as superuser, rolbypassrls as bypass, rolcreatedb as "createDb", rolcreaterole as "createRole",
      current_setting('synchronous_commit') as "synchronousCommit", current_setting('pg_stat_statements.track') as tracking,
      current_setting('pg_stat_statements.track_utility') as "utilityTracking" from pg_roles where rolname = current_user`))
      .pipe(Effect.flatMap(result => decodeEnvironment(result.rows))));
    expect(environment).toHaveLength(1);
    expect(environment[0]).toMatchObject({ superuser: false, bypass: false, createDb: false, createRole: false });
    const stats = Effect.promise(() => persistence.query(`select coalesce(sum(calls), 0)::float8 as calls,
      coalesce(sum(total_exec_time), 0)::float8 as "serverMs" from public.pg_stat_statements
      where userid = (select oid from pg_roles where rolname = current_user)
      and dbid = (select oid from pg_database where datname = current_database())
      and query not like '%pg_stat_statements%'`)).pipe(Effect.flatMap(result => decodeStats(result.rows)), Effect.map(rows => {
      const value = rows[0]; if (value === undefined) throw new Error("Missing SQL statistics"); return value;
    }));
    // This wrapper owns observations only; the supplied Effect retains its E/R and lifecycle.
    const measure = Effect.fn(function* <A, E, R>(operation: string, collected: boolean, effect: Effect.Effect<A, E, R>) {
      const spans: Tracer.NativeSpan[] = [];
      const tracer = Tracer.make({ span(options) { const span = new Tracer.NativeSpan(options); spans.push(span); return span; } });
      const before = yield* stats;
      const start = yield* Clock.monotonicTimeNanos;
      const value = yield* (collected ? effect.pipe(Effect.provideService(Tracer.Tracer, tracer)) : effect);
      const ms = Number((yield* Clock.monotonicTimeNanos) - start) / 1e6;
      const after = yield* stats;
      if (collected) {
        expect(spans.filter(span => span.name === "ApplicationRelationReadinessFold.validatePreparedInTransaction")).toHaveLength(1);
        expect(spans.filter(span => span.name === "InstallationRuntime.accept")).toHaveLength(1);
        expect(spans.filter(span => span.name === "InstallationRuntime.readEvidence")).toHaveLength(1);
        // The bound CMS host prepares its binding outside the measured request;
        // accepting catalog validation still resolves it afresh once per call.
        expect(spans.filter(span => span.name === "ApplicationRelationBinding.locateManifestBinding")).toHaveLength(1);
        expect(spans.filter(span => span.name === "PhysicalDefinitionLifecycle.validateReadinessCatalog")).toHaveLength(1);
        expect(spans.some(span => span.name === "DataBindingEvidence.lockInstallation")).toBe(false);
      }
      const durations: Record<string, number> = {};
      for (const span of spans) {
        if (span.status._tag !== "Ended") throw new Error(`Unclosed measurement span: ${span.name}`);
        durations[span.name] = (durations[span.name] ?? 0) + Number(span.status.endTime - span.status.startTime) / 1e6;
      }
      expect(after.calls).toBeGreaterThanOrEqual(before.calls);
      samples.push({ operation, collected, ms, calls: after.calls - before.calls, serverMs: after.serverMs - before.serverMs, spans: durations });
      return value;
    });
    const compiled = await runEffect(measure("compile", false, compilePayloadLatencyCollections()));
    const hostInput = await preparePayloadLatencyBinding(persistence, compiled, servingScope);
    for (let index = 0; index < 21; index++) await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* measure(index === 0 ? "first-instance" : "fresh-instance", false, makePayloadRuntime(compiled));
      yield* measure("bind", false, runtime.bind(hostInput));
    })));
    await runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePayloadRuntime(compiled);
      const host = yield* runtime.bind(hostInput);

      for (let index = 0; index < 8; index++) yield* host.create(host.newRequestKey(), { collection: "news-items", data: { headline: `seed-${index}` } });
      yield* host.create(host.newRequestKey(), { collection: "authors", data: { name: "Retained author" } });
      for (let index = -3; index < 20; index++) for (const collected of index % 2 === 0 ? [false, true] : [true, false]) {
        const sample = <A, E>(name: string, effect: Effect.Effect<A, E>) => index < 0 ? effect : measure(name, collected, effect);
        const input = { collection: "news-items", data: { headline: `sample-${index}-${collected ? "trace" : "plain"}` } };
        const key = host.newRequestKey();
        const created = yield* sample("create", host.create(key, input));
        const id = documentId(created);
        expect(yield* sample("findByID", host.findByID({ collection: "news-items", id }))).toEqual(created);
        expect(yield* sample("find", host.find({ collection: "news-items", limit: 4 }))).toMatchObject({ totalDocs: 9, docs: expect.any(Array) });
        expect(yield* sample("count", host.count({ collection: "news-items" }))).toEqual({ totalDocs: 9 });
        expect(yield* sample("update", host.update(host.newRequestKey(), { collection: "news-items", id, data: { score: 1 } })))
          .toMatchObject({ id, score: 1 });
        expect(yield* sample("replay", host.create(key, input))).toEqual(created);
        expect(documentId(yield* sample("delete", host.delete(host.newRequestKey(), { collection: "news-items", id })))).toBe(id);
      }
      expect(yield* host.count({ collection: "news-items" })).toEqual({ totalDocs: 8 });
      expect(yield* host.count({ collection: "authors" })).toEqual({ totalDocs: 1 });
    })));
    const groups = [...new Set(samples.map(sample => `${sample.operation}/${sample.collected}`))].map(key => {
      const group = samples.filter(sample => `${sample.operation}/${sample.collected}` === key);
      if (!["compile", "first-instance", "fresh-instance", "bind"].includes(group[0]?.operation ?? "")) {
        expect(group).toHaveLength(20);
        expect(group.every(sample => sample.calls > 0)).toBe(true);
        if (group[0]?.collected) expect(group.every(sample => sample.spans["CmsHost.execute"] !== undefined)).toBe(true);
      } else if (group[0]?.operation === "bind") expect(group.every(sample => sample.calls > 0)).toBe(true);
      else expect(group.every(sample => sample.calls === 0)).toBe(true);
      const names = [...new Set(group.flatMap(sample => Object.keys(sample.spans)))].filter(name =>
        /^(CmsAdmission\.|CmsCommit\.|ScopeClock\.lock|PayloadAdapter\.call|Application|AppUniqueConstraint|PhysicalDefinitionLifecycle\.|PointCommitTransaction\.loadUnique|ScopeAuthority|InstallationRuntime\.|DataBindingEvidence\.|PayloadPreferences\.)/.test(name));
      return { key, ms: summary(group.map(sample => sample.ms)), calls: summary(group.map(sample => sample.calls)),
        serverMs: summary(group.map(sample => sample.serverMs)), inclusiveSpans: Object.fromEntries(names.map(name =>
          [name, summary(group.map(sample => sample.spans[name] ?? 0))])) };
    });
    console.log("PAYLOAD_LATENCY " + JSON.stringify({ environment, node: process.version,
      method: "three warmup pairs; twenty alternating cohort pairs; nearest-rank quantiles; inclusive spans; live cardinality8/9; retained tombstones grow to46", groups }));
  } finally { await runEffect(Scope.close(servingScope, Exit.succeed(undefined))); await resource.dispose(); }
}, 240_000);
