import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { productBatchResources } from "../src/workflow/policy";
import { prepareLogicalProductBatch } from "./support/logical-product-batch-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductBatch>>;
let reader: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);
const readProducts = (ids: readonly string[]) => Effect.runPromise(reader.host.read(reader.runtime.commands.internalProductList,
  { filters: { id: [...ids] }, config: { relations: ["variants", "options", "images"] } }));
const eventData = Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
const eventIds = (selected: Awaited<ReturnType<typeof events>>, name: string) => selected.filter(event => event.envelope.contract === name).flatMap(event => {
  const id = eventData(event.envelope.message).data.id; return typeof id === "string" ? [id] : id;
});
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value === null || typeof value !== "object") return [];
  const reason: unknown = Object.getOwnPropertyDescriptor(value, "reason")?.value, cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : reasons(cause))];
}
async function atStage<A>(stage: string, work: () => Promise<A>): Promise<A> {
  try { return await work(); }
  catch (cause) { throw new Error(stage + ": " + reasons(cause).join(">"), { cause }); }
}
async function runAtStage<A, E>(stage: string, work: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(work);
  if (exit._tag === "Failure") throw new Error(stage + ": " + reasons(exit.cause).join(">"), { cause: exit.cause });
  return exit.value;
}
function failureMessages(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failureMessages(reason.error)
    : reason._tag === "Die" ? failureMessages(reason.defect) : []);
  if (value === null || typeof value !== "object") return [];
  const message: unknown = Object.getOwnPropertyDescriptor(value, "message")?.value, cause: unknown = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof message === "string" ? [message] : []), ...(cause === undefined ? [] : failureMessages(cause))];
}
const newVariants = (prefix: string, option = "Size", count = 2) => Array.from({ length: count }, (_, index) => ({
  id: prefix + "-variant-" + index, title: "New " + index, sku: prefix + "-sku-" + index, options: { [option]: String(index) },
  prices: [{ currency_code: "USD", amount: "123.4567890123456789", rules: { region_id: "new" } },
    { currency_code: "EUR", amount: 200, rules: { region_id: "new" } }],
}));
const newProduct = (prefix: string, variants = newVariants(prefix)) => ({
  id: prefix + "-product", title: prefix, handle: prefix + "-handle", variants,
  options: [{ title: "Size", values: ["0", "1", "2", "3"] }],
  images: [0, 1].map(index => ({ url: "https://example.test/" + prefix + "/" + index })),
  tag_ids: [0, 1, 2, 3].map(index => "replacement-tag-" + index), category_ids: [0, 1, 2, 3].map(index => "replacement-category-" + index),
  sales_channels: [{ id: "replacement-channel-0" }, { id: "replacement-channel-1" }], shipping_profile_id: "replacement-profile-0",
});

describe("native Product and Variant batches over real shared storage", () => {
  beforeAll(async () => {
    connected = await prepareLogicalProductBatch(driver, close => cleanup.push(close));
    reader = await prepareLogicalProductHost(connected.fixture);
    await Effect.runPromise(reader.host.initialize([])); cleanup.push(() => Effect.runPromise(reader.host.close));
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("preserves the distinct native empty Product and Variant branch behavior", async () => {
    const product = await connected.prepareProduct(), variant = await connected.prepareVariant();
    const createProducts = vi.spyOn(ProductModuleService.prototype, "createProducts"), createVariants = vi.spyOn(ProductModuleService.prototype, "createProductVariants");
    const items = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems"), levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const pricing = vi.spyOn(PricingModuleService.prototype, "createPriceSets");
    try {
      expect(await Effect.runPromise(product.run(product.newRequestKey(), {}))).toEqual({ created: [], updated: [], deleted: [] });
      expect(createProducts).not.toHaveBeenCalled(); expect(createVariants).not.toHaveBeenCalled(); expect(items).not.toHaveBeenCalled();
      expect(await Effect.runPromise(variant.run(variant.newRequestKey(), {}))).toEqual({ created: [], updated: [], deleted: [] });
      expect(createProducts).not.toHaveBeenCalled(); expect(createVariants).toHaveBeenCalledTimes(1);
      expect(items).toHaveBeenCalledTimes(1); expect(levels).toHaveBeenCalledTimes(1); expect(pricing).toHaveBeenCalledTimes(1);
      expect(createVariants.mock.calls[0]?.[0]).toEqual([]); expect(items.mock.calls[0]?.[0]).toEqual([]);
    } finally { createProducts.mockRestore(); createVariants.mockRestore(); items.mockRestore(); levels.mockRestore(); pricing.mockRestore(); }
  });

  it("executes the complete mixed Product envelope with four old and four incoming Variants in one commit", async () => {
    const seeded = await atStage("maximum Product seedGraph", () => connected.seedGraph("batch-product-max", [2, 1, 1]));
    await atStage("maximum Product seedStock", () => connected.seedStock("batch-product-max", seeded.itemIds));
    const updated = seeded.products[0]!, deleted = seeded.products.slice(1).map(product => product.id);
    const input = { create: [newProduct("batch-product-created")], update: [{ id: updated.id, title: "Updated maximum",
      options: [{ title: "Finish", values: ["0", "1", "2", "3"] }], variants: newVariants("batch-product-updated", "Finish"),
      images: [0, 1].map(index => ({ url: "https://example.test/batch-product-updated/" + index })),
      tag_ids: [0, 1, 2, 3].map(index => "replacement-tag-" + index), category_ids: [0, 1, 2, 3].map(index => "replacement-category-" + index),
      sales_channels: [{ id: "replacement-channel-0" }, { id: "replacement-channel-1" }], shipping_profile_id: "replacement-profile-0" }], delete: deleted };
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const limited = await connected.prepareProduct({ ...connected.execution, prepare: composition => connected.execution.prepare({ ...composition, requestCallLimit: 512 }) });
    const refused = await Effect.runPromise(Effect.result(limited.run(limited.newRequestKey(), input)));
    expect(refused).toMatchObject({ _tag: "Failure" }); expect(reasons(refused._tag === "Failure" ? refused.failure : undefined)).toContain("limitExceeded");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    const host = await connected.prepareProduct(), key = host.newRequestKey();
    let calls = 0;
    const result = await runAtStage("maximum Product batch run", host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    const emitted = (await events()).slice(beforeEvents.length);
    console.info("Native Product batch maximum", "calls", calls, "events", emitted.length);
    expect(calls).toBeGreaterThan(512); expect(calls).toBeLessThanOrEqual(productBatchResources.calls); expect(emitted.length).toBeLessThanOrEqual(productBatchResources.eventMessages);
    expect(result).toMatchObject({ created: [{ id: input.create[0]!.id, variants: [{ id: "batch-product-created-variant-0" }, { id: "batch-product-created-variant-1" }] }],
      updated: [{ id: updated.id, title: "Updated maximum", variants: [{ id: "batch-product-updated-variant-0" }, { id: "batch-product-updated-variant-1" }] }], deleted });
    expect((await commits()).length - beforeCommits.length).toBe(1);
    expect(eventIds(emitted, "product.created")).toEqual([input.create[0]!.id]); expect(eventIds(emitted, "product.updated")).toEqual([updated.id]);
    expect(eventIds(emitted, "product.deleted")).toEqual(deleted); expect(eventIds(emitted, "product-variant.created")).toEqual(input.create[0]!.variants.map(variant => variant.id));
    expect(await readProducts(deleted)).toEqual([]);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list, { filters: { id: [...seeded.priceSets.values()] }, config: { relations: ["prices"] } }))).toEqual([]);
    const settledRows = await rows(), settledEvents = await events();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(await rows()).toEqual(settledRows); expect(await events()).toEqual(settledEvents);
  }, 240_000);

  it("executes mixed Product branches at the complete 32-edge inverse ownership ceiling", async () => {
    const prefix = "batch-inverse-max", seeded = await atStage("inverse maximum seedGraph", () => connected.seedGraph(prefix, [2, 2]));
    const foreign = await atStage("inverse maximum foreign owners", () => connected.seedForeignOwners(prefix + "-foreign", seeded.itemIds));
    await atStage("inverse maximum seedStock", () => connected.seedStock(prefix, seeded.itemIds));
    const oldIds = seeded.products.flatMap(product => product.variants.map(variant => variant.id));
    const foreignIds = foreign.flatMap(product => product.variants.map(variant => variant.id)), inverseIds = new Set([...oldIds, ...foreignIds]);
    expect(oldIds).toHaveLength(4); expect(foreignIds).toHaveLength(24); expect(inverseIds.size).toBe(28);
    const links = await Effect.runPromise(makeCommerceHost({ ...connected.inventory.link.hostInput, commands: connected.variantDeletionLinks.commands }));
    const inventory = await Effect.runPromise(makeCommerceHost(connected.inventory.inventory.hostInput));
    const decodeLinks = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String,
      inventory_item_id: Schema.String, required_quantity: Schema.Number })), Schema.Number]));
    const readLinks = async () => decodeLinks(await Effect.runPromise(links.read(connected.variantDeletionLinks.countInventory,
      { filters: { inventory_item_id: seeded.itemIds }, config: { select: ["id", "variant_id", "inventory_item_id", "required_quantity"], take: 32, order: { variant_id: "ASC" } } })));
    const count = vi.spyOn(ProductModuleService.prototype, "listAndCountProductVariants");
    try {
      const [beforeLinks, beforeCount] = await readLinks();
      expect(beforeCount).toBe(32); expect(beforeLinks).toHaveLength(32);
      expect(new Set(beforeLinks.map(link => link.variant_id))).toEqual(inverseIds);
      for (const item of seeded.itemIds) expect(beforeLinks.filter(link => link.inventory_item_id === item)).toHaveLength(4);
      const foreignSet = new Set(foreignIds), originalForeignLinks = beforeLinks.filter(link => foreignSet.has(link.variant_id));
      expect(originalForeignLinks).toHaveLength(24);
      const host = await connected.prepareProduct(), beforeEvents = await events(), beforeCommits = await commits();
      let calls = 0;
      const result = await runAtStage("inverse maximum mixed Product run", host.run(host.newRequestKey(), {
        create: [newProduct(prefix + "-created")], update: [{ id: seeded.products[0]!.id, title: "inverse maximum retained update" }],
        delete: seeded.products.map(product => product.id),
      }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      const observedInverse = count.mock.calls.flatMap(([filters]) => Array.isArray(filters?.id) ? [filters.id] : []);
      expect(observedInverse.some(ids => new Set(ids).size === 28 && [...inverseIds].every(id => ids.includes(id)))).toBe(true);
      expect(result.updated).toMatchObject([{ id: seeded.products[0]!.id, title: "inverse maximum retained update" }]);
      expect(result.updated[0]!.variants.map(variant => variant.id)).toEqual(seeded.products[0]!.variants.map(variant => variant.id));
      expect(new Set([...result.created, ...result.updated].flatMap(product => product.variants.map(variant => variant.id))).size).toBe(4);
      expect(result.deleted).toEqual(seeded.products.map(product => product.id));
      const emitted = (await events()).slice(beforeEvents.length);
      console.info("Native Product batch inverse maximum", "calls", calls, "events", emitted.length);
      expect(calls).toBeLessThanOrEqual(productBatchResources.calls); expect(emitted.length).toBeLessThanOrEqual(productBatchResources.eventMessages);
      expect((await commits()).length - beforeCommits.length).toBe(1);
      const [afterLinks, afterCount] = await readLinks();
      expect(afterCount).toBe(24); expect(afterLinks).toEqual(originalForeignLinks);
      expect(await Effect.runPromise(inventory.read(connected.inventory.inventory.runtime.count,
        { filters: { id: seeded.itemIds }, config: { select: ["id"], take: 8 } })))
        .toEqual([seeded.itemIds.map(id => ({ id })), 8]);
      for (let offset = 0; offset < foreign.length; offset += 4) {
        const products = await readProducts(foreign.slice(offset, offset + 4).map(product => product.id));
        expect(products).toEqual(expect.arrayContaining(foreign.slice(offset, offset + 4).map(product => expect.objectContaining({ id: product.id,
          variants: expect.arrayContaining(product.variants.map(variant => expect.objectContaining({ id: variant.id, product_id: product.id }))) }))));
      }
      expect(await readProducts(seeded.products.map(product => product.id))).toEqual([]);
    } finally { count.mockRestore(); await Effect.runPromise(links.close); await Effect.runPromise(inventory.close); }
  }, 240_000);

  it("runs native Variant create/update/delete children and retains requested missing and duplicate delete IDs", async () => {
    const seeded = await atStage("mixed Variant seedGraph", () => connected.seedGraph("batch-variant-mixed", [3])), product = seeded.products[0]!;
    const update = product.variants[0]!, removal = product.variants[1]!, keep = product.variants[2]!;
    const host = await connected.prepareVariant(), beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const input = { create: [{ ...newVariants("batch-variant-created", "Size", 1)[0]!, product_id: product.id }],
      update: [{ id: update.id, title: "Native variant edit", prices: [{ currency_code: "USD", amount: 99, rules: { region_id: "changed" } }] }], delete: [removal.id, "missing-variant"] };
    const invalid = await Effect.runPromiseExit(host.run(host.newRequestKey(), input));
    expect(invalid._tag).toBe("Failure");
    if (invalid._tag === "Failure") {
      expect(reasons(invalid.cause)).toContain("adapterFailure");
      expect(reasons(invalid.cause)).not.toContain("deadlineExceeded");
      expect(failureMessages(invalid.cause)).toContain("Variant (Old 0) with provided options already exists.");
    }
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    const result = await runAtStage("mixed Variant batch run", host.run(host.newRequestKey(), {
      ...input, create: input.create.map(variant => ({ ...variant, options: { Size: "3" } })),
    }));
    expect(result).toMatchObject({ created: [{ id: "batch-variant-created-variant-0" }], updated: [{ id: update.id, title: "Native variant edit" }], deleted: [removal.id, "missing-variant"] });
    const emitted = (await events()).slice(beforeEvents.length);
    expect(eventIds(emitted, "product-variant.created")).toEqual(["batch-variant-created-variant-0"]);
    expect(eventIds(emitted, "product-variant.updated")).toEqual([update.id]); expect(eventIds(emitted, "product-variant.deleted")).toEqual([removal.id, "missing-variant"]);
    expect((await commits()).length - beforeCommits.length).toBe(1);
    expect(await readProducts([product.id])).toMatchObject([{ variants: expect.arrayContaining([expect.objectContaining({ id: keep.id, title: expect.any(String) })]) }]);
    const duplicate = await runAtStage("mixed Variant duplicate deletion run", host.run(host.newRequestKey(), { delete: [keep.id, keep.id] }));
    expect(duplicate.deleted).toEqual([keep.id, keep.id]);
  }, 240_000);

  it("executes the maximum Variant deletion closure with genuine empty creation and update siblings", async () => {
    const seeded = await connected.seedGraph("batch-variant-delete-max", [4]); await connected.seedStock("batch-variant-delete-max", seeded.itemIds);
    const host = await connected.prepareVariant(), ids = seeded.products[0]!.variants.map(variant => variant.id), before = await events();
    let calls = 0;
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { delete: ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    const emitted = (await events()).slice(before.length);
    console.info("Native Variant batch deletion maximum", "calls", calls, "events", emitted.length);
    expect(result).toEqual({ created: [], updated: [], deleted: ids }); expect(calls).toBeLessThanOrEqual(productBatchResources.calls);
    expect(emitted.length).toBeLessThanOrEqual(productBatchResources.eventMessages); expect(eventIds(emitted, "product-variant.deleted")).toEqual(ids);
    expect(await readProducts([seeded.products[0]!.id])).toMatchObject([{ variants: [] }]);
  }, 240_000);

  it("creates four Variants with eight existing Inventory links while its empty siblings still execute", async () => {
    const endpoints = await atStage("maximum Variant creation endpoint seedGraph", () => connected.seedGraph("batch-variant-create-items", [4]));
    const target = await atStage("maximum Variant creation target seedGraph", () => connected.seedGraph("batch-variant-create-target", [0]));
    const input = { create: newVariants("batch-variant-create-max", "Size", 4).map((variant, index) => ({ ...variant,
      product_id: target.products[0]!.id, inventory_items: [0, 1].map(item => ({ inventory_item_id: endpoints.itemIds[index * 2 + item]!, required_quantity: item + 1 })),
    })) };
    const host = await connected.prepareVariant(), before = await events();
    let calls = 0;
    const result = await runAtStage("maximum Variant creation batch run", host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    const emitted = (await events()).slice(before.length);
    console.info("Native Variant batch creation maximum", "calls", calls, "events", emitted.length);
    expect(result).toMatchObject({ created: input.create.map(variant => ({ id: variant.id })), updated: [], deleted: [] });
    expect(calls).toBeLessThanOrEqual(productBatchResources.calls); expect(emitted.length).toBeLessThanOrEqual(productBatchResources.eventMessages);
    expect(eventIds(emitted, "product-variant.created")).toEqual(input.create.map(variant => variant.id));
  }, 240_000);

  it("refuses total entry and incoming Variant overflow without publishing any branch", async () => {
    const host = await connected.prepareProduct(), variant = await connected.prepareVariant();
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    for (const input of [{ create: [newProduct("batch-overflow", [])], delete: ["1", "2", "3", "4"] },
      { create: [newProduct("batch-incoming-a", newVariants("batch-incoming-a", "Size", 3)), newProduct("batch-incoming-b", newVariants("batch-incoming-b", "Size", 2))] }])
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
    expect(await Effect.runPromise(Effect.result(variant.run(variant.newRequestKey(), { update: [{ id: "a" }], delete: ["1", "2", "3", "4"] })))).toMatchObject({ _tag: "Failure" });
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
  });

  it("rolls back a completed native sibling creation when deletion refuses a genuinely reserved Inventory item", async () => {
    const prefix = "batch-reserved", seeded = await connected.seedGraph(prefix, [1]);
    await connected.seedStock(prefix, seeded.itemIds, 1);
    const host = await connected.prepareProduct(), originalCreate = ProductModuleService.prototype.createProducts;
    const originalCount = InventoryModuleService.prototype.listAndCountInventoryItems;
    let siblingWritten = false, reservedReadAfterWrite = false;
    const create = vi.spyOn(ProductModuleService.prototype, "createProducts").mockImplementation(async function (this: ProductModuleService, ...args) {
      const result = await Reflect.apply(originalCreate, this, args);
      siblingWritten = true;
      return result;
    });
    const count = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      if (args[1]?.select?.includes("reserved_quantity")) {
        // Observe the native read boundary without parking a sibling inside the
        // queued operation owner. The real creation must already have written.
        expect(siblingWritten).toBe(true);
        reservedReadAfterWrite = true;
      }
      return Reflect.apply(originalCount, this, args);
    });
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    try {
      const result = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
        create: [newProduct("batch-reserved-sibling", [])], delete: [seeded.products[0]!.id],
      }));
      expect(siblingWritten).toBe(true); expect(reservedReadAfterWrite).toBe(true);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(failureMessages(result.cause)).toContain(
        `Cannot remove following inventory item(s) since they have reservations: [${seeded.itemIds.join(", ")}].`);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    } finally { create.mockRestore(); count.mockRestore(); }
  }, 240_000);

  it("enforces the combined old and returned Variant cohorts from authenticated activity", async () => {
    const left = await connected.seedGraph("batch-old-left", [3]), right = await connected.seedGraph("batch-old-right", [2]);
    const host = await connected.prepareProduct(), beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const old = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { update: [{ id: left.products[0]!.id, title: "must roll back" }], delete: [right.products[0]!.id] })));
    expect(old).toMatchObject({ _tag: "Failure" }); expect(reasons(old._tag === "Failure" ? old.failure : undefined)).toContain("unsupportedProfile");
    const incoming = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { create: [newProduct("batch-returned-overflow")], update: [{ id: left.products[0]!.id, title: "retains three" }] })));
    expect(incoming).toMatchObject({ _tag: "Failure" }); expect(reasons(incoming._tag === "Failure" ? incoming.failure : undefined)).toContain("unsupportedProfile");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
  }, 240_000);

  it("admits four initial Variants across title-only and id-only Product updates", async () => {
    const seeded = await connected.seedGraph("batch-retained-four", [3, 1]);
    const left = seeded.products[0]!, right = seeded.products[1]!;
    const host = await connected.prepareProduct(), beforeEvents = await events(), beforeCommits = await commits();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), {
      update: [{ id: left.id, title: "Retains three Variants" }, { id: right.id }],
    }));
    expect(result).toMatchObject({ created: [], deleted: [], updated: [
      { id: left.id, title: "Retains three Variants", variants: left.variants.map(variant => ({ id: variant.id })) },
      { id: right.id, title: right.title, variants: right.variants.map(variant => ({ id: variant.id })) },
    ] });
    expect(await readProducts([left.id, right.id])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: left.id, title: "Retains three Variants", variants: expect.arrayContaining(left.variants.map(variant => expect.objectContaining({ id: variant.id }))) }),
      expect.objectContaining({ id: right.id, title: right.title, variants: expect.arrayContaining(right.variants.map(variant => expect.objectContaining({ id: variant.id }))) }),
    ]));
    const emitted = (await events()).slice(beforeEvents.length);
    expect(eventIds(emitted, "product.updated")).toEqual([left.id, right.id]);
    expect(eventIds(emitted, "product-variant.updated")).toEqual([]);
    expect((await commits()).length - beforeCommits.length).toBe(1);
  }, 240_000);

  it("refuses five initial Variants even when replacement removes the updated Product's old Variants", async () => {
    const left = await connected.seedGraph("batch-replaced-old-left", [3]), right = await connected.seedGraph("batch-replaced-old-right", [2]);
    const host = await connected.prepareProduct(), beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
      update: [{ id: left.products[0]!.id, variants: newVariants("batch-replaced-overflow", "Size", 1) }],
      delete: [right.products[0]!.id],
    })));
    expect(result).toMatchObject({ _tag: "Failure" });
    expect(reasons(result._tag === "Failure" ? result.failure : undefined)).toContain("unsupportedProfile");
    expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
    expect(await readProducts([left.products[0]!.id, right.products[0]!.id])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: left.products[0]!.id, variants: expect.arrayContaining(left.products[0]!.variants.map(variant => expect.objectContaining({ id: variant.id }))) }),
      expect.objectContaining({ id: right.products[0]!.id, variants: expect.arrayContaining(right.products[0]!.variants.map(variant => expect.objectContaining({ id: variant.id }))) }),
    ]));
  }, 240_000);

  it("retains a shared Inventory endpoint while removing only the selected Variant's links", async () => {
    const seeded = await connected.seedGraph("batch-shared", [2]), product = seeded.products[0]!, selected = product.variants[0]!, outside = product.variants[1]!;
    await connected.dismissInventory(outside.id, seeded.itemIds[3]!);
    await connected.attachInventory(outside.id, seeded.itemIds[0]!);
    const host = await connected.prepareVariant();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { update: [{ id: outside.id, title: "retained owner" }], delete: [selected.id] })))
      .toMatchObject({ updated: [{ id: outside.id }], deleted: [selected.id] });
    const inventory = await Effect.runPromise(makeCommerceHost(connected.inventory.inventory.hostInput));
    try {
      const itemRead = await Effect.runPromise(inventory.read(connected.inventory.inventory.runtime.count,
        { filters: { id: [seeded.itemIds[0]!] }, config: { select: ["id"] } }));
      expect(itemRead).toEqual([[{ id: seeded.itemIds[0]! }], 1]);
    } finally { await Effect.runPromise(inventory.close); }
  }, 240_000);

  it.each(["product", "variant"] as const)("keeps overlapping %s update/delete targets native and atomic without a disjoint-input rule", async kind => {
    const seeded = await connected.seed("batch-overlap-" + kind), product = seeded[0]!;
    const id = kind === "product" ? product.id : product.variants[0]!.id;
    const upsert = vi.spyOn(ProductModuleService.prototype, kind === "product" ? "upsertProducts" : "upsertProductVariants");
    const deletion = vi.spyOn(ProductModuleService.prototype, kind === "product" ? "softDeleteProducts" : "softDeleteProductVariants");
    const beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    try {
      const input = { update: [{ id, title: "overlapping edit" }], delete: [id] };
      const run = async () => {
        if (kind === "product") {
          const host = await connected.prepareProduct();
          return Effect.runPromiseExit(host.run(host.newRequestKey(), input));
        }
        const host = await connected.prepareVariant();
        return Effect.runPromiseExit(host.run(host.newRequestKey(), input));
      };
      const result = await run();
      console.info("Native overlapping batch", kind, "outcome", result._tag, "reasons", result._tag === "Failure" ? reasons(result.cause).join(">") : "",
        "upsert calls", upsert.mock.calls.length, "delete calls", deletion.mock.calls.length);
      if (result._tag === "Failure") {
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents); expect(await commits()).toEqual(beforeCommits);
        throw new Error("Native overlapping " + kind + " batch: " + reasons(result.cause).join(">"), { cause: result.cause });
      }
      expect(upsert).toHaveBeenCalledTimes(1); expect(deletion).toHaveBeenCalledTimes(1);
      expect(upsert.mock.calls[0]?.[0]).toMatchObject([{ id, title: "overlapping edit" }]);
      expect(deletion.mock.calls[0]?.[0]).toEqual([id]);
      expect(result.value).toMatchObject({ updated: [{ id, title: "overlapping edit" }], deleted: [id] });
      const emitted = (await events()).slice(beforeEvents.length), family = kind === "product" ? "product" : "product-variant";
      expect(eventIds(emitted, family + ".updated")).toEqual([id]);
      expect(eventIds(emitted, family + ".deleted")).toEqual([id]);
      if (kind === "product") expect(await readProducts([product.id])).toEqual([]);
      else expect(await readProducts([product.id])).toMatchObject([{ id: product.id, variants: [] }]);
      expect((await commits()).length - beforeCommits.length).toBe(1);
    } finally { upsert.mockRestore(); deletion.mockRestore(); }
  }, 240_000);
});
