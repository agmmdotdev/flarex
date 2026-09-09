import { afterAll, beforeAll, expect, it } from "vitest";
import { fxSystemScopeClocks } from "../src/schema";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { sql } from "drizzle-orm";
import type { Json } from "../src/commerceValues";
import { Effect } from "effect";
import { defineCommerceCommand } from "../src/commerceTransaction/commands";
import { registerLocalCommerceProfile } from "../src/commerceTransaction/profile";
import { commerceError } from "../src/commerceTransaction/model";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { commerceHostFixture, type CommerceHostTestFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
const insert = defineCommerceCommand("plainInsert", "write", (context, rows) => context.store.write(context.manager, "insert", rows));
const find = defineCommerceCommand("plainFind", "read", (context, input) => context.store.find(context.manager, input));
const count = defineCommerceCommand("plainCount", "read", (context, input) => context.store.count(context.manager, input));
const update = defineCommerceCommand("plainUpdate", "write", (context, rows) => context.store.write(context.manager, "update", rows));
beforeAll(async () => {
  const native = process.env.FLAREX_TEST_DRIVER === "postgres";
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = native ? await (async () => {
    const resource = await createFileScopedPostgresFixture(); registerCleanup(resource.dispose);
    return { persistence: resource.persistence, session: makePostgresRelationalSession(resource.persistence) };
  })() : await createRelationalPGliteFixture({ registerCleanup });
  const control = native ? resource.persistence : await createMigratedPGlitePersistence(registerCleanup);
  fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn("PlainCommerceTest.prepare")(function* (deploymentId, target) {
    const origin = { kind: "authored", sourceId: "plain-row" };
    const artifact = yield* captureRelationalSchemaArtifact({ deploymentId,
      provenance: { kind: "sourceSnapshot", repository: "https://example.com/plain-row", revision: "a".repeat(40), paths: ["model.ts"] },
      schema: { owner: "medusa", lineageId: "plain-row", tables: [{ tableId: "plain", origin,
        columns: [
          { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
          { columnId: "value", type: "text", nullable: true, default: { kind: "none" }, origin },
          { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
        ], keys: [{ keyId: "plain.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] }], capabilities: [] },
    });
    const layout = yield* captureRelationalPhysicalLayout({ artifact: artifact.artifact, ...target });
    const profile = yield* registerLocalCommerceProfile(artifact.artifact, layout, "test.plain", [{ tableId: "plain", keyId: "plain.primary", update: "existingPrimaryKey" }]);
    return { profile, initialization: { rows: undefined } };
  }), [insert, update, find, count], control, () => ({
    capture: () => Effect.fail(commerceError("unsupportedProfile")),
    validate: events => events.length === 0 ? Effect.void : Effect.fail(commerceError("adapterFailure")),
    deliver: () => Effect.void,
  }));
}, 120000);
afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

it("preserves ordered exact rows across column groups and distinguishes key-only updates from mutations", async () => {
  const inserted = await runEffect(fixture.host.run(fixture.host.newRequestKey(), insert,
    [{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "first" }]));
  expect(inserted).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "first", amount: null }]);
  const before = await commerceInventory(fixture);
  const updated = await runEffect(fixture.host.run(fixture.host.newRequestKey(), update, [{ id: "b" }, { id: "a", value: "changed" }]));
  expect(updated).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }, { id: "a", value: "changed", amount: null }]);
  const after = await commerceInventory(fixture);
  expect(after.facts.slice(before.facts.length)).toMatchObject([{ operation: "update" }]);
  const noOp = await runEffect(fixture.host.run(fixture.host.newRequestKey(), update, [{ id: "b" }]));
  expect(noOp).toEqual([{ id: "b", value: "second", amount: "9007199254740993.01" }]);
  expect((await commerceInventory(fixture)).facts).toEqual(after.facts);
});

it("rejects missing or duplicate keys and rolls back successful earlier column groups", async () => {
  const before = await commerceInventory(fixture);
  for (const rows of [[{ id: "missing" }], [{ id: "a" }, { id: "a", value: "duplicate" }],
    [{ id: "a", value: "must roll back" }, { id: "missing", amount: "1" }]]) {
    expect(await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), update, rows))).toMatchObject({ reason: "invalidInput" });
    expect(await commerceInventory(fixture)).toEqual(before);
  }
  await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), insert, [{ id: "new", value: "must roll back" }, { id: "a", amount: "1" }]));
  expect(await commerceInventory(fixture)).toEqual(before);
});

it("matches the pinned SQLite text pattern contract before paging and counting", async () => {
  const vectors = [
    { value: "Test product", pattern: "%test%", match: true },
    { value: "\u00c6", pattern: "\u00e6", match: false },
    { value: "a\\b", pattern: "a\\b", match: true },
    { value: "abc", pattern: "a%c", match: true },
    { value: "a\nb", pattern: "a_b", match: true },
    { value: "a\u{1f600}b", pattern: "a_b", match: true },
    { value: "' OR true --", pattern: "' OR true --", match: true },
    { value: null, pattern: "%", match: false },
    { value: "", pattern: "%%", match: true },
    { value: "abc", pattern: "%missing%", match: false },
  ];
  for (const [index, vector] of vectors.entries()) {
    const id = "pattern-" + index;
    await runEffect(fixture.host.run(fixture.host.newRequestKey(), insert, [{ id, value: vector.value }]));
    const predicate = { kind: "and", children: [
      { kind: "in", column: "id", values: [id] },
      { kind: "textLikeAscii", column: "value", pattern: vector.pattern },
    ] };
    const query = { fields: ["id"], order: { column: "id", direction: "asc" }, predicate };
    expect(await runEffect(fixture.host.read(find, query))).toEqual(vector.match ? [{ id }] : []);
    expect(await runEffect(fixture.host.read(count, { ...query, skip: 1, take: 0 }))).toBe(vector.match ? 1 : 0);
  }
});

it("refuses malformed text predicates and charges shared operand node and depth limits", async () => {
  await runEffect(fixture.host.run(fixture.host.newRequestKey(), insert, [{ id: "operand-limit", value: "bounded" }]));
  const like = { kind: "textLikeAscii", column: "value", pattern: "%" };
  let deep: Json = like;
  for (let depth = 0; depth < 9; depth++) deep = { kind: "and", children: [deep] };
  const invalid: Json[] = [
    { ...like, column: "amount" }, { ...like, extra: true },
    { ...like, pattern: null }, { ...like, pattern: 1 }, { ...like, pattern: "\u0000" },
    { kind: "textLikeAscii", column: "value" },
  ];
  const limited: Json[] = [
    { ...like, pattern: "x".repeat(65_536) },
    { kind: "and", children: [like, { kind: "in", column: "id", values: Array.from({ length: 256 }, () => "operand-limit") }] },
    { kind: "or", children: Array.from({ length: 64 }, () => like) }, deep,
  ];
  const atOperandLimit = { order: { column: "id", direction: "asc" }, predicate: {
    kind: "and", children: [like, { kind: "in", column: "id", values: Array.from({ length: 255 }, () => "operand-limit") }],
  } };
  expect(await runEffect(fixture.host.read(count, atOperandLimit))).toBe(1);
  for (const [predicates, reason] of [
    [invalid, "invalidInput"], [limited, "limitExceeded"],
    [[{ ...like, column: "unknown" }], "unsupportedProfile"],
    // The outer canonical command boundary rejects malformed UTF-16 before
    // the store decoder can run; retain its existing authority refusal.
    [[{ ...like, pattern: "\ud800" }], "invalidAuthority"],
  ] as const) {
    for (const predicate of predicates) for (const command of [find, count]) {
      expect(await runEffectFailure(fixture.host.read(command, { order: { column: "id", direction: "asc" }, predicate }))).toMatchObject({ reason });
    }
  }
});

it("keeps colliding foreign-scope rows outside the text predicate", async () => {
  await runEffect(fixture.host.run(fixture.host.newRequestKey(), insert, [{ id: "collision", value: "owned" }]));
  const table = fixture.descriptor.layout.frame.tables[0];
  const id = table?.columns.find(column => column.identity.columnId === "id");
  const value = table?.columns.find(column => column.identity.columnId === "value");
  if (table === undefined || id === undefined || value === undefined) throw new Error("Missing plain table");
  const target = sql`${sql.identifier(fixture.descriptor.layout.frame.targetNamespace.schemaName)}.${sql.identifier(table.name)}`;
  const foreignScope = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
  if (clock === undefined) throw new Error("Missing fixture clock");
  await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({
    scopeId: ScopeIdSchema.make("scope_" + foreignScope), epoch: clock.epoch, storageGeneration: clock.storageGeneration,
  });
  await fixture.persistence.drizzle.execute(sql`insert into ${target} (scope_uuid, ${sql.identifier(id.name)}, ${sql.identifier(value.name)}) values (${foreignScope}::uuid, 'collision', 'foreign-pattern')`);
  const query = { order: { column: "id", direction: "asc" }, predicate: { kind: "textLikeAscii", column: "value", pattern: "%foreign-pattern%" } };
  expect(await runEffect(fixture.host.read(find, query))).toEqual([]);
  expect(await runEffect(fixture.host.read(count, query))).toBe(0);
});
