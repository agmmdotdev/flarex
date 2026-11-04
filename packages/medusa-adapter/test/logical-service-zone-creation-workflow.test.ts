import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { MedusaError } from "@medusajs/utils/common/errors";
import { StepResponse } from "@medusajs/workflows-sdk";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { CoreNativeForeignKeyError } from "../../persistence-postgres/src/core/api";
import { compileCoreNativeEventStorageDefinition } from "../../persistence-postgres/src/commit/events/coreDefinition";
import { compileFulfillmentCreationCoreDefinition, compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareServiceZoneCreationWorkflow } from "../src/workflows/fulfillment/create-service-zones";
import { prepareCoreServiceZoneCreation, maximumServiceZoneCreationInput } from "./support/core-service-zone-creation-fixture";
import { serviceZoneDeletionGraph, serviceZoneParents } from "./support/native-fulfillment-graph-fixture";
import { prepareCoreShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { expectWorkflowDefect, expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";
import { createCoreNativeWorkflowFixture, shareCoreNativeWorkflowPhysical, type CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreServiceZoneCreation>>, sharedCleanupCount = 0;
const rows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject)), text = Schema.decodeUnknownSync(Schema.String);
const simple = (name: string, parent: string = serviceZoneParents.active) => ({ data: [{ name, fulfillment_set_id: parent }] });
const unicodeRoots = serviceZoneDeletionGraph("zone-unicode-roots", { roots: 2, geos: 2, options: 2, rules: 2, historical: true });
const unicodeRootIds = new Map([["zone-unicode-roots-zone-0", "zone-\uE000"], ["zone-unicode-roots-zone-1", "zone-\u{10000}"]]);
unicodeRoots.ids = unicodeRoots.ids.map(id => unicodeRootIds.get(id) ?? id);
unicodeRoots.allIds = unicodeRoots.allIds.map(id => unicodeRootIds.get(id) ?? id);
unicodeRoots.rows = unicodeRoots.rows.map(value => ({ ...value, row: Object.fromEntries(Object.entries(value.row).map(([key, field]) =>
  [key, ["id", "service_zone_id"].includes(key) && typeof field === "string" ? unicodeRootIds.get(field) ?? field : field])) }));
const unicodeOptions = serviceZoneDeletionGraph("zone-unicode-options", { geos: 2, options: 2, rules: 2, historical: true });
const unicodeOptionIds = new Map([["zone-unicode-options-option-0", "option-\uE000"], ["zone-unicode-options-option-1", "option-\u{10000}"]]);
unicodeOptions.optionIds = unicodeOptions.optionIds.map(id => unicodeOptionIds.get(id) ?? id);
unicodeOptions.allIds = unicodeOptions.allIds.map(id => unicodeOptionIds.get(id) ?? id);
unicodeOptions.rows = unicodeOptions.rows.map(value => ({ ...value, row: Object.fromEntries(Object.entries(value.row).map(([key, field]) =>
  [key, ["id", "shipping_option_id"].includes(key) && typeof field === "string" ? unicodeOptionIds.get(field) ?? field : field])) }));
const graph = {
  maximum: serviceZoneDeletionGraph("zone-inverse-max", { roots: 4, geos: 16, options: 8, rules: 16, historical: true }),
  geoOverflow: serviceZoneDeletionGraph("zone-geo-overflow", { geos: 17, historical: true }),
  optionOverflow: serviceZoneDeletionGraph("zone-option-overflow", { options: 9, historical: true }),
  ruleOverflow: serviceZoneDeletionGraph("zone-rule-overflow", { options: 1, rules: 17, historical: true }),
  race: serviceZoneDeletionGraph("zone-option-race"), protected: serviceZoneDeletionGraph("zone-protected", { geos: 1, options: 1, rules: 1 }),
  unicodeRoots, unicodeOptions,
};
function allIds(value: unknown): string[] {
  return rows(value).flatMap(row => [text(row.id), ...rows(row.geo_zones).map(child => text(child.id))]);
}

function expectPhysicalDeletion(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string, ids: readonly string[]) {
  const timestamp = expectCheckoutSettlement(before, after, key);
  const removed = after.revisions.filter(revision => revision.timestamp === timestamp);
  expect(removed).toHaveLength(ids.length);
  for (const id of ids) {
    const original = before.revisions.findLast(revision => revision.value?.id === id);
    if (original === undefined) throw new Error(`Missing original revision for ${id}`);
    expect(removed.find(revision => revision.table === original.table && revision.id === original.id))
      .toMatchObject({ previous: original.timestamp, deleted: true, value: null });
    expect(after.indexes.some(index => index.table === original.table && index.id === original.id)).toBe(false);
  }
}

describe("genuine Service Zone creation on fresh eight-table Core storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreServiceZoneCreation(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => {
    await connected?.closeCaseHosts();
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("creates the complete maximum graph through the native service and replays exactly once", async () => {
    const host = await connected.prepare(), changed = await connected.prepare("e".repeat(64)), value = maximumServiceZoneCreationInput("zone-max");
    const originalInput = structuredClone(value), native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones");
    const provider = vi.spyOn(FulfillmentProviderService.prototype, "getFulfillmentOptions");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ServiceZone maximum root BoundedRequest.enter", calls);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(native).toHaveBeenCalledTimes(1); expect(provider).not.toHaveBeenCalled(); expect(value).toEqual(originalInput);
      expect(output.map(row => row.name)).toEqual(value.data.map(row => row.name));
      for (const [index, row] of output.entries()) {
        expect(row).toMatchObject({ id: expect.stringMatching(/^serzo_/), name: value.data[index]?.name, fulfillment_set_id: serviceZoneParents.active,
          metadata: value.data[index]?.metadata, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null, shipping_options: [] });
        expect(row).not.toHaveProperty("fulfillment_set");
        const children = rows(row.geo_zones); expect(children).toHaveLength(4);
        expect(children.map(child => child.type)).toEqual(["country", "province", "city", "zip"]);
        for (const [childIndex, child] of children.entries()) {
          expect(child).toMatchObject({ ...value.data[index]?.geo_zones?.[childIndex], id: expect.stringMatching(/^fgz_/), service_zone_id: row.id,
            created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
          expect(child).not.toHaveProperty("service_zone");
        }
        expect(children[0]).toMatchObject({ province_code: null, city: null, postal_expression: null, metadata: null });
      }
      expect(new Set(allIds(output)).size).toBe(20);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      const timestamp = expectCheckoutSettlement(before, after, key);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(20);
      expect(emitted).toHaveLength(20); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.map(event => event.envelope.contract)).toEqual(output.flatMap(() => ["fulfillment.service-zone.created",
        ...Array(4).fill("fulfillment.geo-zone.created")]));
      expect(emitted.map(event => event.envelope.message)).toEqual(output.flatMap(row => [row, ...rows(row.geo_zones)]).map(row =>
        expect.objectContaining({ data: { id: row.id } })));
      expect(new Set(emitted.map(event => event.timestamp))).toEqual(new Set([timestamp]));
      expect(await connected.read(allIds(output))).toHaveLength(20);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { data: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); provider.mockRestore(); }
  }, 240_000);

  it("keeps omitted and empty GeoZones distinct inputs while returning native empty relations", async () => {
    const host = await connected.prepare(), value = { data: [simple("zone-empty-omitted").data[0]!, { name: "zone-empty-explicit", fulfillment_set_id: serviceZoneParents.active, geo_zones: [] }] };
    const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), value)));
    expect(output).toHaveLength(2);
    for (const row of output) expect(row).toMatchObject({ metadata: null, geo_zones: [], shipping_options: [] });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones");
    try {
      const before = await connected.snapshot(), createKey = host.newRequestKey();
      expect(await Effect.runPromise(host.run(createKey, { data: [] }))).toEqual([]);
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]);
      const inverse = await connected.prepareAbsentInverse(), inverseKey = inverse.newRequestKey();
      const deletion = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones");
      try {
        expect(await Effect.runPromise(inverse.run(inverseKey, null))).toBeNull();
        expect(deletion).not.toHaveBeenCalled();
        const after = await connected.snapshot();
        expect(after.outcomes.slice(before.outcomes.length)).toMatchObject([
          { value: { key: createKey, kind: "nativeRoot", state: "committed" } },
          { value: { key: inverseKey, kind: "nativeRoot", state: "committed" } },
        ]);
        expect({ ...after, outcomes: before.outcomes }).toEqual(before);
      } finally { deletion.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 180_000);

  it("executes the complete native root plus retained physical inverse within unchanged limits", async () => {
    const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
    if (getter === undefined) throw new Error("Missing genuine SDK retained response getter");
    const retainedIds: unknown[] = [];
    const retained = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
      const value: unknown = Reflect.apply(getter, this, []);
      if (Array.isArray(value)) retainedIds.push(structuredClone(value));
      return value;
    });
    const actualRetained = () => {
      if (retainedIds.length !== 1) throw new Error("Expected one genuine retained Zone cohort");
      return retainedIds[0];
    };
    const deletion = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones");
    try {
      const host = await connected.prepareRoundtrip(actualRetained), value = maximumServiceZoneCreationInput("zone-roundtrip");
      const before = await connected.snapshot(), key = host.newRequestKey(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ServiceZone maximum root plus inverse BoundedRequest.enter", calls);
      expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(output).toHaveLength(4);
      const ids = output.map(row => row.id);
      expect(actualRetained()).toEqual(ids);
      expect(deletion.mock.calls.map(call => call[0])).toEqual([ids]); expect(await connected.read(allIds(output))).toEqual([]);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, key), emitted = after.events.slice(before.events.length);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.service-zone.deleted")).toHaveLength(4);
      expect(emitted.filter(event => event.envelope.contract.endsWith(".deleted"))).toHaveLength(4);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      const tombstones = after.revisions.filter(revision => revision.timestamp === timestamp);
      expect(tombstones).toHaveLength(20);
      expect(new Set(tombstones.map(revision => `${revision.table}/${revision.id}`)).size).toBe(20);
      for (const [name, size] of [["service_zone", 4], ["geo_zone", 16]] as const) {
        const table = connected.definition.tables.find(table => table.localName === name);
        if (table === undefined) throw new Error(`Missing issued ${name} table`);
        expect(tombstones.filter(revision => revision.table === table.name)).toHaveLength(size);
      }
      for (const revision of tombstones) expect(revision).toMatchObject({ previous: null, deleted: true, value: null });
      expect(after.rows).toEqual(before.rows); expect(after.indexes).toEqual(before.indexes);
      expect(await Effect.runPromise(host.run(key, value))).toEqual(output); expect(deletion).toHaveBeenCalledTimes(1);
      expect(await connected.snapshot()).toEqual(after);

      retainedIds.length = 0;
      const failure = new Error("Late native ServiceZone inverse failure"), failing = await connected.prepareRoundtrip(actualRetained, failure);
      const beforeFailure = await connected.fixture.inventory(), failingKey = failing.newRequestKey();
      expectWorkflowDefect(await Effect.runPromiseExit(failing.run(failingKey, maximumServiceZoneCreationInput("zone-inverse-late"))), failure);
      await expectCheckoutRollback(connected.fixture, beforeFailure, failingKey);
    } finally { deletion.mockRestore(); retained.mockRestore(); }
  }, 240_000);

  it("physically removes the complete active and historical Geo/Option/Rule closure with root-only messages", async () => {
    const host = await connected.prepareInverse(), before = await connected.snapshot(), protectedBefore = await connected.read(graph.protected.allIds);
    const key = host.newRequestKey(); let calls = 0;
    expect(await Effect.runPromise(host.run(key, graph.maximum.ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    console.info("ServiceZone complete physical inverse BoundedRequest.enter", calls); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
    expect(await connected.read(graph.maximum.allIds)).toEqual([]); expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
    const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
    expectPhysicalDeletion(before, after, key, graph.maximum.allIds);
    expect(emitted.map(event => event.envelope.contract)).toEqual(graph.maximum.ids.map(() => "fulfillment.service-zone.deleted"));
    expect(emitted.map(event => event.envelope.message)).toEqual(graph.maximum.ids.map(id => expect.objectContaining({ data: { id } })));
    const missingKey = host.newRequestKey(); expect(await Effect.runPromise(host.run(missingKey, ["zone-missing"]))).toBeNull();
    const missing = await connected.snapshot();
    expect(missing.outcomes.slice(after.outcomes.length)).toMatchObject([{ value: { key: missingKey, kind: "nativeRoot", state: "committed" } }]);
    expect({ ...missing, outcomes: after.outcomes }).toEqual(after);
  }, 240_000);

  it.each(["geoOverflow", "optionOverflow", "ruleOverflow"] as const)("refuses %s complete history before any partial physical deletion", async selected => {
    const host = await connected.prepareInverse(), before = await connected.fixture.inventory(), key = host.newRequestKey();
    expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, graph[selected].ids)), "limitExceeded");
    await expectCheckoutRollback(connected.fixture, before, key);
    expect(await connected.read(graph[selected].allIds)).toHaveLength(graph[selected].allIds.length);
  }, 180_000);

  it.each(["unicodeRoots", "unicodeOptions"] as const)("deletes the complete historical %s graph in UTF-8 storage order with root-only events", async selected => {
    const chosen = graph[selected], host = await connected.prepareInverse(), before = await connected.snapshot(), protectedBefore = await connected.read(graph.protected.allIds);
    // The raw root selector keeps caller order; indexed selection and each
    // descendant read use the shared UTF-8 ordering contract.
    const key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, [...chosen.ids].reverse()))).toBeNull();
    expect(await connected.read(chosen.allIds)).toEqual([]); expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
    const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
    expectPhysicalDeletion(before, after, key, chosen.allIds);
    expect(emitted.map(event => event.envelope.contract)).toEqual(chosen.ids.map(() => "fulfillment.service-zone.deleted"));
    expect(emitted.map(event => event.envelope.message)).toEqual(chosen.ids.map(id => expect.objectContaining({ data: { id } })));
  }, 240_000);

  it("retains physical historical-parent acceptance and global active-name uniqueness", async () => {
    const host = await connected.prepare();
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), simple("zone-historical-parent", serviceZoneParents.historical))))).toMatchObject([{ fulfillment_set_id: serviceZoneParents.historical }]);
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), simple("Reusable historical Zone name"))))).toHaveLength(1);
    for (const value of [simple("Reserved global Zone name", serviceZoneParents.other), simple("zone-missing-parent", "missing-parent"),
      { data: [simple("zone-prefix-rollback").data[0]!, simple("Reserved global Zone name").data[0]!] },
      { data: [simple("zone-duplicate-batch").data[0]!, simple("zone-duplicate-batch", serviceZoneParents.other).data[0]!] }]) {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, value)), "invalidInput");
      await expectCheckoutRollback(connected.fixture, before, key);
    }
  }, 240_000);

  it("preserves native GeoZone validation precedence before any graph creation", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones");
    const failures = [
      [{ country_code: "MM" }, "Invalid geo zone type: undefined"],
      [{ type: "unknown", country_code: "MM" }, "Invalid geo zone type: unknown"],
      [{ type: "country", country_code: "" }, "Missing required property country_code for geo zone type country"],
      [{ type: "province", country_code: "MM" }, "Missing required property province_code for geo zone type province"],
      [{ type: "city", country_code: "MM", province_code: "YG" }, "Missing required property city for geo zone type city"],
      [{ type: "zip", country_code: "MM", province_code: "YG", city: "Yangon", postal_expression: null }, "Missing required property postal_expression for geo zone type zip"],
      [{ type: "zip", country_code: "MM", province_code: "YG", city: "Yangon", postal_expression: false }, "Missing required property postal_expression for geo zone type zip"],
    ] as const;
    try {
      for (const [invalid, message] of failures) {
        const before = await connected.fixture.inventory(), key = host.newRequestKey();
        const outcome = await Effect.runPromiseExit(host.run(key, { data: [
          { ...simple("zone-validation-prefix").data[0]!, geo_zones: [{ type: "country", country_code: "Raw" }] },
          { ...simple("zone-validation-failure").data[0]!, geo_zones: [invalid] },
        ] }));
        const failure = expectWorkflowRefusal(outcome, "adapterFailure");
        expect(failure.cause).toBeInstanceOf(MedusaError);
        expect(failure.cause).toMatchObject({ type: MedusaError.Types.INVALID_DATA, message });
        await expectCheckoutRollback(connected.fixture, before, key);
      }
      expect(native).toHaveBeenCalledTimes(failures.length);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("retains native truthy arbitrary postal JSON, casing and the valid empty Zone name", async () => {
    const host = await connected.prepare();
    for (const [index, postal] of [{}, [], " Raw postal ", 123, true].entries()) {
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), { data: [{ name: index === 0 ? "" : "zone-postal-" + index,
        fulfillment_set_id: serviceZoneParents.active, geo_zones: [{ type: "zip", country_code: "Raw-Country", province_code: " Raw Province ",
          city: " Raw City ", postal_expression: postal }] }] })));
      expect(rows(output[0]?.geo_zones)).toMatchObject([{ country_code: "Raw-Country", province_code: " Raw Province ", city: " Raw City ", postal_expression: postal }]);
      if (index === 0) expect(output[0]?.name).toBe("");
    }
  }, 240_000);

  it("refuses managed, supplied identity, relationship and oversized input before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones");
    try {
      const base = simple("zone-invalid").data[0]!;
      for (const invalid of [{ data: Array(5).fill(base) }, { data: [{ ...base, geo_zones: Array(5).fill({ type: "country", country_code: "MM" }) }] },
        ...["id", "created_at", "updated_at", "deleted_at", "fulfillment_set", "shipping_options", "unknown"].map(field => ({ data: [{ ...base, [field]: null }] })),
        ...["id", "created_at", "deleted_at", "service_zone_id", "service_zone", "unknown"].map(field => ({ data: [{ ...base, geo_zones: [{ type: "country", country_code: "MM", [field]: null }] }] })),
        { data: [], unknown: true }]) {
        const before = await connected.fixture.inventory(), key = host.newRequestKey();
        expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, invalid)), "invalidInput");
        await expectCheckoutRollback(connected.fixture, before, key);
      }
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["rootOrder", "childOrder", "scalar", "relation", "missing"] as const)("refuses forged complete native %s output after actual graph creation", async mode => {
    const original = FulfillmentModuleService.prototype.createServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (!Array.isArray(output) || output.length !== 4) throw new Error("Missing genuine four-Zone result");
      if (mode === "rootOrder") output.reverse(); else if (mode === "missing") output.pop();
      else { const first: unknown = output[0]; if (typeof first !== "object" || first === null) throw new Error("Missing genuine Zone result");
        if (mode === "childOrder") {
          const children: unknown = Reflect.get(first, "geo_zones");
          if (!Array.isArray(children) || !Reflect.set(first, "geo_zones", children.toReversed()))
            throw new Error("Could not replace genuine nested GeoZones");
        }
        else Reflect.set(first, mode === "scalar" ? "name" : "shipping_options", mode === "scalar" ? "forged" : [{ id: "uncreated-option" }]); }
      return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowTypedFailures(await Effect.runPromiseExit(host.run(key, maximumServiceZoneCreationInput("zone-forged-" + mode))), "receiptMismatch");
      expect(native).toHaveBeenCalledTimes(1);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["late", "caught"] as const)("rolls back a %s native failure and revokes escaped methods", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.createServiceZones;
    const late = new Error("Late genuine ServiceZone failure");
    let escaped: (() => Promise<unknown>) | undefined, caught: unknown;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw late;
      try { await this.createShippingProfiles({ name: "Denied sibling", type: "default" }, args[1]); } catch (failure) { caught = failure; }
      return output;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, simple("zone-failure-" + mode)));
      if (mode === "late") expectWorkflowDefect(outcome, late);
      else {
        expect(caught).toBeDefined();
        expectWorkflowTypedFailures(outcome, "rollbackOnly");
      }
      await expectCheckoutRollback(connected.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing genuine retained method");
      await expect(escaped()).rejects.toBeDefined();
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels a pending genuine native callback and revokes its escaped capabilities", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createServiceZones;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, simple("zone-cancellation")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome) && Cause.hasInterrupts(outcome.cause)).toBe(true);
      if (escaped === undefined) throw new Error("Missing cancelled native capability");
      await expect(escaped()).rejects.toBeDefined(); finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("rejects copied identities and wrong-sized genuine Fulfillment sources before execution", async () => {
    const before = await connected.snapshot();
    const incomplete = await Effect.runPromise(compileShippingProfileCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID() }));
    const selection = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", incomplete));
    const dual = { ...connected.installed };
    Object.defineProperty(dual, "logicalStorage", { enumerable: true, value: {} });
    for (const fulfillment of [{ ...connected.installed, module: { ...connected.fulfillment.workflow } },
      { ...connected.installed, nativeStorage: { ...connected.nativeStorage } },
      { ...connected.installed, nativeStorage: selection }, dual])
      expectWorkflowTypedFailures(await Effect.runPromiseExit(prepareServiceZoneCreationWorkflow({ ...connected.options, modules: { fulfillment } })), "invalidAuthority");

    const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
    const { definition, eventDefinition } = await Effect.runPromise(Effect.all({
      definition: compileFulfillmentCreationCoreDefinition(target), eventDefinition: compileCoreNativeEventStorageDefinition(target),
    }));
    const wider = await createCoreNativeWorkflowFixture(driver, { eventDefinition,
      physical: await shareCoreNativeWorkflowPhysical(connected.fixture.physical),
      sources: [{ name: "fulfillment", definition, initialCommands: connected.fulfillment.commands, rows: [] }],
    });
    cleanup.push(wider.close);
    const prepare = vi.fn(wider.execution.prepare);
    const result = await Effect.runPromiseExit(prepareServiceZoneCreationWorkflow({ ...connected.options,
      execution: { ...wider.execution, prepare }, modules: { fulfillment: { ...connected.installed, nativeStorage: wider.source("fulfillment") } },
    }));
    if (Exit.isSuccess(result)) await Effect.runPromise(result.value.close);
    expectWorkflowTypedFailures(result, "invalidAuthority");
    expect(prepare).not.toHaveBeenCalled();
    expect(await connected.snapshot()).toEqual(before);
  }, 180_000);

  it("isolates names, parent IDs and request keys across real scopes", async () => {
    const other = await prepareCoreServiceZoneCreation(driver, close => cleanup.push(close), [], connected.fixture.physical);
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = simple("Equal scoped Zone name");
    const first = rows(await Effect.runPromise(left.run(key, input))); expect(await other.read(allIds(first))).toEqual([]);
    const second = rows(await Effect.runPromise(right.run(key, input))); expect(await connected.read(allIds(second))).toEqual([]);
    expect(first[0]?.id).not.toBe(second[0]?.id); const settled = await connected.snapshot();
    expect(await Effect.runPromise(left.run(key, input))).toEqual(first); expect(await Effect.runPromise(right.run(key, input))).toEqual(second);
    expect(await connected.snapshot()).toEqual(settled);
  }, 240_000);

  it("settles one of two overlapping native roots with the same global active name", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createServiceZones;
    const left = await connected.prepare(), right = await connected.prepare(); let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), leftKey = left.newRequestKey(), rightKey = right.newRequestKey();
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, simple("zone-concurrent-global", serviceZoneParents.active)).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, simple("zone-concurrent-global", serviceZoneParents.other)).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(arrivals).toBe(2);
      const [first, second] = outcomes;
      const [winner, loser, winnerKey, loserKey] = Exit.isSuccess(first) ? [first, second, leftKey, rightKey] : [second, first, rightKey, leftKey];
      if (!Exit.isSuccess(winner) || !Exit.isFailure(loser)) throw new Error("Expected exactly one committed same-name Zone");
      expect(expectWorkflowTypedFailures(loser).map(failure => failure.reason)).toEqual(["writeConflict"]);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, winnerKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(1);
      expect(after.events).toHaveLength(before.events.length + 1);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === loserKey))
        .toMatchObject([{ value: { key: loserKey, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("invalidates a physical inverse after an Option reference is concurrently inserted", async () => {
    const host = await connected.prepareInverse(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareCoreShippingProfileOptionRaceFixture({ fixture: connected.fixture,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const original = FulfillmentModuleService.prototype.deleteServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(), insertedKey = insertion.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, graph.race.ids).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertedKey, { id: "zone-race-inserted-option", name: "Concurrent canonical Option", price_type: "flat", data: null, metadata: null,
          service_zone_id: graph.race.ids[0]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider", shipping_option_type_id: "zone-create-type",
          created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z", deleted_at: null }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]);
      expect(await connected.read(graph.race.ids)).toHaveLength(1); expect(await connected.read(["zone-race-inserted-option"])).toHaveLength(1);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, insertedKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(1);
      expect(after.events).toEqual(before.events);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === key))
        .toMatchObject([{ value: { key, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("refuses native child creation when its physical parent is concurrently removed", async () => {
    const host = await connected.prepare(), removal = await connected.prepareParentRemoval();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(), removedKey = removal.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, simple("zone-parent-race-child", serviceZoneParents.race)).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removedKey).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      // Core first observes this FK target during final reference preparation,
      // after the callback. The refreshed graph records genuine absence.
      const failure = expectWorkflowRefusal(outcome, "invalidInput");
      expect(failure.cause).toBeInstanceOf(CoreNativeForeignKeyError);
      expect(failure.cause).toMatchObject({ reason: "targetMissing", sourceFields: ["fulfillment_set_id"], targetFields: ["id"] });
      expect(await connected.read([serviceZoneParents.race])).toEqual([]);
      const after = await connected.snapshot();
      expectPhysicalDeletion(before, after, removedKey, [serviceZoneParents.race]);
      expect(after.events).toEqual(before.events);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === key))
        .toMatchObject([{ value: { key, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
