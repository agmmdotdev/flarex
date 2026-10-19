import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isNonArrayRecord } from "@flarex/utils/records";
import { fulfillmentShipmentResources } from "../src/workflow/policy";
import { prepareLogicalFulfillmentShipment } from "./support/logical-fulfillment-shipment-fixture";
import { shippingOptionParents } from "./support/logical-shipping-option-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentShipment>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const idOf = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const stamp = "2026-10-01T00:00:00.000Z";
const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: "fulfillment", objectName, action });
const updated = event("fulfillment", "updated"), labelCreated = event("fulfillment_label", "created"), labelDeleted = event("fulfillment_label", "deleted");
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(value => !before.events.some(prior =>
  prior.scopeUuid === value.scopeUuid && prior.commitSeq === value.commitSeq && prior.eventOrdinal === value.eventOrdinal));
const labels = (prefix: string, count = 4) => Array.from({ length: count }, (_, index) => ({ tracking_number: prefix + "-tracking-" + index,
  tracking_url: "https://example.test/shipment/" + prefix + "/" + index, label_url: "https://example.test/label/" + prefix + "/" + index }));
const children = (rows: readonly JsonObject[], id: string, kind: "item" | "label") => rows.filter(row => row.fulfillment_id === id &&
  (kind === "item" ? typeof row.title === "string" : typeof row.tracking_number === "string"));
const members = (value: JsonObject, key: string) => {
  const rows = value[key]; if (!Array.isArray(rows) || !rows.every(isJsonObject)) throw new Error("Missing native shipment " + key); return rows;
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine finite SDK retained getter");
  const schema = Schema.Struct({ id: Schema.String, labels: Schema.Array(Schema.JsonObject) }), values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (Schema.is(schema)(value)) values.push(value); return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (values.length !== 1) throw new Error("Expected one actual native Fulfillment update retained preimage");
    return values[0];
  } };
}

describe("genuine native Fulfillment shipment", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentShipment(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("replaces four Labels, protects Items and unrelated graphs, validates the full result and replays once", async () => {
    const created = await connected.seed("shipment144-maximum", { maximum: true }), id = idOf(created);
    const protectedRoot = await connected.seed("shipment144-protected", { maximum: true });
    const beforeRows = await connected.read(), oldLabels = children(beforeRows, id, "label"), before = await connected.snapshot();
    const host = await connected.prepare(), request = host.newRequestKey(), input = { id, labels: labels("maximum"), marked_shipped_by: "operator144" };
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), manual = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment");
    try {
      let calls = 0;
      const result = await Effect.runPromise(host.run(request, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(result).toMatchObject({ id, shipped_at: expect.any(String), marked_shipped_by: "operator144", shipping_option_id: connected.option,
        data: created.data, metadata: created.metadata, provider: { id: shippingOptionParents.provider }, canceled_at: null });
      expect(members(result, "labels")).toHaveLength(4); expect(members(result, "items")).toEqual(members(created, "items"));
      expect(members(result, "labels")).toEqual(input.labels.map(label => expect.objectContaining(label)));
      const native = update.mock.results[0]; if (native?.type !== "return") throw new Error("Missing actual native shipment DTO");
      expect(await native.value).toEqual(result); expect(manual).not.toHaveBeenCalled();
      const afterRows = await connected.read(), after = await connected.snapshot();
      expect(children(afterRows, id, "item")).toEqual(children(beforeRows, id, "item"));
      expect(afterRows.filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
      expect(afterRows.find(row => row.id === protectedRoot.id)).toEqual(beforeRows.find(row => row.id === protectedRoot.id));
      expect(oldLabels.every(label => !afterRows.some(row => row.id === label.id))).toBe(true);
      expect(children(afterRows, id, "label").map(row => row.id).sort()).toEqual(members(result, "labels").map(row => row.id).sort());
      const emitted = eventsSince(before, after);
      expect(emitted.map(value => value.envelope.contract)).toEqual([...Array.from({ length: 4 }, () => labelCreated), updated,
        ...Array.from({ length: 4 }, () => labelDeleted)]);
      expect(emitted.every(value => value.envelope.internal)).toBe(true); expect(new Set(emitted.map(value => value.commitSeq)).size).toBe(1);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentShipmentResources.calls);
      console.info("Fulfillment shipment maximum", { calls, messages: emitted.length });
      expect(await Effect.runPromise(host.run(request, input))).toEqual(result); expect(update).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(request, { ...input, marked_shipped_by: "other" }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { update.mockRestore(); manual.mockRestore(); }
  }, 240_000);

  it("updates the native minimum graph with a new Label and null Address", async () => {
    const created = await connected.seed("shipment144-minimum", { input: { delivery_address: null, items: [], labels: [] } }), id = idOf(created);
    const host = await connected.prepare(), result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: labels("minimum", 1) }));
    expect(result).toMatchObject({ id, delivery_address: null, delivery_address_id: null, items: [], shipped_at: expect.any(String) });
    expect(members(result, "labels")).toEqual([expect.objectContaining(labels("minimum", 1)[0])]);
  }, 180_000);

  it.each([0, 4])("executes the authentic retained inverse with %s new Labels and preserves its native timestamp branch", async count => {
    const created = await connected.seed("shipment144-inverse-" + count, { maximum: true }), id = idOf(created);
    await connected.arrangeShipment("fulfillment", "update", [{ id, marked_shipped_by: "previous144" }]);
    const beforeRows = await connected.read(), oldLabels = children(beforeRows, id, "label"), before = await connected.snapshot(), tap = retainedTap();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      let calls = 0;
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: labels("inverse-" + count, count), marked_shipped_by: "next144" })
        .pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
        })));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentShipmentResources.calls);
      console.info("Fulfillment shipment retained inverse", { newLabels: count, calls });
      expect(result).toMatchObject({ id, shipped_at: expect.any(String), marked_shipped_by: "next144" });
      expect(update).toHaveBeenCalledTimes(2);
      expect(tap.get()).toMatchObject({ id, shipped_at: null, marked_shipped_by: "previous144" });
      const retained = Schema.decodeUnknownSync(Schema.Struct({ labels: Schema.Array(Schema.Struct({ id: Schema.String })) }))(tap.get());
      expect(retained.labels.map(label => label.id)).toEqual(members(created, "labels").map(label => label.id));
      const afterRows = await connected.read(), restored = children(afterRows, id, "label");
      expect(afterRows.find(row => row.id === id)).toMatchObject({ shipped_at: null, marked_shipped_by: "previous144" });
      expect(restored.map(row => row.id).sort()).toEqual(oldLabels.map(row => row.id).sort());
      for (const previous of oldLabels) {
        const actual = restored.find(row => row.id === previous.id);
        if (actual === undefined) throw new Error("Missing native recreated Label ID");
        const { created_at: oldCreated, updated_at: oldUpdated, ...business } = previous;
        const { created_at: newCreated, updated_at: newUpdated, ...restoredBusiness } = actual;
        expect(restoredBusiness).toEqual(business);
        if (count === 0) {
          expect(newCreated).toBe(oldCreated); expect(newUpdated).toBe(oldUpdated);
        } else {
          expect(newCreated).not.toBe(oldCreated); expect(newUpdated).not.toBe(oldUpdated);
        }
      }
      expect(children(afterRows, id, "item")).toEqual(children(beforeRows, id, "item"));
      expect(afterRows.filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
      const emitted = eventsSince(before, await connected.snapshot()).map(value => value.envelope.contract);
      expect(emitted).toEqual([...Array.from({ length: count }, () => labelCreated), updated,
        ...Array.from({ length: 4 }, () => labelDeleted), ...Array.from({ length: 4 }, () => labelCreated), updated,
        ...Array.from({ length: count }, () => labelDeleted)]);
    } finally { tap.restore(); update.mockRestore(); }
  }, 240_000);

  it("refuses authentic full retained Label reconstitution in a later root without its original deletion proof", async () => {
    const created = await connected.seed("shipment144-inverse-next-root", { maximum: true }), id = idOf(created), tap = retainedTap();
    try {
      const forward = await connected.prepare();
      await Effect.runPromise(forward.run(forward.newRequestKey(), { id, labels: [] }));
      expect(children(await connected.read(), id, "label")).toEqual([]);
      const actual = tap.get(), inverse = await connected.prepareInverseOnly(() => actual), before = await connected.snapshot();
      const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
      try {
        expect(Result.isFailure(await Effect.runPromise(Effect.result(inverse.run(inverse.newRequestKey(), null))))).toBe(true);
        expect(update).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
      } finally { update.mockRestore(); }
    } finally { tap.restore(); }
  }, 240_000);

  it.each(["owner", "business", "created_at", "updated_at", "deleted_at", "unknownId"] as const)(
    "refuses an altered %s in the actual full retained Label preimage and rolls back the complete root", async alteration => {
      const created = await connected.seed("shipment144-forged-" + alteration, { maximum: true }), id = idOf(created);
      const other = await connected.seed("shipment144-forged-owner-" + alteration), otherId = idOf(other), before = await connected.snapshot(), tap = retainedTap();
      const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
      try {
        const host = await connected.prepareWrapped({ retained: () => {
          const actual = Schema.decodeUnknownSync(Schema.JsonObject)(tap.get()), retainedLabels = members(actual, "labels");
          if (retainedLabels.length === 0) throw new Error("Missing actual complete retained Label cohort");
          const patch: JsonObject = alteration === "owner" ? { fulfillment_id: otherId }
            : alteration === "business" ? { tracking_number: "forged144" }
            : alteration === "unknownId" ? { id: "fulla144-never-stored" }
            : { [alteration]: "2000-01-02T03:04:05.000Z" };
          // Hostile input alters one genuine captured child; the actual native
          // callback and core reconstitution owner validate the retained data.
          return { ...actual, labels: retainedLabels.map((label, index) => index === 0 ? { ...label, ...patch } : label) };
        } });
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [] }))))).toBe(true);
        expect(update).toHaveBeenCalledTimes(2); expect(await connected.snapshot()).toEqual(before);
      } finally { update.mockRestore(); tap.restore(); }
    }, 240_000);

  it("preserves historical Label bytes while replacing the active cohort and its retained inverse", async () => {
    const created = await connected.seed("shipment144-history", { maximum: true }), id = idOf(created);
    const historical = children(await connected.read(), id, "label")[0];
    if (historical === undefined) throw new Error("Missing actual Label history arrangement");
    const historicalId = idOf(historical);
    await connected.arrangeShipment("fulfillment_label", "softDelete", [{ id: historicalId }]);
    const beforeRows = await connected.read(), protectedHistory = beforeRows.find(row => row.id === historicalId), tap = retainedTap();
    try {
      const host = await connected.prepareWrapped({ retained: tap.get });
      await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: labels("historical") }));
      const afterRows = await connected.read(); expect(afterRows.find(row => row.id === historicalId)).toEqual(protectedHistory);
      expect(children(afterRows, id, "label").map(row => row.id).sort()).toEqual(children(beforeRows, id, "label").map(row => row.id).sort());
      const retained = Schema.decodeUnknownSync(Schema.Struct({ labels: Schema.Array(Schema.Struct({ id: Schema.String })) }))(tap.get());
      expect(retained.labels.map(row => row.id)).not.toContain(historicalId);
    } finally { tap.restore(); }
  }, 240_000);

  it.each([
    { name: "shipped", shipped: true, canceled: false, option: true, message: "Shipment has already been created" },
    { name: "canceled", shipped: false, canceled: true, option: true, message: "Cannot create shipment for a canceled fulfillment" },
    { name: "shipped canceled", shipped: true, canceled: true, option: true, message: "Shipment has already been created" },
    { name: "no Option", shipped: false, canceled: false, option: false, message: "Cannot create shipment without a Shipping Option" },
    { name: "shipped no Option", shipped: true, canceled: false, option: false, message: "Shipment has already been created" },
    { name: "canceled no Option", shipped: false, canceled: true, option: false, message: "Cannot create shipment for a canceled fulfillment" },
    { name: "shipped canceled no Option", shipped: true, canceled: true, option: false, message: "Shipment has already been created" },
  ])("preserves native guard precedence for $name", async configuration => {
    const created = await connected.seed("shipment144-guard-" + configuration.name, { input: {
      shipped_at: configuration.shipped ? stamp : null, canceled_at: configuration.canceled ? stamp : null,
      shipping_option_id: configuration.option ? connected.option : null,
    } }), id = idOf(created);
    const host = await connected.prepare(), before = await connected.snapshot(), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment"),
      update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment");
    try {
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [] })))).toMatchObject({
        _tag: "Failure", failure: { reason: "adapterFailure", cause: { type: "not_allowed", message: configuration.message } },
      });
      expect(retrieve).toHaveBeenCalledTimes(1); expect(retrieve.mock.calls[0]?.[1]).toMatchObject({ select: ["shipped_at", "canceled_at", "shipping_option_id"] });
      expect(update).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
      // The workflow owns the guard. The genuine retrieval result provides its
      // original selected dates/Option rather than a fabricated module error.
      const read = retrieve.mock.results[0]; if (read?.type !== "return") throw new Error("Missing genuine guard retrieval");
      expect(await read.value).toMatchObject({ shipped_at: configuration.shipped ? stamp : null,
        canceled_at: configuration.canceled ? stamp : null, shipping_option_id: configuration.option ? connected.option : null });
    } finally { retrieve.mockRestore(); update.mockRestore(); }
  }, 180_000);

  it.each(["delivered_at", "packed_at"] as const)("allows the native %s branch without extra validation", async date => {
    const created = await connected.seed("shipment144-allowed-" + date, { input: { [date]: stamp } }), id = idOf(created);
    const host = await connected.prepare(), result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [] }));
    expect(result).toMatchObject({ id, [date]: stamp, shipped_at: expect.any(String) });
  }, 180_000);

  it.each(["missing", "historical"] as const)("retains native %s root refusal without publication", async kind => {
    const id = kind === "missing" ? "ful144-missing" : idOf(await connected.seed("shipment144-historical-root"));
    if (kind === "historical") await connected.arrangeShipment("fulfillment", "softDelete", [{ id }]);
    const host = await connected.prepare(), before = await connected.snapshot(), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [] }))))).toBe(true);
      const result = retrieve.mock.results[0]; if (result?.type !== "return") throw new Error("Missing native absence result");
      await expect(result.value).rejects.toMatchObject({ type: "not_found", message: `Fulfillment with id: ${id} was not found` });
      noMutation(before, await connected.snapshot());
    } finally { retrieve.mockRestore(); }
  }, 180_000);

  it.each(["historical", "detached"] as const)("uses native %s Option visibility in the validator projection", async kind => {
    const option = await connected.seedBareOption("shipment144-option-" + kind, shippingOptionParents.zone);
    const created = await connected.seed("shipment144-option-" + kind, { input: { shipping_option_id: option } }), id = idOf(created);
    if (kind === "historical") await connected.arrangeShipment("shipping_option", "softDelete", [{ id: option }]);
    else await connected.deleteOption(option);
    const host = await connected.prepare(), beforeRows = await connected.read(), before = await connected.snapshot();
    const retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: [] }))))).toBe(true);
      const result = retrieve.mock.results[0]; if (result?.type !== "return") throw new Error("Missing authentic Option projection");
      expect(await result.value).toMatchObject({ shipping_option_id: null });
      expect((await connected.read()).find(row => row.id === id)).toEqual(beforeRows.find(row => row.id === id)); noMutation(before, await connected.snapshot());
    } finally { retrieve.mockRestore(); }
  }, 180_000);

  it.each(["historical", "unregistered", "null"] as const)("retains native Provider independence for %s Provider", async kind => {
    const created = await connected.seed("shipment144-provider-" + kind), id = idOf(created), provider = "shipment144-unregistered";
    if (kind === "historical") await connected.arrangeShipment("fulfillment_provider", "softDelete", [{ id: shippingOptionParents.provider }]);
    else if (kind === "unregistered") {
      await connected.arrangeShipment("fulfillment_provider", "insert", [{ id: provider, is_enabled: true }]);
      await connected.arrangeShipment("fulfillment", "update", [{ id, provider_id: provider }]);
    } else await connected.arrangeShipment("fulfillment", "update", [{ id, provider_id: null }]);
    const manual = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment"), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const beforeRows = await connected.read(), host = await connected.prepare();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [] }));
      expect(result).toMatchObject({ id, shipped_at: expect.any(String), provider: kind === "null" ? null : { id: kind === "unregistered" ? provider : shippingOptionParents.provider } });
      expect(manual).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
      expect((await connected.read()).filter(row => row.id !== id && row.fulfillment_id !== id)).toEqual(beforeRows.filter(row => row.id !== id && row.fulfillment_id !== id));
    } finally {
      manual.mockRestore(); cancel.mockRestore();
      if (kind === "historical") await connected.arrangeShipment("fulfillment_provider", "restore", [{ id: shippingOptionParents.provider }]);
    }
  }, 180_000);

  it("preserves historical Address references and bytes", async () => {
    const created = await connected.seed("shipment144-address"), id = idOf(created), address = created.delivery_address_id;
    if (typeof address !== "string") throw new Error("Missing native delivery Address reference");
    await connected.arrangeShipment("fulfillment_address", "softDelete", [{ id: address }]);
    const beforeRows = await connected.read(), host = await connected.prepare();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [] }));
    expect(result).toMatchObject({ delivery_address_id: address, delivery_address: { id: address } });
    expect((await connected.read()).find(row => row.id === address)).toEqual(beforeRows.find(row => row.id === address));
  }, 180_000);

  it.each(["omitted", "null", "replacement"] as const)("preserves native %s shipped marker semantics", async mode => {
    const created = await connected.seed("shipment144-marker-" + mode), id = idOf(created);
    await connected.arrangeShipment("fulfillment", "update", [{ id, marked_shipped_by: "previous144" }]);
    const host = await connected.prepare(), result = await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [],
      ...(mode === "omitted" ? {} : { marked_shipped_by: mode === "null" ? null : "replacement144" }) }));
    expect(result).toMatchObject({ marked_shipped_by: mode === "omitted" ? "previous144" : mode === "null" ? null : "replacement144" });
  }, 180_000);

  it.each([false, true])("rolls back the private whole root after late failure with explicit native inverse=%s", async inverse => {
    const created = await connected.seed("shipment144-late-" + inverse, { maximum: true }), id = idOf(created), before = await connected.snapshot();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), tap = inverse ? retainedTap() : undefined;
    try {
      // The finite private SDK owns atomic rollback. Unlike the unchanged native
      // scheduler witness, it does not run transaction-covered inverses itself.
      const host = await connected.prepareWrapped({ lateFailure: true, ...(tap === undefined ? {} : { retained: tap.get }) });
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: labels("late") }))))).toBe(true);
      expect(update).toHaveBeenCalledTimes(inverse ? 2 : 1); expect(await connected.snapshot()).toEqual(before);
    } finally { tap?.restore(); update.mockRestore(); }
  }, 240_000);

  it("exposes only frozen selected methods and revokes the borrowed retrieve handle", async () => {
    const created = await connected.seed("shipment144-lifetime"), id = idOf(created); let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: retrieve => { escaped = retrieve; }, inspectResources: resources => {
      if (!isNonArrayRecord(resources)) throw new Error("Missing actual shipment resource object");
      expect(Object.isFrozen(resources)).toBe(true); expect(Object.keys(resources).sort()).toEqual(["event_bus", "fulfillment"]);
      const fulfillment = resources.fulfillment;
      if (fulfillment === null || typeof fulfillment !== "object" || Array.isArray(fulfillment)) throw new Error("Missing actual Fulfillment methods");
      expect(Object.isFrozen(fulfillment)).toBe(true); expect(Object.keys(fulfillment)).toEqual(["retrieveFulfillment", "updateFulfillment"]);
      const eventBus = resources.event_bus;
      if (!isNonArrayRecord(eventBus)) throw new Error("Missing authenticated module event bus");
      expect(Object.isFrozen(eventBus)).toBe(true);
      expect(Object.keys(eventBus)).toEqual(["emit", "clearGroupedEvents", "releaseGroupedEvents"]);
      for (const method of ["emit", "clearGroupedEvents", "releaseGroupedEvents"]) expect(typeof eventBus[method]).toBe("function");
    } });
    await Effect.runPromise(host.run(host.newRequestKey(), { id, labels: [] }));
    if (escaped === undefined) throw new Error("Missing actual borrowed retrieval handle");
    const after = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); expect(await connected.snapshot()).toEqual(after);
  }, 180_000);

  it("refuses a smaller root budget without partial shipment or Label publication", async () => {
    const created = await connected.seed("shipment144-budget", { maximum: true }), id = idOf(created), before = await connected.snapshot();
    const host = await connected.prepareWrapped({ calls: 2 });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id, labels: labels("budget") }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("refuses managed fields, partial or identified Labels and omitted/null collections before native execution", async () => {
    const created = await connected.seed("shipment144-input"), id = idOf(created), host = await connected.prepare(), before = await connected.snapshot();
    const update = vi.spyOn(FulfillmentModuleService.prototype, "updateFulfillment"), retrieve = vi.spyOn(FulfillmentModuleService.prototype, "retrieveFulfillment");
    try {
      for (const value of [{ id }, { id, labels: null }, { id, labels: [{}] }, { id, labels: [{ id: "forged", ...labels("bad", 1)[0] }] },
        { id, labels: labels("too-many", 5) }, { id, labels: [], shipped_at: stamp }, { id, labels: [], provider_id: shippingOptionParents.provider }])
        expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host, [host.newRequestKey(), value]))))).toBe(true);
      expect(update).not.toHaveBeenCalled(); expect(retrieve).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { update.mockRestore(); retrieve.mockRestore(); }
  }, 180_000);
});
