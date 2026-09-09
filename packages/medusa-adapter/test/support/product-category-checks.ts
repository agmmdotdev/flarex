import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { captureProductSchema } from "../../src/product-schema";
import { productRuntimeMetadata } from "../../src/product-runtime-metadata";
import { productLocalEventPolicy } from "../../src/product-local-events";
import { decodeCategoryProjection } from "../../src/product-category-projection";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

describe("Product Category boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("isolates inverse products and tree reads from colliding foreign scope rows", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_owned", title: "local", handle: "local" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "root", name: "local root", products: [{ id: "product_owned" }] }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "child", name: "local child", parent_category_id: "root" }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alien = "432bce99-65d0-4a4e-9c50-788af579ce12";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + alien), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    const insertForeign = async (table: string, row: Readonly<Record<string, string>>) => {
      const layout = fixture.descriptor.layout.frame;
      const physical = layout.tables.find(item => item.identity.tableId === table);
      if (physical === undefined) throw new Error("Missing fixture table");
      const columns = Object.keys(row).map(name => {
        const column = physical.columns.find(item => item.identity.columnId === name);
        if (column === undefined) throw new Error("Missing fixture column");
        return quote(column.name);
      });
      await fixture.persistence.query(`insert into ${quote(layout.targetNamespace.schemaName)}.${quote(physical.name)}
        ("scope_uuid", ${columns.join(", ")}) values ($1::uuid, ${columns.map((_, index) => "$" + (index + 2)).join(", ")})`, [alien, ...Object.values(row)]);
    };
    await insertForeign("product", { id: "product_owned", title: "foreign", handle: "foreign" });
    await insertForeign("product_category", { id: "root", name: "foreign root", handle: "foreign-root", mpath: "root" });
    await insertForeign("product_category", { id: "child", name: "foreign child", handle: "foreign-child", parent_category_id: "root", mpath: "root.child" });
    await insertForeign("product_category", { id: "foreign_only", name: "foreign only", handle: "foreign-only", parent_category_id: "root", mpath: "root.foreign_only" });
    const before = await commerceInventory(fixture);
    const result = await run(fixture.host.read(runtime.commands.countCategories, { filters: { id: "root", include_descendants_tree: true }, config: { relations: ["products"], select: ["id", "name", "products.title"], take: 1 } }).pipe(Effect.flatMap(value => Effect.fromResult(decodeCategoryProjection(value)))));
    expect(result).toMatchObject([[{ id: "root", name: "local root", products: [{ id: "product_owned", title: "local" }], category_children: [{ id: "child", name: "local child", category_children: [] }] }], 1]);
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCategories, { id: "child", data: { parent_category_id: "foreign_only" } })))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.deleteCategories, "child"));
    expect((await commerceInventory(fixture)).tables.product_category?.filter(row => row.name !== "local root")).toEqual(before.tables.product_category?.filter(row => typeof row.name === "string" && row.name.startsWith("foreign")));
  });

  it("rolls back sibling and descendant changes after a late move failure and replays", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    for (const category of [{ id: "old", name: "old" }, { id: "new", name: "new" }, { id: "moving", name: "moving", parent_category_id: "old" }, { id: "leaf", name: "leaf", parent_category_id: "moving" }, { id: "sibling", name: "sibling", parent_category_id: "old" }])
      await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, category));
    const layout = fixture.descriptor.layout.frame;
    const table = layout.tables.find(row => row.identity.tableId === "product_category");
    const idColumn = table?.columns.find(column => column.identity.columnId === "id");
    if (table === undefined || idColumn === undefined) throw new Error("Missing Category layout");
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    await fixture.persistence.exec("create sequence fx_category_move_attempts");
    await fixture.persistence.exec(`create function fx_category_move_fail() returns trigger language plpgsql as $$ begin if old.${quote(idColumn.name)} = 'leaf' then perform nextval('fx_category_move_attempts'); raise exception 'injected descendant failure'; end if; return new; end $$`);
    await fixture.persistence.exec(`create trigger fx_category_move_fail before update on ${target} for each row execute function fx_category_move_fail()`);
    const input = { id: "moving", data: { parent_category_id: "new", rank: 0 } };
    try {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCategories, input)))).toMatchObject({ _tag: "Failure" });
      expect((await fixture.persistence.query("select last_value::integer as last_value, is_called from fx_category_move_attempts")).rows).toEqual([{ last_value: 1, is_called: true }]);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
    } finally {
      await fixture.persistence.exec(`drop trigger fx_category_move_fail on ${target}`);
      await fixture.persistence.exec("drop function fx_category_move_fail()");
      await fixture.persistence.exec("drop sequence fx_category_move_attempts");
    }
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.updateCategories, input));
    const after = await commerceInventory(fixture);
    expect(after.tables.product_category).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "moving", parent_category_id: "new", mpath: "new.moving", rank: 0 }),
      expect.objectContaining({ id: "leaf", parent_category_id: "moving", mpath: "new.moving.leaf" }),
      expect.objectContaining({ id: "sibling", rank: 0 }),
    ]));
    expect(after.facts.slice(before.facts.length)).toHaveLength(3);
    expect(takeProductRunnerEvents()).toHaveLength(3);
    expect(await run(fixture.host.run(key, runtime.commands.updateCategories, input))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("preserves products while deleting leaf membership and closing sibling ranks", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product", title: "product", handle: "product" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "root", name: "root" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "leaf", name: "leaf", parent_category_id: "root", products: [{ id: "product" }] }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "sibling", name: "sibling", parent_category_id: "root" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.deleteCategories, "leaf"));
    const after = await commerceInventory(fixture);
    expect(after.tables.product).toHaveLength(1);
    expect(after.tables.product).toEqual(before.tables.product);
    expect(after.tables.product_category).toHaveLength(2);
    expect(after.tables.product_category).toContainEqual(expect.objectContaining({ id: "sibling", rank: 0 }));
    const facts = after.facts.slice(before.facts.length);
    expect(facts).toHaveLength(3);
    expect(facts.filter(fact => fact.operation === "delete")).toHaveLength(2);
    expect(takeProductRunnerEvents()).toHaveLength(2);
    expect(await run(fixture.host.run(key, runtime.commands.deleteCategories, "leaf"))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("retains repeated rank facts while authenticating aggregated batch events and replay", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "existing", name: "existing" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const key = fixture.host.newRequestKey();
    const input = [{ id: "first", name: "first", rank: 0 }, { id: "second", name: "second", rank: 0 }];
    const result = await run(fixture.host.run(key, runtime.commands.createCategories, input));
    const after = await commerceInventory(fixture);
    expect(after.tables.product_category).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "existing", rank: 2 }), expect.objectContaining({ id: "first", rank: 1 }), expect.objectContaining({ id: "second", rank: 0 }),
    ]));
    const facts = after.facts.slice(before.facts.length);
    expect(facts).toHaveLength(5);
    expect(facts.filter(fact => fact.operation === "update")).toHaveLength(3);
    const events = takeProductRunnerEvents();
    expect(events).toHaveLength(3);
    const catalog = await run(captureProductSchema("category-batch-events").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const policy = productLocalEventPolicy(fixture.descriptor, catalog, () => Effect.void);
    const rowFacts = facts.map((fact): Parameters<typeof policy.validate>[1][number] => {
      const codecVersion = fact.codecVersion;
      if (codecVersion !== 1 && codecVersion !== 2) throw new Error("Unexpected published Category key codec");
      return { ...fact, codecVersion };
    });
    for (const malformed of [events.slice(1), [...events, ...events]])
      expect(await run(Effect.result(policy.validate(malformed, rowFacts, "productCreatecategory")))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await run(Effect.result(policy.validate(events, rowFacts, "productOtherCommand")))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await run(fixture.host.run(key, runtime.commands.createCategories, input))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("refuses cycles, forged paths, invalid ranks and foreign inputs without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    for (const category of [{ id: "root", name: "root" }, { id: "other", name: "other" }, { id: "child", name: "child", parent_category_id: "root" }])
      await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, category));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    for (const input of [{ id: "root", data: { parent_category_id: "child" } }, { id: "root", data: { parent_category_id: "root" } }, { id: "child", data: { mpath: "forged" } }, { id: "child", data: { rank: -1 } }, { id: "child", data: { scopeId: "foreign" } }])
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.updateCategories, input)))).toMatchObject({ _tag: "Failure" });
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertCategories, [
      { id: "root", parent_category_id: "other" }, { id: "other", parent_category_id: "root" },
    ])))).toMatchObject({ _tag: "Failure" });
    for (const input of [{ id: "ambiguous.id", name: "bad" }, { id: "__root__", name: "bad" }, { name: "bad", parent_category_id: "__root__" }, { name: "bad", products: [{ id: "missing" }] }])
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, input)))).toMatchObject({ _tag: "Failure" });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});
