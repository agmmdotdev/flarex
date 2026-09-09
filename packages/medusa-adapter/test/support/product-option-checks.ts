import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ProductEvents } from "@medusajs/utils/product/events";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxSystemScopeClocks } from "../../../persistence-postgres/src/schema";
import { commerceInventory } from "../../../persistence-postgres/test/commerceInventory";
import { clearProductRunnerRows, getProductRunnerFixture, takeProductRunnerEvents } from "./product-runner";
const run = Effect.runPromise;
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

describe("Product Option boundary", () => {
  beforeEach(clearProductRunnerRows);
  it("isolates parent projections and counts from colliding foreign scope rows", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_owned", title: "local", handle: "local" }));
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createOptions, { id: "option_owned", title: "size", product_id: "product_owned" }));
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
    await insertForeign("product_option", { id: "option_owned", title: "size", product_id: "product_owned" });
    await insertForeign("product_option", { id: "option_foreign", title: "other", product_id: "product_owned" });
    const before = await commerceInventory(fixture);
    const config = { select: ["title", "product.title"], relations: ["product"], take: 1 };
    expect(await run(fixture.host.read(runtime.commands.countOptions, { filters: { product_id: "product_owned", title: "size" }, config })))
      .toEqual([[{ id: "option_owned", title: "size", product_id: "product_owned", product: { id: "product_owned", title: "local" } }], 1]);
    expect(await run(fixture.host.read(runtime.commands.retrieveOption, { id: "option_owned", config: { select: ["title"] } })))
      .toEqual({ id: "option_owned", title: "size" });
    expect(await run(fixture.host.read(runtime.commands.countOptions, { filters: { id: "option_foreign" } }))).toEqual([[], 0]);
    expect(await commerceInventory(fixture)).toEqual(before);
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.deleteOptions, ["option_owned", "option_foreign"]));
    expect((await commerceInventory(fixture)).tables.product_option).toHaveLength(2);
    expect((await commerceInventory(fixture)).tables.product).toEqual(before.tables.product);
  });

  it("deletes cascaded values and pivots atomically with root-only events and replay", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    const created = await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, {
      id: "product_cascade", title: "cascade", handle: "cascade",
      options: [{ title: "size", values: ["small", "large"] }, { title: "color", values: ["red"] }],
      variants: [{ title: "small red", options: { size: "small", color: "red" } }],
    }));
    if (!isJsonObject(created) || !Array.isArray(created.options)) throw new Error("Missing Product options");
    const option = created.options.find(value => isJsonObject(value) && value.title === "size");
    if (option === undefined || !isJsonObject(option) || typeof option.id !== "string") throw new Error("Missing size Option");
    const layout = fixture.descriptor.layout.frame;
    const table = layout.tables.find(value => value.identity.tableId === "product_option");
    if (table === undefined) throw new Error("Missing Option table");
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    // The parent DELETE is last in the existing child-first cascade. A driver
    // failure there must roll back earlier Value/pivot deletes and publication.
    await fixture.persistence.exec("create sequence fx_option_delete_attempts");
    await fixture.persistence.exec("create function fx_option_delete_fail() returns trigger language plpgsql as $$ begin perform nextval('fx_option_delete_attempts'); raise exception 'injected Option delete failure'; end $$");
    await fixture.persistence.exec(`create trigger fx_option_delete_fail before delete on ${target} for each row execute function fx_option_delete_fail()`);
    try {
      expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.deleteOptions, option.id))))
        .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
      expect((await fixture.persistence.query("select last_value::integer as last_value, is_called from fx_option_delete_attempts")).rows).toEqual([{ last_value: 1, is_called: true }]);
      expect(await commerceInventory(fixture)).toEqual(before);
      expect(takeProductRunnerEvents()).toEqual([]);
    } finally {
      await fixture.persistence.exec(`drop trigger fx_option_delete_fail on ${target}`);
      await fixture.persistence.exec("drop function fx_option_delete_fail()");
      await fixture.persistence.exec("drop sequence fx_option_delete_attempts");
    }
    const key = fixture.host.newRequestKey();
    const result = await run(fixture.host.run(key, runtime.commands.deleteOptions, option.id));
    const after = await commerceInventory(fixture);
    expect(after.tables.product).toEqual(before.tables.product);
    expect(after.tables.product_variant).toEqual(before.tables.product_variant);
    expect(after.tables.product_option).toHaveLength(1);
    expect(after.tables.product_option_value).toHaveLength(1);
    const facts = after.facts.slice(before.facts.length);
    expect(facts).toHaveLength(4);
    expect(facts.every(fact => fact.operation === "delete")).toBe(true);
    expect(facts.filter(fact => fact.tableId === "product_option_value")).toHaveLength(2);
    expect(after.commits).toHaveLength(before.commits.length + 1);
    expect(takeProductRunnerEvents()).toEqual([{ name: ProductEvents.PRODUCT_OPTION_DELETED,
      metadata: { source: "product", object: "product_option", action: "deleted" }, data: { id: option.id } }]);
    expect(await run(fixture.host.run(key, runtime.commands.deleteOptions, option.id))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(after);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("rolls back a new Option and its values when a later upsert member is missing", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_rollback", title: "rollback", handle: "rollback" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    const input: Json = [{ title: "new", product_id: "product_rollback", values: ["one", "two"] }, { id: "missing-option", title: "missing" }];
    const snapshot = structuredClone(input);
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.upsertOptions, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { message: "Cannot update non-existing options with ids: missing-option" } } });
    expect(input).toEqual(snapshot);
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });

  it("refuses unsupported Option reads and mutations without publication", async () => {
    const { fixture, runtime } = getProductRunnerFixture();
    await run(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.create, { id: "product_refusal", title: "refusal", handle: "refusal" }));
    const before = await commerceInventory(fixture);
    takeProductRunnerEvents();
    for (const input of [
      { scopeId: "other" }, { id: "ignored" }, { filters: { title: ["wrong"] } }, { filters: { product_id: ["p"] } },
      { config: { select: ["product.title"] } }, { config: { select: ["product.missing"], relations: ["product"] } },
      { config: { relations: ["product.tags"] } }, { config: { relations: ["values.variants"] } },
      { config: { take: 257 } }, { config: { order: { title: "ASC" } } },
    ]) expect(await run(Effect.result(fixture.host.read(runtime.commands.listOptions, input))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    for (const input of [
      { title: "bad", product_id: "missing", values: ["one"] }, { title: "bad", product_id: "product_refusal", scopeId: "other" },
      { title: "bad", product_id: "product_refusal", values: [12] },
    ]) expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.createOptions, input))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await run(Effect.result(fixture.host.run(fixture.host.newRequestKey(), runtime.commands.deleteOptions, { selector: {} }))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceTransactionError" } });
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(takeProductRunnerEvents()).toEqual([]);
  });
});
