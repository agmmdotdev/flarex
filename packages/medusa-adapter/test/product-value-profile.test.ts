import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata, type ProductRuntimeMetadata } from "../src/product-runtime-metadata";
import { captureProductGraph, validateProductCreate } from "../src/product-graph";
import type { CommerceTransactionError, Json } from "@flarex/persistence-postgres/internal/commerce-values";

const run = <A>(effect: Effect.Effect<A, CommerceTransactionError>) => Effect.runPromise(effect.pipe(Effect.result, Effect.map(result => Result.match(result, {
  onSuccess: value => ({ value }), onFailure: error => ({ reason: error.reason }),
}))));
let catalog: ProductRuntimeMetadata;
beforeAll(async () => {
  catalog = await Effect.runPromise(captureProductSchema("product-values").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
});

describe("Product creation and normalized graph profiles", () => {
  it("checks DML update pairs without allowing identity, managed or undeclared writes", () => {
    const profile = catalog.valueProfile;
    const table = catalog.tag.table.name;
    expect(profile.decodeRelatedUpdatePairs(table, [{ entity: { id: "tag-a", value: "old" }, update: { id: "tag-a", value: "new", metadata: { keep: true } } }]))
      .toMatchObject({ _tag: "Success", success: [{ id: "tag-a", value: "new", metadata: { keep: true } }] });
    for (const update of [{ id: "tag-b" }, { updated_at: "now" }, { created_at: "now" }, { deleted_at: null }, { extra: 1 }]) {
      expect(Result.isFailure(profile.decodeRelatedUpdatePairs(table, [{ entity: { id: "tag-a" }, update }]))).toBe(true);
    }
    expect(Result.isFailure(profile.validateRelatedUpdateData(table, { id: "tag-a" }))).toBe(true);
    expect(Result.isFailure(profile.validateRelatedChange(table, [{ id: "tag-a" }, { id: "tag-a", value: "last" }]))).toBe(true);
    expect(Result.isFailure(profile.decodeRelatedUpdatePairs(catalog.assignment.table.name, []))).toBe(true);
    expect(Result.isFailure(profile.decodeRelatedUpdatePairs(table, [{ entity: { id: "tag-a" }, update: {} }, { entity: { id: "tag-a" }, update: {} }]))).toBe(true);
    expect(profile.decodeRelatedUpdatePairs(table, [{ entity: { id: "tag-a" }, update: {} }])).toMatchObject({ _tag: "Success", success: [{ id: "tag-a" }] });
  });
  it.each<[Json, string]>([
    [{ title: "p", extra: true }, "unsupportedProfile"],
    [{ title: "p", created_at: "now" }, "unsupportedProfile"],
    [{ title: "p", options: null }, "invalidInput"],
    [{ title: "p", options: [null] }, "unsupportedProfile"],
    [{ title: "p", options: [{ title: "size", values: [1] }] }, "invalidInput"],
    [{ title: "p", variants: [{ options: [] }] }, "invalidInput"],
    [{ title: "p", images: [{ url: "x", product_id: "p" }] }, "unsupportedProfile"],
  ])("preserves raw creation refusal %#", async (input, reason) => {
    expect(await run(validateProductCreate(catalog, input))).toEqual({ reason });
  });

  it("accepts the service option syntax without normalizing or mutating it", async () => {
    const input = { title: "p", options: [{ title: "size", values: ["s"] }], variants: [{ title: "v", options: { size: "s" } }] };
    const before = structuredClone(input);
    expect(await run(validateProductCreate(catalog, input))).toHaveProperty("value");
    expect(input).toEqual(before);
  });

  it("captures parent links, repeated variant references and pivot rows", async () => {
    const variant = { id: "v", title: "v" };
    const input = [{ id: "p", variants: [variant], images: [{ id: "i", url: "x" }], options: [{ id: "o", title: "size", values: [{ id: "ov", value: "s", variants: [variant] }] }] }];
    const graph = await Effect.runPromise(captureProductGraph(catalog, input));
    expect(graph.products).toEqual(["p"]);
    expect(graph.rows.get(catalog.variant.table.name)).toEqual([{ id: "v", title: "v", [catalog.foreignKeys.variant]: "p" }]);
    expect(graph.rows.get(catalog.pivot.table.name)).toEqual([{ [catalog.pivot.variantColumn]: "v", [catalog.pivot.valueColumn]: "ov" }]);
    expect(input[0]?.variants[0]).toEqual(variant);
  });

  it.each<Json>([
    {}, [null], [{ id: "" }], [{ id: "p", extra: true }], [{ id: "p" }, { id: "p" }],
    [{ id: "p", variants: [{ id: "v", product_id: "other" }] }],
    [{ id: "p", options: [{ id: "o", values: [{ id: "ov", variants: [{ id: "missing" }] }] }] }],
    [{ id: "p", variants: [{ id: "v" }], options: [{ id: "o", values: [{ id: "ov", variants: [{ id: "v", extra: true }] }] }] }],
    [{ id: "p", variants: [{ id: "v" }], options: [{ id: "o", values: [{ id: "ov", variants: [{ id: "v" }, { id: "v" }] }] }] }],
  ])("preserves normalized graph refusal %#", async input => {
    expect(await run(captureProductGraph(catalog, input))).toEqual({ reason: "invalidInput" });
  });

  it("retains row budgets and capture safety", async () => {
    expect(await run(captureProductGraph(catalog, Array.from({ length: 257 }, (_, i) => ({ id: "p" + i }))))).toEqual({ reason: "limitExceeded" });
    let reads = 0;
    expect(await run(captureProductGraph(catalog, [{ get id() { reads += 1; return "p"; } }]))).toEqual({ reason: "invalidInput" });
    expect(reads).toBe(0);
  });
});
