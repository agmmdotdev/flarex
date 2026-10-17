import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StoreModuleService } from "@medusajs/store/services";
import { PricingModuleService } from "@medusajs/pricing/services";
import { buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeStoreGuardCommands } from "../src/modules/store/service";
import { makeStoreDeletionCommands } from "../src/modules/store/delete-service";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareStoreCreationWorkflow, StoreCreationInput } from "../src/workflows/store/create";
import { storeCreationResources } from "../src/workflow/policy";
import { prepareLogicalStoreCreation } from "./support/logical-store-create-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalStoreCreation>>;
let sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const id = Schema.decodeUnknownSync(Schema.String);
const ids = (values: readonly JsonObject[]) => values.map(row => id(row.id));
const children = (values: readonly JsonObject[], name: "supported_currencies" | "supported_locales") => values.flatMap(row => rows(row[name]));
const allStoreIds = (values: readonly JsonObject[]) => [...ids(values), ...ids(children(values, "supported_currencies")), ...ids(children(values, "supported_locales"))];
const validationCases: Array<readonly [string, typeof StoreCreationInput.Type["stores"][number], string]> = [
  ["duplicate normalized currency first", { supported_currencies: [{ currency_code: "USD", is_default: true }, { currency_code: "usd", is_default: true }] }, "Duplicate currency codes: usd"],
  ["missing default", { supported_currencies: [{ currency_code: "usd" }] }, "There should be a default currency set for the store"],
  ["two defaults", { supported_currencies: [{ currency_code: "usd", is_default: true }, { currency_code: "eur", is_default: true }] }, "Only one default currency is allowed"],
  ["duplicate locale", { supported_currencies: [], supported_locales: [{ locale_code: "en-US" }, { locale_code: "en-US" }] }, "Duplicate locale codes: en-US"],
];
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failures(reason.error)
    : reason._tag === "Die" ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failures(value.cause)];
  return value instanceof Error ? [value.message, ...failures(value.cause)] : [];
}
const eventName = (source: "store" | "pricing", objectName: string, action: "created" | "updated" | "deleted") =>
  buildModuleResourceEventName({ prefix: source, objectName, action });
function eventIds(events: Awaited<ReturnType<typeof connected.snapshot>>["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Store/Pricing event data");
    return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}

describe("genuine Store creation on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalStoreCreation(driver, close => cleanup.push(close));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("keeps the empty Store callback, installed Pricing closure and replay without preference mutations", async () => {
    const host = await connected.prepare(), create = vi.spyOn(StoreModuleService.prototype, "createStores");
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences"), upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { stores: [] }))).toEqual([]);
      expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]?.[0]).toEqual([]);
      expect(await create.mock.results[0]?.value).toEqual([]);
      expect(list).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
      const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(await Effect.runPromise(host.run(key, { stores: [] }))).toEqual([]); expect(await connected.snapshot()).toEqual(after);
      expect(create).toHaveBeenCalledTimes(1);
    } finally { create.mockRestore(); list.mockRestore(); upsert.mockRestore(); }
  }, 120_000);

  it("creates the full four-Store graph plus mixed native preference groups within the named call budget", async () => {
    const host = await connected.prepare(), changedRevision = await connected.prepare("d".repeat(64)), input = connected.maximumInput(), original = structuredClone(input);
    const create = vi.spyOn(StoreModuleService.prototype, "createStores"), upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences");
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const protectedBefore = await connected.read(connected.protectedIds), before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      expect(protectedBefore).toHaveLength(5);
      const output = rows(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Store creation full maximum BoundedRequest.enter", calls))))));
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(storeCreationResources.calls);
      expect(output).toHaveLength(4); expect(new Set(ids(output)).size).toBe(4);
      const currencies = children(output, "supported_currencies"), locales = children(output, "supported_locales");
      expect(currencies).toHaveLength(8); expect(locales).toHaveLength(8);
      expect(new Set(allStoreIds(output)).size).toBe(20);
      for (const [index, row] of output.entries()) {
        expect(row).toMatchObject({ name: "Maximum " + index, metadata: input.stores[index]?.metadata,
          created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
        expect(row.id).toMatch(/^store_/);
        expect(Object.keys(row).sort()).toEqual(["id", "name", "default_sales_channel_id", "default_region_id", "default_location_id", "metadata",
          "created_at", "updated_at", "deleted_at", "supported_currencies", "supported_locales"].sort());
        const childCurrencies = rows(row.supported_currencies), childLocales = rows(row.supported_locales);
        // Native Drizzle's default Store-child relation order is insertion
        // order (no rank/display field). Preserve that native input ordering.
        expect(childCurrencies.map(child => child.currency_code)).toEqual(index % 2 === 0 ? ["usd", "eur"] : ["gbp", "jpy"]);
        expect(childCurrencies.map(child => child.is_default)).toEqual([true, false]);
        expect(childLocales.map(child => child.locale_code)).toEqual(input.stores[index]?.supported_locales?.map(locale => locale.locale_code));
        for (const child of childCurrencies) {
          expect(child).toMatchObject({ store_id: row.id, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
          expect(child.id).toMatch(/^stocur_/);
          expect(Object.keys(child).sort()).toEqual(["id", "store_id", "currency_code", "is_default", "created_at", "updated_at", "deleted_at"].sort());
        }
        for (const child of childLocales) {
          expect(child).toMatchObject({ store_id: row.id, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
          expect(child.id).toMatch(/^stloc_/);
          expect(Object.keys(child).sort()).toEqual(["id", "store_id", "locale_code", "created_at", "updated_at", "deleted_at"].sort());
        }
      }
      expect(output[0]).toMatchObject({ default_sales_channel_id: "protected-channel", default_region_id: "protected-region", default_location_id: "protected-location" });
      expect(input).toEqual(original); expect(create).toHaveBeenCalledTimes(1); expect(await create.mock.results[0]?.value).toEqual(output);
      expect(list.mock.calls[0]?.[0]).toEqual({ $or: [
        { attribute: "currency_code", value: "USD" }, { attribute: "currency_code", value: "eur" },
        { attribute: "currency_code", value: "gbp" }, { attribute: "currency_code", value: "jpy" },
      ] });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert.mock.calls[0]?.[0]).toEqual([
        { id: connected.preferenceIds.USD, attribute: "currency_code", value: "USD", is_tax_inclusive: false },
        { id: undefined, attribute: "currency_code", value: "eur", is_tax_inclusive: undefined },
        { id: connected.preferenceIds.gbp, attribute: "currency_code", value: "gbp", is_tax_inclusive: false },
        { id: undefined, attribute: "currency_code", value: "jpy", is_tax_inclusive: undefined },
      ]);
      const preferenceOutput = rows(await upsert.mock.results[0]?.value);
      expect(preferenceOutput.map(row => row.value)).toEqual(["eur", "jpy", "USD", "gbp"]);
      expect(preferenceOutput.every(row => row.is_tax_inclusive === false)).toBe(true);
      expect(preferenceOutput.slice(0, 2).every(row => id(row.id).startsWith("prpref_"))).toBe(true);
      const stored = await connected.read([...allStoreIds(output), ...ids(preferenceOutput)]);
      expect(stored).toHaveLength(24);
      for (const row of currencies.concat(locales)) expect(stored.find(current => current.id === row.id)).toEqual(row);
      for (const row of preferenceOutput) expect(stored.find(current => current.id === row.id)).toEqual(row);
      for (const row of output) {
        const { supported_currencies: _currencies, supported_locales: _locales, ...scalar } = row;
        expect(stored.find(current => current.id === row.id)).toEqual(scalar);
      }
      expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 24); expect(emitted).toHaveLength(24);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(eventIds(emitted, eventName("store", "store", "created"))).toEqual(ids(output));
      expect(new Set(eventIds(emitted, eventName("store", "store_currency", "created")))).toEqual(new Set(ids(currencies)));
      expect(new Set(eventIds(emitted, eventName("store", "store_locale", "created")))).toEqual(new Set(ids(locales)));
      expect(eventIds(emitted, eventName("pricing", "price_preference", "created"))).toEqual(ids(preferenceOutput.slice(0, 2)));
      expect(eventIds(emitted, eventName("pricing", "price_preference", "updated"))).toEqual(ids(preferenceOutput.slice(2)));
      const changed = new Set(after.rowChanges.slice(before.rowChanges.length).map(row => `${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      const untouched = (values: typeof after.rows) => values.filter(row => !changed.has(`${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
      expect(untouched(after.rows)).toEqual(untouched(before.rows));
      expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { stores: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changedRevision.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(create).toHaveBeenCalledTimes(1); expect(upsert).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      const probes = await connected.prepareProbes(), removeStore = vi.spyOn(StoreModuleService.prototype, "deleteStores");
      try {
        const beforeInverse = await connected.snapshot(); let inverseCalls = 0;
        expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), ids(output)).pipe(Effect.provideService(ExecutionDiagnostics, {
          observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") inverseCalls++; }).pipe(Effect.andThen(work)),
        }), Effect.ensuring(Effect.sync(() => console.info("Store creation full maximum retained physical inverse BoundedRequest.enter", inverseCalls)))))).toBeNull();
        expect(inverseCalls).toBeGreaterThan(0); expect(inverseCalls).toBeLessThanOrEqual(storeCreationResources.calls);
        expect(removeStore).toHaveBeenCalledTimes(1); expect(removeStore.mock.calls[0]?.[0]).toEqual(ids(output));
        expect(await removeStore.mock.results[0]?.value).toBeUndefined();
        expect(await connected.read(allStoreIds(output))).toEqual([]);
        expect(await connected.read(ids(preferenceOutput))).toEqual([...preferenceOutput].sort((left, right) => id(left.id).localeCompare(id(right.id))));
        expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
        const removed = await connected.snapshot(), inverseEvents = removed.events.slice(beforeInverse.events.length),
          inverseFacts = removed.rowChanges.slice(beforeInverse.rowChanges.length);
        expect(removed.commits).toHaveLength(beforeInverse.commits.length + 1);
        expect(removed.outcomes).toHaveLength(beforeInverse.outcomes.length + 1);
        expect(inverseFacts).toHaveLength(20); expect(inverseEvents).toHaveLength(4);
        expect(eventIds(inverseEvents, eventName("store", "store", "deleted")).sort()).toEqual([...ids(output)].sort());
        expect(inverseEvents.every(event => event.envelope.internal && event.envelope.contract === eventName("store", "store", "deleted"))).toBe(true);
        const inverseSequences = new Set(removed.commits.slice(beforeInverse.commits.length).map(commit => commit.commitSeq));
        const inverseRevisions = removed.revisions.filter(row => inverseSequences.has(row.commitSeq));
        expect(inverseRevisions).toHaveLength(20);
        expect(inverseRevisions.every(row => row.isTombstone && row.valueBytes === null && row.valueSha256 === null)).toBe(true);
        const inverseChanged = new Set(inverseFacts.map(row => `${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
        const inverseUntouched = (values: typeof removed.rows) => values.filter(row => !inverseChanged.has(`${row.scopeUuid}:${row.tableId}:${Buffer.from(row.rowId).toString("hex")}`));
        expect(inverseUntouched(removed.rows)).toEqual(inverseUntouched(beforeInverse.rows));
      } finally { removeStore.mockRestore(); }
    } finally { create.mockRestore(); list.mockRestore(); upsert.mockRestore(); }
  }, 240_000);

  it("retains generated Store defaults, empty/omitted child arrays and exact locale case", async () => {
    const host = await connected.prepare();
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { stores: [
      { supported_currencies: [] }, { name: "  ", supported_currencies: [], supported_locales: [] },
      { supported_currencies: [], supported_locales: [{ locale_code: "EN-us" }] },
    ] })));
    expect(output).toHaveLength(3);
    expect(output[0]).toMatchObject({ name: "Medusa Store", metadata: null, default_sales_channel_id: null, default_region_id: null,
      default_location_id: null, supported_currencies: [], supported_locales: [], deleted_at: null });
    expect(output[1]).toMatchObject({ name: "", supported_currencies: [], supported_locales: [] });
    expect(rows(output[2]?.supported_locales).map(row => row.locale_code)).toEqual(["EN-us"]);
    expect(await connected.read(allStoreIds(output))).toHaveLength(4);
  }, 120_000);

  it.each(validationCases)("keeps native %s validation text/order with no committed work", async (_name, selected, message) => {
    const host = await connected.prepare(), before = await connected.snapshot(), list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { stores: [structuredClone(selected)] })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(failures(result.failure)).toContain(message);
      expect(list).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { list.mockRestore(); }
  }, 120_000);

  it("rolls back staged Store/currency writes after native Pricing rejects a falsy raw currency value", async () => {
    const host = await connected.prepare(), before = await connected.snapshot(), create = vi.spyOn(StoreModuleService.prototype, "createStores");
    const list = vi.spyOn(PricingModuleService.prototype, "listPricePreferences");
    try {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { stores: [{ supported_currencies: [{ currency_code: "", is_default: true }] }] })));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(failures(result.failure)).toContain("Attribute and value must be provided when updating price preferences");
      expect(create).toHaveBeenCalledTimes(1); expect(rows(await create.mock.results[0]?.value)).toHaveLength(1);
      expect(list).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { create.mockRestore(); list.mockRestore(); }
  }, 120_000);

  it("refuses malformed and over-limit public inputs before native callbacks without reducing the maximum", async () => {
    const host = await connected.prepare(), before = await connected.snapshot(), create = vi.spyOn(StoreModuleService.prototype, "createStores");
    try {
      for (const input of [
        {}, { stores: "scalar" }, { stores: [], extra: true }, { stores: [{ name: "missing required currency array" }] },
        { stores: Array.from({ length: 5 }, () => ({ supported_currencies: [] })) },
        { stores: [{ supported_currencies: [{ currency_code: "a", is_default: true }, { currency_code: "b" }, { currency_code: "c" }] }] },
        { stores: [{ supported_currencies: [], supported_locales: [{ locale_code: "a" }, { locale_code: "b" }, { locale_code: "c" }] }] },
        { stores: [{ supported_currencies: [{ currency_code: "a", is_default: true }, { currency_code: "b" }] },
          { supported_currencies: [{ currency_code: "c", is_default: true }, { currency_code: "d" }] }, { supported_currencies: [{ currency_code: "e", is_default: true }] }] },
        { stores: [{ supported_currencies: [], created_at: "2020-01-01T00:00:00Z" }] },
      ]) {
        // @ts-expect-error Deliberately malformed public inputs exercise the actual facade.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(create).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { create.mockRestore(); }
  }, 180_000);

  it.each(["reordered", "child-managed", "metadata"] as const)("authenticates %s native Store results before Pricing", async mode => {
    const host = await connected.prepare(), original = StoreModuleService.prototype.createStores;
    const upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences"); let changed = false;
    const forged = vi.spyOn(StoreModuleService.prototype, "createStores").mockImplementation(async function (this: StoreModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), members = rows(result); changed = true;
      if (mode === "reordered") { Reflect.apply(Array.prototype.reverse, result, []); return result; }
      const first = members[0]; if (first === undefined) throw new Error("Missing genuine Store");
      if (mode === "metadata") Reflect.set(first, "metadata", { forged: true });
      else { const child = rows(first.supported_currencies)[0]; if (child === undefined) throw new Error("Missing native currency child"); Reflect.deleteProperty(child, "updated_at"); Reflect.set(first, "supported_currencies", [child]); }
      Reflect.set(result, 0, first); return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { stores: [
        { name: "native-result-a", supported_currencies: [{ currency_code: "sek", is_default: true }] },
        { name: "native-result-b", supported_currencies: [{ currency_code: "nok", is_default: true }] },
      ] })));
      expect(Result.isFailure(result)).toBe(true); expect(changed).toBe(true); expect(upsert).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { forged.mockRestore(); upsert.mockRestore(); }
  }, 180_000);

  it.each(["reordered", "flag", "missing-managed"] as const)("authenticates ignored %s native Pricing results and rolls back both participants", async mode => {
    const host = await connected.prepare(), original = PricingModuleService.prototype.upsertPricePreferences; let changed = false;
    const forged = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), members = rows(result); changed = true;
      if (mode === "reordered") { Reflect.apply(Array.prototype.reverse, result, []); return result; }
      const first = members[0]; if (first === undefined) throw new Error("Missing genuine preference");
      if (mode === "flag") Reflect.set(first, "is_tax_inclusive", !first.is_tax_inclusive); else Reflect.deleteProperty(first, "updated_at");
      Reflect.set(result, 0, first); return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { stores: [{
        supported_currencies: [{ currency_code: "krw", is_default: true }, { currency_code: "sgd" }],
      }] })));
      expect(Result.isFailure(result)).toBe(true); expect(changed).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { forged.mockRestore(); }
  }, 180_000);

  it.each(["flag", "missing-managed"] as const)("authenticates %s native preference preimages before upsert", async mode => {
    const host = await connected.prepare(), original = PricingModuleService.prototype.listPricePreferences;
    const upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences"); let changed = false;
    const forged = vi.spyOn(PricingModuleService.prototype, "listPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), first = result[0];
      if (first === undefined) throw new Error("Missing existing native preference preimage"); changed = true;
      if (mode === "flag") Reflect.set(first, "is_tax_inclusive", false); else Reflect.deleteProperty(first, "updated_at");
      return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        stores: [{ supported_currencies: [{ currency_code: "cad", is_default: true }] }],
      })));
      expect(Result.isFailure(result)).toBe(true); expect(changed).toBe(true); expect(upsert).not.toHaveBeenCalled();
      expect(await connected.snapshot()).toEqual(before);
    } finally { forged.mockRestore(); upsert.mockRestore(); }
  }, 180_000);

  it.each(["forged", "malformed"] as const)("rejects a %s native module event after both participants staged work", async mode => {
    const host = await connected.prepare(), original = PricingModuleService.prototype.upsertPricePreferences;
    const native = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), bus: unknown = Reflect.get(this, "eventBusModuleService_");
      if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native Pricing event bus");
      const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing genuine native emitter");
      await Reflect.apply(emit, bus, [[{ name: eventName("pricing", "price_preference", "created"),
        data: { id: mode === "malformed" ? 42 : "forged-store-preference" },
        metadata: { source: "pricing", object: "price_preference", action: "created" } }], { internal: true }]);
      return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
        stores: [{ supported_currencies: [{ currency_code: "cad", is_default: true, is_tax_inclusive: false }] }],
      })));
      expect(Result.isFailure(result)).toBe(true); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("invokes retained genuine callbacks with complete preimages, native fresh updated_at and physical inverses", async () => {
    const probes = await connected.prepareProbes(), protectedBefore = await connected.read(connected.protectedIds);
    const old = await connected.read([connected.preferenceIds.cad]); expect(old).toHaveLength(1);
    const created = await Effect.runPromise(probes.create.run(probes.create.newRequestKey(), [{ name: "Inverse Store",
      supported_currencies: [{ currency_code: "cad", is_default: true }], supported_locales: [{ locale_code: "en-CA" }] }]));
    const storeOutput = rows(created.output), createdIds = allStoreIds(storeOutput);
    const changed = await Effect.runPromise(probes.preferences.run(probes.preferences.newRequestKey(), [
      { attribute: "currency_code", value: "cad", is_tax_inclusive: false }, { attribute: "currency_code", value: "nzd", is_tax_inclusive: true },
    ]));
    expect(changed.compensation.prevData).toEqual(old); expect(changed.compensation.newDataIds).toHaveLength(1);
    expect(rows(changed.output).map(row => row.value)).toEqual(["nzd", "cad"]);
    const beforeUndo = await connected.snapshot();
    const upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences"), removePreference = vi.spyOn(PricingModuleService.prototype, "deletePricePreferences");
    const removeStore = vi.spyOn(StoreModuleService.prototype, "deleteStores");
    try {
      expect(await Effect.runPromise(probes.undoPricing.run(probes.undoPricing.newRequestKey(), changed.compensation))).toBeNull();
      expect(upsert.mock.calls[0]?.[0]).toEqual(old);
      expect(removePreference.mock.calls[0]?.[0]).toEqual(changed.compensation.newDataIds);
      const restoreOrder = upsert.mock.invocationCallOrder[0], deleteOrder = removePreference.mock.invocationCallOrder[0];
      if (restoreOrder === undefined || deleteOrder === undefined) throw new Error("Missing native Pricing inverse calls");
      expect(restoreOrder).toBeLessThan(deleteOrder);
      const restored = await connected.read([connected.preferenceIds.cad]);
      expect(restored[0]).toEqual({ ...old[0], updated_at: expect.any(String) });
      expect(restored[0]?.updated_at).not.toBe(old[0]?.updated_at);
      expect(await connected.read(changed.compensation.newDataIds)).toEqual([]);
      const afterPricing = await connected.snapshot();
      expect(afterPricing.rowChanges).toHaveLength(beforeUndo.rowChanges.length + 2);
      const undoSequences = new Set(afterPricing.commits.slice(beforeUndo.commits.length).map(commit => commit.commitSeq));
      const removedRevisions = afterPricing.revisions.filter(row => undoSequences.has(row.commitSeq) && row.isTombstone);
      expect(removedRevisions).toHaveLength(1); expect(removedRevisions[0]).toMatchObject({ valueBytes: null, valueSha256: null });
      expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), created.compensation))).toBeNull();
      expect(removeStore.mock.calls[0]?.[0]).toEqual(created.compensation);
      expect(await removeStore.mock.results[0]?.value).toBeUndefined();
      expect(await connected.read(createdIds)).toEqual([]);
      const afterStore = await connected.snapshot(), emitted = afterStore.events.slice(afterPricing.events.length);
      expect(afterStore.rowChanges).toHaveLength(afterPricing.rowChanges.length + 3);
      expect(eventIds(emitted, eventName("store", "store", "deleted"))).toEqual(ids(storeOutput));
      expect(emitted).toHaveLength(1); // Native physical Store inverse announces roots only.
      expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      upsert.mockClear(); removePreference.mockClear(); removeStore.mockClear();
      expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), []))).toBeNull();
      expect(removeStore).not.toHaveBeenCalled();
      expect(await Effect.runPromise(probes.undoPricing.run(probes.undoPricing.newRequestKey(), { prevData: [], newDataIds: [] }))).toBeNull();
      expect(upsert.mock.calls[0]?.[0]).toEqual([]); expect(removePreference.mock.calls[0]?.[0]).toEqual([]);
    } finally { upsert.mockRestore(); removePreference.mockRestore(); removeStore.mockRestore(); }
  }, 240_000);

  it.each(["pricing", "store"] as const)("rolls back the complete root after the genuine %s inverse has completed", async mode => {
    const probes = await connected.prepareProbes(mode), prior = await connected.read([connected.preferenceIds.cad]);
    const priorFlag = prior[0]?.is_tax_inclusive;
    if (typeof priorFlag !== "boolean") throw new Error("Missing complete native preference preimage");
    const created = await Effect.runPromise(probes.create.run(probes.create.newRequestKey(), [{ name: "Late inverse " + mode,
      supported_currencies: [{ currency_code: "cad", is_default: true }], supported_locales: [{ locale_code: "en-CA" }] }]));
    const changed = await Effect.runPromise(probes.preferences.run(probes.preferences.newRequestKey(), [
      { attribute: "currency_code", value: "cad", is_tax_inclusive: !priorFlag },
      { attribute: "currency_code", value: "late-inverse-" + mode, is_tax_inclusive: true },
    ]));
    expect(changed.compensation.prevData).toEqual(prior); expect(changed.compensation.newDataIds).toHaveLength(1);
    const upsert = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences"), removePreference = vi.spyOn(PricingModuleService.prototype, "deletePricePreferences"),
      removeStore = vi.spyOn(StoreModuleService.prototype, "deleteStores");
    try {
      const before = await connected.snapshot();
      const result = mode === "pricing"
        ? await Effect.runPromise(Effect.result(probes.undoPricing.run(probes.undoPricing.newRequestKey(), changed.compensation)))
        : await Effect.runPromise(Effect.result(probes.undo.run(probes.undo.newRequestKey(), created.compensation)));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(failures(result.failure)).toContain(mode === "pricing"
        ? "Late probe failure after genuine Pricing inverse" : "Late probe failure after genuine Store physical inverse");
      if (mode === "pricing") {
        expect(upsert).toHaveBeenCalledTimes(1); expect(removePreference).toHaveBeenCalledTimes(1); expect(removeStore).not.toHaveBeenCalled();
        expect(upsert.mock.calls[0]?.[0]).toEqual(prior);
        expect(removePreference.mock.calls[0]?.[0]).toEqual(changed.compensation.newDataIds);
        expect(rows(await upsert.mock.results[0]?.value)).toEqual([{ ...prior[0], updated_at: expect.any(String) }]);
        expect(await removePreference.mock.results[0]?.value).toBeUndefined();
        const restoredAt = upsert.mock.invocationCallOrder[0], deletedAt = removePreference.mock.invocationCallOrder[0];
        if (restoredAt === undefined || deletedAt === undefined) throw new Error("Missing completed native Pricing inverse calls");
        expect(restoredAt).toBeLessThan(deletedAt);
      } else {
        expect(removeStore).toHaveBeenCalledTimes(1); expect(upsert).not.toHaveBeenCalled(); expect(removePreference).not.toHaveBeenCalled();
        expect(removeStore.mock.calls[0]?.[0]).toEqual(created.compensation); expect(await removeStore.mock.results[0]?.value).toBeUndefined();
      }
      expect(await connected.snapshot()).toEqual(before);
    } finally { upsert.mockRestore(); removePreference.mockRestore(); removeStore.mockRestore(); }
  }, 240_000);

  it("directly invokes genuine deleteStores with empty IDs while the retained inverse skips them", async () => {
    const probes = await connected.prepareProbes(), direct = await probes.prepareDirectDelete();
    const removeStore = vi.spyOn(StoreModuleService.prototype, "deleteStores");
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(direct.run(direct.newRequestKey(), []))).toBeNull();
      expect(removeStore).toHaveBeenCalledTimes(1); expect(removeStore.mock.calls[0]?.[0]).toEqual([]);
      expect(await removeStore.mock.results[0]?.value).toBeUndefined();
      const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions);
      expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      expect(after.indexEntries).toEqual(before.indexEntries); expect(after.uniqueKeys).toEqual(before.uniqueKeys);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), []))).toBeNull();
      expect(removeStore).toHaveBeenCalledTimes(1);
    } finally { removeStore.mockRestore(); }
  }, 180_000);

  it.each(["late", "caught"] as const)("rolls back both participants after %s native Pricing failure and revokes escaped methods", async mode => {
    const host = await connected.prepare(), original = PricingModuleService.prototype.upsertPricePreferences;
    let escaped: (() => Promise<unknown>) | undefined, caught = false;
    const native = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late genuine Store preference failure");
      try { await this.createPriceSets([{ prices: [] }]); } catch { caught = true; }
      return result;
    });
    try {
      const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { stores: [{
        supported_currencies: [{ currency_code: "cad", is_default: true, is_tax_inclusive: false }, { currency_code: "nok", is_tax_inclusive: true }],
        supported_locales: [{ locale_code: "en-US" }],
      }] })));
      expect(Result.isFailure(result)).toBe(true); expect(caught).toBe(mode === "caught"); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing escaped genuine Pricing method");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("revokes a genuine native Pricing method retained after a successful root", async () => {
    const host = await connected.prepare(), original = PricingModuleService.prototype.upsertPricePreferences;
    let escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args); return result;
    });
    try {
      const output = await Effect.runPromise(host.run(host.newRequestKey(), { stores: [{ supported_currencies: [{ currency_code: "mxn", is_default: true }] }] }));
      expect(rows(output)).toHaveLength(1); const settled = await connected.snapshot();
      if (escaped === undefined) throw new Error("Missing retained native Pricing method");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(settled);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rejects authentic guard/deletion Store profiles and Product Pricing creation as Store-creation authorities", async () => {
    const guard = await Effect.runPromise(makeStoreGuardCommands()), deletion = await Effect.runPromise(makeStoreDeletionCommands());
    const pricing = await Effect.runPromise(makeLocalPricingCommands("create")), before = await connected.snapshot();
    for (const module of [guard.workflow, deletion.workflow]) {
      const invalid = await Effect.runPromise(Effect.result(prepareStoreCreationWorkflow({ ...connected.options, modules: {
        ...connected.options.modules,
        // @ts-expect-error Authentic other Store profiles intentionally have different methods.
        store: { ...connected.options.modules.store, module },
      } })));
      expect(invalid).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    }
    const invalidPricing = await Effect.runPromise(Effect.result(prepareStoreCreationWorkflow({ ...connected.options, modules: {
      ...connected.options.modules, pricing: { ...connected.options.modules.pricing, module: pricing.workflow },
    } })));
    expect(invalidPricing).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(await connected.snapshot()).toEqual(before);
  });

  it("isolates equal raw preference keys, protected seed IDs and request keys in another real scope", async () => {
    const other = await prepareLogicalStoreCreation(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "store_create_shop_b", projectId: "store_create_shop_b", uuidOffset: 220_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const beforeOther = await other.read([other.preferenceIds.USD, ...other.protectedIds]);
    const input = { stores: [{ name: "Scoped Store", supported_currencies: [{ currency_code: "USD", is_default: true, is_tax_inclusive: false }] }] };
    const leftOutput = rows(await Effect.runPromise(left.run(key, input)));
    expect(await other.read([other.preferenceIds.USD, ...other.protectedIds])).toEqual(beforeOther);
    expect(await other.read(allStoreIds(leftOutput))).toEqual([]);
    const rightOutput = rows(await Effect.runPromise(right.run(key, input)));
    expect(new Set(ids(leftOutput))).not.toEqual(new Set(ids(rightOutput)));
    expect(await connected.read(allStoreIds(rightOutput))).toEqual([]);
    const settled = await connected.snapshot();
    expect(await Effect.runPromise(left.run(key, input))).toEqual(leftOutput);
    expect(await Effect.runPromise(right.run(key, input))).toEqual(rightOutput);
    expect(await connected.snapshot()).toEqual(settled);
  }, 240_000);

  it.skipIf(driver !== "postgres").each(["existing", "new"] as const)("settles one of two native roots targeting the same %s preference pair", async mode => {
    const left = await connected.prepare(), right = await connected.prepare(), value = mode === "existing" ? "CHF" : "AUD";
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.upsertPricePreferences;
    let arrived = 0;
    const native = vi.spyOn(PricingModuleService.prototype, "upsertPricePreferences").mockImplementation(async function (this: PricingModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); arrived++;
      if (arrived === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot();
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { stores: [{ name: "Competing first", supported_currencies: [{ currency_code: value, is_default: true, is_tax_inclusive: false }] }] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { stores: [{ name: "Competing second", supported_currencies: [{ currency_code: value, is_default: true, is_tax_inclusive: false }] }] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      const successes = outcomes.filter(Exit.isSuccess), rejected = outcomes.filter(Exit.isFailure);
      console.info("Competing native Store preference outcomes", mode, outcomes.map(outcome => Exit.isSuccess(outcome)
        ? { success: outcome.value } : { failures: failures(outcome.cause) }));
      expect(arrived).toBe(2); expect(successes).toHaveLength(1); expect(rejected).toHaveLength(1);
      expect(failures(rejected[0]?.cause)).toContain("writeConflict");
      const winner = rows(successes[0]?.value); expect(winner).toHaveLength(1);
      expect(await connected.read(allStoreIds(winner))).toHaveLength(2);
      const after = await connected.snapshot();
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.outcomes).toHaveLength(before.outcomes.length + 1);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3); expect(after.events).toHaveLength(before.events.length + 3);
      const nativeResults = await Promise.all(native.mock.results.map(result => result.value));
      const writtenPreferenceIds = nativeResults.flatMap(result => ids(rows(result)));
      const committed = await connected.read(writtenPreferenceIds);
      expect(committed).toHaveLength(1); expect(committed[0]).toMatchObject({ attribute: "currency_code", value, is_tax_inclusive: false });
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 120_000);
});
