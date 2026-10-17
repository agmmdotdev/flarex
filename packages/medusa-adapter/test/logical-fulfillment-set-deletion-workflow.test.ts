import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { StepResponse } from "@medusajs/workflows-sdk";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { Link } from "@medusajs/modules-sdk/link";
import { CommerceTransactionError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { fulfillmentSetDeletionResources } from "../src/workflow/policy";
import { prepareFulfillmentSetDeletionWorkflow } from "../src/workflows/fulfillment/delete-fulfillment-sets";
import { prepareLogicalFulfillmentSetDeletion, fulfillmentSetDeletionGraph } from "./support/logical-fulfillment-set-deletion-fixture";
import { serviceZoneParents, serviceZoneSeedTime } from "./support/logical-service-zone-creation-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = []; let sharedCleanupCount = 0, scopeOrdinal = 0;
let connected: Awaited<ReturnType<typeof prepareLogicalFulfillmentSetDeletion>>;
const graph = {
  maximum: fulfillmentSetDeletionGraph("set-delete-max", { sets: 4, zones: 4, geos: 16, options: 8, rules: 16 }),
  mixed: fulfillmentSetDeletionGraph("set-delete-mixed", { sets: 2, zones: 2, geos: 2, options: 2, rules: 2, history: { sets: 1 } }),
  historical: fulfillmentSetDeletionGraph("set-delete-historical", { geos: 1, history: { sets: 1 } }),
  scalar: fulfillmentSetDeletionGraph("set-delete-scalar", { zones: 0 }),
  failure: fulfillmentSetDeletionGraph("set-delete-failure", { geos: 1 }), cancel: fulfillmentSetDeletionGraph("set-delete-cancel", { geos: 1 }),
  race: fulfillmentSetDeletionGraph("set-delete-race", { zones: 0 }), protected: fulfillmentSetDeletionGraph("set-delete-protected", { geos: 1 }),
};
const map = Schema.decodeUnknownSync(Schema.JsonObject), strings = Schema.decodeUnknownSync(Schema.Array(Schema.String));
const endpoint = (ids: readonly string[]) => ({ fulfillment: { fulfillment_set_id: [...ids] } });
const stable = (value: JsonObject) => { const { updated_at: _updated, deleted_at: _deleted, ...rest } = value; return rest; };
const protectedIds = [...Object.values(serviceZoneParents), "zone-create-protected-profile", "zone-create-type", "zone-create-provider", ...graph.protected.allIds];
const families = (value: ReturnType<typeof fulfillmentSetDeletionGraph>) => [["fulfillment_set", value.ids], ["service_zone", value.zoneIds],
  ["geo_zone", value.geoIds], ["shipping_option", value.optionIds], ["shipping_option_rule", value.ruleIds]] as const;
function completeMap(value: unknown, selected: ReturnType<typeof fulfillmentSetDeletionGraph>) {
  const actual = map(value); expect(Object.keys(actual)).toEqual(families(selected).filter(([, ids]) => ids.length).map(([table]) => table + "_id"));
  for (const [table, ids] of families(selected)) if (ids.length) { const values = strings(actual[table + "_id"]); expect(values).toHaveLength(ids.length); expect(new Set(values)).toEqual(new Set(ids)); }
}
const eventFamilies = (value: ReturnType<typeof fulfillmentSetDeletionGraph>, action: string) => families(value)
  .flatMap(([table, ids]) => ids.map(() => "fulfillment." + table.replaceAll("_", "-") + "." + action));
type Inventory = Awaited<ReturnType<typeof connected.snapshot>>;
function newEvents(before: Inventory, after: Inventory) {
  // Commit sequences are scope-local. New scopes sharing this DB can insert
  // events before older scopes' array tails; retain actual durable order while
  // selecting new rows by the complete immutable event primary key.
  const identity = (event: Inventory["events"][number]) => JSON.stringify([
    event.scopeUuid, event.epochUuid, event.commitSeq.toString(), event.eventOrdinal,
  ]);
  const previous = new Set(before.events.map(identity));
  const added = after.events.filter(event => !previous.has(identity(event)));
  expect(after.events).toHaveLength(before.events.length + added.length);
  return added;
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function retainedTap() {
  const getter = Object.getOwnPropertyDescriptor(StepResponse.prototype, "compensateInput")?.get;
  if (getter === undefined) throw new Error("Missing genuine SDK retained-response getter");
  const values: unknown[] = [];
  const spy = vi.spyOn(StepResponse.prototype, "compensateInput", "get").mockImplementation(function (this: StepResponse<unknown, unknown>) {
    const value: unknown = Reflect.apply(getter, this, []); values.push(structuredClone(value)); return value;
  });
  return { get: () => { if (values.length !== 2) throw new Error("Expected exactly the genuine Set and Link retained values"); return { set: values[0], link: values[1] }; },
    restore: () => spy.mockRestore() };
}
async function scenario(name: string, graphs: readonly ReturnType<typeof fulfillmentSetDeletionGraph>[]) {
  const ordinal = ++scopeOrdinal;
  return prepareLogicalFulfillmentSetDeletion(driver, close => cleanup.push(close), graphs, { resource: connected.fixture.resource,
    fixtureIdentity: { deploymentId: "set-delete-" + name + "-" + ordinal, projectId: "set-delete-134", uuidOffset: 1_500_000 + ordinal * 10_000 } });
}

describe("genuine Fulfillment Set deletion and retained Set/Link inverses", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalFulfillmentSetDeletion(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("accepts the complete 48-row genuine root plus actual retained Link and Set inverse in one settlement", async () => {
    const tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"),
      restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets"), linkDelete = vi.spyOn(Link.prototype, "delete"), linkRestore = vi.spyOn(Link.prototype, "restore");
    try {
      const host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot(), original = await connected.read(graph.maximum.allIds),
        protectedRows = await connected.read(protectedIds), ids = [...graph.maximum.ids].reverse(), key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("FulfillmentSet full 48-row root plus retained inverse BoundedRequest.enter", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(fulfillmentSetDeletionResources.calls);
      expect(tap.get()).toEqual({ set: ids, link: endpoint(ids) }); completeMap(await remove.mock.results[0]?.value, graph.maximum); completeMap(await restore.mock.results[0]?.value, graph.maximum);
      expect(remove.mock.calls.map(value => value[0])).toEqual([ids]); expect(restore.mock.calls.map(value => value[0])).toEqual([ids]);
      expect(linkDelete.mock.calls.map(value => value[0])).toEqual([endpoint(ids)]); expect(linkRestore.mock.calls.map(value => value[0])).toEqual([endpoint(ids)]);
      expect(await linkDelete.mock.results[0]?.value).toEqual([null, {}]); expect(await linkRestore.mock.results[0]?.value).toEqual([null, {}]);
      const order = [remove.mock.invocationCallOrder[0], linkDelete.mock.invocationCallOrder[0], linkRestore.mock.invocationCallOrder[0], restore.mock.invocationCallOrder[0]];
      expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
      const current = await connected.read(graph.maximum.allIds); expect(current).toHaveLength(48); expect(current.map(stable)).toEqual(original.map(stable));
      expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true); expect(await connected.read(protectedIds)).toEqual(protectedRows);
      const after = await connected.snapshot(), emitted = newEvents(before, after);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 48);
      expect(emitted).toHaveLength(96); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(emitted.map(event => event.envelope.contract)).toEqual([...eventFamilies(graph.maximum, "deleted"), ...eventFamilies(graph.maximum, "restored")]);
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      const changed = await connected.prepareRoundtrip(tap.get, fulfillmentSetDeletionResources, false, "e".repeat(64)); await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      const budget = await connected.prepareRoundtrip(tap.get, { calls: fulfillmentSetDeletionResources.calls - 1, eventMessages: fulfillmentSetDeletionResources.eventMessages });
      await expect(Effect.runPromise(budget.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(host.run(key, { ids: [] }))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); linkDelete.mockRestore(); linkRestore.mockRestore(); }
  }, 300_000);

  it("refuses the unchanged complete graph at the default 64-call allowance without publishing", async () => {
    const tap = retainedTap(); let calls = 0;
    try {
      const host = await connected.prepareRoundtrip(tap.get, { calls: defaultCommerceResources.calls, eventMessages: fulfillmentSetDeletionResources.eventMessages }), before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.maximum.ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("FulfillmentSet unchanged full graph default-call refusal BoundedRequest.enter", calls))))));
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
      expect(calls).toBeGreaterThan(defaultCommerceResources.calls); expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 300_000);

  it("refuses the same complete forward/inverse composition at 64 events under named call authority", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, { calls: fulfillmentSetDeletionResources.calls, eventMessages: defaultCommerceResources.eventMessages }), before = await connected.snapshot();
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.maximum.ids })));
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
      expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 300_000);

  it("re-deletes complete historical descendants and restores all 48 rows through the actual retained inverse", async () => {
    const selected = fulfillmentSetDeletionGraph("set-delete-full-history", { sets: 4, zones: 4, geos: 16, options: 8, rules: 16,
      history: { zones: 2, geos: 8, options: 4, rules: 8 } });
    const fixture = await scenario("history", [selected]), tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"),
      restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets");
    try {
      const host = await fixture.prepareRoundtrip(tap.get), before = await fixture.snapshot(), original = await fixture.read(selected.allIds);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: selected.ids }))).toBeNull();
      completeMap(await remove.mock.results[0]?.value, selected); completeMap(await restore.mock.results[0]?.value, selected);
      const current = await fixture.read(selected.allIds); expect(current.map(stable)).toEqual(original.map(stable));
      expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
      const after = await fixture.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 48);
      expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual([...eventFamilies(selected, "deleted"), ...eventFamilies(selected, "restored")]);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); }
  }, 300_000);

  it.each(["empty", "missing"] as const)("retains the real grouped %s Link inverse while preserving native empty Set maps", async mode => {
    const tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"),
      restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets"), linkDelete = vi.spyOn(Link.prototype, "delete"), linkRestore = vi.spyOn(Link.prototype, "restore");
    try {
      const ids = mode === "empty" ? [] : ["set-delete-missing"], host = await connected.prepareRoundtrip(tap.get), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(tap.get()).toEqual({ set: ids, link: endpoint(ids) }); expect(await remove.mock.results[0]?.value).toEqual({});
      expect(restore.mock.calls.map(value => value[0])).toEqual(mode === "empty" ? [] : [ids]);
      if (mode === "missing") expect(await restore.mock.results[0]?.value).toEqual({});
      expect(linkDelete).toHaveBeenCalledExactlyOnceWith(endpoint(ids)); expect(linkRestore).toHaveBeenCalledExactlyOnceWith(endpoint(ids));
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); linkDelete.mockRestore(); linkRestore.mockRestore(); }
  }, 180_000);

  it("keeps direct empty module maps and skips only the native absent Set/Link inverse inputs", async () => {
    const lifecycle = await connected.prepareLifecycle(), before = await connected.snapshot();
    for (const restore of [false, true]) for (const ids of [[], ["set-delete-direct-missing"]])
      expect(await Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { ids, restore }))).toEqual({});
    const inverse = await connected.prepareAbsentInverse(), restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets"), link = vi.spyOn(Link.prototype, "restore");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull(); expect(restore).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    } finally { restore.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("skips children of an already-deleted Set forward but reaches them through the raw retained inverse", async () => {
    const tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"), restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets");
    try {
      const host = await connected.prepareRoundtrip(tap.get), ids = [graph.historical.ids[0]!, "missing-historical", graph.historical.ids[0]!], before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(tap.get()).toEqual({ set: ids, link: endpoint(ids) }); expect(await remove.mock.results[0]?.value).toEqual({}); completeMap(await restore.mock.results[0]?.value, graph.historical);
      expect((await connected.read(graph.historical.allIds)).every(row => row.deleted_at === null)).toBe(true);
      expect(newEvents(before, await connected.snapshot()).map(event => event.envelope.contract)).toEqual(eventFamilies(graph.historical, "restored"));
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); }
  }, 180_000);

  it("retains duplicate/missing request IDs while actual maps distinguish active and historical Set closures", async () => {
    const selected = fulfillmentSetDeletionGraph("set-delete-raw", { sets: 2, zones: 2, geos: 2, options: 2, rules: 2, history: { sets: 1 } }), fixture = await scenario("raw", [selected]);
    const tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"), restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets");
    try {
      const ids = [selected.ids[0]!, "missing-raw", selected.ids[1]!, selected.ids[0]!], host = await fixture.prepareRoundtrip(tap.get), before = await fixture.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull(); expect(tap.get()).toEqual({ set: ids, link: endpoint(ids) });
      const active = { ...selected, ids: [selected.ids[1]!], zoneIds: [selected.zoneIds[1]!], geoIds: [selected.geoIds[1]!], optionIds: [selected.optionIds[1]!], ruleIds: [selected.ruleIds[1]!] };
      completeMap(await remove.mock.results[0]?.value, active); completeMap(await restore.mock.results[0]?.value, selected);
      expect(newEvents(before, await fixture.snapshot()).map(event => event.envelope.contract)).toEqual([...eventFamilies(active, "deleted"), ...eventFamilies(selected, "restored")]);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); }
  }, 180_000);

  it("performs genuine repeated active restoration patches and events across all five models", async () => {
    const selected = fulfillmentSetDeletionGraph("set-delete-active-restore", { geos: 4, options: 2, rules: 4 }), fixture = await scenario("active-restore", [selected]), lifecycle = await fixture.prepareLifecycle();
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await fixture.snapshot(), rows = await fixture.read(selected.allIds);
      completeMap(await Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { ids: selected.ids, restore: true })), selected);
      const after = await fixture.snapshot(), current = await fixture.read(selected.allIds);
      expect(current.map(stable)).toEqual(rows.map(stable)); expect(current.every(row => row.deleted_at === null && row.updated_at !== serviceZoneSeedTime)).toBe(true);
      expect(after.rowChanges).toHaveLength(before.rowChanges.length + 12); expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(eventFamilies(selected, "restored"));
    }
  }, 240_000);

  it("returns scalar-only maps and preserves repeated native deletion and raw restoration behavior", async () => {
    const host = await connected.prepare(), lifecycle = await connected.prepareLifecycle(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.scalar.ids }))).toBeNull();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: graph.scalar.ids }))).toBeNull();
      expect(await remove.mock.results[0]?.value).toEqual({ fulfillment_set_id: graph.scalar.ids }); expect(await remove.mock.results[1]?.value).toEqual({});
      expect(link.mock.calls.map(value => value[0])).toEqual([endpoint(graph.scalar.ids), endpoint(graph.scalar.ids)]);
      for (let attempt = 0; attempt < 2; attempt++) expect(await Effect.runPromise(lifecycle.run(lifecycle.newRequestKey(), { ids: graph.scalar.ids, restore: true }))).toEqual({ fulfillment_set_id: graph.scalar.ids });
      const after = await connected.snapshot(); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 3);
      expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual([
        "fulfillment.fulfillment-set.deleted", "fulfillment.fulfillment-set.restored", "fulfillment.fulfillment-set.restored"]);
    } finally { remove.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("retains Unicode raw request order without claiming unspecified within-family native SQL order", async () => {
    const source = fulfillmentSetDeletionGraph("set-delete-unicode", { sets: 2, zones: 2, geos: 2 }), ids = ["set-delete-\uE000", "set-delete-\u{10000}"],
      replacements = new Map(source.ids.map((id, index) => [id, ids[index]]));
    const selected = { ...source, ids, allIds: [...ids, ...source.zoneIds, ...source.geoIds], rows: source.rows.map(value => {
      if (value.table === "fulfillment_set") {
        const id = typeof value.row.id === "string" ? replacements.get(value.row.id) : undefined; if (id === undefined) throw new Error("Missing Unicode Set identity");
        return { ...value, row: { ...value.row, id } };
      }
      if (value.table === "service_zone") {
        const parent = typeof value.row.fulfillment_set_id === "string" ? replacements.get(value.row.fulfillment_set_id) : undefined;
        if (parent === undefined) throw new Error("Missing Unicode Set FK"); return { ...value, row: { ...value.row, fulfillment_set_id: parent } };
      }
      return value;
    }) }, fixture = await scenario("unicode", [selected]), tap = retainedTap(), remove = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets"), restore = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets");
    try {
      const host = await fixture.prepareRoundtrip(tap.get), raw = [ids[1]!, "set-delete-unicode-missing", ids[0]!, ids[1]!];
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: raw }))).toBeNull(); expect(tap.get()).toEqual({ set: raw, link: endpoint(raw) });
      completeMap(await remove.mock.results[0]?.value, selected); completeMap(await restore.mock.results[0]?.value, selected);
    } finally { tap.restore(); remove.mockRestore(); restore.mockRestore(); }
  }, 180_000);

  it.each(["zones", "geos", "options", "rules"] as const)("refuses complete %s overflow before publishing any partial graph", async family => {
    const selected = fulfillmentSetDeletionGraph("set-delete-overflow-" + family, { zones: family === "zones" ? 5 : 1,
      geos: family === "geos" ? 17 : 0, options: family === "options" ? 9 : family === "rules" ? 1 : 0, rules: family === "rules" ? 17 : 0 });
    const fixture = await scenario("overflow-" + family, [selected]), host = await fixture.prepare(), before = await fixture.snapshot(), link = vi.spyOn(Link.prototype, "delete");
    try {
      const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: selected.ids })));
      expect(Result.isFailure(outcome)).toBe(true); if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("limitExceeded");
      expect(link).not.toHaveBeenCalled(); expect(await fixture.snapshot()).toEqual(before);
    } finally { link.mockRestore(); }
  }, 180_000);

  it.each(["fulfillment_set", "service_zone"] as const)("refuses the native global %s name restore collision atomically", async table => {
    const deleted = fulfillmentSetDeletionGraph("set-delete-collision-deleted-" + table, { geos: 1, history: { sets: 1, zones: 1, geos: 1 } }),
      blocker = fulfillmentSetDeletionGraph("set-delete-collision-blocker-" + table, { zones: table === "service_zone" ? 1 : 0 });
    const name = deleted.rows.find(value => value.table === table)?.row.name;
    if (typeof name !== "string") throw new Error("Missing native name collision preimage");
    const seeded = { ...blocker, rows: blocker.rows.map(value => value.table === table ? { ...value, row: { ...value.row, name } } : value) };
    const fixture = await scenario("collision-" + table, [deleted, seeded]), host = await fixture.prepareLifecycle(), before = await fixture.snapshot();
    const outcome = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: deleted.ids, restore: true })));
    // Native Drizzle formats its unique-index error. The shared working-set
    // owner instead preserves typed invalidInput inside sticky rollbackOnly.
    expect(outcome).toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
    if (Result.isFailure(outcome)) expect(reasons(outcome.failure)).toContain("invalidInput"); expect(await fixture.snapshot()).toEqual(before);
  }, 180_000);

  it("rolls back a late failure after both genuine retained callbacks", async () => {
    const tap = retainedTap();
    try {
      const host = await connected.prepareRoundtrip(tap.get, fulfillmentSetDeletionResources, true), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.failure.ids }))))).toBe(true);
      expect(tap.get()).toEqual({ set: graph.failure.ids, link: endpoint(graph.failure.ids) }); expect(await connected.snapshot()).toEqual(before);
    } finally { tap.restore(); }
  }, 180_000);

  it("refuses malformed input and forged selected resources before native work", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets");
    try {
      const before = await connected.snapshot();
      for (const invalid of [{ ids: Array(5).fill("id") }, { ids: [""] }, { ids: [1] }, { ids: [], extra: true }, []])
        // @ts-expect-error Deliberate invalid input tests the checked public host edge.
        await expect(Effect.runPromise(host.run(host.newRequestKey(), invalid))).rejects.toMatchObject({ reason: "invalidInput" });
      expect(native).not.toHaveBeenCalled();
      // The facade authenticates the source issuer before resource admission.
      await expect(Effect.runPromise(prepareFulfillmentSetDeletionWorkflow({ ...connected.options,
        modules: { fulfillment: { ...connected.installed, module: { ...connected.fulfillment.workflow } } } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
      await expect(Effect.runPromise(prepareFulfillmentSetDeletionWorkflow({ ...connected.options, link: { ...connected.link } }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      // @ts-expect-error The public workflow facade admits no caller resource overrides.
      await expect(Effect.runPromise(prepareFulfillmentSetDeletionWorkflow({ ...connected.options, requestCallLimit: 256 }))).rejects.toMatchObject({ reason: "unsupportedProfile" });
      expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["missingMap", "foreignMap", "late", "caught"] as const)("rolls back %s native failure and revokes the escaped Set capability", async mode => {
    const original = FulfillmentModuleService.prototype.softDeleteFulfillmentSets; let escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native Set deletion failure");
      if (mode === "caught") { try { await this.deleteFulfillmentSets([...graph.failure.ids]); } catch { /* refusal remains owned by the atomic root */ } return output; }
      if (typeof output !== "object" || output === null) throw new Error("Missing genuine Set lifecycle map");
      if (mode === "missingMap") Reflect.deleteProperty(output, "geo_zone_id"); else Reflect.set(output, "geo_zone_id", ["outside"]); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.failure.ids }))))).toBe(true);
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing genuine borrowed Set capability");
      await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["foreignCascade", "extraTupleValue", "late"] as const)("rolls back staged Set deletion when genuine Link.delete returns %s", async mode => {
    const original = Link.prototype.delete, native = vi.spyOn(Link.prototype, "delete").mockImplementation(async function (this: Link, ...args) {
      const output = await Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late genuine Set Link deletion failure");
      if (mode === "foreignCascade") Reflect.set(output, 1, { futureInstalledLink: {} }); else Reflect.set(output, 2, "discarded-extra"); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { ids: graph.failure.ids }))))).toBe(true);
      expect(native).toHaveBeenCalledExactlyOnceWith(endpoint(graph.failure.ids)); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels after native Set staging without publishing and revokes the escaped method", async () => {
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.softDeleteFulfillmentSets;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait; await Effect.runPromise(Deferred.succeed(finished, undefined)); return output;
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.cancel.ids }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(pending); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("Interrupt");
      expect(await connected.snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing pending Set capability");
      await expect(escaped()).rejects.toBeDefined(); finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000))); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("isolates equal Set and request IDs across actual scopes", async () => {
    const other = await scenario("scope", [graph.protected]), left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.protected.ids };
    const otherBefore = await other.read(graph.protected.allIds); expect(await Effect.runPromise(left.run(key, input))).toBeNull();
    expect(await other.read(graph.protected.allIds)).toEqual(otherBefore); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    const after = await connected.snapshot(); expect(await Effect.runPromise(left.run(key, input))).toBeNull(); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    expect(await connected.snapshot()).toEqual(after);
  }, 240_000);

  it.skipIf(driver !== "postgres")("invalidates the complete Set cascade when a new Zone commits under the observed parent", async () => {
    const host = await connected.prepare(), creator = await connected.prepareZoneCreation(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteFulfillmentSets;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteFulfillmentSets").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.race.ids }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* creator.run(creator.newRequestKey(), { data: [{ name: "set-delete-race-new-zone", fulfillment_set_id: graph.race.ids[0]! }] })
          .pipe(Effect.ensuring(Deferred.succeed(release, undefined))); return yield* Fiber.await(pending);
      })));
      expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      expect((await connected.read(graph.race.ids))[0]?.deleted_at).toBeNull();
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual(["fulfillment.service-zone.created"]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);

  it.skipIf(driver !== "postgres").each(["fulfillment_set", "service_zone"] as const)("settles one restoration of a concurrent global %s name", async table => {
    const selected = fulfillmentSetDeletionGraph("set-delete-restore-race-" + table, { sets: 2, zones: 2, geos: 2, history: { sets: 2, zones: 2, geos: 2 } });
    const sharedName = "set-delete-concurrent-name-" + table, seeded = { ...selected, rows: selected.rows.map(value => value.table === table ? { ...value, row: { ...value.row, name: sharedName } } : value) };
    const fixture = await scenario("name-race-" + table, [seeded]), left = await fixture.prepareLifecycle(), right = await fixture.prepareLifecycle(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.restoreFulfillmentSets; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreFulfillmentSets").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const output = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return output;
    });
    try {
      const before = await fixture.snapshot(), outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: [selected.ids[0]!], restore: true }).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: [selected.ids[1]!], restore: true }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined))); return [yield* Fiber.await(first), yield* Fiber.await(second)];
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); expect(outcomes.filter(Exit.isFailure)).toHaveLength(1);
      expect((await fixture.read(selected.ids)).filter(row => row.deleted_at === null)).toHaveLength(1);
      expect((await fixture.read(selected.zoneIds)).filter(row => row.deleted_at === null)).toHaveLength(1); expect((await fixture.read(selected.geoIds)).filter(row => row.deleted_at === null)).toHaveLength(1);
      const after = await fixture.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(newEvents(before, after).map(event => event.envelope.contract)).toEqual([
        "fulfillment.fulfillment-set.restored", "fulfillment.service-zone.restored", "fulfillment.geo-zone.restored"]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 240_000);
});
