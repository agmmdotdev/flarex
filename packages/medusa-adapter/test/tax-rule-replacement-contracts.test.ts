import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../src/value/input";
import { decodeTaxRuleReplacementInput, decodeTaxRuleReplacementIds, decodeTaxRuleReplacementRead } from "../src/modules/tax/rule-replacement-input";
import { taxRuleReplacementResources } from "../src/workflow/policy";

const decode = (value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeTaxRuleReplacementInput));
const rule = { reference: "product", reference_id: "prod167", created_by: "template-creator", metadata: { nested: [null, 1] } };

describe("bounded Tax Rule replacement contracts", () => {
  it("retains every ordinary resource limit for the root and retained inverse", () => {
    expect(taxRuleReplacementResources).toEqual(defaultCommerceResources);
    expect(Object.isFrozen(taxRuleReplacementResources)).toBe(true);
  });
  it("preserves raw empty, duplicate and missing Rate positions and empty templates", () => {
    for (const value of [{ tax_rate_ids: [], rules: [] }, { tax_rate_ids: ["", "missing", "same", "same"], rules: [] },
      { tax_rate_ids: [], rules: [rule, rule] }]) expect(Result.getOrThrow(decode(value))).toEqual(value);
  });
  it("admits empty selectors for no-op creation and refuses empty parents before entering native creation", () => {
    for (const tax_rate_ids of [[""], ["rate", "", "rate"], ["", "", "", ""]]) {
      expect(Result.getOrThrow(decode({ tax_rate_ids, rules: [] }))).toEqual({ tax_rate_ids, rules: [] });
      expect(decode({ tax_rate_ids, rules: [rule] })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    }
    // The original ORM's nonempty-template/empty-parent RangeError remains an
    // outside-profile witness; bounded admission does not reproduce that error.
    expect(Result.getOrThrow(decode({ tax_rate_ids: ["rate-z", "rate-a", "rate-z"], rules: [rule] })))
      .toEqual({ tax_rate_ids: ["rate-z", "rate-a", "rate-z"], rules: [rule] });
  });
  it("detaches the maximum raw Cartesian envelope including supplied Rule identities", () => {
    const value = { tax_rate_ids: ["rate-c", "rate-a", "rate-d", "rate-b"],
      rules: [{ ...rule, id: "shared-id" }, { ...rule, reference_id: "second", metadata: [null, false] }] };
    const original = structuredClone(value), decoded = Result.getOrThrow(decode(value));
    expect(decoded).toEqual(original); expect(value).toEqual(original);
    expect(decoded.tax_rate_ids).not.toBe(value.tax_rate_ids); expect(decoded.rules[0]?.metadata).not.toBe(value.rules[0]?.metadata);
  });
  it.each([
    ["missing fields", {}], ["fifth raw Rate", { tax_rate_ids: ["a", "a", "a", "a", "a"], rules: [] }],
    ["third template", { tax_rate_ids: [], rules: [rule, rule, rule] }],
    ["scalar Rate selector", { tax_rate_ids: "rate", rules: [] }], ["null Rate", { tax_rate_ids: [null], rules: [] }],
    ["long Rate", { tax_rate_ids: ["x".repeat(257)], rules: [] }],
    ["template parent", { tax_rate_ids: [], rules: [{ ...rule, tax_rate_id: "unowned" }] }],
    ["unknown root", { tax_rate_ids: [], rules: [], extra: true }],
    ["missing reference", { tax_rate_ids: [], rules: [{ reference_id: "prod" }] }],
    ["invalid creator", { tax_rate_ids: [], rules: [{ ...rule, created_by: 1 }] }],
  ])("refuses %s before any native dependency", (_name, value) => expect(Result.isFailure(decode(value))).toBe(true));
  it("refuses accessors before evaluating caller code", () => {
    let called = false;
    expect(Result.isFailure(decode({ tax_rate_ids: [], get rules() { called = true; return []; } }))).toBe(true);
    expect(called).toBe(false);
  });
  it("permits only the genuine complete projected-ID list and selected fields", () => {
    expect(Result.getOrThrow(decodeTaxRuleReplacementRead({ filters: { tax_rate_id: [""] }, config: { select: ["id"] } })))
      .toEqual({ filters: { tax_rate_id: [""] }, config: { select: ["id"] } });
    expect(Result.getOrThrow(decodeTaxRuleReplacementIds([{ id: "rule167" }]))).toEqual([{ id: "rule167" }]);
    for (const value of [[{ id: "rule167", metadata: null }], [{ id: "" }], Array.from({ length: 9 }, (_, index) => ({ id: `rule-${index}` }))])
      expect(Result.isFailure(decodeTaxRuleReplacementIds(value))).toBe(true);
    for (const config of [{ select: ["id"], take: 8 }, { select: ["id", "tax_rate_id"] }, { select: [] }])
      expect(Result.isFailure(decodeTaxRuleReplacementRead({ filters: { tax_rate_id: [] }, config }))).toBe(true);
  });
});
