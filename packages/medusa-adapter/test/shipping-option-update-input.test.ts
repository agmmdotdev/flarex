import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionUpdateContracts, decodeShippingOptionUpdates } from "../src/modules/fulfillment/shipping-option-update-input";
import { prepareShippingOptionUpdateQuery } from "../src/modules/fulfillment/shipping-option-update-query";
import { prepareShippingOptionRuleRepository } from "../src/modules/fulfillment/shipping-option-rule-repository";
import { decodeShippingOptionRuleCreates } from "../src/modules/fulfillment/shipping-option-rule-input";
import { captureCommerceInput } from "../src/value/input";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionUpdateContracts>>;
let reads: Result.Result.Success<ReturnType<typeof prepareShippingOptionUpdateQuery>>;
let rules: Result.Result.Success<ReturnType<typeof prepareShippingOptionRuleRepository>>;
const stamp = "2026-10-18T00:00:00.000Z";
beforeAll(async () => {
  const metadata = (await Effect.runPromise(captureServiceZoneCreationMetadata())).frame;
  contracts = Result.getOrThrow(compileShippingOptionUpdateContracts(metadata));
  reads = Result.getOrThrow(prepareShippingOptionUpdateQuery(contracts));
  rules = Result.getOrThrow(prepareShippingOptionRuleRepository(metadata, "shipping-option-update"));
});

describe("native Shipping Option update structural boundaries", () => {
  it("preserves omitted, empty and supplied relation inputs for genuine native validation", () => {
    const input = [{ id: "option", name: " Raw Name ", data: { nested: [null, true] } },
      { id: "option", rules: [] }, { id: "other", type: { id: "existing-type" }, rules: [{ id: "rule", value: true }] }];
    expect(Result.getOrThrow(decodeShippingOptionUpdates(input))).toEqual(input);
    for (const malformed of [[{}], [{ id: "option", fulfillments: [] }], [{ id: "option", unknown: true }],
      [{ id: "option", rules: Array(5).fill({}) }], Array(5).fill({ id: "option" })])
      expect(Result.isFailure(decodeShippingOptionUpdates(malformed))).toBe(true);
  });

  it("expands the genuine full Rule preimage while retaining JSON and transient aliases narrowly", () => {
    const plan = Result.getOrThrow(captureCommerceInput(buildQuery({ id: ["option"] }, {
      select: ["id", "rules.*", "data.nested", "type_id"], relations: ["rules", "data", "data.nested"],
    })).pipe(Result.flatMap(input => reads.query(contracts.option.name, input))));
    expect(plan.paths).toEqual(["rules"]);
    expect(plan.projection.node.fields.has("data")).toBe(true);
    expect(plan.projection.node.children[0]?.node.fields.has("created_at")).toBe(true);
    expect(plan.projection.node.children[0]?.node.fields.has("shipping_option_id")).toBe(true);
    for (const config of [{ select: ["unknown"] }, { relations: ["fulfillments"] }, { select: ["rules.unknown"], relations: ["rules"] }])
      expect(Result.isFailure(captureCommerceInput(buildQuery({ id: ["option"] }, config)).pipe(Result.flatMap(input => reads.query(contracts.option.name, input))))).toBe(true);
  });

  it("admits sixteen original Rule identities and timestamps only in the selected compensation profile", () => {
    const restored = Array.from({ length: 16 }, (_, index) => ({ id: "rule-" + index, attribute: "enabled", operator: "eq", value: "true",
      shipping_option_id: "option-" + Math.floor(index / 4), created_at: stamp, updated_at: stamp, deleted_at: null }));
    expect(Result.getOrThrow(rules.inputs.decodeCreates(restored))).toEqual(restored);
    expect(Result.isFailure(decodeShippingOptionRuleCreates([restored[0]]))).toBe(true);
    expect(Result.isFailure(rules.inputs.decodeCreates([...restored, restored[0]]))).toBe(true);
    expect(Result.getOrThrow(rules.inputs.decodeRead({ filters: { shipping_option_id: ["a", "b", "c", "d"] },
      config: { select: ["id", "shipping_option_id"] } }))).toMatchObject({ filters: { shipping_option_id: ["a", "b", "c", "d"] } });
    expect(Result.isFailure(rules.inputs.decodeRead({ filters: { shipping_option_id: ["a", "b", "c", "d", "e"] } }))).toBe(true);
  });

  it("admits the old and replacement Type cohort while the creation profile remains unchanged", () => {
    expect(contracts.entities.find(entity => entity.table.name === contracts.type.name)?.maximum).toBe(8);
    expect(contracts.typeEntity.maximum).toBe(4);
    expect(Result.getOrThrow(contracts.decodePreimages([{ id: "option", rules: [], type: { id: "type" } }])))
      .toEqual([{ id: "option", rules: [], type: { id: "type" } }]);
    expect(Result.isFailure(contracts.decodePreimages([{ id: "option", rules: [{ id: "rule", shipping_option_id: "outside" }] }]))).toBe(true);
  });

  it("admits the native cumulative duplicate Rule deletion selector without increasing the selected row cohort", () => {
    const groups = Array.from({ length: 4 }, (_, group) => Array.from({ length: 4 }, (_, index) => "rule-" + group + "-" + index));
    const raw = groups.flatMap((_group, index) => groups.slice(0, index).flat());
    expect(raw).toHaveLength(24); expect(new Set(raw).size).toBe(12);
    expect(Result.getOrThrow(rules.inputs.decodeIds(raw))).toEqual(raw);
    expect(Result.isFailure(rules.inputs.decodeIds([...raw, "outside"]))).toBe(true);
    expect(rules.inputs.maximum).toBe(16);
  });
});
