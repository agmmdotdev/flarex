import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { PriceListUpdateWorkflowInput } from "../src/modules/pricing/list-update-input";
import { prepareUpdatePriceListsWorkflow } from "../src/workflows/pricing/update-price-lists";
import { prepareLogicalPriceListUpdate } from "./support/logical-price-list-update-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListUpdate>>;
type Input = typeof PriceListUpdateWorkflowInput.Type;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
const objects = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
const text = Schema.decodeUnknownSync(Schema.String);
const ids = (rows: readonly JsonObject[]) => rows.map(row => text(row.id));
const children = (root: JsonObject) => objects(root.price_list_rules);
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const sameBodyRevision = (before: Snapshot, after: Snapshot) => {
  expect(after.rows.map(({ commitSeq: _, ...identity }) => identity)).toEqual(before.rows.map(({ commitSeq: _, ...identity }) => identity));
  const added = after.revisions.filter(row => !before.revisions.some(previous => previous.scopeUuid === row.scopeUuid && previous.tableId === row.tableId &&
    Buffer.from(previous.rowId).equals(Buffer.from(row.rowId)) && previous.commitSeq === row.commitSeq));
  expect(added).toHaveLength(1);
  const current = added[0]; if (!current) throw new Error("Missing genuine native no-op revision");
  const previous = before.revisions.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId &&
    Buffer.from(row.rowId).equals(Buffer.from(current.rowId)) && row.commitSeq === current.prevCommitSeq);
  if (!previous) throw new Error("Missing linked native no-op preimage revision");
  expect(current.commitSeq).toBeGreaterThan(previous.commitSeq); expect(current.isTombstone).toBe(false);
  for (const field of ["valueBytes", "valueSha256", "creationTime", "insertionCommitSeq", "insertionAttemptOrdinal"] as const) expect(current[field], field).toEqual(previous[field]);
  expect(after.rows.find(row => row.scopeUuid === current.scopeUuid && row.tableId === current.tableId && Buffer.from(row.rowId).equals(Buffer.from(current.rowId)))?.commitSeq).toBe(current.commitSeq);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing genuine Pricing event data");
  return Schema.decodeUnknownSync(Schema.Array(Schema.String))(Array.isArray(message.data.id) ? message.data.id : [message.data.id])
    .map(id => [event.envelope.contract, id]);
});
const run = async (input: Input) => { const host = await connected.prepare(); return Effect.runPromise(host.run(host.newRequestKey(), input)); };
const single = (title: string, index = 0): Input => ({ price_lists_data: [{ id: connected.targetIds[index]!, title }] });
const maximum = (suffix: string, reverse = false): Input => ({ price_lists_data: (reverse ? [...connected.targetIds].reverse() : connected.targetIds).map((id, index) => ({
  id, title: "complete153-" + suffix + index, description: "Description153-" + suffix + index, status: "active" as const,
  starts_at: "2026-03-01T10:15:00+06:30", ends_at: "2035-01-01",
  rules: { region_id: ["new153-" + index, "shared153"], customer_group_id: ["vip153", "retail153"] },
})) });
const activeRules = async (roots: readonly string[]) => (await connected.readRows()).filter(item => item.table === "price_list_rule" &&
  typeof item.row.price_list_id === "string" && roots.includes(item.row.price_list_id) && item.row.deleted_at === null).map(item => item.row);
const controls = async () => (await connected.readRows()).filter(item => !["price_list", "price_list_rule"].includes(item.table));

describe(`genuine native Price List update - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalPriceListUpdate(driver, close => cleanup.push(close)); }, 240_000);
  afterEach(async () => { await connected.closeCaseHosts(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 180_000);

  it("resolves both empty native steps without Pricing calls and stores the original void result as null", async () => {
    const before = await connected.snapshot(), list = vi.spyOn(PricingModuleService.prototype, "listPriceLists"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    try {
      const host = await connected.prepare(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { price_lists_data: [] }))).toBeNull();
      expect(await Effect.runPromise(host.run(key, { price_lists_data: [] }))).toBeNull();
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), null))).toBeNull();
      expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    } finally { list.mockRestore(); update.mockRestore(); }
  });

  it("emits the native updated action for ID-only and equal updates while preserving every root stamp", async () => {
    const id = connected.targetIds[0]!, original = await connected.read([id]), before = await connected.snapshot();
    expect(await run({ price_lists_data: [{ id }] })).toBeNull();
    let after = await connected.snapshot(); expect(await connected.read([id])).toEqual(original);
    sameBodyRevision(before, after);
    expect(eventVector(eventsSince(before, after))).toEqual([["pricing.price-list.updated", id]]);
    const root = original[0]; if (!root || typeof root.title !== "string") throw new Error("Missing complete comparison root");
    const next = after; expect(await run({ price_lists_data: [{ id, title: root.title }] })).toBeNull(); after = await connected.snapshot();
    expect(await connected.read([id])).toEqual(original); sameBodyRevision(next, after);
    expect(eventVector(eventsSince(next, after))).toEqual([["pricing.price-list.updated", id]]);
  });

  it("keeps the two genuine reads, sparse DTO and actual selected preimage for a scalar update", async () => {
    const id = connected.targetIds[0]!, old = (await connected.read([id]))[0], forward = await connected.prepareForward();
    const list = vi.spyOn(PricingModuleService.prototype, "listPriceLists"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    try {
      const result = await Effect.runPromise(forward.run(forward.newRequestKey(), single("sparse153")));
      expect(result.output).toEqual([{ id, title: "sparse153" }]);
      expect(result.compensation).toEqual({ dataBeforeUpdate: [{ id, title: old?.title }], selects: ["id", "title"], relations: [] });
      expect(list).toHaveBeenCalledTimes(2); expect(update).toHaveBeenCalledTimes(1);
      expect(list.mock.calls[0]?.[0]).toEqual({ id: [id] });
      expect(list.mock.calls[1]?.[1]).toMatchObject({ select: ["id", "title"], relations: [] });
      expect((await connected.read([id]))[0]).toEqual({ ...old, title: "sparse153" });
      const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
      expect(await connected.read([id])).toEqual([old]);
    } finally { list.mockRestore(); update.mockRestore(); }
  });

  it("updates the maximum graph with sparse DTOs, native events and one publication under existing limits", async () => {
    const input = maximum("forward"), before = await connected.snapshot(), old = await connected.read(connected.targetIds);
    const oldRules = await activeRules(connected.targetIds), oldOrder = await connected.readStorageOrder(ids(oldRules));
    const protectedBefore = await connected.read(connected.protectedIds), untouched = await controls(), forward = await connected.prepareForward();
    let calls = 0;
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })));
    const output = result.output; if (!output) throw new Error("Missing genuine maximum update DTOs");
    expect(ids(output)).toEqual(input.price_lists_data.map(row => row.id));
    for (const [index, row] of output.entries()) {
      expect(Object.keys(row).sort()).toEqual(["id", "title", "description", "status", "starts_at", "ends_at", "rules_count", "price_list_rules"].sort());
      expect(row).toMatchObject({ title: input.price_lists_data[index]?.title, status: "active", starts_at: "2026-03-01T03:45:00.000Z", ends_at: "2035-01-01T00:00:00.000Z", rules_count: 2 });
      expect(children(row).map(rule => [rule.attribute, rule.value])).toEqual([["region_id", ["new153-" + index, "shared153"]], ["customer_group_id", ["vip153", "retail153"]]]);
      for (const child of children(row)) { expect(Object.keys(child).sort()).toEqual(["id", "attribute", "value", "price_list_id"].sort()); expect(child.price_list_id).toBe(row.id); }
    }
    const after = await connected.snapshot(), emitted = eventsSince(before, after);
    expect(emitted).toHaveLength(20); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
    expect(eventVector(emitted)).toEqual([
      ...output.flatMap(row => ids(children(row))).map(id => ["pricing.price-list-rule.created", id]),
      ...ids(output).map(id => ["pricing.price-list.updated", id]), ...oldOrder.map(id => ["pricing.price-list-rule.deleted", id]),
    ]);
    const stored = await connected.read(connected.targetIds);
    stored.forEach(row => { const previous = old.find(before => before.id === row.id); expect(row.created_at).toBe(previous?.created_at); expect(row.updated_at).toBe(previous?.updated_at); });
    expect(await controls()).toEqual(untouched); expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Price List update maximum", { calls, events: emitted.length });
  });

  it("runs the actual two-step native maximum root within existing calls and events and retains its void result", async () => {
    const input = maximum("actual-root"), host = await connected.prepare(), key = host.newRequestKey();
    const before = await connected.snapshot(), oldRoots = await connected.read(connected.targetIds), oldRules = await activeRules(connected.targetIds);
    const untouched = await controls(), attached = await connected.readRows(connected.selectedPricingIds);
    expect(attached).toHaveLength(5);
    const listPrice = attached.find(item => item.table === "price" && item.row.price_list_id === connected.targetIds[0]);
    if (!listPrice) throw new Error("Missing Price genuinely attached to the updated root");
    expect(attached.filter(item => item.table === "price_rule" && item.row.price_id === listPrice.row.id)).toHaveLength(2);
    expect(attached.filter(item => item.table === "price" && item.row.price_list_id === null)).toHaveLength(1);
    const oldOrder = await connected.readStorageOrder(ids(oldRules)), list = vi.spyOn(PricingModuleService.prototype, "listPriceLists"), update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    let calls = 0;
    try {
      expect(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(list).toHaveBeenCalledTimes(2); expect(update).toHaveBeenCalledTimes(1);
      const completed = update.mock.results[0]; if (completed?.type !== "return") throw new Error("Missing completed actual-root native update");
      const output = objects(await completed.value); expect(output).toHaveLength(4); expect(ids(output)).toEqual(connected.targetIds);
      const after = await connected.snapshot(), emitted = eventsSince(before, after); expect(emitted).toHaveLength(20);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(eventVector(emitted)).toEqual([
        ...output.flatMap(row => ids(children(row))).map(id => ["pricing.price-list-rule.created", id]),
        ...connected.targetIds.map(id => ["pricing.price-list.updated", id]), ...oldOrder.map(id => ["pricing.price-list-rule.deleted", id]),
      ]);
      for (const row of await connected.read(connected.targetIds)) {
        const previous = oldRoots.find(before => before.id === row.id); expect(row.created_at).toBe(previous?.created_at); expect(row.updated_at).toBe(previous?.updated_at);
      }
      expect(await controls()).toEqual(untouched); expect(await connected.readRows(connected.selectedPricingIds)).toEqual(attached);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); console.info("Price List actual native root maximum", { calls, events: emitted.length });
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(update).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
    } finally { list.mockRestore(); update.mockRestore(); }
  });

  it("keeps reverse raw root order while deleting old rules in the observed global storage order", async () => {
    const input = maximum("reverse", true), oldRules = await activeRules(connected.targetIds), order = await connected.readStorageOrder(ids(oldRules));
    const before = await connected.snapshot(), forward = await connected.prepareForward(), result = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
    if (!result.output) throw new Error("Missing genuine reverse maximum DTOs");
    expect(ids(result.output)).toEqual([...connected.targetIds].reverse());
    expect(eventVector(eventsSince(before, await connected.snapshot()))).toEqual([
      ...result.output.flatMap(row => ids(children(row))).map(id => ["pricing.price-list-rule.created", id]),
      ...[...connected.targetIds].reverse().map(id => ["pricing.price-list.updated", id]), ...order.map(id => ["pricing.price-list-rule.deleted", id]),
    ]);
  });

  it("preserves history for scalar updates and removes it through native rule replacement and its sparse inverse", async () => {
    const id = connected.historyOwnerId, original = await connected.read([id]), oldRules = await activeRules([id]);
    const historical = await connected.read(["plrule153-active-root-history"]), forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const scalar = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, title: "History scalar153" }] }));
    expect(await connected.read(["plrule153-active-root-history"])).toEqual(historical);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), scalar.compensation)); expect(await connected.read([id])).toEqual(original);
    expect(await connected.read(["plrule153-active-root-history"])).toEqual(historical);
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, title: "inverse153", rules: { arbitrary: ["", "same153"] } }] }));
    expect(await connected.read(["plrule153-active-root-history"])).toEqual([]);
    const beforeInverse = await connected.snapshot(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect(await connected.read([id])).toEqual(original);
    const restored = await activeRules([id]); expect(restored.map(row => [row.attribute, row.value]).sort()).toEqual(oldRules.map(row => [row.attribute, row.value]).sort());
    expect(ids(restored).every(id => !ids(oldRules).includes(id))).toBe(true); expect(await connected.read(["plrule153-active-root-history"])).toEqual([]);
    expect(eventsSince(beforeInverse, await connected.snapshot())).toHaveLength(oldRules.length + 2);
  });

  it("uses union fields for both original batch preimages and compensation", async () => {
    const [a, b] = connected.targetIds; if (!a || !b) throw new Error("Missing target IDs");
    const original = await connected.read([a, b]), rules = await activeRules([a, b]), forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id: a, rules: { union153: ["new153"] } }, { id: b, title: "Union153" }] }));
    expect(result.compensation?.selects).toEqual(["id", "rules", "title"]);
    expect(result.compensation?.dataBeforeUpdate.every(row => Object.hasOwn(row, "title") && Object.hasOwn(row, "price_list_rules"))).toBe(true);
    await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation)); expect(await connected.read([a, b])).toEqual(original);
    const restored = await activeRules([a, b]); expect(restored.map(row => [row.price_list_id, row.attribute, row.value]).sort()).toEqual(rules.map(row => [row.price_list_id, row.attribute, row.value]).sort());
    expect(ids(restored).every(id => !ids(rules).includes(id))).toBe(true);
  });

  it("preserves empty strings, generic rule order, empty values and duplicate value membership", async () => {
    const id = connected.targetIds[2]!, forward = await connected.prepareForward();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, title: "", description: "", rules: { "": ["", ""], second153: [] } }] }));
    expect(result.output?.[0]).toMatchObject({ id, title: "", description: "", rules_count: 2 });
    expect(children(result.output?.[0] ?? {}).map(row => [row.attribute, row.value])).toEqual([["", ["", ""]], ["second153", []]]);
    expect(await run({ price_lists_data: [{ id, rules: {} }] })).toBeNull(); expect(await activeRules([id])).toEqual([]);
  });

  it("retains native nullable dates and reversed date ranges without advancing root stamps", async () => {
    const id = connected.targetIds[3]!, before = (await connected.read([id]))[0];
    expect(await run({ price_lists_data: [{ id, starts_at: null, ends_at: null }] })).toBeNull();
    expect((await connected.read([id]))[0]).toEqual({ ...before, starts_at: null, ends_at: null });
    expect(await run({ price_lists_data: [{ id, starts_at: "2035-01-01", ends_at: "2025-01-01" }] })).toBeNull();
    expect((await connected.read([id]))[0]).toEqual({ ...before, starts_at: "2035-01-01T00:00:00.000Z", ends_at: "2025-01-01T00:00:00.000Z" });
  });

  it("keeps scalar inverses sparse across genuine outside edits and preserves outside rules", async () => {
    const id = connected.targetIds[1]!, original = (await connected.read([id]))[0], forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, title: "Forward selected153" }] }));
    const outside = await connected.prepareModuleUpdate(); await Effect.runPromise(outside.run(outside.newRequestKey(), [{ id, title: "Outside selected153", description: "Outside unselected153",
      rules: { first153: ["1"], second153: ["2"], late153: ["3"] } }]));
    const outsideRules = await activeRules([id]); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    expect((await connected.read([id]))[0]).toEqual({ ...original, description: "Outside unselected153", rules_count: 3 });
    expect(await activeRules([id])).toEqual(outsideRules);
  });

  it("replaces all outside rule members through the original rules-bearing inverse", async () => {
    const id = connected.targetIds[1]!, oldRules = await activeRules([id]), forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, rules: { forward153: ["x"] } }] }));
    const outside = await connected.prepareModuleUpdate(); await Effect.runPromise(outside.run(outside.newRequestKey(), [{ id, rules: { outside153: ["1"], late153: ["2"], third153: ["3"] } }]));
    const outsideIds = ids(await activeRules([id])); await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation));
    const restored = await activeRules([id]); expect(restored.map(row => [row.attribute, row.value]).sort()).toEqual(oldRules.map(row => [row.attribute, row.value]).sort());
    expect(ids(restored).every(id => !outsideIds.includes(id))).toBe(true);
  });

  it("retains native deleted-root inverse failure after the existing genuine physical inverse", async () => {
    const id = connected.deletionRootId, forward = await connected.prepareForward(), inverse = await connected.prepareInverse();
    const result = await Effect.runPromise(forward.run(forward.newRequestKey(), { price_lists_data: [{ id, title: "Delete before inverse153" }] }));
    const deletion = await connected.preparePhysicalDeletion(); await Effect.runPromise(deletion.run(deletion.newRequestKey(), [id]));
    const before = await connected.snapshot(), update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    try {
      await expect(Effect.runPromise(inverse.run(inverse.newRequestKey(), result.compensation))).rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(update).toHaveBeenCalledTimes(1); const rejected = update.mock.results[0];
      if (rejected?.type !== "return") throw new Error("Missing rejected genuine native inverse call");
      await expect(rejected.value).rejects.toMatchObject({ type: "invalid_data", message: `Price lists with ids: '${id}' not found` });
      const after = await connected.snapshot(); noMutation(before, after); expect(after.outcomes).toEqual(before.outcomes); expect(after.commits).toEqual(before.commits);
      expect(await connected.read([id])).toEqual([]);
    } finally { update.mockRestore(); }
  });

  it.each(["missing", "empty", "historical", "duplicate", "date", "null-description"] as const)("preserves the native %s refusal without durable changes", async kind => {
    const id = connected.targetIds[0]!, row = kind === "missing" ? { id: "missing153", title: "missing" } : kind === "empty" ? { id: "", title: "empty" }
      : kind === "historical" ? { id: connected.historicalRootId, title: "history" } : kind === "date" ? { id, starts_at: "invalid153" }
      : kind === "null-description" ? { id, description: null } : { id, title: "duplicate153" };
    const before = await connected.snapshot(), update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists"), host = await connected.prepare();
    const phases: string[] = [];
    const reachesUpdate = kind === "duplicate" || kind === "date" || kind === "null-description";
    try {
      await expect(Effect.runPromise(host.run(host.newRequestKey(), { price_lists_data: kind === "duplicate" ? [row, row] : [row] }).pipe(
        Effect.provideService(ExecutionDiagnostics, { observe: (name, work) => Effect.sync(() => { phases.push(name); }).pipe(Effect.andThen(work)) }),
      ))).rejects.toMatchObject({ reason: reachesUpdate ? "rollbackOnly" : "adapterFailure" });
      expect(update).toHaveBeenCalledTimes(reachesUpdate ? 1 : 0);
      if (reachesUpdate) {
        const rejected = update.mock.results[0]; if (rejected?.type !== "return") throw new Error("Missing rejected genuine native update call");
        await expect(rejected.value).rejects.toMatchObject(kind === "null-description" ? { reason: "rollbackOnly" } : {
          type: "invalid_data", message: kind === "duplicate" ? "Price lists with ids: '' not found" : "Cannot set price list starts at with with invalid date string: invalid153",
        });
        if (kind === "null-description") {
          expect(update.mock.calls[0]?.[0]).toEqual([{ id, description: null }]);
          // This shared write is reachable only after the genuine module's
          // existing-root read, normalization and native upsertWithReplace.
          expect(phases.filter(name => name === "LogicalDocuments.relationalChange")).toHaveLength(1);
        }
      }
      const after = await connected.snapshot(); noMutation(before, after); expect(after.outcomes).toEqual(before.outcomes); expect(after.commits).toEqual(before.commits);
    } finally { update.mockRestore(); }
  });

  it("rolls back the completed native update on the known late-parent error and latches caught refusal", async () => {
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    try {
      let calls = 0, parentReached = false;
      const phases: string[] = [], before = await connected.snapshot(), late = await connected.prepareWrapped({ lateFailure: true,
        afterNative: async () => { parentReached = true; phases.push("parent-callback"); } });
      const attempt = late.run(late.newRequestKey(), maximum("late")).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; phases.push(name); }).pipe(Effect.andThen(work)),
      }), Effect.onExit(exit => Effect.sync(() => { console.info("Price List maximum parent diagnostics", { calls, parentReached, nativeCalls: update.mock.calls.length,
        result: exit._tag, lastPhases: phases.slice(-16) }); })));
      await expect(Effect.runPromise(attempt)).rejects.toMatchObject({ reason: "adapterFailure", cause: { message: "Late parent failure after genuine Price List update" } });
      expect(parentReached).toBe(true); expect(calls).toBeLessThanOrEqual(64);
      expect(update).toHaveBeenCalledTimes(1); const failed = await connected.snapshot(); noMutation(before, failed);
      expect(failed.outcomes).toEqual(before.outcomes); expect(failed.commits).toEqual(before.commits);
      const staged = update.mock.results[0]; if (staged?.type !== "return") throw new Error("Missing completed original update call");
      expect(objects(await staged.value)).toHaveLength(4);
      const caught = await connected.prepareWrapped({ caughtRefusal: true }); await expect(Effect.runPromise(caught.run(caught.newRequestKey(), single("caught153")))).rejects.toBeDefined();
      expect(update).toHaveBeenCalledTimes(2); const refused = await connected.snapshot(); noMutation(before, refused);
      expect(refused.outcomes).toEqual(before.outcomes); expect(refused.commits).toEqual(before.commits);
    } finally { update.mockRestore(); }
  });

  it("exposes only Pricing read/update methods and revokes escaped authority", async () => {
    let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: value => {
      expect(Object.keys(Object(value)).sort()).toEqual(["event_bus", "pricing"]);
      expect(Object.keys(Object(Reflect.get(Object(value), "pricing"))).sort()).toEqual(["listPriceLists", "updatePriceLists"]);
    }, escape: work => { escaped = work; } });
    await Effect.runPromise(host.run(host.newRequestKey(), single("authority153")));
    if (!escaped) throw new Error("Missing escaped genuine method"); const before = await connected.snapshot();
    await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
  });

  it("captures caller-owned scalars and nested rule values before native code can change the caller", async () => {
    const id = connected.targetIds[2]!, input = { price_lists_data: [{ id, title: "captured153", rules: { region_id: ["captured153"] } }] };
    const original = PricingModuleService.prototype.updatePriceLists;
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      input.price_lists_data[0]!.title = "caller-changed153"; input.price_lists_data[0]!.rules.region_id.push("caller-changed153");
      return Reflect.apply(original, this, args);
    });
    try {
      expect(await run(input)).toBeNull(); expect((await connected.read([id]))[0]?.title).toBe("captured153");
      expect((await activeRules([id])).map(row => [row.attribute, row.value])).toEqual([["region_id", ["captured153"]]]);
      expect(input.price_lists_data[0]?.title).toBe("caller-changed153");
    } finally { update.mockRestore(); }
  });

  it("rejects getters, undeclared/managed fields, overflow and another authentic Pricing profile", async () => {
    const host = await connected.prepare(), getter = vi.fn(() => "unread153"), before = await connected.snapshot();
    const row = Object.defineProperty({ id: connected.targetIds[0] }, "title", { enumerable: true, get: getter });
    for (const data of [{ price_lists_data: [row] }, { price_lists_data: [{ id: connected.targetIds[0], updated_at: "managed153" }] },
      { price_lists_data: [{ id: connected.targetIds[0], type: "sale" }] }, { price_lists_data: [{ id: connected.targetIds[0], prices: [] }] },
      { price_lists_data: [{ id: connected.targetIds[0], rules: { a: [], b: [], c: [] } }] }, { price_lists_data: Array.from({ length: 5 }, () => ({ id: connected.targetIds[0] })) }])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), data]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    const other = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    await expect(Effect.runPromise(prepareUpdatePriceListsWorkflow({ ...connected.options, pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
  });

  it("recovers one native update after lost acknowledgement and refuses a conflicting replay", async () => {
    let lose = true; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false; return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price List update acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareUpdatePriceListsWorkflow({ ...connected.options, execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareUpdatePriceListsWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists");
    try {
      const key = host.newRequestKey(), input = single("uncertain153"); expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lose).toBe(false); expect(update).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(update).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { update.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  });

  it("cancels staged native updates and fences late callback completion", async () => {
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.updatePriceLists;
    const update = vi.spyOn(PricingModuleService.prototype, "updatePriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result; }
      finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), single("cancel153")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      })));
      noMutation(before, await connected.snapshot()); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); update.mockRestore(); }
  }, 120_000);
});
