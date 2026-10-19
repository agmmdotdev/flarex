import { describe, expect, expectTypeOf, it } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import type { PerformedActions } from "@medusajs/types";
import type { replaceProductRows } from "../src/modules/product/mutation";
import { Effect, Result, Schema, type Scope } from "effect";
import { commerceError, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { commerceDecoder } from "../src/value/decoder";
import type { CommerceRelation } from "../src/query/relations";
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
  operation: "upsertWithReplace", ordering: new Map(), catalog, allowedRelations: () => ["editions", "labels"], ownedToOne: () => [], mutableForeignKeys: () => false,
  admitSelection: () => Result.succeed(undefined), prepareProjection: () => Effect.void,
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
      return { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: () => Effect.fail(commerceError("unsupportedProfile")), aggregate: () => Effect.fail(commerceError("unsupportedProfile")), find: (manager, query) => run(manager, "find", query), count: unused, lifecycle: unused,
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

describe("native graph update versus upsert replacement operations", () => {
  it("keeps ID-only and relation-only update roots unchanged while writing an explicitly supplied same scalar", async () => {
    await run(Effect.gen(function* () {
      const profile: ReplacementProfile = { ...replacement, operation: "update" };
      for (const input of [{ isbn: "v1" }, { isbn: "v1", editions: [{ serial: "old" }] }, { isbn: "v1", title: "Old" }]) {
        const { ctx, calls } = yield* fixture(seeded);
        yield* replaceGraphRows(ctx, profile, volume, [input], { relations: "editions" in input ? ["editions"] : [] });
        expect(calls.filter(call => call.operation === "update:volumes")).toHaveLength("title" in input ? 1 : 0);
        expect(calls.filter(call => call.operation === "update:editions")).toEqual([]);
      }
      const prior = yield* fixture(seeded);
      yield* replaceGraphRows(prior.ctx, replacement, volume, [{ isbn: "v1" }], { relations: [] });
      expect(prior.calls.filter(call => call.operation === "update:volumes")).toHaveLength(1);
    }));
  });

  it("creates replacement children without a relation-only update root patch", async () => {
    await run(Effect.gen(function* () {
      const state = new Map([...seeded, ["editions", []], [references.name, []]]), { ctx, calls } = yield* fixture(state);
      const result = yield* replaceGraphRows(ctx, { ...replacement, operation: "update" }, volume,
        [{ isbn: "v1", editions: [{ serial: "new", label: "New" }] }], { relations: ["editions"] });
      expect(calls.filter(call => call.operation === "update:volumes")).toEqual([]);
      expect(calls.filter(call => call.operation === "insert:editions").map(call => call.input)).toEqual([[{ serial: "new", label: "New", volume_isbn: "v1" }]]);
      expect(result.performedActions.created.Edition).toEqual([{ serial: "new" }]);
    }));
  });

  it("retains JSON child updates and the profile's default key order alongside new children", async () => {
    await run(Effect.gen(function* () {
      const jsonEdition: GraphEntity = { ...edition, table: { ...edition.table, columns: [...edition.table.columns,
        { name: "payload", type: "json", nullable: true, primaryKey: false, generated: false }] } };
      const jsonCatalog: GraphCatalog = { ...catalog, entities: catalog.entities.map(value => value === edition ? jsonEdition : value),
        tables: catalog.tables.map(value => value === edition.table ? jsonEdition.table : value) };
      const old = { serial: "old", volume_isbn: "v1", label: "Old", payload: { retained: true } },
        added = { serial: "new", volume_isbn: "v1", label: "New", payload: null };
      const state = new Map([...seeded, ["editions", [old]], [references.name, []]]);
      const { ctx, calls } = yield* fixture(state, new Map([["update:editions", [old]], ["insert:editions", [added]]]));
      const result = yield* replaceGraphRows(ctx, { ...replacement, catalog: jsonCatalog, operation: "update" }, volume,
        [{ isbn: "v1", editions: [{ serial: "old", payload: { retained: true } }, { serial: "new", label: "New" }] }], { relations: ["editions"] });
      // This neutral profile selects default key order. Intrinsic insertion
      // order is authenticated separately by the real database profile tests.
      expect(result.entities[0]?.editions).toEqual([added, old]);
      expect(calls.filter(call => call.operation === "update:volumes")).toEqual([]);
      expect(result.performedActions.created.Edition).toEqual([{ serial: "new" }]); expect(result.performedActions.updated.Edition).toEqual([{ serial: "old" }]);
    }));
  });

  it("leaves historical children after native update empty-array cleanup while nonempty update and upsert replacement remove omissions", async () => {
    await run(Effect.gen(function* () {
      // The native module has already physically removed its active omissions.
      // A scripted remaining historical row pins the shared planning boundary.
      const state = new Map([...seeded, ["editions", [{ serial: "historical", volume_isbn: "v1", label: "History", deleted_at: "2026-01-01T00:00:00.000Z" }]],
        [references.name, []], [pivot.name, []]]);
      const emptyUpdate = yield* fixture(state);
      yield* replaceGraphRows(emptyUpdate.ctx, { ...replacement, operation: "update" }, volume,
        [{ isbn: "v1", editions: [] }], { relations: ["editions"] });
      expect(emptyUpdate.calls.filter(call => call.operation === "delete:editions")).toEqual([]);
      for (const [operation, editions] of [["upsertWithReplace", []], ["update", [{ serial: "new", label: "New" }]]] as const) {
        const current = yield* fixture(state);
        yield* replaceGraphRows(current.ctx, { ...replacement, operation }, volume, [{ isbn: "v1", editions: [...editions] }], { relations: ["editions"] });
        expect(current.calls.filter(call => call.operation === "delete:editions").map(call => call.input)).toEqual([[{ serial: "historical" }]]);
      }
    }));
  });

  it("replaces explicit empty update collections only when the profile selects replacement", async () => {
    await run(Effect.gen(function* () {
      const unchanged = yield* fixture(seeded);
      yield* replaceGraphRows(unchanged.ctx, { ...replacement, operation: "update" }, volume,
        [{ isbn: "v1", editions: [], labels: [] }], { relations: ["editions", "labels"] });
      expect(unchanged.calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);

      const selected = yield* fixture(seeded);
      const result = yield* replaceGraphRows(selected.ctx, { ...replacement, operation: "update", emptyCollections: "replace" }, volume,
        [{ isbn: "v1", editions: [], labels: [] }], { relations: ["editions", "labels"] });
      expect(selected.calls.filter(call => call.operation.startsWith("delete:")).map(call => [call.operation, call.input])).toEqual([
        ["delete:volume_references", [{ volume_isbn: "v1", edition_serial: "old" }]],
        ["delete:volume_labels", [{ volume_isbn: "v1", label_slug: "featured" }]],
        ["delete:editions", [{ serial: "old" }]],
      ]);
      expect(result.entities).toEqual([{ isbn: "v1", title: "Old", editions: [], labels: [] }]);
      expect(selected.calls.some(call => call.operation === "update:volumes")).toBe(false);
    }));
  });

  it("preserves historical owned members when replacement selects active membership", async () => {
    await run(Effect.gen(function* () {
      const historical = { serial: "historical", volume_isbn: "v1", label: "History", deleted_at: "2026-01-01T00:00:00.000Z" };
      const rows = new Map([...seeded, ["editions", [...seeded.get("editions") ?? [], historical]]]);
      const { ctx, calls } = yield* fixture(rows);
      const result = yield* replaceGraphRows(ctx, { ...replacement, operation: "update", replacementMembers: "active" }, volume,
        [{ isbn: "v1", editions: [{ serial: "new", label: "New" }] }], { relations: ["editions"] });
      expect(calls.filter(call => call.operation === "delete:editions").map(call => call.input)).toEqual([[{ serial: "old" }]]);
      expect(calls.filter(call => call.operation === "insert:editions").map(call => call.input))
        .toEqual([[{ serial: "new", label: "New", volume_isbn: "v1" }]]);
      expect(result.performedActions.deleted.Edition).toEqual([{ serial: "old" }]);
    }));
  });

  it("replaces active empty collections without deleting independent historical members", async () => {
    await run(Effect.gen(function* () {
      const historical = { serial: "historical", volume_isbn: "v1", label: "History", deleted_at: "2026-01-01T00:00:00.000Z" };
      const rows = new Map([...seeded, ["editions", [...seeded.get("editions") ?? [], historical]]]);
      const { ctx, calls } = yield* fixture(rows);
      const result = yield* replaceGraphRows(ctx, {
        ...replacement, operation: "update", emptyCollections: "replace", replacementMembers: "active",
      }, volume, [{ isbn: "v1", editions: [] }], { relations: ["editions"] });
      expect(calls.filter(call => call.operation === "delete:editions").map(call => call.input)).toEqual([[{ serial: "old" }]]);
      expect(result.performedActions.deleted.Edition).toEqual([{ serial: "old" }]);
      expect(calls.filter(call => /^(insert|update):/.test(call.operation))).toEqual([]);
    }));
  });

  it("leaves omitted collections and association membership unchanged under replacement policies", async () => {
    await run(Effect.gen(function* () {
      const profile: ReplacementProfile = {
        ...replacement, operation: "update", emptyCollections: "replace", replacementMembers: "active",
      };
      const omitted = yield* fixture(seeded);
      yield* replaceGraphRows(omitted.ctx, profile, volume, [{ isbn: "v1" }], { relations: [] });
      expect(omitted.calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
      expect(omitted.calls.filter(call => call.operation === "find:editions")).toEqual([]);

      const emptyAssociation = yield* fixture(seeded);
      yield* replaceGraphRows(emptyAssociation.ctx, { ...profile, toManyMode: () => Result.succeed("associate") }, volume,
        [{ isbn: "v1", editions: [] }], { relations: ["editions"] });
      expect(emptyAssociation.calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);

      const moved = [{ serial: "old", volume_isbn: "v2", label: "Old" }];
      const association = yield* fixture(seeded, new Map([["update:editions", moved]]));
      const result = yield* replaceGraphRows(association.ctx, { ...profile, toManyMode: () => Result.succeed("associate") }, volume,
        [{ isbn: "v2", editions: [{ serial: "old" }] }], { relations: ["editions"] });
      expect(association.calls.filter(call => /^(insert|update|delete):/.test(call.operation)).map(call => [call.operation, call.input]))
        .toEqual([["update:editions", [{ serial: "old", volume_isbn: "v2" }]]]);
      expect(result.entities[0]?.editions).toEqual(moved);
    }));
  });

  it("refuses selecting a historical member even when historical omissions are preserved", async () => {
    await run(Effect.gen(function* () {
      const rows = new Map([...seeded, ["editions", [{ serial: "historical", volume_isbn: "v1", label: "History", deleted_at: "2026-01-01T00:00:00.000Z" }]]]);
      const { ctx, calls } = yield* fixture(rows);
      const result = yield* replaceGraphRows(ctx, { ...replacement, operation: "update", replacementMembers: "active" }, volume,
        [{ isbn: "v1", editions: [{ serial: "historical", label: "Changed" }] }], { relations: ["editions"] }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
    }));
  });
});

describe("checked complete-child reconstitution delegation", () => {
  const datedEdition = entity("editions", "Edition", "serial",
    ["volume_isbn", "label", "created_at", "updated_at", "deleted_at"], edition.table.foreignKeys);
  const datedCatalog: GraphCatalog = { ...catalog,
    entities: catalog.entities.map(value => value === edition ? datedEdition : value),
    tables: catalog.tables.map(value => value === edition.table ? datedEdition.table : value),
  };
  const ordinary: ReplacementProfile = { ...replacement, catalog: datedCatalog };
  const selected: ReplacementProfile = { ...ordinary, allowReconstitution: true };
  const previous: JsonObject = { serial: "old", volume_isbn: "v1", label: "Old",
    created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", deleted_at: null };
  const state = () => new Map([...seeded, ["editions", []], [references.name, []]]);
  const input = [{ isbn: "v1", editions: [previous] }];

  it.each([
    { profile: ordinary, reason: "invalidInput" },
    { profile: selected, reason: "unsupportedProfile" },
  ])("refuses managed child fields without both policy and checked port: $reason", async ({ profile, reason }) => {
    await run(Effect.gen(function* () {
      const base = yield* fixture(state());
      const result = yield* replaceGraphRows(base.ctx, profile, volume, input, { relations: ["editions"] }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason } });
      expect(base.calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
    }));
  });

  it("passes the complete DTO unchanged to its checked owner and uses actual returned rows", async () => {
    await run(Effect.gen(function* () {
      const base = yield* fixture(state()), captured: unknown[] = [];
      const written = { ...previous, updated_at: "2026-02-01T00:00:00.000Z" };
      // A scripted write receipt pins this adapter boundary only. Authentic
      // deletion history and timestamp authority are proved by real core tests.
      const ctx: typeof base.ctx = { ...base.ctx, table: name => base.ctx.table(name).pipe(Effect.map(table =>
        name === datedEdition.table.name ? { ...table,
          reconstitute: (manager: typeof base.ctx.manager, rows: unknown) => Effect.sync(() => {
            expect(manager).toBe(base.ctx.manager); captured.push(rows); return [written];
          }),
        } : table)) };
      const result = yield* replaceGraphRows(ctx, selected, volume, input, { relations: ["editions"] });
      expect(captured).toEqual([[previous]]);
      expect(result.entities[0]?.editions).toEqual([written]);
      expect(result.performedActions.created.Edition).toEqual([{ serial: "old" }]);
      expect(base.calls.some(call => call.operation === "insert:editions")).toBe(false);
    }));
  });
});

describe("shared graph planning over renamed module keys", () => {
  it("captures a new owned to-one before its owner and preserves normalized reference precedence", async () => {
    const owned: CreationProfile = { ...creation, root: { entity: volume, omitRelations: ["publisher"], steps: [
      { kind: "ownedToOne", name: "publisher", foreignKey: "publisher_slug", node: { entity: label, omitRelations: [], steps: [] } },
    ] } };
    const input = [{ isbn: "inline", publisher_slug: "displaced", publisher: { slug: "press", name: "Press" } },
      { isbn: "scalar", publisher_slug: "displaced", publisher: "known" },
      { isbn: "absent" }, { isbn: "null", publisher: null }];
    const before = structuredClone(input);
    const captured = await Effect.runPromise(captureGraph(owned, input));
    expect(captured.rows.get("labels")).toEqual([{ slug: "press", name: "Press" }]);
    expect(captured.rows.get("volumes")).toEqual([{ isbn: "inline", publisher_slug: "press" },
      { isbn: "scalar", publisher_slug: "known" }, { isbn: "absent" }, { isbn: "null", publisher_slug: null }]);
    expect(input).toEqual(before);
  });

  it("counts owned to-one inserts and refuses malformed and duplicated child identities", async () => {
    const owned: CreationProfile = { ...creation, root: { entity: volume, omitRelations: ["publisher"], steps: [
      { kind: "ownedToOne", name: "publisher", foreignKey: "publisher_slug", node: { entity: label, omitRelations: [], steps: [] } },
    ] } };
    const result = await Effect.runPromise(captureGraph(owned, [{ isbn: "book", publisher: { slug: "press", name: "Press" } }],
      { ...defaultCommerceResources, facts: 1 }).pipe(Effect.result));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded", cause: { attempted: 2 } } });
    for (const input of [[{ isbn: "book", publisher: false }], [{ isbn: "book", publisher: ["press"] }],
      [{ isbn: "one", publisher: { slug: "same", name: "Press" } }, { isbn: "two", publisher: { slug: "same", name: "Press" } }]])
      expect(await Effect.runPromise(captureGraph(owned, input).pipe(Effect.result))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

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
      expect(inserted.get("volumes")).toEqual(receipt);
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

  it("refuses a complete projection cohort during preparation before any write", async () => {
    await run(Effect.gen(function* () {
      const { ctx, calls } = yield* fixture(seeded);
      const error = commerceError("unsupportedProfile");
      const result = yield* replaceGraphRows(ctx, { ...replacement,
        admitSelection: table => table === edition.table ? Result.fail(error) : Result.succeed(undefined),
        prepareProjection: (_entity, roots, load) => load(edition.table, "volume_isbn", roots.flatMap(row => typeof row.isbn === "string" ? [row.isbn] : [])).pipe(Effect.asVoid),
      }, volume, [{ isbn: "v1", title: "New" }], { relations: ["editions"] }).pipe(Effect.result);
      expect(Result.isFailure(result) && result.failure).toBe(error);
      expect(calls.some(call => call.operation === "find:editions")).toBe(true);
      expect(calls.filter(call => /^(insert|update|delete):/.test(call.operation))).toEqual([]);
    }));
  });

  it("reuses the prepared complete cohort for post-write projection", async () => {
    await run(Effect.gen(function* () {
      const { ctx, calls } = yield* fixture(seeded);
      const result = yield* replaceGraphRows(ctx, { ...replacement,
        prepareProjection: (_entity, roots, load) => load(edition.table, "volume_isbn", roots.flatMap(row => typeof row.isbn === "string" ? [row.isbn] : [])).pipe(Effect.asVoid),
      }, volume, [{ isbn: "v1", title: "New" }], { relations: ["editions"] });
      const operations = calls.map(call => call.operation);
      expect(operations.filter(operation => operation === "find:editions")).toHaveLength(1);
      expect(operations.indexOf("find:editions")).toBeLessThan(operations.indexOf("update:volumes"));
      expect(result.entities[0]?.editions).toEqual(seeded.get("editions"));
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

  it("selects many referenced members in one bounded lookup", async () => {
    await run(Effect.gen(function* () {
      const labels = Array.from({ length: 60 }, (_, index) => ({ slug: `label-${index}`, name: `Label ${index}` }));
      const rows = new Map(seeded);
      rows.set("labels", labels);
      rows.set(pivot.name, []);
      const { ctx, calls } = yield* fixture(rows);
      const result = yield* replaceGraphRows(ctx, replacement, volume,
        [{ isbn: "v1", labels: labels.map(row => row.slug) }], { relations: ["labels"] });
      expect(result.entities).toMatchObject([{ isbn: "v1", labels }]);
      expect(calls.filter(call => call.operation === "find:labels")).toHaveLength(1);
      expect(calls.filter(call => call.operation === "insert:volume_labels")).toHaveLength(1);
    }));
  });

  it("reuses a complete child selection for retained members", async () => {
    await run(Effect.gen(function* () {
      const editions = Array.from({ length: 60 }, (_, index) => ({
        serial: `edition-${index}`, volume_isbn: "v1", label: `Edition ${index}`,
      }));
      const rows = new Map(seeded);
      rows.set("editions", editions);
      rows.set(references.name, []);
      const { ctx, calls } = yield* fixture(rows);
      const result = yield* replaceGraphRows(ctx, replacement, volume,
        [{ isbn: "v1", editions: editions.map(({ serial, label }) => ({ serial, label })) }],
        { relations: ["editions"] });
      expect(result.entities).toMatchObject([{ isbn: "v1", editions }]);
      expect(calls.filter(call => call.operation === "find:editions")).toHaveLength(1);
    }));
  });

  it("associates many existing children with one selected-key read", async () => {
    await run(Effect.gen(function* () {
      const editions = Array.from({ length: 60 }, (_, index) => ({
        serial: `association-${index}`, volume_isbn: "v1", label: `Association ${index}`,
      }));
      const rows = new Map(seeded);
      rows.set("editions", editions);
      const moved = editions.map(row => ({ ...row, volume_isbn: "v2" }));
      const { ctx, calls } = yield* fixture(rows, new Map([["update:editions", moved]]));
      const result = yield* replaceGraphRows(ctx, { ...replacement, toManyMode: () => Result.succeed("associate") }, volume,
        [{ isbn: "v2", editions: editions.map(({ serial }) => ({ serial })) }], { relations: ["editions"] });
      expect(result.entities).toMatchObject([{ isbn: "v2", editions: moved }]);
      const selections = calls.filter(call => call.operation === "find:editions");
      expect(selections).toHaveLength(2);
      expect(selections.map(call => call.input)).toMatchObject([
        { predicate: { column: "serial" } }, { predicate: { column: "volume_isbn" } },
      ]);
      expect(calls.filter(call => call.operation === "update:editions")).toHaveLength(1);
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

  it("reports the first missing member before a later duplicate", async () => {
    await run(Effect.gen(function* () {
      const { ctx, calls } = yield* fixture(seeded);
      const result = yield* replaceGraphRows(ctx, replacement, volume,
        [{ isbn: "v1", labels: ["missing", "featured", "featured"] }], { relations: ["labels"] }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
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
