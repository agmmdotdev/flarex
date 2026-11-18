import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import { Effect, Result, Schema, type Scope } from "effect";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { commerceDecoder } from "../src/value/decoder";
import type { CommerceRelation } from "../src/query/relations";
import { replaceGraphRows } from "../src/write/replace";
import type { GraphCatalog, GraphEntity, GraphTable, ReplacementProfile } from "../src/write/graph-model";

/** Generated identities are numbered in generation order, so equal results prove equal order. */
const generation = vi.hoisted(() => ({ count: 0 }));
vi.mock("@medusajs/framework/utils/portable", async original => ({
  ...await original<object>(),
  generateEntityId: (supplied?: string, prefix?: string) => supplied || prefix + "_" + ++generation.count,
}));

const entity = (name: string, model: string, keyColumn: string, fields: readonly string[], foreignKeys: GraphTable["foreignKeys"] = []): GraphEntity => ({
  model, keyColumn, prefix: model.toLowerCase(),
  table: { name, foreignKeys, columns: [keyColumn, ...fields].map(name => ({ name, type: "text", primaryKey: name === keyColumn, nullable: false, generated: false })) },
});
const shelf = entity("shelves", "Shelf", "code", []);
const volume = entity("volumes", "Volume", "isbn", ["title", "shelf_code"], [
  { name: "volume_shelf", columns: ["shelf_code"], referencedTable: "shelves", referencedColumns: ["code"], onDelete: "restrict" },
]);
const edition = entity("editions", "Edition", "serial", ["volume_isbn", "label"], [
  { name: "edition_owner", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"], onDelete: "cascade" },
]);
const label = entity("labels", "Label", "slug", ["name"]);
const pivot: GraphTable = { name: "volume_labels", columns: [], foreignKeys: [
  { name: "label_volume", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"], onDelete: "cascade" },
  { name: "label_target", columns: ["label_slug"], referencedTable: "labels", referencedColumns: ["slug"], onDelete: "cascade" },
] };
const decodeObject = commerceDecoder(Schema.JsonObject, "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject), "invalidInput");
const decodeSelection = commerceDecoder(Schema.Struct({ take: Schema.Number, order: Schema.JsonObject, predicate: Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String, values: Schema.Array(Schema.String) }) }), "invalidInput");
const optionalKey = (target: GraphEntity, supplied: JsonObject) => {
  const key = supplied[target.keyColumn];
  return typeof key === "string" ? key : undefined;
};
const catalog: GraphCatalog = {
  entities: [shelf, volume, edition, label], tables: [shelf.table, volume.table, edition.table, label.table, pivot], writablePivots: [pivot],
  queryRelations: new Map([["volumes", new Map<string, CommerceRelation>([
    ["editions", { name: "editions", sourcePrimaryKeys: ["isbn"], targetTable: "editions", targetPrimaryKeys: ["serial"], join: { type: "hasMany", foreignKeys: ["volume_isbn"] } }],
    ["labels", { name: "labels", sourcePrimaryKeys: ["isbn"], targetTable: "labels", targetPrimaryKeys: ["slug"], join: { type: "manyToMany", pivotTable: pivot.name, sourceColumns: ["volume_isbn"], targetColumns: ["label_slug"] } }],
  ])]]),
  decodeRow: (target, input) => Result.map(decodeObject(input), supplied => ({ supplied, key: optionalKey(target, supplied) })),
  decodeReference: (_target, input) => typeof input === "string" ? Result.succeed({ key: input }) : Result.fail(commerceError("invalidInput")),
  decodeAssociation: () => Result.fail(commerceError("unsupportedProfile")),
};
const profile: ReplacementProfile = {
  operation: "upsertWithReplace", ordering: new Map(), catalog, allowedRelations: () => ["editions", "labels"], ownedToOne: () => [], mutableForeignKeys: () => false,
  admitSelection: () => Result.succeed(undefined), prepareProjection: () => Effect.void,
  toManyMode: () => Result.succeed("replace"), validateLink: () => Effect.void,
  projectionPaths: (_entity, paths) => paths, project: rows => Result.succeed(rows),
};
const relations = { relations: ["editions", "labels"] };

interface Call { readonly operation: string; readonly input: unknown }
/** Scripted storage receipts exercise adapter planning on the real bounded request
 * lifetime. `announces` adds the hint a native context offers; it reads nothing here. */
const fixture = Effect.fn("ReplaceAnnouncementTest.fixture")(function* (snapshots: ReadonlyMap<string, readonly JsonObject[]>, announces: boolean) {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(
    reason => commerceError(reason), { calls: 64, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "replace-announcement-test", "write",
  ), lifetime => lifetime.close);
  const calls: Call[] = [];
  /** The very query objects announced and those the finds then received. */
  const sent: { readonly announced: unknown[]; readonly found: unknown[] } = { announced: [], found: [] };
  const unused =() => Effect.fail(commerceError("unsupportedProfile"));
  const ctx: Pick<CommerceCommandContext, "manager" | "resources" | "table" | "announce"> = {
    manager: lifetime.context, resources: defaultCommerceResources,
    table: table => lifetime.operation(lifetime.context, "replace-announcement-test", "read", Effect.sync(() => {
      const run = (manager: CommerceCommandContext["manager"], operation: string, input: unknown) => lifetime.operation(manager, "replace-announcement-test", operation === "find" ? "read" : "write", Effect.gen(function* () {
        calls.push({ operation: operation + ":" + table, input: structuredClone(input) });
        if (operation !== "find") return yield* Effect.fromResult(decodeRows(input));
        sent.found.push(input);
        // Only the selected rows return, as from storage: an unselected row is not yet known to the plan.
        const { predicate } = yield* Effect.fromResult(decodeSelection(input));
        return (snapshots.get(table) ?? []).filter(row => predicate.values.some(value => row[predicate.column] === value));
      }));
      return { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: unused, aggregate: unused, find: (manager, query) => run(manager, "find", query), count: unused, lifecycle: unused,
        write: (manager, mode, input) => run(manager, mode, input), delete: (manager, input) => run(manager, "delete", input) };
    })),
    ...(announces ? { announce: announcement => Effect.sync(() => {
      calls.push({ operation: "announce", input: structuredClone(announcement) });
      for (const find of announcement.finds ?? []) sent.announced.push(find.query);
    }) } : {}),
  };
  return { ctx, calls, sent };
});
const run = <A>(effect: Effect.Effect<A, CommerceTransactionError, Scope.Scope>) => Effect.runPromise(Effect.scoped(effect));
/** One replacement from a fresh identity counter, with every storage call it made. */
const replace = (snapshots: ReadonlyMap<string, readonly JsonObject[]>, input: Json, announces: boolean) => run(Effect.gen(function* () {
  generation.count = 0;
  const { ctx, calls, sent } = yield* fixture(snapshots, announces);
  const result = yield* replaceGraphRows(ctx, profile, volume, input, relations).pipe(Effect.result);
  return { result, calls, sent };
}));
const announcements = (calls: readonly Call[]) => calls.filter(call => call.operation === "announce").map(call => call.input);
const storage = (calls: readonly Call[]) => calls.filter(call => call.operation !== "announce");
const seeded = new Map<string, readonly JsonObject[]>([
  ["shelves", [{ code: "s1" }, { code: "s2" }]],
  ["volumes", [{ isbn: "a", title: "Old", shelf_code: "s1" }]],
  ["editions", [{ serial: "old", volume_isbn: "a", label: "Old" }]],
  ["labels", [{ slug: "featured", name: "Featured" }, { slug: "new", name: "New" }, { slug: "other", name: "Other" }]],
]);

describe("replacement announcements", () => {
  beforeEach(() => { generation.count = 0; });

  it("announces exactly the root selections and table inserts that follow, changing no storage call or result", async () => {
    const input = [
      { isbn: "a", title: "Changed", shelf_code: "s1", editions: [{ serial: "a-1", label: "First" }], labels: ["featured", "new"] },
      { isbn: "b", title: "Created", shelf_code: "s2", labels: ["other"] },
    ];
    const hinted = await replace(seeded, input, true), control = await replace(seeded, input, false);
    expect(Result.isSuccess(control.result)).toBe(true);
    expect(hinted.result).toEqual(control.result);
    expect(storage(hinted.calls)).toEqual(control.calls);
    expect(announcements(control.calls)).toEqual([]);

    const finds = control.calls.filter(call => call.operation.startsWith("find:"))
      .map(call => ({ tableName: call.operation.slice("find:".length), query: call.input }));
    const inserts = control.calls.filter(call => call.operation.startsWith("insert:"))
      .map(call => ({ tableName: call.operation.slice("insert:".length), rows: call.input }));
    expect(inserts.map(group => group.tableName)).toEqual(["volumes", "editions", "volume_labels"]);
    // Every root-level selection of both roots, each the very query its find then sends.
    const announcedFinds = [
      ["volumes", "isbn", "isbn", ["a"]], ["shelves", "code", "code", ["s1"]], ["editions", "serial", "volume_isbn", ["a"]],
      ["volume_labels", "volume_isbn", "volume_isbn", ["a"]], ["labels", "slug", "slug", ["featured", "new"]],
      ["volumes", "isbn", "isbn", ["b"]], ["shelves", "code", "code", ["s2"]], ["volume_labels", "volume_isbn", "volume_isbn", ["b"]], ["labels", "slug", "slug", ["other"]],
    ].map(([tableName, order, column, values]) => ({ tableName, query: { take: defaultCommerceResources.queryRows, order: { column: order, direction: "asc" }, predicate: { kind: "in", column, values } } }));
    expect(announcements(hinted.calls)).toEqual([{ finds: announcedFinds }, { inserts }]);
    for (const find of announcedFinds) expect(finds).toContainEqual(find);
    // Each find receives the announced query object itself, which is how the host
    // recognizes it: an equal object would be prepared a second time.
    expect(hinted.sent.announced).toHaveLength(announcedFinds.length);
    for (const query of hinted.sent.announced) expect(hinted.sent.found.filter(found => found === query)).toHaveLength(1);

    // The selections are announced before the first read; the inserts after the last delete, before the first insert.
    const order = hinted.calls.map(call => call.operation.split(":")[0]);
    expect(order.indexOf("announce")).toBeLessThan(order.indexOf("find"));
    expect(order.lastIndexOf("announce")).toBeGreaterThan(order.lastIndexOf("delete"));
    expect(order.lastIndexOf("announce")).toBe(order.indexOf("insert") - 1);
    expect(order.indexOf("delete")).toBeGreaterThan(-1);
  });

  it("keeps generated identities in their original order when an earlier root generates children", async () => {
    const input = [
      { title: "First", editions: [{ label: "x" }, { label: "y" }] },
      { title: "Second", editions: [{ label: "z" }] },
      { isbn: "keyed", title: "Third" },
    ];
    const hinted = await replace(new Map(), input, true), control = await replace(new Map(), input, false);
    expect(hinted.result).toEqual(control.result);
    expect(storage(hinted.calls)).toEqual(control.calls);
    expect(Result.getOrThrow(control.result).entities).toMatchObject([
      { isbn: "volume_1", editions: [{ serial: "edition_2" }, { serial: "edition_3" }] },
      { isbn: "volume_4", editions: [{ serial: "edition_5" }] },
      { isbn: "keyed" },
    ]);
    // Only the first root is identified ahead of its plan; the later roots keep their turn.
    expect(announcements(hinted.calls)[0]).toMatchObject({ finds: [
      { tableName: "volumes", query: { predicate: { values: ["volume_1"] } } }, { tableName: "editions", query: { predicate: { values: ["volume_1"] } } }] });
  });

  it("identifies every root ahead of the plan when none generates children, with the same identities", async () => {
    const input = [{ title: "First", labels: ["featured"] }, { title: "Second", labels: ["new"] }];
    const hinted = await replace(seeded, input, true), control = await replace(seeded, input, false);
    expect(hinted.result).toEqual(control.result);
    expect(storage(hinted.calls)).toEqual(control.calls);
    expect(Result.getOrThrow(control.result).entities).toMatchObject([{ isbn: "volume_1" }, { isbn: "volume_2" }]);
    expect(announcements(hinted.calls)[0]).toMatchObject({ finds: [
      { tableName: "volumes", query: { predicate: { values: ["volume_1"] } } }, { tableName: "volume_labels" }, { tableName: "labels" },
      { tableName: "volumes", query: { predicate: { values: ["volume_2"] } } }, { tableName: "volume_labels" }, { tableName: "labels" }] });
  });

  it.each([
    ["a later malformed root", [{ isbn: "b", title: "Created", labels: ["other"] }, "malformed"], "invalidInput"],
    ["a missing pivot target", [{ isbn: "b", title: "Created", labels: ["other", "absent"] }, { isbn: "c", title: "Never" }], "adapterFailure"],
    ["a duplicate pivot member", [{ isbn: "b", title: "Created", labels: ["other", "other", "new"] }], "invalidInput"],
  ] as const)("fails on %s at the same call with the same reason", async (_name, input, reason) => {
    const hinted = await replace(seeded, input, true), control = await replace(seeded, input, false);
    expect(control.result).toMatchObject({ _tag: "Failure", failure: { reason } });
    expect(hinted.result).toEqual(control.result);
    expect(storage(hinted.calls)).toEqual(control.calls);
    expect(control.calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
  });

  it("announces neither a lone selection nor a single table's insert", async () => {
    const hinted = await replace(new Map(), [{ isbn: "lone", title: "Lone" }], true);
    expect(Result.isSuccess(hinted.result)).toBe(true);
    expect(hinted.calls.map(call => call.operation)).toEqual(["find:volumes", "insert:volumes", "find:editions", "find:volume_labels"]);
  });
});
