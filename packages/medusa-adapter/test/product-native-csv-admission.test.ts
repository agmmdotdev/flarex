import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { normalizeProductsFromCsv } from "@medusajs/core-flows/product/normalize-products-from-csv";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { SimpleVariantInput } from "../src/modules/product/variant-workflow-input";
import { productCreationWorkflowEntry } from "../src/workflows/product/create-input";
import { commerceDecoder } from "../src/value/decoder";
import { captureCommerceInput } from "../src/value/input";

const header = "Product Handle,Product Title,Variant Title,Variant Option 1 Name,Variant Option 1 Value";
let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("native-csv-admission").pipe(
    Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)),
  ));
});

describe("native CSV Product creation admission", () => {
  it.each([undefined, "false", "true"])("preserves the native allow_backorder default or explicit %s value", value => {
    const csv = value === undefined ? `${header}\nshirt,Shirt,Blue,Color,Blue\n`
      : `${header},Variant Allow Backorder\nshirt,Shirt,Blue,Color,Blue,${value}\n`;
    const plan = normalizeProductsFromCsv(csv);
    expect(plan.parsedRecords).toBe(1);
    const product = plan.batchRequest.create[0];
    const variant = product?.variants?.[0];
    if (product === undefined || variant === undefined) throw new Error("Expected the genuine native Product/Variant plan");
    expect(variant.allow_backorder).toBe(value === "true");
    expect(variant.manage_inventory).toBe(true);
    const decodeProduct = commerceDecoder(productCreationWorkflowEntry(catalog.product.table.columns.map(column => column.name)), "invalidInput");
    expect(Result.getOrThrow(decodeProduct(product))).toEqual(product);
    const { prices: _prices, ...moduleVariant } = variant;
    const decodeVariant = commerceDecoder(SimpleVariantInput, "invalidInput");
    const decodedVariant = Result.getOrThrow(decodeVariant({ ...moduleVariant, product_id: "product-native-csv" }));
    expect(decodedVariant).toEqual({ ...moduleVariant, product_id: "product-native-csv" });
    const capturedVariants = Result.getOrThrow(captureCommerceInput([decodedVariant]));
    expect(catalog.valueProfile.validateRelatedCreate(catalog.variant.table.name, capturedVariants))
      .toMatchObject({ _tag: "Success" });
  });

  it("keeps the creation Boolean contract strict and refuses undeclared Variant fields", () => {
    const decodeVariant = commerceDecoder(SimpleVariantInput, "invalidInput");
    const variant = { product_id: "product-native-csv", title: "Blue", options: { Color: "Blue" } };
    expect(Result.getOrThrow(decodeVariant(variant))).toEqual(variant);
    for (const value of ["false", "true", null, 0, 1]) {
      expect(Result.isFailure(decodeVariant({ ...variant, allow_backorder: value }))).toBe(true);
    }
    expect(Result.isFailure(decodeVariant({ ...variant, allow_backorder: false, unknown: true }))).toBe(true);
    expect(Result.isFailure(decodeVariant({ ...variant, allow_backorder: true, updated_at: "now" }))).toBe(true);
  });
});
