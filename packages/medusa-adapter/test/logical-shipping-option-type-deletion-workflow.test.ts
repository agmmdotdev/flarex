import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { Link } from "@medusajs/modules-sdk/link";
import { CommerceTransactionError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { makeShippingOptionTypeCreationCommands } from "../src/modules/fulfillment/shipping-option-type-service";
import { prepareShippingOptionTypeDeletionWorkflow } from "../src/workflows/fulfillment/delete-shipping-option-types";
import { prepareShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { prepareLogicalShippingOptionTypeDeletion, shippingOptionTypeDeletionGraph, shippingOptionTypeDeletionSeedTime } from "./support/logical-shipping-option-type-deletion-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalShippingOptionTypeDeletion>>, sharedCleanupCount = 0;
const graph = {
  maximum: shippingOptionTypeDeletionGraph("sotype-delete-max", 4), roundtrip: shippingOptionTypeDeletionGraph("sotype-delete-roundtrip", 4),
  page: shippingOptionTypeDeletionGraph("sotype-delete-page", 1, { optionsPerType: 2 }),
  deletedBlocker: shippingOptionTypeDeletionGraph("sotype-delete-deleted-blocker", 1, { optionsPerType: 1, deletedTypes: true }),
  history: shippingOptionTypeDeletionGraph("sotype-delete-history", 1, { optionsPerType: 1, deletedOptions: true, deletedTypes: true }),
  historicalOption: shippingOptionTypeDeletionGraph("sotype-delete-historical-option", 1, { optionsPerType: 1, deletedOptions: true }),
  module: shippingOptionTypeDeletionGraph("sotype-delete-module", 1, { optionsPerType: 1 }),
  duplicates: shippingOptionTypeDeletionGraph("sotype-delete-duplicates"), failure: shippingOptionTypeDeletionGraph("sotype-delete-failure"),
  cancel: shippingOptionTypeDeletionGraph("sotype-delete-cancel"), scope: shippingOptionTypeDeletionGraph("sotype-delete-scope"),
  race: shippingOptionTypeDeletionGraph("sotype-delete-race"), insertion: shippingOptionTypeDeletionGraph("sotype-delete-insertion"),
  restore: shippingOptionTypeDeletionGraph("sotype-delete-restore", 1, { optionsPerType: 1, deletedOptions: true }),
  uncertain: shippingOptionTypeDeletionGraph("sotype-delete-uncertain"), neighbor: shippingOptionTypeDeletionGraph("sotype-delete-neighbor"),
};
const text = Schema.decodeUnknownSync(Schema.String), tuple = Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]));
const moduleDeleted = "fulfillment.shipping-option-type.deleted", moduleRestored = "fulfillment.shipping-option-type.restored", workflowDeleted = "shipping-option-type.deleted";
const guard = "Cannot delete shipping option type because some shipping options are using it.";
const first = (value: ReturnType<typeof shippingOptionTypeDeletionGraph>) => {
  const id = value.ids[0]; if (id === undefined) throw new Error("Missing Type identity"); return id;
};
const endpoint = (ids: readonly string[]) => ({ fulfillment: { shipping_option_type_id: [...ids] } });
const stable = (row: JsonObject) => { const { updated_at: _updated, deleted_at: _deleted, ...rest } = row; return rest; };
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error)
    : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function eventIds(events: Awaited<ReturnType<typeof connected.snapshot>>["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).map(event => {
    expect(event.envelope.internal).toBe(contract !== workflowDeleted);
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing Type event data");
    return text(message.data.id);
  });
}
async function refused(work: Effect.Effect<unknown, unknown>, before: Awaited<ReturnType<typeof connected.snapshot>>, expected?: string) {
  const result = await Effect.runPromise(Effect.result(work)); expect(Result.isFailure(result)).toBe(true);
  if (expected !== undefined && Result.isFailure(result)) expect(reasons(result.failure)).toContain(expected);
  expect(await connected.snapshot()).toEqual(before);
}

describe("genuine Shipping Option Type deletion with paginated Option Query and explicit native Link closure", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalShippingOptionTypeDeletion(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 300_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("retains all mandatory empty dependencies and rejects invalid input before native callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"),
      read = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingOptions"), link = vi.spyOn(Link.prototype, "delete");
    try {
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }]) {
        // @ts-expect-error Runtime public input decoder must refuse malformed native input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); expect(await native.mock.results[0]?.value).toEqual({});
      expect(read).toHaveBeenCalledTimes(1); expect(tuple(await read.mock.results[0]?.value)).toEqual([[], 0]);
      expect(link.mock.calls.map(call => call[0])).toEqual([endpoint([])]); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); read.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("uses native take-one Query with actual count two and blocks active Options even when the Type is already deleted", async () => {
    const host = await connected.prepare(), read = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingOptions"),
      native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.snapshot();
      await refused(host.run(host.newRequestKey(), { ids: graph.page.ids }), before, guard);
      const [page, count] = tuple(await read.mock.results[0]?.value); expect(page).toEqual([{ id: graph.page.optionIds[0] }]); expect(count).toBe(2);
      expect(read.mock.calls[0]?.[0]).toEqual({ shipping_option_type_id: graph.page.ids });
      expect(read.mock.calls[0]?.[1]).toMatchObject({ select: ["id"], take: 1, skip: 0 });
      await refused(host.run(host.newRequestKey(), { ids: graph.deletedBlocker.ids }), before, guard);
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
    } finally { read.mockRestore(); native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("deletes four Types through the full root hook and native Link, publishes raw IDs and replays once", async () => {
    const ids = [...graph.maximum.ids].reverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    let hookCalls = 0, escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepare({ shippingOptionTypesDeleted: (input, context) => {
      hookCalls++; expect(input).toEqual({ ids }); expect(native).toHaveBeenCalledTimes(1);
      expect(Object.keys(context.resources).sort()).toEqual(["event_bus", "fulfillment", "link", "query"]);
      expect(Object.keys(context.resources.fulfillment).sort()).toEqual(["restoreShippingOptionTypes", "softDeleteShippingOptionTypes"]);
      escaped = () => context.resources.fulfillment.restoreShippingOptionTypes(ids);
    } });
    try {
      const before = await connected.snapshot(), old = await connected.read(ids), neighbors = await connected.read(graph.neighbor.ids), key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      console.info("ShippingOptionType deletion full root calls", calls); expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(native.mock.calls[0]?.[0]).toEqual(ids); expect(await native.mock.results[0]?.value).toEqual({ shipping_option_type_id: [...graph.maximum.ids] });
      expect(link).toHaveBeenCalledExactlyOnceWith(endpoint(ids)); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const current = await connected.read(ids); expect(current.map(stable)).toEqual(old.map(stable));
      for (const row of current) { expect(row.deleted_at).toEqual(expect.any(String)); expect(row.updated_at).not.toBe(shippingOptionTypeDeletionSeedTime); }
      expect(await connected.read(graph.neighbor.ids)).toEqual(neighbors);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, moduleDeleted)).toEqual(graph.maximum.ids); expect(eventIds(emitted, workflowDeleted)).toEqual(ids);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.rowChanges).toHaveLength(before.rowChanges.length + 4);
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(hookCalls).toBe(1); expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { ids: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      const changed = await connected.prepare({}, "b".repeat(64)); await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      if (escaped === undefined) throw new Error("Missing escaped Type hook method"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("runs the full four-Type root and genuine retained Link then Type inverse under unchanged resource limits", async () => {
    const host = await connected.prepareRoundtrip(), ids = [...graph.roundtrip.ids].reverse(), beforeRows = await connected.read(ids), before = await connected.snapshot();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingOptionTypes"), link = vi.spyOn(Link.prototype, "restore"); let calls = 0;
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      console.info("ShippingOptionType deletion full root and inverses calls", calls); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(link.mock.calls[0]?.[0]).toEqual(endpoint(ids)); expect(native.mock.calls[0]?.[0]).toEqual(ids);
      expect(link.mock.invocationCallOrder[0]).toBeLessThan(native.mock.invocationCallOrder[0]!);
      expect((await connected.read(ids)).map(stable)).toEqual(beforeRows.map(stable)); expect((await connected.read(ids)).every(row => row.deleted_at === null)).toBe(true);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, moduleDeleted)).toEqual(graph.roundtrip.ids); expect(eventIds(emitted, moduleRestored)).toEqual(graph.roundtrip.ids);
      expect(eventIds(emitted, workflowDeleted)).toEqual(ids); expect(after.commits).toHaveLength(before.commits.length + 1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("keeps raw duplicates and missing workflow messages while module maps contain only changed rows", async () => {
    const host = await connected.prepare(), id = first(graph.duplicates), ids = ["missing-native-type", id, id], native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes");
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(await native.mock.results[0]?.value).toEqual({ shipping_option_type_id: [id] });
      const firstState = await connected.snapshot(); expect(eventIds(firstState.events.slice(before.events.length), moduleDeleted)).toEqual([id]);
      expect(eventIds(firstState.events.slice(before.events.length), workflowDeleted)).toEqual(ids);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull(); expect(await native.mock.results[1]?.value).toEqual({});
      const repeated = await connected.snapshot(); expect(repeated.rows).toEqual(firstState.rows); expect(repeated.rowChanges).toEqual(firstState.rowChanges);
      expect(eventIds(repeated.events.slice(firstState.events.length), moduleDeleted)).toEqual([]); expect(eventIds(repeated.events.slice(firstState.events.length), workflowDeleted)).toEqual(ids);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("ignores historical Options and preserves their row/FK while raw inverse revives a predeleted Type", async () => {
    const host = await connected.prepare(), inverse = await connected.prepareRestore(), beforeOptions = await connected.read([...graph.history.optionIds, ...graph.historicalOption.optionIds]);
    for (const selected of [graph.history, graph.historicalOption]) expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: selected.ids }))).toBeNull();
    expect((await connected.read(graph.history.ids))[0]?.deleted_at).toBe(shippingOptionTypeDeletionSeedTime);
    const before = await connected.snapshot(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), { ids: [...graph.history.ids, "missing", ...graph.history.ids] }))).toBeNull();
    expect((await connected.read(graph.history.ids))[0]?.deleted_at).toBeNull(); expect(await connected.read([...graph.history.optionIds, ...graph.historicalOption.optionIds])).toEqual(beforeOptions);
    expect(eventIds((await connected.snapshot()).events.slice(before.events.length), moduleRestored)).toEqual(graph.history.ids);
  }, 240_000);

  it("preserves direct module lifecycle without the root Option guard and native active restore timestamps/events", async () => {
    const host = await connected.prepareLifecycle(), ids = graph.module.ids, beforeOptions = await connected.read(graph.module.optionIds);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids, restore: false }))).toEqual({ shipping_option_type_id: ids });
    const deleted = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids, restore: false }))).toEqual({});
    const repeated = await connected.snapshot(); expect(repeated.rows).toEqual(deleted.rows); expect(repeated.events).toEqual(deleted.events);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids, restore: true }))).toEqual({ shipping_option_type_id: ids });
    const active = await connected.read(ids), before = await connected.snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids, restore: true }))).toEqual({ shipping_option_type_id: ids });
    const current = await connected.read(ids); expect(current.map(stable)).toEqual(active.map(stable)); expect(current[0]?.updated_at).not.toEqual(active[0]?.updated_at);
    expect(eventIds((await connected.snapshot()).events.slice(before.events.length), moduleRestored)).toEqual(ids); expect(await connected.read(graph.module.optionIds)).toEqual(beforeOptions);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: ["missing"], restore: true }))).toEqual({});
  }, 240_000);

  it("skips empty retained Type inverse but retains genuine empty Link restore", async () => {
    const host = await connected.prepareRestore(), native = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingOptionTypes"), link = vi.spyOn(Link.prototype, "restore");
    try { const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [] }))).toBeNull();
      expect(native).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledExactlyOnceWith(endpoint([])); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it.each(["skip", "count", "field", "selector", "page"] as const)("refuses forged native Option Query %s before lifecycle", async mode => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.listAndCountShippingOptions;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), read = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingOptions")
      // Proxy is an explicit corrupt foreign-result fault boundary. Its typed
      // native target remains intact; the real runtime decoder must refuse it.
      .mockImplementation(new Proxy(original, { apply: async (target, receiver, args) => {
        if (mode === "skip") return [[], 0];
        const actualArgs = mode === "selector" ? [{ shipping_option_type_id: ["missing-query-type"] }, ...args.slice(1)] : args;
        const [rows, count] = tuple(await Reflect.apply(target, receiver, actualArgs));
        if (mode === "count") return [rows, count + 1];
        if (mode === "field") return [rows.map(row => ({ ...row, id: 1 })), count];
        if (mode === "page") return [[], count];
        return [rows, count];
      } }));
    try { await refused(host.run(host.newRequestKey(), { ids: graph.page.ids }), await connected.snapshot(), "receiptMismatch"); expect(native).not.toHaveBeenCalled(); }
    finally { native.mockRestore(); read.mockRestore(); }
  }, 180_000);

  it("rolls back hook, parallel Link and late inverse failures and refuses Event Bus omission at admission", async () => {
    const ids = graph.failure.ids;
    const hook = await connected.prepare({ shippingOptionTypesDeleted: () => { throw new Error("Native Type deletion hook failure"); } });
    await refused(hook.run(hook.newRequestKey(), { ids }), await connected.snapshot(), "Native Type deletion hook failure");
    const host = await connected.prepare(), link = vi.spyOn(Link.prototype, "delete").mockRejectedValueOnce(new Error("Native Type Link sibling failure"));
    try { await refused(host.run(host.newRequestKey(), { ids }), await connected.snapshot(), "Native Type Link sibling failure"); } finally { link.mockRestore(); }
    const beforeAdmission = await connected.snapshot();
    await expect(connected.prepareWithoutEventBus()).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(await connected.snapshot()).toEqual(beforeAdmission);
    const inverse = await connected.prepareRoundtrip(); await refused(inverse.run(inverse.newRequestKey(), { ids, fail: true }), await connected.snapshot(), "Late native Type deletion inverse failure");
  }, 240_000);

  it("marks caught physical Type and Option deletion denials rollback-only and revokes escaped native callbacks", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes; let caught = 0, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.deleteShippingOptionTypes(args[0]); } catch { caught++; }
      try { await this.deleteShippingOptions(graph.page.optionIds); } catch { caught++; }
      return result;
    });
    try { const before = await connected.snapshot(); await refused(host.run(host.newRequestKey(), { ids: graph.failure.ids }), before, "rollbackOnly"); expect(caught).toBe(2);
      if (escaped === undefined) throw new Error("Missing escaped native callback"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("authenticates genuine deletion and explicit Link resource identities", async () => {
    const creation = await Effect.runPromise(makeShippingOptionTypeCreationCommands());
    const wrong = await Effect.runPromise(Effect.result(prepareShippingOptionTypeDeletionWorkflow({ ...connected.options, modules: { fulfillment: {
      // @ts-expect-error Genuine creation admission intentionally lacks Type lifecycle authority.
      ...connected.modules.fulfillment, module: creation.workflow } } })));
    expect(wrong).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    const copied = await Effect.runPromise(Effect.result(prepareShippingOptionTypeDeletionWorkflow({ ...connected.options,
      modules: { fulfillment: { ...connected.modules.fulfillment, module: { ...connected.fulfillment.workflow } } } })));
    expect(copied).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareShippingOptionTypeDeletionWorkflow({ ...connected.options, link: { ...connected.link } }))))).toBe(true);
  }, 120_000);

  it("rolls back cancellation and prevents a waiting native continuation from committing", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes, reached = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try { const before = await connected.snapshot(); await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.cancel.ids }));
      yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
    })); expect(await connected.snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing cancelled continuation"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines matching Type and request identities to the accepted scope", async () => {
    const other = await prepareLogicalShippingOptionTypeDeletion(driver, close => cleanup.push(close), [graph.scope], { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "shipping_type_delete_b", projectId: "shipping_type_delete_b", uuidOffset: 890_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.scope.ids }, old = await other.read(graph.scope.ids);
    await Effect.runPromise(left.run(key, input)); expect(await other.read(graph.scope.ids)).toEqual(old);
    await Effect.runPromise(right.run(key, input)); expect((await other.read(graph.scope.ids))[0]?.deleted_at).toEqual(expect.any(String));
    const before = await connected.snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input)); expect(await connected.snapshot()).toEqual(before);
  }, 240_000);

  it.skipIf(driver !== "postgres")("settles one optimistic winner for overlapping genuine Type deletion", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try { const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const first = yield* Effect.forkChild(left.run(left.newRequestKey(), { ids: graph.race.ids }).pipe(Effect.timeout(45_000)));
      const second = yield* Effect.forkChild(right.run(right.newRequestKey(), { ids: graph.race.ids }).pipe(Effect.timeout(45_000)));
      yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
      return [yield* Fiber.await(first), yield* Fiber.await(second)];
    }))); expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1); const failures = outcomes.filter(Exit.isFailure); expect(failures).toHaveLength(1);
      expect(reasons(failures[0]?.cause)).toContain("writeConflict");
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres").each(["insert", "restore"] as const)("invalidates empty native Option Query after competing canonical Option %s", async operation => {
    const selected = operation === "insert" ? graph.insertion : graph.restore, deletion = await connected.prepare();
    const canonical = await prepareShippingProfileOptionRaceFixture({ fixture: connected.fixture, logicalStorage: connected.modules.fulfillment.logicalStorage,
      afterStaged: Effect.void, operation, close: close => cleanup.push(close) });
    const row = operation === "insert" ? shippingOptionTypeDeletionGraph("sotype-delete-insertion", 1, { optionsPerType: 1 }).rows.find(value => value.table === "shipping_option")?.row
      : selected.rows.find(value => value.table === "shipping_option")?.row;
    if (row === undefined) throw new Error("Missing complete Option race fixture row");
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try { const before = await connected.snapshot(), outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const pending = yield* Effect.forkChild(deletion.run(deletion.newRequestKey(), { ids: selected.ids }).pipe(Effect.timeout(45_000)));
      yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
      yield* canonical.run(canonical.newRequestKey(), row).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      return yield* Fiber.await(pending);
    }))); expect(Exit.isFailure(outcome)).toBe(true); if (Exit.isFailure(outcome)) expect(reasons(outcome.cause)).toContain("writeConflict");
      expect((await connected.read(selected.ids))[0]?.deleted_at).toBeNull(); const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toEqual(before.events);
      await refused(deletion.run(deletion.newRequestKey(), { ids: selected.ids }), after, guard);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);

  it("recovers a lost accepted COMMIT acknowledgement without repeating native callbacks or messages", async () => {
    let lose = true, lost = 0; const fixture = connected.fixture;
    const session = issueRelationalSession(fixture.persistence.drizzle, (profile, work) => runRelationalSession(fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (profile !== "command" || !lose) return Effect.succeed(value); lose = false; lost++;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost Type deletion COMMIT acknowledgement") })); })));
    const host = await Effect.runPromise(prepareShippingOptionTypeDeletionWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: connected.execution.identityAndAccessPolicy, prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, session, ...composition }),
    } })); cleanup.push(() => Effect.runPromise(host.close));
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    try { const key = host.newRequestKey(), before = await connected.snapshot(), input = { ids: graph.uncertain.ids };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(lost).toBe(1); expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(); expect(after.commits).toHaveLength(before.commits.length + 1);
      expect(eventIds(after.events.slice(before.events.length), workflowDeleted)).toEqual(input.ids);
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(await connected.snapshot()).toEqual(after); expect(native).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);
});
