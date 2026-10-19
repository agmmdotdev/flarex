import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { jsonEqual } from "flarex-protocol/json";
import { fulfillmentCreationResources } from "../src/workflow/policy";
import { prepareLogicalFulfillmentReturn } from "./support/logical-fulfillment-return-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentReturn>>;
let protectedId: string;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const stamp = "2026-10-01T00:00:00.000Z";
const string = Schema.decodeUnknownSync(Schema.String);
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const members = (value: JsonObject, key: string) => {
  const rows = value[key];
  if (!Array.isArray(rows) || !rows.every(isJsonObject)) throw new Error("Missing native Return " + key);
  return rows;
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const key of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[key], key).toEqual(before[key]);
};
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing actual finite StepResponse retained getter");
  const ids: string[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (typeof value === "string" && value.startsWith("ful_")) ids.push(value);
    return value;
  });
  return { restore: () => spy.mockRestore(), get: () => {
    if (ids.length !== 1 || ids[0] === undefined) throw new Error("Expected one original native Return retained ID");
    return ids[0];
  } };
}

describe(`genuine native Return Fulfillment workflow - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalFulfillmentReturn(driver, close => cleanup.push(close));
    protectedId = string((await connected.seed("return146-protected", true)).id);
  }, 300_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("creates four Items and four persistent Labels, preserves native provider arguments and replays one atomic graph", async () => {
    const host = await connected.prepare(), input = connected.input("return146-maximum", true), request = host.newRequestKey();
    const original = ManualFulfillmentService.prototype.createReturnFulfillment, argumentsSeen: JsonObject[] = [];
    const provider = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment").mockImplementation(async function (this: ManualFulfillmentService, ...args: unknown[]) {
      // The original native JSON methods present this diagnostic copy. The
      // actual provider receives its original objects and unchanged receiver.
      const value: unknown = JSON.parse(JSON.stringify(args));
      const values = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(value), first = values[0];
      if (first === undefined || !isJsonObject(first)) throw new Error("Missing actual Manual return argument");
      argumentsSeen.push(first);
      return Reflect.apply(original, this, args);
    });
    const ordinary = vi.spyOn(ManualFulfillmentService.prototype, "createFulfillment");
    try {
      const before = await connected.snapshot(), beforeRows = await connected.read(); let calls = 0;
      const result = await Effect.runPromise(host.run(request, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      expect(result).toMatchObject({ id: expect.stringMatching(/^ful_/), shipping_option_id: connected.option,
        data: input.data, metadata: input.metadata, canceled_at: null, delivery_address: expect.objectContaining({ first_name: "  First  " }) });
      expect(members(result, "items").map(row => row.quantity)).toEqual([0.125, 0, -1, 2]);
      expect(members(result, "labels")).toHaveLength(4); expect(provider).toHaveBeenCalledTimes(1); expect(ordinary).not.toHaveBeenCalled();
      expect(argumentsSeen).toHaveLength(1);
      const actual = argumentsSeen[0];
      if (actual === undefined || actual.shipping_option === undefined || !isJsonObject(actual.shipping_option)) throw new Error("Missing actual selected Option argument");
      expect(Object.keys(actual.shipping_option).sort()).toEqual(["data", "id", "metadata", "name"]);
      expect(actual.shipping_option.id).toBe(connected.option); expect(actual).not.toHaveProperty("order");
      const option = beforeRows.find(row => row.id === connected.option);
      if (option === undefined) throw new Error("Missing genuine stored Option");
      expect(actual.shipping_option).toEqual({ id: option.id, name: option.name, data: option.data, metadata: option.metadata });
      expect(actual).toMatchObject({ id: result.id, data: input.data });
      expect(result).not.toHaveProperty("order"); expect(result).not.toHaveProperty("location");
      const rows = await connected.read();
      expect(rows.find(row => row.id === result.id)).toMatchObject({ data: input.data, shipping_option_id: connected.option });
      expect(rows.filter(row => row.fulfillment_id === result.id && typeof row.tracking_number === "string").map(row => row.id).sort())
        .toEqual(members(result, "labels").map(row => row.id).sort());
      // The shared fixture also contains Currency rows keyed by code. Complete
      // row membership protects every source without inventing a universal ID.
      for (const row of beforeRows) expect(rows).toContainEqual(row);
      expect(rows.find(row => row.id === protectedId)).toEqual(beforeRows.find(row => row.id === protectedId));
      const after = await connected.snapshot(), events = eventsSince(before, after);
      expect(after.rows.length - before.rows.length).toBe(10); expect(after.commits.length - before.commits.length).toBe(1);
      expect(events.map(event => event.envelope.contract)).toEqual(["fulfillment_address", "fulfillment",
        ...Array.from({ length: 4 }, () => "fulfillment_label"), ...Array.from({ length: 4 }, () => "fulfillment_item")]
        .map(objectName => buildModuleResourceEventName({ prefix: "fulfillment", objectName, action: "created" })));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentCreationResources.calls);
      expect(await Effect.runPromise(host.run(request, input))).toEqual(result); expect(provider).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(request, { ...input, metadata: { changed: true } }))).rejects.toMatchObject({ reason: "requestConflict" });
    } finally { provider.mockRestore(); ordinary.mockRestore(); }
  }, 240_000);

  it.each(["omitted", "null"] as const)("preserves the original %s data snapshot while the native Manual update stores an empty object", async mode => {
    const input = { ...connected.input("return146-data-" + mode) };
    if (mode === "omitted") delete input.data; else input.data = null;
    const host = await connected.prepare(), result = await Effect.runPromise(host.run(host.newRequestKey(), input));
    expect(result.data).toBeNull();
    const rows = await connected.read(); expect(rows.find(row => row.id === result.id)?.data).toEqual({});
    expect(members(result, "labels").map(row => row.id).sort()).toEqual(rows.filter(row => row.fulfillment_id === result.id &&
      typeof row.tracking_number === "string").map(row => row.id).sort());
  }, 180_000);

  it.each(["ordinary", "constructor-string", "constructor-object", "nested-constructor"] as const)(
    "retains native Return initial/stored JSON for %s and reads that stored value during actual cancellation", async kind => {
      const data: JsonObject = kind === "constructor-string" ? { constructor: "own-string147", kept: "constructor147" }
        : kind === "constructor-object" ? { constructor: { marker: "own-object147" }, kept: "constructor147" }
        : kind === "nested-constructor" ? { kept: "nested147", nested: { constructor: "nested-string147", kept: true } }
        : { kept: "ordinary147", nested: { kept: true } };
      const stored = kind === "constructor-string" || kind === "constructor-object" ? {} : data;
      const tap = retainedTap(), nativeCancel = vi.spyOn(FulfillmentModuleService.prototype, "cancelFulfillment"),
        manualCreate = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment"), manualCancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
      try {
        const beforeRows = await connected.read(), host = await connected.prepareWrapped({ retained: tap.get });
        const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...connected.input("return147-" + kind), data }));
        expect(jsonEqual(result.data ?? null, data)).toBe(true); expect(tap.get()).toBe(result.id);
        expect(manualCreate).toHaveBeenCalledTimes(1);
        const providerResult = manualCreate.mock.results[0]; if (providerResult?.type !== "return") throw new Error("Missing actual Manual Return result");
        expect(await providerResult.value).toEqual({ data: {}, labels: [] });
        expect(nativeCancel).toHaveBeenCalledTimes(1); expect(manualCancel).toHaveBeenCalledTimes(1);
        expect(manualCancel.mock.calls[0]).toEqual([stored]);
        const cancellation = nativeCancel.mock.results[0]; if (cancellation?.type !== "return") throw new Error("Missing actual native Return cancellation DTO");
        expect(await cancellation.value).toMatchObject({ id: result.id, data: stored, canceled_at: expect.any(String) });
        const rows = await connected.read(); expect(rows.find(row => row.id === result.id)).toMatchObject({ data: stored, canceled_at: expect.any(String) });
        for (const prior of beforeRows) expect(rows).toContainEqual(prior);
        for (const child of [...members(result, "items"), ...members(result, "labels")])
          expect(rows.find(row => row.id === child.id)).toMatchObject({ fulfillment_id: result.id, deleted_at: null });
      } finally { tap.restore(); nativeCancel.mockRestore(); manualCreate.mockRestore(); manualCancel.mockRestore(); }
    }, 180_000);

  it("refuses own __proto__ JSON before native Return creation without publication", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    const data: unknown = JSON.parse('{"__proto__":{"polluted147":true},"kept":"unsafe147"}');
    const create = vi.spyOn(FulfillmentModuleService.prototype, "createReturnFulfillment");
    try {
      expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host,
        [host.newRequestKey(), { ...connected.input("return147-unsafe"), data }]))))).toBe(true);
      expect(create).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
      expect(Object.prototype).not.toHaveProperty("polluted147");
    } finally { create.mockRestore(); }
  }, 180_000);

  it.each(["omitted", "null", "empty"] as const)("preserves native %s Address and null/empty Item branches", async mode => {
    const input = { ...connected.input("return146-address-" + mode) };
    if (mode === "omitted") delete input.delivery_address; else input.delivery_address = mode === "null" ? null : {};
    input.items = mode === "null" ? null : []; delete input.labels;
    const host = await connected.prepare(), before = await connected.snapshot(), result = await Effect.runPromise(host.run(host.newRequestKey(), input));
    expect(members(result, "items")).toEqual([]); expect(members(result, "labels")).toEqual([]);
    if (mode === "empty") expect(result.delivery_address).toMatchObject({ id: expect.any(String), first_name: null });
    else { expect(result).not.toHaveProperty("delivery_address"); expect(result).not.toHaveProperty("delivery_address_id"); }
    expect((await connected.snapshot()).rows.length - before.rows.length).toBe(mode === "empty" ? 2 : 1);
  }, 180_000);

  it("invokes the actual retained Return cancellation twice with one provider effect and keeps all original children", async () => {
    const tap = retainedTap(), host = await connected.prepareWrapped({ retained: tap.get, repeat: true });
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), connected.input("return146-inverse", true)));
      expect(tap.get()).toBe(result.id); expect(result.canceled_at).toBeNull(); expect(cancel).toHaveBeenCalledTimes(1);
      const rows = await connected.read(); expect(rows.find(row => row.id === result.id)).toMatchObject({ canceled_at: expect.any(String), deleted_at: null });
      for (const row of [...members(result, "items"), ...members(result, "labels")])
        expect(rows.find(stored => stored.id === row.id)).toMatchObject({ fulfillment_id: result.id, deleted_at: null });
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 240_000);

  it("retains already-canceled input without another native provider cancellation", async () => {
    const tap = retainedTap(), host = await connected.prepareWrapped({ retained: tap.get });
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { ...connected.input("return146-pre-canceled"), canceled_at: stamp }));
      expect(result.canceled_at).toBe(stamp); expect(cancel).not.toHaveBeenCalled();
      expect((await connected.read()).find(row => row.id === result.id)?.canceled_at).toBe(stamp);
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it.each(["shipped_at", "delivered_at"] as const)("creates with native %s but atomically refuses the authentic retained cancellation", async field => {
    const input = { ...connected.input("return146-guard-" + field), [field]: stamp }, ordinary = await connected.prepare();
    expect((await Effect.runPromise(ordinary.run(ordinary.newRequestKey(), input)))[field]).toBe(stamp);
    const tap = retainedTap(), host = await connected.prepareWrapped({ retained: tap.get });
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      expect(cancel).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 180_000);

  it("rolls back a full returned graph and actual cancellation after a late parent failure", async () => {
    const tap = retainedTap(), host = await connected.prepareWrapped({ retained: tap.get, lateFailure: true });
    const cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
    try {
      const before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), connected.input("return146-late", true)))))).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1); noMutation(before, await connected.snapshot());
    } finally { tap.restore(); cancel.mockRestore(); }
  }, 240_000);

  it.each(["missing", "historical"] as const)("refuses %s Location before invoking native return creation", async kind => {
    const location = "return146-location-" + kind;
    if (kind === "historical") {
      await connected.seedLocation(location, false);
      await connected.arrange("stockLocation", "stock_location", "softDelete", [{ id: location }]);
    }
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createReturnFulfillment");
    try {
      const before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ...connected.input(location), location_id: location })));
      expect(Result.isFailure(outcome)).toBe(true);
      expect(native).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["omitted", "null", "missing", "historical"] as const)("retains native %s Option failure ordering while outer settlement publishes no residual graph", async kind => {
    const input = { ...connected.input("return146-option-" + kind) };
    if (kind === "omitted") delete input.shipping_option_id;
    else if (kind === "null") input.shipping_option_id = null;
    else if (kind === "missing") input.shipping_option_id = "return146-missing-option";
    else {
      const option = await connected.seedOption("return146-historical-option");
      await connected.arrange("fulfillment", "shipping_option", "softDelete", [{ id: option }]); input.shipping_option_id = option;
    }
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createReturnFulfillment"), provider = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment");
    try {
      const before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)));
      expect(Result.isFailure(outcome)).toBe(true);
      expect(native).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
      if (kind === "omitted" || kind === "null") await expect(native.mock.results[0]?.value).rejects.toMatchObject({ message: "shippingOption - id must be defined" });
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 180_000);

  it.each(["missing", "unregistered"] as const)("rolls back %s Provider failure and native cleanup without a leaked Address", async kind => {
    const providerId = "return146-" + kind + "-provider";
    if (kind === "unregistered") await connected.arrange("fulfillment", "fulfillment_provider", "insert", [{ id: providerId,
      is_enabled: true, created_at: stamp, updated_at: stamp, deleted_at: null }]);
    const host = await connected.prepare(), provider = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment");
    try {
      const before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ...connected.input(providerId), provider_id: providerId })));
      expect(Result.isFailure(outcome)).toBe(true);
      expect(provider).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { provider.mockRestore(); }
  }, 180_000);

  it("exposes only frozen selected methods and revokes the borrowed cancellation handle", async () => {
    let escaped: ((id: string) => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ escape: cancel => { escaped = cancel; }, inspectResources: resources => {
      expect(resources).not.toHaveProperty("stockLocation"); expect(resources).not.toHaveProperty("manager"); expect(resources).not.toHaveProperty("table");
      if (!isNonArrayRecord(resources)) throw new Error("Missing actual borrowed Return resources");
      expect(Object.isFrozen(resources)).toBe(true);
      const descriptor = Object.getOwnPropertyDescriptor(resources, "fulfillment");
      const methods: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
      if (!isNonArrayRecord(methods)) throw new Error("Missing selected Fulfillment methods");
      expect(Object.keys(methods)).toEqual(["createReturnFulfillment", "cancelFulfillment"]); expect(Object.isFrozen(methods)).toBe(true);
    } });
    const result = await Effect.runPromise(host.run(host.newRequestKey(), connected.input("return146-lifetime")));
    if (escaped === undefined) throw new Error("Missing actual borrowed cancellation handle");
    const before = await connected.snapshot(); await expect(escaped(string(result.id))).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
  }, 180_000);

  it.each([{ calls: 2 }, { eventMessages: 1 }])("refuses insufficient root resources without a partial graph: %j", async limits => {
    const host = await connected.prepareWrapped(limits), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), connected.input("return146-budget", true)))))).toBe(true);
    noMutation(before, await connected.snapshot());
  }, 180_000);

  it("refuses aggregate overflow, managed identities and invalid quantities before native publication", async () => {
    const valid = connected.input("return146-invalid"), item = valid.items?.[0];
    if (item === undefined) throw new Error("Missing genuine checked Item");
    const host = await connected.prepare(), provider = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment");
    try {
      for (const input of [{ ...valid, id: "forged" }, { ...valid, created_at: stamp }, { ...valid, return_id: "unadmitted" },
        { ...valid, items: [{ ...item, quantity: "invalid" }] }, { ...valid, items: Array.from({ length: 5 }, () => item) },
        { ...valid, labels: Array.from({ length: 5 }, () => ({ tracking_number: "n", tracking_url: "u", label_url: "l" })) }]) {
        const before = await connected.snapshot();
        expect(Result.isFailure(await Effect.runPromise(Effect.result(Reflect.apply(host.run, host, [host.newRequestKey(), input]))))).toBe(true);
        noMutation(before, await connected.snapshot());
      }
      expect(provider).not.toHaveBeenCalled();
    } finally { provider.mockRestore(); }
  }, 180_000);

  it("refuses a forged result from the actual native call through its causal receipt owner", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.createReturnFulfillment;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createReturnFulfillment").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const value = await original.call(this, ...args); return { ...value, id: "ful_146_forged_result" };
    });
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), connected.input("return146-receipt")))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      noMutation(before, await connected.snapshot());
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["ordinary", "return-marked"] as const)("passes complete %s Option data without inventing return eligibility or provider equality", async kind => {
    const option = await connected.seedOption("return146-option-positive-" + kind);
    const data: JsonObject = kind === "ordinary" ? { id: "manual-fulfillment", marker: { raw: [1, null, "ordinary"] } }
      : { id: "manual-fulfillment-return", is_return: true, marker: { raw: [2, null, "return"] } };
    const metadata = { marker: kind, nested: { retained: true } };
    if (kind === "ordinary") {
      const providerId = "return146-different-option-provider";
      await connected.arrange("fulfillment", "fulfillment_provider", "insert", [{ id: providerId,
        is_enabled: true, created_at: stamp, updated_at: stamp, deleted_at: null }]);
      await connected.arrangeOption(option, { provider_id: providerId, data, metadata });
    } else await connected.arrangeOption(option, { data, metadata });
    const original = ManualFulfillmentService.prototype.createReturnFulfillment, observed: JsonObject[] = [];
    const provider = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment").mockImplementation(async function (this: ManualFulfillmentService, ...args: unknown[]) {
      const raw: unknown = JSON.parse(JSON.stringify(args)), values = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(raw), value = values[0];
      if (value === undefined || !isJsonObject(value)) throw new Error("Missing actual Manual return argument");
      observed.push(value); return Reflect.apply(original, this, args);
    });
    try {
      const beforeRows = await connected.read(), storedOption = beforeRows.find(row => row.id === option);
      if (storedOption === undefined) throw new Error("Missing positive Option fixture");
      const host = await connected.prepare(), input = { ...connected.input("return146-positive-" + kind), shipping_option_id: option };
      const result = await Effect.runPromise(host.run(host.newRequestKey(), input));
      expect(provider).toHaveBeenCalledTimes(1);
      expect(observed[0]?.shipping_option).toEqual({ id: option, name: storedOption.name, data, metadata });
      expect(result).toMatchObject({ shipping_option_id: option, provider: { id: input.provider_id } });
      if (kind === "ordinary") expect(storedOption.provider_id).not.toBe(input.provider_id);
      expect((await connected.read()).find(row => row.id === option)).toEqual(storedOption);
    } finally { provider.mockRestore(); }
  }, 180_000);

  it("creates and compensates through a historical registered Provider without changing that endpoint", async () => {
    // This history belongs to an isolated installed fixture, so the shared
    // Manual endpoint remains active for every other case regardless of order.
    const owned: Array<() => Promise<void>> = [];
    try {
      const isolated = await prepareLogicalFulfillmentReturn(driver, close => owned.push(close));
      const input = isolated.input("return146-historical-provider");
      await isolated.arrange("fulfillment", "fulfillment_provider", "softDelete", [{ id: input.provider_id }]);
      const beforeRows = await isolated.read(), endpoint = beforeRows.find(row => row.id === input.provider_id);
      expect(endpoint).toMatchObject({ deleted_at: expect.any(String) });
      const tap = retainedTap(), create = vi.spyOn(ManualFulfillmentService.prototype, "createReturnFulfillment"), cancel = vi.spyOn(ManualFulfillmentService.prototype, "cancelFulfillment");
      try {
        const host = await isolated.prepareWrapped({ retained: tap.get }), result = await Effect.runPromise(host.run(host.newRequestKey(), input));
        expect(result).toMatchObject({ provider_id: input.provider_id, provider: { id: input.provider_id }, canceled_at: null });
        expect(create).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
        const rows = await isolated.read();
        expect(rows.find(row => row.id === result.id)).toMatchObject({ provider_id: input.provider_id, canceled_at: expect.any(String) });
        expect(rows.find(row => row.id === input.provider_id)).toEqual(endpoint);
      } finally { tap.restore(); create.mockRestore(); cancel.mockRestore(); }
    } finally { for (const dispose of owned.reverse()) await dispose(); }
  }, 300_000);
});
