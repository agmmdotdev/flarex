import { describe, expect, it } from "vitest";
import { applyUpsertRelationResults, planUpsertManyEntries, planUpsertRelationEntries, prepareUpsertWithReplaceEntries, uniqueUpsertEntries } from "@medusajs/utils/dal/upsert-planning";

interface Source extends Record<string, unknown> {
  id: string;
  amount: number;
  price_rules?: readonly { id: string; value: string }[] | undefined;
}
const prepare = (source: Source) => {
  const { price_rules, ...entity } = source;
  return { entity, relations: { price_rules: price_rules === undefined ? undefined : [] } };
};

describe("native DAL batch and reconstructed response planning", () => {
  it("keeps first scalar writes, last relation sources and native unique-index raw response placement", () => {
    const firstRules = [{ id: "rule_a_first", value: "first" }];
    const lastRules = [{ id: "rule_a_last", value: "last" }];
    const freshRules = [{ id: "rule_b_fresh", value: "fresh" }];
    const sources: Source[] = [
      { id: "existing_a", amount: 77, price_rules: firstRules },
      { id: "existing_a", amount: 88, price_rules: lastRules },
      { id: "fresh_b", amount: 55, price_rules: freshRules },
    ];
    const before = structuredClone(sources), plan = prepareUpsertWithReplaceEntries(sources, prepare);
    const unique = uniqueUpsertEntries(plan.toUpsert), batch = planUpsertManyEntries(unique, new Map([["existing_a", { id: "existing_a" }]]));
    expect(batch.orderedEntities.map(row => [row.id, row.amount])).toEqual([["existing_a", 77], ["fresh_b", 55]]);
    expect(batch.toUpdate).toEqual([plan.toUpsert[0]]); expect(batch.toInsert).toEqual([plan.toUpsert[2]]);
    expect([...batch.updateOrderMap]).toEqual([["existing_a", 0]]); expect([...batch.insertOrderMap]).toEqual([["fresh_b", 1]]);
    expect(plan.originalDataMap.get("existing_a")).toBe(sources[1]);
    expect(plan.reconstructedResponse.map(row => [row.id, row.amount])).toEqual([["existing_a", 77], ["existing_a", 88], ["fresh_b", 55]]);
    const relations = planUpsertRelationEntries(batch.orderedEntities, plan.originalDataMap, plan.reconstructedResponse, "price_rules");
    expect(relations.map(row => [row.entity.id, row.entity.amount, row.index])).toEqual([["existing_a", 88, 0], ["fresh_b", 55, 1]]);
    expect(relations[0]?.entity.price_rules).toBe(lastRules); expect(relations[1]?.entity.price_rules).toBe(freshRules);
    expect(relations[0]?.reconstructedEntry).toBe(plan.reconstructedResponse[0]);
    expect(relations[1]?.reconstructedEntry).toBe(plan.reconstructedResponse[1]);
    applyUpsertRelationResults(plan.reconstructedResponse, "price_rules", relations.map(row => ({ entities: row.entity.price_rules, index: row.index })));
    // Native reconstruction uses unique-root indices, even when an earlier raw
    // duplicate shifts the fresh root's corresponding raw response position.
    expect(plan.reconstructedResponse.map(row => [row.id, row.price_rules])).toEqual([["existing_a", lastRules], ["existing_a", freshRules], ["fresh_b", []]]);
    expect(sources).toEqual(before);
  });

  it("preserves skipped updates and original batch order without mutating inputs", () => {
    const rows = [{ id: "b", amount: 1 }, { id: "a", amount: 2 }, { id: "b", amount: 3 }];
    const unique = uniqueUpsertEntries(rows), plan = planUpsertManyEntries(unique, new Map([["b", { id: "b" }]]), true);
    expect(unique).toEqual([rows[0], rows[1]]); expect(unique[0]).toBe(rows[0]);
    expect(plan.orderedEntities).toEqual(unique); expect(plan.toUpdate).toEqual([]); expect([...plan.updateOrderMap]).toEqual([]);
    expect(plan.toInsert).toEqual([rows[1]]); expect([...plan.insertOrderMap]).toEqual([["a", 1]]);
    expect(rows.map(row => row.amount)).toEqual([1, 2, 3]);
  });

  it("distinguishes missing and undefined relations from a present empty relation", () => {
    const sources: Source[] = [{ id: "missing", amount: 1 }, { id: "undefined", amount: 2, price_rules: undefined }, { id: "empty", amount: 3, price_rules: [] }];
    const plan = prepareUpsertWithReplaceEntries(sources, prepare);
    const relations = planUpsertRelationEntries(uniqueUpsertEntries(plan.toUpsert), plan.originalDataMap, plan.reconstructedResponse, "price_rules");
    expect(relations.map(row => [row.entity.id, row.index])).toEqual([["empty", 2]]);
    expect(Object.hasOwn(sources[0] ?? {}, "price_rules")).toBe(false);
    expect(Object.hasOwn(sources[1] ?? {}, "price_rules")).toBe(true);
    expect(plan.reconstructedResponse.map(row => row.price_rules)).toEqual([undefined, undefined, []]);
  });
});
