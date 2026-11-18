import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { Link } from "@medusajs/modules-sdk/link";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { CommerceTransactionError, commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { compileShippingProfileCoreDefinition } from "../src/modules/fulfillment/shipping-profile-schema";
import { makeShippingOptionTypeCreationCommands } from "../src/modules/fulfillment/shipping-option-type-service";
import { defineComposedWorkflowResource, composedWorkflowResourceDefinition } from "../src/workflow/composed-resource";
import { prepareShippingOptionTypeDeletionWorkflow } from "../src/workflows/fulfillment/delete-shipping-option-types";
import { prepareCoreShippingProfileOptionRaceFixture } from "./support/shipping-profile-option-race-fixture";
import { prepareCoreShippingOptionTypeDeletion } from "./support/core-shipping-option-type-deletion-fixture";
import { shippingOptionTypeDeletionGraph, shippingOptionTypeDeletionSeedTime } from "./support/shipping-option-type-deletion-seeds";
import { expectCheckoutRollback, expectCheckoutSettlement } from "./support/core-checkout-evidence";
import type { CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import { expectWorkflowDefect, expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreShippingOptionTypeDeletion>>, sharedCleanupCount = 0;
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
function eventIds(events: CoreNativeWorkflowSnapshot["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).map(event => {
    expect(event.envelope.internal).toBe(contract !== workflowDeleted);
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing Type event data");
    return text(message.data.id);
  });
}
function expectGuardRefusal(exit: Exit.Exit<unknown, unknown>) {
  const error = expectWorkflowRefusal(exit, "adapterFailure").cause;
  expect(error).toBeInstanceOf(MedusaError);
  expect(error).toMatchObject({ type: MedusaError.Types.INVALID_DATA, message: guard });
}

function expectBusinessSettlement(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string, ids: readonly string[]) {
  const timestamp = expectCheckoutSettlement(before, after, key);
  const changes = after.revisions.filter(row => row.timestamp === timestamp);
  expect(changes.map(row => row.value?.id).toSorted()).toEqual([...ids].sort());
  for (const change of changes) {
    expect(change.deleted).toBe(false);
    expect(after.indexes).toContainEqual(expect.objectContaining({ table: change.table, name: "by_id", id: change.id, timestamp }));
  }
  return timestamp;
}

function expectNoBusinessWrite(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot, key: string) {
  const outcomes = after.outcomes.slice(before.outcomes.length), [outcome] = outcomes;
  expect(outcomes).toMatchObject([{ value: { kind: "nativeRoot", key, state: "committed" } }]);
  expect(after.rows).toEqual(before.rows);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.indexes).toEqual(before.indexes);
  const published = [...after.events.slice(before.events.length), ...after.families.slice(before.families.length),
    ...after.deliveries.slice(before.deliveries.length)];
  for (const entry of published) expect(entry.timestamp).toBe(outcome?.timestamp);
}

async function expectFailedOutcome(key: string) {
  const { outcomes } = await connected.fixture.inventory();
  expect(outcomes.filter(row => row.value.key === key)).toMatchObject([{ value: { kind: "nativeRoot", key, state: "failed" } }]);
}

describe("genuine Shipping Option Type deletion with paginated Option Query and explicit native Link closure", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareCoreShippingOptionTypeDeletion(driver, close => cleanup.push(close), Object.values(graph)); sharedCleanupCount = cleanup.length; }, 300_000);
  afterEach(() => finishOrderFixture([connected.closeCaseHosts, ...cleanup.splice(sharedCleanupCount).reverse()]), 120_000);
  afterAll(() => finishOrderFixture(cleanup.reverse()), 120_000);

  it("retains all mandatory empty dependencies and rejects invalid input before native callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"),
      read = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingOptions"), link = vi.spyOn(Link.prototype, "delete");
    try {
      for (const input of [{ ids: "scalar" }, { ids: [""] }, { ids: ["a", "b", "c", "d", "e"] }, { ids: [], extra: true }]) {
        // @ts-expect-error Runtime public input decoder must refuse malformed native input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
      const before = await connected.snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native.mock.calls.map(call => call[0])).toEqual([[]]); expect(await native.mock.results[0]?.value).toEqual({});
      expect(read).toHaveBeenCalledTimes(1); expect(tuple(await read.mock.results[0]?.value)).toEqual([[], 0]);
      expect(link.mock.calls.map(call => call[0])).toEqual([endpoint([])]); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expectNoBusinessWrite(before, after, key); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); read.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("uses native take-one Query with actual count two and blocks active Options even when the Type is already deleted", async () => {
    const host = await connected.prepare(), read = vi.spyOn(FulfillmentModuleService.prototype, "listAndCountShippingOptions"),
      native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    try {
      const before = await connected.fixture.inventory(), pageKey = host.newRequestKey();
      expectGuardRefusal(await Effect.runPromiseExit(host.run(pageKey, { ids: graph.page.ids })));
      await expectCheckoutRollback(connected.fixture, before, pageKey);
      const [page, count] = tuple(await read.mock.results[0]?.value); expect(page).toEqual([{ id: graph.page.optionIds[0] }]); expect(count).toBe(2);
      expect(read.mock.calls[0]?.[0]).toEqual({ shipping_option_type_id: graph.page.ids });
      expect(read.mock.calls[0]?.[1]).toMatchObject({ select: ["id"], take: 1, skip: 0 });
      const historicalBefore = await connected.fixture.inventory(), historicalKey = host.newRequestKey();
      expectGuardRefusal(await Effect.runPromiseExit(host.run(historicalKey, { ids: graph.deletedBlocker.ids })));
      await expectCheckoutRollback(connected.fixture, historicalBefore, historicalKey);
      expect(native).not.toHaveBeenCalled(); expect(link).not.toHaveBeenCalled();
    } finally { read.mockRestore(); native.mockRestore(); link.mockRestore(); }
  }, 180_000);

  it("deletes four Types through the full root hook and native Link, publishes raw IDs and replays once", async () => {
    const ids = [...graph.maximum.ids].reverse(), native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    let hookCalls = 0, escaped: (() => Promise<unknown>) | undefined;
    const host = await connected.prepare({ shippingOptionTypesDeleted: (input, context) => {
      hookCalls++; expect(input).toEqual({ ids }); expect(native).toHaveBeenCalledTimes(1);
      expect(Object.keys(context.resources).sort()).toEqual(["event_bus", "fulfillment", "link", "query", "remoteQuery"]);
      expect(Reflect.get(context.resources, "remoteQuery")).toBe(context.resources.query);
      expect(Object.keys(context.resources.fulfillment).sort()).toEqual(["restoreShippingOptionTypes", "softDeleteShippingOptionTypes"]);
      escaped = () => context.resources.fulfillment.restoreShippingOptionTypes(ids);
    } });
    try {
      const before = await connected.snapshot(), old = await connected.read(ids), neighbors = await connected.read(graph.neighbor.ids), key = host.newRequestKey(); let calls = 0;
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(native.mock.calls[0]?.[0]).toEqual(ids); expect(await native.mock.results[0]?.value).toEqual({ shipping_option_type_id: [...graph.maximum.ids] });
      expect(link).toHaveBeenCalledExactlyOnceWith(endpoint(ids)); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const current = await connected.read(ids); expect(current.map(stable)).toEqual(old.map(stable));
      for (const row of current) { expect(row.deleted_at).toEqual(expect.any(String)); expect(row.updated_at).not.toBe(shippingOptionTypeDeletionSeedTime); }
      expect(await connected.read(graph.neighbor.ids)).toEqual(neighbors);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, moduleDeleted)).toEqual(graph.maximum.ids); expect(eventIds(emitted, workflowDeleted)).toEqual(ids);
      expect(emitted.length).toBeLessThanOrEqual(defaultCommerceResources.eventMessages);
      expectBusinessSettlement(before, after, key, ids);
      expect(await Effect.runPromise(host.run(key, { ids }))).toBeNull(); expect(hookCalls).toBe(1); expect(native).toHaveBeenCalledTimes(1); expect(await connected.snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, { ids: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
      const changed = await connected.prepare({}, "b".repeat(64)); await expect(Effect.runPromise(changed.run(key, { ids }))).rejects.toMatchObject({ reason: "requestConflict" });
      if (escaped === undefined) throw new Error("Missing escaped Type hook method"); await expect(escaped()).rejects.toBeDefined(); expect(await connected.snapshot()).toEqual(after);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("runs the full four-Type root and genuine retained Link then Type inverse under unchanged resource limits", async () => {
    const host = await connected.prepareRoundtrip(), ids = [...graph.roundtrip.ids].reverse(), beforeRows = await connected.read(ids), before = await connected.snapshot();
    const key = host.newRequestKey();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "restoreShippingOptionTypes"), link = vi.spyOn(Link.prototype, "restore"); let calls = 0;
    try {
      expect(await Effect.runPromise(host.run(key, { ids }).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(defaultCommerceResources.calls);
      expect(link.mock.calls[0]?.[0]).toEqual(endpoint(ids)); expect(native.mock.calls[0]?.[0]).toEqual(ids);
      expect(link.mock.invocationCallOrder[0]).toBeLessThan(native.mock.invocationCallOrder[0]!);
      expect((await connected.read(ids)).map(stable)).toEqual(beforeRows.map(stable)); expect((await connected.read(ids)).every(row => row.deleted_at === null)).toBe(true);
      const after = await connected.snapshot(), emitted = after.events.slice(before.events.length);
      expect(eventIds(emitted, moduleDeleted)).toEqual(graph.roundtrip.ids); expect(eventIds(emitted, moduleRestored)).toEqual(graph.roundtrip.ids);
      expect(eventIds(emitted, workflowDeleted)).toEqual(ids); expectBusinessSettlement(before, after, key, ids);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 240_000);

  it("keeps raw duplicates and missing workflow messages while module maps contain only changed rows", async () => {
    const host = await connected.prepare(), id = first(graph.duplicates), ids = ["missing-native-type", id, id], native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes");
    try {
      const before = await connected.snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids }))).toBeNull();
      expect(await native.mock.results[0]?.value).toEqual({ shipping_option_type_id: [id] });
      const firstState = await connected.snapshot(); expect(eventIds(firstState.events.slice(before.events.length), moduleDeleted)).toEqual([id]);
      expect(eventIds(firstState.events.slice(before.events.length), workflowDeleted)).toEqual(ids);
      const repeatKey = host.newRequestKey();
      expect(await Effect.runPromise(host.run(repeatKey, { ids }))).toBeNull(); expect(await native.mock.results[1]?.value).toEqual({});
      const repeated = await connected.snapshot(); expectNoBusinessWrite(firstState, repeated, repeatKey);
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
    try { const before = await connected.snapshot(), key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(native).not.toHaveBeenCalled(); expect(link).toHaveBeenCalledExactlyOnceWith(endpoint([])); expect(await link.mock.results[0]?.value).toEqual([null, {}]);
      const after = await connected.snapshot(); expectNoBusinessWrite(before, after, key); expect(after.events).toEqual(before.events);
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
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      expectWorkflowRefusal(await Effect.runPromiseExit(host.run(key, { ids: graph.page.ids })), "receiptMismatch");
      expect(native).not.toHaveBeenCalled();
      await expectCheckoutRollback(connected.fixture, before, key);
    }
    finally { native.mockRestore(); read.mockRestore(); }
  }, 180_000);

  it("rolls back hook, parallel Link and late inverse failures and refuses Event Bus omission at admission", async () => {
    const ids = graph.failure.ids, hookError = new Error("Native Type deletion hook failure");
    const hook = await connected.prepare({ shippingOptionTypesDeleted: () => { throw hookError; } });
    const hookBefore = await connected.fixture.inventory(), hookKey = hook.newRequestKey();
    expectWorkflowDefect(await Effect.runPromiseExit(hook.run(hookKey, { ids })), hookError);
    await expectCheckoutRollback(connected.fixture, hookBefore, hookKey);

    const host = await connected.prepare(), linkError = new Error("Native Type Link sibling failure");
    const link = vi.spyOn(Link.prototype, "delete").mockRejectedValueOnce(linkError);
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const exit = await Effect.runPromiseExit(host.run(key, { ids }));
      if (Exit.isSuccess(exit)) throw new Error("Expected the parallel Type Link defect");
      const reasons = exit.cause.reasons;
      expect(reasons).toHaveLength(3);
      expect(reasons.filter(Cause.isInterruptReason)).toEqual([]);
      const defects = reasons.filter(Cause.isDieReason);
      expect(defects).toHaveLength(1); expect(defects[0]?.defect).toBe(linkError);
      const rollbacks = reasons.filter(Cause.isFailReason).map(reason => reason.error);
      expect(rollbacks).toHaveLength(2);
      for (const rollback of rollbacks) {
        expect(rollback).toBeInstanceOf(CommerceTransactionError);
        expect(rollback.reason).toBe("rollbackOnly");
      }
      const [captured] = rollbacks.filter(rollback => rollback.cause !== undefined);
      expect(rollbacks.filter(rollback => rollback.cause === undefined)).toHaveLength(1);
      // The parallel Event Bus sibling can observe the sticky Link failure
      // during capture. Its rollback retains the same original defect.
      const nested = captured?.cause;
      if (!Cause.isCause(nested)) throw new Error("Missing captured parallel Link Cause");
      const [nestedDefect] = nested.reasons;
      expect(nested.reasons).toHaveLength(1);
      if (nestedDefect === undefined || !Cause.isDieReason(nestedDefect)) throw new Error("Missing captured parallel Link defect");
      expect(nestedDefect.defect).toBe(linkError);
      await expectCheckoutRollback(connected.fixture, before, key);
    } finally { link.mockRestore(); }
    const beforeAdmission = await connected.fixture.inventory();
    await expect(connected.prepareWithoutEventBus()).rejects.toMatchObject({ reason: "unsupportedProfile" });
    expect(await connected.fixture.inventory()).toEqual(beforeAdmission);

    const inverseError = new Error("Late native Type deletion inverse failure"), inverse = await connected.prepareRoundtrip(inverseError);
    const inverseBefore = await connected.fixture.inventory(), inverseKey = inverse.newRequestKey();
    expectWorkflowDefect(await Effect.runPromiseExit(inverse.run(inverseKey, { ids })), inverseError);
    await expectCheckoutRollback(connected.fixture, inverseBefore, inverseKey);
  }, 240_000);

  it("marks caught physical Type and Option deletion denials rollback-only and revokes escaped native callbacks", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes;
    for (const target of ["type", "option"] as const) {
      let caught: unknown, escaped: (() => Promise<unknown>) | undefined;
      const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
        const result = await Reflect.apply(original, this, args);
        escaped = () => Reflect.apply(original, this, args);
        // Reuse the native call's manager so each denial reaches the DAL.
        try {
          if (target === "type") await this.deleteShippingOptionTypes(args[0], args[2]);
          else await this.deleteShippingOptions(graph.page.optionIds, args[2]);
        } catch (error) { caught = error; }
        return result;
      });
      try {
        const before = await connected.fixture.inventory(), key = host.newRequestKey();
        const exit = await Effect.runPromiseExit(host.run(key, { ids: graph.failure.ids }));
        expect(caught).toBe(expectWorkflowRefusal(exit, "unsupportedProfile"));
        await expectCheckoutRollback(connected.fixture, before, key);
        if (escaped === undefined) throw new Error("Missing escaped native callback");
        await expect(escaped()).rejects.toBeDefined();
        await expectCheckoutRollback(connected.fixture, before, key);
      } finally { native.mockRestore(); }
    }
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
    const before = await connected.fixture.inventory(), prepare = vi.fn(() => Effect.fail(commerceError("unsupportedProfile")));
    const execution = { ...connected.options.execution, prepare }, options = { ...connected.options, execution };
    const copiedLink = await Effect.runPromiseExit(prepareShippingOptionTypeDeletionWorkflow({ ...options, link: { ...connected.link } }));
    expect(expectWorkflowTypedFailures(copiedLink).map(failure => failure.reason)).toEqual(["invalidAuthority"]);
    const genuine = composedWorkflowResourceDefinition(connected.link);
    if (genuine?.kind !== "promise") throw new Error("Missing admitted Type deletion Link resource");
    const otherLink = Result.getOrThrow(defineComposedWorkflowResource({ identity: genuine.identity, dependencies: [],
      methods: { delete: genuine.methods.delete!, restore: genuine.methods.restore! },
      bind: () => ({ delete: async () => [null, {}], restore: async () => [null, {}] }),
    }));
    const foreignLink = await Effect.runPromiseExit(prepareShippingOptionTypeDeletionWorkflow({ ...options,
      // @ts-expect-error An independently issued lookalike lacks the genuine Type Link ABI.
      link: otherLink,
    }));
    expect(expectWorkflowTypedFailures(foreignLink).map(failure => failure.reason)).toEqual(["invalidAuthority"]);

    const installed = connected.fixture.sources.find(source => source.source === connected.modules.fulfillment.nativeStorage);
    if (installed === undefined) throw new Error("Missing installed Fulfillment source");
    const { scopeUuid, epochUuid } = installed.definition.identity;
    const scalar = await Effect.runPromise(compileShippingProfileCoreDefinition({ scopeUuid, epochUuid }));
    const wrongSlot = Result.getOrThrow(defineAtomicCommerceNativeSource("other", installed.definition));
    const incompleteSource = Result.getOrThrow(defineAtomicCommerceNativeSource("fulfillment", scalar));
    for (const nativeStorage of [wrongSlot, incompleteSource]) {
      const exit = await Effect.runPromiseExit(prepareShippingOptionTypeDeletionWorkflow({ ...options,
        modules: { fulfillment: { ...connected.modules.fulfillment, nativeStorage } } }));
      expect(expectWorkflowTypedFailures(exit).map(failure => failure.reason)).toEqual(["invalidAuthority"]);
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(await connected.fixture.inventory()).toEqual(before);
  }, 120_000);

  it("rolls back cancellation and prevents a waiting native continuation from committing", async () => {
    const host = await connected.prepare(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes;
    const reached = Deferred.makeUnsafe<void>(), finished = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await wait;
      await Effect.runPromise(Deferred.succeed(finished, undefined)); return result;
    });
    try {
      const before = await connected.fixture.inventory(), key = host.newRequestKey();
      const exit = await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(key, { ids: graph.cancel.ids }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      await expectCheckoutRollback(connected.fixture, before, key);
      finish?.(); await Effect.runPromise(Deferred.await(finished).pipe(Effect.timeout(5_000)));
      if (escaped === undefined) throw new Error("Missing cancelled continuation");
      await expect(escaped()).rejects.toBeDefined(); await expectCheckoutRollback(connected.fixture, before, key);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it("confines matching Type and request identities to the accepted scope", async () => {
    const other = await prepareCoreShippingOptionTypeDeletion(driver, close => cleanup.push(close), [graph.scope], connected.fixture.physical);
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { ids: graph.scope.ids };
    const before = await connected.snapshot(), beforeOther = await other.snapshot();
    await Effect.runPromise(left.run(key, input)); expect(await other.snapshot()).toEqual(beforeOther);
    await Effect.runPromise(right.run(key, input)); expect((await other.read(graph.scope.ids))[0]?.deleted_at).toEqual(expect.any(String));
    const after = await connected.snapshot(), afterOther = await other.snapshot();
    expectBusinessSettlement(before, after, key, graph.scope.ids);
    expectBusinessSettlement(beforeOther, afterOther, key, graph.scope.ids);
    await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input));
    expect(await connected.snapshot()).toEqual(after); expect(await other.snapshot()).toEqual(afterOther);
  }, 240_000);

  it("settles one optimistic winner for overlapping genuine Type deletion", async () => {
    const left = await connected.prepare(), right = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes; let arrivals = 0;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (++arrivals === 2) await Effect.runPromise(Deferred.succeed(reached, undefined));
      await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), leftKey = left.newRequestKey(), rightKey = right.newRequestKey(), input = { ids: graph.race.ids };
      const outcomes = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const first = yield* Effect.forkChild(left.run(leftKey, input).pipe(Effect.timeout(45_000)));
        const second = yield* Effect.forkChild(right.run(rightKey, input).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000), Effect.ensuring(Deferred.succeed(release, undefined)));
        return [yield* Fiber.await(first), yield* Fiber.await(second)] as const;
      })));
      expect(arrivals).toBe(2); expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
      const [winner, winnerKey, loserKey, loser] = Exit.isSuccess(outcomes[0])
        ? [left, leftKey, rightKey, outcomes[1]] as const : [right, rightKey, leftKey, outcomes[0]] as const;
      expect(expectWorkflowTypedFailures(loser).map(failure => failure.reason)).toEqual(["writeConflict"]);
      const after = await connected.snapshot();
      expectBusinessSettlement(before, after, winnerKey, graph.race.ids);
      await expectFailedOutcome(loserKey);
      expect(eventIds(after.events.slice(before.events.length), workflowDeleted)).toEqual(graph.race.ids);
      expect(await Effect.runPromise(winner.run(winnerKey, input))).toBeNull();
      expect(arrivals).toBe(2); expect(await connected.snapshot()).toEqual(after);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);

  it.each(["insert", "restore"] as const)("invalidates empty native Option Query after competing canonical Option %s", async operation => {
    const selected = operation === "insert" ? graph.insertion : graph.restore, deletion = await connected.prepare();
    const canonical = await prepareCoreShippingProfileOptionRaceFixture({ fixture: connected.fixture, afterStaged: Effect.void, operation, close: close => cleanup.push(close) });
    const row = operation === "insert" ? shippingOptionTypeDeletionGraph("sotype-delete-insertion", 1, { optionsPerType: 1 }).rows.find(value => value.table === "shipping_option")?.row
      : selected.rows.find(value => value.table === "shipping_option")?.row;
    if (row === undefined) throw new Error("Missing complete Option race fixture row");
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>(), original = FulfillmentModuleService.prototype.softDeleteShippingOptionTypes;
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes").mockImplementation(async function (this: FulfillmentModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await Effect.runPromise(Deferred.await(release)); return result;
    });
    try {
      const before = await connected.snapshot(), deletionKey = deletion.newRequestKey(), optionKey = canonical.newRequestKey();
      const outcome = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(deletion.run(deletionKey, { ids: selected.ids }).pipe(Effect.timeout(45_000)));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* canonical.run(optionKey, row).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        return yield* Fiber.await(pending);
      })));
      expect(expectWorkflowTypedFailures(outcome).map(failure => failure.reason)).toEqual(["writeConflict"]);
      const optionId = text(row.id), after = await connected.snapshot();
      expectBusinessSettlement(before, after, optionKey, [optionId]);
      await expectFailedOutcome(deletionKey);
      expect((await connected.read(selected.ids))[0]?.deleted_at).toBeNull();
      expect(await connected.read([optionId])).toEqual([expect.objectContaining({ ...stable(row), deleted_at: null })]);
      expect(after.events).toEqual(before.events);
      const beforeRefusal = await connected.fixture.inventory(), repeatedKey = deletion.newRequestKey();
      expectGuardRefusal(await Effect.runPromiseExit(deletion.run(repeatedKey, { ids: selected.ids })));
      await expectCheckoutRollback(connected.fixture, beforeRefusal, repeatedKey);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); native.mockRestore(); }
  }, 180_000);

  it("recovers a lost accepted COMMIT acknowledgement without repeating native callbacks or messages", async () => {
    const host = await connected.prepare(), fault = connected.fixture.loseNextNativeRootAcknowledgement();
    const native = vi.spyOn(FulfillmentModuleService.prototype, "softDeleteShippingOptionTypes"), link = vi.spyOn(Link.prototype, "delete");
    try { const key = host.newRequestKey(), before = await connected.snapshot(), input = { ids: graph.uncertain.ids };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
      const after = await connected.snapshot(), inventory = await connected.fixture.inventory();
      const timestamp = expectBusinessSettlement(before, after, key, input.ids);
      expect(fault).toMatchObject({ armed: false, failures: 1, evidence: { timestamp } });
      expect(fault.evidence?.inventory).toEqual(inventory);
      expect(eventIds(after.events.slice(before.events.length), workflowDeleted)).toEqual(input.ids);
      await Effect.runPromise(host.close);
      const reopened = await connected.prepare();
      expect(await Effect.runPromise(reopened.run(key, input))).toBeNull();
      expect(await connected.fixture.inventory()).toEqual(inventory);
      expect(native).toHaveBeenCalledTimes(1); expect(link).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); link.mockRestore(); }
  }, 180_000);
});
