import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareServiceZoneCreationWorkflow } from "../src/workflows/fulfillment/create-service-zones";
import { prepareLogicalServiceZoneCreation, maximumServiceZoneCreationInput, serviceZoneDeletionGraph,
  serviceZoneParents } from "./support/logical-service-zone-creation-fixture";
import { prepareShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalServiceZoneCreation>>, sharedCleanupCount = 0;
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
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function allIds(value: unknown): string[] {
  return rows(value).flatMap(row => [text(row.id), ...rows(row.geo_zones).map(child => text(child.id))]);
}

describe("genuine Service Zone creation on fresh eight-table shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalServiceZoneCreation(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
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
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 20);
      expect(emitted).toHaveLength(20); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.map(event => event.envelope.contract)).toEqual(output.flatMap(() => ["fulfillment.service-zone.created",
        ...Array(4).fill("fulfillment.geo-zone.created")]));
      expect(emitted.map(event => event.envelope.message)).toEqual(output.flatMap(row => [row, ...rows(row.geo_zones)]).map(row =>
        expect.objectContaining({ data: { id: row.id } })));
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
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
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { data: [] }))).toEqual([]);
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); const after = await connected.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
      expect(after.rowChanges).toEqual(before.rowChanges); expect(after.commits).toHaveLength(before.commits.length + 1);
      const inverse = await connected.prepareAbsentInverse(), deletion = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones");
      try { expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull(); expect(deletion).not.toHaveBeenCalled(); }
      finally { deletion.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 180_000);

  it("executes the complete native root plus retained physical inverse within unchanged limits", async () => {
    const host = await connected.prepareRoundtrip(), deletion = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones");
    try {
      const before = await connected.snapshot(); let calls = 0;
      const output = rows(await Effect.runPromise(host.run(host.newRequestKey(), maximumServiceZoneCreationInput("zone-roundtrip")).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }))));
      console.info("ServiceZone maximum root plus inverse BoundedRequest.enter", calls);
      expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls); expect(output).toHaveLength(4);
      expect(deletion.mock.calls.map(call => call[0])).toEqual([output.map(row => row.id)]); expect(await connected.read(allIds(output))).toEqual([]);
      const emitted = (await connected.snapshot()).events.slice(before.events.length);
      expect(emitted.filter(event => event.envelope.contract === "fulfillment.service-zone.deleted")).toHaveLength(4);
      expect(emitted.filter(event => event.envelope.contract.endsWith(".deleted"))).toHaveLength(4);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
    } finally { deletion.mockRestore(); }
    const failing = await connected.prepareRoundtrip(true), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(failing.run(failing.newRequestKey(), maximumServiceZoneCreationInput("zone-inverse-late")))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("physically removes the complete active and historical Geo/Option/Rule closure with root-only messages", async () => {
    const host = await connected.prepareInverse(), before = await connected.snapshot(), protectedBefore = await connected.read(graph.protected.allIds);
    let calls = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), graph.maximum.ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull();
    console.info("ServiceZone complete physical inverse BoundedRequest.enter", calls); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
    expect(await connected.read(graph.maximum.allIds)).toEqual([]); expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
    const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + graph.maximum.allIds.length);
    expect(emitted.map(event => event.envelope.contract)).toEqual(graph.maximum.ids.map(() => "fulfillment.service-zone.deleted"));
    expect(emitted.map(event => event.envelope.message)).toEqual(graph.maximum.ids.map(id => expect.objectContaining({ data: { id } })));
    const missingBefore = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), ["zone-missing"]))).toBeNull();
    expect((await connected.snapshot()).events).toEqual(missingBefore.events);
  }, 240_000);

  it.each(["geoOverflow", "optionOverflow", "ruleOverflow"] as const)("refuses %s complete history before any partial physical deletion", async selected => {
    const host = await connected.prepareInverse(), before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph[selected].ids))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before); expect(await connected.read(graph[selected].allIds)).toHaveLength(graph[selected].allIds.length);
  }, 180_000);

  it.each(["unicodeRoots", "unicodeOptions"] as const)("deletes the complete historical %s graph in UTF-8 storage order with root-only events", async selected => {
    const chosen = graph[selected], host = await connected.prepareInverse(), before = await connected.snapshot(), protectedBefore = await connected.read(graph.protected.allIds);
    // The raw root selector keeps caller order; indexed selection and each
    // descendant read use the shared UTF-8 ordering contract.
    expect(await Effect.runPromise(host.run(host.newRequestKey(), [...chosen.ids].reverse()))).toBeNull();
    expect(await connected.read(chosen.allIds)).toEqual([]); expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
    const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.rowChanges).toHaveLength(before.rowChanges.length + chosen.allIds.length);
    expect(after.commits).toHaveLength(before.commits.length + 1);
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
      const before = await connected.snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), value))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before);
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
        const before = await connected.snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { data: [
          { ...simple("zone-validation-prefix").data[0]!, geo_zones: [{ type: "country", country_code: "Raw" }] },
          { ...simple("zone-validation-failure").data[0]!, geo_zones: [invalid] },
        ] })));
        expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain(message);
        expect(await connected.snapshot()).toEqual(before);
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
      const base = simple("zone-invalid").data[0]!, before = await connected.snapshot();
      for (const invalid of [{ data: Array(5).fill(base) }, { data: [{ ...base, geo_zones: Array(5).fill({ type: "country", country_code: "MM" }) }] },
        ...["id", "created_at", "updated_at", "deleted_at", "fulfillment_set", "shipping_options", "unknown"].map(field => ({ data: [{ ...base, [field]: null }] })),
        ...["id", "created_at", "deleted_at", "service_zone_id", "service_zone", "unknown"].map(field => ({ data: [{ ...base, geo_zones: [{ type: "country", country_code: "MM", [field]: null }] }] })),
        { data: [], unknown: true }]) await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["rootOrder", "childOrder", "scalar", "relation", "missing"] as const)("refuses forged complete native %s output after actual graph creation", async mode => {
    const original = FulfillmentModuleService.prototype.createServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (!Array.isArray(output) || output.length !== 4) throw new Error("Missing genuine four-Zone result");
      if (mode === "rootOrder") output.reverse(); else if (mode === "missing") output.pop();
      else { const first: unknown = output[0]; if (typeof first !== "object" || first === null) throw new Error("Missing genuine Zone result");
        if (mode === "childOrder") { const children = Reflect.get(first, "geo_zones"); if (!Array.isArray(children)) throw new Error("Missing genuine nested GeoZones"); children.reverse(); }
        else Reflect.set(first, mode === "scalar" ? "name" : "shipping_options", mode === "scalar" ? "forged" : [{ id: "uncreated-option" }]); }
      return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), maximumServiceZoneCreationInput("zone-forged-" + mode)))))).toBe(true);
      expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["late", "caught"] as const)("rolls back a %s native failure and revokes escaped methods", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.createServiceZones;
    let escaped: (() => Promise<unknown>) | undefined, caught = false;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late genuine ServiceZone failure");
      try { await this.createShippingProfiles({ name: "Denied sibling", type: "default" }); } catch { caught = true; } return output;
    });
    try {
      const before = await connected.snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), simple("zone-failure-" + mode)))))).toBe(true);
      expect(caught).toBe(mode === "caught"); expect(await connected.snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing genuine retained method"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
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
      const host = await connected.prepare(), before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), simple("zone-cancellation")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing cancelled native capability");
      await expect(escaped()).rejects.toBeDefined(); finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("rejects a copied module identity and executes an existing Type profile on the same fresh source", async () => {
    const before = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareServiceZoneCreationWorkflow({ ...connected.options,
      modules: { fulfillment: { ...connected.installed, module: { ...connected.fulfillment.workflow } } } }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(before);
    const host = await connected.prepareExistingType(), protectedBefore = await connected.read(graph.protected.allIds);
    expect(rows(await Effect.runPromise(host.run(host.newRequestKey(), { shipping_option_types: [{ id: "zone-co-composed-type", label: "Co-composed", code: "native" }] }))))
      .toMatchObject([{ id: "zone-co-composed-type", label: "Co-composed", shipping_options: [] }]);
    expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
    const profile = await connected.prepareExistingProfile();
    expect(rows(await Effect.runPromise(profile.run(profile.newRequestKey(), { selector: { id: "zone-create-protected-profile" }, update: { metadata: { composed: true } } }))))
      .toMatchObject([{ id: "zone-create-protected-profile", metadata: { composed: true } }]);
    expect(await connected.read(graph.protected.allIds)).toEqual(protectedBefore);
  }, 180_000);

  it("isolates names, parent IDs and request keys across real scopes", async () => {
    const other = await prepareLogicalServiceZoneCreation(driver, close => cleanup.push(close), [], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "service_zone_create_b", projectId: "service_zone_create_b", uuidOffset: 820_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = simple("Equal scoped Zone name");
    const first = rows(await Effect.runPromise(left.run(key, input))); expect(await other.read(allIds(first))).toEqual([]);
    const second = rows(await Effect.runPromise(right.run(key, input))); expect(await connected.read(allIds(second))).toEqual([]);
    expect(first[0]?.id).not.toBe(second[0]?.id); const settled = await connected.snapshot();
    expect(await Effect.runPromise(left.run(key, input))).toEqual(first); expect(await Effect.runPromise(right.run(key, input))).toEqual(second);
    expect(await connected.snapshot()).toEqual(settled);
  }, 240_000);

  it.skipIf(driver !== "postgres")("settles one of two overlapping native roots with the same global active name", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createServiceZones;
    const left = await connected.prepare(), right = await connected.prepare(); let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), simple("zone-concurrent-global", serviceZoneParents.active)).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), simple("zone-concurrent-global", serviceZoneParents.other)).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(after.events).toHaveLength(before.events.length + 1);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("invalidates a physical inverse after an Option reference is concurrently inserted", async () => {
    const host = await connected.prepareInverse(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareShippingProfileOptionRaceFixture({ fixture: connected.fixture, logicalStorage: connected.installed.logicalStorage,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const original = FulfillmentModuleService.prototype.deleteServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "deleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), graph.race.ids).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertion.newRequestKey(), { id: "zone-race-inserted-option", name: "Concurrent canonical Option", price_type: "flat", data: null, metadata: null,
          service_zone_id: graph.race.ids[0]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider", shipping_option_type_id: "zone-create-type",
          created_at: "2026-10-18T00:00:00.000Z", updated_at: "2026-10-18T00:00:00.000Z", deleted_at: null }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      expect(await connected.read(graph.race.ids)).toHaveLength(1); expect(await connected.read(["zone-race-inserted-option"])).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toEqual(before.events);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("refuses native child creation when its physical parent is concurrently removed", async () => {
    const host = await connected.prepare(), removal = await connected.prepareParentRemoval();
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.createServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "createServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), simple("zone-parent-race-child", serviceZoneParents.race)).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* removal.run(removal.newRequestKey()).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      // FK validation first reads this target during working-set close, after
      // the callback. Its absence maps documentInvalid to invalidInput; no
      // previously recorded parent read exists to invalidate as writeConflict.
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("invalidInput");
      expect(await connected.read([serviceZoneParents.race])).toEqual([]);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 1);
      expect(after.events).toEqual(before.events);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
