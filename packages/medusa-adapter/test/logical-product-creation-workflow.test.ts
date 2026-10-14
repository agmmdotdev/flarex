import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { fxAppRowCurrent, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { prepareProductCreationWorkflow, type ProductCreationHooks } from "../src/product-creation-workflow";
import { productCreationResources } from "../src/workflow/policy";
import { makeProductCreationFixture, productCreationOptions, productCreationExecution,
  seedCreationEndpoints, seedCreationReferences, type ProductCreationFixture } from "./support/logical-product-creation-fixture";
import { prepareInventoryCreateHost } from "./support/logical-inventory-fixture";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Product creation driver");
const cleanup: Array<() => Promise<void>> = [];
let selected: ProductCreationFixture;
const rows = () => selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const prepare = (hooks: ProductCreationHooks = {}, fixture = selected, execution = productCreationExecution(fixture)) =>
  Effect.runPromise(prepareProductCreationWorkflow({ ...productCreationOptions(fixture), execution, hooks }));
const input = (prefix: string, count = 4) => ({ additional_data: { external_reference: prefix },
  products: Array.from({ length: count }, (_, index) => ({ id: prefix + "-product-" + index, title: prefix + " " + index,
    handle: prefix + "-handle-" + index, status: "published", description: "Native root description", metadata: { index },
    type_id: "root-type", collection_id: "root-collection", discountable: false,
    tag_ids: Array.from({ length: 4 }, (_, i) => "root-tag-" + i), category_ids: Array.from({ length: 4 }, (_, i) => "root-category-" + i),
    images: [{ url: "https://example.test/first.png" }, { url: "https://example.test/second.png" }],
    options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
    sales_channels: [{ id: "root-channel-0" }, { id: "root-channel-1" }], shipping_profile_id: "root-profile-0",
    variants: [{ id: prefix + "-variant-" + index, title: prefix + " variant " + index, sku: prefix + "-sku-" + index,
      options: { Size: "0" }, prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r1" } },
        { currency_code: "EUR", amount: 200, rules: { region_id: "r2" } }] }],
  })) });
const simple = (prefix: string) => ({ products: [{ id: prefix, title: prefix, options: [{ title: "Size", values: ["0"] }] }] });
function nativeFailure(error: unknown): unknown {
  if (error instanceof CommerceTransactionError && error.cause !== undefined) return nativeFailure(error.cause);
  if (error instanceof Error && error.cause !== undefined) return nativeFailure(error.cause);
  return Cause.isCause(error) ? nativeFailure(Cause.squash(error)) : error;
}
async function seedItems(values: Array<{ id: string; sku?: string | null }>, fixture = selected) {
  const { host, create } = await prepareInventoryCreateHost(fixture.fixture, fixture.inventory.inventory);
  try { await Effect.runPromise(host.run(host.newRequestKey(), create, values)); } finally { await Effect.runPromise(host.close); }
}

describe("complete native Product creation on original logical sources", () => {
  beforeAll(async () => {
    selected = await makeProductCreationFixture(driver, close => cleanup.push(close));
    await seedCreationEndpoints(selected); await seedCreationReferences(selected);
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it.each(["events", "calls"] as const)("refuses the maximum graph under the smaller %s allowance with no publication", async budget => {
    const execution = productCreationExecution(selected);
    const host = await prepare({}, selected, { ...execution,
      prepare: composition => execution.prepare({ ...composition, ...(budget === "events" ? { requestEventLimit: 64 } : { requestCallLimit: 256 }) }),
    });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input("limit-64"))));
      if (Result.isSuccess(outcome)) throw new Error("Smaller root unexpectedly accepted the maximum graph");
      expect(outcome.failure).toMatchObject({ reason: "rollbackOnly" });
      expect(nativeFailure(outcome.failure)).toMatchObject({ reason: "limitExceeded" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("creates the maximum graph, observes all four pending Link families and publishes once", async () => {
    const statements: string[] = [];
    const session = issueRelationalSession(selected.fixture.persistence.drizzle, (profile, work) => runRelationalSession(selected.fixture.session, profile, tx =>
      Effect.gen(function* () {
        const observed = vi.spyOn(tx._.session, "prepareQuery");
        try { return yield* work(tx); } finally { statements.push(...observed.mock.calls.map(([query]) => query.sql)); observed.mockRestore(); }
      })).pipe(Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
    const hook = vi.fn<NonNullable<ProductCreationHooks["productsCreated"]>>(async ({ products, additional_data }, { resources, container }) => {
      expect(additional_data).toEqual({ external_reference: "maximum" });
      expect(products.map(product => product.id)).toEqual(input("maximum").products.map(product => product.id));
      const productIds = products.map(product => product.id), variantIds = products.flatMap(product => product.variants.map(variant => variant.id));
      for (const [entity, filters, expected] of [
        ["product_sales_channels", { product_id: productIds }, 8],
        ["product_shipping_profiles", { product_id: productIds }, 4],
        ["product_variant_inventory_items", { variant_id: variantIds }, 4],
        ["product_variant_price_sets", { variant_id: variantIds }, 4],
      ] as const) {
        const pending = await resources.query.graph({ entity, fields: ["id"], filters, pagination: { take: 8 } });
        expect(pending.metadata.count).toBe(expected); expect(pending.data).toHaveLength(expected);
      }
      expect(Object.keys(resources)).not.toContain("product_links");
      expect(Object.keys(resources)).not.toContain("variant_links");
      expect(typeof container.resolve<{ create: unknown }>("link").create).toBe("function");
      expect(products.every(product => product.status === "published" && product.discountable === false && product.variants.length === 1)).toBe(true);
      expect(products.every(product => product.variants.every(variant => variant.manage_inventory === true && variant.prices.length === 2))).toBe(true);
    });
    const host = await prepare({ productsCreated: hook }, selected, productCreationExecution(selected, session));
    try {
      const beforeRows = await rows(), beforeEvents = await events(), key = host.newRequestKey(), value = input("maximum");
      statements.length = 0;
      let calls = 1;
      const result = await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      console.info("Complete native Product root bounded calls:", calls);
      expect(calls).toBeLessThanOrEqual(productCreationResources.calls);
      expect((await rows()).length - beforeRows.length).toBe(116);
      const emitted = (await events()).slice(beforeEvents.length);
      expect(emitted.length).toBeGreaterThan(64);
      expect(emitted.length).toBeLessThanOrEqual(productCreationResources.eventMessages);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(emitted.filter(event => ["product-variant.created", "product.created"].includes(event.envelope.contract)).map(event => event.envelope.contract)).toEqual([
        ...Array.from({ length: 4 }, () => "product-variant.created"), ...Array.from({ length: 4 }, () => "product.created"),
      ]);
      for (const family of ["LinkProductSalesChannel.attached", "LinkProductShippingProfile.attached", "LinkProductVariantInventoryItem.attached", "LinkProductVariantPriceSet.attached"])
        expect(emitted.some(event => event.envelope.contract === family)).toBe(true);
      // Existing logicalPublication packets page the source/index/unique union.
      // Three packet pairs share the one commit proved by events and row facts.
      expect(statements.filter(sql => sql.includes(".fx_accept_app_publication("))).toHaveLength(3);
      expect(statements.filter(sql => sql.includes(".fx_apply_app_publication("))).toHaveLength(3);
      expect(statements.some(sql => /\bCREATE\s+(TABLE|INDEX)\b/i.test(sql))).toBe(false);
      const last = emitted.at(-1); if (!last) throw new Error("Missing Product publication");
      expect((await selected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges)).filter(fact => fact.commitSeq === last.commitSeq)).toHaveLength(116);
      const committedRows = await rows(), committedEvents = await events();
      expect(await Effect.runPromise(host.run(key, value))).toEqual(result); expect(hook).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("retains authentic empty children for a Product without variants or external associations", async () => {
    const items = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems"), levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const stock = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations"), pricing = vi.spyOn(PricingModuleService.prototype, "createPriceSets");
    const host = await prepare();
    try {
      const beforeEvents = await events();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), simple("empty-variants")));
      expect(result).toMatchObject([{ id: "empty-variants", variants: [] }]);
      expect(items.mock.calls.map(call => call[0])).toEqual([[]]); expect(levels.mock.calls.map(call => call[0])).toEqual([[]]);
      expect(stock.mock.calls.map(call => call[0])).toEqual([{ id: [] }]); expect(pricing.mock.calls.map(call => call[0])).toEqual([[]]);
      expect((await events()).slice(beforeEvents.length).filter(event => ["product-variant.created", "product.created"].includes(event.envelope.contract)).map(event => event.envelope.contract)).toEqual(["product.created"]);
    } finally { items.mockRestore(); levels.mockRestore(); stock.mockRestore(); pricing.mockRestore(); await Effect.runPromise(host.close); }
  });

  it("preserves flattened Product/variant order across supplied, default and unmanaged Inventory", async () => {
    await seedItems([{ id: "mixed-supplied", sku: null }]);
    const host = await prepare({ productsCreated: async ({ products }, { resources }) => {
      expect(products.map(product => product.id)).toEqual(["mixed-product-0", "mixed-product-1"]);
      expect(products.map(product => product.variants.map(variant => variant.id))).toEqual([["mixed-variant-0", "mixed-variant-1"], ["mixed-variant-2", "mixed-variant-3"]]);
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["variant_id", "inventory_item_id", "required_quantity"],
        filters: { variant_id: products.flatMap(product => product.variants.map(row => row.id)) }, pagination: { take: 8 } });
      expect(links.data).toHaveLength(3);
      expect(links.data.find(link => link.variant_id === "mixed-variant-0")).toEqual({ variant_id: "mixed-variant-0", inventory_item_id: "mixed-supplied", required_quantity: 5 });
      expect(links.data.some(link => link.variant_id === "mixed-variant-2")).toBe(false);
    } });
    try {
      const value = input("mixed", 2), prototypes = input("mixed").products.map(product => product.variants[0]);
      const first = prototypes[0], second = prototypes[1], third = prototypes[2], fourth = prototypes[3];
      if (!first || !second || !third || !fourth) throw new Error("Missing mixed variants");
      const productA = value.products[0], productB = value.products[1]; if (!productA || !productB) throw new Error("Missing mixed Products");
      await Effect.runPromise(host.run(host.newRequestKey(), { products: [
        { ...productA, variants: [{ ...first, inventory_items: [{ inventory_item_id: "mixed-supplied", required_quantity: 5 }] }, second] },
        { ...productB, variants: [{ ...third, manage_inventory: false }, fourth] },
      ] }));
    } finally { await Effect.runPromise(host.close); }
  });

  it("preserves native missing-option and Inventory validation errors with whole-root rollback", async () => {
    await seedItems([{ id: "duplicate-supplied", sku: null }]);
    const base = input("invalid", 1).products[0]; if (!base) throw new Error("Missing invalid Product");
    for (const [value, message] of [
      [{ products: [{ id: "no-options", title: "No options" }] }, "Product options are not provided for: [No options]."],
      [{ products: [{ ...base, variants: base.variants.map(variant => ({ ...variant, inventory_items: [{ inventory_item_id: "missing-item" }] })) }] }, "Inventory Items with ids: missing-item was not found"],
      [{ products: [{ ...base, variants: base.variants.map(variant => ({ ...variant, inventory_items: [{ inventory_item_id: "duplicate-supplied" }, { inventory_item_id: "duplicate-supplied" }] })) }] }, "Cannot associate duplicate inventory items to variant(s) invalid-variant-0"],
    ] as const) {
      const host = await prepare();
      try {
        const beforeRows = await rows(), beforeEvents = await events();
        const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), value)));
        if (Result.isSuccess(outcome)) throw new Error("Native validation unexpectedly succeeded");
        expect(nativeFailure(outcome.failure)).toMatchObject({ type: "invalid_data", message });
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  });

  it("supports all eight supplied Inventory associations in the maximum Product batch", async () => {
    for (const offset of [0, 4]) await seedItems(Array.from({ length: 4 }, (_, index) => ({ id: "maximum-supplied-" + (offset + index), sku: null })));
    const host = await prepare({ productsCreated: async ({ products }, { resources }) => {
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["variant_id", "inventory_item_id", "required_quantity"],
        filters: { variant_id: products.flatMap(product => product.variants.map(variant => variant.id)) }, pagination: { take: 8 } });
      expect(links.data).toHaveLength(8);
      expect(links.data.every(link => link.required_quantity === 2)).toBe(true);
    } });
    try {
      const value = input("maximum-supplied");
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...value, products: value.products.map((product, index) => ({ ...product,
        variants: product.variants.map(variant => ({ ...variant, inventory_items: [0, 1].map(offset => ({ inventory_item_id: "maximum-supplied-" + (index * 2 + offset), required_quantity: 2 })) })),
      })) }));
      expect(result.map(product => product.id)).toEqual(value.products.map(product => product.id));
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back a duplicate Inventory SKU after native Product and Link creation", async () => {
    await seedItems([{ id: "root-duplicate-sku-item", sku: "root-duplicate-sku" }]);
    const host = await prepare();
    try {
      const beforeRows = await rows(), beforeEvents = await events(), value = input("duplicate-sku", 1);
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { ...value, products: value.products.map(product => ({ ...product,
        variants: product.variants.map(variant => ({ ...variant, sku: "root-duplicate-sku" })),
      })) }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  // Characterizes buildProduct in the pinned query-graph/query-graph.ts setup.
  // Translation and the original bootstrap/graph suite are outside this profile.
  it("preserves the pinned query-graph Product setup input and native variant results", async () => {
    const host = await prepare();
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { products: [{
        title: "Product 1", category_ids: ["root-category-0"], options: [{ title: "size", values: ["small", "large"] }],
        variants: [{ title: "P1 Variant 1", options: { size: "small" }, prices: [{ amount: 10, currency_code: "usd" }] },
          { title: "P1 Variant 2", options: { size: "large" }, prices: [{ amount: 20, currency_code: "usd" }] }],
      }] }));
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ title: "Product 1", status: "draft", discountable: true,
        options: [{ title: "size", values: [{ value: "small" }, { value: "large" }] }],
        variants: [{ title: "P1 Variant 1", product_id: result[0]?.id, manage_inventory: true,
          prices: [{ amount: 10, currency_code: "usd" }] },
          { title: "P1 Variant 2", product_id: result[0]?.id, manage_inventory: true, prices: [{ amount: 20, currency_code: "usd" }] }],
      });
    } finally { await Effect.runPromise(host.close); }
  });

  it("refuses managed fields, parent overrides and batch-wide variant overflow before the root hook", async () => {
    const hook = vi.fn<NonNullable<ProductCreationHooks["productsCreated"]>>(() => undefined);
    const host = await prepare({ productsCreated: hook });
    try {
      const value = input("bounds", 1), product = value.products[0]; if (!product) throw new Error("Missing bounded Product");
      for (const products of [
        [{ ...product, created_at: "2026-10-14T00:00:00.000Z" }],
        [{ ...product, variants: product.variants.map(variant => ({ ...variant, product_id: "another-product" })) }],
        input("overflow").products.map((product, index) => ({ ...product, variants: index === 0 ? [...product.variants, ...product.variants] : product.variants })),
      ]) {
        const beforeRows = await rows(), beforeEvents = await events();
        await expect(Effect.runPromise(host.run(host.newRequestKey(), { products }))).rejects.toMatchObject({ reason: "invalidInput" });
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      }
      expect(hook).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back late hooks, caught private-source access and caught unsupported stock writes", async () => {
    const handlers: NonNullable<ProductCreationHooks["productsCreated"]>[] = [
      () => { throw new Error("Late root failure"); },
      async (_value, { container }) => { try { container.resolve("product_links"); } catch {} },
      async (_value, { container }) => { try { await container.resolve<{ createInventoryLevels(input: unknown): Promise<unknown> }>("inventory")
        .createInventoryLevels([{ inventory_item_id: "bad", location_id: "bad", stocked_quantity: 1 }]); } catch {} },
      async (_value, { resources, eventGroupId }) => { await resources.event_bus.emit([{ name: "product.created", data: { id: "forged-product" }, metadata: { eventGroupId } }]); },
    ];
    for (const [index, handler] of handlers.entries()) {
      const reached = vi.fn(handler), host = await prepare({ productsCreated: reached });
      try {
        const beforeRows = await rows(), beforeEvents = await events();
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input("late-" + index, 1)))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
        expect(reached).toHaveBeenCalledTimes(1); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  });

  it("drains cancellation and revokes escaped composed Link methods", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped: ((input: unknown) => Promise<unknown>) | undefined;
    const host = await prepare({ productsCreated: async (_value, { container }) => {
      escaped = container.resolve<{ create(input: unknown): Promise<unknown> }>("link").create;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await waiting;
    } });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancel", 1)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      if (!escaped) throw new Error("Missing escaped Link method");
      await expect(escaped([])).rejects.toMatchObject({ reason: "closed" });
    } finally { release?.(); await Effect.runPromise(host.close); }
  }, 120_000);

  it("recovers uncertain acknowledgement without repeating hooks", async () => {
    let lose = true;
    const session = issueRelationalSession(selected.fixture.persistence.drizzle, (profile, work) => runRelationalSession(selected.fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Product root COMMIT acknowledgement") })); }),
    ));
    const hook = vi.fn<NonNullable<ProductCreationHooks["productsCreated"]>>(() => undefined);
    const host = await prepare({ productsCreated: hook }, selected, productCreationExecution(selected, session));
    try {
      const key = host.newRequestKey(), value = input("uncertain", 1);
      const result = await Effect.runPromise(host.run(key, value));
      expect(lose).toBe(false); expect(hook).toHaveBeenCalledTimes(1);
      const committedRows = await rows(), committedEvents = await events();
      expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("settles duplicate delivery once and replays after bounded contention", async () => {
    const hook = vi.fn<NonNullable<ProductCreationHooks["productsCreated"]>>(() => undefined);
    const host = await prepare({ productsCreated: hook });
    try {
      const key = host.newRequestKey(), value = simple("concurrent");
      const beforeEvents = await events();
      const outcomes = await Promise.all([Effect.runPromise(Effect.result(host.run(key, value))), Effect.runPromise(Effect.result(host.run(key, value)))]);
      const success = outcomes.find(Result.isSuccess);
      if (!success) throw new Error("No duplicate delivery settled");
      for (const outcome of outcomes) {
        if (Result.isSuccess(outcome)) expect(outcome.success).toEqual(success.success);
        else {
          expect(driver).toBe("postgres");
          expect(outcome.failure).toMatchObject({ reason: "statementFailure" });
          expect(nativeFailure(outcome.failure)).toMatchObject({ code: "55P03" });
        }
      }
      expect(hook).toHaveBeenCalledTimes(1);
      const committedRows = await rows(), committedEvents = await events();
      expect(new Set(committedEvents.slice(beforeEvents.length).map(event => event.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(success.success);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("isolates matching Product and reference identities across shops", async () => {
    const other = await makeProductCreationFixture(driver, close => cleanup.push(close), { resource: selected.fixture.resource,
      fixtureIdentity: { deploymentId: "product_root_shop_b", projectId: "product_root_shop_b", uuidOffset: 12_000 } });
    await seedCreationEndpoints(other); await seedCreationReferences(other);
    const first = await prepare(), second = await prepare({}, other);
    try {
      const value = input("shared", 1); await Effect.runPromise(first.run(first.newRequestKey(), value));
      const scope = projectScopeIdUuidV1(selected.fixture.application.authority.scopeId).scopeUuid;
      const before = (await rows()).filter(row => row.scopeUuid === scope);
      await Effect.runPromise(second.run(second.newRequestKey(), value));
      expect((await rows()).filter(row => row.scopeUuid === scope)).toEqual(before);
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 180_000);
});
