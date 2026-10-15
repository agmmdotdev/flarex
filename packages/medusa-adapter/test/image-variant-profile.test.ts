import { beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { commerceError, commerceLimits, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/modules/product/runtime-metadata";
import { productImageVariantReadProfile } from "../src/modules/product/image-variant-profile";
import { findProductRelated } from "../src/modules/product/related";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { mockRelationalRead } from "./mock-relational-read";

let catalog: ProductRuntimeMetadata;
const success = (result: Result.Result<void, unknown>) => expect(Result.isSuccess(result)).toBe(true);
const unsupported = (result: Result.Result<void, unknown>) => expect(result)
  .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });

beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("image-variant-selection-profile")
    .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("native image-Variant command selection admission", () => {
  it("admits sixteen distinct sibling Variants across four parents and deduplicates repeated selections", () => {
    const profile = productImageVariantReadProfile(catalog);
    const rows = Array.from({ length: 16 }, (_, index) => ({ id: "variant-" + index, product_id: "parent-" + index % 4 }));
    success(profile.admitSelection(catalog.variant.table.name, rows));
    success(profile.admitSelection(catalog.variant.table.name, rows.toReversed()));
    for (const row of rows) success(profile.admitSelection(catalog.variant.table.name, [row]));
    unsupported(profile.admitSelection(catalog.variant.table.name, [{ id: "variant-16", product_id: "parent-0" }]));
  });

  it("permits partial preimages before full preparation and still binds the later total parent cohort", () => {
    const profile = productImageVariantReadProfile(catalog);
    success(profile.admitSelection(catalog.variant.table.name, [{ id: "variant", thumbnail: "old.png" }]));
    success(profile.admitSelection(catalog.variant.table.name, [{ id: "variant", product_id: "parent-0" }]));
    success(profile.admitSelection(catalog.option.table.name, [0, 1, 2, 3].map(index => ({ id: "option-" + index, product_id: "parent-" + index }))));
    unsupported(profile.admitSelection(catalog.product.table.name, [{ id: "parent-4" }]));
    const invalid = productImageVariantReadProfile(catalog);
    expect(invalid.admitSelection(catalog.variant.table.name, [{ id: "variant", product_id: null }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("bounds four Options cumulatively rather than four per read or per parent", () => {
    const profile = productImageVariantReadProfile(catalog);
    for (let index = 0; index < 4; index++) success(profile.admitSelection(catalog.option.table.name,
      [{ id: "option-" + index, product_id: "parent-" + index }]));
    success(profile.admitSelection(catalog.option.table.name, [{ id: "option-0", product_id: "parent-0" }]));
    unsupported(profile.admitSelection(catalog.option.table.name, [{ id: "option-4", product_id: "parent-0" }]));
  });

  it("bounds four Values per Option across repeated and disjoint native reads", () => {
    const profile = productImageVariantReadProfile(catalog);
    const values = [0, 1, 2, 3].map(index => ({ id: "value-" + index, [catalog.foreignKeys.value]: "option" }));
    success(profile.admitSelection(catalog.value.table.name, values.slice(0, 2)));
    success(profile.admitSelection(catalog.value.table.name, values));
    success(profile.admitSelection(catalog.value.table.name, [{ id: "other-value", [catalog.foreignKeys.value]: "other-option" }]));
    unsupported(profile.admitSelection(catalog.value.table.name, [{ id: "value-4", [catalog.foreignKeys.value]: "option" }]));
  });

  it("bounds hidden Value owners together with explicitly observed Options, including inactive owners", () => {
    const profile = productImageVariantReadProfile(catalog);
    success(profile.admitSelection(catalog.option.table.name, [{ id: "option-0", deleted_at: "2026-10-20T00:00:00.000Z" }]));
    for (let index = 1; index <= 3; index++) success(profile.admitSelection(catalog.value.table.name,
      [{ id: "value-" + index, [catalog.foreignKeys.value]: "option-" + index }]));
    unsupported(profile.admitSelection(catalog.value.table.name, [{ id: "value-4", [catalog.foreignKeys.value]: "option-4" }]));
  });

  it("counts hidden composite Variant-Value pivots exactly once and refuses a fifth reference", () => {
    const profile = productImageVariantReadProfile(catalog);
    const links = [0, 1, 2, 3].map(index => ({ [catalog.pivot.variantColumn]: "variant", [catalog.pivot.valueColumn]: "value-" + index }));
    success(profile.admitSelection(catalog.pivot.table.name, links));
    success(profile.admitSelection(catalog.pivot.table.name, links.map(row => Object.fromEntries(Object.entries(row).reverse()))));
    success(profile.admitSelection(catalog.pivot.table.name, [{ [catalog.pivot.variantColumn]: "other-variant", [catalog.pivot.valueColumn]: "value-0" }]));
    unsupported(profile.admitSelection(catalog.pivot.table.name,
      [{ [catalog.pivot.variantColumn]: "variant", [catalog.pivot.valueColumn]: "value-4" }]));
  });

  it("refuses five raw hidden pivots before native population can project them away", async () => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits, {}, {}, "hidden-image-pivots", "read"));
    const profile = productImageVariantReadProfile(catalog);
    const selected: string[] = [];
    const rows = new Map<string, readonly JsonObject[]>([
      [catalog.variant.table.name, [{ id: "variant", product_id: "product", thumbnail: "old.png", deleted_at: null }]],
      [catalog.pivot.table.name, Array.from({ length: 5 }, (_, index) => ({ [catalog.pivot.variantColumn]: "variant", [catalog.pivot.valueColumn]: "value-" + index }))],
    ]);
    const write = vi.fn(() => Effect.fail(commerceError("unsupportedProfile")));
    const table = (name: string) => {
      const result = rows.get(name);
      if (result === undefined) return Effect.fail(commerceError("invalidAuthority"));
      const store: CommerceCommandContext["store"] = {
        prepareRead(query) { return mockRelationalRead(this, query); },
        find: () => Effect.sync(() => { selected.push(name); return result; }),
        findPage: () => Effect.fail(commerceError("unsupportedProfile")), count: () => Effect.fail(commerceError("unsupportedProfile")),
        aggregate: () => Effect.fail(commerceError("unsupportedProfile")), write, delete: write, lifecycle: write,
      };
      return Effect.succeed(store);
    };
    try {
      expect(await Effect.runPromise(Effect.result(findProductRelated({ manager: lifetime.context, resources: defaultCommerceResources,
        table, admitSelection: profile.admitSelection }, catalog, catalog.variant,
      { where: { id: "variant" }, options: { fields: ["id"], populate: ["options"] } }, false,
      { complete: true, where: profile.where }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(selected).toEqual([catalog.variant.table.name, catalog.pivot.table.name]);
      expect(write).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(lifetime.close); }
  });

  it("bounds actual matching assignment identities, preserving duplicate-pair identities", () => {
    const profile = productImageVariantReadProfile(catalog);
    const rows = Array.from({ length: 8 }, (_, index) => ({ id: "assignment-" + index, image_id: "image", variant_id: "variant" }));
    success(profile.admitSelection(catalog.assignment.table.name, rows));
    success(profile.admitSelection(catalog.assignment.table.name, [...rows, ...rows]));
    unsupported(profile.admitSelection(catalog.assignment.table.name, [{ id: "assignment-8", image_id: "image", variant_id: "variant" }]));
  });

  it("uses command-local state and refuses malformed composite identities", () => {
    const first = productImageVariantReadProfile(catalog), second = productImageVariantReadProfile(catalog);
    success(first.admitSelection(catalog.option.table.name, [0, 1, 2, 3].map(index => ({ id: "first-" + index }))));
    success(second.admitSelection(catalog.option.table.name, [{ id: "other" }]));
    expect(first.admitSelection(catalog.pivot.table.name, [{ [catalog.pivot.variantColumn]: "variant" }]))
      .toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it.each([{ limit: 1 }, { offset: 0 }])("refuses incomplete native preparation before any store execution: %j", async options => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits, {}, {}, "complete-image-read", "read"));
    const table = vi.fn(() => Effect.fail(commerceError("unsupportedProfile")));
    const profile = productImageVariantReadProfile(catalog);
    try {
      expect(await Effect.runPromise(Effect.result(findProductRelated({ manager: lifetime.context, table, resources: defaultCommerceResources,
        admitSelection: profile.admitSelection }, catalog, catalog.variant, { where: {}, options }, false,
      { complete: true, where: profile.where }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
      expect(table).not.toHaveBeenCalled();
    } finally { await Effect.runPromise(lifetime.close); }
  });
});
