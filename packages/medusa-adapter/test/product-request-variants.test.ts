import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createContainer } from "@medusajs/deps/awilix-portable";
import { MedusaError } from "@medusajs/utils/common/errors";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { makeProductRequestScopeFactory } from "../src/http/product-request";
import { prepareProductRequestFixture } from "./support/product-request-fixture";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";

describe(`native HTTP variant creation and update operations (${driver})`, () => {
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

  it("updates a parent-qualified Variant through the operations and Promise boundaries while preserving the unrelated graph", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const created = yield* operations.runWorkflow("create-products", { products: ["Selected", "Unrelated"].map(title => ({
          title, handle: "variant-update-" + title.toLowerCase(), options: [{ title: "Size", values: ["One"] }],
          variants: [{ title: title + " variant", sku: "variant-update-" + title.toLowerCase(), options: { Size: "One" },
            prices: [{ amount: 1234, currency_code: "usd" }] }],
        })) });
        const selectedId = created.result[0]?.id, unrelatedId = created.result[1]?.id;
        if (selectedId === undefined || unrelatedId === undefined) return yield* Effect.die(new Error("Native creation omitted two Product IDs"));
        const fields = ["id", "title", "options.id", "options.title", "options.values.id", "options.values.value",
          "variants.id", "variants.title", "variants.sku", "variants.manage_inventory", "variants.price_set.id",
          "variants.price_set.prices.id", "variants.price_set.prices.amount", "variants.price_set.prices.currency_code",
          "variants.inventory_items.id", "variants.inventory_items.required_quantity", "variants.inventory_items.inventory.id",
          "variants.inventory_items.inventory.sku"];
        const query = (id: string) => operations.query.graph({ entity: "product", filters: { id }, fields });
        const decode = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, title: Schema.String,
          variants: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, sku: Schema.String, manage_inventory: Schema.Boolean,
            price_set: Schema.Struct({ id: Schema.String, prices: Schema.Array(Schema.Struct({ id: Schema.String, amount: Schema.Number,
              currency_code: Schema.String })) }),
            inventory_items: Schema.Array(Schema.JsonObject),
          })),
        }));
        const original = decode((yield* query(selectedId)).data[0]);
        const variant = original.variants[0], price = variant?.price_set.prices[0];
        if (variant === undefined || price === undefined) return yield* Effect.die(new Error("Native creation omitted its managed Variant and Price"));
        expect(variant.manage_inventory).toBe(true);
        expect(variant.inventory_items).toEqual([expect.objectContaining({ required_quantity: 1,
          inventory: expect.objectContaining({ sku: "variant-update-selected" }) })]);
        const unrelated = (yield* query(unrelatedId)).data;
        const inventoryBefore = yield* Effect.promise(() => tested.fixture.readRows("inventory"));
        const before = yield* Effect.promise(() => tested.fixture.snapshot());

        expect(yield* operations.runWorkflow("update-product-variants", { selector: { id: variant.id, product_id: unrelatedId },
          update: { title: "Wrong parent", manage_inventory: false, prices: [] } })).toEqual({ result: [] });
        const { outcomes: _beforeOutcomes, ...beforeBusiness } = before;
        const { outcomes: _afterOutcomes, ...afterBusiness } = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(afterBusiness).toEqual(beforeBusiness);
        expect(decode((yield* query(selectedId)).data[0])).toEqual(original);
        expect((yield* query(unrelatedId)).data).toEqual(unrelated);

        const updated = yield* operations.runWorkflow("update-product-variants", { selector: { id: variant.id, product_id: selectedId },
          update: { title: "Updated variant", prices: [{ id: price.id, amount: 4321, currency_code: "usd" }] },
          additional_data: { origin: "operations-variant-update" } });
        expect(updated.result).toEqual([expect.objectContaining({ id: variant.id, title: "Updated variant",
          price_set: expect.objectContaining({ id: variant.price_set.id, prices: [expect.objectContaining({ id: price.id, amount: 4321 })] }) })]);
        const afterPrice = decode((yield* query(selectedId)).data[0]);
        expect(afterPrice).toEqual({ ...original, variants: [{ ...variant, title: "Updated variant",
          price_set: { ...variant.price_set, prices: [{ ...price, amount: 4321 }] } }] });
        expect((yield* query(unrelatedId)).data).toEqual(unrelated);

        const scopes = yield* makeProductRequestScopeFactory({ operations, container: createContainer() });
        const engine = scopes.createRequestScope().resolve<{ run(name: string, options: { input: unknown }): Promise<{ result: Array<{ id: string; title: string; manage_inventory: boolean }> }> }>(Modules.WORKFLOW_ENGINE);
        const disabled = yield* Effect.promise(() => engine.run("update-product-variants", { input: {
          selector: { id: variant.id, product_id: selectedId }, update: { manage_inventory: false },
          additional_data: { origin: "native-http-variant-update" },
        } }));
        expect(disabled.result).toEqual([expect.objectContaining({ id: variant.id, title: "Updated variant", manage_inventory: false })]);
        expect(decode((yield* query(selectedId)).data[0])).toEqual({ ...afterPrice,
          variants: [{ ...afterPrice.variants[0], manage_inventory: false, inventory_items: [] }] });
        expect((yield* query(unrelatedId)).data).toEqual(unrelated);
        expect(yield* Effect.promise(() => tested.fixture.readRows("inventory"))).toEqual(inventoryBefore);
        const after = yield* Effect.promise(() => tested.fixture.snapshot());
        expect(after.events.slice(before.events.length).filter(event => event.envelope.contract === "product-variant.updated")).toHaveLength(2);
      }));
    } finally { await tested.fixture.close(); }
  });

  it("rejects malformed, mixed-parent and over-bound creation and update inputs before durable acquisition", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      const before = await tested.fixture.snapshot();
      await tested.use(operations => Effect.gen(function* () {
        const row = { product_id: "prod_missing", title: "Invalid", options: { Size: "One" } };
        for (const input of [{}, { product_variants: [] }, { product_variants: [row, { ...row, product_id: "prod_other" }] },
          { product_variants: Array.from({ length: 5 }, () => row) }]) {
          expect(Exit.isFailure(yield* Effect.exit(operations.runWorkflow("create-product-variants", input)))).toBe(true);
        }
        for (const input of [{}, { selector: { title: "Not admitted" }, update: {} }, { selector: { id: "" }, update: {} },
          { selector: { id: "variant_missing", product_id: null }, update: {} },
          { selector: { id: "variant_missing", product_id: "prod_missing" }, update: { id: "variant_missing" } },
          { selector: { id: "variant_missing", product_id: "prod_missing" }, update: { id: "variant_other" } },
          { selector: { id: ["one", "two", "three", "four", "five"], product_id: "prod_missing" }, update: {} },
          { selector: { id: "variant_missing", product_id: "prod_missing" }, update: { product_id: "prod_other" } },
        ]) {
          const result = yield* Effect.exit(operations.runWorkflow("update-product-variants", input));
          expect(Exit.isFailure(result)).toBe(true);
          if (Exit.isFailure(result)) expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) &&
            reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError &&
            reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        }
      }));
      expect(await tested.fixture.snapshot()).toEqual(before);
    } finally { await tested.fixture.close(); }
  });
});
