import { describe, expect, it } from "vitest";
import { Effect, Option, Result, Schema } from "effect";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { commerceDecoder } from "../src/commerce-decoder";
import type { CommerceRelation } from "../src/commerce-relations";
import { makeReadCatalog, type ReadTable } from "../src/query/catalog";
import { compileWhere, selectorPredicate, type WherePolicy } from "../src/query/predicate";
import { compileProjection, projectRows, type ProjectionPolicy } from "../src/query/projection";
import { executeRead } from "../src/query/read";
import { currencyRepository } from "../src/currency-repository";
import { makeCommercePromiseOwner } from "../src/commerce-promise-owner";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";
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

describe("shared Medusa read compilation and execution", () => {
  it.each([false, true])("preserves Currency's call ceiling with count=%s", async withCount => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(
      reason => commerceError(reason), commerceLimits, {}, {}, "currency-budget", "read"));
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store: CommerceCommandContext["store"] = {
      find: manager => lifetime.operation(manager, "currency-budget", "read", Effect.succeed([{ code: "usd" }])),
      count: manager => lifetime.operation(manager, "currency-budget", "read", Effect.succeed(1)),
      write: unused, delete: unused, lifecycle: unused,
    };
    let acquisitions = 0;
    const ctx = makeCommerceCommandContext(lifetime, {
      store, resources: defaultCommerceResources,
      table: manager => lifetime.operation(manager, "currency-budget", "read", Effect.sync(() => { acquisitions++; return store; })),
    }, "currency-budget", lifetime.context, unused, unused);
    const owner = makeCommercePromiseOwner();
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
        table: (table: string) => Effect.succeed({
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
      expect(operations[2]?.query).toEqual(operations[1]?.query);
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
