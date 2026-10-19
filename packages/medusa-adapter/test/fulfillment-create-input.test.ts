import { describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata, compileFulfillmentCreationDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { captureFulfillmentBusinessDates, compileFulfillmentCreationContracts, decodeFulfillmentCreate, decodeFulfillmentNativeUpdate } from "../src/modules/fulfillment/fulfillment-create-input";
import { captureFulfillmentItemQuantity, selectedManualDataAssignment } from "../src/modules/fulfillment/fulfillment-create-value-profile";

const input = { location_id: "location", provider_id: "manual_manual", items: [], delivery_address: {} };
describe("selected native Fulfillment creation values", () => {
  it("retains native ORM quantity precision without padding the raw companion", async () => {
    for (const [quantity, value] of [["0.125", "0.125"], [0, "0"], [-1, "-1"], [2, "2"]] as const) {
      const input = { quantity, title: "Retained" };
      expect(await Effect.runPromise(captureFulfillmentItemQuantity(input))).toMatchObject({
        title: "Retained", raw_quantity: { value, precision: 20 },
      });
      expect(input).toEqual({ quantity, title: "Retained" });
    }
    expect(await Effect.runPromise(Effect.result(captureFulfillmentItemQuantity({ quantity: "not-a-number" }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(await Effect.runPromise(Effect.result(captureFulfillmentItemQuantity({ quantity: 1, raw_quantity: { value: "1", precision: 20 } }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });

  it("retains the separate eight-table consumer and adds a fresh complete native definition", async () => {
    const old = await Effect.runPromise(captureServiceZoneCreationMetadata()), full = await Effect.runPromise(captureFulfillmentCreationMetadata());
    expect(old.frame.tables).toHaveLength(8); expect(full.frame.tables).toHaveLength(12);
    const definition = await Effect.runPromise(compileFulfillmentCreationDefinition());
    expect(definition.provenance.paths).toContain("packages/modules/fulfillment/src/models/address.ts");
    expect(definition.provenance.paths).not.toContain("packages/modules/fulfillment/src/models/fulfillment-address.ts");
  });

  it("preserves native nullable relations, dates, signed and fractional quantities", () => {
    for (const quantity of [-1, 0, 0.125, "-0.000000000000000001"]) {
      const row = { ...input, delivery_address: null, shipping_option_id: null, canceled_at: null,
        items: [{ title: " Raw ", sku: "", barcode: "", quantity }], data: { nested: [null, false] } };
      expect(Result.getOrThrow(decodeFulfillmentCreate(row))).toEqual(row);
    }
    expect(Result.getOrThrow(decodeFulfillmentCreate({ ...input, items: null }))).toEqual({ ...input, items: null });
    expect(Result.getOrThrow(decodeFulfillmentCreate({ location_id: "location", provider_id: "manual_manual", items: [] })))
      .toEqual({ location_id: "location", provider_id: "manual_manual", items: [] });
  });

  it("refuses caller-managed identities, raw companions and unadmitted graph expansion", () => {
    for (const row of [{ ...input, id: "outside" }, { ...input, created_at: "2026-10-18T00:00:00.000Z" },
      { ...input, delivery_address: { id: "outside" } }, { ...input, items: [{ title: "x", sku: "s", barcode: "b", quantity: 1, raw_quantity: { value: "1", precision: 20 } }] },
      { ...input, labels: Array(5).fill({ tracking_number: "n", tracking_url: "u", label_url: "l" }) },
      { ...input, items: Array(5).fill({ title: "x", sku: "s", barcode: "b", quantity: 1 }) }])
      expect(Result.isFailure(decodeFulfillmentCreate(row))).toBe(true);
  });

  it("admits only the witnessed empty Manual assignment or native cancellation update", () => {
    expect(Result.getOrThrow(decodeFulfillmentNativeUpdate({ id: "f", data: {}, labels: [] }))).toEqual({ id: "f", data: {}, labels: [] });
    expect(Result.getOrThrow(decodeFulfillmentNativeUpdate({ id: "f", canceled_at: "2026-10-18T00:00:00.000Z" })))
      .toEqual({ id: "f", canceled_at: "2026-10-18T00:00:00.000Z" });
    for (const row of [{ id: "f", data: { replacement: true }, labels: [] }, { id: "f", labels: [] },
      { id: "f", data: {}, labels: [{ tracking_number: "unexpected" }] }, { id: "f", canceled_at: null }])
      expect(Result.isFailure(decodeFulfillmentNativeUpdate(row))).toBe(true);
    const data = { nested: [null, true] };
    expect(selectedManualDataAssignment({ data })).toBe(data);
    expect(selectedManualDataAssignment({ data: null })).toEqual({});
  });

  it("normalizes only declared native business Dates without evaluating getters", () => {
    const date = new Date("2026-10-18T00:00:00.000Z");
    expect(Result.getOrThrow(captureFulfillmentBusinessDates({ canceled_at: date }))).toEqual({ canceled_at: date.toISOString() });
    expect(Result.isFailure(captureFulfillmentBusinessDates({ created_at: date }))).toBe(true);
    expect(Result.isFailure(captureFulfillmentBusinessDates({ canceled_at: new Date(Number.NaN) }))).toBe(true);
    let invoked = false;
    const getter = Object.defineProperty({}, "canceled_at", { enumerable: true, get: () => { invoked = true; return date; } });
    expect(Result.isFailure(captureFulfillmentBusinessDates(getter))).toBe(true); expect(invoked).toBe(false);
  });
});

describe("native Fulfillment to-one representation", () => {
  const contracts = async () => Result.getOrThrow(compileFulfillmentCreationContracts((await Effect.runPromise(captureFulfillmentCreationMetadata())).frame));
  const stamp = "2026-10-18T00:00:00.000Z";
  it("retains hasOneWithFK IDs across hidden targets while filtering the belongsTo Option", async () => {
    const prepared = await contracts(), row = { ...prepared.defaults.get("fulfillment"), id: "f", location_id: "location",
      provider_id: "manual_manual", delivery_address_id: "address", shipping_option_id: "option",
      created_at: stamp, updated_at: stamp, deleted_at: null };
    expect(prepared.referenceFields.map(field => [field.name, field.nativeKind])).toEqual([
      ["provider", "hasOneWithFK"], ["shipping_option", "belongsTo"], ["delivery_address", "hasOneWithFK"],
    ]);
    const value = prepared.initializeRead(row, { provider: null, shipping_option: null, delivery_address: null });
    expect(await Effect.runPromise(prepared.serialize(value))).toMatchObject({ provider_id: "manual_manual", provider: { id: "manual_manual" },
      delivery_address_id: "address", delivery_address: { id: "address" }, shipping_option_id: null, shipping_option: null });
    expect(row).toMatchObject({ provider_id: "manual_manual", delivery_address_id: "address", shipping_option_id: "option" });
  });

  it("distinguishes retrieved null owning-key omissions from assigned raw-null results without weakening DTO checks", async () => {
    const prepared = await contracts(), row = { ...prepared.defaults.get("fulfillment"), id: "f", location_id: "location",
      provider_id: null, delivery_address_id: null, shipping_option_id: null, created_at: stamp, updated_at: stamp, deleted_at: null },
      populated = { provider: null, delivery_address: null, shipping_option: null },
      retrieved = prepared.initializeRead(row, populated), assigned = prepared.initializeRead(row, populated, "assigned");
    expect(retrieved).not.toHaveProperty("provider_id"); expect(retrieved).not.toHaveProperty("delivery_address_id");
    expect(retrieved).toMatchObject({ provider: null, delivery_address: null, shipping_option_id: null, shipping_option: null });
    expect(assigned).toMatchObject({ provider_id: null, delivery_address_id: null, provider: null, delivery_address: null });
    expect(Result.getOrThrow(prepared.decodeOutput(retrieved))).toEqual(retrieved);
    expect(Result.getOrThrow(prepared.decodeOutput(assigned))).toEqual(assigned);
    const { provider: _provider, ...missingProviderRelation } = retrieved;
    for (const forged of [missingProviderRelation, { ...retrieved, provider: { id: "manual_manual" } },
      { ...retrieved, provider_id: "manual_manual" }, { ...retrieved, delivery_address: { id: "address" } },
      { ...assigned, delivery_address_id: "address" }, { ...assigned, injected: true }])
      expect(Result.isFailure(prepared.decodeOutput(forged))).toBe(true);
    expect(row).toHaveProperty("provider_id", null); expect(row).toHaveProperty("delivery_address_id", null);
  });

  it("refuses changing native relationship kinds inside the selected complete definition", async () => {
    const metadata = (await Effect.runPromise(captureFulfillmentCreationMetadata())).frame;
    for (const [name, type] of [["provider", "belongsTo"], ["shipping_option", "hasOneWithFK"]] as const)
      expect(Result.isFailure(compileFulfillmentCreationContracts({ ...metadata, tables: metadata.tables.map(table => table.name !== "fulfillment" ? table
        : { ...table, relationships: table.relationships.map(relation => relation.name === name ? { ...relation, type } : relation) }) }))).toBe(true);
  });
});
