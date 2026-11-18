import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { CartProduct } from "@medusajs/link-modules";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { decodeGraphDirectPaths, nativeLinkGraphDirectPaths } from "../src/local-graph/direct-paths";
import { defineGraphReadCommand } from "../src/local-graph/commands";
import { decodeGraphCount, prepareLocalGraph } from "../src/local-graph/query";
import type { GraphParticipant, GraphReadDefinition } from "../src/local-graph/model";

it("interprets the genuine Cart LineItem variant key relative to its selected source", () => {
  const paths = Result.getOrThrow(nativeLinkGraphDirectPaths(CartProduct, [{ root: "Cart", path: "items.variant",
    maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], "LineItem"));
  expect(paths).toMatchObject([{ sourceModel: "LineItem", sourceKey: "variant_id", targetModel: "ProductVariant", targetKey: "id" }]);
});

it("authenticates the resolved scalar against actual source and target read columns", () => {
  const paths = Result.getOrThrow(nativeLinkGraphDirectPaths(CartProduct, [{ root: "Cart", path: "items.variant",
    maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], "LineItem"));
  const read = (model: string, columns: string[]): GraphReadDefinition => ({ model,
    command: defineGraphReadCommand("readonlyKey" + model, () => Effect.succeed([[], 0])),
    table: { name: model.toLowerCase(), columns, primaryKeys: ["id"], foreignKeys: [], companions: {} },
    paths: [], orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount });
  const cart = read("Cart", ["id"]), item = read("LineItem", ["id", "variant_id"]), variant = read("ProductVariant", ["id"]);
  const participants = (source = item, target = variant): GraphParticipant[] => [
    { participant: defineAtomicCommerceParticipant("readonly-source"), module: { aliases: [{ name: "cart", model: "Cart" }, { name: "line_item", model: "LineItem" }],
      reads: [{ ...cart, paths: [{ path: "items", table: source.table, many: true }] }, source], directPaths: paths } },
    { participant: defineAtomicCommerceParticipant("readonly-target"), module: { aliases: [{ name: "variant", model: "ProductVariant" }], reads: [target] } },
  ];
  expect(Result.getOrThrow(prepareLocalGraph(participants())).entities).toContain("cart");
  expect(Result.isFailure(prepareLocalGraph(participants({ ...item, table: { ...item.table, columns: ["id"] } })))).toBe(true);
  expect(Result.isFailure(prepareLocalGraph(participants(item, { ...variant, table: { ...variant.table, columns: ["title"] } })))).toBe(true);
  expect(Result.isFailure(decodeGraphDirectPaths(paths.map(path => ({ ...path, sourceKey: "items.variant_id" }))))).toBe(true);
});

it("refuses a dotted native key for a different or missing parent path", () => {
  for (const path of ["other.variant", "variant", "items.other.variant"]) {
    expect(Result.isFailure(nativeLinkGraphDirectPaths(CartProduct, [{ root: "Cart", path,
      maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], "LineItem"))).toBe(true);
  }
});
