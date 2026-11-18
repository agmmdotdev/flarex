import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { cancelFulfillmentWorkflow } from "@medusajs/core-flows/fulfillment/cancel-fulfillment";
import { defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { buildModuleResourceEventName, MathBN } from "@medusajs/framework/utils/portable";
import { encodeExactNumeric } from "../src/value/exact-numeric";
import { prepareLogicalFulfillmentCancellation } from "./support/logical-fulfillment-cancel-fixture";
import { shippingOptionParents } from "./support/logical-shipping-option-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentCancellation>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const updated = buildModuleResourceEventName({ prefix: "fulfillment", objectName: "fulfillment", action: "updated" });

const stamp = "2026-10-01T00:00:00.000Z";
const idOf = (row: JsonObject) => Schema.decodeUnknownSync(Schema.String)(row.id);
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine finite StepResponse owner");
  const values: string[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (typeof value === "string" && value.startsWith("ful_")) values.push(value);
    return value;
  });
  return { values, restore: () => spy.mockRestore() };
}

describe("genuine standalone native Fulfillment cancellation", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentCancellation(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves native historical Provider dispatch and ID-only DTO references", async () => {
    const created = await connected.seed("cancel143-historical-provider");
    await connected.arrangeCancellation("fulfillment_provider", "softDelete", [{ id: shippingOptionParents.provider }]);
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(), beforeRows = await connected.read(), before = await connected.snapshot();
      expect(beforeRows.find(row => row.id === created.id)).toMatchObject({ provider_id: shippingOptionParents.provider, canceled_at: null });
      const provider = beforeRows.find(row => row.id === shippingOptionParents.provider);
      expect(provider).toMatchObject({ id: shippingOptionParents.provider, deleted_at: expect.any(String) });
      if (typeof provider?.deleted_at !== "string") throw new Error("Missing authentic historical Provider state");
      expect(Number.isFinite(Date.parse(provider.deleted_at))).toBe(true);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: Schema.decodeUnknownSync(Schema.String)(created.id) }))).toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1);
      const result = native.mock.results[0];
      if (result?.type !== "return") throw new Error("Missing actual native cancellation result");
      expect(await result.value).toMatchObject({ id: created.id, provider_id: shippingOptionParents.provider, provider: { id: shippingOptionParents.provider }, canceled_at: expect.any(String) });
      const stored = (await connected.read()).find(row => row.id === created.id);
      expect(stored).toMatchObject({ provider_id: shippingOptionParents.provider, canceled_at: expect.any(String) });
      expect((await connected.read()).find(row => row.id === shippingOptionParents.provider)).toEqual(beforeRows.find(row => row.id === shippingOptionParents.provider));
      const after = await connected.snapshot();
      expect(eventsSince(before, after).map(event => event.envelope.contract)).toEqual([updated]);
      expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
    } finally {
      cancel.mockRestore(); native.mockRestore();
      await connected.arrangeCancellation("fulfillment_provider", "restore", [{ id: shippingOptionParents.provider }]);
    }
  }, 180_000);
  it("returns genuine void as null, retains the actual ID without an inverse, and replays one root-only update", async () => {
    const created = await connected.seed("cancel143-nominal", { maximum: true }), id = idOf(created);
    const protectedRoot = await connected.seed("cancel143-protected", { maximum: true });
    const beforeRows = await connected.read(), before = await connected.snapshot();
    const tap = retainedTap(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(), request = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(request, { id }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (label, work) => Effect.sync(() => { if (label === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1); expect(tap.values).toEqual([id]);
      const prepared = Result.getOrThrow(cancelFulfillmentWorkflow.prepare()), step = prepared.nodes.find(node => node.name === "cancel-fulfillment");
      if (step?.kind !== "step") throw new Error("Missing native standalone cancellation step");
      expect(step.compensate).toBeUndefined(); expect(step.compensation).toBeUndefined();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing actual cancellation DTO");
      expect(await result.value).toMatchObject({ id, canceled_at: expect.any(String), data: created.data });
      const afterRows = await connected.read(), stored = afterRows.find(row => row.id === id), previous = beforeRows.find(row => row.id === id);
      if (stored === undefined || previous === undefined) throw new Error("Missing real Fulfillment row");
      expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
      expect(afterRows.find(row => row.id === protectedRoot.id)).toEqual(beforeRows.find(row => row.id === protectedRoot.id));
      const { canceled_at: _newCanceled, updated_at: _newUpdated, ...unchanged } = stored;
      const { canceled_at: _oldCanceled, updated_at: _oldUpdated, ...original } = previous;
      expect(unchanged).toEqual(original); expect(stored.canceled_at).toEqual(expect.any(String));
      const after = await connected.snapshot(), events = eventsSince(before, after);
      expect(after.rows).toHaveLength(before.rows.length); expect(after.revisions).toHaveLength(before.revisions.length + 1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1); expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(events.map(event => event.envelope.contract)).toEqual([updated]);
      expect(events[0]?.envelope.message).toMatchObject({ metadata: { source: "fulfillment", object: "fulfillment", action: "updated" }, data: { id } });
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      console.info("Fulfillment standalone cancellation maximum", { calls, messages: events.length });
      expect(await Effect.runPromise(host.run(request, { id }))).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1); expect(native).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(request, { id: idOf(protectedRoot) }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { tap.restore(); cancel.mockRestore(); native.mockRestore(); }
  }, 240_000);

  it("protects more than four existing Items and Labels without importing creation bounds into cancellation", async () => {
    const created = await connected.seed("cancel143-existing-children", { maximum: true }), id = idOf(created);
    const rows = await connected.read(), item = rows.find(row => row.fulfillment_id === id && typeof row.title === "string"), label = rows.find(row => row.fulfillment_id === id && typeof row.tracking_number === "string");
    if (item === undefined || label === undefined) throw new Error("Missing genuine native child preimages");
    await connected.arrangeCancellation("fulfillment_item", "insert", [1, 2].map(index => ({ ...item, id: "fulitem143-extra-" + index })));
    await connected.arrangeCancellation("fulfillment_label", "insert", [1, 2].map(index => ({ ...label, id: "fullabel143-extra-" + index })));
    const beforeRows = await connected.read(), children = beforeRows.filter(row => row.fulfillment_id === id), before = await connected.snapshot(), host = await connected.prepare();
    expect(children).toHaveLength(12);
    const quantities = await Effect.runPromise(Effect.forEach(children.filter(row => typeof row.title === "string"), row => encodeExactNumeric(row.quantity)));
    expect(quantities.some(quantity => MathBN.eq(quantity.value, "0.125"))).toBe(true);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
    expect((await connected.read()).filter(row => row.fulfillment_id === id)).toEqual(children);
    const after = await connected.snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
    expect(eventsSince(before, after).map(event => event.envelope.contract)).toEqual([updated]);
  }, 240_000);

  it("preserves null stored data while genuine Manual receives its native empty-object default", async () => {
    const created = await connected.seed("cancel143-null-data"), id = idOf(created);
    await connected.arrangeCancellation("fulfillment", "update", [{ id, data: null }]);
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      expect(cancel).toHaveBeenCalledExactlyOnceWith({}); expect((await connected.read()).find(row => row.id === id)?.data).toBeNull();
    } finally { cancel.mockRestore(); }
  }, 180_000);

  it.each([
    { name: "shipped only", shipped_at: stamp, delivered_at: null, canceled_at: null, guard: "shipped" },
    { name: "delivered only", shipped_at: null, delivered_at: stamp, canceled_at: null, guard: "delivered" },
    { name: "shipped and delivered", shipped_at: stamp, delivered_at: stamp, canceled_at: null, guard: "shipped" },
    { name: "canceled and shipped", shipped_at: stamp, delivered_at: null, canceled_at: stamp, guard: "shipped" },
    { name: "canceled and delivered", shipped_at: null, delivered_at: stamp, canceled_at: stamp, guard: "delivered" },
    { name: "canceled shipped and delivered", shipped_at: stamp, delivered_at: stamp, canceled_at: stamp, guard: "shipped" },
  ])("preserves native guard precedence for $name", async ({ name, guard, ...dates }) => {
    const created = await connected.seed("cancel143-guard-" + name, { input: dates }), id = idOf(created);
    const before = await connected.snapshot(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id }))))).toBe(true);
      expect(cancel).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing actual native guard rejection");
      await expect(result.value).rejects.toMatchObject({ type: "invalid_data", message: `Fulfillment with id ${id} already ${guard}` });
    } finally { cancel.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it("allows native packed-only cancellation", async () => {
    const created = await connected.seed("cancel143-packed", { input: { packed_at: stamp } }), id = idOf(created);
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try { const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      expect(cancel).toHaveBeenCalledTimes(1); expect((await connected.read()).find(row => row.id === id)).toMatchObject({ packed_at: stamp, canceled_at: expect.any(String) });
    } finally { cancel.mockRestore(); }
  }, 180_000);

  it.each(["missing", "historical"] as const)("preserves native %s Fulfillment absence without publication", async kind => {
    const id = kind === "missing" ? "ful143-missing" : idOf(await connected.seed("cancel143-historical-root"));
    if (kind === "historical") await connected.arrangeCancellation("fulfillment", "softDelete", [{ id }]);
    const before = await connected.snapshot(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id }))))).toBe(true);
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing actual native absence rejection");
      await expect(result.value).rejects.toMatchObject({ type: "not_found", message: `Fulfillment with id: ${id} was not found` });
      expect(cancel).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { cancel.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it.each(["unregistered", "null"] as const)("refuses native %s Provider dispatch before date mutation", async kind => {
    const created = await connected.seed("cancel143-provider-" + kind), id = idOf(created), provider = "unregistered143-" + kind;
    if (kind !== "null") await connected.arrangeCancellation("fulfillment_provider", "insert", [{ id: provider, is_enabled: true }]);
    await connected.arrangeCancellation("fulfillment", "update", [{ id, provider_id: kind === "unregistered" ? provider : null }]);
    const before = await connected.snapshot(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id }))))).toBe(true);
      expect(cancel).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { cancel.mockRestore(); }
  }, 180_000);

  it.each(["unregistered", "null", "historical"] as const)("bypasses native %s Provider dispatch for an already-canceled Fulfillment", async kind => {
    const created = await connected.seed("cancel143-noop-" + kind, { input: { canceled_at: stamp } }), id = idOf(created), provider = "unregistered143-noop";
    if (kind === "unregistered") {
      await connected.arrangeCancellation("fulfillment_provider", "insert", [{ id: provider, is_enabled: true }]);
      await connected.arrangeCancellation("fulfillment", "update", [{ id, provider_id: provider }]);
    } else if (kind === "null") await connected.arrangeCancellation("fulfillment", "update", [{ id, provider_id: null }]);
    else await connected.arrangeCancellation("fulfillment_provider", "softDelete", [{ id: shippingOptionParents.provider }]);
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const before = await connected.snapshot(), host = await connected.prepare(), request = host.newRequestKey();
      expect(await Effect.runPromise(host.run(request, { id }))).toBeNull(); expect(cancel).not.toHaveBeenCalled();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing actual native no-op DTO");
      const dto: unknown = await result.value;
      expect(dto).toMatchObject({ id, canceled_at: stamp, provider: kind === "null" ? null : { id: kind === "unregistered" ? provider : shippingOptionParents.provider } });
      if (kind === "null") expect(dto).not.toHaveProperty("provider_id");
      else expect(dto).toHaveProperty("provider_id", kind === "unregistered" ? provider : shippingOptionParents.provider);
      const after = await connected.snapshot(); noMutation(before, after);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull(); noMutation(after, await connected.snapshot()); expect(cancel).not.toHaveBeenCalled();
    } finally { cancel.mockRestore(); native.mockRestore(); if (kind === "historical") await connected.arrangeCancellation("fulfillment_provider", "restore", [{ id: shippingOptionParents.provider }]); }
  }, 180_000);

  it("retains genuine disabled Manual Provider registration", async () => {
    const created = await connected.seed("cancel143-disabled-provider"), id = idOf(created);
    await connected.arrangeCancellation("fulfillment_provider", "update", [{ id: shippingOptionParents.provider, is_enabled: false }]);
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try { const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1); }
    finally { cancel.mockRestore(); await connected.arrangeCancellation("fulfillment_provider", "update", [{ id: shippingOptionParents.provider, is_enabled: true }]); }
  }, 180_000);

  it.each(["historicalOption", "historicalAddress", "detachedOption"] as const)("preserves native %s relation semantics and stored foreign keys", async kind => {
    const option = kind === "historicalAddress" ? undefined : await connected.seedBareOption("cancel143-" + kind, shippingOptionParents.zone);
    const created = await connected.seed("cancel143-" + kind, { input: option === undefined ? {} : { shipping_option_id: option } }), id = idOf(created);
    const beforeRoot = (await connected.read()).find(row => row.id === id);
    if (kind === "historicalOption") {
      if (option === undefined) throw new Error("Missing genuine historical Option ID");
      await connected.arrangeCancellation("shipping_option", "softDelete", [{ id: option }]);
    }
    else if (kind === "historicalAddress") {
      if (typeof beforeRoot?.delivery_address_id !== "string") throw new Error("Missing genuine delivery Address ID");
      await connected.arrangeCancellation("fulfillment_address", "softDelete", [{ id: beforeRoot.delivery_address_id }]);
    } else {
      if (option === undefined) throw new Error("Missing genuine native Option ID");
      await connected.deleteOption(option);
    }
    const beforeRows = await connected.read(), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try {
      const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing actual native reference DTO");
      const dto: unknown = await result.value;
      if (kind === "historicalAddress") expect(dto).toMatchObject({ delivery_address_id: beforeRoot?.delivery_address_id, delivery_address: { id: beforeRoot?.delivery_address_id } });
      else expect(dto).toMatchObject({ shipping_option_id: null, shipping_option: null });
      const afterRows = await connected.read(); expect(afterRows.filter(row => row.id !== id)).toEqual(beforeRows.filter(row => row.id !== id));
      expect(afterRows.find(row => row.id === id)).toMatchObject({ shipping_option_id: kind === "historicalOption" ? option : beforeRows.find(row => row.id === id)?.shipping_option_id,
        delivery_address_id: beforeRows.find(row => row.id === id)?.delivery_address_id, canceled_at: expect.any(String) });
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["omitted", "null"] as const)("presents native null Shipping Option after %s creation input", async mode => {
    const created = await connected.seed("cancel143-optional-" + mode, { input: mode === "null" ? { shipping_option_id: null } : {} }), id = idOf(created);
    const native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try { const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing optional Option DTO");
      expect(await result.value).toMatchObject({ shipping_option_id: null, shipping_option: null });
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each([false, true])("keeps native no-op minimum Address key omission with null Provider=%s", async nullProvider => {
    const created = await connected.seed("cancel143-minimum-noop-" + nullProvider, { input: { delivery_address: null, items: [], labels: [], canceled_at: stamp } }), id = idOf(created);
    if (nullProvider) await connected.arrangeCancellation("fulfillment", "update", [{ id, provider_id: null }]);
    const before = await connected.snapshot(), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment"), native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try { const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing native minimum no-op DTO");
      const dto: unknown = await result.value; expect(dto).toMatchObject({ delivery_address: null }); expect(dto).not.toHaveProperty("delivery_address_id");
      if (nullProvider) { expect(dto).toMatchObject({ provider: null }); expect(dto).not.toHaveProperty("provider_id"); }
      expect(cancel).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { cancel.mockRestore(); native.mockRestore(); }
  }, 180_000);

  it("retains native assigned null Address on a changed minimum cancellation", async () => {
    const created = await connected.seed("cancel143-minimum-changed", { input: { delivery_address: null, items: [], labels: [] } }), id = idOf(created);
    const native = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment");
    try { const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull();
      const result = native.mock.results[0]; if (result?.type !== "return") throw new Error("Missing native minimum changed DTO");
      expect(await result.value).toMatchObject({ delivery_address_id: null, delivery_address: null, canceled_at: expect.any(String) });
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps the genuine no-inverse cancellation inside atomic late-failure rollback", async () => {
    const created = await connected.seed("cancel143-late-failure"), id = idOf(created), before = await connected.snapshot();
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try { const host = await connected.prepareWrapped({ lateFailure: true });
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id }))))).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { cancel.mockRestore(); }
  }, 180_000);

  it("exposes only frozen native cancellation resources, revokes the borrowed handle and keeps repetition idempotent", async () => {
    const created = await connected.seed("cancel143-resource-lifetime"), id = idOf(created);
    let escaped: ((id: string) => Promise<unknown>) | undefined;
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try { const host = await connected.prepareWrapped({ repeat: true, escape: call => { escaped = call; }, inspectResources: resources => {
      if (resources === null || typeof resources !== "object" || Array.isArray(resources)) throw new Error("Missing actual workflow resources");
      expect(Object.isFrozen(resources)).toBe(true); expect(resources).not.toHaveProperty("query"); expect(resources).not.toHaveProperty("stockLocation");
      const fulfillment: unknown = Reflect.get(resources, "fulfillment");
      if (fulfillment === null || typeof fulfillment !== "object" || Array.isArray(fulfillment)) throw new Error("Missing actual Fulfillment resource");
      expect(Object.keys(fulfillment)).toEqual(["cancelFulfillment"]);
      expect(Object.isFrozen(fulfillment)).toBe(true); expect(fulfillment).not.toHaveProperty("createFulfillment");
    } });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id }))).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1);
      if (escaped === undefined) throw new Error("Missing genuine escaped cancellation method");
      const after = await connected.snapshot(); await expect(escaped(id)).rejects.toMatchObject({ reason: "closed" }); expect(await connected.snapshot()).toEqual(after);
    } finally { cancel.mockRestore(); }
  }, 180_000);

  it("refuses a smaller genuine root budget before partial cancellation publication", async () => {
    const created = await connected.seed("cancel143-budget"), id = idOf(created), before = await connected.snapshot();
    const host = await connected.prepareWrapped({ calls: 2 });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id }))))).toBe(true); expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

});
