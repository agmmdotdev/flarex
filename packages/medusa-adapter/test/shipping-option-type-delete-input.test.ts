import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { deleteShippingOptionTypesWorkflow } from "@medusajs/core-flows/shipping-options/delete-shipping-option-types";
import { compileShippingOptionTypeDeletionContracts, decodeShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionRead,
  decodeShippingOptionTypeDeletionOutput } from "../src/modules/fulfillment/shipping-option-type-delete-input";
import { captureShippingProfileDeletionMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { shippingOptionTypeDeletionGraph } from "./support/logical-shipping-option-type-deletion-fixture";

let contracts: Result.Result.Success<ReturnType<typeof compileShippingOptionTypeDeletionContracts>>;
beforeAll(async () => { const metadata = await Effect.runPromise(captureShippingProfileDeletionMetadata()); contracts = Result.getOrThrow(compileShippingOptionTypeDeletionContracts(metadata.frame)); });
describe("native Type deletion DML-derived boundaries", () => {
  it("preserves raw empty, missing, duplicate and whitespace IDs under the four-ID bound", () => {
    for (const ids of [[], ["missing", " raw ", "missing", "other"]]) expect(Result.getOrThrow(decodeShippingOptionTypeDeletionIds(ids))).toEqual(ids);
    for (const value of ["scalar", [""], ["1", "2", "3", "4", "5"], [1], ["a".repeat(257)]]) expect(Result.isFailure(decodeShippingOptionTypeDeletionIds(value))).toBe(true);
  });
  it("admits only the native take-one Option existence page and full actual map", () => {
    const input = { filters: { shipping_option_type_id: ["type"] }, config: { select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: 1 } };
    expect(Result.isSuccess(decodeShippingOptionTypeDeletionRead(input))).toBe(true);
    for (const replacement of [{ ...input, filters: { id: ["type"] } }, { ...input, config: { ...input.config, take: 2 } },
      { ...input, config: { ...input.config, select: ["id", "name"] } }, { ...input, config: { ...input.config, skip: 1 } }])
      expect(Result.isFailure(decodeShippingOptionTypeDeletionRead(replacement))).toBe(true);
    for (const value of [{}, { shipping_option_type_id: ["one", "two"] }]) expect(Result.isSuccess(decodeShippingOptionTypeDeletionOutput(value))).toBe(true);
    for (const value of [{ shipping_option_id: ["one"] }, { shipping_option_type_id: [1] }, { shipping_option_type_id: ["one"], extra: true }])
      expect(Result.isFailure(decodeShippingOptionTypeDeletionOutput(value))).toBe(true);
  });
  it("validates complete Type and Option bodies and exact no-cascade lifecycle tuple before projection", () => {
    const graph = shippingOptionTypeDeletionGraph("pure", 1, { optionsPerType: 1 });
    const type = graph.rows.find(row => row.table === "shipping_option_type")?.row, option = graph.rows.find(row => row.table === "shipping_option")?.row;
    if (type === undefined || option === undefined) throw new Error("Missing complete native bodies");
    expect(Result.isSuccess(contracts.decodeRow(type))).toBe(true); expect(Result.isSuccess(contracts.decodeOptionRow(option))).toBe(true);
    expect(Result.isSuccess(contracts.decodeLifecycleResult([[type], { ShippingOptionType: [type] }]))).toBe(true);
    for (const tuple of [[[type], {}], [[type], { ShippingOptionType: [type], ShippingOption: [option] }], [[], { ShippingOptionType: [type] }]])
      expect(Result.isFailure(contracts.decodeLifecycleResult(tuple))).toBe(true);
    const { provider_id: _provider, ...incomplete } = option;
    expect(Result.isFailure(contracts.decodeOptionRow(incomplete))).toBe(true); expect(Result.isFailure(contracts.decodeOptionRow({ ...option, id: 1 }))).toBe(true);
    expect(Result.isFailure(contracts.decodeRow({ ...type, shipping_options: [] }))).toBe(true);
  });
  it("resolves the genuine native Event Bus dependency even for an empty message array", async () => {
    const node = Result.getOrThrow(deleteShippingOptionTypesWorkflow.prepare()).nodes.find(node => node.name === "emit-event-step");
    if (node?.kind !== "step") throw new Error("Missing genuine native event step");
    const requested: string[] = [], missing = new Error("Missing native Event Bus observation port");
    await expect(node.invoke({ eventName: "shipping-option-type.deleted", data: [] }, {
      eventGroupId: "native-empty-type-deletion",
      container: { resolve: (name: string): never => { requested.push(name); throw missing; } },
    })).rejects.toBe(missing);
    expect(requested).toEqual(["event_bus"]);
  });
});
