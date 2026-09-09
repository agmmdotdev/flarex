import { expect, it } from "vitest";
import { Effect } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture, productIntegrationTestRunner, takeProductRunnerEvents } from "./support/product-runner";
import { productFixtureResetSql } from "./support/product-fixture-reset";

const run = Effect.runPromise;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

// Snapshot every non-application table, including installation/readiness and
// authenticated history. Row order is irrelevant; row values must be identical.
async function retainedRows() {
  const { fixture } = getProductRunnerFixture();
  const layout = fixture.descriptor.layout.frame;
  const names = await fixture.persistence.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE' order by table_name",
    [layout.targetNamespace.schemaName]);
  const application = new Set(layout.tables.map(table => table.name));
  const rows: Record<string, readonly string[]> = {};
  for (const { table_name } of names.rows) {
    if (!application.has(table_name)) {
      const result = await fixture.persistence.query(`select row_to_json(t)::text as row from ${quote(layout.targetNamespace.schemaName)}.${quote(table_name)} t`);
      rows[table_name] = result.rows.map(row => {
        if (typeof row.row !== "string") throw new Error("Missing retained fixture row");
        return row.row;
      }).sort();
    }
  }
  return rows;
}

productIntegrationTestRunner({ moduleName: "product", testSuite() {
  it("clears the full graph in every scope while preserving installation, history and replay", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTags, { id: "tag", value: "tag" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes, { id: "type", value: "type" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCollections, { id: "collection", title: "collection" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "root", name: "root" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createCategories, { id: "child", name: "child", parent_category_id: "root" }));
    const key = fixture.host.newRequestKey();
    const input = { id: "product", title: "product", handle: "product", type_id: "type", collection_id: "collection",
      tags: [{ id: "tag" }], category_ids: ["child"], images: [{ id: "image", url: "image.jpg" }],
      options: [{ title: "Size", values: ["small"] }],
      variants: [{ id: "variant", title: "small", options: { Size: "small" } }] };
    const result = await run(fixture.host.run(key, runtime.commands.create, input));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.addImageToVariant, { variant_id: "variant", image_id: "image" }));
    const populated = await commerceInventory(fixture);
    expect(Object.keys(populated.tables)).toHaveLength(13);
    for (const rows of Object.values(populated.tables)) expect(rows.length).toBeGreaterThan(0);

    const clock = populated.clocks[0];
    if (clock === undefined) throw new Error("Missing fixture scope clock");
    const alien = "f5b91a2e-1819-4c07-aa76-ecb3a185e8cd";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({
      scopeId: ScopeIdSchema.make("scope_" + alien), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    const layout = fixture.descriptor.layout.frame;
    // Fixture construction order is explicit and independent of the reset planner.
    for (const id of ["product_tag", "product_type", "product_collection", "product_category", "product", "product_option",
      "product_option_value", "product_variant", "image", "product_tags", "product_category_product",
      "product_variant_option", "product_variant_product_image"]) {
      const table = layout.tables.find(item => item.identity.tableId === id);
      if (table === undefined) throw new Error("Missing graph fixture table: " + id);
      const columns = table.columns.map(column => quote(column.name)).join(", ");
      const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
      await fixture.persistence.query(`insert into ${target} (scope_uuid, ${columns}) select $1::uuid, ${columns} from ${target}`, [alien]);
      expect((await fixture.persistence.query(`select count(distinct scope_uuid)::int as n from ${target}`)).rows).toEqual([{ n: 2 }]);
    }
    expect(populated.facts.length).toBeGreaterThan(0);
    const retained = await retainedRows();
    await clearProductRunnerRows();
    for (const rows of Object.values((await commerceInventory(fixture)).tables)) expect(rows).toEqual([]);
    expect(await retainedRows()).toEqual(retained);
    expect(takeProductRunnerEvents()).toEqual([]);
    expect(fixture.takeDeliveries()).toEqual([]);
    expect(await run(fixture.host.run(key, runtime.commands.create, input))).toEqual(result);
    expect(await run(fixture.host.read(runtime.commands.list, { filters: {}, config: {} }))).toEqual([]);
    expect(await retainedRows()).toEqual(retained);
    expect(takeProductRunnerEvents()).toEqual([]);
    await clearProductRunnerRows();
    expect(await retainedRows()).toEqual(retained);
  });

  it("rolls back every deletion when a later table rejects cleanup", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createTypes, { id: "type", value: "type" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product", title: "product", type_id: "type" }));
    const layout = fixture.descriptor.layout.frame;
    const table = layout.tables.find(item => item.identity.tableId === "product_type");
    const product = layout.tables.find(item => item.identity.tableId === "product");
    if (table === undefined || product === undefined) throw new Error("Missing Product/type fixture table");
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
    const productTarget = quote(layout.targetNamespace.schemaName) + "." + quote(product.name);
    const before = await commerceInventory(fixture);
    // Reach the injected error only after the earlier Product DELETE took effect.
    await fixture.persistence.exec(`create function fx_fixture_reset_fail() returns trigger language plpgsql as $$ begin
      if exists(select 1 from ${productTarget}) then raise exception 'Product rows survived earlier cleanup'; end if;
      raise exception 'injected fixture reset failure'; end $$`);
    await fixture.persistence.exec(`create trigger fx_fixture_reset_fail before delete on ${target} for each row execute function fx_fixture_reset_fail()`);
    try {
      await expect(clearProductRunnerRows()).rejects.toThrow("injected fixture reset failure");
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toHaveLength(2);
    } finally {
      await fixture.persistence.exec(`drop trigger fx_fixture_reset_fail on ${target}`);
      await fixture.persistence.exec("drop function fx_fixture_reset_fail()");
    }
    await clearProductRunnerRows();
    for (const rows of Object.values((await commerceInventory(fixture)).tables)) expect(rows).toEqual([]);
  });

  it("refuses an unsupported cross-table cycle before issuing cleanup SQL", () => {
    const { fixture } = getProductRunnerFixture();
    const layout = fixture.descriptor.layout.frame;
    const edge = layout.foreignKeys.find(key => key.kind === "foreignKey" && key.sourceTable.tableId !== key.targetTable.tableId);
    if (edge === undefined || edge.kind !== "foreignKey") throw new Error("Missing fixture dependency");
    expect(() => productFixtureResetSql({ ...layout, foreignKeys: [...layout.foreignKeys,
      { ...edge, sourceTable: edge.targetTable, targetTable: edge.sourceTable }] })).toThrow("cross-table foreign-key cycle");
  });
} });
