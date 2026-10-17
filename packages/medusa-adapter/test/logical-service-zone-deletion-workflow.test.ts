import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { CommerceTransactionError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { prepareServiceZoneDeletionWorkflow } from "../src/workflows/fulfillment/delete-service-zones";
import { serviceZoneDeletionResources } from "../src/workflow/policy";
import { prepareLogicalServiceZoneDeletion } from "./support/logical-service-zone-deletion-fixture";
import { serviceZoneDeletionGraph, serviceZoneParents, serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";
import { prepareShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalServiceZoneDeletion>>, sharedCleanupCount = 0;
const map = Schema.decodeUnknownSync(Schema.JsonObject);
const maximum = serviceZoneDeletionGraph("zone-delete-max", { roots: 4, geos: 16, options: 8, rules: 16 });
// Every root participates in both maximum directions. Older child tombstones
// deliberately exercise native re-deletion and subsequent broad restoration.
maximum.rows = maximum.rows.map((value, index) => value.table !== "service_zone" && index % 2 === 0
  ? { ...value, row: { ...value.row, deleted_at: serviceZoneSeedTime } } : value);
const unicode = serviceZoneDeletionGraph("zone-delete-unicode", { roots: 2, geos: 2, options: 2, rules: 2 });
const replacements = new Map([["zone-delete-unicode-zone-0", "delete-zone-\uE000"], ["zone-delete-unicode-zone-1", "delete-zone-\u{10000}"],
  ["zone-delete-unicode-option-0", "delete-option-\uE000"], ["zone-delete-unicode-option-1", "delete-option-\u{10000}"]]);
unicode.ids = unicode.ids.map(id => replacements.get(id) ?? id); unicode.optionIds = unicode.optionIds.map(id => replacements.get(id) ?? id);
unicode.allIds = unicode.allIds.map(id => replacements.get(id) ?? id);
unicode.rows = unicode.rows.map(value => ({ ...value, row: Object.fromEntries(Object.entries(value.row).map(([key, field]) =>
  [key, ["id", "service_zone_id", "shipping_option_id"].includes(key) && typeof field === "string" ? replacements.get(field) ?? field : field])) }));
const mixed = serviceZoneDeletionGraph("zone-delete-mixed", { roots: 2, geos: 2, options: 2, rules: 2, historical: true });
mixed.rows = mixed.rows.map(value => value.table !== "service_zone" ? { ...value, row: { ...value.row, deleted_at: value.row.deleted_at === null ? serviceZoneSeedTime : null } } : value);
const graph = { maximum, mixed, unicode,
  activeRestore: serviceZoneDeletionGraph("zone-delete-active-restore", { geos: 2, options: 1, rules: 2 }),
  inverseLate: serviceZoneDeletionGraph("zone-delete-inverse-late", { geos: 1, options: 1, rules: 1, historical: true }),
  collision: serviceZoneDeletionGraph("zone-delete-collision", { roots: 2, geos: 2, options: 2, rules: 2, historical: true }),
  geoOverflow: serviceZoneDeletionGraph("zone-delete-geo-overflow", { geos: 17 }),
  optionOverflow: serviceZoneDeletionGraph("zone-delete-option-overflow", { options: 9 }),
  ruleOverflow: serviceZoneDeletionGraph("zone-delete-rule-overflow", { options: 1, rules: 17 }),
  failure: serviceZoneDeletionGraph("zone-delete-failure", { geos: 1, options: 1, rules: 1 }),
  cancel: serviceZoneDeletionGraph("zone-delete-cancel", { geos: 1, options: 1, rules: 1 }),
  referenceRace: serviceZoneDeletionGraph("zone-delete-reference-race"),
  restoreRace: serviceZoneDeletionGraph("zone-delete-restore-race", { roots: 2, geos: 2, historical: true }),
  protected: serviceZoneDeletionGraph("zone-delete-protected", { geos: 1, options: 1, rules: 1 }),
};
// Two deleted roots may share a name. Concurrent native restores must settle
// only one global active-name owner, together with that root's child graph.
graph.restoreRace.rows = graph.restoreRace.rows.map(value => value.table === "service_zone"
  ? { ...value, row: { ...value.row, name: "zone-delete-competing-restore-name", deleted_at: serviceZoneSeedTime } } : value);
graph.activeRestore.rows = graph.activeRestore.rows.map((value, index) => value.table !== "service_zone" && index % 2 === 1
  ? { ...value, row: { ...value.row, deleted_at: serviceZoneSeedTime } } : value);
const parentIds = [...Object.values(serviceZoneParents), "zone-create-protected-profile", "zone-create-type", "zone-create-provider"];
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function expectCompleteMap(value: unknown, selected: ReturnType<typeof serviceZoneDeletionGraph>) {
  const result = map(value), families = [["service_zone_id", selected.ids], ["geo_zone_id", selected.geoIds],
    ["shipping_option_id", selected.optionIds], ["shipping_option_rule_id", selected.ruleIds]] as const;
  expect(Object.keys(result)).toEqual(families.filter(([, ids]) => ids.length > 0).map(([key]) => key));
  for (const [key, ids] of families) if (ids.length > 0) {
    const actual = Schema.decodeUnknownSync(Schema.Array(Schema.String))(result[key]);
    expect(actual).toHaveLength(ids.length); expect(new Set(actual)).toEqual(new Set(ids));
  }
  return result;
}

describe("genuine Service Zone soft deletion and raw restore on existing eight-table storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalServiceZoneDeletion(driver, close => cleanup.push(close),
    Object.entries(graph).filter(([name]) => !["geoOverflow", "optionOverflow", "ruleOverflow"].includes(name)).map(([, value]) => value));
    sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes the complete maximum native root and genuine retained inverse in one atomic attempt", async () => {
    const host = await connected.prepareRoundtrip(), nativeDelete = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones"),
      nativeRestore = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones");
    try {
      const before = await connected.snapshot(), parents = await connected.read(parentIds), protectedRows = await connected.read(graph.protected.allIds);
      let calls = 0; const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: graph.maximum.ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ServiceZone deletion complete maximum root plus inverse BoundedRequest.enter", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(defaultCommerceResources.calls); expect(calls).toBeLessThanOrEqual(serviceZoneDeletionResources.calls);
      expect(nativeDelete.mock.calls.map(call => call[0])).toEqual([graph.maximum.ids]); expect(nativeRestore.mock.calls.map(call => call[0])).toEqual([graph.maximum.ids]);
      expectCompleteMap(await nativeDelete.mock.results[0]?.value, graph.maximum); expectCompleteMap(await nativeRestore.mock.results[0]?.value, graph.maximum);
      const current = await connected.read(graph.maximum.allIds); expect(current).toHaveLength(44);
      expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
      expect(await connected.read(parentIds)).toEqual(parents); expect(await connected.read(graph.protected.allIds)).toEqual(protectedRows);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 44);
      expect(emitted).toHaveLength(88); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.map(event => event.envelope.contract)).toEqual(["deleted", "restored"].flatMap(action => [
        ...Array(4).fill("fulfillment.service-zone." + action), ...Array(16).fill("fulfillment.geo-zone." + action),
        ...Array(8).fill("fulfillment.shipping-option." + action), ...Array(16).fill("fulfillment.shipping-option-rule." + action),
      ]));
      const reduced = await connected.prepareRoundtrip({ calls: defaultCommerceResources.calls, eventMessages: serviceZoneDeletionResources.eventMessages });
      await expect(Effect.runPromise(reduced.run(key, { ids: graph.maximum.ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { nativeDelete.mockRestore(); nativeRestore.mockRestore(); }
  }, 240_000);

  it.each(["calls", "events"] as const)("refuses the complete maximum composition under the original 64-%s trusted probe cap", async selected => {
    const limits = selected === "calls"
      ? { calls: defaultCommerceResources.calls, eventMessages: serviceZoneDeletionResources.eventMessages }
      : { calls: serviceZoneDeletionResources.calls, eventMessages: defaultCommerceResources.eventMessages };
    // This test-only trusted composition exercises existing lower resource
    // selections. The public native root always selects its named profile.
    const host = await connected.prepareRoundtrip(limits), before = await connected.snapshot(); let calls = 0;
    const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.maximum.ids }).pipe(
      Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
      Effect.ensuring(Effect.sync(() => console.info("ServiceZone complete maximum lower-cap probe", selected, "BoundedRequest.enter", calls))),
    )));
    expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
    expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it("preserves native root void result, full module maps, event families and exactly-once replay", async () => {
    const host = await connected.prepare(), changed = await connected.prepare("d".repeat(64)), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const value = { ids: [...graph.unicode.ids].reverse() }, before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, value))).toBeNull(); expectCompleteMap(await native.mock.results[0]?.value, graph.unicode);
      expect(native.mock.calls.map(call => call[0])).toEqual([value.ids]); const after = await connected.snapshot();
      expect(after.events.length - before.events.length).toBe(graph.unicode.allIds.length);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
        ...Array(2).fill("fulfillment.service-zone.deleted"), ...Array(2).fill("fulfillment.geo-zone.deleted"),
        ...Array(2).fill("fulfillment.shipping-option.deleted"), ...Array(2).fill("fulfillment.shipping-option-rule.deleted"),
      ]);
      expect(await Effect.runPromise(host.run(key, value))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { ids: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, value))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("skips deleted roots and their active descendants but rewrites history reached through an active root", async () => {
    const host = await connected.prepare(), beforeRows = await connected.read(graph.mixed.allIds), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [...graph.mixed.ids, "missing", graph.mixed.ids[1]!] }))).toBeNull();
      const actual = map(await native.mock.results[0]?.value), active = graph.mixed.ids[1]!;
      expect(actual.service_zone_id).toEqual([active]);
      const afterRows = await connected.read(graph.mixed.allIds), skippedRoot = graph.mixed.ids[0]!;
      const skippedIds = new Set([skippedRoot, graph.mixed.geoIds[0]!, graph.mixed.optionIds[0]!, graph.mixed.ruleIds[0]!]);
      expect(afterRows.filter(row => typeof row.id === "string" && skippedIds.has(row.id))).toEqual(beforeRows.filter(row => typeof row.id === "string" && skippedIds.has(row.id)));
      const reached = afterRows.filter(row => typeof row.id === "string" && !skippedIds.has(row.id)); expect(reached).toHaveLength(4);
      expect(reached.every(row => typeof row.deleted_at === "string" && row.deleted_at !== serviceZoneSeedTime && row.updated_at === row.deleted_at)).toBe(true);
      expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
        "fulfillment.service-zone.deleted", "fulfillment.geo-zone.deleted", "fulfillment.shipping-option.deleted", "fulfillment.shipping-option-rule.deleted",
      ]);
      const inverse = await connected.prepareRestore(), raw = [skippedRoot, active, "missing", skippedRoot];
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { ids: raw }))).toBeNull();
      expect((await connected.read(graph.mixed.allIds)).every(row => row.deleted_at === null)).toBe(true);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("updates already-active restored roots and descendants while reviving older tombstones", async () => {
    const lifecycle = await connected.prepareLifecycle(), before = await connected.snapshot();
    expectCompleteMap(await Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { ids: graph.activeRestore.ids, restore: true })), graph.activeRestore);
    const current = await connected.read(graph.activeRestore.allIds); expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
    expect((await connected.snapshot()).events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
      "fulfillment.service-zone.restored", ...Array(2).fill("fulfillment.geo-zone.restored"), "fulfillment.shipping-option.restored", ...Array(2).fill("fulfillment.shipping-option-rule.restored"),
    ]);
  }, 180_000);

  it("preserves genuine empty/missing module maps and skips absent/empty retained inverses", async () => {
    const host = await connected.prepare(), lifecycle = await connected.prepareLifecycle(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); expect(await native.mock.results[0]?.value).toEqual({});
      for (const restore of [false, true]) for (const ids of [[], ["missing"]])
        expect(await Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { ids, restore }))).toEqual({});
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
      const inverse = await connected.prepareAbsentInverse(), restoration = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones");
      try { expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull(); expect(restoration).not.toHaveBeenCalled(); }
      finally { restoration.mockRestore(); }
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["geoOverflow", "optionOverflow", "ruleOverflow"] as const)("refuses complete %s history before partial lifecycle publication", async selected => {
    // Each deliberate overflow graph gets its own fresh bounded initialization.
    // Combining unrelated scenarios into one source exceeded the initializer's
    // existing 128-identity cap before any workflow could execute.
    const overflow = await prepareLogicalServiceZoneDeletion(driver, close => cleanup.push(close), [graph[selected]], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "service_zone_delete_" + selected.toLowerCase(), projectId: "service_zone_delete_" + selected.toLowerCase(),
        uuidOffset: 860_000 + ["geoOverflow", "optionOverflow", "ruleOverflow"].indexOf(selected) * 10_000 } });
    const host = await overflow.prepare(), before = await overflow.snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph[selected].ids })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("limitExceeded");
    expect(await overflow.snapshot()).toEqual(before);
  }, 180_000);

  it("refuses global active-name restore collision atomically and rolls back a late genuine inverse failure", async () => {
    const creator = await connected.prepareCreation(), target = graph.collision.ids[0]!;
    await Effect.runPromise(creator.run(creator.newRequestKey(), { data: [{ name: target, fulfillment_set_id: serviceZoneParents.other }] }));
    const restore = await connected.prepareRestore(), before = await connected.snapshot();
    const outcome = await Effect.runPromise(Effect.result(restore.run(restore.newRequestKey(), { ids: graph.collision.ids })));
    // Native Drizzle constraints.ts formats its SQL unique-index failure as a
    // plain Error. Shared workingSet.withUniqueValidation owns invalidInput;
    // the checked command preserves that failure inside rollbackOnly.
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
    if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("invalidInput");
    expect(await connected.snapshot()).toEqual(before);
    const late = await connected.prepareRestore(), lateBefore = await connected.snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(late.run(late.newRequestKey(), { ids: graph.inverseLate.ids, fail: true }))))).toBe(true);
    expect(await connected.snapshot()).toEqual(lateBefore);
  }, 240_000);

  it("refuses oversized/unknown input and forged module identities before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const before = await connected.snapshot(); for (const invalid of [{ ids: Array(5).fill("id") }, { ids: [""] }, { ids: [1] }, { ids: [], extra: true }, []])
        // @ts-expect-error Deliberately invalid input crosses the checked host boundary.
        await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareServiceZoneDeletionWorkflow({ ...connected.options,
        modules: { fulfillment: { ...connected.installed, module: { ...connected.fulfillment.workflow } } } }))))).toBe(true);
      await expect(Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...connected.options, modules: {
        fulfillment: { ...connected.installed, logicalResources: defaultCommerceResources },
      } }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      // @ts-expect-error Public root configuration does not admit budget fields.
      await expect(Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...connected.options, requestCallLimit: 256 }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["missingMap", "foreignMap", "late", "caught"] as const)("rolls back %s native failure and revokes retained lifecycle capabilities", async mode => {
    const original = FulfillmentModuleService.prototype.softDeleteServiceZones; let escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native ServiceZone deletion failure");
      if (mode === "caught") { try { await this.deleteServiceZones([...graph.failure.ids]); } catch { /* sticky refusal must survive */ } return output; }
      if (typeof output !== "object" || output === null) throw new Error("Missing genuine ServiceZone lifecycle map");
      if (mode === "missingMap") Reflect.deleteProperty(output, "geo_zone_id"); else Reflect.set(output, "geo_zone_id", ["outside"]); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.failure.ids }))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing retained genuine lifecycle capability");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels a pending native callback without publishing and revokes the escaped method", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.softDeleteServiceZones;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.cancel.ids }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing pending native capability");
      await expect(escaped()).rejects.toBeDefined(); finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("isolates equal root/request identities across real scopes", async () => {
    const other = await prepareLogicalServiceZoneDeletion(driver, close => cleanup.push(close), [graph.protected], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "service_zone_delete_b", projectId: "service_zone_delete_b", uuidOffset: 850_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.protected.ids };
    const beforeOther = await other.read(graph.protected.allIds); expect(await Effect.runPromise(left.run(key, input))).toBeNull();
    expect(await other.read(graph.protected.allIds)).toEqual(beforeOther); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, input))).toBeNull(); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it.skipIf(driver !== "postgres")("invalidates a stale indexed cascade after an Option insertion commits", async () => {
    const host = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareShippingProfileOptionRaceFixture({ fixture: connected.fixture, logicalStorage: connected.installed.logicalStorage,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const original = FulfillmentModuleService.prototype.softDeleteServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.referenceRace.ids }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(insertion.newRequestKey(), { id: "zone-delete-concurrent-option", name: "Concurrent canonical Option", price_type: "flat", data: null, metadata: null,
          service_zone_id: graph.referenceRace.ids[0]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider", shipping_option_type_id: "zone-create-type",
          created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      expect((await connected.read(graph.referenceRace.ids))[0]?.deleted_at).toBeNull(); expect(await connected.read(["zone-delete-concurrent-option"])).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toEqual(before.events);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres")("settles one concurrent native restoration for a shared global active name", async () => {
    const left = await connected.prepareRestore(), right = await connected.prepareRestore(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.restoreServiceZones; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: [graph.restoreRace.ids[0]!] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: [graph.restoreRace.ids[1]!] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      expect((await connected.read(graph.restoreRace.ids)).filter(row => row.deleted_at === null)).toHaveLength(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toHaveLength(before.events.length + 2);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
