import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Cause, Deferred, Effect, Fiber, Result } from "effect";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { fxAppRowCurrent, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { prepareLogicalPricingHost } from "./support/logical-pricing-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost } from "./support/logical-inventory-fixture";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { productVariantInventoryResources } from "../src/workflow/policy";
import { InventoryItemsOutput } from "../src/modules/inventory/service";
import { commerceDecoder } from "../src/value/decoder";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { prepareProductCreateWorkflow } from "../src/workflows/product/create";
import { prepareProductVariantInventoryWorkflow, type ProductVariantInventoryHooks } from "../src/workflows/product/variant-inventory";
import type { AtomicWorkflowExecution, AtomicWorkflowHostComposition } from "../src/workflow/host";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Inventory workflow driver");
const cleanup: Array<() => Promise<void>> = [];
type Connected = { fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
  product: Awaited<ReturnType<typeof prepareLogicalProductHost>>; pricing: Awaited<ReturnType<typeof prepareLogicalPricingHost>>;
  members: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>> };
let selected: Connected;
const revision = (name: string) => createHash("sha256").update(name).digest("hex");
const decodeSeedItems = commerceDecoder(InventoryItemsOutput, "storedCorruption");
const events = () => selected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const rows = () => selected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const execution = (connected: Connected, session = connected.fixture.session): AtomicWorkflowExecution => ({ identityAndAccessPolicy: connected.fixture.hostInput.identityAndAccessPolicy,
  prepare: (composition: AtomicWorkflowHostComposition) => makeAtomicCommerceHost({ ...connected.fixture.hostInput, session, ...composition }) });
const modules = (connected: Connected) => ({
  product: { module: connected.product.runtime.workflow, logicalStorage: connected.product.hostInput.logicalStorage },
  pricing: { module: connected.pricing.runtime.workflow, logicalStorage: connected.pricing.hostInput.logicalStorage },
  inventory: { module: connected.members.inventory.runtime.workflow, logicalStorage: connected.members.inventory.hostInput.logicalStorage },
  stock_location: { module: connected.members.stockLocation.runtime.workflow, logicalStorage: connected.members.stockLocation.hostInput.logicalStorage },
  link: { module: connected.members.link.runtime.workflow, logicalStorage: connected.members.link.hostInput.logicalStorage },
});
const prepare = (connected: Connected, hooks: ProductVariantInventoryHooks = {}, selectedExecution = execution(connected)) =>
  Effect.runPromise(prepareProductVariantInventoryWorkflow({ execution: selectedExecution, modules: modules(connected), hooks,
    revision: revision("logical-native-variant-inventory"), subscribers: [{ id: "variant-inventory-test", revision: "a".repeat(64) }] }));
const input = (prefix: string, count = 4) => ({ product_variants: Array.from({ length: count }, (_, index) => ({
  id: prefix + "-variant-" + index, product_id: prefix + "-product", title: prefix + " " + index, sku: prefix + "-sku-" + index,
  options: { Size: String(index) }, prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "r1" } },
    { currency_code: "EUR", amount: 200, rules: { region_id: "r2" } }],
})) });
function nativeFailure(error: unknown): unknown {
  if (error instanceof CommerceTransactionError && error.cause !== undefined) return nativeFailure(error.cause);
  return Cause.isCause(error) ? nativeFailure(Cause.squash(error)) : error;
}
async function seedProduct(connected: Connected, id: string) {
  const host = await Effect.runPromise(prepareProductCreateWorkflow({ execution: execution(connected), modules: { product: modules(connected).product },
    revision: revision("inventory-existing-product"), subscribers: [{ id: "variant-inventory-seed", revision: "b".repeat(64) }] }));
  try { await Effect.runPromise(host.run(host.newRequestKey(), { products: [{ id, title: id, options: [{ title: "Size", values: ["0", "1", "2", "3"] }] }] })); }
  finally { await Effect.runPromise(host.close); }
}
async function connect(fixture: Connected["fixture"]): Promise<Connected> {
  const product = await prepareLogicalProductHost(fixture), pricing = await prepareLogicalPricingHost(fixture);
  for (const member of [product, pricing]) {
    try { await Effect.runPromise(member.host.initialize([])); } finally { await Effect.runPromise(member.host.close); }
  }
  return { fixture, product, pricing, members: await prepareLogicalInventoryHosts(fixture) };
}
async function seedItems(connected: Connected, values: Array<{ id: string; sku?: string | null }>) {
  const { host, create } = await prepareInventoryCreateHost(connected.fixture, connected.members.inventory);
  try {
    const result = await Effect.runPromise(host.run(host.newRequestKey(), create, values).pipe(Effect.flatMap(value => Effect.fromResult(decodeSeedItems(value)))));
    expect(result).toEqual(values.map(value => expect.objectContaining({ id: value.id, requires_shipping: true })));
    expect(result.every(item => !Object.hasOwn(item, "reserved_quantity") && !Object.hasOwn(item, "stocked_quantity"))).toBe(true);
    return result;
  }
  finally { await Effect.runPromise(host.close); }
}

describe("complete native Variant Inventory workflow on shared logical storage", () => {
  beforeAll(async () => { selected = await connect(await logicalCurrencyFixture(driver, close => cleanup.push(close), {
    includeProduct: true, includePricing: true, includeVariantInventory: true,
  })); }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("creates four managed variants, reads pending Inventory and links, and publishes once", async () => {
    await seedProduct(selected, "maximum-product");
    const statements: string[] = [];
    const session = issueRelationalSession(selected.fixture.persistence.drizzle, (profile, work) =>
      runRelationalSession(selected.fixture.session, profile, tx => Effect.gen(function* () {
        const observed = vi.spyOn(tx._.session, "prepareQuery");
        try { return yield* work(tx); }
        finally { statements.push(...observed.mock.calls.map(([query]) => query.sql)); observed.mockRestore(); }
      })).pipe(Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause })))));
    const hook = vi.fn<NonNullable<ProductVariantInventoryHooks["productVariantsCreated"]>>(async ({ product_variants }, { resources }) => {
      const ids = product_variants.map(variant => variant.id);
      const inventory = await resources.query.graph({ entity: "inventory_item", fields: ["id", "sku", "title", "requires_shipping"], filters: {}, pagination: { take: 4 } });
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["id", "variant_id", "inventory_item_id", "required_quantity"], filters: { variant_id: ids }, pagination: { take: 8 } });
      expect(inventory.metadata.count).toBe(4);
      expect(links.data).toHaveLength(4);
      expect(links.data.every(link => link.required_quantity === 1 && inventory.data.some(item => item.id === link.inventory_item_id))).toBe(true);
      expect(inventory.data.map(item => item.sku).sort()).toEqual(input("maximum").product_variants.map(variant => variant.sku).sort());
      expect(inventory.data.every(item => item.requires_shipping === true && typeof item.title === "string")).toBe(true);
    });
    const host = await prepare(selected, { productVariantsCreated: hook }, execution(selected, session));
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const key = host.newRequestKey(), value = input("maximum");
      let calls = 1;
      const result = await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      console.info("Complete managed Inventory workflow bounded calls:", calls);
      expect(calls).toBeGreaterThan(128);
      expect(calls).toBeLessThanOrEqual(productVariantInventoryResources.calls);
      expect(result).toHaveLength(4);
      expect(result.every(variant => variant.manage_inventory === true && variant.prices.length === 2)).toBe(true);
      expect((await rows()).length - beforeRows.length).toBe(40);
      const emitted = (await events()).slice(beforeEvents.length);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(emitted.map(event => event.envelope.contract).sort()).toEqual([
        "LinkProductVariantInventoryItem.attached", "LinkProductVariantPriceSet.attached",
        ...Array.from({ length: 4 }, () => "product.product-variant.created"),
        ...Array.from({ length: 4 }, () => "inventory.inventory-item.created"),
        ...Array.from({ length: 4 }, () => "pricing.price-set.created"),
        ...Array.from({ length: 8 }, () => "pricing.price.created"),
        ...Array.from({ length: 8 }, () => "pricing.price-rule.created"),
        ...Array.from({ length: 4 }, () => "product-variant.created"),
      ].sort());
      expect(emitted.filter(event => event.envelope.contract === "product-variant.created").map(event => event.envelope.message)).toMatchObject(
        result.map(variant => ({ data: { id: variant.id } })));
      expect(statements.filter(statement => statement.includes(".fx_accept_app_publication("))).toHaveLength(1);
      expect(statements.filter(statement => statement.includes(".fx_apply_app_publication("))).toHaveLength(1);
      const latest = emitted.at(-1);
      if (!latest) throw new Error("Missing Inventory publication");
      expect((await selected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges)).filter(fact => fact.commitSeq === latest.commitSeq)).toHaveLength(40);
      const committedRows = await rows(), committedEvents = await events();
      expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
      expect(hook).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
      expect((await selected.fixture.persistence.query<{ name: string }>("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
        .toEqual(selected.fixture.physicalTablesBeforeCandidate);
    } finally { await Effect.runPromise(host.close); }
  });

  it("keeps supplied item quantities and executes the unmanaged empty children", async () => {
    await seedItems(selected, [{ id: "supplied-a", sku: null }, { id: "supplied-b", sku: null }]);
    await seedProduct(selected, "supplied-product");
    const hook: NonNullable<ProductVariantInventoryHooks["productVariantsCreated"]> = async ({ product_variants }, { resources }) => {
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["variant_id", "inventory_item_id", "required_quantity"],
        filters: { variant_id: product_variants.map(variant => variant.id) }, pagination: { take: 8 } });
      expect(links.data).toHaveLength(8);
      expect(links.data.filter(link => link.inventory_item_id === "supplied-a").map(link => link.required_quantity)).toEqual([3, 3, 3, 3]);
      expect(links.data.filter(link => link.inventory_item_id === "supplied-b").map(link => link.required_quantity)).toEqual([1, 1, 1, 1]);
    };
    const host = await prepare(selected, { productVariantsCreated: hook });
    try {
      const value = input("supplied");
      await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: value.product_variants.map(variant => ({ ...variant,
        inventory_items: [{ inventory_item_id: "supplied-a", required_quantity: 3 }, { inventory_item_id: "supplied-b" }] })) }));
    } finally { await Effect.runPromise(host.close); }
    await seedProduct(selected, "unmanaged-product");
    const items = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems");
    const levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const stock = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations");
    const inventoryRead = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems");
    const unmanaged = await prepare(selected, { productVariantsCreated: async ({ product_variants }, { resources }) => {
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["id"], filters: { variant_id: product_variants.map(row => row.id) }, pagination: { take: 8 } });
      expect(links.data).toEqual([]);
    } });
    try {
      expect(await Effect.runPromise(unmanaged.run(unmanaged.newRequestKey(), { product_variants: input("unmanaged", 1).product_variants.map(variant => ({ ...variant, manage_inventory: false })) })))
        .toMatchObject([{ manage_inventory: false }]);
      expect(items.mock.calls.map(call => call[0])).toEqual([[]]);
      expect(levels.mock.calls.map(call => call[0])).toEqual([[]]);
      expect(stock.mock.calls.map(call => call[0])).toEqual([{ id: [] }]);
      expect(inventoryRead.mock.calls.map(call => call[0])).toEqual([{ id: [] }]);
    } finally { items.mockRestore(); levels.mockRestore(); stock.mockRestore(); inventoryRead.mockRestore(); await Effect.runPromise(unmanaged.close); }
  });

  it("preserves input positions across supplied, default, and unmanaged variants", async () => {
    await seedProduct(selected, "mixed-product");
    await seedItems(selected, [{ id: "mixed-supplied", sku: null }]);
    const host = await prepare(selected, { productVariantsCreated: async ({ product_variants }, { resources }) => {
      expect(product_variants.map(row => row.id)).toEqual(input("mixed").product_variants.map(row => row.id));
      const links = await resources.query.graph({ entity: "product_variant_inventory_items", fields: ["variant_id", "inventory_item_id", "required_quantity"],
        filters: { variant_id: product_variants.map(row => row.id) }, pagination: { take: 8 } });
      expect(links.data).toHaveLength(3);
      expect(links.data.filter(row => row.variant_id === "mixed-variant-0")).toEqual([
        { variant_id: "mixed-variant-0", inventory_item_id: "mixed-supplied", required_quantity: 5 },
      ]);
      expect(links.data.filter(row => row.variant_id === "mixed-variant-2")).toEqual([]);
      for (const index of [1, 3]) {
        const link = links.data.find(row => row.variant_id === "mixed-variant-" + index);
        if (!link) throw new Error("Missing default item association");
        const item = await resources.query.graph({ entity: "inventory_item", fields: ["sku", "title", "description", "requires_shipping"],
          filters: { id: [link.inventory_item_id] }, pagination: { take: 1 } });
        expect(item.data).toEqual([{ sku: "mixed-sku-" + index, title: "mixed " + index, description: "mixed " + index, requires_shipping: true }]);
        expect(link.required_quantity).toBe(1);
      }
    } });
    try {
      const variants = input("mixed").product_variants.map((variant, index) => index === 0
        ? { ...variant, inventory_items: [{ inventory_item_id: "mixed-supplied", required_quantity: 5 }] }
        : index === 2 ? { ...variant, manage_inventory: false } : variant);
      await Effect.runPromise(host.run(host.newRequestKey(), { product_variants: variants }));
    } finally { await Effect.runPromise(host.close); }
  });

  it("retains the refusal witness for a smaller trusted call allowance", async () => {
    await seedProduct(selected, "budget-product");
    const root = execution(selected);
    const host = await prepare(selected, {}, { ...root, prepare: composition => root.prepare({ ...composition, requestCallLimit: 128 }) });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input("budget"))));
      if (Result.isSuccess(outcome)) throw new Error("128-call witness unexpectedly succeeded");
      expect(nativeFailure(outcome.failure)).toMatchObject({ reason: "limitExceeded" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back native missing and duplicate Inventory IDs and duplicate SKU", async () => {
    await seedItems(selected, [{ id: "duplicate-supplied", sku: null }]);
    for (const [name, items] of [["missing", [{ inventory_item_id: "missing-id" }]], ["duplicate", [{ inventory_item_id: "duplicate-supplied" }, { inventory_item_id: "duplicate-supplied" }]]] as const) {
      await seedProduct(selected, name + "-product");
      const host = await prepare(selected);
      try {
        const beforeRows = await rows(), beforeEvents = await events();
        const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { product_variants: input(name, 1).product_variants.map(variant => ({ ...variant, inventory_items: [...items] })) })));
        if (Result.isSuccess(outcome)) throw new Error("Native Inventory validation unexpectedly succeeded");
        expect(nativeFailure(outcome.failure)).toMatchObject({ type: "invalid_data", message: name === "missing"
          ? "Inventory Items with ids: missing-id was not found" : "Cannot associate duplicate inventory items to variant(s) duplicate-variant-0" });
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
    await seedItems(selected, [{ id: "sku-existing", sku: "duplicate-inventory-sku" }]);
    await seedProduct(selected, "sku-product");
    const host = await prepare(selected);
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { product_variants: input("sku", 1).product_variants.map(variant => ({ ...variant, sku: "duplicate-inventory-sku" })) }))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back after the complete graph and keeps caught nonempty levels fatal", async () => {
    const hooks: NonNullable<ProductVariantInventoryHooks["productVariantsCreated"]>[] = [
      () => { throw new Error("late inventory failure"); },
      async (_value, { container }) => { try { await container.resolve<{ createInventoryLevels(input: unknown): Promise<unknown> }>("inventory").createInventoryLevels([{ inventory_item_id: "supplied-a", location_id: "somewhere", stocked_quantity: 1 }]); } catch {} },
      async (_value, { container }) => { try { await container.resolve<{ retrieveAvailableQuantity(input: unknown): Promise<unknown> }>("inventory").retrieveAvailableQuantity("supplied-a"); } catch {} },
      async (_value, { container }) => { try { await container.resolve<{ createReservationItems(input: unknown): Promise<unknown> }>("inventory").createReservationItems([]); } catch {} },
      async (_value, { resources, eventGroupId }) => { await resources.event_bus.emit([{ name: "product-variant.created", data: { id: "uncreated-variant" }, metadata: { eventGroupId } }]); },
    ];
    for (const [index, hook] of hooks.entries()) {
      const prefix = "late-" + index; await seedProduct(selected, prefix + "-product");
      const reached = vi.fn(hook), host = await prepare(selected, { productVariantsCreated: reached });
      try {
        const beforeRows = await rows(), beforeEvents = await events();
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input(prefix, 1)))).rejects.toMatchObject({ _tag: "CommerceTransactionError" });
        expect(reached).toHaveBeenCalledTimes(1); expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  });

  it("cancels pending native work and revokes escaped Inventory methods", async () => {
    await seedProduct(selected, "cancel-product");
    const reached = await Effect.runPromise(Deferred.make<void>());
    let release: (() => void) | undefined;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let escaped: ((input: unknown) => Promise<unknown>) | undefined;
    const host = await prepare(selected, { productVariantsCreated: async (_value, { container }) => {
      escaped = container.resolve<{ createInventoryItems(input: unknown): Promise<unknown> }>("inventory").createInventoryItems;
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await waiting;
    } });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(host.run(host.newRequestKey(), input("cancel", 1)));
        yield* Deferred.await(reached).pipe(Effect.timeout(20_000)); yield* Fiber.interrupt(fiber);
      })));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      if (!escaped) throw new Error("Missing escaped Inventory method");
      await expect(escaped([])).rejects.toMatchObject({ reason: "closed" });
    } finally { release?.(); await Effect.runPromise(host.close); }
  }, 120_000);

  it("recovers an uncertain commit without repeating the native hook or rows", async () => {
    await seedProduct(selected, "uncertain-product");
    let lose = true;
    const session = issueRelationalSession(selected.fixture.persistence.drizzle, (profile, work) => runRelationalSession(selected.fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Inventory COMMIT acknowledgement") })); }),
    ));
    const hook = vi.fn<NonNullable<ProductVariantInventoryHooks["productVariantsCreated"]>>(() => undefined);
    const host = await prepare(selected, { productVariantsCreated: hook }, execution(selected, session));
    try { const key = host.newRequestKey(), value = input("uncertain", 1), result = await Effect.runPromise(host.run(key, value));
      const committedRows = await rows(), committedEvents = await events();
      expect(lose).toBe(false); expect(await Effect.runPromise(host.run(key, value))).toEqual(result); expect(hook).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("isolates matching Product and Inventory identities across shops", async () => {
    const other = await connect(await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: selected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_shop_b", projectId: "inventory_shop_b", uuidOffset: 4_000 },
      includeProduct: true, includePricing: true, includeVariantInventory: true }));
    for (const connected of [selected, other]) { await seedProduct(connected, "shared-product"); await seedItems(connected, [{ id: "shared-inventory", sku: "shared-sku" }]); }
    const first = await prepare(selected), second = await prepare(other);
    const value = { product_variants: input("shared", 1).product_variants.map(variant => ({ ...variant, inventory_items: [{ inventory_item_id: "shared-inventory", required_quantity: 2 }] })) };
    try {
      const firstResult = await Effect.runPromise(first.run(first.newRequestKey(), value));
      const scope = projectScopeIdUuidV1(selected.fixture.application.authority.scopeId).scopeUuid;
      const before = (await rows()).filter(row => row.scopeUuid === scope);
      expect(await Effect.runPromise(second.run(second.newRequestKey(), value))).toMatchObject(firstResult.map(variant => ({ id: variant.id, product_id: variant.product_id })));
      expect((await rows()).filter(row => row.scopeUuid === scope)).toEqual(before);
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 150_000);
});
