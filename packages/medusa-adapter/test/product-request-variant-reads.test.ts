import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/utils/common/errors";
import { prepareProductRequestFixture } from "./support/product-request-fixture";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { makeStockLocationCommands } from "../src/modules/stock-location/service";
import { prepareInventoryStockingWorkflow } from "../src/workflows/inventory/stock";
import { prepareCreateReservationWorkflow } from "../src/workflows/inventory/adjust-and-reserve";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
// Adapter-owned field contract. HTTP field remapping is covered at its owner.
const variantFields = ["id", "title", "sku", "thumbnail", "barcode", "ean", "upc", "allow_backorder", "manage_inventory",
  "hs_code", "origin_country", "mid_code", "material", "weight", "length", "height", "width", "metadata", "variant_rank",
  "product_id", "created_at", "updated_at", "deleted_at", "price_set.prices.*", "options.*",
  "price_set.prices.price_rules.value", "price_set.prices.price_rules.attribute"];
const decodeVariant = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, product_id: Schema.String, title: Schema.String,
  price_set: Schema.Struct({ prices: Schema.Array(Schema.Struct({ amount: Schema.Number, currency_code: Schema.String })) }),
  options: Schema.Array(Schema.Struct({ value: Schema.String })),
  inventory_items: Schema.Array(Schema.Struct({ required_quantity: Schema.Number, inventory: Schema.Struct({ id: Schema.String, sku: Schema.String }) })),
}));

describe(`native Product Variant HTTP read graph (${driver})`, () => {
  it("reads native default and selected Variant fields, applies Product ownership to detail/count/pages, and follows each Variant's own links", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const created = yield* operations.runWorkflow("create-products", { products: ["First", "Second"].map((title, index) => ({
          title, handle: "variant-reads-" + title.toLowerCase(), options: [{ title: "Size", values: ["One", "Two"] }],
          variants: ["One", "Two"].map((size, ordinal) => ({ title: title + " " + size, sku: "variant-reads-" + index + "-" + ordinal,
            options: { Size: size }, prices: [{ amount: 1000 + index * 100 + ordinal, currency_code: "usd" }] })),
        })) });
        const first = created.result[0]?.id, second = created.result[1]?.id;
        if (first === undefined || second === undefined) return yield* Effect.die(new Error("Missing native Product IDs"));
        const fields = [...variantFields, "product.id", "product.title", "inventory_items.*", "inventory_items.inventory.*"];
        const all = yield* operations.query.graph({ entity: "variant", fields, filters: { product_id: first }, pagination: { order: { id: "ASC" } } });
        expect(all.metadata.count).toBe(2);
        const variants = all.data.map(row => decodeVariant(row));
        expect(variants.map(variant => variant.title).sort()).toEqual(["First One", "First Two"]);
        for (const variant of variants) {
          const ordinal = variant.title.endsWith("One") ? 0 : 1;
          expect(variant.product_id).toBe(first);
          expect(variant.price_set.prices).toEqual([{ amount: 1000 + ordinal, currency_code: "usd" }]);
          expect(variant.options).toEqual([{ value: ordinal === 0 ? "One" : "Two" }]);
          expect(variant.inventory_items).toEqual([{ required_quantity: 1,
            inventory: { id: expect.any(String), sku: "variant-reads-0-" + ordinal } }]);
        }
        expect(all.data.map(row => row.product)).toEqual([{ id: first, title: "First" }, { id: first, title: "First" }]);
        const id = variants[0]?.id;
        if (id === undefined) return yield* Effect.die(new Error("Missing native Variant ID"));
        expect((yield* operations.query.graph({ entity: "variant", fields: ["id", "product_id"], filters: { id, product_id: first } })).data)
          .toEqual([{ id, product_id: first }]);
        expect((yield* operations.query.graph({ entity: "variant", fields: ["id"], filters: { id, product_id: second } })).data).toEqual([]);
        const firstPage = yield* operations.query.graph({ entity: "variant", fields: ["id"], filters: { product_id: first },
          pagination: { take: 1, skip: 0, order: { id: "ASC" } } });
        const secondPage = yield* operations.query.graph({ entity: "variant", fields: ["id"], filters: { product_id: first },
          pagination: { take: 1, skip: 1, order: { id: "ASC" } } });
        expect(firstPage.metadata).toEqual({ count: 2, skip: 0, take: 1 });
        expect(secondPage.metadata).toEqual({ count: 2, skip: 1, take: 1 });
        expect([...firstPage.data, ...secondPage.data]).toEqual(all.data.map(row => ({ id: row.id })));
        expect((yield* operations.query.graph({ entity: "variant", fields: ["id", "product.*"], filters: { id } })).data)
          .toEqual([expect.objectContaining({ id, product: expect.objectContaining({ id: first, title: "First" }) })]);
      }));
    } finally { await tested.fixture.close(); }
  });

  it("reads rich Link roots and native available quantity after real stock/reservation workflows without persisting reads", async () => {
    const tested = await prepareProductRequestFixture(driver);
    try {
      await tested.use(operations => Effect.gen(function* () {
        const created = yield* operations.runWorkflow("create-products", { products: [{ title: "Stocked", handle: "variant-quantity-reads",
          options: [{ title: "Size", values: ["One"] }], variants: [{ title: "Stocked One", sku: "variant-quantity-one", options: { Size: "One" },
            prices: [{ amount: 101, currency_code: "usd" }] }] }] });
        const productId = created.result[0]?.id;
        if (productId === undefined) return yield* Effect.die(new Error("Missing native Product ID"));
        const variant = decodeVariant((yield* operations.query.graph({ entity: "variant", fields: ["id", "product_id", "title", "options.*",
          "price_set.prices.amount", "price_set.prices.currency_code", "inventory_items.*", "inventory_items.inventory.*"], filters: { product_id: productId } })).data[0]);
        const item = variant.inventory_items[0]?.inventory;
        if (item === undefined) return yield* Effect.die(new Error("Missing real linked Inventory Item"));
        const inventory = yield* makeLocalInventoryCommands("stock"), stock = yield* makeStockLocationCommands("create");
        const member = { module: inventory.workflow, nativeStorage: tested.catalog.modules.inventory.nativeStorage };
        const options = { execution: tested.fixture.execution, revision: "a".repeat(64), subscribers: [{ id: "variant-read-stock", revision: "b".repeat(64) }] };
        const stocking = yield* prepareInventoryStockingWorkflow({ ...options, modules: { inventory: member,
          stock_location: { module: stock.workflow, nativeStorage: tested.catalog.modules.stock_location.nativeStorage } } });
        const stocked = yield* stocking.run(stocking.newRequestKey(), { locations: [{ name: "Variant read warehouse" }],
          inventory_levels: [{ inventory_item_id: item.id, location_index: 0, stocked_quantity: 17 }] });
        const location = stocked.locations[0];
        if (location === undefined) return yield* Effect.die(new Error("Missing native Stock Location"));
        const reservations = yield* prepareCreateReservationWorkflow({ ...options, inventory: member });
        yield* reservations.run(reservations.newRequestKey(), { reservations: [{ inventory_item_id: item.id, location_id: location.id, quantity: 4 }] });
        const before = yield* Effect.promise(() => tested.fixture.snapshot());
        const fields = ["variant_id", "required_quantity", "variant.manage_inventory", "variant.allow_backorder", "inventory.*", "inventory.location_levels.*"];
        const result = yield* operations.query.graph({ entity: "product_variant_inventory_items", fields, filters: { variant_id: [variant.id] } }, { cache: { enable: true } });
        expect(result.data).toEqual([expect.objectContaining({ variant_id: variant.id, required_quantity: 1,
          variant: { manage_inventory: true, allow_backorder: false }, inventory: expect.objectContaining({ id: item.id,
            location_levels: [expect.objectContaining({ inventory_item_id: item.id, location_id: location.id,
              stocked_quantity: 17, reserved_quantity: 4, available_quantity: 13 })] }) })]);
        const selected = yield* operations.query.graph({ entity: "variant", fields: ["id", "inventory_items.inventory.location_levels.available_quantity"],
          filters: { id: variant.id, product_id: productId } });
        expect(selected.data).toEqual([{ id: variant.id, inventory_items: [{ inventory: { location_levels: [{ available_quantity: 13 }] } }] }]);
        const oversized = yield* Effect.exit(operations.query.graph({ entity: "product_variant_inventory_items", fields,
          filters: { variant_id: [variant.id, ...Array.from({ length: 8 }, (_, index) => `variant_outside_${index}`)] } }));
        expect(Exit.isFailure(oversized)).toBe(true);
        if (Exit.isFailure(oversized)) expect(oversized.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        const failure = yield* Effect.exit(operations.query.graph({ entity: "product_variant_inventory_items", fields, filters: { variant_id: [variant.id] }, withDeleted: true }));
        expect(Exit.isFailure(failure)).toBe(true);
        if (Exit.isFailure(failure)) expect(failure.cause.reasons.some(reason => Cause.isFailReason(reason) &&
          reason.error.reason === "adapterFailure" && reason.error.cause instanceof MedusaError && reason.error.cause.type === MedusaError.Types.INVALID_DATA)).toBe(true);
        expect(yield* Effect.promise(() => tested.fixture.snapshot())).toEqual(before);
        yield* reservations.close;
        yield* stocking.close;
      }));
    } finally { await tested.fixture.close(); }
  });
});
