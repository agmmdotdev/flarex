import { Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLocalGraph } from "../src/local-graph/query";
import type { GraphReadDefinition } from "../src/local-graph/model";
import { nestedPrefixParticipants } from "./support/logical-nested-prefix";

it("authenticates a target-local Product prefix beneath the genuine Cart Variant edge", () => {
  expect(Result.isSuccess(prepareLocalGraph(nestedPrefixParticipants()))).toBe(true);
});

it("refuses missing, differently owned and mismatched target-local prefixes", () => {
  const selected = nestedPrefixParticipants();
  const productOwner = selected[1];
  if (productOwner === undefined) throw new Error("Missing neutral Product owner");
  const product = productOwner.module.reads.find(read => read.model === "Product");
  if (product === undefined) throw new Error("Missing Product source read");
  const mutate = (change: (read: GraphReadDefinition) => GraphReadDefinition) => selected.map(entry => entry !== productOwner ? entry : {
    ...entry, module: { ...entry.module, reads: entry.module.reads.map(change) },
  });
  for (const participants of [
    mutate(read => read.model === "ProductVariant" ? { ...read, paths: [] } : read),
    mutate(read => read.model === "ProductVariant" ? { ...read, paths: read.paths.map(path => ({ ...path, table: { ...path.table, name: "other_product" } })) } : read),
    mutate(read => read.model === "Product" ? { ...read, table: { ...read.table, columns: ["id"] } } : read),
    [...selected.map(entry => entry !== productOwner ? entry : { ...entry, module: { ...entry.module,
      aliases: entry.module.aliases.filter(alias => alias.model !== "Product"), reads: entry.module.reads.filter(read => read.model !== "Product") } }),
      { participant: defineAtomicCommerceParticipant("foreign-product-owner"), module: { aliases: [{ name: "foreign_product", model: "Product" }], reads: [product] } }],
  ]) expect(Result.isFailure(prepareLocalGraph(participants))).toBe(true);
});
