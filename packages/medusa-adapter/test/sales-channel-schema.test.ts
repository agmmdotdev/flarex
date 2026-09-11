import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { captureProductSchema } from "../src/product-schema";
import { captureProductSalesChannelSchema } from "../src/sales-channel-schema";

describe("configured Product and Sales Channel schema", () => {
  it("contains both complete native endpoint sets without a stored Link", async () => {
    const result = await Effect.runPromise(captureProductSalesChannelSchema("sales-channel-schema"));
    expect(result.schema.tables).toHaveLength(14);
    expect(result.schema.tables.map(table => table.identity.tableId)).not.toContain("product_sales_channel");
    expect(result.schema.tables.find(table => table.identity.tableId === "sales_channel")?.columns
      .find(column => column.identity.columnId === "is_disabled")).toMatchObject({ type: "boolean", default: { kind: "booleanLiteral", value: false } });
    const product = await Effect.runPromise(captureProductSchema("sales-channel-schema"));
    expect(result.productMetadata.frame).toEqual(product.metadata.frame);
    const again = await Effect.runPromise(captureProductSalesChannelSchema("sales-channel-schema"));
    expect(again.artifact.canonicalJson).toEqual(result.artifact.canonicalJson);
  });
});
