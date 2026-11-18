import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { captureFulfillmentCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentCreationContracts } from "../src/modules/fulfillment/fulfillment-create-input";
import { prepareFulfillmentReturnQuery } from "../src/modules/fulfillment/fulfillment-return-query";

const fields = ["id", "name", "data", "metadata"];
const nativeInput = () => buildQuery({ id: "so146-selected" }, { select: [...fields] });
let reads: Result.Result.Success<ReturnType<typeof prepareFulfillmentReturnQuery>>;

beforeAll(async () => {
  reads = await Effect.runPromise(Effect.gen(function* () {
    const metadata = yield* captureFulfillmentCreationMetadata(), contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
    return yield* Effect.fromResult(prepareFulfillmentReturnQuery(contracts));
  }));
});

describe("Return creation internal Shipping Option read capability", () => {
  it("plans the genuine native retrieve envelope over checked Shipping Option metadata", () => {
    const input = nativeInput(), plan = Result.getOrThrow(reads.query(input));
    expect(plan.table).toBe("shipping_option");
    expect(plan.withDeleted).toBe(false);
    expect(plan.paths).toEqual([]);
    expect(new Set(plan.projection.storageFields)).toEqual(new Set(fields));
    expect(new Set(plan.projection.node.fields)).toEqual(new Set(fields));
    expect(input).toEqual(nativeInput());
  });

  it.each([
    { name: "array IDs", input: () => buildQuery({ id: ["so146-selected"] }, { select: [...fields] }) },
    { name: "a broader scalar projection", input: () => buildQuery({ id: "so146-selected" }, { select: [...fields, "provider_id"] }) },
    { name: "historical selection", input: () => buildQuery({ id: "so146-selected" }, { select: [...fields], withDeleted: true }) },
    { name: "pagination", input: () => buildQuery({ id: "so146-selected" }, { select: [...fields], take: 1, skip: 0 }) },
    { name: "relation population", input: () => buildQuery({ id: "so146-selected" }, { select: [...fields], relations: ["shipping_profile"] }) },
    { name: "a counted-query flag", input: () => ({ ...nativeInput(), count: true }) },
  ])("refuses $name before a read can execute", ({ input }) => {
    expect(reads.query(input())).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
});
