import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { jsonEqual } from "flarex-protocol/json";
import { fulfillmentCreationResources } from "../src/workflow/policy";
import { prepareLogicalFulfillmentCreation, fulfillmentCreationInput } from "./support/logical-fulfillment-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentCreation>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(previous =>
  previous.scopeUuid === event.scopeUuid && previous.commitSeq === event.commitSeq && previous.eventOrdinal === event.eventOrdinal));
const members = (value: JsonObject, key: string): JsonObject[] => {
  const rows = value[key];
  if (!Array.isArray(rows) || !rows.every(isJsonObject)) throw new Error("Missing genuine Fulfillment " + key);
  return rows;
};
const eventName = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: "fulfillment", objectName, action });

/** The finite runtime reads this actual StepResponse field into its retained
 * record. Observe that read, then pass its original value to the real callback. */
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing finite SDK retained input owner");
  const values: string[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (typeof value === "string" && value.startsWith("ful_")) values.push(value);
    return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (values.length !== 1) throw new Error("Expected one genuine Fulfillment retained ID");
    return values[0]!;
  } };
}

describe("genuine native Fulfillment creation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentCreation(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates the full ten-row graph on the fresh twelve-table source, retains exact quantities and replays once", async () => {
    const option = await connected.seedOption("fulfillment-maximum-option");
    await connected.seedLocation("fulfillment-rich-location");
    const host = await connected.prepare(), key = host.newRequestKey();
    const input = { ...fulfillmentCreationInput("maximum", true), location_id: "fulfillment-rich-location", shipping_option_id: option };
    const create = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment");
    try {
      const before = await connected.snapshot(); let calls = 0;
      const result = await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(connected.modules.fulfillment.logicalStorage.source.schema.tables).toHaveLength(12);
      expect(result).toMatchObject({ id: expect.stringMatching(/^ful_/), location_id: input.location_id, shipping_option_id: option,
        provider: { id: input.provider_id }, data: input.data, metadata: input.metadata, canceled_at: null, requires_shipping: true,
        delivery_address: expect.objectContaining({ first_name: "  First  ", country_code: "us", metadata: input.delivery_address?.metadata }) });
      expect(result).not.toHaveProperty("order"); expect(result).not.toHaveProperty("location");
      expect(members(result, "items").map(row => row.quantity)).toEqual([0.125, 0, -1, 2]);
      expect(members(result, "items").map(row => row.raw_quantity)).toEqual(["0.125", "0", "-1", "2"].map(value => expect.objectContaining({ value })));
      expect(members(result, "labels")).toHaveLength(4);
      const rows = await connected.read(), root = rows.find(row => row.id === result.id);
      expect(root).toMatchObject({ data: input.data, location_id: input.location_id, shipping_option_id: option, canceled_at: null });
      expect(root?.updated_at).toBe(result.updated_at);
      for (const row of [...members(result, "items"), ...members(result, "labels")]) expect(rows.find(stored => stored.id === row.id)).toMatchObject({ fulfillment_id: result.id });
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(after.rows.length - before.rows.length).toBe(10);
      expect(after.rowChanges.length - before.rowChanges.length).toBe(10);
      expect(after.commits.length - before.commits.length).toBe(1);
      expect(emitted.map(event => event.envelope.contract)).toEqual(["fulfillment_address", "fulfillment",
        ...Array.from({ length: 4 }, () => "fulfillment_label"), ...Array.from({ length: 4 }, () => "fulfillment_item")].map(name => eventName(name, "created")));
      expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(fulfillmentCreationResources.calls);
      expect(emitted.length).toBeLessThanOrEqual(fulfillmentCreationResources.eventMessages);
      console.info("Fulfillment creation maximum", { calls, messages: emitted.length });
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(create).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { ...input, metadata: { changed: true } }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { create.mockRestore(); }
  }, 240_000);

  it.each(["omitted", "null"] as const)("preserves original %s data in the creation snapshot while Manual persists an empty object", async mode => {
    const host = await connected.prepare(), input = { ...fulfillmentCreationInput("data-" + mode) };
    if (mode === "omitted") delete input.data; else input.data = null;
    const before = await connected.snapshot(), result = await Effect.runPromise(host.run(host.newRequestKey(), input));
    expect(result.data).toBeNull();
    const rows = await connected.read(), stored = rows.find(row => row.id === result.id);
    expect(stored?.data).toEqual({});
    expect(members(result, "labels").map(row => row.id)).toEqual(rows.filter(row => row.fulfillment_id === result.id && typeof row.tracking_number === "string").map(row => row.id));
    const emitted = eventsSince(before, await connected.snapshot());
    expect(emitted.at(-1)?.envelope.contract).toBe(eventName("fulfillment", "updated"));
    expect(emitted.filter(event => event.envelope.contract === eventName("fulfillment", "updated"))).toHaveLength(1);
  }, 180_000);

  it.each(["ordinary", "constructor-string", "constructor-object", "nested-constructor"] as const)(
    "preserves the native initial/stored JSON distinction for %s through actual creation and cancellation", async kind => {
      const data: JsonObject = kind === "constructor-string" ? { constructor: "own-string147", kept: "constructor147" }
        : kind === "constructor-object" ? { constructor: { marker: "own-object147" }, kept: "constructor147" }
        : kind === "nested-constructor" ? { kept: "nested147", nested: { constructor: "nested-string147", kept: true } }
        : { kept: "ordinary147", nested: { kept: true } };
      // These are the observed genuine creation cohorts, not an implementation
      // of native JSON assignment: top-level constructor keys replace to {}.
      const stored = kind === "constructor-string" || kind === "constructor-object" ? {} : data;
      const tap = retainedTap(), nativeCancel = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment"),
        manualCreate = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment"), manualCancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
      try {
        const beforeRows = await connected.read(), host = await connected.prepareRoundtrip(tap.get);
        const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...fulfillmentCreationInput("creation147-" + kind), data }));
        // Compare JSON values without Vitest interpreting an own constructor
        // object as a JavaScript constructor during deep equality.
        expect(jsonEqual(result.data ?? null, data)).toBe(true); expect(tap.get()).toBe(result.id);
        expect(manualCreate).toHaveBeenCalledTimes(1);
        const providerResult = manualCreate.mock.results[0]; if (providerResult?.type !== "return") throw new Error("Missing actual Manual creation result");
        expect(await providerResult.value).toEqual({ data: {}, labels: [] });
        expect(nativeCancel).toHaveBeenCalledTimes(1); expect(manualCancel).toHaveBeenCalledTimes(1);
        expect(manualCancel.mock.calls[0]).toEqual([stored]);
        const cancellation = nativeCancel.mock.results[0]; if (cancellation?.type !== "return") throw new Error("Missing actual native cancellation DTO");
        // The original cancellation performs a fresh native retrieve; its DTO
        // observes the stored value independently of the initial create DTO.
        expect(await cancellation.value).toMatchObject({ id: result.id, data: stored, canceled_at: expect.any(String) });
        const rows = await connected.read(); expect(rows.find(row => row.id === result.id)).toMatchObject({ data: stored, canceled_at: expect.any(String) });
        for (const prior of beforeRows) expect(rows).toContainEqual(prior);
        for (const child of [...members(result, "items"), ...members(result, "labels")])
          expect(rows.find(row => row.id === child.id)).toMatchObject({ fulfillment_id: result.id, deleted_at: null });
      } finally { tap.restore(); nativeCancel.mockRestore(); manualCreate.mockRestore(); manualCancel.mockRestore(); }
    }, 180_000);

  it("refuses own __proto__ JSON before native creation without publishing a graph", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    const data: unknown = JSON.parse('{"__proto__":{"polluted147":true},"kept":"unsafe147"}');
    const create = vi.spyOn(FulfillmentModuleService.prototype, "createFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host,
        [host.newRequestKey(), { ...fulfillmentCreationInput("creation147-unsafe"), data }]))))).toBe(true);
      expect(create).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      expect(Object.prototype).not.toHaveProperty("polluted147");
    } finally { create.mockRestore(); }
  }, 180_000);

  it.each(["omitted", "null", "empty"] as const)("preserves %s Address and nullable/empty Item collections", async mode => {
    const input = { ...fulfillmentCreationInput("address-" + mode) };
    if (mode === "omitted") delete input.delivery_address;
    else input.delivery_address = mode === "null" ? null : {};
    input.items = mode === "null" ? null : []; delete input.labels;
    const host = await connected.prepare(), before = await connected.snapshot();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), input));
    expect(members(result, "items")).toEqual([]); expect(members(result, "labels")).toEqual([]);
    if (mode === "empty") expect(result.delivery_address).toMatchObject({ id: expect.any(String), first_name: null, country_code: null });
    else { expect(result).not.toHaveProperty("delivery_address"); expect(result).not.toHaveProperty("delivery_address_id"); }
    expect((await connected.snapshot()).rows.length - before.rows.length).toBe(mode === "empty" ? 2 : 1);
  }, 180_000);

  it("executes the actual retained cancellation with all children retained and idempotent native repetition", async () => {
    const tap = retainedTap(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    let sealed = false;
    const host = await connected.prepareRoundtrip(tap.get, { repeat: true, inspectResources: resources => {
      expect(resources).not.toHaveProperty("stockLocation"); expect(resources).not.toHaveProperty("manager");
      expect(resources).not.toHaveProperty("table");
      if (resources === null || typeof resources !== "object" || Array.isArray(resources)) throw new Error("Missing selected workflow resources");
      sealed = Object.isFrozen(resources);
      expect(() => Object.defineProperty(resources, "table", { value: () => null })).toThrow();
    } });
    try {
      const before = await connected.snapshot(); let calls = 0;
      const result = await Effect.runPromise(host.run(host.newRequestKey(), fulfillmentCreationInput("retained", true)).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(tap.get()).toBe(result.id); expect(result.canceled_at).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1); expect(sealed).toBe(true);
      const rows = await connected.read(), stored = rows.find(row => row.id === result.id);
      expect(stored?.canceled_at).toEqual(expect.any(String)); expect(stored?.deleted_at).toBeNull();
      for (const row of [...members(result, "items"), ...members(result, "labels")]) expect(rows.find(stored => stored.id === row.id)).toMatchObject({ deleted_at: null });
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(after.rows.length - before.rows.length).toBe(10);
      expect(emitted.filter(event => event.envelope.contract === eventName("fulfillment", "updated"))).toHaveLength(1);
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(fulfillmentCreationResources.calls);
      console.info("Fulfillment creation retained cancellation", { calls, messages: emitted.length });
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 240_000);

  it("retains the full nullable-data graph and cancellation under the selected allowance", async () => {
    const tap = retainedTap(), host = await connected.prepareRoundtrip(tap.get);
    try {
      const input = { ...fulfillmentCreationInput("nullable-maximum", true), data: null };
      const before = await connected.snapshot(); let calls = 0;
      const result = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(result.data).toBeNull(); expect(result.canceled_at).toBeNull();
      expect(members(result, "items")).toHaveLength(4); expect(members(result, "labels")).toHaveLength(4);
      expect((await connected.read()).find(row => row.id === result.id)).toMatchObject({ data: {}, canceled_at: expect.any(String) });
      const after = await connected.snapshot(), emitted = eventsSince(before, after);
      expect(after.rows.length - before.rows.length).toBe(10); expect(emitted).toHaveLength(12);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentCreationResources.calls);
      console.info("Fulfillment creation nullable maximum and cancellation", { calls, messages: emitted.length });
    } finally { tap.restore(); }
  }, 240_000);

  it("retains a pre-canceled native date without invoking Manual cancellation", async () => {
    const tap = retainedTap(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    const host = await connected.prepareRoundtrip(tap.get), date = "2026-10-01T00:00:00.000Z";
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(host.run(host.newRequestKey(), { ...fulfillmentCreationInput("already-canceled"), canceled_at: date }));
      expect(result.canceled_at).toBe(date); expect(cancel).not.toHaveBeenCalled();
      expect(eventsSince(before, await connected.snapshot()).filter(event => event.envelope.contract === eventName("fulfillment", "updated"))).toEqual([]);
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it.each(["shipped_at", "delivered_at"] as const)("preserves creation with %s and rejects its genuine retained inverse atomically", async field => {
    const input = { ...fulfillmentCreationInput(field), [field]: "2026-10-01T00:00:00.000Z" };
    const forward = await connected.prepare();
    expect((await Effect.runPromise(forward.run(forward.newRequestKey(), input)))[field]).toBe(input[field]);
    const tap = retainedTap(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    const host = await connected.prepareRoundtrip(tap.get);
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(cancel).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it("rolls back the full graph and genuine cancellation after a late parent failure", async () => {
    const tap = retainedTap(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    const host = await connected.prepareRoundtrip(tap.get, { lateFailure: true });
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), fulfillmentCreationInput("late", true)))))).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it("retains native acceptance of an existing historical Shipping Option", async () => {
    const id = await connected.seedOption("fulfillment-historical-option");
    await connected.arrange("fulfillment", "shipping_option", "softDelete", [{ id }]);
    const beforeRows = await connected.read(), host = await connected.prepare();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...fulfillmentCreationInput("historical-option"), shipping_option_id: id }));
    expect(result.shipping_option_id).toBe(id);
    expect((await connected.read()).find(row => row.id === id)).toEqual(beforeRows.find(row => row.id === id));
  }, 180_000);

  it("masks a historical Option in the genuine retained cancellation DTO while preserving its stored FK", async () => {
    const id = await connected.seedOption("fulfillment-historical-option-roundtrip");
    await connected.arrange("fulfillment", "shipping_option", "softDelete", [{ id }]);
    const beforeRows = await connected.read(), tap = retainedTap(), cancel = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepareRoundtrip(tap.get);
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...fulfillmentCreationInput("historical-option-roundtrip"), shipping_option_id: id }));
      expect(result.shipping_option_id).toBe(id); expect(cancel).toHaveBeenCalledTimes(1);
      const invocation = cancel.mock.results[0];
      if (invocation?.type !== "return") throw new Error("Missing actual retained native cancellation result");
      const canceled: unknown = await invocation.value;
      expect(canceled).toMatchObject({ id: result.id, shipping_option_id: null, shipping_option: null, canceled_at: expect.any(String) });
      const rows = await connected.read();
      expect(rows.find(row => row.id === result.id)).toMatchObject({ shipping_option_id: id, canceled_at: expect.any(String) });
      expect(rows.find(row => row.id === id)).toEqual(beforeRows.find(row => row.id === id));
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it.each(["missing", "historical"] as const)("refuses a %s Location before graph creation", async kind => {
    const location = "fulfillment-" + kind + "-location";
    if (kind === "historical") { await connected.seedLocation(location, false); await connected.arrange("stockLocation", "stock_location", "softDelete", [{ id: location }]); }
    const host = await connected.prepare(), create = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment");
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ...fulfillmentCreationInput(kind), location_id: location }))))).toBe(true);
      expect(create).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { create.mockRestore(); }
  }, 180_000);

  it.each(["provider_id", "shipping_option_id"] as const)("refuses missing %s without graph, history, facts or events", async field => {
    const host = await connected.prepare(), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ...fulfillmentCreationInput(field), [field]: "missing-endpoint" }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("rolls back native unregistered-provider cleanup including its independently orphaned Address", async () => {
    const id = "unregistered_141", stamp = "2026-10-18T00:00:00.000Z";
    await connected.arrange("fulfillment", "fulfillment_provider", "insert", [{ id, is_enabled: true, created_at: stamp, updated_at: stamp, deleted_at: null }]);
    const host = await connected.prepare(), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ...fulfillmentCreationInput("unregistered"), provider_id: id }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("refuses invalid quantity, unmanaged fields and aggregate overflow before publishing any staged graph", async () => {
    const host = await connected.prepare(), valid = fulfillmentCreationInput("invalid");
    const first = valid.items?.[0]; if (first === undefined) throw new Error("Missing fixed Item");
    const inputs = [
      { ...valid, items: [{ ...first, quantity: "not-a-number" }] },
      { ...valid, id: "unadmitted-id" }, { ...valid, created_at: "2026-01-01T00:00:00.000Z" },
      { ...valid, items: Array.from({ length: 5 }, () => first) },
      { ...valid, labels: Array.from({ length: 5 }, () => ({ tracking_number: "x", tracking_url: "x", label_url: "x" })) },
    ];
    for (const input of inputs) {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
    }
  }, 180_000);

  it.each(["omitted", "null"] as const)("preserves an %s optional Shipping Option and native nonshipping business fields", async mode => {
    const host = await connected.prepare(), input = { ...fulfillmentCreationInput("optional-option-" + mode) };
    if (mode === "null") input.shipping_option_id = null;
    input.requires_shipping = false; input.packed_at = "2026-10-01T00:00:00.000Z";
    input.created_by = " creator "; input.marked_shipped_by = " marker ";
    const result = await Effect.runPromise(host.run(host.newRequestKey(), input));
    if (mode === "null") expect(result.shipping_option_id).toBeNull(); else expect(result).not.toHaveProperty("shipping_option_id");
    expect(result).toMatchObject({ requires_shipping: false,
      packed_at: input.packed_at, created_by: input.created_by, marked_shipped_by: input.marked_shipped_by });
  }, 180_000);

  it.each([{ calls: 2 }, { eventMessages: 1 }])("refuses a smaller root allowance without partial publication: %j", async limit => {
    const host = await connected.prepareRoundtrip(() => { throw new Error("Overflow must precede retained inverse"); }, limit);
    const before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), fulfillmentCreationInput("budget", true)))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);
});
