import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { z } from "@medusajs/deps/zod";
import { CSVNormalizer } from "@medusajs/utils/product/csv-normalizer";
import { CreateProduct, UpdateProduct } from "@medusajs/utils/product/validators";
import { createWorkflow, transform, WorkflowResponse, type Resolved, type WorkflowData } from "@medusajs/workflows-sdk";
import { executeWorkflow, type WorkflowExecutionPort } from "@medusajs/workflows-sdk/native";
import { normalizeCsvStep } from "@medusajs/core-flows/product/normalize-products-step";
import { convertCsvToJson } from "@medusajs/core-flows/product/csvtojson";

const port: WorkflowExecutionPort<unknown> = {
  checkpoint: Effect.void,
  capture: value => Effect.sync(() => structuredClone(value)),
  invoke: work => Effect.tryPromise({ try: () => Promise.resolve(work()), catch: error => error }),
  context: {
    container: { resolve() { throw new Error("CSV normalization must not resolve services"); } },
    eventGroupId: "csv-normalization-proof",
  },
};
const normalize = async (input: string) => {
  let captured: Resolved<ReturnType<typeof normalizeCsvStep>> | undefined;
  const normalization = createWorkflow("csv-normalization-proof", (value: WorkflowData<string>) =>
    new WorkflowResponse(transform(normalizeCsvStep(value), output => {
      captured = output;
      return output;
    })));
  const output = await Effect.runPromise(executeWorkflow(Result.getOrThrow(normalization.prepare()), input, port));
  if (captured === undefined) throw new Error("Native normalization did not produce its response");
  expect(output).toEqual(captured);
  return captured;
};
const variantColumns = ["Variant Title", "Variant Option 1 Name", "Variant Option 1 Value"];
const csv = (headers: readonly string[], rows: readonly (readonly string[])[], delimiter = ",") =>
  [headers, ...rows].map(row => row.join(delimiter)).join("\n") + "\n";

describe("native Product CSV normalization closure", () => {
  it("keeps a header-only input empty without injecting Product defaults", async () => {
    expect(await normalize("Product Handle,Product Title\n")).toEqual({ create: [], update: [] });
  });

  it.each([",", ";", "|"])("detects the native %s delimiter and preserves create defaults", async delimiter => {
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [["shirt", "Shirt", "Blue", "Color", "Blue"]], delimiter));
    expect(output).toEqual({ create: [{
      handle: "shirt", title: "Shirt", is_giftcard: false, discountable: true, status: "draft",
      options: [{ title: "Color", values: ["Blue"] }],
      variants: [{ title: "Blue", allow_backorder: false, manage_inventory: true,
        prices: [], options: { Color: "Blue" } }],
    }], update: [] });
  });

  it("uses the native delimiter priority even when a quoted heading contains another candidate", () => {
    expect(convertCsvToJson('"Product,Title";Product Handle\nShirt;shirt\n'))
      .toEqual([]);
  });

  it("preserves the real parser's quoting, escaped quotes, newlines and typed cells", () => {
    expect(convertCsvToJson('title,description,number,flag\n"Shirt, Blue","Line 1\n""quoted""",12,true\n'))
      .toEqual([{ title: "Shirt, Blue", description: 'Line 1\n"quoted"', number: 12, flag: true }]);
  });

  it("preserves native CSV-to-JSON formula-looking strings despite the injection option", () => {
    expect(convertCsvToJson('title,description\n=SUM(A1:A2),@native\n'))
      .toEqual([{ title: "=SUM(A1:A2)", description: "@native\n" }]);
  });

  it("normalizes header case, spaces, carriage returns and literal trailing backslash-r", () => {
    expect(CSVNormalizer.preProcess({ " PRODUCT HANDLE ": " shirt\\r", "Product Title\r": " Shirt\r" }, 1))
      .toEqual({ "product handle": "shirt", "product title": "Shirt" });
  });

  it("groups rows by Product handle while preserving first Product and Variant order", async () => {
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns], [
      ["second", "Second", "Blue", "Color", "Blue"],
      ["first", "First", "Red", "Color", "Red"],
      ["second", "Second revised", "Green", "Color", "Green"],
      ["second", "Second revised", "Blue again", "Color", "Blue"],
    ]));
    expect(output.create.map(product => product.handle)).toEqual(["second", "first"]);
    expect(output.create[0]?.title).toBe("Second revised");
    expect(output.create[0]?.options).toEqual([{ title: "Color", values: ["Blue", "Green"] }]);
    expect(output.create[0]?.variants?.map(variant => variant.title)).toEqual(["Blue", "Green", "Blue again"]);
  });

  it("uses native object-key ordering when grouping numeric-looking Product handles", () => {
    const normalizer = new CSVNormalizer([
      CSVNormalizer.preProcess({ "Product Handle": "10", "Product Title": "Ten" }, 1),
      CSVNormalizer.preProcess({ "Product Handle": "2", "Product Title": "Two" }, 2),
    ]);
    expect(Object.keys(normalizer.proccess().toCreate)).toEqual(["2", "10"]);
  });

  it("retains native parser type inference rather than coercing numeric handles to strings", async () => {
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [["10", "Ten", "A", "Color", "A"]]))).rejects.toThrow("Expected string, received number");
  });

  it("treats an ID as update authority and does not add create defaults", async () => {
    const output = await normalize(csv(["Product Id", "Product Handle", "Product Weight", "Variant Id", "Variant Weight"],
      [["prod-existing", "renamed", "42", "variant-existing", "7"]]));
    expect(output).toEqual({ create: [], update: [{ id: "prod-existing", handle: "renamed", weight: "42",
      variants: [{ id: "variant-existing", weight: "7", prices: [] }] }] });
  });

  it("preserves native same-row association duplicates and price currency conversion", async () => {
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns,
      "Product Category 1", "Product Category 2", "Product Image 1", "Product Image 2", "Variant Price [Europe] EUR"],
    [["shirt", "Shirt", "Blue", "Color", "Blue", "cat-one", "cat-one", "one.png", "one.png", "12.5"]]));
    expect(output.create[0]?.categories).toEqual([{ id: "cat-one" }, { id: "cat-one" }]);
    expect(output.create[0]?.images).toEqual([{ url: "one.png" }, { url: "one.png" }]);
    expect(output.create[0]?.variants?.[0]?.prices).toEqual([{ currency_code: "eur", amount: 12.5 }]);
  });

  it("retains native omission of already-parsed metadata and ignores export-only timestamp columns", async () => {
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns,
      "Product Metadata", "Variant Metadata", "Product Created At", "Variant Product Id"],
    [["shirt", "Shirt", "Blue", "Color", "Blue", '"{""source"":""csv""}"',
      '"{""rank"":2}"', "exported timestamp", "ignored-parent"]]));
    expect(output.create[0]).not.toHaveProperty("metadata");
    expect(output.create[0]?.variants?.[0]).not.toHaveProperty("metadata");
    expect(output.create[0]).not.toHaveProperty("created_at");
    expect(output.create[0]?.variants?.[0]).not.toHaveProperty("product_id");
    const rawStrings = new CSVNormalizer([CSVNormalizer.preProcess({ "Product Handle": "shirt",
      "Product Metadata": '{"source":"csv"}', "Variant Metadata": '{"rank":2}' }, 1)]).proccess();
    expect(rawStrings.toCreate.shirt?.metadata).toEqual({ source: "csv" });
    expect(rawStrings.toCreate.shirt?.variants?.[0].metadata).toEqual({ rank: 2 });
  });

  it("retains explicit native boolean choices", async () => {
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns,
      "Product Discountable", "Product Is Giftcard", "Variant Manage Inventory", "Variant Allow Backorder"],
    [["shirt", "Shirt", "Blue", "Color", "Blue", "FALSE", "true", "false", "TRUE"]]));
    expect(output.create[0]).toMatchObject({ discountable: false, is_giftcard: true });
    expect(output.create[0]?.variants?.[0]).toMatchObject({ manage_inventory: false, allow_backorder: true });
  });

  it("retains row-numbered missing identity and option errors", () => {
    expect(() => CSVNormalizer.preProcess({}, 9)).toThrow(
      "Row 9: Missing product id and handle. One of these columns are required to process the row");
    const normalizer = new CSVNormalizer([CSVNormalizer.preProcess({ "Product Handle": "shirt",
      "Variant Option 1 Name": "Color" }, 1)]);
    expect(() => normalizer.proccess(4)).toThrow('Row 5: Missing option value for "variant option 1 name"');
  });

  it("reports unknown columns before checking row identity", () => {
    expect(() => CSVNormalizer.preProcess({ "Unknown One": "x", "Unknown Two": "y" }, 1))
      .toThrow('Invalid column name(s) "Unknown One","Unknown Two"');
  });

  it("retains native numeric and JSON error details", () => {
    const numeric = new CSVNormalizer([CSVNormalizer.preProcess({ "Product Handle": "shirt", "Product Weight": "heavy" }, 1)]);
    expect(() => numeric.proccess()).toThrow('Row 1: Invalid value provided for "product weight". Expected value to be a number, received "heavy"');
    const metadata = new CSVNormalizer([CSVNormalizer.preProcess({ "Product Handle": "shirt", "Product Metadata": "broken" }, 1)]);
    expect(() => metadata.proccess()).toThrow('Row 1: Invalid value provided for "product metadata". Expected a valid JSON string, received "broken"');
  });

  it("keeps native strict schema errors and dimension transforms", () => {
    expect(() => CreateProduct.parse({ title: "Shirt", unsupported: true })).toThrow(z.ZodError);
    expect(() => CreateProduct.parse({ title: "Shirt", status: "unknown" })).toThrow(z.ZodError);
    expect(UpdateProduct.parse({ id: "prod", weight: 12, variants: [{ id: "variant", height: 3 }] }))
      .toEqual({ id: "prod", weight: "12", variants: [{ id: "variant", height: "3" }] });
  });

  it("does not accept an exported Variant ID in the native strict create validator", async () => {
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns, "Variant Id"],
      [["shirt", "Shirt", "Blue", "Color", "Blue", "variant-exported"]])))
      .rejects.toThrow("Unrecognized key(s) in object: 'id'");
  });

  it("validates all create groups before update groups in the native step", async () => {
    await expect(normalize(csv(["Product Id", "Product Handle", "Product Title", "Product Status", "Variant Title"], [
      ["prod-existing", "", "Existing", "invalid-update-status", "Existing variant"],
      ["", "new-product", "", "draft", "New variant"],
    ]))).rejects.toThrow("Required");
  });
});

describe("intentional CSV security fork: caller-owned dictionary keys", () => {
  const intrinsics = () => [Object.getOwnPropertyDescriptors(Object.prototype),
    Object.getOwnPropertyDescriptors(Object), Object.getOwnPropertyDescriptors(Object.prototype.toString)];

  it.each(["__proto__", "constructor", "toString"])("preserves the Product handle %s through the real parser and normalization step", async handle => {
    const before = intrinsics();
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [[handle, "Safe Product", "Blue", "Color", "Blue"]]));
    expect(output.create).toHaveLength(1);
    expect(output.create[0]).toMatchObject({ handle, title: "Safe Product",
      options: [{ title: "Color", values: ["Blue"] }], variants: [{ title: "Blue", options: { Color: "Blue" } }] });
    expect(intrinsics()).toEqual(before);
  });

  it.each(["__proto__", "constructor", "toString"])("preserves the update Product ID %s without sharing an intrinsic object", async id => {
    const before = intrinsics();
    const output = await normalize(csv(["Product Id", "Product Title", "Variant Id"],
      [[id, "Safe Update", "variant-existing"]]));
    expect(output).toEqual({ create: [], update: [{ id, title: "Safe Update",
      variants: [{ id: "variant-existing", prices: [] }] }] });
    expect(intrinsics()).toEqual(before);
  });

  it("keeps prototype-looking handles distinct and retains row and group order", async () => {
    const keys = ["__proto__", "constructor", "toString"];
    const before = intrinsics();
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      keys.flatMap(key => [[key, key + " first", "First", "Color", "Blue"],
        [key, key + " second", "Second", "Color", "Red"]])));
    expect(output.create.map(product => [product.handle, product.title, product.variants?.map(variant => variant.title)]))
      .toEqual(keys.map(key => [key, key + " second", ["First", "Second"]]));
    expect(intrinsics()).toEqual(before);
  });

  it.each(["constructor", "toString"])("preserves the representable Variant option name %s", async key => {
    const before = intrinsics();
    const output = await normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [["safe-product", "Safe Product", "Blue", key, "Blue"]]));
    const options = output.create[0]?.variants?.[0]?.options;
    expect(options).toEqual({ [key]: "Blue" });
    expect(Object.hasOwn(options ?? {}, key)).toBe(true);
    expect(output.create[0]?.options).toEqual([{ title: key, values: ["Blue"] }]);
    expect(intrinsics()).toEqual(before);
  });

  it("refuses the unrepresentable __proto__ Variant option before native Zod can silently drop it", async () => {
    const before = intrinsics();
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [["safe-product", "Safe Product", "Blue", "__proto__", "Blue"]])))
      .rejects.toThrow('Row 1: Invalid option name "__proto__" for "variant option 1 name"');
    expect(intrinsics()).toEqual(before);
  });

  it("retains native missing-option-value precedence over the security refusal", async () => {
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns],
      [["safe-product", "Safe Product", "Blue", "__proto__", ""]])))
      .rejects.toThrow('Row 1: Missing option value for "variant option 1 name"');
  });

  it("retains first-row normalization failure before a later unsafe option name", async () => {
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns, "Product Weight"], [
      ["first", "First", "Blue", "Color", "Blue", "heavy"],
      ["second", "Second", "Red", "__proto__", "Red", "1"],
    ]))).rejects.toThrow('Row 1: Invalid value provided for "product weight". Expected value to be a number, received "heavy"');
  });

  it("retains preprocessing-before-normalization failure order", async () => {
    await expect(normalize(csv(["Product Handle", "Product Title", ...variantColumns], [
      ["first", "First", "Blue", "__proto__", "Blue"],
      ["", "Missing identity", "Red", "Color", "Red"],
    ]))).rejects.toThrow("Row 2: Missing product id and handle. One of these columns are required to process the row");
  });
});
