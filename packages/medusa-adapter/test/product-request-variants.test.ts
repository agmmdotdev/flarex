import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { createContainer } from "@medusajs/deps/awilix-portable";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";

describe(`native HTTP variant creation operations (${driver})`, () => {
  it("adds two managed variants to an existing Product with their own prices and Inventory links", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        const parent = yield* operations.runWorkflow("create-products", { products: [{ title: "Variant parent", handle: "variant-parent",
          options: [{ title: "Size", values: ["Small", "Large"] }] }] });
        const id = parent.result[0]?.id;
        if (id === undefined) return yield* Effect.die(new Error("Native creation omitted its Product"));
        const createdIds: string[] = [];
        for (const [size, amount] of [["Small", 1200], ["Large", 2700]] as const) {
          const created = yield* operations.runWorkflow("create-product-variants", { product_variants: [{ product_id: id,
            title: size, sku: `VARIANT-${size}`, options: { Size: size }, prices: [{ currency_code: "usd", amount }] }],
          additional_data: { origin: "native-http-variant" } });
          expect(created.result).toHaveLength(1);
          const variant = created.result[0];
          if (variant === undefined) return yield* Effect.die(new Error("Native creation omitted its Variant"));
          createdIds.push(variant.id);
          const graph = yield* operations.query.graph({ entity: "product", filters: { id }, fields: ["id", "variants.id", "variants.sku",
            "variants.price_set.id", "variants.price_set.prices.*", "variants.inventory_items.*", "variants.inventory_items.inventory.*"] });
          expect(graph.data).toEqual([expect.objectContaining({ id, variants: expect.arrayContaining([expect.objectContaining({
            id: variant.id, sku: `VARIANT-${size}`, price_set: expect.objectContaining({ prices: [expect.objectContaining({ amount, currency_code: "usd" })] }),
            inventory_items: [expect.objectContaining({ required_quantity: 1, inventory: expect.objectContaining({ sku: `VARIANT-${size}` }) })],
          })]) })]);
        }
        expect(new Set(createdIds).size).toBe(2);
        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const native = scopes.createRequestScope().resolve<{ graph(input: unknown): Promise<{ data: Record<string, unknown>[] }> }>("query");
        const query = { entity: "variant", fields: ["id", "manage_inventory"], filters: { id: createdIds[0], product_id: id } };
        const dto = (yield* Effect.promise(() => native.graph(query))).data[0];
        if (dto === undefined) return yield* Effect.die(new Error("Native Variant query omitted its DTO"));
        dto.inventory_quantity = 17;
        dto.id = "caller-owned-change";
        expect((yield* Effect.promise(() => native.graph(query))).data).toEqual([{ id: createdIds[0], manage_inventory: true }]);
        expect((yield* operations.query.graph(query)).data).toEqual([{ id: createdIds[0], manage_inventory: true }]);
      }));
      const snapshot = await tested.fixture.snapshot();
      expect(snapshot.outcomes.length - before.outcomes.length).toBe(3);
      expect(snapshot.events.filter(event => event.envelope.contract === "product-variant.created")).toHaveLength(2);
      expect((await tested.fixture.readRows("inventory")).filter(row => row.sku === "VARIANT-Small" || row.sku === "VARIANT-Large")).toHaveLength(2);
      const links = await tested.fixture.readRows("variant_links");
      expect(links.filter(row => typeof row.price_set_id === "string")).toHaveLength(2);
      expect(links.filter(row => typeof row.inventory_item_id === "string")).toHaveLength(2);
    } finally { await tested.fixture.close(); }
  });

  it("rejects malformed, mixed-parent and over-bound variant inputs before durable acquisition", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        const row = { product_id: "prod_missing", title: "Invalid", options: { Size: "One" } };
        for (const input of [{}, { product_variants: [] }, { product_variants: [row, { ...row, product_id: "prod_other" }] },
          { product_variants: Array.from({ length: 5 }, () => row) }]) {
          expect(Exit.isFailure(yield* Effect.exit(operations.runWorkflow("create-product-variants", input)))).toBe(true);
        }
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
