import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { commerceDecoder } from "../src/value/decoder";
import { captureFulfillmentCreationMetadata } from "../src/modules/fulfillment/shipping-profile-schema";
import { compileFulfillmentCreationContracts } from "../src/modules/fulfillment/fulfillment-create-input";
import { FulfillmentUpdateInput, decodeFulfillmentShipmentUpdate, fulfillmentUpdateMutableFields,
  compileFulfillmentShipmentContracts } from "../src/modules/fulfillment/fulfillment-shipment-input";
import { assignFulfillmentJson } from "../src/modules/fulfillment/fulfillment-create-value-profile";
import { prepareFulfillmentShipmentQuery } from "../src/modules/fulfillment/fulfillment-shipment-query";

const outer = commerceDecoder(FulfillmentUpdateInput, "invalidInput");
let reads: Result.Result.Success<ReturnType<typeof prepareFulfillmentShipmentQuery>>;
let values: Result.Result.Success<ReturnType<typeof compileFulfillmentShipmentContracts>>;
beforeAll(async () => {
  const prepared = await Effect.runPromise(Effect.gen(function* () {
    const metadata = yield* captureFulfillmentCreationMetadata(), contracts = yield* Effect.fromResult(compileFulfillmentCreationContracts(metadata.frame));
    return { reads: yield* Effect.fromResult(prepareFulfillmentShipmentQuery(contracts)), values: yield* Effect.fromResult(compileFulfillmentShipmentContracts(contracts)) };
  }));
  reads = prepared.reads; values = prepared.values;
});

describe("native Fulfillment update contract and preimages", () => {
  it("admits the complete declared mutable workflow contract and separately bounded Labels", () => {
    for (const input of [{ id: "ful147" }, { id: "ful147", location_id: "", packed_at: null, shipped_at: "2026-10-19T00:00:00.000Z",
      marked_shipped_by: null, created_by: "actor147", delivered_at: null, data: { nested: [null, { kept: true }] }, metadata: null },
    { id: "ful147", labels: [{ id: "label147" }, { tracking_number: "n", tracking_url: "u", label_url: "l" }] }])
      expect(outer(input)._tag).toBe("Success");
  });

  it("refuses outer managed fields, references, unrelated root state and unbounded Labels", () => {
    for (const extra of [{ provider_id: "provider147" }, { shipping_option: { id: "option147" } }, { delivery_address_id: "address147" },
      { created_at: "2026-10-19T00:00:00.000Z" }, { packed_at: "invalid" }, { canceled_at: null }, { requires_shipping: true }, { items: [] }, { labels: null },
      { labels: [{ id: "label147", fulfillment_id: "ful147" }] }, { labels: Array.from({ length: 5 }, () => ({ id: "label147" })) }])
      expect(outer({ id: "ful147", ...extra })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("normalizes only native business Dates and omits undefined before the checked DAL contract", () => {
    expect(Result.getOrThrow(decodeFulfillmentShipmentUpdate({ packed_at: new Date("2026-10-19T00:00:00.000Z"), metadata: undefined })))
      .toEqual({ packed_at: "2026-10-19T00:00:00.000Z" });
    expect(decodeFulfillmentShipmentUpdate({ updated_at: new Date() })).toMatchObject({ _tag: "Failure" });
  });

  it("keeps own constructor JSON while refusing unsupported native assignment keys before the merge", () => {
    expect(outer({ id: "ful147", data: { constructor: "native147", nested: [null] } })._tag).toBe("Success");
    const unsupported = Schema.decodeUnknownSync(Schema.JsonObject)(JSON.parse('{"nested":{"__proto__":{"native147":true}}}'));
    expect(outer({ id: "ful147", data: unsupported })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(assignFulfillmentJson(unsupported, {})).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("authenticates the original reference-only inverse without admitting association changes", () => {
    const before = { provider: { id: "p147" }, provider_id: "p147", shipping_option: null, shipping_option_id: null,
      delivery_address: { id: "a147" }, delivery_address_id: "a147" };
    expect(Result.getOrThrow(fulfillmentUpdateMutableFields(before, before))).toEqual({});
    for (const update of [{ provider: { id: "other147" } }, { provider_id: "other147" }])
      expect(fulfillmentUpdateMutableFields(before, update)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(decodeFulfillmentShipmentUpdate({ ...before, data: {} })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("plans complete Labels only through the opted-in native wildcard", () => {
    const plan = Result.getOrThrow(reads.query(buildQuery({ id: "ful147" }, { select: ["labels.*"], relations: ["labels"] })));
    const labels = plan.selectedProjection.node.children.find(child => child.name === "labels");
    expect(new Set(labels?.node.fields)).toEqual(new Set(["id", "tracking_number", "tracking_url", "label_url", "fulfillment_id", "created_at", "updated_at", "deleted_at"]));
    for (const config of [{ select: ["items.*"], relations: ["items"] }, { select: ["*"], relations: [] }, { select: ["provider.*"], relations: ["provider"] }])
      expect(reads.query(buildQuery({ id: "ful147" }, config))).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("preserves the native empty selection reference preimage and whole JSON scalars", () => {
    const empty = Result.getOrThrow(reads.query(buildQuery({ id: "ful147" }, { select: [], relations: [] })));
    expect(new Set(empty.selectedProjection.node.fields)).toEqual(new Set(["id", "provider", "provider_id", "shipping_option", "shipping_option_id", "delivery_address", "delivery_address_id"]));
    const json = Result.getOrThrow(reads.query(buildQuery({ id: "ful147" }, { select: ["data", "metadata"], relations: [] })));
    expect(json.paths).toEqual([]);
    expect(new Set(json.selectedProjection.node.fields)).toEqual(new Set(["id", "data", "metadata"]));
  });

  it("serializes selected location scalar preimages without requiring a full root DTO", async () => {
    const selected = { id: "ful147", location_id: "location147" };
    expect(await Effect.runPromise(values.serialize(selected))).toEqual(selected);
  });
});
