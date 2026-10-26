import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileDefinition, type Definition, type Document } from "../src/definition.ts";
import { createRoot, type Root } from "../src/root.ts";
import { createBudget } from "../src/budget.ts";
import { createGroupRoot } from "../src/group-root.ts";
import { createGroupStorage } from "../src/group-storage.ts";
import { historicalEqualityQuery } from "../src/equality-storage.ts";
import { textFingerprint } from "../src/equality-key.ts";
import type { Command } from "../src/persistence.ts";
import type { TextEquality } from "../src/query.ts";
import { fixture, type Fixture } from "./fixture.ts";
import { startPostgres } from "./postgres.ts";
import type { CoreError } from "../src/errors.ts";
import * as tables from "../src/schema.ts";

const selected = (keys: readonly string[] = ["wanted"]): TextEquality => ({ index: "by_key", field: "key", keys });
const row = (id: string, key: string | null, value: Schema.Json = null): Document => ({ id, key, value, createdAt: "t", updatedAt: "t" });
const failureOf = async <A, E>(effect: Effect.Effect<A, E>) => Result.match(await Effect.runPromise(Effect.result(effect)), {
  onSuccess: () => { throw new Error("Expected refusal"); }, onFailure: error => error,
});
const open = (database: Fixture, definition: Definition) => Effect.runPromise(Effect.gen(function* () {
  const command = yield* database.storage.open("shop-a", randomUUID(), "equality", definition, randomUUID());
  return { command, root: yield* createRoot(definition, database.storage, command) };
}));
const publish = (database: Fixture, command: Command, root: Root) => Effect.runPromise(Effect.gen(function* () {
  const frozen = yield* root.freeze();
  yield* database.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events, frozen.predicates);
  return frozen;
}));
const write = async (database: Fixture, definition: Definition, use: (root: Root) => Effect.Effect<unknown, CoreError>) => {
  const { command, root } = await open(database, definition);
  try { await Effect.runPromise(use(root)); return await publish(database, command, root); }
  finally { await Effect.runPromise(root.close); }
};
const planNodes = (value: Schema.Json): Record<string, Schema.Json>[] => {
  if (Array.isArray(value)) return value.flatMap(planNodes);
  if (value === null || typeof value !== "object") return [];
  const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(value);
  return [record, ...Object.values(record).flatMap(planNodes)];
};

describe.each(["pglite", "postgres"] as const)("bounded text equality (%s)", driver => {
  let postgres: Awaited<ReturnType<typeof startPostgres>> | undefined;
  beforeAll(async () => { if (driver === "postgres") postgres = await startPostgres(); });
  afterAll(async () => { if (postgres !== undefined) await postgres.close(); });
  const withRecords = async (use: (database: Fixture, definition: Definition) => Promise<void>) => {
    const database = await fixture(postgres?.connectionString);
    try {
      const definition = await Effect.runPromise(Effect.fromResult(compileDefinition({ table: "equality-records",
        fields: [{ name: "key", kind: "text", unique: false, nullable: true }, { name: "value", kind: "json", unique: false }],
        equalities: [{ name: "by_key", field: "key" }] })));
      await database.admin(db => db.insert(tables.definitions).values({ table: definition.table, version: definition.version,
        fields: definition.fields, equalities: definition.equalities }));
      await use(database, definition);
    } finally { await database.close(); }
  };

  it("projects matching identities without hydrating large values and publishes exact tombstones", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => root.insert(row("large", "wanted", "x".repeat(180000))));
    await write(database, definition, root => root.insert(row("second-user", "wanted")));
    await write(database, definition, root => root.insert(row("unrelated", "other")));
    const { command, root } = await open(database, definition);
    try {
      const before = database.persistence.metrics.operations;
      expect(await Effect.runPromise(root.equalIds(selected()))).toEqual(["large", "second-user"]);
      expect(await Effect.runPromise(root.deleteEqual(selected()))).toBe(2);
      expect(await Effect.runPromise(root.deleteEqual(selected()))).toBe(0);
      expect(await Effect.runPromise(root.get("large"))).toBeNull();
      expect(database.persistence.metrics.operations - before).toBe(1);
      expect(root.diagnostics().readBytes).toBeLessThan(4096);
      const frozen = await publish(database, command, root);
      expect(frozen.points).toEqual([expect.objectContaining({ id: "large", revision: 1, tombstone: false }),
        expect.objectContaining({ id: "second-user", revision: 2, tombstone: false })]);
      expect(frozen.changes).toEqual([{ id: "large", before: 1, body: null }, { id: "second-user", before: 2, body: null }]);
      expect(frozen.predicates).toHaveLength(1);
      expect(await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, definition.table))))
        .toEqual([expect.objectContaining({ id: "unrelated" })]);
      const intervals = await database.admin(db => db.select().from(tables.equalityVersions).where(eq(tables.equalityVersions.table, definition.table)));
      expect(intervals.filter(entry => entry.untilSeq === 4).map(entry => entry.id).toSorted()).toEqual(["large", "second-user"]);
    } finally { await Effect.runPromise(root.close); }
  }));

  it("merges indexed pending additions, removals and repeated edits without duplicate cleanup", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => Effect.gen(function* () {
      yield* root.insert(row("a", "wanted")); yield* root.insert(row("b", "other")); yield* root.insert(row("c", "wanted"));
    }));
    const { command, root } = await open(database, definition);
    try {
      expect(await Effect.runPromise(root.equalIds(selected()))).toEqual(["a", "c"]);
      await Effect.runPromise(Effect.gen(function* () {
        yield* root.replace(row("a", "other")); yield* root.replace(row("b", "wanted"));
        yield* root.replace(row("b", "other")); yield* root.replace(row("b", "wanted", { edited: true }));
        yield* root.delete("c"); yield* root.insert(row("d", "wanted")); yield* root.insert(row("null", null));
      }));
      expect(await Effect.runPromise(root.equalRows(selected(["wanted", "wanted"])))).toEqual([row("b", "wanted", { edited: true }), row("d", "wanted")]);
      expect(await Effect.runPromise(root.deleteEqual(selected()))).toBe(2);
      expect(await Effect.runPromise(root.equalRows(selected()))).toEqual([]);
      expect(await Effect.runPromise(root.deleteEqual(selected()))).toBe(0);
      await publish(database, command, root);
      const persisted = await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, definition.table)));
      expect(persisted.map(entry => entry.id).toSorted()).toEqual(["a", "null"]);
      expect(await database.admin(db => db.select().from(tables.history).where(and(eq(tables.history.table, definition.table), eq(tables.history.id, "d")))))
        .toEqual([]); // inserted then deleted is not a durable phantom/tombstone.
    } finally { await Effect.runPromise(root.close); }
  }));

  it("hydrates a projected predecessor only at the accepted revision", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => root.insert(row("a", "wanted", { original: true })));
    const first = await open(database, definition);
    try {
      expect(await Effect.runPromise(first.root.equalIds(selected()))).toEqual(["a"]);
      expect(await Effect.runPromise(first.root.get("a"))).toEqual(row("a", "wanted", { original: true }));
      expect((await Effect.runPromise(first.root.freeze())).points).toEqual([{ kind: "point", id: "a", revision: 1, tombstone: false }]);
    } finally { await Effect.runPromise(first.root.close); await Effect.runPromise(database.storage.abort(first.command)); }
    const second = await open(database, definition);
    try {
      await Effect.runPromise(second.root.equalIds(selected()));
      await write(database, definition, root => root.replace(row("a", "wanted", { newer: true })));
      expect(await failureOf(second.root.get("a"))).toMatchObject({ reason: "conflict" });
      expect(await failureOf(second.root.freeze())).toMatchObject({ reason: "conflict" });
    } finally { await Effect.runPromise(second.root.close); await Effect.runPromise(database.storage.abort(second.command)); }
  }));

  it.each(["insert", "enter", "leave", "delete"] as const)("rejects concurrent matching %s at direct acceptance", async change => withRecords(async (database, definition) => {
    await write(database, definition, root => Effect.gen(function* () {
      yield* root.insert(row("a", "wanted")); yield* root.insert(row("b", "other"));
    }));
    const { command, root } = await open(database, definition);
    try {
      // A negative result also records a real predicate, including insert races.
      const selection = selected(change === "insert" ? ["empty"] : undefined);
      expect(await Effect.runPromise(root.deleteEqual(selection))).toBe(change === "insert" ? 0 : 1);
      await write(database, definition, writer => change === "insert" ? writer.insert(row("new", "empty"))
        : change === "enter" ? writer.replace(row("b", "wanted")) : change === "leave" ? writer.replace(row("a", "other")) : writer.delete("a"));
      const frozen = await Effect.runPromise(root.freeze());
      expect(await failureOf(database.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events, frozen.predicates))).toMatchObject({ reason: "conflict" });
      expect(await database.admin(db => db.select().from(tables.commands).where(eq(tables.commands.id, command.id))))
        .toEqual([expect.objectContaining({ status: "active", result: null, commitSeq: null })]);
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
  }));

  it.each(["framework", "mixed"] as const)("checks empty equality predicates in %s groups while unrelated keys remain independent", async profile => withRecords(async (database, definition) => {
    const storage = createGroupStorage(database.persistence);
    const command = await Effect.runPromise((profile === "mixed" ? storage.openMixed : storage.openFramework)("shop-a", randomUUID(), "group-equality", [definition, database.definition], randomUUID()));
    const group = await Effect.runPromise(createGroupRoot(database.persistence, command, [definition, database.definition]));
    try {
      expect(await Effect.runPromise(group.withFramework(definition, root => root.deleteEqual(selected())))).toBe(0);
      await Effect.runPromise(group.withFramework(database.definition, root => root.insert({ id: "news", headline: "news", score: 0, createdAt: "t", updatedAt: "t" })));
      await write(database, definition, root => root.insert(row("unrelated", "other")));
      const frozen = await Effect.runPromise(group.freeze());
      await write(database, definition, root => root.insert(row("matching", "wanted")));
      expect(await failureOf(storage.accept(command, frozen, null))).toMatchObject({ reason: "conflict" });
      expect(await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, database.definition.table)))).toEqual([]);
    } finally { await Effect.runPromise(group.close); await Effect.runPromise(storage.abort(command)); }
    const next = await open(database, definition);
    try {
      expect(await Effect.runPromise(next.root.deleteEqual(selected()))).toBe(1);
      await write(database, definition, root => root.replace(row("unrelated", "still-other")));
      await publish(database, next.command, next.root);
    } finally { await Effect.runPromise(next.root.close); }
  }));

  it.each(["leave", "delete"] as const)("rejects an interval %s after read-only identity selection without write predecessors", async change => withRecords(async (database, definition) => {
    await write(database, definition, root => root.insert(row("a", "wanted")));
    const { command, root } = await open(database, definition);
    try {
      expect(await Effect.runPromise(root.equalIds(selected()))).toEqual(["a"]);
      await write(database, definition, writer => change === "leave" ? writer.replace(row("a", "other")) : writer.delete("a"));
      const frozen = await Effect.runPromise(root.freeze()); expect(frozen.changes).toEqual([]);
      expect(await failureOf(database.storage.settle(command, frozen.changes, frozen.dependencies, null, frozen.events, frozen.predicates))).toMatchObject({ reason: "conflict" });
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
  }));

  it("refuses malformed text and descriptor hazards before exact-key work", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => root.insert(row("replacement", "\uFFFD")));
    let getters = 0;
    const getter = { ...selected(), get keys() { getters++; return ["wanted"]; } };
    const prototype = selected(); Reflect.setPrototypeOf(prototype, { inherited: true });
    const cases = [selected(["\uD800"]), selected(["\uDC00"]), selected(["\u0000"]), getter, prototype, selected(["x".repeat(262145)])];
    for (const [index, selection] of cases.entries()) {
      const { command, root } = await open(database, definition);
      try {
        const before = database.persistence.metrics.operations;
        expect(await failureOf(root.deleteEqual(selection))).toMatchObject({ reason: index === cases.length - 1 ? "limit" : "invalid" });
        expect(database.persistence.metrics.operations).toBe(before);
        expect(await failureOf(root.freeze())).toMatchObject({ reason: index === cases.length - 1 ? "limit" : "invalid" });
      } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
    }
    expect(getters).toBe(0);
    const { command, root } = await open(database, definition);
    try {
      expect(await failureOf(root.insert(row("bad-pending", "\uD800")))).toMatchObject({ reason: "invalid" });
      expect(root.diagnostics().rows).toBe(0);
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
    const valid = await open(database, definition);
    try {
      await Effect.runPromise(valid.root.insert(row("valid-pending", "\uFFFD")));
      expect(await Effect.runPromise(valid.root.equalIds(selected(["\uFFFD"])))).toEqual(["replacement", "valid-pending"]);
    } finally { await Effect.runPromise(valid.root.close); await Effect.runPromise(database.storage.abort(valid.command)); }
    expect(await Effect.runPromise(database.storage.read("shop-a", definition, "replacement"))).toEqual(row("replacement", "\uFFFD"));
  }));

  it("disambiguates fingerprint collisions and supports text beyond btree entry size", async () => withRecords(async (database, definition) => {
    const long = "k".repeat(12000);
    await write(database, definition, root => Effect.gen(function* () {
      yield* root.insert(row("a", "wanted")); yield* root.insert(row("collision", "different")); yield* root.insert(row("long", long));
    }));
    // Model a theoretical fingerprint collision in physical test data. Full
    // text equality must still reject it; no production hash injection exists.
    await database.admin(db => db.update(tables.equalityVersions).set({ hash: textFingerprint("wanted") }).where(eq(tables.equalityVersions.id, "collision")));
    const { command, root } = await open(database, definition);
    try {
      expect(await Effect.runPromise(root.equalIds(selected()))).toEqual(["a"]);
      expect(await Effect.runPromise(root.equalRows(selected([long])))).toEqual([row("long", long)]);
      expect(await Effect.runPromise(root.deleteEqual(selected()))).toBe(1);
      await publish(database, command, root);
      expect(await Effect.runPromise(database.storage.read("shop-a", definition, "collision"))).toEqual(row("collision", "different"));
    } finally { await Effect.runPromise(root.close); }
  }));

  it("counts invisible historical candidates and poisons overflow instead of returning partial rows", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => root.insert(row("a", "wanted")));
    await write(database, definition, root => root.replace(row("a", "wanted", 1)));
    const command = await Effect.runPromise(database.storage.open("shop-a", randomUUID(), "bounded", definition, randomUUID()));
    const budget = createBudget(); expect(Result.isSuccess(budget.read(0, 255))).toBe(true);
    const root = await Effect.runPromise(createRoot(definition, database.storage, command, budget));
    try {
      expect(await failureOf(root.equalIds(selected()))).toMatchObject({ reason: "limit" });
      expect(await failureOf(root.freeze())).toMatchObject({ reason: "limit" });
      expect(await database.admin(db => db.select().from(tables.history).where(eq(tables.history.table, definition.table)))).toHaveLength(2);
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
  }));

  it("bounds combined original and pending membership before returning a projection", async () => withRecords(async (database, definition) => {
    await write(database, definition, root => Effect.gen(function* () {
      for (let index = 0; index < 255; index++) yield* root.insert(row(`original-${index}`, "wanted"));
    }));
    const { command, root } = await open(database, definition);
    try {
      await Effect.runPromise(root.insert(row("pending-1", "wanted"))); await Effect.runPromise(root.insert(row("pending-2", "wanted")));
      expect(await failureOf(root.equalIds(selected()))).toMatchObject({ reason: "limit" });
      expect(await failureOf(root.freeze())).toMatchObject({ reason: "limit" });
      expect(await database.admin(db => db.select().from(tables.documents).where(eq(tables.documents.table, definition.table)))).toHaveLength(255);
    } finally { await Effect.runPromise(root.close); await Effect.runPromise(database.storage.abort(command)); }
  }));

  it("fails closed for unknown required indexes and revoked authority before acquiring data", async () => withRecords(async (database, definition) => {
    const first = await open(database, definition);
    try { expect(await failureOf(first.root.equalIds({ ...selected(), index: "absent" }))).toMatchObject({ reason: "unsupported" }); }
    finally { await Effect.runPromise(first.root.close); await Effect.runPromise(database.storage.abort(first.command)); }
    const second = await open(database, definition);
    await database.admin(db => db.update(tables.authorities).set({ enabled: false }));
    try { expect(await failureOf(second.root.equalRows(selected()))).toMatchObject({ reason: "denied" }); }
    finally { await Effect.runPromise(second.root.close); await Effect.runPromise(database.storage.abort(second.command)); }
  }));

  it("uses the actual bounded identity projection plan without a history or body scan", async () => withRecords(async (database, definition) => {
    // Administrative scale fixture for plan evidence only. Behavioral tests
    // above maintain all history/index intervals through the accepting writer.
    await database.admin(async db => {
      for (let start = 0; start < 4096; start += 256) {
        const ids = Array.from({ length: 256 }, (_, offset) => `entry-${start + offset}`);
        const entries = ids.map((id, offset) => ({ id, key: (start + offset) % 64 === 0 ? "wanted" : `unrelated-${id}` }));
        await db.insert(tables.history).values(entries.map(({ id, key }) => ({ scope: "shop-a", table: definition.table, id, commitSeq: 1, body: row(id, key) })));
        await db.insert(tables.equalityVersions).values(entries.map(({ id, key }) => ({ scope: "shop-a", table: definition.table, index: "by_key", id,
          hash: textFingerprint(key), key, fromSeq: 1 })));
      }
      await db.execute(sql`analyze fx_core.equality_versions`);
    });
    const query = historicalEqualityQuery(database.serving, "shop-a", definition.table, 1, selected(), 12, 262144, "identities");
    const raw = await database.serving.execute(sql`explain (analyze, buffers, format json) ${query.getSQL()}`);
    const report = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.Array(Schema.Record(Schema.String, Schema.Json)) })) }))(raw);
    await mkdir(new URL("../.reports/", import.meta.url), { recursive: true });
    await writeFile(new URL(`../.reports/equality-plan-${driver}.json`, import.meta.url), JSON.stringify(report, null, 2) + "\n");
    const plan = planNodes(report.rows[0]?.["QUERY PLAN"] ?? []);
    expect(plan.some(node => node["Index Name"] === "equality_selection")).toBe(true);
    expect(plan.some(node => node["Relation Name"] === "history" || node["Relation Name"] === "documents")).toBe(false);
    const limit = plan.find(node => node["Node Type"] === "Limit"); expect(limit?.["Actual Rows"]).toBe(13);
    const frontier = planNodes(limit?.Plans ?? []);
    expect(frontier.some(node => node["Node Type"] === "Sort" || node["Node Type"] === "Incremental Sort")).toBe(false);
    expect(plan.filter(node => typeof node["Actual Rows"] === "number").every(node => Number(node["Actual Rows"]) <= 13)).toBe(true);
  }));
});
