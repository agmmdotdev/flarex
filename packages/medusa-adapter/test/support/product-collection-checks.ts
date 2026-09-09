import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ProductEvents } from "@medusajs/utils/product/events";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;

describe("Product Collection boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("replaces and clears every member beyond the default page with complete facts and events", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const ids = Array.from({ length: 20 }, (_, index) => "product_" + index.toString().padStart(2, "0"));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, ids.map(id => ({ id, title: id, handle: id.replaceAll("_", "-") }))));
    takeProductRunnerEvents();
    const before = await commerceInventory(fixture);
    const input = { id: "collection_all", title: "all", product_ids: ids };
    const snapshot = structuredClone(input);
    const key = fixture.host.newRequestKey();
    const created = await run(fixture.host.run(key, runtime.commands.createCollections, input));
    expect(input).toEqual(snapshot);
    const after = await commerceInventory(fixture);
    expect(after.tables.product).toHaveLength(20);
    expect(after.tables.product?.every(row => row.collection_id === "collection_all")).toBe(true);
    expect(after.facts.slice(before.facts.length).filter(fact => fact.tableId === "product" && fact.operation === "update")).toHaveLength(20);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(after.commits.at(-1)?.relationalChangeCount).toBe(21);
    const events = takeProductRunnerEvents();
    expect(events).toHaveLength(21);
    expect(events.filter(event => isJsonObject(event) && event.name === ProductEvents.PRODUCT_UPDATED)).toHaveLength(20);
    expect(await run(fixture.host.run(key, runtime.commands.createCollections, input))).toEqual(created);
    expect(takeProductRunnerEvents()).toEqual([]);
    expect(await commerceInventory(fixture)).toEqual(after);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_all", data: { title: "renamed" } }));
    expect((await commerceInventory(fixture)).tables.product?.every(row => row.collection_id === "collection_all")).toBe(true);
    const kept = ids[19];
    if (kept === undefined) throw new Error("Missing last-page Product");
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_all", data: { product_ids: [kept] } }));
    const replaced = await commerceInventory(fixture);
    expect(replaced.tables.product?.filter(row => row.collection_id === "collection_all").map(row => row.id)).toEqual([kept]);
    expect(replaced.tables.product?.filter(row => row.collection_id === null)).toHaveLength(19);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "collection_other", title: "other" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_other", data: { product_ids: [kept] } }));
    expect(await run(fixture.host.read(runtime.commands.retrieveCollection, { id: "collection_all", config: { select: ["title", "products.id"], relations: ["products"] } })))
      .toEqual({ id: "collection_all", title: "renamed", products: [] });
    takeProductRunnerEvents();
    const beforeClear = await commerceInventory(fixture);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCollections, { id: "collection_other", data: { product_ids: [] } }));
    const cleared = await commerceInventory(fixture);
    expect(cleared.tables.product).toHaveLength(20);
    expect(cleared.tables.product?.every(row => row.collection_id === null)).toBe(true);
    expect(cleared.facts.slice(beforeClear.facts.length).filter(fact => fact.tableId === "product" && fact.operation === "update")).toHaveLength(1);
    expect(takeProductRunnerEvents().filter(event => isJsonObject(event) && event.name === ProductEvents.PRODUCT_UPDATED)).toHaveLength(1);
  });

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
