import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { remoteQueryObjectFromString } from "@medusajs/utils/common/remote-query-object-from-string";
import { compileProductRequestCatalog } from "../src/http/product-request";
import { decodeProductCatalogRemoteQuery, decodeProductVariantRemoteQuery, prepareProductRequestReadGraph } from "../src/http/product-request-reads";

// Adapter-owned normalized native Variant projection. HTTP remapping/default
// selection is checked by the HTTP owner; this package imports no HTTP source.
const defaultFields = ["id", "title", "sku", "thumbnail", "barcode", "ean", "upc", "allow_backorder", "manage_inventory",
  "hs_code", "origin_country", "mid_code", "material", "weight", "length", "height", "width", "metadata", "variant_rank",
  "product_id", "created_at", "updated_at", "deleted_at", "product.*", "price_set.prices.*", "options.*",
  "price_set.prices.price_rules.value", "price_set.prices.price_rules.attribute"];
let admit: Parameters<typeof decodeProductVariantRemoteQuery>[1];
beforeAll(async () => {
  const catalog = await Effect.runPromise(compileProductRequestCatalog({
    scopeUuid: "f0000000-0000-4000-8000-000000000011", epochUuid: "f0000000-0000-4000-8000-000000000012",
  }));
  const prepared = await Effect.runPromise(prepareProductRequestReadGraph(catalog, true));
  admit = fields => prepared.graph.admitProjection("variant", fields);
});
const producer = (fields: string[]) => remoteQueryObjectFromString({ entryPoint: "product_variant", fields,
  variables: { filters: { id: "variant_remote" } } });

describe("native Variant refetch RemoteQuery admission", () => {
  it("decodes the actual default, scalar and rich native producer through existing graph metadata", () => {
    for (const fields of [defaultFields, ["id", "title"], ["*"], ["price_set.prices.price_rules.attribute"],
      ["id", "options.value", "price_set.prices.amount", "price_set.prices.price_rules.value",
        "inventory_items.required_quantity", "inventory_items.inventory.id",
        "inventory_items.inventory.location_levels.available_quantity", "product.collection.title"]]) {
      const selected = Result.getOrThrow(decodeProductVariantRemoteQuery(producer(fields), admit));
      expect(selected.entity).toBe("variant");
      expect(selected.args).toEqual({ filters: { id: "variant_remote" } });
      expect(new Set(selected.fields)).toEqual(new Set(fields));
    }
  });

  it("accepts native duplicate root and nested selections without another normalization", () => {
    for (const fields of [["id", "id"], ["options.id", "options.id"], Array.from({ length: 256 }, () => "id")]) {
      expect(Result.getOrThrow(decodeProductVariantRemoteQuery(producer(fields), admit)).fields).toEqual(fields);
    }
  });

  it("retains the existing Type and Collection unique-field contracts", () => {
    for (const entryPoint of ["product_type", "product_collection"]) {
      const query = remoteQueryObjectFromString({ entryPoint, fields: ["id", "id"], variables: { filters: { id: "catalog" } } });
      expect(Result.isFailure(decodeProductCatalogRemoteQuery(query))).toBe(true);
    }
  });

  it("accepts the actual native producer after prices and price_set alias selections collide", () => {
    // Native remapKeysForVariant(["id", "prices.id", "price_set.prices.id"])
    // produces these canonical fields without removing either selection.
    const fields = ["id", "price_set.prices.id", "price_set.prices.id"];
    const query = producer(fields);
    expect(query).toEqual({ __value: { product_variant: { fields: ["id"], isServiceAccess: false,
      __args: { filters: { id: "variant_remote" } }, price_set: { prices: { fields: ["id", "id"] } } } } });
    expect(Result.isSuccess(admit(fields))).toBe(true);
    expect(Result.getOrThrow(decodeProductVariantRemoteQuery(query, admit))).toEqual({ entity: "variant",
      args: { filters: { id: "variant_remote" } }, fields });
  });

  it("refuses unknown scalars and paths using the same graph projection admission as pre-mutation validation", () => {
    for (const fields of [["missing"], ["price_set.prices.missing"], ["options.missing"],
      ["inventory_items.inventory.missing"], ["inventory_items.missing.id"], ["product.variants.id"]]) {
      expect(Result.isFailure(admit(fields))).toBe(true);
      expect(Result.isFailure(decodeProductVariantRemoteQuery(producer(fields), admit))).toBe(true);
    }
  });

  it("refuses native nested arguments at every admitted depth", () => {
    for (const [path, field] of [["options", "options.id"], ["price_set.prices", "price_set.prices.id"],
      ["inventory_items.inventory", "inventory_items.inventory.id"]]) {
      if (path === undefined || field === undefined) throw new Error("Missing test selection");
      const query = remoteQueryObjectFromString({ entryPoint: "product_variant", fields: [field],
        variables: { filters: { id: "variant_remote" }, [path]: { filters: { id: "nested" } } } });
      expect(Result.isFailure(decodeProductVariantRemoteQuery(query, admit))).toBe(true);
    }
  });

  it("refuses service access, pagination, malformed filters and nested service capabilities", () => {
    for (const query of [
      { __value: { product_variant: { fields: ["id"], isServiceAccess: true, __args: { filters: { id: "variant_remote" } } } } },
      remoteQueryObjectFromString({ entryPoint: "product_variant", fields: ["id"], variables: { filters: { id: "variant_remote" }, take: 1 } }),
      remoteQueryObjectFromString({ entryPoint: "product_variant", fields: ["id"], variables: { filters: { id: ["variant_remote"] } } }),
      remoteQueryObjectFromString({ entryPoint: "product_variant", fields: ["id"], variables: { filters: { id: "variant_remote", product_id: "p" } } }),
      { __value: { product_variant: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: "variant_remote" } },
        options: { fields: ["id"], isServiceAccess: false } } } },
    ]) expect(Result.isFailure(decodeProductVariantRemoteQuery(query, admit))).toBe(true);
  });

  it("refuses empty and malformed field nodes before graph admission", () => {
    const checked = vi.fn(() => Result.succeed(undefined));
    for (const query of [producer([]),
      { __value: { product_variant: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: "variant_remote" } }, "price_set.prices": { fields: ["id"] } } } },
      { __value: { product_variant: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: "variant_remote" } }, options: {} } } },
      { __value: { product_variant: { fields: ["id"], isServiceAccess: false, __args: { filters: { id: "variant_remote" } }, options: { fields: [3] } } } },
    ]) expect(Result.isFailure(decodeProductVariantRemoteQuery(query, checked))).toBe(true);
    expect(checked).not.toHaveBeenCalled();
  });

  it("bounds total fields and relation depth before graph admission", () => {
    const checked = vi.fn(() => Result.succeed(undefined));
    const tooMany = [...Array.from({ length: 128 }, (_, index) => "root_" + index),
      ...Array.from({ length: 129 }, (_, index) => "options.child_" + index)];
    for (const fields of [tooMany, Array.from({ length: 257 }, () => "id"), Array.from({ length: 257 }, () => "options.id"),
      [...Array.from({ length: 128 }, () => "id"), ...Array.from({ length: 129 }, () => "options.id")],
      [Array.from({ length: 9 }, () => "child").join(".") + ".id"]]) {
      expect(Result.isFailure(decodeProductVariantRemoteQuery(producer(fields), checked))).toBe(true);
    }
    expect(checked).not.toHaveBeenCalled();
  });

  it("captures hostile getter and cyclic input without executing foreign properties", () => {
    const checked = vi.fn(() => Result.succeed(undefined));
    const getter = vi.fn(() => ({}));
    expect(Result.isFailure(decodeProductVariantRemoteQuery(Object.defineProperty({}, "__value", { get: getter, enumerable: true }), checked))).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(Result.isFailure(decodeProductVariantRemoteQuery(cyclic, checked))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(checked).not.toHaveBeenCalled();
  });
});
