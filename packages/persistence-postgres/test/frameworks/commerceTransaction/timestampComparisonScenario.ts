import { Effect, Result } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { logicalCommerceWorkingSetLimits } from "../../../src/frameworks/commerceTransaction/resources";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../../storage/relationalSchema/neutralLogicalFixture";
import { captureRelationalSchemaArtifact } from "../../../src/storage/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../../../src/storage/relationalSchema/physical/canonical";
import { registerLocalCommerceProfile } from "../../../src/frameworks/commerceTransaction/profile";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { commerceHostFixture } from "./commerceHostFixture";

const key = "medusa.neutral-timestamp-comparison";
const origin = { kind: "synthetic", sourceId: key };
const implicit = { kind: "implicit", sourceId: key + ".lifecycle" };
const boundary = "2026-10-23T00:00:00.000Z";
const past = "2026-10-22T23:59:59.999Z";
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: key,
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...["recorded_at", "unindexed_at"].map(columnId => ({ columnId, type: "timestamptz" as const,
      nullable: true, default: { kind: "none" as const }, origin })),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: implicit })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "entry.recorded", kind: "btree", columns: ["recorded_at"], predicate: null, origin },
    { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
  ], constraints: [], relationships: [] }], capabilities: [
    { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
      updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: implicit },
    { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: implicit },
  ] }));
const rows = [{ id: "a", recorded_at: past, unindexed_at: past }, { id: "b", recorded_at: boundary, unindexed_at: null },
  { id: "c", recorded_at: "2026-10-23T00:00:00.001Z", unindexed_at: null }, { id: "d", recorded_at: null, unindexed_at: null }];
const comparison = (kind = "lessThan", column = "recorded_at", value = boundary) => ({ kind, column, value } satisfies JsonObject);
const query = (predicate: JsonObject = comparison()): JsonObject => ({ fields: ["id"], order: { column: "id", direction: "asc" }, predicate });
const cases: Array<readonly [JsonObject, readonly string[]]> = [
  [comparison(), ["a"]], [comparison("greaterThan"), ["c"]],
  [comparison("lessThan", "recorded_at", past), []],
  [{ kind: "or", children: [comparison(), comparison("greaterThan")] }, ["a", "c"]],
  [{ kind: "and", children: [comparison(), { kind: "in", column: "id", values: ["b", "a"] }] }, ["a"]],
];
const invalid = [comparison("lessThan", "id"), comparison("lessThan", "missing"),
  comparison("lessThan", "recorded_at", "not-a-date"), { ...comparison(), extra: true }];

async function ordinaryRole(persistence: { query: (text: string) => Promise<{ rows: unknown[] }> }) {
  expect((await persistence.query("select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
    .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
}

export async function timestampComparisonScenario(driver: "pglite" | "postgres", finiteCapture = false) {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key, evidence: origin,
      definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "entry",
        table: { namespace: "medusa", logicalName: key + "/entry" } }] }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-timestamp", sources: [source],
      ...(finiteCapture ? { finiteCapture: true } : {}) });
    if (driver === "postgres") await ordinaryRole(fixture.persistence);
    const seed = defineCommerceCommand("timestampSeed", "write", ctx => Effect.gen(function* () {
      return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", rows)];
    }));
    const read = defineCommerceCommand("timestampRead", "read", (ctx, input) => Effect.gen(function* () {
      const program = (yield* ctx.table("entry")).prepareRead(input);
      return { rows: [...yield* program.find(ctx.manager)], count: yield* program.count(ctx.manager) };
    }));
    const overlay = defineCommerceCommand("timestampOverlay", "write", ctx => Effect.gen(function* () {
      const table = yield* ctx.table("entry");
      yield* table.write(ctx.manager, "update", [{ id: "c", recorded_at: past }]);
      const program = table.prepareRead(query());
      return { rows: [...yield* program.find(ctx.manager)], count: yield* program.count(ctx.manager) };
    }));
    const retained = defineCommerceCommand("timestampRetained", "read", ctx => Effect.gen(function* () {
      const predicate = comparison(), program = (yield* ctx.table("entry")).prepareRead(query(predicate));
      const selected = [...yield* program.find(ctx.manager)];
      predicate.value = past;
      return { rows: selected, count: yield* program.count(ctx.manager) };
    }));
    // Seed in independent bounded roots. The LT read must never consume these
    // irrelevant NULL identities, even when their total exceeds one read budget.
    const batchSize = 32;
    const nullSeeds = Array.from({ length: Math.ceil(logicalCommerceWorkingSetLimits.identities / batchSize) }, (_, batch) =>
      defineCommerceCommand(`timestampNullSeed${batch}`, "write", ctx => Effect.gen(function* () {
        return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert",
          Array.from({ length: batchSize }, (_, index) => ({ id: `null-${batch * batchSize + index}`, recorded_at: null, unindexed_at: null })))];
      })));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: key, writeProfile: key, schema, evidence: origin },
      initialization: { stepId: "timestamp-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, commands: [read],
      identityAndAccessPolicy: { profile: "neutral-timestamp" } }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("timestamps");
    const seedRoot = defineAtomicCommerceCommand("timestampSeedRoot", ctx => ctx.call(participant, seed, null));
    const readRoot = defineAtomicCommerceCommand("timestampReadRoot", (ctx, input) => ctx.call(participant, read, input));
    const overlayRoot = defineAtomicCommerceCommand("timestampOverlayRoot", ctx => ctx.call(participant, overlay, null));
    const retainedRoot = defineAtomicCommerceCommand("timestampRetainedRoot", ctx => ctx.call(participant, retained, null));
    const nullSeedRoots = nullSeeds.map((command, index) => defineAtomicCommerceCommand(`timestampNullSeedRoot${index}`, ctx => ctx.call(participant, command, null)));
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "neutral-timestamp" }, commands: [seedRoot, readRoot, overlayRoot, retainedRoot, ...nullSeedRoots],
      participants: [{ participant, logicalStorage, commands: [seed, read, overlay, retained, ...nullSeeds], validateLogicalCall: () => Effect.void }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), seedRoot, null);
      for (const [predicate, ids] of cases)
        expect(yield* host.run(host.newRequestKey(), readRoot, query(predicate))).toEqual({ rows: ids.map(id => ({ id })), count: ids.length });
      expect(yield* host.run(host.newRequestKey(), retainedRoot, null)).toEqual({ rows: [{ id: "a" }], count: 1 });
      expect(yield* host.run(host.newRequestKey(), readRoot, query({ kind: "and", children: [comparison(),
        { kind: "postgresText", column: "id", operator: "like", value: "a%" }] })))
        .toEqual({ rows: [{ id: "a" }], count: 1 });
      for (const predicate of [...invalid, comparison("lessThan", "unindexed_at")])
        expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, query(predicate))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      for (const command of nullSeedRoots) yield* host.run(host.newRequestKey(), command, null);
      expect(yield* host.run(host.newRequestKey(), readRoot, query())).toEqual({ rows: [{ id: "a" }], count: 1 });
      expect(yield* host.run(host.newRequestKey(), readRoot, query(comparison("lessThan", "recorded_at", past))))
        .toEqual({ rows: [], count: 0 });
      expect(yield* host.run(host.newRequestKey(), overlayRoot, null)).toEqual({ rows: [{ id: "a" }, { id: "c" }], count: 2 });
      expect(yield* host.run(host.newRequestKey(), readRoot, query())).toEqual({ rows: [{ id: "a" }, { id: "c" }], count: 2 });
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}

export async function timestampComparisonPhysicalScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const close = (release: () => Promise<void>) => cleanup.push(release);
    const resource = driver === "postgres" ? await (async () => {
      const resource = await createFileScopedPostgresFixture(); close(resource.dispose);
      return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
    })() : await createRelationalPGliteFixture({ registerCleanup: close });
    const control = driver === "postgres" ? resource.persistence : await createMigratedPGlitePersistence(close);
    const seed = defineCommerceCommand("physicalTimestampSeed", "write", ctx => ctx.store.write(ctx.manager, "insert", rows));
    const read = defineCommerceCommand("physicalTimestampRead", "read", (ctx, input) => Effect.gen(function* () {
      const program = ctx.store.prepareRead(input);
      return { rows: [...yield* program.find(ctx.manager)], count: yield* program.count(ctx.manager) };
    }));
    const fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn(function* (deploymentId, target) {
      const captured = yield* captureRelationalSchemaArtifact({ deploymentId, schema: relationalSchemaSourceFromDefinition(schema),
        provenance: { kind: "sourceSnapshot", repository: "https://example.com/neutral-timestamp", revision: "a".repeat(40), paths: ["entry.ts"] } });
      const layout = yield* captureRelationalPhysicalLayout({ artifact: captured.artifact, ...target });
      const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "neutral-timestamp",
        [{ tableId: "entry", keyId: "entry.primary", update: "existingPrimaryKey" }]);
      return { profile, initialization: { rows: undefined } };
    }), [seed, read], control, () => ({ capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: events => Effect.sync(() => { expect(events).toEqual([]); }), deliver: () => Effect.void }));
    close(() => Effect.runPromise(fixture.host.close));
    if (driver === "postgres") await ordinaryRole(fixture.persistence);
    await Effect.runPromise(fixture.host.run(fixture.host.newRequestKey(), seed, null));
    for (const [predicate, ids] of cases)
      expect(await Effect.runPromise(fixture.host.read(read, query(predicate)))).toEqual({ rows: ids.map(id => ({ id })), count: ids.length });
    // The physical profile resolves a declared column before checking its
    // operator. Missing column authority retains its existing profile refusal.
    for (const predicate of invalid)
      expect(await Effect.runPromise(Effect.result(fixture.host.read(read, query(predicate)))))
        .toMatchObject({ _tag: "Failure", failure: { reason: predicate.column === "missing" ? "unsupportedProfile" : "invalidInput" } });
  } finally { for (const close of cleanup.reverse()) await close(); }
}
