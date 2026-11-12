import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteLineItemsStep } from "@medusajs/core-flows/line-item/delete-line-items-step";
import { buildModuleResourceEventName, Modules } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";
import { cartLineHistoryMaximum } from "../src/modules/cart/mutation-input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareCoreCartFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
type Trace = { readonly call: Parameters<LogicalCallReceiptValidation>[0]; readonly activity: Parameters<LogicalCallReceiptValidation>[1] };
let connected: Awaited<ReturnType<typeof prepare>>;
async function prepare() {
  const cart = await Effect.runPromise(makeCartCreationWorkflowCommands());
  const { fixture } = await prepareCoreCartFixture(driver, close => cleanup.push(close), []);
  const nativeStorage = fixture.source("cart"), participant = defineAtomicCommerceParticipant("cartMutationProbe");
  const seed = defineAtomicCommerceCommand("cartMutationProbeSeed", (ctx, input) => ctx.call(participant, cart.create, input));
  const tax = defineAtomicCommerceCommand("cartMutationProbeTax", (ctx, input) => ctx.call(participant, cart.setItemTax, input));
  const adjustment = defineAtomicCommerceCommand("cartMutationProbeAdjustment", (ctx, input) => ctx.call(participant, cart.addItemAdjustments, input));
  const removeAdjustment = defineAtomicCommerceCommand("cartMutationProbeRemoveAdjustment", (ctx, input) => ctx.call(participant, cart.softDeleteItemAdjustments, input));
  const physicalDelete = defineAtomicCommerceCommand("cartMutationProbePhysicalDelete", (ctx, input) => ctx.call(participant, cart.deleteLines, input));
  const shippingTax = defineAtomicCommerceCommand("cartMutationProbeShippingTax", (ctx, input) => ctx.call(participant, cart.setShippingTax, input));
  const list = defineAtomicCommerceCommand("cartMutationProbeList", (ctx, input) => ctx.call(participant, cart.list, input));
  const policy = cart.logicalEventPolicy(), traces: Trace[] = [];
  const event = defineCommerceEventContract({ name: "nativeCartMutationEvents", revision: "a".repeat(64), internal: true, decode: policy.capture });
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy,
    participants: [{ participant, nativeStorage, commands: cart.commands, logicalResources: { ...defaultCommerceResources, calls: 512 },
      events: { contracts: [event], select: () => Effect.succeed(event) }, validateLogicalCall: Effect.fn("CartMutationProbe.observe")(function* (call, activity) {
        yield* policy.validateLogicalCall(call, activity); traces.push({ call, activity });
      }) }], requestCallLimit: 512, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    events: { producerRevision: "b".repeat(64), subscribers: [{ id: "native-cart-mutation-probe", revision: "c".repeat(64) }], contracts: [event],
      validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    commands: [seed, tax, adjustment, removeAdjustment, physicalDelete, shippingTax, list] }));
  cleanup.push(() => Effect.runPromise(host.close));
  const native = createWorkflow("native-cart-line-delete-retained-node", (input: WorkflowData<string[]>) => new WorkflowResponse(deleteLineItemsStep(input)));
  const node = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "delete-line-items");
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native LineItem deletion inverse");
  const invoke = node.invoke, compensate = node.compensate;
  const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: cart.workflow,
    methods: ["softDeleteLineItems", "restoreLineItems"], graph: false } }, true));
  const makeProbe = async (lateFailure: boolean, restore = true) => {
    const retained = createStep("native-cart-line-retained-inverse", resources.callback(async (ids: string[], context) => {
      const response = await invoke(ids, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native LineItem deletion payload");
      if (restore) await compensate(response.compensateInput, context);
      if (lateFailure) throw new Error("After native LineItem retained inverse");
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("native-cart-line-retained-inverse", (ids: WorkflowData<string[]>) => new WorkflowResponse(retained(ids)));
    const observed = { ...fixture.execution, prepare: (composition: Parameters<typeof fixture.execution.prepare>[0]) => fixture.execution.prepare({ ...composition,
      participants: composition.participants.map(registration => ({ ...registration,
        validateLogicalCall: Effect.fn("CartMutationProbe.observeInverse")(function* (call, activity, command) {
          if (registration.validateLogicalCall !== undefined) yield* registration.validateLogicalCall(call, activity, command);
          traces.push({ call, activity });
        }) })) }) };
    const prepared = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: observed,
      modules: { cart: { module: cart.workflow, nativeStorage, logicalResources: { ...defaultCommerceResources, calls: 512 } } },
      revision: "d".repeat(64), subscribers: [{ id: "native-cart-retained-inverse", revision: "e".repeat(64) }], requestCallLimit: 512,
      executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "nativeCartLineRetainedInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.Array(Schema.String).pipe(Schema.mutable), output: Schema.Null, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(prepared.close)); return prepared;
  };
  const run = (command: Parameters<typeof host.run>[1], input: Json) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
  await run(seed, [{ id: "cart-retained", currency_code: "usd", items: [{ id: "cali-retained", title: "Native retained item", quantity: 1, unit_price: 12.5 }] }]);
  await run(tax, { cart_id: "cart-retained", tax_lines: [{ item_id: "cali-retained", code: "NATIVE", rate: 10 }] });
  await run(adjustment, [{ item_id: "cali-retained", amount: 1, code: "RETAINED", promotion_id: "promo-retained" }]);
  const read = () => run(list, { filters: { id: "cart-retained" }, config: { relations: ["items", "items.tax_lines", "items.adjustments"] } });
  return { fixture, cart, policy, traces, read, makeProbe,
    createCart: (id: string, item: string) => run(seed, [{ id, currency_code: "usd", items: [{ id: item, title: "Native history item", quantity: 1, unit_price: 12.5 }] }]),
    setTax: (id: string, item: string, code: string) => run(tax, { cart_id: id, tax_lines: [{ item_id: item, code, rate: 10 }] }),
    addAdjustment: (code: string, item = "cali-retained") => run(adjustment, [{ item_id: item, amount: 1, code, promotion_id: "promo-retained" }]),
    removeAdjustment: (id: string) => run(removeAdjustment, [id]),
    addAdjustments: (item: string, count: number) => run(adjustment, Array.from({ length: count }, (_, index) => ({ item_id: item, amount: 1, code: "AUTHORED-" + index }))),
    setTaxes: (id: string, item: string, count: number) => run(tax, { cart_id: id,
      tax_lines: Array.from({ length: count }, (_, index) => ({ item_id: item, code: "AUTHORED-" + index, rate: 10 })) }),
    clearShippingTax: (id: string) => run(shippingTax, { cart_id: id, tax_lines: [] }),
    physicalDelete: (ids: string[]) => run(physicalDelete, ids) };
}
beforeAll(async () => { connected = await prepare(); }, 240_000);
afterAll(async () => { await finishOrderFixture(cleanup.reverse()); }, 120_000);

it("executes the genuine LineItem retained inverse with Tax and Adjustment cascades", async () => {
  const before = await connected.read(), probe = await connected.makeProbe(false);
  expect(await Effect.runPromise(probe.run(probe.newRequestKey(), ["cali-retained"]))).toBeNull();
  const after = await connected.read();
  expect(after).toMatchObject([{ id: "cart-retained", items: [{ id: "cali-retained", deleted_at: null,
    tax_lines: [{ code: "NATIVE", deleted_at: null }], adjustments: [{ code: "RETAINED", deleted_at: null }] }] }]);
  const stripManagedTimes = (input: Json): Json => Array.isArray(input) ? input.map(stripManagedTimes) : input !== null && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).filter(([name]) => name !== "updated_at").map(([name, value]) => [name, stripManagedTimes(value)])) : input;
  expect(stripManagedTimes(after)).toEqual(stripManagedTimes(before));
});

it("rolls back all native lifecycle facts after a late failure following the retained inverse", async () => {
  const before = await connected.fixture.snapshot(), probe = await connected.makeProbe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(probe.run(probe.newRequestKey(), ["cali-retained"])))).toBe(true);
  expect(await connected.fixture.snapshot()).toEqual(before);
});

it("refuses forged native lifecycle outcomes, unrelated observations and changed managed afterimages", async () => {
  const trace = connected.traces.find(trace => trace.call.commandName === "cartSoftDeleteLinesForMutations");
  if (trace === undefined || trace.activity.mutations[0]?.after === null || trace.activity.mutations[0]?.after === undefined)
    throw new Error("Missing real native lifecycle evidence");
  const check = (call: Trace["call"], activity: Trace["activity"]) => Effect.runPromiseExit(connected.policy.validateLogicalCall(call, activity));
  expect(Exit.isFailure(await check({ ...trace.call, result: { cart_line_item_id: ["unrelated"] } }, trace.activity))).toBe(true);
  expect(Exit.isFailure(await check(trace.call, { ...trace.activity, observedRows: [...trace.activity.observedRows,
    { table: "unrelated", row: { id: "unrelated" } }] }))).toBe(true);
  expect(Exit.isFailure(await check(trace.call, { ...trace.activity, mutations: trace.activity.mutations.map((mutation, index) => index !== 0 || mutation.after === null
    ? mutation : { ...mutation, after: { ...mutation.after, updated_at: "2000-01-01T00:00:00.000Z" } }) }))).toBe(true);
});

it("retains native updated events for already tombstoned cascade children and restores the full native cascade", async () => {
  const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })))(await connected.addAdjustment("PREVIOUS"));
  const priorId = rows[0]?.id;
  if (priorId === undefined) throw new Error("Missing native prior Adjustment");
  await connected.removeAdjustment(priorId);
  const probe = await connected.makeProbe(false);
  expect(await Effect.runPromise(probe.run(probe.newRequestKey(), ["cali-retained"]))).toBeNull();
  const trace = connected.traces.findLast(trace => trace.call.commandName === "cartSoftDeleteLinesForMutations");
  const updated = trace?.call.events.find(event => isJsonObject(event) && event.metadata !== undefined && isJsonObject(event.metadata) &&
    event.metadata.object === "line_item_adjustment" && event.metadata.action === "updated");
  if (trace === undefined || updated === undefined || !isJsonObject(updated) || updated.metadata === undefined || !isJsonObject(updated.metadata) ||
    updated.data === undefined || !isJsonObject(updated.data) || typeof updated.name !== "string")
    throw new Error("Missing genuine native repeated-deletion event");
  expect(Array.isArray(updated.data.id) ? updated.data.id : [updated.data.id]).toEqual([priorId]);
  const forged = { ...updated, name: updated.name.replace(/\.updated$/, ".deleted"), metadata: { ...updated.metadata, action: "deleted" } };
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall({ ...trace.call,
    events: trace.call.events.map(event => event === updated ? forged : event) }, trace.activity)))).toBe(true);
  // The retained native inverse restores every cascade identity, including a
  // child which was already deleted before its parent's forward callback.
  expect(await connected.read()).toMatchObject([{ items: [{ adjustments: expect.arrayContaining([
    expect.objectContaining({ id: priorId, code: "PREVIOUS", deleted_at: null }),
  ]) }] }]);
});

it("executes native deletion and its retained inverse across complete Tax and Adjustment history beyond authoring cohorts", async () => {
  const cart = "cart-native-history", item = "cali-native-history";
  await connected.createCart(cart, item);
  const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })));
  const taxIds: string[] = [], adjustmentIds: string[] = [];
  for (let ordinal = 0; ordinal < 10; ordinal++) {
    const tax = decodeRows(await connected.setTax(cart, item, "HISTORY-" + ordinal))[0]?.id;
    const adjustment = decodeRows(await connected.addAdjustment("HISTORY-" + ordinal, item))[0]?.id;
    if (tax === undefined || adjustment === undefined) throw new Error("Missing genuine native history row");
    taxIds.push(tax); adjustmentIds.push(adjustment);
    if (ordinal > 0) {
      const previous = adjustmentIds[ordinal - 1];
      if (previous === undefined) throw new Error("Missing prior native Adjustment");
      await connected.removeAdjustment(previous);
    }
  }
  const before = await connected.fixture.readRows("cart", [item, ...taxIds, ...adjustmentIds]);
  expect(before.filter(row => row.deleted_at === null)).toHaveLength(3);
  const probe = await connected.makeProbe(false);
  const key = probe.newRequestKey(), fault = connected.fixture.loseNextNativeRootAcknowledgement();
  const result = await Effect.runPromiseExit(probe.run(key, [item]));
  expect(Exit.isSuccess(result), Exit.isFailure(result) ? Cause.pretty(result.cause) : undefined).toBe(true);
  expect(fault).toMatchObject({ armed: false, failures: 1 });
  const trace = connected.traces.findLast(trace => trace.call.commandName === "cartSoftDeleteLinesForMutations");
  const inverse = connected.traces.findLast(trace => trace.call.commandName === "cartRestoreLinesForMutations");
  const firstEvent = trace?.call.events[0], firstTax = before.find(row => row.id === taxIds[0]);
  if (trace === undefined || inverse === undefined || firstEvent === undefined || firstTax === undefined)
    throw new Error("Missing native complete-history lifecycle evidence");
  const nativeMap = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Array(Schema.Union([
    Schema.NonEmptyString, Schema.Struct({ id: Schema.NonEmptyString }),
  ]))));
  const mappedIds = (value: unknown) => Object.values(nativeMap(value)).flatMap(rows => rows.map(row => typeof row === "string" ? row : row.id)).sort();
  expect(mappedIds(trace.call.result)).toEqual([item, ...taxIds, ...adjustmentIds].sort());
  expect(mappedIds(inverse.call.result)).toEqual([item, ...taxIds, ...adjustmentIds].sort());
  expect(inverse.call.events).toEqual([]);
  const decodeEvent = Schema.decodeUnknownSync(Schema.Struct({ metadata: Schema.Struct({ object: Schema.String, action: Schema.String }),
    data: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String)]) }) }));
  const events = trace.call.events.map(event => decodeEvent(event));
  for (const [object, ids] of [["line_item_tax_line", taxIds], ["line_item_adjustment", adjustmentIds]] as const) {
    expect(trace.activity.lifecycle.filter(change => change.table === "cart_" + object)).toHaveLength(ids.length);
    for (const [action, expected] of [["deleted", ids.slice(-1)], ["updated", ids.slice(0, -1)]] as const) {
      const actual = events.filter(event => event.metadata.object === object && event.metadata.action === action)
        .flatMap(event => typeof event.data.id === "string" ? [event.data.id] : event.data.id);
      expect(actual.sort()).toEqual([...expected].sort());
    }
  }
  expect(await connected.fixture.readRows("cart", taxIds)).toEqual(expect.arrayContaining(taxIds.map(id => expect.objectContaining({ id, deleted_at: null }))));
  expect(await connected.fixture.readRows("cart", adjustmentIds)).toEqual(expect.arrayContaining(adjustmentIds.map(id => expect.objectContaining({ id, deleted_at: null }))));
  const after = await connected.fixture.readRows("cart", [item, ...taxIds, ...adjustmentIds]);
  for (const row of before) {
    const current = after.find(current => current.id === row.id);
    if (current === undefined) throw new Error("Native inverse omitted a historical descendant");
    const { updated_at: _oldUpdated, deleted_at: _oldDeleted, ...previous } = row;
    const { updated_at: _newUpdated, deleted_at: _newDeleted, ...restored } = current;
    expect(restored).toEqual(previous); expect(current.deleted_at).toBeNull();
  }
  const committed = await connected.fixture.snapshot(), calls = connected.traces.length;
  expect(await Effect.runPromise(probe.run(key, [item]))).toBeNull();
  expect(connected.traces).toHaveLength(calls); expect(await connected.fixture.snapshot()).toEqual(committed);
  const late = await connected.makeProbe(true), failed = await Effect.runPromiseExit(late.run(late.newRequestKey(), [item]));
  expect(Exit.isFailure(failed)).toBe(true);
  if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("After native LineItem retained inverse");
  expect(await connected.fixture.snapshot()).toEqual(committed);
  for (const changed of [
    { ...trace, call: { ...trace.call, events: trace.call.events.slice(1) } },
    { ...trace, call: { ...trace.call, events: [...trace.call.events, firstEvent] } },
    { ...trace, activity: { ...trace.activity, lifecycle: trace.activity.lifecycle.slice(1) } },
    { ...trace, activity: { ...trace.activity, relationalReads: trace.activity.relationalReads.slice(1) } },
    { ...trace, activity: { ...trace.activity, observedRows: trace.activity.observedRows.filter(row => row.row.id !== taxIds[0]) } },
    { ...trace, activity: { ...trace.activity, observedRows: [...trace.activity.observedRows, {
      table: "cart_line_item_tax_line", row: { ...firstTax, id: "forged-extra-history" },
    }] } },
  ]) expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall(changed.call, changed.activity)))).toBe(true);
  const five = await Effect.runPromiseExit(probe.run(probe.newRequestKey(), [item, "root-2", "root-3", "root-4", "root-5"]));
  expect(Exit.isFailure(five)).toBe(true); expect(await connected.fixture.snapshot()).toEqual(committed);
  expect(await connected.physicalDelete([item])).toBeNull();
  expect(await connected.fixture.readRows("cart", [item, ...taxIds, ...adjustmentIds])).toEqual([]);
  const physical = connected.traces.findLast(trace => trace.call.commandName === "cartDeleteLinesForMutations");
  const parent = (await connected.fixture.readRows("cart", [cart]))[0];
  if (physical === undefined || parent === undefined) throw new Error("Missing genuine physical LineItem family evidence");
  const changedParent = { ...parent, metadata: { unrelated_writer: true } };
  for (const activity of [
    { ...physical.activity, observedRows: [...physical.activity.observedRows, {
      table: "cart_line_item_tax_line", row: { ...firstTax, id: "unrelated-history", item_id: "cali-retained" },
    }] },
    { ...physical.activity, observedRows: [...physical.activity.observedRows, { table: "cart", row: changedParent }],
      mutations: [...physical.activity.mutations, { ordinal: physical.activity.mutations.length, table: "cart", operation: "patch" as const,
        before: parent, after: changedParent }] },
  ]) expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall(physical.call, activity)))).toBe(true);
}, 120_000);

it("retains ordinary authored cohorts and exact refresh event receipts despite larger descendant event capture", async () => {
  const before = await connected.fixture.snapshot();
  await expect(connected.addAdjustments("cali-retained", 5)).rejects.toBeDefined();
  await expect(connected.setTaxes("cart-retained", "cali-retained", 5)).rejects.toBeDefined();
  expect(await connected.fixture.snapshot()).toEqual(before);
  const created = connected.traces.find(trace => trace.call.commandName === "cartAddItemAdjustmentsForCreation");
  if (created === undefined || created.call.events[0] === undefined) throw new Error("Missing genuine ordinary refresh event");
  const ids = Array.from({ length: 5 }, (_, index) => "extra-event-" + index);
  const event = { name: buildModuleResourceEventName({ prefix: Modules.CART, objectName: "line_item_adjustment", action: "created" }),
    metadata: { source: Modules.CART, object: "line_item_adjustment", action: "created" }, data: { id: ids } };
  expect(Exit.isSuccess(await Effect.runPromiseExit(connected.policy.capture(event)))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall({ ...created.call, events: [event] }, created.activity)))).toBe(true);
  await connected.clearShippingTax("cart-retained");
  const shipping = connected.traces.findLast(trace => trace.call.commandName === "cartSetShippingTaxForCreation");
  if (shipping === undefined) throw new Error("Missing genuine empty Shipping Tax refresh");
  const shippingEvent = { ...event,
    name: buildModuleResourceEventName({ prefix: Modules.CART, objectName: "shipping_method_tax_line", action: "created" }),
    metadata: { ...event.metadata, object: "shipping_method_tax_line" } };
  expect(Exit.isSuccess(await Effect.runPromiseExit(connected.policy.capture(shippingEvent)))).toBe(true);
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall({ ...shipping.call, events: [shippingEvent] }, shipping.activity)))).toBe(true);
  const rootEvent = { ...event,
    name: buildModuleResourceEventName({ prefix: Modules.CART, objectName: "line_item", action: "updated" }),
    metadata: { ...event.metadata, object: "line_item", action: "updated" }, data: { id: [...ids, "extra-6", "extra-7", "extra-8", "extra-9"] } };
  expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.capture(rootEvent)))).toBe(true);
});

it("retains shared native capacity refusal for overflowing complete history without lifecycle writes or events", async () => {
  const cartId = "cart-history-overflow", itemId = "cali-history-overflow";
  const oversized = await prepare();
  await oversized.createCart(cartId, itemId);
  // Every committed native refresh authors at most four rows and replaces the
  // previous active cohort. Complete stored history may exceed one request.
  for (let count = 0; count <= cartLineHistoryMaximum; count += 4) await oversized.setTaxes(cartId, itemId, 4);
  const history = (await oversized.fixture.readRows("cart")).filter(row => row.item_id === itemId && typeof row.rate === "number");
  expect(history.length).toBeGreaterThan(cartLineHistoryMaximum);
  expect(history.filter(row => row.deleted_at === null)).toHaveLength(4);
  const before = await oversized.fixture.snapshot(), probe = await oversized.makeProbe(false, false);
  const failed = await Effect.runPromiseExit(probe.run(probe.newRequestKey(), [itemId]));
  expect(Exit.isFailure(failed)).toBe(true);
  const reasons = (value: unknown): string[] => {
    if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? reasons(reason.error)
      : Cause.isDieReason(reason) ? reasons(reason.defect) : ["Interrupt"]);
    if (!(value instanceof Error)) return [];
    return [...("reason" in value && typeof value.reason === "string" ? [value.reason] : []), ...reasons(value.cause)];
  };
  if (Exit.isFailure(failed)) expect(reasons(failed.cause)).toEqual(expect.arrayContaining(["limitExceeded", "capacity"]));
  expect(oversized.traces.some(trace => trace.call.commandName === "cartSoftDeleteLinesForMutations")).toBe(false);
  expect(await oversized.fixture.snapshot()).toEqual(before);
}, 240_000);
