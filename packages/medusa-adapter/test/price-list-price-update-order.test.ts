import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { compilePriceListPriceUpdateContracts } from "../src/modules/pricing/price-list-price-update-input";

describe("Price List Price update candidate and snapshot Rule order", () => {
  it("authenticates insertion traversal for active normalization candidates while retaining ID order for complete snapshots", async () => {
    const contracts = Result.getOrThrow(compilePriceListPriceUpdateContracts((await Effect.runPromise(capturePricingMetadata())).frame));
    const ids = ["price-z", "price-a"];
    const active = Result.getOrThrow(contracts.compilePriceReadPlan(buildQuery({ id: ids }, { relations: ["price_rules"], order: { id: "ASC" } })));
    expect(active.populate).toBe(true); expect(active.withDeleted).toBe(false);
    expect(active.rootQuery.order).toEqual({ column: "id", direction: "asc" });
    expect(active.ruleQuery(ids)).toMatchObject({ order: { kind: "storageInsertion", direction: "asc" }, includeIdentities: true,
      predicate: { kind: "and", children: [{ kind: "in", column: "price_id", values: ids }, { kind: "isNull", column: "deleted_at" }] } });
    const snapshot = Result.getOrThrow(contracts.compilePriceReadPlan(buildQuery({ id: ids }, { withDeleted: true, order: { id: "ASC" } })));
    expect(snapshot.populate).toBe(false); expect(snapshot.withDeleted).toBe(true);
    expect(snapshot.rootQuery.order).toEqual({ column: "id", direction: "asc" });
    const snapshotRules = Result.getOrThrow(contracts.compileRuleReadPlan(buildQuery({ price_id: ids }, { withDeleted: true, order: { id: "ASC" } })));
    expect(snapshotRules).toMatchObject({ order: { column: "id", direction: "asc" }, includeIdentities: true,
      predicate: { kind: "in", column: "price_id", values: ids } });
  });
});
