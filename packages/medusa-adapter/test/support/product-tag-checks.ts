import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;

describe("Product Tag boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("isolates inverse relations and preserves empty and collection projections", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const metadata = await run(captureProductSchema("tag-checks").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags, [{ id: "tag_owned", value: "shared" }, { id: "tag_empty", value: "empty" }]));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "collection_owned", title: "collection", handle: "collection" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create,
      { id: "product_owned", title: "local", handle: "local", collection_id: "collection_owned", tags: [{ id: "tag_owned" }] }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alienUuid = "bcbebc3a-7dda-4c5f-ae04-9c5a0f9f8630";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({
      scopeId: ScopeIdSchema.make("scope_" + alienUuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch,
    });
    // Deliberate wrong-scope fixture: compiler-owned physical identifiers and
    // overlapping parent/pivot keys expose missing scope predicates at each hop.
    const insertForeign = async (table: string, row: Readonly<Record<string, string>>) => {
      const layout = fixture.descriptor.layout.frame;
      const physical = layout.tables.find(item => item.identity.tableId === table);
      if (physical === undefined) throw new Error("Missing fixture table");
      const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
      const columns = Object.keys(row).map(name => {
        const column = physical.columns.find(item => item.identity.columnId === name);
        if (column === undefined) throw new Error("Missing fixture column");
        return quote(column.name);
      });
      await fixture.persistence.query(`insert into ${quote(layout.targetNamespace.schemaName)}.${quote(physical.name)}
        ("scope_uuid", ${columns.join(", ")}) values ($1::uuid, ${columns.map((_, index) => "$" + (index + 2)).join(", ")})`, [alienUuid, ...Object.values(row)]);
    };
    await insertForeign(metadata.tag.table.name, { id: "tag_owned", value: "shared" });
    await insertForeign(metadata.collection.table.name, { id: "collection_owned", title: "foreign collection", handle: "foreign-collection" });
    await insertForeign(metadata.product.table.name, { id: "product_owned", title: "foreign", handle: "foreign", collection_id: "collection_owned" });
    await insertForeign(metadata.product.table.name, { id: "product_foreign", title: "foreign only", handle: "foreign-only" });
    const relation = metadata.queryRelations.get(metadata.tag.table.name)?.get("products");
    if (relation?.join.type !== "manyToMany") throw new Error("Missing Tag pivot");
    const source = relation.join.sourceColumns[0], target = relation.join.targetColumns[0];
    if (source === undefined || target === undefined) throw new Error("Missing pivot keys");
    for (const id of ["product_owned", "product_foreign"]) await insertForeign(relation.join.pivotTable, { [source]: "tag_owned", [target]: id });
    const before = await commerceInventory(fixture);
    const input = { filters: { value: "shared" }, config: { select: ["value", "products.title"], relations: ["products.collection"], take: 1 } };
    expect(await run(fixture.host.read(runtime.commands.countTags, input))).toEqual([[{
      id: "tag_owned", value: "shared", products: [{ id: "product_owned", title: "local", collection_id: "collection_owned", collection: expect.objectContaining({ id: "collection_owned", title: "collection" }) }],
    }], 1]);
    expect(await run(fixture.host.read(runtime.commands.retrieveTag, { id: "tag_empty", config: { select: ["value", "products.id"], relations: ["products"] } })))
      .toEqual({ id: "tag_empty", value: "empty", products: [] });
    expect(await commerceInventory(fixture)).toEqual(before);
  });

  it("authenticates DTO echoes and refuses unsupported inputs without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags, { id: "tag_echo", value: "before" }));
    const original = await run(fixture.host.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    if (!isJsonObject(original) || typeof original.created_at !== "string" || typeof original.updated_at !== "string") throw new Error("Missing Tag DTO");
    const input = { ...original, value: "after" };
    const snapshot = structuredClone(input);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertTags, input));
    expect(input).toEqual(snapshot);
    const current = await run(fixture.host.read(runtime.commands.retrieveTag, { id: "tag_echo" }));
    expect(current).toMatchObject({ id: "tag_echo", value: "after", created_at: original.created_at, deleted_at: original.deleted_at });
    const before = await commerceInventory(fixture);
    for (const bad of [
      { ...original, value: "stale" }, { ...original, updated_at: "2000-01-01T00:00:00.000Z" },
      { ...original, created_at: "2000-01-01T00:00:00.000Z" }, { ...original, deleted_at: "2000-01-01T00:00:00.000Z" },
      { ...original, id: "missing" }, { value: "new", created_at: original.created_at },
      { id: "tag_echo", updated_at: original.updated_at },
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertTags, bad))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    for (const bad of [
      { scopeId: "other" }, { table: "product" }, { filters: { value: ["bad"] } }, { filters: { products: { id: "other" } } },
      { config: { select: ["products.missing"], relations: ["products"] } }, { config: { relations: ["products.tags"] } },
      { config: { take: 257 } }, { config: { skip: -1 } },
    ]) expect(await run(Effect.result(fixture.host.read(runtime.commands.listTags, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const bad of [
      { title: "bad", tags: [{ id: "tag_echo", value: "rewrite" }] },
      { title: "bad", tags: [{ id: "tag_echo" }], tag_ids: ["tag_echo"] },
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await commerceInventory(fixture)).toEqual(before);
  });

  it("rolls back a new Tag when a later upsert member is missing", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const input: Json = [{ value: "must-rollback" }, { id: "missing-tag", value: "missing" }];
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertTags, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: 'ProductTag with id "missing-tag" not found' } } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});
