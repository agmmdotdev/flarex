import { describe, expect, it, vi } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import { Effect, Option, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { commerceDecoder } from "../src/value/decoder";
import type { CommerceRelation, CommerceRelationReadContext } from "../src/query/relations";
import { resolveCommerceRelationFilter } from "../src/query/relation-filter";
import { makeReadCatalog, type ReadTable } from "../src/query/catalog";
import { compileWhere, selectorPredicate, type WherePolicy } from "../src/query/predicate";
import { compileProjection, projectRows, type ProjectionPolicy } from "../src/query/projection";
import { executeRead } from "../src/query/read";
import { currencyRepository } from "../src/modules/currency/repository";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";

const selected: ProjectionPolicy = {
  keys: "selected", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map(),
};
const retained: ProjectionPolicy = { ...selected, keys: "retain" };
const tables: ReadTable[] = [
  { name: "volumes", columns: ["isbn", "title", "editor_code", "amount", "raw_amount", "deleted_at"], primaryKeys: ["isbn"], foreignKeys: ["editor_code"], companions: { amount: "raw_amount" } },
  { name: "editors", columns: ["code", "name", "deleted_at"], primaryKeys: ["code"], foreignKeys: [], companions: {} },
  { name: "editions", columns: ["serial", "volume_isbn", "label", "deleted_at"], primaryKeys: ["serial"], foreignKeys: ["volume_isbn"], companions: {} },
  { name: "labels", columns: ["slug", "label", "deleted_at"], primaryKeys: ["slug"], foreignKeys: [], companions: {} },
  { name: "volume_labels", columns: ["volume_isbn", "label_slug"], primaryKeys: ["volume_isbn", "label_slug"], foreignKeys: ["volume_isbn", "label_slug"], companions: {} },
];
const relationships = new Map<string, ReadonlyMap<string, CommerceRelation>>([
  ["volumes", new Map<string, CommerceRelation>([
    ["editor", { name: "editor", sourcePrimaryKeys: ["isbn"], targetTable: "editors", targetPrimaryKeys: ["code"], join: { type: "belongsTo", foreignKeys: ["editor_code"] } }],
    ["editions", { name: "editions", sourcePrimaryKeys: ["isbn"], targetTable: "editions", targetPrimaryKeys: ["serial"], join: { type: "hasMany", foreignKeys: ["volume_isbn"] } }],
    ["labels", { name: "labels", sourcePrimaryKeys: ["isbn"], targetTable: "labels", targetPrimaryKeys: ["slug"], join: { type: "manyToMany", pivotTable: "volume_labels", sourceColumns: ["volume_isbn"], targetColumns: ["label_slug"] } }],
  ])],
]);
const profile: ProjectionPolicy = {
  ...selected, allowedPaths: ["editor", "editions", "labels"], selectableRelations: ["editor", "editions", "labels"],
  nested: new Map([["editor", retained], ["editions", retained], ["labels", retained]]), nullToOne: true,
};

/** Script owned store results without evaluating predicates, projection or
 * relation algorithms in the harness. The real read owner performs those. */
async function selectionFixture(responses: ReadonlyMap<string, readonly JsonObject[]>) {
  const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason),
    commerceLimits, {}, {}, "selection-admission", "read"));
  const operations: string[] = [];
  const queries: Array<{ table: string; query: unknown }> = [];
  const write = vi.fn(() => Effect.fail(commerceError("unsupportedProfile")));
  const ctx: CommerceRelationReadContext = { manager: lifetime.context, resources: defaultCommerceResources,
    table: table => Effect.sync(() => {
      const rows = responses.get(table);
      if (rows === undefined) throw new Error("Unexpected table acquisition: " + table);
      const store: CommerceCommandContext["store"] = {
        prepareRead(query) { operations.push("prepare:" + table); return mockRelationalRead(this, query); },
        find: (manager, query) => Effect.sync(() => { expect(manager).toBe(lifetime.context); operations.push("find:" + table); queries.push({ table, query }); return rows; }),
        findPage: (manager, query) => Effect.sync(() => { expect(manager).toBe(lifetime.context); operations.push("page:" + table); queries.push({ table, query }); return { rows, hasMore: false }; }),
        count: manager => Effect.sync(() => { expect(manager).toBe(lifetime.context); operations.push("count:" + table); return rows.length; }),
        aggregate: () => Effect.fail(commerceError("unsupportedProfile")), write, delete: write, lifecycle: write,
      };
      return store;
    }),
  };
  return { ctx, operations, queries, write, close: () => Effect.runPromise(lifetime.close) };
}

describe("shared Medusa read compilation and execution", () => {
  it("constrains a direct belongs-to root FK before paging/count without rescanning roots", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title"], [], profile));
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["editors", [{ code: "e1", name: "Selected editor", deleted_at: null }]],
      ["volumes", [{ isbn: "volume-with-distinct-key", title: "Volume", editor_code: "e1" }]],
    ]));
    const target = { kind: "and", children: [{ kind: "in", column: "code", values: ["e1"] }, { kind: "isNull", column: "deleted_at" }] };
    const seen: string[] = [];
    try {
      expect(await Effect.runPromise(executeRead({ ...fixture.ctx, admitSelection: (table, rows) => {
        seen.push(table); expect(rows.length).toBe(1); return Result.succeed(undefined);
      } }, catalog, { table: "volumes", projection, paths: [], ordering: new Map(), withDeleted: false,
        relationFilters: [{ path: "editor", predicate: target }],
        query: { skip: 2, take: 1, order: { column: "isbn", direction: "asc" }, predicate: { kind: "and", children: [] } },
        window: { kind: "database", countAt: "beforePopulation" },
      }, true))).toEqual({ rows: [{ title: "Volume" }], count: 1 });
      expect(seen).toEqual(["editors", "volumes"]);
      expect(fixture.operations).toEqual(["find:editors", "prepare:volumes", "find:volumes", "count:volumes"]);
      expect(fixture.queries).toEqual([
        { table: "editors", query: { take: defaultCommerceResources.queryRows, order: { column: "code", direction: "asc" }, predicate: target } },
        { table: "volumes", query: { skip: 2, take: 1, order: { column: "isbn", direction: "asc" },
          predicate: { kind: "and", children: [{ kind: "in", column: "editor_code", values: ["e1"] }] } } },
      ]);
      expect(fixture.write).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it.each(["missing", "deleted"])("keeps a %s belongs-to target's empty cohort as an empty source-FK predicate", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title"], [], profile));
    // The script supplies the owned store's exact active-target read result;
    // no predicate or soft-delete filtering is recreated by the harness.
    const fixture = await selectionFixture(new Map([ ["editors", []], ["volumes", []] ]));
    try {
      expect(await Effect.runPromise(executeRead(fixture.ctx, catalog, { table: "volumes", projection, paths: [], ordering: new Map(),
        withDeleted: false, relationFilters: [{ path: "editor", predicate: { kind: "and", children: [
          { kind: "in", column: "code", values: ["e-missing-or-deleted"] }, { kind: "isNull", column: "deleted_at" },
        ] } }], query: { take: 1, predicate: { kind: "and", children: [] } }, window: { kind: "page", countAt: "afterPopulation" },
      }, false))).toEqual({ rows: [], count: undefined });
      expect(fixture.operations).toEqual(["find:editors", "prepare:volumes", "page:volumes"]);
      expect(fixture.queries[1]).toMatchObject({ table: "volumes", query: { take: 1,
        predicate: { kind: "and", children: [{ kind: "in", column: "editor_code", values: [] }] } } });
    } finally { await fixture.close(); }
  });

  it("propagates belongs-to target admission refusal before any root execution", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title"], [], profile));
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["editors", [{ code: "e1", name: "Hidden target", deleted_at: null }]], ["volumes", []],
    ]));
    try {
      expect(await Effect.runPromise(Effect.result(executeRead({ ...fixture.ctx,
        admitSelection: (table, rows) => { expect(table).toBe("editors"); expect(rows[0]?.name).toBe("Hidden target"); return Result.fail(commerceError("unsupportedProfile")); },
      }, catalog, { table: "volumes", projection, paths: [], ordering: new Map(), withDeleted: false,
        relationFilters: [{ path: "editor", predicate: { kind: "in", column: "code", values: ["e1"] } }],
        query: { predicate: { kind: "and", children: [] } }, window: { kind: "database", countAt: "beforePopulation" },
      }, true)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(fixture.operations).toEqual(["find:editors"]); expect(fixture.write).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it.each([false, true])("reverses a nested has-many/belongs-to path with intermediate visibility=%s", async withDeleted => {
    const nested = new Map(relationships);
    nested.set("editions", new Map([["editor", { name: "editor", sourcePrimaryKeys: ["serial"], targetTable: "editors",
      targetPrimaryKeys: ["code"], join: { type: "belongsTo" as const, foreignKeys: ["editor_code"] } }]]));
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["editors", [{ code: "e1", deleted_at: null }]], ["editions", [{ serial: "s1", volume_isbn: "v1", editor_code: "e1" }]],
    ]));
    const admitted: string[] = [];
    try {
      expect(await Effect.runPromise(resolveCommerceRelationFilter({ ...fixture.ctx, admitSelection: table => {
        admitted.push(table); return Result.succeed(undefined);
      } }, "volumes", "editions.editor", { kind: "in", column: "code", values: ["e1"] }, nested, withDeleted)))
        .toEqual({ kind: "in", column: "isbn", values: ["v1"] });
      expect(fixture.operations).toEqual(["find:editors", "find:editions"]); expect(admitted).toEqual(["editors", "editions"]);
      expect(fixture.queries[1]).toEqual({ table: "editions", query: { take: defaultCommerceResources.queryRows,
        order: { column: "serial", direction: "asc" }, predicate: { kind: "and", children: [
          ...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }]), { kind: "in", column: "editor_code", values: ["e1"] },
        ] } } });
    } finally { await fixture.close(); }
  });

  it("reverses a belongs-to/belongs-to path through the actual intermediate FK", async () => {
    const nested = new Map(relationships);
    nested.set("editors", new Map([["edition", { name: "edition", sourcePrimaryKeys: ["code"], targetTable: "editions",
      targetPrimaryKeys: ["serial"], join: { type: "belongsTo" as const, foreignKeys: ["edition_serial"] } }]]));
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["editions", [{ serial: "s1", deleted_at: null }]], ["editors", [{ code: "e1", edition_serial: "s1" }]],
    ]));
    try {
      expect(await Effect.runPromise(resolveCommerceRelationFilter(fixture.ctx, "volumes", "editor.edition",
        { kind: "in", column: "serial", values: ["s1"] }, nested)))
        .toEqual({ kind: "in", column: "editor_code", values: ["e1"] });
      expect(fixture.operations).toEqual(["find:editions", "find:editors"]);
      expect(fixture.queries[1]).toMatchObject({ table: "editors", query: { predicate: { kind: "and", children: [
        { kind: "isNull", column: "deleted_at" }, { kind: "in", column: "edition_serial", values: ["s1"] },
      ] } } });
    } finally { await fixture.close(); }
  });

  it("refuses composite belongs-to metadata without acquiring a store", async () => {
    const fixture = await selectionFixture(new Map());
    const nested = new Map([["volumes", new Map<string, CommerceRelation>([["editor", { name: "editor", sourcePrimaryKeys: ["isbn"],
      targetTable: "editors", targetPrimaryKeys: ["code", "region"], join: { type: "belongsTo", foreignKeys: ["editor_code", "region"] } }]])]]);
    try {
      expect(await Effect.runPromise(Effect.result(resolveCommerceRelationFilter(fixture.ctx, "volumes", "editor",
        { kind: "and", children: [] }, nested))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(fixture.operations).toEqual([]);
    } finally { await fixture.close(); }
  });

  it.each(["database", "page"] as const)("admits root %s rows before projection, count or relation reads", async kind => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title", "labels.label"], ["labels"], profile));
    const raw = [{ isbn: "v1", title: "Volume", editor_code: "hidden-owner" }];
    const fixture = await selectionFixture(new Map([["volumes", raw]]));
    const admitSelection = vi.fn((table: string, rows: readonly JsonObject[]) => {
      expect(table).toBe("volumes"); expect(rows).toBe(raw);
      return Result.fail(commerceError("unsupportedProfile"));
    });
    try {
      expect(await Effect.runPromise(Effect.result(executeRead({ ...fixture.ctx, admitSelection }, catalog, {
        table: "volumes", projection, paths: ["labels"], ordering: new Map(), withDeleted: false, relationFilters: [],
        query: { predicate: { kind: "and", children: [] } }, window: { kind, countAt: "beforePopulation" },
      }, true)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(fixture.operations).toEqual(["prepare:volumes", (kind === "database" ? "find" : "page") + ":volumes"]);
      expect(admitSelection).toHaveBeenCalledTimes(1); expect(fixture.write).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it("admits the full catalog before an owning presentation callback can discard rows", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title"], [], profile));
    const raw = [{ isbn: "v1", title: "Visible" }, { isbn: "v2", title: "Would be hidden" }];
    const fixture = await selectionFixture(new Map([["volumes", raw]]));
    const select = vi.fn(() => ({ rows: [], count: 0 }));
    const admitSelection = vi.fn((_table: string, rows: readonly JsonObject[]) => {
      expect(rows).toBe(raw); return Result.fail(commerceError("unsupportedProfile"));
    });
    try {
      expect(await Effect.runPromise(Effect.result(executeRead({ ...fixture.ctx, admitSelection }, catalog, {
        table: "volumes", projection, paths: [], ordering: new Map(), withDeleted: false, relationFilters: [],
        query: { predicate: { kind: "and", children: [] } }, window: { kind: "catalog", order: "isbn", select },
      }, true)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(select).not.toHaveBeenCalled(); expect(fixture.operations).toEqual(["find:volumes"]);
    } finally { await fixture.close(); }
  });

  it("admits unprojected population pivots before loading or presenting their endpoints", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title", "labels.label"], ["labels"], profile));
    const pivots = [{ volume_isbn: "v1", label_slug: "one" }, { volume_isbn: "v1", label_slug: "two" }];
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["volumes", [{ isbn: "v1", title: "Volume" }]], ["volume_labels", pivots],
    ]));
    const seen: string[] = [];
    const admitSelection = (table: string, rows: readonly JsonObject[]) => {
      seen.push(table);
      if (table === "volume_labels") { expect(rows).toBe(pivots); return Result.fail(commerceError("unsupportedProfile")); }
      return Result.succeed(undefined);
    };
    try {
      expect(await Effect.runPromise(Effect.result(executeRead({ ...fixture.ctx, admitSelection }, catalog, {
        table: "volumes", projection, paths: ["labels"], ordering: new Map(), withDeleted: false, relationFilters: [],
        query: { predicate: { kind: "and", children: [] } }, window: { kind: "database", countAt: "afterPopulation" },
      }, true)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(seen).toEqual(["volumes", "volume_labels"]);
      expect(fixture.operations).toEqual(["prepare:volumes", "find:volumes", "find:volume_labels"]);
      expect(fixture.write).not.toHaveBeenCalled();
    } finally { await fixture.close(); }
  });

  it("applies admission to reverse relation-filter pivots before executing the root query", async () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title"], [], profile));
    const fixture = await selectionFixture(new Map<string, readonly JsonObject[]>([
      ["volumes", []], ["labels", [{ slug: "one", label: "One" }]],
      ["volume_labels", [{ volume_isbn: "v1", label_slug: "one" }, { volume_isbn: "v2", label_slug: "one" }]],
    ]));
    const seen: string[] = [];
    const admitSelection = (table: string) => { seen.push(table); return table === "volume_labels"
      ? Result.fail(commerceError("unsupportedProfile")) : Result.succeed(undefined); };
    try {
      expect(await Effect.runPromise(Effect.result(executeRead({ ...fixture.ctx, admitSelection }, catalog, {
        table: "volumes", projection, paths: [], ordering: new Map(), withDeleted: false,
        relationFilters: [{ path: "labels", predicate: { kind: "in", column: "slug", values: ["one"] } }],
        query: { predicate: { kind: "and", children: [] } }, window: { kind: "database", countAt: "afterPopulation" },
      }, false)))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(seen).toEqual(["labels", "volume_labels"]);
      expect(fixture.operations).toEqual(["find:labels", "find:volume_labels"]);
    } finally { await fixture.close(); }
  });

  it.each([false, true])("preserves Currency's call ceiling with count=%s", async withCount => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(
      reason => commerceError(reason), commerceLimits, {}, {}, "currency-budget", "read"));
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store: CommerceCommandContext["store"] = {
      prepareRead(query: unknown) { return mockRelationalRead(this, query); },
      findPage: manager => lifetime.operation(manager, "currency-budget", "read", Effect.succeed({ rows: [{ code: "usd" }], hasMore: false })),
      aggregate: unused,
      find: manager => lifetime.operation(manager, "currency-budget", "read", Effect.succeed([{ code: "usd" }])),
      count: manager => lifetime.operation(manager, "currency-budget", "read", Effect.succeed(1)),
      write: unused, delete: unused, lifecycle: unused,
    };
    let acquisitions = 0;
    const ctx = makeCommerceCommandContext(lifetime, {
      store, resources: defaultCommerceResources,
      table: manager => lifetime.operation(manager, "currency-budget", "read", Effect.sync(() => { acquisitions++; return store; })),
    }, "currency-budget", lifetime.context, unused, unused);
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const repository = currencyRepository(ctx, owner);
    const read = () => withCount
      ? repository.findAndCount({ where: {}, options: { fields: ["code"] } }, { manager: ctx.manager })
      : repository.find({ where: {}, options: { fields: ["code"] } }, { manager: ctx.manager });
    try {
      // The lifetime charges one call at entry; each find/count keeps its own call.
      for (let index = 0; index < Math.floor((commerceLimits.calls - 1) / (withCount ? 2 : 1)); index++) {
        expect(await read()).toEqual(withCount ? [[{ code: "usd" }], 1] : [{ code: "usd" }]);
      }
      expect(acquisitions).toBe(0);
      await expect(read()).rejects.toMatchObject({ reason: "limitExceeded" });
    } finally {
      await Effect.runPromise(owner.close.pipe(Effect.andThen(lifetime.close)));
    }
  });
  it("captures independent immutable catalogs, including relation and numeric metadata", async () => {
    const columns = ["key", "amount", "raw_amount"];
    const keys = ["key"];
    const foreignKeys = ["owner_key"];
    const companions = { amount: "raw_amount" };
    const relation: CommerceRelation = { name: "owner", sourcePrimaryKeys: keys, targetTable: "owners", targetPrimaryKeys: keys, join: { type: "belongsTo", foreignKeys } };
    const source = new Map([["records", new Map([["owner", relation]])]]);
    const first = Result.getOrThrow(makeReadCatalog([{ name: "records", columns, primaryKeys: keys, foreignKeys, companions }], source));
    const second = Result.getOrThrow(makeReadCatalog([{ name: "records", columns: ["other"], primaryKeys: ["other"], foreignKeys: [], companions: {} }], new Map()));
    columns.push("injected"); keys[0] = "changed"; foreignKeys[0] = "changed"; companions.amount = "changed"; source.clear();
    const [left, right] = await Promise.all([
      Effect.runPromise(Effect.fromResult(first.table("records"))),
      Effect.runPromise(Effect.fromResult(second.table("records"))),
    ]);
    expect(left.columns).toEqual(["key", "amount", "raw_amount"]);
    expect(left.primaryKeys).toEqual(["key"]);
    expect(left.companions).toEqual({ amount: "raw_amount" });
    expect(right.columns).toEqual(["other"]);
    const captured = Option.getOrThrow(first.relation("records", "owner"));
    expect(captured.join).toEqual({ type: "belongsTo", foreignKeys: ["owner_key"] });
    expect(Object.isFrozen(left.columns)).toBe(true);
    expect(Object.isFrozen(captured.join)).toBe(true);
    expect(Option.isNone(second.relation("records", "owner"))).toBe(true);
    expect(Result.isFailure(first.table("missing"))).toBe(true);
  });

  it("separates renamed storage keys from output fields and keeps numeric companions and null relations", () => {
    const catalog = Result.getOrThrow(makeReadCatalog(tables, relationships));
    const projection = Result.getOrThrow(compileProjection(catalog, "volumes", ["title", "amount", "editor.name"], ["editor"], profile));
    expect(projection.storageFields).toEqual(["title", "amount", "raw_amount", "isbn", "editor_code"]);
    expect(Result.getOrThrow(projectRows([{
      isbn: "v1", title: "Volume", amount: 4, raw_amount: { value: "4" }, editor_code: "e1",
      editor: { code: "e1", name: "Editor", deleted_at: null },
    }], projection.node))).toEqual([{ title: "Volume", amount: 4, raw_amount: { value: "4" }, editor: { name: "Editor", code: "e1" } }]);
    const absent = Result.getOrThrow(compileProjection(catalog, "volumes", ["editor_code"], [], profile));
    expect(Result.getOrThrow(projectRows([{ isbn: "v1", editor_code: null }], absent.node))).toEqual([{ editor_code: null, editor: null }]);
    expect(Result.isFailure(compileProjection(catalog, "volumes", ["editor.name"], [], profile))).toBe(true);
    expect(Result.isFailure(compileProjection(catalog, "volumes", undefined, ["unadmitted"], profile))).toBe(true);
  });

  it("resolves renamed relation filters before paging, counts independently, and uses one manager for all joins", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const catalog = yield* Effect.fromResult(makeReadCatalog(tables, relationships));
      const projection = yield* Effect.fromResult(compileProjection(catalog, "volumes",
        ["title", "editor.name", "editions.label", "labels.label"], ["editor", "editions", "labels"], profile));
      const lifetime = yield* makeBoundedRequestLifetime(() => commerceError("invalidAuthority"),
        { calls: 256, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "renamed-read", "read");
      const operations: Array<{ table: string; kind: string; query: unknown }> = [];
      const responses = new Map<string, JsonObject[][]>([
        ["editions", [[{ serial: "s1", volume_isbn: "v1", label: "First" }], [{ serial: "s1", volume_isbn: "v1", label: "First" }]]],
        ["volumes", [[{ isbn: "v1", title: "Volume", editor_code: "e1" }]]],
        ["editors", [[{ code: "e1", name: "Editor" }]]],
        ["volume_labels", [[{ volume_isbn: "v1", label_slug: "featured" }]]],
        ["labels", [[{ slug: "featured", label: "Featured" }]]],
      ]);
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const ctx = { manager: lifetime.context, resources: defaultCommerceResources,
        table: (table: string) => Effect.succeed({ prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: () => Effect.fail(commerceError("unsupportedProfile")), aggregate: () => Effect.fail(commerceError("unsupportedProfile")),
          find: (manager: unknown, query: unknown) => Effect.sync(() => {
            expect(manager).toBe(lifetime.context); operations.push({ table, kind: "find", query });
            const rows = responses.get(table)?.shift();
            if (rows === undefined) throw new Error("Unexpected read: " + table);
            return rows;
          }),
          count: (manager: unknown, query: unknown) => Effect.sync(() => {
            expect(manager).toBe(lifetime.context); operations.push({ table, kind: "count", query }); return 8;
          }),
          write: unused, delete: unused, lifecycle: unused,
        }),
      };
      const result = yield* executeRead(ctx, catalog, {
        table: "volumes", projection, paths: ["editor", "editions", "labels"], ordering: new Map(), withDeleted: false,
        relationFilters: [{ path: "editions", predicate: { kind: "in", column: "label", values: ["First"] } }],
        query: { predicate: { kind: "and", children: [] }, fields: projection.storageFields, skip: 2, take: 1, order: { column: "isbn", direction: "asc" } },
        window: { kind: "database", countAt: "beforePopulation" },
      }, true);
      expect(result).toEqual({ rows: [{ title: "Volume", editor: { name: "Editor", code: "e1" }, editions: [{ label: "First", serial: "s1" }], labels: [{ label: "Featured", slug: "featured" }] }], count: 8 });
      expect(operations.map(({ table, kind }) => [table, kind])).toEqual([
        ["editions", "find"], ["volumes", "find"], ["volumes", "count"], ["editors", "find"], ["editions", "find"], ["volume_labels", "find"], ["labels", "find"],
      ]);
      expect(operations[0]?.query).toMatchObject({ take: defaultCommerceResources.queryRows, order: { column: "serial" } });
      expect(operations[1]?.query).toMatchObject({ skip: 2, take: 1, predicate: { kind: "and", children: [{ kind: "in", column: "isbn", values: ["v1"] }] } });
      expect(operations[2]?.query).toBe(operations[1]?.query);
      expect(operations[3]?.query).toMatchObject({ order: { column: "code" } });
      expect(operations[6]?.query).toMatchObject({ order: { column: "slug" } });
    }));
  });

  it("preserves recursive budget precedence and selector tuple identity without entity-specific predicates", () => {
    const policy: WherePolicy = {
      decode: commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile"),
      fields: new Map([["external_code", { column: "code", decode: commerceDecoder(Schema.String, "invalidInput") }]]),
      logical: { nodes: 2, depth: 1, operands: 1, unwrapMembership: value => value,
        decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown), "unsupportedProfile") },
    };
    const good = Result.getOrThrow(compileWhere({ $and: [{ external_code: "eur" }] }, policy));
    expect(good).toEqual({ kind: "and", children: [{ kind: "and", children: [{ kind: "and", children: [{ kind: "in", column: "code", values: ["eur"] }] }] }] });
    if (good.kind !== "and") throw new Error("Expected conjunction");
    expect(Object.isFrozen(good.children[0])).toBe(true);
    const exhausted = compileWhere({ $and: [{ external_code: "eur" }, null] }, policy);
    expect(Result.isFailure(exhausted) && exhausted.failure.reason).toBe("limitExceeded");
    expect(selectorPredicate([{ left: "a", right: "1" }, { left: "b", right: "2" }])).toEqual({
      kind: "or", children: [
        { kind: "and", children: [{ kind: "in", column: "left", values: ["a"] }, { kind: "in", column: "right", values: ["1"] }] },
        { kind: "and", children: [{ kind: "in", column: "left", values: ["b"] }, { kind: "in", column: "right", values: ["2"] }] },
      ],
    });
  });
});
