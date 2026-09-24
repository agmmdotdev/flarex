import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;

describe("Product Collection boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("isolates Collection projections and membership changes from colliding foreign scope rows", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_owned", title: "local", handle: "local" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "collection_owned", title: "local collection", handle: "local-collection", product_ids: ["product_owned"] }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alienUuid = "e9cae5c7-3eaf-4973-a8b5-d7f33de73a26";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + alienUuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    // Deliberate adversarial fixture: physical identifiers come only from the
    // captured compiler layout. Overlapping keys expose missing scope predicates.
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
    await insertForeign("product_collection", { id: "collection_owned", title: "foreign collection", handle: "foreign-collection" });
    await insertForeign("product", { id: "product_owned", title: "foreign", handle: "foreign", collection_id: "collection_owned" });
    await insertForeign("product", { id: "product_foreign", title: "foreign only", handle: "foreign-only", collection_id: "collection_owned" });
    const before = await commerceInventory(fixture);
    expect(await run(fixture.host.read(runtime.commands.countCollections, { filters: { handle: "local-collection" }, config: { take: 1, select: ["title", "products.title"], relations: ["products"] } })))
      .toEqual([[{ id: "collection_owned", title: "local collection", products: [{ id: "product_owned", title: "local", collection_id: "collection_owned" }] }], 1]);
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { title: "wrong scope", product_ids: ["product_foreign"] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    // Pinned selector updates ignore IDs absent from the active scope. They must
    // neither attach nor mutate a matching foreign row.
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_owned", data: { product_ids: ["product_foreign"] } }));
    const after = await commerceInventory(fixture);
    expect(after.tables.product?.filter(row => row.title === "local").map(row => row.collection_id)).toEqual([null]);
    expect(after.tables.product?.filter(row => row.title !== "local")).toEqual(before.tables.product?.filter(row => row.title !== "local"));
  });

  it("rolls back earlier Collection and Product changes when a later upsert member fails", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_rollback", title: "rollback", handle: "rollback" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const input: Json = [{ title: "must-rollback", product_ids: ["product_rollback"] }, { id: "missing-collection", title: "missing" }];
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertCollections, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: 'ProductCollection with id "missing-collection" not found' } } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("refuses unadmitted inputs without publication or widening ordinary Product queries", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "collection_refusal", title: "before" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    for (const bad of [
      { product_ids: [12] }, { product_ids: "bad" }, { product_ids: Array.from({ length: 257 }, () => "id") },
      { products: [{ id: "product" }] }, { scopeId: "other" }, { created_at: "2000-01-01T00:00:00.000Z" },
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_refusal", data: bad }))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const bad of [
      { filters: { title: ["bad"] } }, { filters: { handle: { $in: ["bad"] } } }, { scopeId: "other" },
      { config: { select: ["products.missing"], relations: ["products"] } }, { config: { relations: ["products.collection"] } },
    ]) expect(await run(Effect.result(fixture.host.read(runtime.commands.listCollections, bad))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await run(Effect.result(fixture.host.read(runtime.commands.list, { filters: { id: { $in: ["product"] } } }))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});
