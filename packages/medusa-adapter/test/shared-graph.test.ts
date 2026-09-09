import { describe, expect, expectTypeOf, it } from "vitest";
import type { PerformedActions } from "@medusajs/types";
import type { replaceProductRows } from "../src/product-mutation";
import { Effect, Result, Schema, type Scope } from "effect";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { commerceDecoder } from "../src/commerce-decoder";
import type { CommerceRelation } from "../src/commerce-relations";
import { captureGraph, insertGraphRows } from "../src/write/create";
import { replaceGraphRows } from "../src/write/replace";
import type { CreationProfile, GraphCatalog, GraphEntity, GraphTable, ReplacementProfile } from "../src/write/graph-model";

const entity = (name: string, model: string, keyColumn: string, fields: readonly string[], foreignKeys: GraphTable["foreignKeys"] = []): GraphEntity => ({
  model, keyColumn, prefix: undefined,
  table: { name, foreignKeys, columns: [keyColumn, ...fields].map(name => ({ name, type: "text", primaryKey: name === keyColumn, nullable: false, generated: false })) },
});
const volume = entity("volumes", "Volume", "isbn", ["title", "created_at"]);
const edition = entity("editions", "Edition", "serial", ["volume_isbn", "label"], [
  { name: "edition_owner", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"], onDelete: "cascade" },
]);
const label = entity("labels", "Label", "slug", ["name"]);
const pivot: GraphTable = {
  name: "volume_labels", columns: [], foreignKeys: [
    { name: "label_volume", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"], onDelete: "cascade" },
    { name: "label_target", columns: ["label_slug"], referencedTable: "labels", referencedColumns: ["slug"], onDelete: "cascade" },
  ],
};
const references: GraphTable = { name: "volume_references", columns: [], foreignKeys: [
  { name: "reference_volume", columns: ["volume_isbn"], referencedTable: "volumes", referencedColumns: ["isbn"], onDelete: "cascade" },
  { name: "reference_edition", columns: ["edition_serial"], referencedTable: "editions", referencedColumns: ["serial"], onDelete: "cascade" },
] };
const decodeObject = commerceDecoder(Schema.JsonObject, "invalidInput");
const decodeString = commerceDecoder(Schema.String, "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject), "invalidInput");
const catalog: GraphCatalog = {
  entities: [volume, edition, label], tables: [volume.table, edition.table, label.table, pivot, references], writablePivots: [pivot, references],
  queryRelations: new Map([["volumes", new Map<string, CommerceRelation>([
    ["editions", { name: "editions", sourcePrimaryKeys: ["isbn"], targetTable: "editions", targetPrimaryKeys: ["serial"], join: { type: "hasMany", foreignKeys: ["volume_isbn"] } }],
    ["labels", { name: "labels", sourcePrimaryKeys: ["isbn"], targetTable: "labels", targetPrimaryKeys: ["slug"], join: { type: "manyToMany", pivotTable: pivot.name, sourceColumns: ["volume_isbn"], targetColumns: ["label_slug"] } }],
  ])]]),
  decodeRow: (entity, input) => Result.flatMap(decodeObject(input), supplied => Result.map(decodeString(supplied[entity.keyColumn]), key => ({ supplied, key }))),
  decodeReference: (entity, input) => typeof input === "string" ? Result.succeed({ key: input })
    : Result.flatMap(decodeObject(input), supplied => Result.map(decodeString(supplied[entity.keyColumn]), key => ({ supplied, key }))),
  decodeAssociation: (entity, input) => Result.flatMap(decodeObject(input), supplied => decodeString(supplied[entity.keyColumn])),
};
const replacement: ReplacementProfile = {
  catalog, allowedRelations: () => ["editions", "labels"], ownedToOne: () => [], mutableForeignKeys: () => false,
  toManyMode: () => Result.succeed("replace"), validateLink: () => Effect.void,
  projectionPaths: (_entity, paths) => paths, project: rows => Result.succeed(rows),
};
const creation: CreationProfile = {
  catalog, rowLimitDetail: (maximum, attempted, tables) => ({ maximum, attempted, tables }),
  root: { entity: volume, omitRelations: ["editions", "references", "labels"], steps: [
    { kind: "children", name: "editions", foreignKey: "volume_isbn", node: { entity: edition, omitRelations: [], steps: [] } },
    { kind: "references", name: "references", target: edition, membership: "declaredSnapshot",
      decode: input => catalog.decodeReference(edition, input),
      resolve: () => Result.succeed({ table: references.name, link: (parent, reference) => ({ volume_isbn: parent, edition_serial: reference }) }) },
    { kind: "references", name: "labels", target: label, membership: "external",
      decode: input => catalog.decodeReference(label, input),
      resolve: () => Result.succeed({ table: pivot.name, link: (parent, reference) => ({ volume_isbn: parent, label_slug: reference }) }) },
  ] },
};

/** Scripted storage receipts exercise adapter planning without implementing a
 * second database. All calls use the real bounded request lifetime. */
const fixture = Effect.fn("GraphTest.fixture")(function* (
  snapshots: ReadonlyMap<string, readonly JsonObject[]>, responses: ReadonlyMap<string, readonly JsonObject[]> = new Map(),
  failure?: { readonly operation: string; readonly error: CommerceTransactionError },
) {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(
    reason => commerceError(reason), { calls: 64, commandBytes: 1_048_576, commandMs: 30_000 }, {}, {}, "graph-test", "write",
  ), lifetime => lifetime.close);
  const calls: { readonly operation: string; readonly input: unknown }[] = [];
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const ctx: Pick<CommerceCommandContext, "manager" | "resources" | "table"> = {
    manager: lifetime.context, resources: defaultCommerceResources,
    table: table => lifetime.operation(lifetime.context, "graph-test", "read", Effect.sync(() => {
      calls.push({ operation: "table:" + table, input: undefined });
      const run = (manager: CommerceCommandContext["manager"], operation: string, input: unknown) => lifetime.operation(manager, "graph-test", operation === "find" ? "read" : "write", Effect.gen(function* () {
        expect(manager).toBe(lifetime.context);
        const name = operation + ":" + table;
        calls.push({ operation: name, input });
        if (name === failure?.operation) return yield* Effect.fail(failure.error);
        if (operation === "find") return snapshots.get(table) ?? [];
        const receipt = responses.get(name);
        if (receipt !== undefined) return receipt;
        return yield* Effect.fromResult(decodeRows(input));
      }));
      return { find: (manager, query) => run(manager, "find", query), count: unused, lifecycle: unused,
        write: (manager, mode, input) => run(manager, mode, input), delete: (manager, input) => run(manager, "delete", input) };
    })),
  };
  return { ctx, calls };
});
const run = <A>(effect: Effect.Effect<A, CommerceTransactionError, Scope.Scope>) => Effect.runPromise(Effect.scoped(effect));
const seeded = new Map<string, readonly JsonObject[]>([
  ["volumes", [{ isbn: "v1", title: "Old" }, { isbn: "v2", title: "Other" }]],
  ["editions", [{ serial: "old", volume_isbn: "v1", label: "Old" }]],
  ["labels", [{ slug: "featured", name: "Featured" }]],
  [pivot.name, [{ volume_isbn: "v1", label_slug: "featured" }]],
  [references.name, [{ volume_isbn: "v1", edition_serial: "old" }]],
]);

describe("shared graph planning over renamed module keys", () => {
  it("keeps arbitrary action keys distinct from Product's checked Medusa id contract", () => {
    expectTypeOf<Effect.Success<ReturnType<typeof replaceGraphRows>>["performedActions"]>().not.toMatchTypeOf<PerformedActions>();
    expectTypeOf<Effect.Success<ReturnType<typeof replaceProductRows>>["performedActions"]>().toEqualTypeOf<PerformedActions>();
  });
  it("captures ordered child and reference rows and inserts only nonempty tables using actual receipts", async () => {
    await run(Effect.gen(function* () {
      const child = { serial: "first", label: "First" };
      const input = [{ isbn: "book", title: "Book", editions: [child], references: [child], labels: ["featured"] }];
      const before = structuredClone(input);
      const graph = yield* captureGraph(creation, input);
      expect(graph.roots).toEqual(["book"]);
      expect(graph.rows.get("volumes")).toEqual([{ isbn: "book", title: "Book" }]);
      expect(graph.rows.get("editions")).toEqual([{ serial: "first", label: "First", volume_isbn: "book" }]);
      expect(graph.rows.get(references.name)).toEqual([{ volume_isbn: "book", edition_serial: "first" }]);
      expect(input).toEqual(before);
      const receipt = [{ isbn: "book", title: "Stored", created_at: "clock" }];
      const { ctx, calls } = yield* fixture(new Map(), new Map([["insert:volumes", receipt]]));
      const inserted = yield* insertGraphRows(ctx, catalog, graph.rows);
      expect(inserted.get("volumes")).toBe(receipt);
      expect(calls.map(call => call.operation)).toEqual([
        "table:volumes", "insert:volumes", "table:editions", "insert:editions",
        "table:volume_labels", "insert:volume_labels", "table:volume_references", "insert:volume_references",
      ]);
    }));
  });

  it.each([
    [{ isbn: "v", editions: [{ serial: "s", volume_isbn: "other" }] }],
    [{ isbn: "v", editions: [{ serial: "s" }, { serial: "s" }] }],
    [{ isbn: "v", labels: ["same", "same"] }],
    [{ isbn: "v", editions: [{ serial: "s", label: "old" }], references: [{ serial: "s", label: "changed" }] }],
    [{ isbn: "v", editions: [{ serial: "s" }] }, { isbn: "w", references: [{ serial: "s" }] }],
  ])("refuses creation ownership, duplicate and cross-root snapshot violations %#", async (...input) => {
    const result = await Effect.runPromise(captureGraph(creation, input).pipe(Effect.result));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("counts pivot facts in the graph budget and isolates invocation state", async () => {
    const input = [{ isbn: "v", labels: ["one", "two"] }];
    const limited = await Effect.runPromise(captureGraph(creation, input, { ...defaultCommerceResources, facts: 2 }).pipe(Effect.result));
    expect(limited).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: { maximum: 2, attempted: 3 } } });
    expect((await Effect.runPromise(captureGraph(creation, input))).roots).toEqual(["v"]);
    expect((await Effect.runPromise(captureGraph(creation, input))).roots).toEqual(["v"]);
  });

  it("preserves omitted relations without loading or mutating their stores", async () => {
    await run(Effect.gen(function* () {
      const { ctx, calls } = yield* fixture(seeded);
      yield* replaceGraphRows(ctx, replacement, volume, [{ isbn: "v1", title: "New" }], { relations: [] });
      expect(calls.map(call => call.operation)).toEqual(["table:volumes", "find:volumes", "update:volumes"]);
    }));
  });

  it("replaces children with cascades before insertion and retains unchanged pivots", async () => {
    await run(Effect.gen(function* () {
      const returned = [{ isbn: "v1", title: "Stored" }];
      const { ctx, calls } = yield* fixture(seeded, new Map([["update:volumes", returned], ["delete:editions", []]]));
      const result = yield* replaceGraphRows(ctx, replacement, volume, [
        { isbn: "v1", title: "New", editions: [{ serial: "new", label: "New" }], labels: ["featured"] },
      ], { relations: ["editions", "labels"] });
      expect(calls.filter(call => /^(delete|insert|update):/.test(call.operation)).map(call => [call.operation, call.input])).toEqual([
        ["delete:volume_references", [{ volume_isbn: "v1", edition_serial: "old" }]],
        ["delete:editions", [{ serial: "old" }]],
        ["insert:editions", [{ serial: "new", label: "New", volume_isbn: "v1" }]],
        ["update:volumes", [{ isbn: "v1", title: "New" }]],
      ]);
      expect(result.entities).toEqual([{ isbn: "v1", title: "Stored", editions: [{ serial: "new", label: "New", volume_isbn: "v1" }], labels: [{ slug: "featured", name: "Featured" }] }]);
      // The delete store returned no entity: actions must not invent a deletion.
      expect(result.performedActions).toEqual({ created: { Edition: [{ serial: "new" }] }, updated: { Volume: [{ isbn: "v1" }] }, deleted: {} });
      for (const table of catalog.tables) expect(calls.filter(call => call.operation === "table:" + table.name)).toHaveLength(1);
    }));
  });

  it("distinguishes empty replacement from reference association", async () => {
    await run(Effect.gen(function* () {
      const empty = yield* fixture(seeded);
      const result = yield* replaceGraphRows(empty.ctx, replacement, volume, [{ isbn: "v1", editions: [], labels: [] }], { relations: ["editions", "labels"] });
      expect(result.entities).toEqual([{ isbn: "v1", editions: [], labels: [] }]);
      expect(empty.calls.some(call => call.operation === "delete:volume_labels")).toBe(true);
      const association = yield* fixture(seeded, new Map([["update:editions", [{ serial: "old", volume_isbn: "v2", label: "Old" }]]]));
      const associated = yield* replaceGraphRows(association.ctx, { ...replacement, toManyMode: () => Result.succeed("associate") }, volume,
        [{ isbn: "v2", editions: [{ serial: "old" }] }], { relations: ["editions"] });
      expect(associated.entities).toEqual([{ isbn: "v2", editions: [{ serial: "old", volume_isbn: "v2", label: "Old" }] }]);
      expect(association.calls.filter(call => call.operation.startsWith("delete:"))).toEqual([]);
      expect(associated.performedActions.updated).toEqual({ Volume: [{ isbn: "v2" }], Edition: [{ serial: "old" }] });
    }));
  });

  it.each([
    { isbn: "v2", editions: [{ serial: "old" }] },
    { isbn: "v1", labels: ["featured", "featured"] },
    { isbn: "v1", editions: null },
    { isbn: "v1", created_at: "forged" },
  ])("refuses invalid replacement before writes %#", async input => {
    await run(Effect.gen(function* () {
      const { ctx, calls } = yield* fixture(seeded);
      const result = yield* replaceGraphRows(ctx, replacement, volume, [input], { relations: ["editions", "labels"] }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
    }));
  });

  it("preserves policy and storage failures and stops subsequent work", async () => {
    await run(Effect.gen(function* () {
      const error = commerceError("invalidInput");
      const policy = yield* fixture(seeded);
      const rejected = yield* replaceGraphRows(policy.ctx, { ...replacement, validateLink: () => Effect.fail(error) }, volume,
        [{ isbn: "v1", labels: ["featured"] }], { relations: ["labels"] }).pipe(Effect.result);
      expect(Result.isFailure(rejected) && rejected.failure).toBe(error);
      expect(policy.calls.some(call => call.operation.startsWith("update:"))).toBe(false);
      const failed = yield* fixture(seeded, new Map(), { operation: "delete:volume_references", error });
      const result = yield* replaceGraphRows(failed.ctx, replacement, volume, [{ isbn: "v1", editions: [] }], { relations: ["editions"] }).pipe(Effect.result);
      expect(Result.isFailure(result) && result.failure).toBe(error);
      expect(failed.calls.at(-1)?.operation).toBe("delete:volume_references");
    }));
  });

  it("rejects existing creation roots and dependency cycles before any mutation", async () => {
    await run(Effect.gen(function* () {
      const existing = yield* fixture(seeded);
      const result = yield* replaceGraphRows(existing.ctx, replacement, volume, [{ isbn: "v1" }], { relations: [] }, true).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(existing.calls.map(call => call.operation)).toEqual(["table:volumes", "find:volumes"]);
      const cyclicVolume = { ...volume.table, foreignKeys: [
        { name: "cycle", columns: ["edition_serial"], referencedTable: edition.table.name, referencedColumns: ["serial"], onDelete: "cascade" as const },
      ] };
      const cycle = yield* fixture(seeded);
      const blocked = yield* replaceGraphRows(cycle.ctx, {
        ...replacement, catalog: { ...catalog, tables: [cyclicVolume, edition.table] },
      }, { ...volume, table: cyclicVolume }, [{ isbn: "v1" }], { relations: [] }).pipe(Effect.result);
      expect(blocked).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(cycle.calls.map(call => call.operation)).toEqual(["table:volumes", "find:volumes"]);
    }));
  });
});
