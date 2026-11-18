import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { bindCommerceRelationRows, type CommerceRelation } from "../src/query/relations";
import { populateCommerceRelations } from "../src/query/relations";
import { commerceDecoder } from "../src/value/decoder";
import { makeReadCatalog } from "../src/query/catalog";
import { compilePopulationWhere } from "../src/query/population";
import type { WherePolicy } from "../src/query/predicate";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";

const toOne = (name: string): CommerceRelation => ({ name, sourcePrimaryKeys: ["id"], targetTable: "people", targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: ["person_id"] } });
const catalog = Result.getOrThrow(makeReadCatalog([
  { name: "roots", columns: ["id", "person_id"], primaryKeys: ["id"], foreignKeys: ["person_id"], companions: {} },
  { name: "people", columns: ["id", "state", "deleted_at", "person_id"], primaryKeys: ["id"], foreignKeys: ["person_id"], companions: {} },
], new Map([
  ["roots", new Map([toOne("visible"), toOne("hidden"), toOne("unfiltered")].map(relation => [relation.name, relation]))],
  ["people", new Map([["nested", toOne("nested")]])],
])));
const policy: WherePolicy = {
  decode: commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile"),
  fields: new Map([["state", { column: "state", decode: commerceDecoder(Schema.Union([Schema.String, Schema.Null]), "invalidInput") }]]),
};
const policies = new Map(["visible", "hidden", "visible.nested"].map(path => [path, policy]));

describe("per-path population predicates", () => {
  it("compiles the native populateWhere shape with checked path and field ownership", () => {
    const filters = Result.getOrThrow(compilePopulationWhere(catalog, "roots", ["visible.nested"], { visible: { state: null } }, policies));
    expect(filters).toEqual([{ path: "visible", predicate: { kind: "and", children: [{ kind: "isNull", column: "state" }] } }]);
    expect(Object.isFrozen(filters)).toBe(true);
    expect(Object.isFrozen(filters[0]?.predicate)).toBe(true);
    for (const input of [null, [], { missing: {} }, { visible: { missing: null } }, { visible: { state: 1 } }]) {
      expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], input, policies))).toBe(true);
    }
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", [], { visible: {} }, policies))).toBe(true);
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["missing"], { missing: {} }, new Map([["missing", policy]])))).toBe(true);
    const invalid = { ...policy, fields: new Map([["state", { column: "missing", decode: commerceDecoder(Schema.String, "invalidInput") }]]) };
    expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], { visible: { state: "open" } }, new Map([["visible", invalid]])))).toBe(true);
    for (const mode of ["membership", "tuples"] as const) {
      const selectors = { mode, key: "missing", decode: commerceDecoder(Schema.Array(Schema.Struct({ missing: Schema.String })), "unsupportedProfile") };
      expect(Result.isFailure(compilePopulationWhere(catalog, "roots", ["visible"], { visible: { $or: [{ missing: "open" }] } }, new Map([["visible", { ...policy, selectors }]])))).toBe(true);
    }
  });

  it("does not reuse differently filtered primary-key rows and resolves nested filters at their full path", async () => {
    const paths = ["visible.nested", "hidden", "unfiltered"];
    const filters = Result.getOrThrow(compilePopulationWhere(catalog, "roots", paths,
      { visible: { state: "open" }, "visible.nested": { state: "nested" }, hidden: { state: "closed" } }, policies));
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason), { ...defaultCommerceResources, commandMs: 30000 }, {}, {}, "population", "read"));
    const queries: unknown[] = [];
    const returned: JsonObject[][] = [
      [{ id: "p", person_id: "n", state: "open" }], [{ id: "n", person_id: null, state: "nested" }], [], [{ id: "p", person_id: "n", state: "open" }],
    ];
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const ctx = { manager: lifetime.context, resources: defaultCommerceResources,
      table: () => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: () => Effect.fail(commerceError("unsupportedProfile")), aggregate: () => Effect.fail(commerceError("unsupportedProfile")), find: (manager: unknown, query: unknown) => Effect.sync(() => {
        expect(manager).toBe(lifetime.context); queries.push(query);
        const rows = returned.shift(); if (!rows) throw new Error("Unexpected population read"); return rows;
      }), count: unused, write: unused, delete: unused, lifecycle: unused }),
    };
    try {
      expect(await Effect.runPromise(populateCommerceRelations(bindCommerceRelationRows(ctx), "roots", [{ id: "r", person_id: "p" }], paths, catalog.relations, new Map(), false, filters)))
        .toEqual([{ id: "r", person_id: "p", visible: { id: "p", person_id: "n", state: "open", nested: { id: "n", person_id: null, state: "nested" } }, hidden: null, unfiltered: { id: "p", person_id: "n", state: "open" } }]);
      expect(queries).toHaveLength(4);
      for (const [index, value] of ["open", "nested", "closed"].entries()) expect(queries[index]).toMatchObject({ predicate: { children: [
        { kind: "in" }, { kind: "isNull", column: "deleted_at" }, { kind: "and", children: [{ kind: "in", column: "state", values: [value] }] },
      ] } });
      expect(queries[3]).toMatchObject({ predicate: { children: [{ kind: "in" }, { kind: "isNull", column: "deleted_at" }] } });
      expect(returned).toHaveLength(0);
    } finally { await Effect.runPromise(lifetime.close); }
  });
});

describe("relation reads of one population", () => {
  const key = ["id"];
  const child = (name: string, foreignKey: string): CommerceRelation => ({ name, sourcePrimaryKeys: key, targetTable: "children", targetPrimaryKeys: key, join: { type: "belongsTo", foreignKeys: [foreignKey] } });
  const kids: CommerceRelation = { name: "kids", sourcePrimaryKeys: key, targetTable: "children", targetPrimaryKeys: key, join: { type: "hasMany", foreignKeys: ["parent_id"] } };
  const relations = new Map([
    ["parents", new Map([["favorite", child("favorite", "favorite_id")], ["second", child("second", "second_id")], ["kids", kids]])],
    ["children", new Map([["peer", child("peer", "peer_id")], ["kids", kids]])],
  ]);
  const stored: JsonObject[] = [
    { id: "c1", parent_id: "r", peer_id: "c2", deleted_at: null }, { id: "c2", parent_id: "r", peer_id: null, deleted_at: null },
    { id: "c3", parent_id: "c1", peer_id: null, deleted_at: null },
  ];
  const decodeSelection = Schema.decodeUnknownSync(Schema.Struct({ predicate: Schema.Struct({ children: Schema.Tuple([
    Schema.Struct({ kind: Schema.Literal("in"), column: Schema.String, values: Schema.Array(Schema.String) }),
    Schema.Struct({ kind: Schema.Literal("isNull"), column: Schema.Literal("deleted_at") }),
  ]) }) }));
  /** The stored children one complete relation query selects. */
  const select = (query: unknown) => {
    const { column, values } = decodeSelection(query).predicate.children[0];
    return stored.filter(row => { const value = row[column]; return typeof value === "string" && values.includes(value); });
  };
  type Event = readonly ["announce", readonly unknown[]] | readonly ["find", string, unknown];
  const announcedQuery = (find: unknown) => typeof find === "object" && find !== null && "query" in find ? find.query : undefined;
  /** One bound reader over the stored children, with what its context was asked. */
  const reading = async <Value>(announces: boolean, defaults: { readonly includeIdentities: true } | undefined,
    use: (readRows: ReturnType<typeof bindCommerceRelationRows>) => Effect.Effect<Value, unknown>) => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason), { ...defaultCommerceResources, commandMs: 30000 }, {}, {}, "population-waves", "read"));
    const events: Event[] = [];
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const ctx = { manager: lifetime.context, resources: defaultCommerceResources,
      table: (name: string) => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: unused, aggregate: unused,
        find: (_manager: unknown, query: unknown) => Effect.sync(() => { events.push(["find", name, query]); return select(query); }),
        count: unused, write: unused, delete: unused, lifecycle: unused }),
      ...(announces ? { announce: (announcement: { readonly finds?: readonly unknown[] }) => Effect.sync(() => { events.push(["announce", announcement.finds ?? []]); }) } : {}),
    };
    try {
      return { rows: await Effect.runPromise(use(bindCommerceRelationRows(ctx, defaults))), events };
    } finally { await Effect.runPromise(lifetime.close); }
  };
  const populate = (roots: readonly JsonObject[], paths: readonly string[], announces: boolean, defaults?: { readonly includeIdentities: true }) =>
    reading(announces, defaults, readRows => populateCommerceRelations(readRows, "parents", roots, paths, relations, new Map()));
  const selections = (events: readonly Event[]) => events.flatMap(event => {
    if (event[0] !== "find") return [];
    const { column, values } = decodeSelection(event[2]).predicate.children[0];
    return [[column, values]];
  });

  it("announces one node's independent reads as exactly the queries those reads then issue, in unchanged order", async () => {
    const roots = [{ id: "r", favorite_id: "c1", second_id: null }], paths = ["favorite.peer", "kids"];
    for (const defaults of [undefined, { includeIdentities: true }] as const) {
      const hinted = await populate(roots, paths, true, defaults), plain = await populate(roots, paths, false, defaults);
      const [first, favorite, peer, children, ...rest] = hinted.events;
      if (first?.[0] !== "announce" || favorite?.[0] !== "find" || peer?.[0] !== "find" || children?.[0] !== "find") throw new Error("Unexpected population events");
      // The favorite's lone relation is read in place, between the two announced reads.
      expect(rest).toEqual([]);
      expect(first[1]).toEqual([{ tableName: favorite[1], query: favorite[2] }, { tableName: children[1], query: children[2] }]);
      // Each announced read issues the announced query object itself; the lone read builds its own.
      expect(announcedQuery(first[1][0])).toBe(favorite[2]);
      expect(announcedQuery(first[1][1])).toBe(children[2]);
      expect(favorite[2]).toEqual({ take: defaultCommerceResources.queryRows, order: { column: "id", direction: "asc" },
        predicate: { kind: "and", children: [{ kind: "in", column: "id", values: ["c1"] }, { kind: "isNull", column: "deleted_at" }] },
        ...(defaults === undefined ? {} : { includeIdentities: true }) });
      expect(selections(hinted.events)).toEqual([["id", ["c1"]], ["id", ["c2"]], ["parent_id", ["r"]]]);
      expect(plain.events).toEqual([favorite, peer, children]);
      expect(plain.rows).toEqual(hinted.rows);
      expect(hinted.rows).toEqual([{ id: "r", favorite_id: "c1", second_id: null, favorite: { ...stored[0], peer: stored[1] }, kids: [stored[0], stored[1]] }]);
    }
  });

  it("repeats an announced read that is still to come when a nested node announces its own", async () => {
    // The favorite's two relations are announced while the root's `kids` page is unused.
    const { events } = await populate([{ id: "r", favorite_id: "c1", second_id: null }], ["favorite.peer", "favorite.kids", "kids"], true);
    const [root, favorite, nested, peer, grandchildren, children, ...rest] = events;
    if (root?.[0] !== "announce" || favorite?.[0] !== "find" || nested?.[0] !== "announce" || peer?.[0] !== "find"
      || grandchildren?.[0] !== "find" || children?.[0] !== "find") throw new Error("Unexpected population events");
    expect(rest).toEqual([]);
    expect(root[1]).toEqual([{ tableName: favorite[1], query: favorite[2] }, { tableName: children[1], query: children[2] }]);
    expect(nested[1]).toEqual([{ tableName: peer[1], query: peer[2] }, { tableName: grandchildren[1], query: grandchildren[2] },
      { tableName: children[1], query: children[2] }]);
    // A read issues the query object of the announcement current at its turn.
    expect(announcedQuery(root[1][0])).toBe(favorite[2]);
    expect(nested[1].map(announcedQuery).map((query, position) => query === [peer[2], grandchildren[2], children[2]][position])).toEqual([true, true, true]);
    expect(announcedQuery(root[1][1])).not.toBe(children[2]);
  });

  it("issues an announced query object only to the read of the same table, predicate object and order without options of its own", async () => {
    const predicate = (): JsonObject => ({ kind: "and", children: [{ kind: "in", column: "id", values: ["c1"] }, { kind: "isNull", column: "deleted_at" }] });
    const named = predicate(), other = predicate();
    const { events } = await reading(true, undefined, readRows => Effect.gen(function* () {
      yield* readRows.announce?.([{ table: "children", predicate: named, order: "id" }, { table: "children", predicate: other, order: "peer_id" }]) ?? Effect.void;
      yield* readRows("children", named);
      yield* readRows("children", named, "id");
      yield* readRows("children", other, "peer_id");
      // An equal predicate in another object, another table, another order and a read with options.
      yield* readRows("children", predicate());
      yield* readRows("parents", named);
      yield* readRows("children", named, "peer_id");
      yield* readRows("children", named, "id", { includeIdentities: true });
    }));
    const [announcement, ...finds] = events;
    if (announcement?.[0] !== "announce") throw new Error("Unexpected population events");
    const [first, second] = announcement[1].map(announcedQuery);
    expect(finds.map(event => event[2] === first ? "first" : event[2] === second ? "second" : "own"))
      .toEqual(["first", "first", "second", "own", "own", "own", "own"]);
    // A read that builds its own query builds exactly what it always did.
    expect(finds[3]?.[2]).toEqual(first);
    expect(finds[5]?.[2]).toEqual(second);
    expect(finds[6]?.[2]).toEqual({ ...(typeof first === "object" ? first : {}), includeIdentities: true });
  });

  it("announces neither a read whose rows an earlier read already selected nor a lone read", async () => {
    // The children's peers are among the children already read, leaving one find to follow.
    const { rows, events } = await populate([{ id: "r", favorite_id: null, second_id: null }], ["kids.peer", "kids.kids"], true);
    expect(events.map(event => event[0])).toEqual(["find", "find"]);
    expect(selections(events)).toEqual([["parent_id", ["r"]], ["parent_id", ["c1", "c2"]]]);
    expect(rows).toEqual([{ id: "r", favorite_id: null, second_id: null, kids: [
      { ...stored[0], peer: stored[1], kids: [stored[2]] }, { ...stored[1], peer: null, kids: [] }] }]);
  });
});
