import { describe, expect, it } from "vitest";
import { buildPromotionPrefilterPlan, portablePromotionRuleQueryFilter, promotionContextAttributes,
  type PromotionPrefilterPersistence, type PromotionRelatedPredicate } from "@medusajs/promotion/prefilter";

describe("native Promotion portable prefilter policy", () => {
  it("retains native flattening, scalar identity and lexical guards while ignoring nonfinite thresholds", () => {
    const attributes = promotionContextAttributes({ currency_code: "usd", items: [{ id: "item1", quantity: 2, subtotal: 2, original_total: 2, is_discountable: true }, { id: "item2", quantity: "2", subtotal: 2, original_total: 2, is_discountable: true }], shipping_methods: [],
      customer: { id: "customer1", groups: [{ id: "a" }, { id: "b" }] }, total: "Infinity" });
    expect([...attributes.get("items.quantity") ?? []]).toEqual([2, "2"]);
    expect([...attributes.get("customer.groups.id") ?? []]).toEqual(["a", "b"]);
    const plan = buildPromotionPrefilterPlan(attributes);
    expect(plan.sqlCondition).toContain("prv.value NOT IN ('2','2') AND CAST(prv.value AS DECIMAL) > 2");
    expect(plan.sqlCondition).not.toMatch(/DECIMAL\) [<>=]+ Infinity/);
    expect(plan.sqlCondition).toContain("pr.attribute = 'total' AND pr.operator IN ('in', 'eq')");
  });

  it("uses FALSE for an attribute with an empty native value set", () => {
    const plan = buildPromotionPrefilterPlan(new Map([["empty", new Set<string>()]]));
    expect(plan.attributes).toEqual(["empty"]);
    expect(plan.sqlCondition).toBe("FALSE");
    expect(plan.predicate).toEqual({ kind: "and", children: [
      { kind: "parent", predicate: { kind: "in", column: "attribute", values: ["empty"] } }, { kind: "or", children: [] },
    ] });
  });

  function persistence(input: { roots?: readonly { id: string }[]; availableRules?: readonly { id: string; attribute: string }[]; evaluate?: (predicate: PromotionRelatedPredicate) => Promise<readonly { id: string }[]> } = {}) {
    const calls: string[] = [];
    const port: PromotionPrefilterPersistence = {
      promotions: async () => { calls.push("roots"); return input.roots ?? [{ id: "p_auto" }]; },
      evaluateRules: async predicate => { calls.push("evaluate"); return input.evaluate?.(predicate) ?? []; },
      rules: async () => { calls.push("rules"); return input.availableRules ?? [{ id: "r_missing", attribute: "missing" }]; },
      globalRules: async () => { calls.push("global"); return [{ promotion_id: "p_auto", promotion_rule_id: "r_missing" }]; },
      targetRules: async () => { calls.push("target"); return []; },
      buyRules: async () => { calls.push("buy"); return []; },
      applicationMethods: async () => { calls.push("methods"); return []; },
    };
    return { port, calls };
  }

  it("evaluates the complete historical program before applying membership exclusions", async () => {
    const { port, calls } = persistence({ evaluate: async () => { throw new Error("native numeric cast failure"); } });
    await expect(portablePromotionRuleQueryFilter({ currency_code: "usd", amount: 2 }, {}, port)).rejects.toThrow("native numeric cast failure");
    expect(calls).toEqual(["roots", "evaluate"]);
  });

  it("skips Rule/Value evaluation when no automatic root exists", async () => {
    const { port, calls } = persistence({ roots: [] });
    await expect(portablePromotionRuleQueryFilter({ currency_code: "usd", amount: 2 }, {}, port)).resolves.toEqual({ id: { $in: [] } });
    expect(calls).toEqual(["roots"]);
  });

  it("excludes missing attributes and preserves the empty-context any-Link branch", async () => {
    const populated = persistence();
    await expect(portablePromotionRuleQueryFilter({ currency_code: "usd", amount: 2 }, {}, populated.port)).resolves.toEqual({ id: { $in: [] } });
    expect(populated.calls).toEqual(["roots", "evaluate", "rules", "global", "target", "buy", "methods"]);
    const empty = persistence({ availableRules: [] });
    await expect(portablePromotionRuleQueryFilter({ currency_code: "usd", a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10 }, {}, empty.port)).resolves.toEqual({ id: { $in: [] } });
    expect(empty.calls).toEqual(["rules", "roots", "global", "target", "buy", "methods"]);
  });

  it("keeps the unselected checkout-read profile refused", async () => {
    await expect(portablePromotionRuleQueryFilter({ currency_code: "usd" }, {})).rejects.toThrow("outside the checkout read profile");
  });
});
