import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ProductImage } from "@medusajs/product/models";
import { ProductEvents } from "@medusajs/utils/product/events";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;
const imageTable = ProductImage.parse().tableName;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

describe("Product Variant boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("isolates parent projections and counts from colliding foreign scope rows", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_owned", title: "local", handle: "local", images: [{ id: "image_owned", url: "local-image" }] }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createVariants, { id: "variant_owned", title: "variant", product_id: "product_owned" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.addImageToVariant, { variant_id: "variant_owned", image_id: "image_owned" }));
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (clock === undefined) throw new Error("Missing scope clock");
    const alienUuid = "432bce99-65d0-4a4e-9c50-788af579ce12";
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + alienUuid), storageGeneration: clock.storageGeneration, epoch: clock.epoch });
    // Deliberate foreign-scope fixtures use only compiler-owned physical names.
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
        ("scope_uuid", ${columns.join(", ")}) values ($1::uuid, ${columns.map((_, index) => "$" + (index + 2)).join(", ")})`, [alienUuid, ...Object.values(row)]);
    };
    await insertForeign("product", { id: "product_owned", title: "foreign", handle: "foreign" });
    await insertForeign("product_variant", { id: "variant_owned", title: "foreign variant", product_id: "product_owned" });
    await insertForeign("product_variant", { id: "variant_foreign", title: "other", product_id: "product_owned" });
    await insertForeign(imageTable, { id: "image_owned", url: "foreign-image", product_id: "product_owned" });
    await insertForeign("product_variant_product_image", { id: "assignment_foreign", variant_id: "variant_owned", image_id: "image_owned" });
    const before = await commerceInventory(fixture);
    expect(before.tables[imageTable]).toHaveLength(2);
    const config = { select: ["title", "product.title"], relations: ["product"], take: 1 };
    expect(await run(fixture.host.read(runtime.commands.countVariants, { filters: { product_id: "product_owned", title: "variant" }, config })))
      .toEqual([[{ id: "variant_owned", title: "variant", product_id: "product_owned", product: { id: "product_owned", title: "local" } }], 1]);
    expect(await run(fixture.host.read(runtime.commands.retrieveVariant, { id: "variant_owned", config: { select: ["title"] } })))
      .toEqual({ id: "variant_owned", title: "variant" });
    expect(await run(fixture.host.read(runtime.commands.countVariants, { filters: { id: "variant_foreign" } }))).toEqual([[], 0]);
    expect(await run(fixture.host.read(runtime.commands.listVariants, { filters: { id: "variant_owned" }, config: { relations: ["images"] } })))
      .toMatchObject([{ id: "variant_owned", images: [{ id: "image_owned", url: "local-image" }] }]);
    expect(await commerceInventory(fixture)).toEqual(before);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.removeImageFromVariant, { variant_id: "variant_owned", image_id: "image_owned" }));
    const unassigned = await commerceInventory(fixture);
    expect(unassigned.tables.product_variant_product_image).toEqual(before.tables.product_variant_product_image?.filter(row => row.id === "assignment_foreign"));
    expect(unassigned.tables[imageTable]).toEqual(before.tables[imageTable]);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.softDeleteVariants, ["variant_owned", "variant_foreign"]));
    const after = await commerceInventory(fixture);
    if (after.tables.product_variant === undefined || before.tables.product_variant === undefined) throw new Error("Missing Variant inventory");
    expect(after.tables.product_variant.filter(row => row.deleted_at !== null)).toHaveLength(1);
    expect(after.tables.product_variant.filter(row => row.title !== "variant")).toEqual(before.tables.product_variant.filter(row => row.title !== "variant"));
    expect((await commerceInventory(fixture)).tables.product).toEqual(before.tables.product);
  });

  it("removes exact image pairs atomically and replays without deleting images", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_images", title: "images", handle: "images",
      images: [{ id: "image_a", url: "a" }, { id: "image_b", url: "b" }],
      variants: [{ id: "variant_a", title: "A" }, { id: "variant_b", title: "B" }],
    }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.addImageToVariant, [
      { variant_id: "variant_a", image_id: "image_a" }, { variant_id: "variant_b", image_id: "image_b" },
      { variant_id: "variant_a", image_id: "image_b" },
    ]));
    takeProductRunnerEvents();
    const before = await commerceInventory(fixture);
    expect(before.tables[imageTable]).toHaveLength(2);
    const layout = fixture.descriptor.layout.frame;
    const table = layout.tables.find(value => value.identity.tableId === "product_variant_product_image");
    if (table === undefined) throw new Error("Missing assignment table");
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
    const pairs = [{ variant_id: "variant_a", image_id: "image_a" }, { variant_id: "variant_b", image_id: "image_b" }];
    await fixture.persistence.exec("create sequence fx_variant_delete_attempts");
    await fixture.persistence.exec("create function fx_variant_delete_fail() returns trigger language plpgsql as $$ begin if nextval('fx_variant_delete_attempts') = 2 then raise exception 'injected assignment failure'; end if; return old; end $$");
    await fixture.persistence.exec(`create trigger fx_variant_delete_fail before delete on ${target} for each row execute function fx_variant_delete_fail()`);
    try {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.removeImageFromVariant, pairs))))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
      expect((await fixture.persistence.query("select last_value::integer as last_value, is_called from fx_variant_delete_attempts")).rows).toEqual([{ last_value: 2, is_called: true }]);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
    } finally {
      await fixture.persistence.exec(`drop trigger fx_variant_delete_fail on ${target}`);
      await fixture.persistence.exec("drop function fx_variant_delete_fail()");
      await fixture.persistence.exec("drop sequence fx_variant_delete_attempts");
    }
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.removeImageFromVariant, pairs));
    const after = await commerceInventory(fixture);
    expect(after.tables[imageTable]).toEqual(before.tables[imageTable]);
    expect(after.tables.product_variant).toEqual(before.tables.product_variant);
    expect(after.tables.product_variant_product_image).toHaveLength(1);
    expect(after.facts.slice(before.facts.length)).toHaveLength(2);
    expect(after.facts.slice(before.facts.length).every(fact => fact.tableId === "product_variant_product_image" && fact.operation === "delete")).toBe(true);
    expect(takeProductRunnerEvents()).toEqual([]);
    expect(await run(fixture.host.run(key, runtime.commands.removeImageFromVariant, pairs))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("soft deletes only the selected Variant with authenticated events and replay", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_shared", title: "shared", handle: "shared",
      options: [{ title: "size", values: ["small", "large"] }, { title: "color", values: ["red"] }],
      variants: [{ id: "variant_small", title: "small", options: { size: "small", color: "red" } }, { id: "variant_large", title: "large", options: { size: "large", color: "red" } }],
    }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.softDeleteVariants, "variant_small"));
    const after = await commerceInventory(fixture);
    for (const name of ["product", "product_option", "product_option_value", "product_variant_option"]) expect(after.tables[name]).toEqual(before.tables[name]);
    expect(after.facts.slice(before.facts.length)).toHaveLength(1);
    expect(after.facts.slice(before.facts.length)[0]).toMatchObject({ tableId: "product_variant", operation: "update" });
    expect(takeProductRunnerEvents()).toEqual([{ name: ProductEvents.PRODUCT_VARIANT_DELETED,
      metadata: { source: "product", object: "product_variant", action: "deleted" }, data: { id: "variant_small" } }]);
    expect(await run(fixture.host.read(runtime.commands.countVariants, {}))).toMatchObject([[{ id: "variant_large" }], 1]);
    expect(await run(fixture.host.read(runtime.commands.retrieveVariant, { id: "variant_small", config: { withDeleted: true, relations: ["options"] } })))
      .toMatchObject({ id: "variant_small", options: expect.arrayContaining([expect.objectContaining({ value: "red", deleted_at: null })]) });
    expect(await run(fixture.host.run(key, runtime.commands.softDeleteVariants, "variant_small"))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("refuses unsupported Variant inputs without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_refusal", title: "refusal", handle: "refusal", variants: [{ id: "variant_refusal", title: "valid" }] }));
    takeProductRunnerEvents();
    const before = await commerceInventory(fixture);
    for (const input of [{ config: { relations: ["product.tags"] } }, { config: { relations: ["options.variants"] } }, { config: { select: ["product.title"] } }, { filters: { scopeId: "foreign" } }, { config: { take: 257 } }])
      expect(await run(Effect.result(fixture.host.read(runtime.commands.listVariants, input)))).toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const input of [{ variant_id: "variant_refusal" }, { variant_id: "variant_refusal", image_id: "missing", scopeId: "foreign" }])
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.removeImageFromVariant, input)))).toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.softDeleteVariants, { selector: {} })))).toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});
