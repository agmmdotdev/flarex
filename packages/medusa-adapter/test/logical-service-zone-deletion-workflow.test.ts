import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { StepResponse } from "@medusajs/workflows-sdk";
import { inspectLogicalRelationalFailure } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { prepareServiceZoneDeletionWorkflow } from "../src/workflows/fulfillment/delete-service-zones";
import { serviceZoneDeletionResources } from "../src/workflow/policy";
import { prepareCoreServiceZoneDeletion } from "./support/core-service-zone-deletion-fixture";
import { serviceZoneDeletionGraph, serviceZoneParents, serviceZoneSeedTime } from "./support/native-fulfillment-graph-fixture";
import { prepareCoreShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import { expectWorkflowDefect, expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreServiceZoneDeletion>>, sharedCleanupCount = 0;
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
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
  const ids: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []);
    if (Array.isArray(value)) ids.push(structuredClone(value));
    return value;
  });
  return { get: () => {
    if (ids.length !== 1) throw new Error("Expected the genuine Zone deletion callback payload");
    return ids[0];
  }, restore: () => spy.mockRestore() };
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

describe("genuine Service Zone soft deletion and raw restore on Core Fulfillment storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreServiceZoneDeletion(driver, close => cleanup.push(close),
    Object.entries(graph).filter(([name]) => !["geoOverflow", "optionOverflow", "ruleOverflow"].includes(name)).map(([, value]) => value));
    sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => {
    await connected?.closeCaseHosts();
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("executes the complete maximum native root and genuine retained inverse in one atomic attempt", async () => {
    const retained = retainedTap(), host = await connected.prepareRoundtrip(retained.get), nativeDelete = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones"),
      nativeRestore = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones");
    try {
      const before = await connected.snapshot(), parents = await connected.read(parentIds), protectedRows = await connected.read(graph.protected.allIds);
      let calls = 0; const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: graph.maximum.ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("ServiceZone deletion complete maximum root plus inverse BoundedRequest.enter", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(defaultCommerceResources.calls); expect(calls).toBeLessThanOrEqual(serviceZoneDeletionResources.calls);
      expect(retained.get()).toEqual(graph.maximum.ids);
      expect(nativeDelete.mock.calls.map(call => call[0])).toEqual([graph.maximum.ids]); expect(nativeRestore.mock.calls.map(call => call[0])).toEqual([graph.maximum.ids]);
      expectCompleteMap(await nativeDelete.mock.results[0]?.value, graph.maximum); expectCompleteMap(await nativeRestore.mock.results[0]?.value, graph.maximum);
      const current = await connected.read(graph.maximum.allIds); expect(current).toHaveLength(44);
      expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
      expect(await connected.read(parentIds)).toEqual(parents); expect(await connected.read(graph.protected.allIds)).toEqual(protectedRows);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      const timestamp = expectCheckoutSettlement(before, after, key);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(44);
      expect(emitted).toHaveLength(88); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.map(event => event.envelope.contract)).toEqual(["deleted", "restored"].flatMap(action => [
        ...Array(4).fill("fulfillment.service-zone." + action), ...Array(16).fill("fulfillment.geo-zone." + action),
        ...Array(8).fill("fulfillment.shipping-option." + action), ...Array(16).fill("fulfillment.shipping-option-rule." + action),
      ]));
      expect(await Effect.runPromise(host.run(key, { ids: graph.maximum.ids }))).toBeNull();
      expect(nativeDelete).toHaveBeenCalledTimes(1); expect(nativeRestore).toHaveBeenCalledTimes(1);
      const reduced = await connected.prepareRoundtrip(retained.get, { calls: defaultCommerceResources.calls, eventMessages: serviceZoneDeletionResources.eventMessages });
      await expect(Effect.runPromise(reduced.run(key, { ids: graph.maximum.ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await connected.snapshot()).toEqual(after);
    } finally { nativeDelete.mockRestore(); nativeRestore.mockRestore(); retained.restore(); }
  }, 240_000);

  it.each(["calls", "events"] as const)("refuses the complete maximum composition under the original 64-%s trusted probe cap", async selected => {
    const limits = selected === "calls"
      ? { calls: defaultCommerceResources.calls, eventMessages: serviceZoneDeletionResources.eventMessages }
      : { calls: serviceZoneDeletionResources.calls, eventMessages: defaultCommerceResources.eventMessages };
    // This test-only trusted composition exercises existing lower resource
    // selections. The public native root always selects its named profile.
    const retained = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(retained.get, limits), before = await connected.fixture.inventory(), key = host.newRequestKey(); let calls = 0;
      const outcome = await Effect.runPromiseExit(host.run(key, { ids: graph.maximum.ids }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)) }),
        Effect.ensuring(Effect.sync(() => console.info("ServiceZone complete maximum lower-cap probe", selected, "BoundedRequest.enter", calls))),
      ));
      expectWorkflowTypedFailures(outcome, "limitExceeded");
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { retained.restore(); }
  }, 240_000);

  it("preserves native root void result, full module maps, event families and exactly-once replay", async () => {
    const host = await connected.prepare(), changed = await connected.prepare("d".repeat(64)), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const value = { ids: [...graph.unicode.ids].reverse() }, before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, value))).toBeNull(); expectCompleteMap(await native.mock.results[0]?.value, graph.unicode);
      expect(native.mock.calls.map(call => call[0])).toEqual([value.ids]); const after = await connected.snapshot();
      expectCheckoutSettlement(before, after, key);
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
    const lifecycle = await connected.prepareLifecycle(), before = await connected.snapshot(), key = lifecycle.newRequestKey();
    expectCompleteMap(await Effect.runPromise(lifecycle.run(key, { ids: graph.activeRestore.ids, restore: true })), graph.activeRestore);
    const current = await connected.read(graph.activeRestore.allIds); expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
    const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, key);
    expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(graph.activeRestore.allIds.length);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([
      "fulfillment.service-zone.restored", ...Array(2).fill("fulfillment.geo-zone.restored"), "fulfillment.shipping-option.restored", ...Array(2).fill("fulfillment.shipping-option-rule.restored"),
    ]);
  }, 180_000);

  it("preserves genuine empty/missing module maps and skips absent/empty retained inverses", async () => {
    const host = await connected.prepare(), lifecycle = await connected.prepareLifecycle(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const before = await connected.snapshot(), key = host.newRequestKey(), keys = [key];
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); expect(await native.mock.results[0]?.value).toEqual({});
      for (const restore of [false, true]) for (const ids of [[], ["missing"]]) {
        const lifecycleKey = lifecycle.newRequestKey(); keys.push(lifecycleKey);
        expect(await Effect.runPromise(lifecycle.run(lifecycleKey, { ids, restore }))).toEqual({});
      }
      const inverse = await connected.prepareAbsentInverse(), restoration = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones");
      try {
        const inverseKey = inverse.newRequestKey(); keys.push(inverseKey);
        expect(await Effect.runPromise(inverse.run(inverseKey, null))).toBeNull(); expect(restoration).not.toHaveBeenCalled();
      }
      finally { restoration.mockRestore(); }
      const after = await connected.snapshot();
      expect(after.outcomes.slice(before.outcomes.length)).toMatchObject(keys.map(key => ({ value: { key, kind: "nativeRoot", state: "committed" } })));
      expect({ ...after, outcomes: before.outcomes }).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["geoOverflow", "optionOverflow", "ruleOverflow"] as const)("refuses complete %s history before partial lifecycle publication", async selected => {
    // Each deliberate overflow graph gets its own fresh bounded initialization.
    // Combining unrelated scenarios into one source exceeded the initializer's
    // existing 128-identity cap before any workflow could execute.
    const overflow = await prepareCoreServiceZoneDeletion(driver, close => cleanup.push(close), [graph[selected]], connected.fixture.physical);
    const host = await overflow.prepare(), before = await overflow.fixture.inventory(), key = host.newRequestKey();
    const outcome = await Effect.runPromiseExit(host.run(key, { ids: graph[selected].ids }));
    expectWorkflowTypedFailures(outcome, "limitExceeded");
    await expectCheckoutRollback(overflow.fixture, before, key);
  }, 180_000);

  it("refuses global active-name restore collision atomically and rolls back a late genuine inverse failure", async () => {
    const creator = await connected.prepareCreation(), target = graph.collision.ids[0]!;
    await Effect.runPromise(creator.run(creator.newRequestKey(), { data: [{ name: target, fulfillment_set_id: serviceZoneParents.other }] }));
    const restore = await connected.prepareRestore(), before = await connected.fixture.inventory(), restoreKey = restore.newRequestKey();
    const outcome = await Effect.runPromiseExit(restore.run(restoreKey, { ids: graph.collision.ids }));
    const collision = expectWorkflowRefusal(outcome, "invalidInput");
    expect(inspectLogicalRelationalFailure(collision)).toMatchObject({ kind: "unique", table: { tableId: "service_zone" },
      key: { kind: "nativeUnique", declaration: { kind: "index" } }, columns: ["name"], values: [target] });
    await expectCheckoutRollback(connected.fixture, before, restoreKey);
    const defect = new Error("Late native ServiceZone restoration failure"), late = await connected.prepareRestore(defect);
    const lateBefore = await connected.fixture.inventory(), lateKey = late.newRequestKey();
    expectWorkflowDefect(await Effect.runPromiseExit(late.run(lateKey, { ids: graph.inverseLate.ids })), defect);
    await expectCheckoutRollback(connected.fixture, lateBefore, lateKey);
  }, 240_000);

  it("refuses oversized/unknown input and incomplete or forged source identities before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones");
    try {
      const before = await connected.snapshot(); for (const invalid of [{ ids: Array(5).fill("id") }, { ids: [""] }, { ids: [1] }, { ids: [], extra: true }, []])
        // @ts-expect-error Deliberately invalid input crosses the checked host boundary.
        await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled();
      const incomplete = await Effect.runPromise(compileShippingProfileCoreDefinition({ scopeUuid: randomUUID(), epochUuid: randomUUID() }));
      const incompleteSource = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", incomplete));
      const foreignSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("other", connected.definition));
      for (const fulfillment of [
        { ...connected.installed, module: { ...connected.fulfillment.workflow } },
        { ...connected.installed, nativeStorage: { ...connected.nativeStorage } },
        { ...connected.installed, nativeStorage: incompleteSource },
        { ...connected.installed, nativeStorage: foreignSlot },
      ]) {
        const outcome = await Effect.runPromiseExit(prepareServiceZoneDeletionWorkflow({ ...connected.options, modules: { fulfillment } }));
        expect(expectWorkflowTypedFailures(outcome).map(error => error.reason)).toEqual(["invalidAuthority"]);
      }
      await expect(Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...connected.options, modules: {
        // @ts-expect-error The named facade owns its trusted budget.
        fulfillment: { ...connected.installed, logicalResources: defaultCommerceResources },
      } }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      // @ts-expect-error Public root configuration does not admit budget fields.
      await expect(Effect.runPromise(prepareServiceZoneDeletionWorkflow({ ...connected.options, requestCallLimit: 256 }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["missingMap", "foreignMap", "late", "caught"] as const)("rolls back %s native failure and revokes retained lifecycle capabilities", async mode => {
    const original = FulfillmentModuleService.prototype.softDeleteServiceZones, defect = new Error("Late native ServiceZone deletion failure");
    let escaped: (() => Promise<unknown>) | undefined, caught: unknown;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw defect;
      if (mode === "caught") {
        try { await this.deleteServiceZones([...graph.failure.ids], args[2]); } catch (error) { caught = error; }
        return output;
      }
      if (typeof output !== "object" || output === null) throw new Error("Missing genuine ServiceZone lifecycle map");
      if (mode === "missingMap") Reflect.deleteProperty(output, "geo_zone_id"); else Reflect.set(output, "geo_zone_id", ["outside"]); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromiseExit(host.run(key, { ids: graph.failure.ids }));
      if (mode === "late") expectWorkflowDefect(outcome, defect);
      else if (mode === "caught") expect(caught).toBe(expectWorkflowRefusal(outcome, "unsupportedProfile"));
      else expectWorkflowRefusal(outcome, "receiptMismatch");
      await expectCheckoutRollback(connected.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing retained genuine lifecycle capability");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(connected.fixture, before, key);
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
      const host = await connected.prepare(), before = await connected.fixture.inventory(), key = host.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(key, { ids: graph.cancel.ids }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(Cause.hasInterrupts(outcome.cause)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      if (escaped === undefined) throw new Error("Missing pending native capability");
      await expect(escaped()).rejects.toBeDefined(); finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("isolates equal root/request identities across real scopes", async () => {
    const other = await prepareCoreServiceZoneDeletion(driver, close => cleanup.push(close), [graph.protected], connected.fixture.physical);
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.protected.ids };
    const beforeOther = await other.read(graph.protected.allIds); expect(await Effect.runPromise(left.run(key, input))).toBeNull();
    expect(await other.read(graph.protected.allIds)).toEqual(beforeOther); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, input))).toBeNull(); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it("invalidates a stale indexed cascade after an Option insertion commits", async () => {
    const host = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const insertion = await prepareCoreShippingProfileOptionRaceFixture({ fixture: connected.fixture,
      afterStaged: Effect.void, close: close => cleanup.push(close) });
    const original = FulfillmentModuleService.prototype.softDeleteServiceZones;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), loserKey = host.newRequestKey(), winnerKey = insertion.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(loserKey, { ids: graph.referenceRace.ids }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* insertion.run(winnerKey, { id: "zone-delete-concurrent-option", name: "Concurrent canonical Option", price_type: "flat", data: null, metadata: null,
          service_zone_id: graph.referenceRace.ids[0]!, shipping_profile_id: "zone-create-protected-profile", provider_id: "zone-create-provider", shipping_option_type_id: "zone-create-type",
          created_at: serviceZoneSeedTime, updated_at: serviceZoneSeedTime, deleted_at: null }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(expectWorkflowTypedFailures(outcome).map(error => error.reason)).toEqual(["writeConflict"]);
      expect((await connected.read(graph.referenceRace.ids))[0]?.deleted_at).toBeNull(); expect(await connected.read(["zone-delete-concurrent-option"])).toHaveLength(1);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, winnerKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(1); expect(after.events).toEqual(before.events);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === loserKey))
        .toMatchObject([{ value: { key: loserKey, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it("settles one concurrent native restoration for a shared global active name", async () => {
    const left = await connected.prepareRestore(), right = await connected.prepareRestore(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.restoreServiceZones; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreServiceZones").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); arrivals++; if (arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), leftKey = left.newRequestKey(), rightKey = right.newRequestKey();
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, { ids: [graph.restoreRace.ids[0]!] }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, { ids: [graph.restoreRace.ids[1]!] }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      const [first, second] = outcomes;
      const [winnerKey, loserKey, winnerId, failure] = Exit.isSuccess(first)
        ? [leftKey, rightKey, graph.restoreRace.ids[0], second] : [rightKey, leftKey, graph.restoreRace.ids[1], first];
      expect(expectWorkflowTypedFailures(failure).map(error => error.reason)).toEqual(["writeConflict"]);
      expect((await connected.read(graph.restoreRace.ids)).filter(row => row.deleted_at === null).map(row => row.id)).toEqual([winnerId]);
      const after = await connected.snapshot(), timestamp = expectCheckoutSettlement(before, after, winnerKey);
      expect(after.revisions.filter(revision => revision.timestamp === timestamp)).toHaveLength(2);
      expect(after.events).toHaveLength(before.events.length + 2);
      expect((await connected.fixture.inventory()).outcomes.filter(record => record.value.key === loserKey))
        .toMatchObject([{ value: { key: loserKey, kind: "nativeRoot", state: "failed" } }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
