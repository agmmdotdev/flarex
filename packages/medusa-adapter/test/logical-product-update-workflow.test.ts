import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Effect, Schema } from "effect";
import { ProductModuleService } from "@medusajs/product/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { prepareProductCreateWorkflow } from "../src/workflows/product/create";
import { prepareProductUpdateWorkflow } from "../src/workflows/product/update";
import { productUpdateResources } from "../src/workflow/policy";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { inspectCapturedPrivateJsonData } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { prepareLogicalProductUpdate } from "./support/logical-product-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const Id = Schema.decodeUnknownSync(Schema.String);
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalProductUpdate>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents).orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits);

function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => {
    switch (reason._tag) {
      case "Fail": return failurePath(reason.error);
      case "Die": return failurePath(reason.defect);
      case "Interrupt": return [reason._tag];
    }
  });
  if (value === null || typeof value !== "object") return [];
  const reason = Object.getOwnPropertyDescriptor(value, "reason")?.value;
  const cause = Object.getOwnPropertyDescriptor(value, "cause")?.value;
  return [...(typeof reason === "string" ? [reason] : []), ...(cause === undefined ? [] : failurePath(cause))];
}

describe("complete native Product update workflow", () => {
  beforeAll(async () => { connected = await prepareLogicalProductUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("reconciles four Products and four variants, prices, Inventory dismissal and both Product Link replacements in one root", async () => {
    const seeded = await connected.seed("product-update-max", 4, 2, true);
    const oldVariantIds = seeded.flatMap(product => product.variants.map(variant => variant.id));
    const newPriceSetIds: string[] = [];
    let identityMetrics: { bytes: number; nodes: number; depth: number } | undefined;
    const execution = { ...connected.execution, prepare: (composition: Parameters<typeof connected.execution.prepare>[0]) => Effect.sync(() => {
      expect(composition.participants).toHaveLength(4);
      for (const [index, participant] of composition.participants.entries()) {
        expect(participant).toHaveProperty("logicalResources.catalogRows", index === 0 ? 256 : 128);
        if (index < 2) expect(participant).toHaveProperty("logicalPublication", "mixed");
        else expect(participant).not.toHaveProperty("logicalPublication");
      }
      const facts = inspectCapturedPrivateJsonData(composition.identityAndAccessPolicy);
      if (facts === undefined) throw new Error("Workflow composition lost its captured identity facts");
      identityMetrics = { bytes: facts.bytes, nodes: facts.nodes, depth: facts.depth };
    }).pipe(Effect.andThen(connected.execution.prepare(composition))) };
    const host = await connected.prepare({ productsUpdated: async (value, context) => {
      expect(value.additional_data).toEqual({ note: "maximum" });
      expect(value.products).toHaveLength(4);
      const productIds = value.products.map(product => product.id);
      const sales = await context.resources.query.graph({ entity: "product_sales_channel", fields: ["product_id", "sales_channel_id"],
        filters: { product_id: productIds }, pagination: { take: 8 } });
      expect(sales.data).toHaveLength(8);
      expect(sales.data.every(link => link.sales_channel_id === "replacement-channel-0" || link.sales_channel_id === "replacement-channel-1")).toBe(true);
      const shipping = await context.resources.query.graph({ entity: "product_shipping_profile", fields: ["product_id", "shipping_profile_id"],
        filters: { product_id: productIds }, pagination: { take: 4 } });
      expect(shipping.data).toEqual(productIds.map(product_id => ({ product_id, shipping_profile_id: "root-profile-1" })));
      const inventory = await context.resources.query.graph({ entity: "product_variant_inventory_item", fields: ["variant_id", "inventory_item_id"],
        filters: { variant_id: oldVariantIds }, pagination: { take: 8 } });
      expect(inventory.data).toEqual([]);
      const pricing = await context.resources.query.graph({ entity: "product_variant_price_set", fields: ["variant_id", "price_set_id"],
        filters: { variant_id: value.products.flatMap(product => product.variants.map(variant => variant.id)) }, pagination: { take: 4 } });
      expect(pricing.data).toHaveLength(4);
      newPriceSetIds.push(...pricing.data.map(link => Id(link.price_set_id)));
    } }, execution);
    console.info("Product update identity", identityMetrics);
    const input = { products: seeded.map((product, index) => ({ id: product.id, title: "Changed " + index,
      options: [{ title: "Colour", values: ["Red", "Blue", "Green", "White"] }],
      variants: [{ title: "New " + index,
        options: { Colour: "Red" }, manage_inventory: false,
        prices: [{ currency_code: "USD", amount: "987.6543210987654321", rules: { channel_id: "new" } },
          { currency_code: "GBP", amount: 300, rules: { channel_id: "new" } }] }],
      images: [{ url: "https://example.test/new/" + index + "/0" }, { url: "https://example.test/new/" + index + "/1" }],
      tag_ids: ["replacement-tag-0", "replacement-tag-1", "replacement-tag-2", "replacement-tag-3"],
      category_ids: ["replacement-category-0", "replacement-category-1", "replacement-category-2", "replacement-category-3"],
      sales_channels: [{ id: "replacement-channel-0" }, { id: "replacement-channel-1" }], shipping_profile_id: "root-profile-1",
    })), additional_data: { note: "maximum" } };
    const beforeRows = await rows(), beforeCommits = await commits(), beforeEvents = await events();
    for (const selection of [{ name: "1 MiB", requestByteLimit: 1_048_576, requestEventLimit: 128 },
      { name: "128 events", requestByteLimit: 2_097_152, requestEventLimit: 128 }]) {
      const limited = await connected.prepare({}, { ...connected.execution,
        prepare: composition => connected.execution.prepare({ ...composition,
          requestByteLimit: selection.requestByteLimit, requestEventLimit: selection.requestEventLimit }),
      });
      let limitedCalls = 0;
      const refused = await Effect.runPromise(Effect.result(limited.run(limited.newRequestKey(), input).pipe(
        Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") limitedCalls++; }).pipe(Effect.andThen(work)),
        }), Effect.ensuring(Effect.sync(() => console.info("Product update refused maximum", selection.name, "calls", limitedCalls))),
      )));
      expect(refused).toMatchObject({ _tag: "Failure" });
      expect(failurePath(refused._tag === "Failure" ? refused.failure : undefined)).toContain("limitExceeded");
      expect(await rows()).toEqual(beforeRows);
      expect(await events()).toEqual(beforeEvents);
      expect(await commits()).toEqual(beforeCommits);
    }
    let calls = 0;
    const key = host.newRequestKey();
    const result = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Product update maximum calls", calls)))));
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThanOrEqual(productUpdateResources.calls);
    expect(identityMetrics).toBeDefined();
    expect(result.map(product => product.id)).toEqual(seeded.map(product => product.id));
    expect(result.flatMap(product => product.variants)).toHaveLength(4);
    expect(result[0]?.variants[0]?.id).not.toBe(oldVariantIds[0]);
    expect(result[1]?.variants[0]?.id).not.toBe(oldVariantIds[1]);
    expect((await commits()).length - beforeCommits.length).toBe(1);
    const emitted = (await events()).slice(beforeEvents.length);
    expect(emitted).toHaveLength(135);
    expect(emitted.filter(event => event.envelope.contract.startsWith("pricing.") && event.envelope.contract.endsWith(".deleted"))).toHaveLength(36);
    expect(emitted.filter(event => event.envelope.contract.startsWith("pricing.") && event.envelope.contract.endsWith(".created"))).toHaveLength(20);
    expect(emitted.filter(event => event.envelope.contract === "product.updated").map(event => event.envelope.message))
      .toEqual(seeded.map(product => expect.objectContaining({ data: { id: product.id } })));
    const allEvents = await events(), allRows = await rows();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(newPriceSetIds).toHaveLength(4);
    expect(await rows()).toEqual(allRows);
    expect(await events()).toEqual(allEvents);
    const priceSets = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: seeded.flatMap(product => product.variants.map(variant => Id(variant.price_set_id))) }, config: { withDeleted: true } })));
    expect(priceSets).toHaveLength(4);
    expect(priceSets.filter(set => set.deleted_at !== null)).toHaveLength(4);
    const newPrices = await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: newPriceSetIds }, config: { relations: ["prices", "prices.price_rules"] } }));
    expect(newPrices).toEqual(expect.arrayContaining(newPriceSetIds.map(id => expect.objectContaining({ id, prices: expect.arrayContaining([
      expect.objectContaining({ currency_code: "USD", raw_amount: { value: "987.65432109876543210", precision: 20 },
        price_rules: [expect.objectContaining({ attribute: "channel_id", value: "new" })] }),
      expect.objectContaining({ currency_code: "GBP", amount: 300 }),
    ]) }))));
  }, 180_000);

  it("preserves native empty batch and selector behavior, including unconditional empty Pricing calls", async () => {
    const host = await connected.prepare();
    const list = vi.spyOn(ProductModuleService.prototype, "listProducts");
    const upsertPrices = vi.spyOn(PricingModuleService.prototype, "upsertPriceSets");
    const createPrices = vi.spyOn(PricingModuleService.prototype, "createPriceSets");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { products: [] }))).toEqual([]);
      expect(list).not.toHaveBeenCalled();
      expect(upsertPrices).toHaveBeenCalledWith([], expect.anything());
      expect(createPrices).toHaveBeenCalledWith([], expect.anything());
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [] }, update: { title: "nothing" } }))).toEqual([]);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: "missing-product" }, update: { title: "nothing" } }))).toEqual([]);
    } finally { list.mockRestore(); upsertPrices.mockRestore(); createPrices.mockRestore(); }
  });

  it("retains native selector order and ignores missing IDs while updating several existing Products", async () => {
    const seeded = await connected.seed("product-update-selector", 2);
    const selectedIds = seeded.map(product => product.id);
    const host = await connected.prepare({ productsUpdated: value => {
      expect(value.products.map(product => product.id)).toEqual(selectedIds);
      expect(value.additional_data).toEqual({ trace: "selector" });
    } });
    const beforeEvents = await events();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [selectedIds[1]!, "absent-selector-product", selectedIds[0]!] },
      update: { metadata: { selected: true } }, additional_data: { trace: "selector" } }));
    expect(result.map(product => product.id)).toEqual(selectedIds);
    expect(result.map(product => product.metadata)).toEqual(selectedIds.map(() => ({ selected: true })));
    expect((await events()).slice(beforeEvents.length).filter(event => event.envelope.contract === "product.updated").map(event => event.envelope.message))
      .toEqual(selectedIds.map(id => expect.objectContaining({ data: { id } })));
  });

  it("preserves omitted variants/links/prices, clears explicit arrays and removes a nullable ShippingProfile", async () => {
    const seeded = await connected.seed("product-update-omitted"), product = seeded[0]!;
    const host = await connected.prepare();
    const omitted = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: product.id }, update: { metadata: { changed: true } } }));
    expect(omitted[0]?.variants[0]?.id).toBe(product.variants[0]?.id);
    const variant = product.variants[0]!;
    await Effect.runPromise(host.run(host.newRequestKey(), { products: [{ id: product.id,
      variants: [{ id: variant.id, title: "Keep pricing" }] }] }));
    const priceSetId = Id(variant.price_set_id);
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: priceSetId }, config: { relations: ["prices"] } }))).toMatchObject([{ prices: expect.any(Array) }]);
    const cleared = await connected.prepare({ productsUpdated: async (_value, context) => {
      for (const entity of ["product_sales_channel", "product_shipping_profile"])
        expect((await context.resources.query.graph({ entity, fields: ["product_id"], filters: { product_id: product.id }, pagination: { take: 8 } })).data).toEqual([]);
      expect((await context.resources.query.graph({ entity: "product_variant_inventory_item", fields: ["variant_id", "inventory_item_id"],
        filters: { variant_id: variant.id }, pagination: { take: 8 } })).data).toEqual([]);
    } });
    await Effect.runPromise(cleared.run(cleared.newRequestKey(), { products: [{ id: product.id,
      variants: [{ id: variant.id, prices: [], manage_inventory: false }], sales_channels: [], shipping_profile_id: null }] }));
    expect(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: priceSetId }, config: { relations: ["prices"] } }))).toMatchObject([{ prices: [] }]);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: product.id }, update: { variants: [] } })))
      .toMatchObject([{ variants: [] }]);
  });

  it.each(["batch", "selector"] as const)("rolls back Product graph, Pricing lifecycle and both Links when the %s completion hook fails", async form => {
    const seeded = await connected.seed("product-update-hook-" + form), product = seeded[0]!;
    const hook = vi.fn(() => { throw new Error("products updated hook failed"); });
    const host = await connected.prepare({ productsUpdated: hook });
    const beforeRows = await rows(), beforeEvents = await events();
    const update = { title: "Changed", variants: [], sales_channels: [], shipping_profile_id: null };
    const input = form === "batch" ? { products: [{ id: product.id, ...update }] } : { selector: { id: product.id }, update };
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  });

  it("creates positional empty PriceSets for new variants with omitted or empty prices and preserves existing omitted prices", async () => {
    const seeded = await connected.seed("product-update-empty-new"), product = seeded[0]!, existing = product.variants[0]!;
    const priceSetIds = new Map<string, string>();
    const host = await connected.prepare({ productsUpdated: async (value, context) => {
      const variants = value.products[0]!.variants;
      expect(variants.map(variant => variant.title)).toEqual(["Omitted new", "Empty new", "Kept old"]);
      const links = await context.resources.query.graph({ entity: "product_variant_price_set", fields: ["variant_id", "price_set_id"],
        filters: { variant_id: variants.map(variant => variant.id) }, pagination: { take: 4 } });
      expect(links.data).toHaveLength(3);
      for (const row of links.data) priceSetIds.set(Id(row.variant_id), Id(row.price_set_id));
      const inventory = await context.resources.query.graph({ entity: "product_variant_inventory_item", fields: ["variant_id", "inventory_item_id"],
        filters: { variant_id: variants.map(variant => variant.id) }, pagination: { take: 8 } });
      expect(inventory.data).toEqual([expect.objectContaining({ variant_id: existing.id })]);
    } });
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { products: [{ id: product.id, variants: [
      { id: "product-update-new-omitted-variant", title: "Omitted new", options: { Size: "1" }, manage_inventory: true },
      { title: "Empty new", options: { Size: "2" }, prices: [], manage_inventory: true },
      { id: existing.id, title: "Kept old", options: { Size: "0" } },
    ] }] }));
    expect(result[0]?.variants[0]?.id).toBe("product-update-new-omitted-variant");
    const priceSets = Schema.decodeUnknownSync(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String,
      prices: Schema.Array(Schema.JsonObject),
    }), [Schema.Record(Schema.String, Schema.Json)])))(await Effect.runPromise(connected.pricing.host.read(connected.pricing.runtime.list,
      { filters: { id: [...priceSetIds.values()] }, config: { relations: ["prices"] } })));
    for (const variant of result[0]!.variants) {
      const priceSet = priceSets.find(set => set.id === priceSetIds.get(variant.id));
      expect(priceSet).toBeDefined();
      expect(priceSet?.prices).toHaveLength(variant.id === existing.id ? 2 : 0);
    }
    expect(priceSetIds.get(existing.id)).toBe(existing.price_set_id);
  });

  it("retains native silent missing Pricing-Link behavior for existing variants", async () => {
    const create = await Effect.runPromise(prepareProductCreateWorkflow({ execution: connected.execution,
      modules: { product: { module: connected.creation.product.runtime.workflow, logicalStorage: connected.creation.product.hostInput.logicalStorage } },
      revision: "a".repeat(64), subscribers: [{ id: "product-update-unpriced-seed", revision: "b".repeat(64) }] }));
    try { await Effect.runPromise(create.run(create.newRequestKey(), { products: [{ id: "product-update-unpriced", title: "Unpriced",
      options: [{ title: "Size", values: ["0"] }], variants: [{ id: "product-update-unpriced-variant", title: "Unpriced", options: { Size: "0" } }] }] })); }
    finally { await Effect.runPromise(create.close); }
    const host = await connected.prepare();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { products: [{ id: "product-update-unpriced",
      variants: [{ id: "product-update-unpriced-variant", prices: [{ currency_code: "USD", amount: 10 }] }] }] })))
      .toMatchObject([{ id: "product-update-unpriced", variants: [{ id: "product-update-unpriced-variant" }] }]);
  });

  it("refuses managed fields, unknown fields, excessive total variants and forged resources before native mutation", async () => {
    const host = await connected.prepare(), beforeRows = await rows(), beforeEvents = await events();
    const upsert = vi.spyOn(ProductModuleService.prototype, "upsertProducts");
    try {
      // @ts-expect-error Runtime negative witness deliberately omits the required batch Product ID.
      const missingId = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { products: [{ title: "Batch update requires a Product ID" }] })));
      expect(missingId).toMatchObject({ _tag: "Failure" });
      for (const input of [
        { products: [{ id: "managed-product", created_at: "2026-01-01T00:00:00.000Z" }] },
        { products: [{ id: "managed-product", unknown_field: true }] },
        { products: [{ id: "managed-product", variants: [{ id: "managed-variant", product_id: "foreign" }] }] },
        { products: Array.from({ length: 4 }, (_, index) => ({ id: "over-total-" + index, variants: [{ title: "a" }, { title: "b" }] })) },
      ]) expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)))).toMatchObject({ _tag: "Failure" });
      expect(upsert).not.toHaveBeenCalled();
    } finally { upsert.mockRestore(); }
    let getters = 0;
    const forged = Object.defineProperty({ ...connected.link }, "create", { enumerable: true, get: () => { getters++; return () => []; } });
    expect(await Effect.runPromise(Effect.result(prepareProductUpdateWorkflow({ ...connected.options, link: forged }))))
      .toMatchObject({ _tag: "Failure" });
    expect(getters).toBe(0);
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  });

  it("refuses absent stored Products in the named existing-Product profile and rolls back native upsert creation", async () => {
    const host = await connected.prepare(), beforeRows = await rows(), beforeEvents = await events();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { products: [
      { id: "product-update-absent-root", title: "Native upsert could create this root", handle: "product-update-absent-root" },
    ] })))).toMatchObject({ _tag: "Failure" });
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  });

  it("refuses a persisted previous-variant closure above four before Product mutation", async () => {
    const seeded = await connected.seed("product-update-prior-limit", 4);
    await connected.appendVariant("product-update-fifth", seeded[0]!.id);
    const host = await connected.prepare(), beforeRows = await rows(), beforeEvents = await events();
    const upsert = vi.spyOn(ProductModuleService.prototype, "upsertProducts");
    try {
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { products: seeded.map(product => ({ id: product.id, variants: [] })) }))))
        .toMatchObject({ _tag: "Failure" });
      expect(upsert).not.toHaveBeenCalled();
    } finally { upsert.mockRestore(); }
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
  });

  it("refuses an oversized persisted image graph even when replacement is small and rolls back the whole root", async () => {
    const seeded = await connected.seed("product-update-old-images"), product = seeded[0]!;
    const stored = await connected.appendImage("product-update-old-images", product.id);
    const storedImages = Schema.decodeUnknownSync(Schema.Struct({ images: Schema.Array(Schema.JsonObject) }))(stored).images;
    expect(storedImages).toHaveLength(3);
    expect(storedImages).toContainEqual(expect.objectContaining({ id: "product-update-old-images-image" }));
    const host = await connected.prepare(), beforeRows = await rows(), beforeEvents = await events(), beforeCommits = await commits();
    const refused = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { products: [{ id: product.id,
      title: "Small replacement", images: [{ url: "https://example.test/product-update-old-images/replaced" }],
      variants: [], sales_channels: [], shipping_profile_id: null,
    }] })));
    expect(refused).toMatchObject({ _tag: "Failure" });
    expect(failurePath(refused._tag === "Failure" ? refused.failure : undefined)).toContain("unsupportedProfile");
    expect(await rows()).toEqual(beforeRows);
    expect(await events()).toEqual(beforeEvents);
    expect(await commits()).toEqual(beforeCommits);
  });
});
