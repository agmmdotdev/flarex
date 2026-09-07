import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { ProductImage, ProductVariant, ProductOption } from "@medusajs/product/models";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";

describe("Product runtime derives its schema facts from Medusa", () => {
  it("uses imported model identities, compiler prefixes, declared foreign keys and event conventions", async () => {
    const captured = await Effect.runPromise(captureProductSchema("metadata-test"));
    const catalog = await Effect.runPromise(productRuntimeMetadata(captured.metadata.frame));
    expect(catalog.image.model).toBe(ProductImage.name);
    expect(catalog.image.table.name).toBe(ProductImage.parse().tableName);
    expect(catalog.image.prefix).toBe("img");
    expect(catalog.option.model).toBe(ProductOption.name);
    expect(catalog.variant.model).toBe(ProductVariant.name);
    expect(catalog.variant.createdEvent).toBe("product.product-variant.created");
    expect(catalog.image.eventObject).toBe("product_image");
    expect(catalog.foreignKeys.value).toBe("option_id");
    expect(catalog.pivot).toMatchObject({ table: { name: "product_variant_option" }, variantColumn: "variant_id", valueColumn: "option_value_id" });
    const altered = { ...captured.metadata.frame, tables: captured.metadata.frame.tables.map(table => ({ ...table,
      columns: table.columns.map(column => column.primaryKey ? { ...column, options: { ...column.options, prefix: "derived_test" } } : column),
    })) };
    const derived = await Effect.runPromise(productRuntimeMetadata(altered));
    expect(derived.entities.every(entity => entity.prefix === "derived_test")).toBe(true);
  });
  it("refuses metadata that cannot establish the admitted relationship instead of guessing column names", async () => {
    const captured = await Effect.runPromise(captureProductSchema("metadata-test"));
    const broken = { ...captured.metadata.frame, tables: captured.metadata.frame.tables.map(table => ({ ...table,
      relationships: table.relationships.map(relation => ({ ...relation, foreignKeyNames: [] })),
    })) };
    expect(Result.isFailure(await Effect.runPromise(Effect.result(productRuntimeMetadata(broken))))).toBe(true);
  });
});
