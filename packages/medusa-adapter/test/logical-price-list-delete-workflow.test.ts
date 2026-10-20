import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Option, References, Result, Schema, Tracer } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { Link } from "@medusajs/modules-sdk/link";
import { ExecutionDiagnostics, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { compilePriceListDeletionContracts } from "../src/modules/pricing/list-deletion-input";
import { capturePricingMetadata } from "../src/modules/pricing/schema";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { prepareDeletePriceListsWorkflow } from "../src/workflows/pricing/delete-price-lists";
import { priceListDeletionResources } from "../src/workflow/policy";
import { prepareLogicalPriceListDeletion, type DeletionScenario } from "./support/logical-price-list-delete-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalPriceListDeletion>>;
let protectedRows: Awaited<ReturnType<typeof connected.read>> | undefined;
let contracts: Result.Result.Success<ReturnType<typeof compilePriceListDeletionContracts>>;
type Snapshot = Awaited<ReturnType<typeof connected.snapshot>>;
type Rows = Awaited<ReturnType<typeof connected.readRows>>;
const a = "plist154-a", b = "plist154-b", c = "plist154-c", d = "plist154-d", missing = "plist154-missing";
const setup = async (scenario: DeletionScenario = "maximum") => {
  connected = await prepareLogicalPriceListDeletion(driver, dispose => cleanup.push(dispose), scenario);
  protectedRows = await connected.read(connected.protectedIds);
  contracts = Result.getOrThrow(compilePriceListDeletionContracts((await Effect.runPromise(capturePricingMetadata())).frame));
};
const noMutation = (before: Snapshot, after: Snapshot) => {
  for (const name of ["rows", "revisions", "indexEntries", "indexRevisions", "uniqueKeys", "rowChanges", "physicalFacts", "events"] as const)
    expect(after[name], name).toEqual(before[name]);
};
const eventsSince = (before: Snapshot, after: Snapshot) => after.events.filter(event => !before.events.some(prior =>
  prior.scopeUuid === event.scopeUuid && prior.commitSeq === event.commitSeq && prior.eventOrdinal === event.eventOrdinal));
const decodeMessage = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ object: Schema.String, action: Schema.String }), data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
const eventVector = (events: Snapshot["events"]) => events.flatMap(event => {
  const message = decodeMessage(event.envelope.message);
  return (Array.isArray(message.data.id) ? message.data.id : [message.data.id]).map(id => [message.metadata.object, id, message.metadata.action]);
});
const id = (value: Rows[number]["row"]) => { if (typeof value.id !== "string") throw new Error("Missing checked row ID"); return value.id; };
const orderedRows = (rows: Rows, table: string, column?: string, parent?: string) => rows.filter(item => item.table === table && (!column || item.row[column] === parent))
  .sort((left, right) => id(left.row) < id(right.row) ? -1 : id(left.row) > id(right.row) ? 1 : 0);
const portableRows = (rows: Rows, ids: readonly string[]) => {
  const roots = orderedRows(rows, "price_list").filter(item => ids.includes(id(item.row)) && item.row.deleted_at === null);
  const prices = roots.flatMap(root => orderedRows(rows, "price", "price_list_id", id(root.row)));
  return [...roots, ...prices, ...roots.flatMap(root => orderedRows(rows, "price_list_rule", "price_list_id", id(root.row))),
    ...prices.flatMap(price => orderedRows(rows, "price_rule", "price_id", id(price.row)))];
};
const expectedVector = (rows: Rows, ids: readonly string[]) => portableRows(rows, ids).map(item =>
  [item.table, id(item.row), item.row.deleted_at === null ? "deleted" : "updated"]);
const stable = (rows: Rows) => rows.map(item => ({ table: item.table, row: Object.fromEntries(Object.entries(item.row)
  .filter(([key]) => key !== "updated_at" && key !== "deleted_at")) }));
const reasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return ["reason" in value && typeof value.reason === "string" ? value.reason : value.message, ...reasons(value.cause)];
};

/** Opt-in test diagnostics retain the actual failure. ParentSpan provides a
 * fiber-local owner path across the existing diagnostic-context boundaries. */
function diagnoseMaximum<Value, Failure, Requirements>(label: string, work: Effect.Effect<Value, Failure, Requirements>, increment: () => void) {
  let calls = 0, droppedNames = 0, droppedCharges = 0, droppedFailures = 0;
  const names = new Map<string, number>(), charges: Array<{ ordinal: number; parents: string[] }> = [];
  const failures: Array<{ name: string; parents: string[]; reasons: string[] }> = [];
  const policy: ExecutionDiagnosticPolicy = { observe: (name, observed) => Effect.withFiber(fiber => {
    const parents: string[] = [];
    let parent = fiber.currentSpan ?? Context.getOrUndefined(fiber.context, Tracer.ParentSpan);
    while (parent?._tag === "Span" && parents.length < 16) {
      parents.push(parent.name.slice(0, 96)); parent = Option.getOrUndefined(parent.parent);
    }
    const boundedName = name.slice(0, 96), prior = names.get(boundedName);
    if (prior !== undefined) names.set(boundedName, prior + 1);
    else if (names.size < 128) names.set(boundedName, 1); else droppedNames++;
    if (name === "BoundedRequest.enter") {
      calls++; increment(); if (charges.length < 80) charges.push({ ordinal: calls, parents }); else droppedCharges++;
    }
    return Effect.useSpan(name, {}, span => observed.pipe(Effect.provideService(Tracer.ParentSpan, span), Effect.onExit(exit => {
      if (!Exit.isFailure(exit)) return Effect.void;
      return Effect.sync(() => {
        if (failures.length < 16) failures.push({ name: boundedName, parents, reasons: exit.cause.reasons.slice(0, 8).map(reason => reason._tag) });
        else droppedFailures++;
      });
    })));
  }) };
  return work.pipe(Effect.provideService(ExecutionDiagnostics, policy), Effect.provideService(References.TracerEnabled, true), Effect.onExit(exit =>
    Exit.isFailure(exit) ? Effect.sync(() => console.error("Price List maximum resource failure", JSON.stringify({ label, calls,
      spanCounts: [...names], charges, failures, droppedNames, droppedCharges, droppedFailures,
      limits: { names: 128, charges: 80, failures: 16, parentDepth: 16, nameCharacters: 96 } }))) : Effect.void));
}
describe(`approved portable original Price List deletion - ${driver}`, { concurrent: false }, () => {
  beforeEach(() => { protectedRows = undefined; });
  afterEach(async () => {
    try { if (protectedRows) { await connected.closeCaseHosts(); expect(await connected.read(connected.protectedIds)).toEqual(protectedRows); } }
    finally { for (const dispose of cleanup.splice(0).reverse()) await dispose(); }
  }, 180_000);

  it("executes both empty dependencies and genuine Link inverse while native Pricing compensation skips", async () => {
    await setup(); expect(connected.native.nodes.filter(node => node.kind === "step").map(node => node.name)).toEqual(["delete-price-lists", "remove-remote-links"]);
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists");
    const unlink = vi.spyOn(Link.prototype, "delete"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      const host = await connected.prepare(), key = host.newRequestKey(), before = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(remove).toHaveBeenCalledTimes(1); expect(remove.mock.calls[0]?.[0]).toEqual([]); expect(await remove.mock.results[0]?.value).toEqual({});
      expect(unlink.mock.calls[0]?.[0]).toEqual({ pricing: { price_list_id: [] } }); expect(await unlink.mock.results[0]?.value).toEqual([null, {}]);
      expect(remove.mock.invocationCallOrder[0]).toBeLessThan(unlink.mock.invocationCallOrder[0] ?? 0);
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1);
      const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), []));
      expect(retained).toEqual({ pricing: [], link: { pricing: { price_list_id: [] } } });
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(restore).not.toHaveBeenCalled(); expect(relink.mock.calls[0]?.[0]).toEqual(retained.link); noMutation(before, await connected.snapshot());
    } finally { remove.mockRestore(); restore.mockRestore(); unlink.mockRestore(); relink.mockRestore(); }
  }, 240_000);

  it("runs the actual maximum root within its named allowance and preserves the approved exact36-event family vector", async () => {
    await setup(); const input = [d, b, a, c], rowsBefore = await connected.readRows(), before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      let calls = 0; const host = await connected.prepare();
      expect(await Effect.runPromise(diagnoseMaximum("original maximum root", host.run(host.newRequestKey(), { ids: input }), () => { calls++; }))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(input); expect(unlink.mock.calls[0]?.[0]).toEqual({ pricing: { price_list_id: input } });
      const result = Result.getOrThrow(contracts.decodeOutput(await remove.mock.results[0]?.value));
      expect(result.price_list_id).toEqual([a, b, c, d]); expect(result.price_id).toHaveLength(8); expect(result.PriceListRule).toHaveLength(8); expect(result.price_rule_id).toHaveLength(16);
      const rowsAfter = await connected.readRows(), after = await connected.snapshot(), events = eventsSince(before, after);
      expect(stable(rowsAfter)).toEqual(stable(rowsBefore)); expect(eventVector(events)).toEqual(expectedVector(rowsBefore, input)); expect(events).toHaveLength(36);
      for (const row of result.PriceListRule ?? []) expect(rowsAfter.find(item => item.table === "price_list_rule" && item.row.id === row.id)?.row).toEqual(row);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListDeletionResources.calls); console.info("Price List deletion maximum", { calls, events: events.length });
    } finally { remove.mockRestore(); unlink.mockRestore(); }
  }, 240_000);

  it("runs the genuine maximum retained inverse within its named allowance and restores all36 current rows without events", async () => {
    await setup(); const input = [d, c, b, a], rowsBefore = await connected.readRows(), before = await connected.snapshot();
    const selected = portableRows(rowsBefore, input), protectedBefore = await connected.read(connected.protectedIds);
    expect(selected).toHaveLength(36);
    const identity = (item: Rows[number]) => JSON.stringify([item.table, id(item.row)]);
    const selectedIds = new Set(selected.map(identity));
    const forward = await connected.prepareForward(); let forwardCalls = 0;
    const retained = await Effect.runPromise(diagnoseMaximum("maximum retained forward", forward.run(forward.newRequestKey(), input), () => { forwardCalls++; }));
    expect(retained).toEqual({ pricing: input, link: { pricing: { price_list_id: input } } });
    const deletedRows = (await connected.readRows()).filter(item => selectedIds.has(identity(item))), deleted = await connected.snapshot();
    expect(deletedRows).toHaveLength(36); expect(deletedRows.every(item => typeof item.row.deleted_at === "string")).toBe(true);
    expect(eventVector(eventsSince(before, deleted))).toEqual(expectedVector(rowsBefore, input));
    const inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      let inverseCalls = 0;
      expect(await Effect.runPromise(diagnoseMaximum("maximum original retained inverse", inverse.run(inverse.newRequestKey(), retained), () => { inverseCalls++; }))).toBeNull();
      expect(relink.mock.calls[0]?.[0]).toEqual(retained.link); expect(restore.mock.calls[0]?.[0]).toEqual(retained.pricing);
      expect(relink.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
      expect(restore).toHaveBeenCalledTimes(1); expect(relink).toHaveBeenCalledTimes(1);
      const result = Result.getOrThrow(contracts.decodeOutput(await restore.mock.results[0]?.value));
      expect(result.price_list_id).toEqual([a, b, c, d]); expect(result.price_id).toHaveLength(8);
      expect(result.PriceListRule).toHaveLength(8); expect(result.price_rule_id).toHaveLength(16);
      const rowsAfter = await connected.readRows(), restored = rowsAfter.filter(item => selectedIds.has(identity(item)));
      expect(restored).toHaveLength(36); expect(restored.every(item => item.row.deleted_at === null)).toBe(true);
      expect(stable(rowsAfter)).toEqual(stable(rowsBefore));
      for (const row of result.PriceListRule ?? []) expect(restored.find(item => item.table === "price_list_rule" && item.row.id === row.id)?.row).toEqual(row);
      expect(eventsSince(deleted, await connected.snapshot())).toEqual([]); expect(await connected.read(connected.protectedIds)).toEqual(protectedBefore);
      expect(forwardCalls).toBeGreaterThan(0); expect(forwardCalls).toBeLessThanOrEqual(priceListDeletionResources.calls);
      expect(inverseCalls).toBeGreaterThan(0); expect(inverseCalls).toBeLessThanOrEqual(priceListDeletionResources.calls);
      console.info("Price List maximum genuine retained callbacks", { forwardCalls, inverseCalls, restoredRows: restored.length });
    } finally { restore.mockRestore(); relink.mockRestore(); }
  }, 240_000);
  it("keeps the same maximum refused at default64 and binds the named allowance into replay identity", async () => {
    await setup(); expect(Object.hasOwn(connected.options.pricing, "logicalResources")).toBe(false);
    const limited = await connected.prepareDefault64(), before = await connected.snapshot(), input = { ids: [d, c, b, a] };
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      const failed = await Effect.runPromise(Effect.exit(limited.run(limited.newRequestKey(), input)));
      expect(failed._tag).toBe("Failure"); if (failed._tag !== "Failure") throw new Error("Default64 maximum unexpectedly completed");
      expect(reasons(failed.cause)).toEqual(expect.arrayContaining(["limitExceeded", "rollbackOnly"]));
      const refused = await connected.snapshot(); noMutation(before, refused); expect(refused.outcomes).toEqual(before.outcomes);
      expect(refused.commits).toEqual(before.commits); expect(remove).toHaveBeenCalledTimes(1); expect(unlink).not.toHaveBeenCalled();
      const admitted = await connected.prepare(), key = admitted.newRequestKey();
      expect(await Effect.runPromise(admitted.run(key, input))).toBeNull(); const committed = await connected.snapshot();
      expect(remove).toHaveBeenCalledTimes(2); expect(unlink).toHaveBeenCalledTimes(1);
      // Same native definition, workflow name, methods and revisions; only the
      // trusted logical/request allowance differs in this default composition.
      await expect(Effect.runPromise(limited.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(remove).toHaveBeenCalledTimes(2); expect(unlink).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(committed);
    } finally { remove.mockRestore(); unlink.mockRestore(); }
  }, 240_000);

  it("completes a maximum nested parent within the same named allowance and exact36-event contract", async () => {
    await setup(); const rows = await connected.readRows(), before = await connected.snapshot(), host = await connected.prepareWrapped(); let calls = 0;
    expect(await Effect.runPromise(diagnoseMaximum("maximum successful parent", host.run(host.newRequestKey(), { ids: [d, c, b, a] }), () => { calls++; }))).toBeNull();
    const after = await connected.snapshot(), events = eventsSince(before, after);
    expect(eventVector(events)).toEqual(expectedVector(rows, [a, b, c, d])); expect(events).toHaveLength(36);
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(priceListDeletionResources.calls);
    console.info("Price List deletion maximum successful parent", { calls, events: events.length });
  }, 240_000);
  it("retains duplicate raw selectors and full native maps while the complete graph is deduplicated", async () => {
    await setup(); const input = [b, a, b, missing], rows = await connected.readRows(), before = await connected.snapshot();
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), input));
      expect(retained).toEqual({ pricing: input, link: { pricing: { price_list_id: input } } });
      expect(Result.getOrThrow(contracts.decodeOutput(await remove.mock.results[0]?.value)).price_list_id).toEqual([a, b]);
      const deleted = await connected.snapshot(); expect(eventVector(eventsSince(before, deleted))).toEqual(expectedVector(rows, input));
      const inverse = await connected.prepareInverse(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      expect(restore.mock.calls[0]?.[0]).toEqual(input); expect(relink.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
      expect(Result.getOrThrow(contracts.decodeOutput(await restore.mock.results[0]?.value)).price_list_id).toEqual([a, b]);
      expect(eventsSince(deleted, await connected.snapshot())).toEqual([]);
      expect(portableRows(await connected.readRows(), [a, b]).every(item => item.row.deleted_at === null)).toBe(true);
    } finally { remove.mockRestore(); restore.mockRestore(); relink.mockRestore(); }
  }, 240_000);

  it("passes missing, empty-string and arbitrary raw IDs through Pricing and Link without mutation", async () => {
    await setup(); const before = await connected.snapshot(), input = [missing, "", "not a stored ID /154", "x".repeat(256)];
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: input }))).toBeNull();
      expect(remove.mock.calls[0]?.[0]).toEqual(input); expect(await remove.mock.results[0]?.value).toEqual({});
      expect(unlink.mock.calls[0]?.[0]).toEqual({ pricing: { price_list_id: input } }); noMutation(before, await connected.snapshot());
    } finally { remove.mockRestore(); unlink.mockRestore(); }
  }, 240_000);

  it("restores requested preexisting history and3+current descendants without creating restore events", async () => {
    await setup("history"); const before = await connected.snapshot(), beforeRows = await connected.readRows();
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a, missing, a]));
    noMutation(before, await connected.snapshot()); expect(retained.pricing).toEqual([a, missing, a]);
    const inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull();
      const result = Result.getOrThrow(contracts.decodeOutput(await restore.mock.results[0]?.value));
      expect(result.price_list_id).toEqual([a]); expect(result.price_id).toHaveLength(3); expect(result.PriceListRule).toHaveLength(3); expect(result.price_rule_id).toHaveLength(7);
      const afterRows = await connected.readRows(); expect(stable(afterRows)).toEqual(stable(beforeRows));
      expect(afterRows.filter(item => item.row.id === a || item.row.price_list_id === a || String(item.row.price_id).includes(a)).every(item => item.row.deleted_at === null)).toBe(true);
      expect(eventsSince(before, await connected.snapshot())).toEqual([]);
    } finally { restore.mockRestore(); }
  }, 240_000);

  it("restamps historical descendants with native updated actions at their approved family positions", async () => {
    await setup("mixed-history"); const rows = await connected.readRows(), before = await connected.snapshot();
    const host = await connected.prepare(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] }))).toBeNull();
    const events = eventVector(eventsSince(before, await connected.snapshot())); expect(events).toEqual(expectedVector(rows, [a]));
    expect(events.some(item => item[2] === "updated")).toBe(true); expect(events.some(item => item[2] === "deleted")).toBe(true);
    const selected = portableRows(rows, [a]); expect(selected.filter(item => item.table === "price")).toHaveLength(3); expect(selected.filter(item => item.table === "price_rule")).toHaveLength(7);
    expect(stable(await connected.readRows())).toEqual(stable(rows));
  }, 240_000);

  it("qualifies preimages by table when ListRule and PriceRule share an ID but different historical states", async () => {
    await setup("same-model-id"); const beforeRows = await connected.readRows(), before = await connected.snapshot(), host = await connected.prepare();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] }))).toBeNull();
    const events = eventVector(eventsSince(before, await connected.snapshot())); expect(events).toEqual(expectedVector(beforeRows, [a]));
    expect(events.filter(item => item[1] === "same-id154")).toEqual([["price_list_rule", "same-id154", "updated"], ["price_rule", "same-id154", "deleted"]]);
  }, 240_000);

  it("keeps repeated soft deletion and selected active restores as no-ops with complete maps and zero events", async () => {
    await setup(); const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a]));
    const deleted = await connected.snapshot(), host = await connected.prepare();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] }))).toBeNull(); noMutation(deleted, await connected.snapshot());
    const inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
    const active = await connected.snapshot(), rows = await connected.readRows(), repeated = await connected.prepareInverse(true), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists");
    try {
      expect(await Effect.runPromise(repeated.run(repeated.newRequestKey(), retained))).toBeNull(); expect(restore).toHaveBeenCalledTimes(2);
      for (const result of restore.mock.results) expect(Result.getOrThrow(contracts.decodeOutput(await result.value)).price_list_id).toEqual([a]);
      noMutation(active, await connected.snapshot()); expect(await connected.readRows()).toEqual(rows);
    } finally { restore.mockRestore(); }
  }, 240_000);

  it("preserves native unique-rule inverse refusal, Link-first calls and whole-root atomic rollback on retries", async () => {
    await setup("collision"); const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a]));
    const before = await connected.snapshot(), beforeRows = await connected.readRows(), inverse = await connected.prepareInverse(), key = inverse.newRequestKey();
    const restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const failed = await Effect.runPromise(Effect.exit(inverse.run(key, retained))); expect(failed._tag).toBe("Failure");
        if (failed._tag !== "Failure") throw new Error("Native collision unexpectedly restored");
        expect(reasons(failed.cause)).toEqual(expect.arrayContaining(["invalidInput", "rollbackOnly"]));
        const after = await connected.snapshot(); noMutation(before, after); expect(after.outcomes).toEqual(before.outcomes); expect(after.commits).toEqual(before.commits);
        expect(await connected.readRows()).toEqual(beforeRows);
      }
      expect(restore).toHaveBeenCalledTimes(2); expect(relink).toHaveBeenCalledTimes(2);
      expect(relink.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0] ?? 0);
    } finally { restore.mockRestore(); relink.mockRestore(); }
  }, 240_000);

  it("restores current late-added ListRules and preserves outside business edits after native reactivation", async () => {
    await setup(); const originalRows = await connected.readRows();
    const originalRuleIds = new Set(originalRows.filter(item => item.table === "price_list_rule" && item.row.price_list_id === a).map(item => id(item.row)));
    const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a]));
    expect((await connected.read([a]))[0]?.deleted_at).toEqual(expect.any(String));
    const reactivate = await connected.prepareRestore(); await Effect.runPromise(reactivate.run(reactivate.newRequestKey(), [a]));
    expect((await connected.read([a]))[0]?.deleted_at).toBeNull();
    const edit = await connected.prepareOutsideUpdate();
    await Effect.runPromise(edit.run(edit.newRequestKey(), [{ id: a, title: "Outside154", rules: { outside154a: ["a"], outside154b: ["b"], outside154c: ["c"] } }]));
    const edited = await connected.readRows(), newRules = edited.filter(item => item.table === "price_list_rule" && item.row.price_list_id === a);
    expect(newRules).toHaveLength(3); expect(newRules.every(item => !originalRuleIds.has(id(item.row)) && item.row.deleted_at === null)).toBe(true);
    expect(edited.find(item => item.table === "price_list" && item.row.id === a)?.row.title).toBe("Outside154");
    const newRuleIds = new Set(newRules.map(item => id(item.row))), host = await connected.prepare();
    await Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] }));
    const redeleted = await connected.readRows(), deletedNewRules = redeleted.filter(item => item.table === "price_list_rule" && newRuleIds.has(id(item.row)));
    expect(redeleted.find(item => item.table === "price_list" && item.row.id === a)?.row.deleted_at).toEqual(expect.any(String));
    expect(deletedNewRules).toHaveLength(3); expect(deletedNewRules.every(item => typeof item.row.deleted_at === "string")).toBe(true);
    const deleted = await connected.snapshot(), inverse = await connected.prepareInverse(); await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained));
    const restored = await connected.readRows(), restoredNewRules = restored.filter(item => item.table === "price_list_rule" && newRuleIds.has(id(item.row)));
    expect(restored.find(item => item.table === "price_list" && item.row.id === a)?.row.title).toBe("Outside154");
    expect(restoredNewRules).toHaveLength(3); expect(restoredNewRules.every(item => item.row.deleted_at === null)).toBe(true);
    expect(stable(restoredNewRules)).toEqual(stable(newRules)); expect(eventsSince(deleted, await connected.snapshot())).toEqual([]);
  }, 240_000);

  it("keeps a physically removed root absent when original raw-ID compensation runs", async () => {
    await setup(); const forward = await connected.prepareForward(), retained = await Effect.runPromise(forward.run(forward.newRequestKey(), [a]));
    const physical = await connected.preparePhysicalDeletion(); await Effect.runPromise(physical.run(physical.newRequestKey(), [a]));
    const before = await connected.snapshot(), inverse = await connected.prepareInverse(), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists");
    try {
      expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), retained))).toBeNull(); expect(await restore.mock.results[0]?.value).toEqual({});
      expect(await connected.read([a])).toEqual([]); noMutation(before, await connected.snapshot());
    } finally { restore.mockRestore(); }
  }, 240_000);

  it("rolls the maximum native graph back after the known late-parent failure without invoking covered inverses", async () => {
    await setup(); const before = await connected.snapshot(), remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), restore = vi.spyOn(PricingModuleService.prototype, "restorePriceLists"), relink = vi.spyOn(Link.prototype, "restore");
    try {
      let calls = 0; const host = await connected.prepareWrapped({ lateFailure: true });
      const failed = await Effect.runPromise(Effect.exit(diagnoseMaximum("maximum late parent", host.run(host.newRequestKey(), { ids: [d, c, b, a] }), () => { calls++; })));
      expect(failed._tag).toBe("Failure"); if (failed._tag !== "Failure") throw new Error("Late parent unexpectedly committed");
      expect(reasons(failed.cause).join(" -> ")).toContain("Late parent failure after genuine Price List deletion");
      expect(remove).toHaveBeenCalledTimes(1); expect(Result.getOrThrow(contracts.decodeOutput(await remove.mock.results[0]?.value)).price_rule_id).toHaveLength(16);
      expect(restore).not.toHaveBeenCalled(); expect(relink).not.toHaveBeenCalled(); const after = await connected.snapshot(); noMutation(before, after);
      expect(after.outcomes).toEqual(before.outcomes); expect(after.commits).toEqual(before.commits); expect(calls).toBeLessThanOrEqual(priceListDeletionResources.calls);
      console.info("Price List deletion late parent maximum", { calls });
    } finally { remove.mockRestore(); restore.mockRestore(); relink.mockRestore(); }
  }, 240_000);

  it("keeps caught authority refusal sticky after genuine forward calls", async () => {
    await setup(); const before = await connected.snapshot(), host = await connected.prepareWrapped({ caughtRefusal: true });
    await expect(Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] }))).rejects.toBeDefined();
    const after = await connected.snapshot(); noMutation(before, after); expect(after.outcomes).toEqual(before.outcomes);
  }, 240_000);

  it("exposes only the exact Pricing and Link methods and revokes escaped authority", async () => {
    await setup(); let escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepareWrapped({ inspect: value => {
      expect(Object.keys(Object(value)).sort()).toEqual(["event_bus", "link", "pricing"]);
      expect(Object.keys(Object(Reflect.get(Object(value), "pricing"))).sort()).toEqual(["restorePriceLists", "softDeletePriceLists"]);
      expect(Object.keys(Object(Reflect.get(Object(value), "link"))).sort()).toEqual(["delete", "restore"]);
    }, escape: work => { escaped = work; } });
    await Effect.runPromise(host.run(host.newRequestKey(), { ids: [a] })); if (!escaped) throw new Error("Missing escaped method");
    const before = await connected.snapshot(); await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); noMutation(before, await connected.snapshot());
  }, 240_000);

  it("captures caller-owned raw selectors before native code can mutate the caller", async () => {
    await setup(); const input = { ids: [a] }, original = PricingModuleService.prototype.softDeletePriceLists;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      input.ids.push(b); return Reflect.apply(original, this, args);
    });
    try { const host = await connected.prepare(); await Effect.runPromise(host.run(host.newRequestKey(), input));
      expect(remove.mock.calls[0]?.[0]).toEqual([a]); expect((await connected.read([b]))[0]?.deleted_at).toBeNull(); expect(input.ids).toEqual([a, b]);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("rejects getters, malformed root input, overflow and another authentic Pricing profile", async () => {
    await setup(); const host = await connected.prepare(), before = await connected.snapshot(), getter = vi.fn(() => [a]);
    const accessor = Object.defineProperty({}, "ids", { enumerable: true, get: getter });
    for (const input of [accessor, { ids: [a], managed: true }, { ids: Array(5).fill(a) }, { ids: ["x".repeat(257)] }, { ids: [1] }, [a]])
      await expect(Effect.runPromise(Reflect.apply(host.run, host, [host.newRequestKey(), input]))).rejects.toBeDefined();
    expect(getter).not.toHaveBeenCalled(); noMutation(before, await connected.snapshot());
    const other = await Effect.runPromise(makeLocalPricingCommands("price-list-creations"));
    await expect(Effect.runPromise(prepareDeletePriceListsWorkflow({ ...connected.options, pricing: { ...connected.options.pricing, module: other.workflow } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
  }, 240_000);

  it("recovers lost acknowledgement once and refuses changed replay identity", async () => {
    await setup(); let lose = true; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false; return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Price List deletion acknowledgement") })); }),
    ));
    const host = await Effect.runPromise(prepareDeletePriceListsWorkflow({ ...connected.options, execution: { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }) } }));
    const changed = await Effect.runPromise(prepareDeletePriceListsWorkflow({ ...connected.options, revision: "a".repeat(64) }));
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists"), unlink = vi.spyOn(Link.prototype, "delete");
    try {
      const key = host.newRequestKey(), input = { ids: [a] }; expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lose).toBe(false);
      expect(remove).toHaveBeenCalledTimes(1); expect(unlink).toHaveBeenCalledTimes(1); const after = await connected.snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await connected.snapshot()).toEqual(after);
    } finally { remove.mockRestore(); unlink.mockRestore(); await Effect.runPromise(host.close); await Effect.runPromise(changed.close); }
  }, 240_000);

  it("cancels staged native lifecycle work and fences late callback completion", async () => {
    await setup(); const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), settled = Deferred.makeUnsafe<void>(), original = PricingModuleService.prototype.softDeletePriceLists;
    const remove = vi.spyOn(PricingModuleService.prototype, "softDeletePriceLists").mockImplementation(async function (this: PricingModuleService, ...args) {
      try { const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result; }
      finally { await Effect.runPromise(Deferred.succeed(settled, undefined)); }
    });
    try {
      const host = await connected.prepare(), before = await connected.snapshot();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () { const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: [a] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); })));
      noMutation(before, await connected.snapshot()); await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Deferred.await(settled).pipe(Effect.timeout(30_000))); noMutation(before, await connected.snapshot());
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); remove.mockRestore(); }
  }, 240_000);
});
