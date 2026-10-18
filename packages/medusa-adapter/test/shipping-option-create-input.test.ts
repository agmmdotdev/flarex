import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureServiceZoneCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileShippingOptionCreationContracts, decodeShippingOptionCreates } from "../src/modules/fulfillment/shipping-option-create-input";
import { decodeShippingOptionListArguments } from "../src/modules/fulfillment/shipping-option-create-service";
import { captureGraph } from "../src/write/create";
import { prepareShippingOptionCreationGraph } from "../src/modules/fulfillment/shipping-option-create-graph";
import { decodeShippingOptionReadInput, decodeShippingProviderReadInput } from "../src/modules/fulfillment/shipping-option-create-query";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionCreationContracts>>;
const input = { name: "Native", price_type: "flat", service_zone_id: "zone", shipping_profile_id: "profile", provider_id: "manual_manual",
  type: { label: " Native Type ", code: "", description: null }, rules: [{ attribute: "enabled", operator: "eq", value: true }], prices: [] };
beforeAll(async () => { contracts = Result.getOrThrow(compileShippingOptionCreationContracts((await Effect.runPromise(captureServiceZoneCreationMetadata())).frame)); });

describe("bounded native Shipping Option creation contracts", () => {
  it("admits the complete eight-Provider availability cohort while other read cohorts stay four", () => {
    const ids = Array.from({ length: 8 }, (_, index) => "provider-" + index);
    expect(Result.isSuccess(decodeShippingProviderReadInput({ filters: { id: ids }, config: { select: ["id"] } }))).toBe(true);
    expect(Result.isFailure(decodeShippingProviderReadInput({ filters: { id: [...ids, "outside"] } }))).toBe(true);
    expect(Result.isFailure(decodeShippingOptionReadInput({ filters: { id: ids } }))).toBe(true);
    expect(contracts.entities.find(entity => entity.model === "FulfillmentProvider")?.maximum).toBe(8);
    expect(contracts.optionEntity.maximum).toBe(4);
  });
  it("admits declared creates and exact existing Type references while refusing unadmitted upsert identities", () => {
    for (const value of [[], [input], [{ ...input, type: "existing", type_id: "existing" }]])
      expect(Result.getOrThrow(decodeShippingOptionCreates(value))).toEqual(value);
    for (const value of [[{ ...input, id: "update" }], [{ ...input, type: { id: "existing" } }], [{ ...input, type: { ...input.type, id: "update-type" } }],
      [{ ...input, rules: [{ ...input.rules[0], id: "update-rule" }] }], [{ ...input, shipping_option_type_id: "raw-extra" }],
      [{ ...input, type: { shipping_options: [] } }], [{ ...input, rules: [{ ...input.rules[0], shipping_option_id: "outside" }] }],
      [{ ...input, created_at: "timestamp" }], [{ ...input, rules: Array(5).fill(input.rules[0]) }], Array(5).fill(input)])
      expect(Result.isFailure(decodeShippingOptionCreates(value))).toBe(true);
  });

  it("normalizes only the selected native ID-array undefined values and preserves positional optional config", () => {
    expect(Result.getOrThrow(decodeShippingOptionListArguments([{ id: [undefined, "known", undefined] }, undefined])))
      .toEqual([{ id: ["", "known", ""] }, undefined]);
    expect(Result.getOrThrow(decodeShippingOptionListArguments([{ id: [] }, { select: ["id"] }])))
      .toEqual([{ id: [] }, { select: ["id"] }]);
    for (const args of [[{ id: [null] }], [{ id: [false] }], [{ id: [undefined], unknown: undefined }], [{ unknown: [undefined] }]])
      expect(Result.isFailure(decodeShippingOptionListArguments(args))).toBe(true);
  });

  it("uses generated Type/Option/Rule graph identities with Type references leaving no new Type rows", async () => {
    const { profile } = prepareShippingOptionCreationGraph(contracts), before = structuredClone(input);
    const created = await Effect.runPromise(captureGraph(profile, [input]));
    const option = created.rows.get("shipping_option")?.[0], type = created.rows.get("shipping_option_type")?.[0], rule = created.rows.get("shipping_option_rule")?.[0];
    expect(type?.id).toMatch(/^sotype_/); expect(option?.id).toMatch(/^so_/); expect(rule?.id).toMatch(/^sorul_/);
    expect(option?.shipping_option_type_id).toBe(type?.id); expect(rule?.shipping_option_id).toBe(option?.id);
    expect(option).not.toHaveProperty("type"); expect(option).not.toHaveProperty("prices"); expect(option).not.toHaveProperty("type_id");
    expect(input).toEqual(before);
    for (const type of ["existing"]) {
      // This is the genuine workflow step's normalized type_id argument shape.
      const referenced = await Effect.runPromise(captureGraph(profile, [{ ...input, type, type_id: "existing" }]));
      expect(referenced.rows.get("shipping_option_type")).toEqual([]);
      expect(referenced.rows.get("shipping_option")?.[0]?.shipping_option_type_id).toBe("existing");
    }
  });
});
