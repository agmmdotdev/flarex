import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { StoreModuleService } from "@medusajs/store/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { StoreUpdateUpserts } from "../src/modules/store/update-input";
import { makeStoreCreationCommands } from "../src/modules/store/create-service";
import { makeStoreDeletionCommands } from "../src/modules/store/delete-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareStoreUpdateWorkflow, StoreUpdateWorkflowInput } from "../src/workflows/store/update";
import { storeUpdateResources } from "../src/workflow/policy";
import { prepareLogicalStoreUpdate, storeUpdateGraph } from "./support/logical-store-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStoreUpdate>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const ids = (values: readonly JsonObject[]) => values.map(row => text(row.id));
const children = (values: readonly JsonObject[], field: "supported_currencies" | "supported_locales") => values.flatMap(row => rows(row[field]));
const graphIds = (values: readonly JsonObject[]) => [...ids(values), ...ids(children(values, "supported_currencies")), ...ids(children(values, "supported_locales"))];
const maximum = storeUpdateGraph("store-update-max", 4, 2, 2, { currencies: 1, locales: 1 });
const clear = storeUpdateGraph("store-update-clear", 4, 2, 2);
const partial = storeUpdateGraph("store-update-partial", 1, 2, 2);
const metadata = storeUpdateGraph("store-update-metadata", 1, 1, 1);
const validation = storeUpdateGraph("store-update-validation", 1, 1, 1);
const failure = storeUpdateGraph("store-update-failure", 1, 1, 1);
const cancel = storeUpdateGraph("store-update-cancel", 1, 1, 1);
const scoped = storeUpdateGraph("store-update-scope", 1, 1, 1);
const racing = { update: storeUpdateGraph("store-update-race-update"), delete: storeUpdateGraph("store-update-race-delete"),
  preferences: storeUpdateGraph("store-update-race-preferences") };
const overflow = storeUpdateGraph("store-update-history-overflow", 4, 3, 1, { currencies: 1 });
const protectedGraph = storeUpdateGraph("store-update-protected", 1, 2, 2);
const oneRelation = storeUpdateGraph("store-update-one-relation", 1, 2, 2);
const initial = [maximum, clear, partial, metadata, validation, failure, cancel, scoped, ...Object.values(racing), overflow, protectedGraph, oneRelation].flatMap(graph => graph.rows);
const sorted = (values: readonly string[]) => [...values].sort();
const withoutUpdated = (value: JsonObject) => { const { updated_at: _updated, ...rest } = value; return rest; };
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failures(reason.error)
    : reason._tag === "Die" ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failures(value.cause)];
  return value instanceof Error ? [value.message, ...failures(value.cause)] : [];
}
const eventName = (objectName: string, action: "created" | "updated" | "deleted") => buildModuleResourceEventName({ prefix: "store", objectName, action });
function eventIds(events: Awaited<ReturnType<typeof connected.snapshot>>["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native event data");
    return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}

describe("genuine Store updates on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalStoreUpdate(driver, close => cleanup.push(close), initial); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("replaces the complete four-root historical graph, preserves native DTO/events and measures the maximum", async () => {
    const host = await connected.prepare(), input = connected.maximumInput(maximum.stores), originalInput = structuredClone(input);
    const before = await connected.snapshot(), protectedIds = [...protectedGraph.stores, ...protectedGraph.currencies, ...protectedGraph.locales, connected.preferenceIds.neighbor];
    const protectedBefore = await connected.read(protectedIds), oldIds = [...maximum.currencies, ...maximum.locales];
    const update = vi.spyOn(StoreModuleService.prototype, "updateStores"), list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    const upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    try {
      let calls = 0; const key = host.newRequestKey();
      const output = rows(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Store update maximum BoundedRequest.enter", calls))))));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(storeUpdateResources.calls);
      expect(sorted(ids(output))).toEqual(sorted(maximum.stores));
      const currencies = children(output, "supported_currencies"), locales = children(output, "supported_locales");
      expect(currencies).toHaveLength(8); expect(locales).toHaveLength(8);
      expect(new Set(graphIds(output)).size).toBe(20);
      for (const row of output) {
        expect(row).toMatchObject({ name: "Updated maximum", metadata: { revised: true }, default_sales_channel_id: null,
          default_region_id: null, default_location_id: null, created_at: "2026-10-17T00:00:00.000Z", updated_at: expect.any(String), deleted_at: null });
        expect(Object.keys(row).sort()).toEqual(["id", "name", "default_sales_channel_id", "default_region_id", "default_location_id", "metadata",
          "created_at", "updated_at", "deleted_at", "supported_currencies", "supported_locales"].sort());
        expect(rows(row.supported_currencies).map(child => child.currency_code)).toEqual(["usd", "eur"]);
        expect(rows(row.supported_currencies).map(child => child.is_default)).toEqual([true, false]);
        expect(rows(row.supported_locales).map(child => child.locale_code)).toEqual(["en-US", "MY-mm"]);
        for (const child of [...rows(row.supported_currencies), ...rows(row.supported_locales)]) {
          expect(child).toMatchObject({ store_id: row.id, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
          expect(oldIds).not.toContain(child.id);
        }
      }
      expect(await connected.read(oldIds)).toEqual([]); expect(await connected.read(graphIds(output))).toHaveLength(20);
      expect(await connected.read(protectedIds)).toEqual(protectedBefore); expect(input).toEqual(originalInput);
      expect(update).toHaveBeenCalledTimes(1); expect(await update.mock.results[0]?.value).toEqual(output);
      expect(list.mock.calls[0]?.[0]).toEqual({ $or: [{ attribute: "currency_code", value: "USD" }, { attribute: "currency_code", value: "eur" }] });
      expect(upsert.mock.calls[0]?.[0]).toEqual([
        { id: connected.preferenceIds.USD, attribute: "currency_code", value: "USD", is_tax_inclusive: false },
        { id: undefined, attribute: "currency_code", value: "eur", is_tax_inclusive: true },
      ]);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(sorted(eventIds(emitted, eventName("store", "updated")))).toEqual(sorted(maximum.stores));
      expect(sorted(eventIds(emitted, eventName("store_currency", "created")))).toEqual(sorted(ids(currencies)));
      expect(sorted(eventIds(emitted, eventName("store_locale", "created")))).toEqual(sorted(ids(locales)));
      expect(sorted(eventIds(emitted, eventName("store_currency", "deleted")))).toEqual(sorted(maximum.currencies));
      expect(sorted(eventIds(emitted, eventName("store_locale", "deleted")))).toEqual(sorted(maximum.locales));
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { selector: { id: [] }, update: {} }))).rejects.toMatchObject({ reason: "requestConflict" });
      const changed = await connected.prepare("d".repeat(64));
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { update.mockRestore(); list.mockRestore(); upsert.mockRestore(); }
  }, 240_000);

  it("executes full clear and retained managed-child inverse within one accepting root", async () => {
    const probe = await connected.prepareRoundtrip(), all = [...clear.stores, ...clear.currencies, ...clear.locales], before = await connected.read(all);
    const inverse = vi.spyOn(StoreModuleService.prototype, "upsertStores");
    try {
      let calls = 0;
      const output = await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id: clear.stores },
        update: { supported_currencies: [], supported_locales: [] } } }).pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
        }), Effect.ensuring(Effect.sync(() => console.info("Store update full clear plus retained inverse BoundedRequest.enter", calls)))));
      const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(output);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(storeUpdateResources.calls);
      expect(result.output).toHaveLength(4);
      expect(children(result.output, "supported_currencies")).toEqual([]); expect(children(result.output, "supported_locales")).toEqual([]);
      expect(children(result.preimages, "supported_currencies")).toHaveLength(8); expect(children(result.preimages, "supported_locales")).toHaveLength(8);
      for (const child of [...children(result.preimages, "supported_currencies"), ...children(result.preimages, "supported_locales")])
        expect(child).toMatchObject({ created_at: "2026-10-17T00:00:00.000Z", updated_at: "2026-10-17T00:00:00.000Z", deleted_at: null });
      expect(inverse).toHaveBeenCalledTimes(1);
      const restored = await connected.read(all); expect(restored).toHaveLength(20);
      expect(restored.map(withoutUpdated)).toEqual(before.map(withoutUpdated));
      expect(restored.every(row => row.updated_at !== "2026-10-17T00:00:00.000Z")).toBe(true);
    } finally { inverse.mockRestore(); }
  }, 240_000);

  it("retains projected child identities and does not invent managed fields for nonempty inverse preimages", async () => {
    const probe = await connected.prepareRoundtrip(), before = await connected.read([...partial.currencies, ...partial.locales]);
    const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
      await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id: partial.stores }, update: {
        supported_currencies: [{ currency_code: "USD", is_default: true }], supported_locales: [{ locale_code: "EN-us" }],
      } } })));
    for (const child of children(result.preimages, "supported_currencies"))
      expect(Object.keys(child).sort()).toEqual(["id", "store_id", "currency_code", "is_default"].sort());
    for (const child of children(result.preimages, "supported_locales")) expect(Object.keys(child).sort()).toEqual(["id", "store_id", "locale_code"].sort());
    const after = await connected.read([...partial.currencies, ...partial.locales]); expect(ids(after)).toEqual(ids(before));
    for (const row of after) {
      const original = before.find(value => value.id === row.id); expect(original).toBeDefined();
      expect(row).toMatchObject({ store_id: original?.store_id, deleted_at: null });
      if (row.currency_code !== undefined) expect(row).toMatchObject({ currency_code: original?.currency_code, is_default: original?.is_default });
      else expect(row.locale_code).toEqual(original?.locale_code);
    }
  }, 180_000);

  it("updates scalars with repeated/missing selectors while retaining both unchanged child families exactly", async () => {
    const host = await connected.prepare(), beforeChildren = await connected.read([...protectedGraph.currencies, ...protectedGraph.locales]);
    const [beforeStore] = await connected.read(protectedGraph.stores);
    if (beforeStore === undefined) throw new Error("Missing existing two-child Store");
    expect(beforeChildren).toHaveLength(4);
    const before = await connected.snapshot(), pricing = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: [
        protectedGraph.stores[0]!, "absent-scalar-store", protectedGraph.stores[0]!,
      ] }, update: { name: " Scalar-only Store update ", default_sales_channel_id: null, default_region_id: null, default_location_id: null } })));
      expect(output).toHaveLength(1);
      expect(output[0]).toMatchObject({ id: protectedGraph.stores[0], name: "Scalar-only Store update", default_sales_channel_id: null,
        default_region_id: null, default_location_id: null });
      const [afterStore] = await connected.read(protectedGraph.stores);
      if (afterStore === undefined) throw new Error("Missing updated two-child Store");
      expect(afterStore).toEqual({ ...beforeStore, name: "Scalar-only Store update", default_sales_channel_id: null,
        default_region_id: null, default_location_id: null, updated_at: afterStore.updated_at });
      const currencyBefore = beforeChildren.filter(row => row.currency_code !== undefined), localeBefore = beforeChildren.filter(row => row.locale_code !== undefined);
      expect(children(output, "supported_currencies")).toEqual(currencyBefore);
      expect(children(output, "supported_locales")).toEqual(localeBefore);
      expect(await connected.read([...protectedGraph.currencies, ...protectedGraph.locales])).toEqual(beforeChildren);
      expect(pricing).not.toHaveBeenCalled();
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(emitted).toHaveLength(1); expect(eventIds(emitted, eventName("store", "updated"))).toEqual(protectedGraph.stores);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
    } finally { pricing.mockRestore(); }
  }, 180_000);

  it("clears only currencies through the genuine root and leaves the omitted two-locale family unchanged", async () => {
    const host = await connected.prepare(), beforeLocales = await connected.read(oneRelation.locales), before = await connected.snapshot();
    expect(beforeLocales).toHaveLength(2);
    const pricing = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: oneRelation.stores }, update: { supported_currencies: [] } })));
      expect(output).toHaveLength(1); expect(children(output, "supported_currencies")).toEqual([]);
      expect(children(output, "supported_locales")).toEqual(beforeLocales); expect(await connected.read(oneRelation.locales)).toEqual(beforeLocales);
      expect(await connected.read(oneRelation.currencies)).toEqual([]); expect(pricing).not.toHaveBeenCalled();
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(sorted(eventIds(emitted, eventName("store_currency", "deleted")))).toEqual(sorted(oneRelation.currencies));
      expect(eventIds(emitted, eventName("store", "updated"))).toEqual(oneRelation.stores);
      expect(emitted).toHaveLength(3); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
    } finally { pricing.mockRestore(); }
  }, 180_000);

  it.each(["root-order", "currency-order", "locale-order", "child-owner", "child-timestamp"] as const)("rejects forged native %s while preserving complete DTO shape", async mode => {
    const host = await connected.prepare(), original = StoreModuleService.prototype.updateStores;
    let completed = false;
    const native = vi.spyOn(StoreModuleService.prototype, "updateStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await original.call(this, ...args);
      expect(result).toHaveLength(2);
      for (const row of result) { expect(row.supported_currencies).toHaveLength(2); expect(row.supported_locales).toHaveLength(2); }
      completed = true;
      if (mode === "root-order") return [...result].reverse();
      if (mode === "currency-order") return result.map(row => ({ ...row, supported_currencies: [...row.supported_currencies ?? []].reverse() }));
      if (mode === "locale-order") return result.map(row => ({ ...row, supported_locales: [...row.supported_locales ?? []].reverse() }));
      return result.map(row => {
        if (row.supported_currencies === undefined) throw new Error("Missing complete native Currency relation");
        return { ...row, supported_currencies: row.supported_currencies.map(child => mode === "child-owner"
          ? { ...child, store_id: protectedGraph.stores[0]! }
          : { ...child, created_at: "2020-01-01T00:00:00.000Z" }) };
      });
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        selector: { id: clear.stores.slice(0, 2) }, update: { name: "Staged output-order witness" },
      })));
      expect(completed).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["id", "owner", "creation-time"] as const)("refuses forged inverse child %s despite authentic same-root deletion history", async mode => {
    const probe = await connected.prepareRoundtrip(), original = StoreModuleService.prototype.upsertStores;
    let reached = false;
    const native = vi.spyOn(StoreModuleService.prototype, "upsertStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const [input, ...rest] = args;
      const captured = Schema.decodeUnknownSync(StoreUpdateUpserts)(input);
      expect(captured).toHaveLength(2);
      const altered = captured.map(row => ({ ...row, supported_currencies: row.supported_currencies?.map(child => {
        expect(child.created_at).toEqual("2026-10-17T00:00:00.000Z");
        if (typeof child.id !== "string") throw new Error("Missing native retained child identity");
        if (mode === "id") return { ...child, id: "never-stored-" + child.id };
        if (mode === "owner") return { ...child, store_id: protectedGraph.stores[0]! };
        return { ...child, created_at: "2020-01-01T00:00:00.000Z" };
      }) }));
      reached = true;
      return Reflect.apply(original, this, [altered, ...rest]);
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(probe.run(probe.newRequestKey(), { input: {
        selector: { id: clear.stores.slice(0, 2) }, update: { supported_currencies: [], supported_locales: [] },
      } })));
      expect(reached).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);


  it("preserves native dotted metadata inverse with both object and null prior metadata", async () => {
    const probe = await connected.prepareRoundtrip(), host = await connected.prepare();
    for (const prior of [{ old_key: true }, null]) {
      await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: metadata.stores }, update: { metadata: prior } }));
      const patch = { new_key: true };
      const result = Schema.decodeUnknownSync(Schema.Struct({ output: Schema.Array(Schema.JsonObject), preimages: Schema.Array(Schema.JsonObject) }))(
        await Effect.runPromise(probe.run(probe.newRequestKey(), { input: { selector: { id: metadata.stores }, update: { metadata: patch } } })));
      expect(result.preimages).toEqual([{ id: metadata.stores[0] }]);
      expect((await connected.read(metadata.stores))[0]?.metadata).toEqual(patch);
    }
  }, 180_000);

  it("skips Pricing for omitted/empty currencies while still calling native empty Store selection", async () => {
    const host = await connected.prepare(), list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), update = vi.spyOn(StoreModuleService.prototype, "updateStores");
    try {
      for (const patch of [{}, { supported_currencies: [] }]) {
        expect(await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: ["absent-store", "absent-store"] }, update: patch }))).toEqual([]);
      }
      expect(update).toHaveBeenCalledTimes(2); expect(list).not.toHaveBeenCalled();
    } finally { list.mockRestore(); update.mockRestore(); }
  }, 180_000);

  it("passes RAW duplicate preferences without a Map even when no Store matches and default validation would fail", async () => {
    const host = await connected.prepare(), list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    try {
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { selector: { id: "absent-store" }, update: {
        supported_currencies: [{ currency_code: "USD", is_tax_inclusive: true }, { currency_code: "USD", is_tax_inclusive: false }],
      } }));
      expect(list.mock.calls[0]?.[0]).toEqual({ $or: [{ attribute: "currency_code", value: "USD" }, { attribute: "currency_code", value: "USD" }] });
      expect(upsert.mock.calls[0]?.[0]).toEqual([
        { id: connected.preferenceIds.USD, attribute: "currency_code", value: "USD", is_tax_inclusive: true },
        { id: connected.preferenceIds.USD, attribute: "currency_code", value: "USD", is_tax_inclusive: false },
      ]);
      expect(result).toEqual([]);
      // Native MedusaInternalService's ID-keyed Map, after this RAW workflow
      // boundary, keeps the last repeated update. No adapter Map is added.
      expect((await connected.read([connected.preferenceIds.USD]))[0]?.is_tax_inclusive).toBe(false);
    } finally { list.mockRestore(); upsert.mockRestore(); }
  }, 180_000);

  it.each([
    ["duplicate normalized currencies first", { supported_currencies: [{ currency_code: "USD", is_default: true }, { currency_code: "usd", is_default: true }] }, "Duplicate currency codes: usd"],
    ["missing default", { supported_currencies: [{ currency_code: "usd" }] }, "There should be a default currency set for the store"],
    ["two defaults", { supported_currencies: [{ currency_code: "usd", is_default: true }, { currency_code: "eur", is_default: true }] }, "Only one default currency is allowed"],
    ["duplicate locale", { supported_locales: [{ locale_code: "en-US" }, { locale_code: "en-US" }] }, "Duplicate locale codes: en-US"],
  ] satisfies Array<[string, typeof StoreUpdateWorkflowInput.Type["update"], string]>)("keeps native %s error order before Pricing", async (_name, update, message) => {
    const host = await connected.prepare(), before = await connected.snapshot(), list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: validation.stores }, update })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(failures(result.failure)).toContain(message);
      expect(list).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { list.mockRestore(); }
  }, 180_000);

  it("bounds aggregate historical children before mutation despite each Store having only two active currencies", async () => {
    const host = await connected.prepare(), before = await connected.snapshot();
    expect(await connected.read(overflow.currencies, false)).toHaveLength(8);
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: overflow.stores }, update: { name: "refused" } })));
    expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
  }, 120_000);

  it("rolls back Store replacement, native Pricing changes and managed inverse after late failure", async () => {
    const probe = await connected.prepareRoundtrip(), before = await connected.snapshot();
    const result = await Effect.runPromise(Effect.result(probe.run(probe.newRequestKey(), { fail: true, input: { selector: { id: failure.stores },
      update: { supported_currencies: [], supported_locales: [] } }, pricing: [
        { attribute: "currency_code", value: "USD", is_tax_inclusive: true }, { attribute: "currency_code", value: "inverse-new", is_tax_inclusive: true },
      ] })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(failures(result.failure)).toContain("Late native Store roundtrip failure");
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it.each(["late", "caught"] as const)("rolls back the native %s Pricing failure and revokes its escaped method", async mode => {
    const host = await connected.prepare(), before = await connected.snapshot(), original = PricingModuleService.prototype.upsertPricePreferences;
    let escaped: (() => Promise<unknown>) | undefined, caught = false;
    const native = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native Store update Pricing failure");
      try { await this.createPriceSets([{ prices: [] }]); } catch { caught = true; } return result;
    });
    try {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: failure.stores }, update: {
        supported_currencies: [{ currency_code: "MXN", is_default: true }], supported_locales: [{ locale_code: "my-MM" }],
      } })));
      expect(Result.isFailure(result)).toBe(true); expect(caught).toBe(mode === "caught"); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing retained genuine Pricing callback");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["membership", "result", "event"] as const)("rejects forged native %s after the genuine replacement executed", async mode => {
    const host = await connected.prepare(), original = StoreModuleService.prototype.updateStores;
    let completed = false;
    const native = vi.spyOn(StoreModuleService.prototype, "updateStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await original.call(this, ...args); completed = true;
      if (mode === "membership") return result.map(row => ({ ...row, id: "another-store-owner" }));
      if (mode === "result") return result.map(row => ({ ...row, name: "forged result without a corresponding mutation" }));
      const bus: unknown = Reflect.get(this, "eventBusModuleService_");
      if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native event bus");
      const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emitter");
      await Reflect.apply(emit, bus, [[{ name: eventName("store", "updated"), data: { id: "another-store-owner" },
        metadata: { source: "store", object: "store", action: "updated" } }], { internal: true }]); return result;
    });
    try {
      const before = await connected.snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: failure.stores }, update: { name: "Genuine staged replacement" } })));
      expect(completed).toBe(true); expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rejects a trusted execution wrapper that drops the required exclusion profile before native callbacks", async () => {
    const native = vi.spyOn(StoreModuleService.prototype, "updateStores");
    const host = await Effect.runPromise(prepareStoreUpdateWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: connected.execution.identityAndAccessPolicy,
      prepare: composition => { const { executionIsolation: _selected, ...ordinary } = composition;
        return connected.execution.prepare(ordinary); },
    } }));
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { selector: { id: failure.stores }, update: {} })));
      expect(Result.isFailure(result)).toBe(true); expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); await Effect.runPromise(host.close); }
  });

  it("rejects authentic creation/deletion profiles and unrelated Pricing mutation authorities", async () => {
    const creation = await Effect.runPromise(makeStoreCreationCommands()), deletion = await Effect.runPromise(makeStoreDeletionCommands());
    const pricing = await Effect.runPromise(makeLocalPricingCommands("create"));
    for (const module of [creation.workflow, deletion.workflow]) {
      const result = await Effect.runPromise(Effect.result(prepareStoreUpdateWorkflow({ ...connected.options, modules: { ...connected.options.modules,
        // @ts-expect-error Deliberately select an authentic incompatible Store profile.
        store: { ...connected.options.modules.store, module },
      } })));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    const result = await Effect.runPromise(Effect.result(prepareStoreUpdateWorkflow({ ...connected.options, modules: { ...connected.options.modules,
      pricing: { ...connected.options.modules.pricing, module: pricing.workflow },
    } })));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  });

  it("rolls back cancellation after native writes and rejects the revoked continuation", async () => {
    const host = await connected.prepare(), before = await connected.snapshot(), reached = Deferred.makeUnsafe<void>();
    const original = StoreModuleService.prototype.updateStores; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(StoreModuleService.prototype, "updateStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { selector: { id: cancel.stores }, update: { name: "Cancelled Store update" } }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await connected.snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked Store callback"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines identical Store IDs and request keys to the actual accepted scope", async () => {
    const other = await prepareLogicalStoreUpdate(driver, close => cleanup.push(close), scoped.rows, { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "store_update_shop_b", projectId: "store_update_shop_b", uuidOffset: 720_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), beforeOther = await other.read(scoped.stores);
    const input = { selector: { id: scoped.stores }, update: { name: "Scoped Store update" } };
    await Effect.runPromise(left.run(key, input)); expect(await other.read(scoped.stores)).toEqual(beforeOther);
    await Effect.runPromise(right.run(key, input)); expect((await other.read(scoped.stores))[0]?.name).toBe("Scoped Store update");
    const settled = await connected.snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input)); expect(await connected.snapshot()).toEqual(settled);
  }, 240_000);

  it.skipIf(driver !== "postgres").each(["update", "delete", "preferences"] as const)("settles safely against a real competing %s root", async kind => {
    const graph = racing[kind], left = await connected.prepare(), right = await connected.prepare();
    const deletion = await connected.prepareDelete(), preferences = await connected.preparePreferences(), reached = Deferred.makeUnsafe<void>();
    const original = StoreModuleService.prototype.updateStores; let finish: (() => void) | undefined, arrivals = 0;
    const update = vi.spyOn(StoreModuleService.prototype, "updateStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      arrivals++; const result = await Reflect.apply(original, this, args);
      if (arrivals === 1) { await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); } return result;
    });
    const remove = vi.spyOn(StoreModuleService.prototype, "softDeleteStores"), price = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    const first = Effect.runPromise(left.run(left.newRequestKey(), { selector: { id: graph.stores }, update: { name: "First serialized Store update" } }));
    let second: Promise<unknown> | undefined;
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      second = kind === "update" ? Effect.runPromise(right.run(right.newRequestKey(), { selector: { id: graph.stores }, update: { name: "Second serialized Store update" } }))
        : kind === "delete" ? Effect.runPromise(deletion.run(deletion.newRequestKey(), { ids: graph.stores }))
        : Effect.runPromise(preferences.run(preferences.newRequestKey(), [{ attribute: "currency_code", value: "USD", is_tax_inclusive: true }]));
      if (connected.fixture.resource.kind !== "postgres") throw new Error("Missing ordinary-role PostgreSQL resource");
      const target = connected.fixture.resource.target;
      await expect.poll(async () => {
        const value = await target.query<{ waiting: boolean }>(`select exists (
          select 1 from pg_stat_activity activity where activity.datname=current_database() and activity.usename=current_user
            and activity.wait_event_type='Lock' and cardinality(pg_blocking_pids(activity.pid))>0
            and position('fx_system_scope_clock' in activity.query)>0
        ) as waiting`); return value.rows[0]?.waiting ?? false;
      }, { timeout: 10_000, interval: 25 }).toBe(true);
      expect(arrivals).toBe(1); if (kind !== "delete") expect(remove).not.toHaveBeenCalled(); expect(price).not.toHaveBeenCalled();
      finish?.(); await first;
      const competitor = await Promise.allSettled([second]);
      if (kind !== "delete") expect(competitor[0]?.status).toBe("fulfilled");
      const stored = await connected.read(graph.stores);
      if (kind === "update") expect(stored[0]?.name).toBe("Second serialized Store update");
      else if (kind === "delete") {
        const outcome = competitor[0];
        if (outcome?.status === "fulfilled") expect(stored[0]?.deleted_at).not.toBeNull();
        else { expect(failures(outcome?.reason)).toContain("writeConflict"); expect(stored[0]).toMatchObject({ name: "First serialized Store update", deleted_at: null }); }
      }
      else expect((await connected.read([connected.preferenceIds.USD]))[0]?.is_tax_inclusive).toBe(true);
    } finally { finish?.(); await Promise.allSettled(second === undefined ? [first] : [first, second]); update.mockRestore(); remove.mockRestore(); price.mockRestore(); }
  }, 180_000);
});
