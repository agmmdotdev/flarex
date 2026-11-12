import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteLineItemsStep } from "@medusajs/core-flows/line-item/delete-line-items-step";
import type { ICartModuleService } from "@medusajs/types";
import { addShippingMethodToCartStep } from "@medusajs/core-flows/cart/add-shipping-method-to-cart-step";
import { removeShippingMethodFromCartStep } from "@medusajs/core-flows/cart/remove-shipping-method-from-cart-step";
import { buildModuleResourceEventName, Modules } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";
import { cartLineHistoryMaximum } from "../src/modules/cart/mutation-input";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareCoreCartFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
type Trace = { readonly call: Parameters<LogicalCallReceiptValidation>[0]; readonly activity: Parameters<LogicalCallReceiptValidation>[1] };
let connected: Awaited<ReturnType<typeof prepare>>;
async function prepare(profile: "cart" | "cart-shipping" = "cart", rows: Parameters<typeof prepareCoreCartFixture>[2] = []) {
  const cart = await Effect.runPromise(makeCartCreationWorkflowCommands(profile));
  const { fixture } = await prepareCoreCartFixture(driver, close => cleanup.push(close), rows);
  const nativeStorage = fixture.source("cart"), participant = defineAtomicCommerceParticipant("cartMutationProbe");
  const seed = defineAtomicCommerceCommand("cartMutationProbeSeed", (ctx, input) => ctx.call(participant, cart.create, input));
  const tax = defineAtomicCommerceCommand("cartMutationProbeTax", (ctx, input) => ctx.call(participant, cart.setItemTax, input));
  const adjustment = defineAtomicCommerceCommand("cartMutationProbeAdjustment", (ctx, input) => ctx.call(participant, cart.addItemAdjustments, input));
  const removeAdjustment = defineAtomicCommerceCommand("cartMutationProbeRemoveAdjustment", (ctx, input) => ctx.call(participant, cart.softDeleteItemAdjustments, input));
  const physicalDelete = defineAtomicCommerceCommand("cartMutationProbePhysicalDelete", (ctx, input) => ctx.call(participant, cart.deleteLines, input));
  const shippingTax = defineAtomicCommerceCommand("cartMutationProbeShippingTax", (ctx, input) => ctx.call(participant, cart.setShippingTax, input));
  const list = defineAtomicCommerceCommand("cartMutationProbeList", (ctx, input) => ctx.call(participant, cart.list, input));
  const definition = workflowModuleDefinition(cart.workflow);
  if (definition === undefined) throw new Error("Missing genuine Cart workflow module");
  const graph = Result.getOrThrow(prepareLocalGraph([{ participant, module: definition.graph }]));
  const shippingGraph = defineAtomicCommerceCommand("cartShippingProbeGraph", Effect.fn("CartShippingProbe.graph")(function* (ctx, input) {
    if (typeof input !== "string") return yield* commerceError("invalidInput");
    return (yield* graph.bind(ctx).graph({ entity: "cart", filters: { id: input }, pagination: { take: 1 },
      fields: ["id", "total", "shipping_total", "shipping_tax_total", "shipping_discount_total", "shipping_methods.*", "shipping_methods.tax_lines.*", "shipping_methods.adjustments.*"] })).data;
  }));
  const shippingTaxGraph = defineAtomicCommerceCommand("cartShippingProbeTaxGraph", Effect.fn("CartShippingProbe.taxGraph")(function* (ctx, input) {
    if (typeof input !== "string") return yield* commerceError("invalidInput");
    return (yield* graph.bind(ctx).graph({ entity: "cart", filters: { id: input }, pagination: { take: 1 },
      fields: ["id", "shipping_methods.tax_lines.id", "shipping_methods.tax_lines.description", "shipping_methods.tax_lines.code",
        "shipping_methods.tax_lines.rate", "shipping_methods.tax_lines.provider_id", "shipping_methods.shipping_option_id", "shipping_methods.amount"] })).data;
  }));
  const root = (name: string, command: (typeof cart.commands)[number]) => defineAtomicCommerceCommand(name, (ctx, input) => ctx.call(participant, command, input));
  const shippingRoots = {
    add: root("cartShippingProbeAdd", cart.addShipping), list: root("cartShippingProbeList", cart.listShipping),
    update: root("cartShippingProbeUpdate", cart.updateShipping), delete: root("cartShippingProbeDelete", cart.deleteShipping),
    softDelete: root("cartShippingProbeSoftDelete", cart.softDeleteShipping), restore: root("cartShippingProbeRestore", cart.restoreShipping),
    upsertTax: root("cartShippingProbeUpsertTax", cart.upsertShippingTax), setTax: shippingTax,
    addAdjustment: root("cartShippingProbeAddAdjustment", cart.addShippingAdjustments),
    removeAdjustment: root("cartShippingProbeRemoveAdjustment", cart.softDeleteShippingAdjustments),
    restoreAdjustment: root("cartShippingProbeRestoreAdjustment", cart.restoreShippingAdjustments),
  };
  const shippingLateFailure = defineAtomicCommerceCommand("cartShippingProbeLateFailure", Effect.fn("CartShippingProbe.lateFailure")(function* (ctx, input) {
    if (typeof input !== "string") return yield* commerceError("invalidInput");
    yield* ctx.call(participant, cart.updateShipping, [{ id: input, amount: 88 }]);
    yield* ctx.call(participant, cart.upsertShippingTax, [{ shipping_method_id: input, code: "ROLLBACK", rate: 10 }]);
    yield* ctx.call(participant, cart.addShippingAdjustments, [{ shipping_method_id: input, amount: 2, code: "ROLLBACK" }]);
    return yield* commerceError("resourceFailure", new Error("After real Shipping child writes"));
  }));
  const policy = cart.logicalEventPolicy(), traces: Trace[] = [];
  const event = defineCommerceEventContract({ name: "nativeCartMutationEvents", revision: "a".repeat(64), internal: true, decode: policy.capture });
  const host = await Effect.runPromise(fixture.execution.prepare({ identityAndAccessPolicy: fixture.execution.identityAndAccessPolicy,
    participants: [{ participant, nativeStorage, commands: cart.commands, logicalResources: { ...defaultCommerceResources, calls: 512 },
      events: { contracts: [event], select: () => Effect.succeed(event) }, validateLogicalCall: Effect.fn("CartMutationProbe.observe")(function* (call, activity) {
        yield* policy.validateLogicalCall(call, activity); traces.push({ call, activity });
      }) }], requestCallLimit: 512, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    events: { producerRevision: "b".repeat(64), subscribers: [{ id: "native-cart-mutation-probe", revision: "c".repeat(64) }], contracts: [event],
      validate: messages => messages.some(message => !message.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    commands: [seed, tax, adjustment, removeAdjustment, physicalDelete, shippingTax, list, shippingGraph, shippingTaxGraph,
      ...Object.values(shippingRoots).filter(command => command !== shippingTax), shippingLateFailure] }));
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
  const makeShippingProbe = async (operation: "add" | "remove", populate = false) => {
    const add = createWorkflow("native-shipping-add-node", (input: WorkflowData<string>) => new WorkflowResponse(addShippingMethodToCartStep({
      shipping_methods: [{ cart_id: input, name: "Native inverse", amount: 4 }],
    })));
    const remove = createWorkflow("native-shipping-remove-node", (input: WorkflowData<string>) => new WorkflowResponse(removeShippingMethodFromCartStep({ shipping_method_ids: [input] })));
    const node = Result.getOrThrow((operation === "add" ? add : remove).prepare()).nodes.find(node => node.name === (operation === "add"
      ? "add-shipping-method-to-cart-step" : "remove-shipping-method-to-cart-step"));
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native Shipping retained inverse");
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: cart.workflow,
      methods: ["addShippingMethods", "deleteShippingMethods", "softDeleteShippingMethods", "restoreShippingMethods", "upsertShippingMethodTaxLines"], graph: false } }, true));
    const invoke = node.invoke, compensate = node.compensate;
    const retained = createStep("native-cart-shipping-retained-inverse", resources.callback(async (id: string, context) => {
      const response = await invoke(operation === "add" ? { shipping_methods: [{ cart_id: id, name: "Native inverse", amount: 4 }] }
        : { shipping_method_ids: [id] }, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Shipping inverse payload");
      if (populate) {
        const rows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })))(response.compensateInput);
        const method = rows[0];
        if (method === undefined) throw new Error("Missing created native Shipping method");
        await context.container.resolve<ICartModuleService>(Modules.CART).upsertShippingMethodTaxLines([{ shipping_method_id: method.id, code: "INVERSE", rate: 10 }]);
      }
      await compensate(response.compensateInput, context);
      return new StepResponse(null);
    }));
    const workflow = createWorkflow("native-cart-shipping-retained-inverse", (id: WorkflowData<string>) => new WorkflowResponse(retained(id)));
    const prepared = await Effect.runPromise(prepareAtomicWorkflowHost({ execution: fixture.execution,
      modules: { cart: { module: cart.workflow, nativeStorage, logicalResources: { ...defaultCommerceResources, calls: 512 } } },
      revision: "f".repeat(64), subscribers: [{ id: "native-cart-shipping-retained-inverse", revision: "e".repeat(64) }], requestCallLimit: 512,
      executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "nativeCartShippingRetainedInverse", resources, prepared: Result.getOrThrow(workflow.prepare()),
        input: Schema.String, output: Schema.Null, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(prepared.close)); return prepared;
  };
  await run(seed, [{ id: "cart-retained", currency_code: "usd", ...(profile === "cart-shipping" ? { sales_channel_id: "sc-shipping-owner" } : {}),
    items: [{ id: "cali-retained", title: "Native retained item", quantity: 1, unit_price: 12.5 }] }]);
  await run(tax, { cart_id: "cart-retained", tax_lines: [{ item_id: "cali-retained", code: "NATIVE", rate: 10 }] });
  await run(adjustment, [{ item_id: "cali-retained", amount: 1, code: "RETAINED", promotion_id: "promo-retained" }]);
  const read = () => run(list, { filters: { id: "cart-retained" }, config: { relations: ["items", "items.tax_lines", "items.adjustments"] } });
  return { fixture, cart, policy, traces, read, makeProbe, makeShippingProbe,
    createEmptyCart: (id: string, channel?: string | null) => run(seed, [{ id, currency_code: "usd", ...(channel === undefined ? {} : { sales_channel_id: channel }) }]),
    readShippingCart: (id: string) => run(list, { filters: { id }, config: { relations: ["shipping_methods", "shipping_methods.tax_lines", "shipping_methods.adjustments"] } }),
    readCartAttempt: (id: string) => host.run(host.newRequestKey(), list, { filters: { id }, config: { select: ["id"] } }),
    readShippingGraph: (id: string) => run(shippingGraph, id),
    readShippingTaxGraph: (id: string) => run(shippingTaxGraph, id),
    shipping: (operation: keyof typeof shippingRoots, input: Json) => run(shippingRoots[operation], input),
    shippingAttempt: (operation: keyof typeof shippingRoots, input: Json) => host.run(host.newRequestKey(), shippingRoots[operation], input),
    shippingLateFailure: (id: string) => host.run(host.newRequestKey(), shippingLateFailure, id),
    shippingReplay: (key: string, input: Json) => host.run(key, shippingRoots.add, input),
    newRequestKey: () => host.newRequestKey(),
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

const shippingRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })));
const shippingId = (value: Json) => {
  const id = shippingRows(value)[0]?.id;
  if (id === undefined) throw new Error("Missing real native Shipping row");
  return id;
};
const lifecycleIds = (value: Json) => Object.values(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Array(Schema.Union([
  Schema.NonEmptyString, Schema.Struct({ id: Schema.NonEmptyString }),
]))))(value)).flatMap(rows => rows.map(row => typeof row === "string" ? row : row.id));
const failureReasons = (value: unknown): string[] => {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failureReasons(reason.error)
    : Cause.isDieReason(reason) ? failureReasons(reason.defect) : ["Interrupt"]);
  if (!(value instanceof Error)) return [];
  return [...("reason" in value && typeof value.reason === "string" ? [value.reason] : []), ...failureReasons(value.cause)];
};

it("executes native Shipping CRUD, Tax and Adjustment writes with root-only soft deletion and restore", async () => {
  const cart = "cart-shipping-owner";
  await connected.createEmptyCart(cart);
  const added = await connected.shipping("add", [{ cart_id: cart, name: "Manual delivery", amount: "10.25", data: { delivery: "door" } }]);
  for (const row of Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(added)) expect(row).not.toHaveProperty("subtotal");
  const method = shippingId(added);
  expect(await connected.shipping("list", { filters: { cart_id: cart }, config: { select: ["id", "name", "amount", "data"] } }))
    .toMatchObject([{ id: method, name: "Manual delivery", amount: 10.25, data: { delivery: "door" } }]);
  expect(await connected.shipping("update", [{ id: method, name: "Updated delivery", amount: "12.5", metadata: { owner: "native" } }]))
    .toMatchObject([{ id: method, name: "Updated delivery", amount: 12.5, metadata: { owner: "native" } }]);
  const tax = shippingId(await connected.shipping("upsertTax", [{ shipping_method_id: method, code: "UPsert", rate: 10 }]));
  expect(await connected.shipping("upsertTax", [{ id: tax, shipping_method_id: method, code: "UPDATED", rate: 11 }]))
    .toMatchObject([{ id: tax, code: "UPDATED", rate: 11 }]);
  const replacement = shippingId(await connected.shipping("setTax", { cart_id: cart,
    tax_lines: [{ shipping_method_id: method, code: "REPLACED", rate: 10 }] }));
  expect(replacement).not.toBe(tax);
  expect(await connected.fixture.readRows("cart", [tax])).toMatchObject([{ id: tax, deleted_at: expect.any(String) }]);
  const adjustment = shippingId(await connected.shipping("addAdjustment", [{ shipping_method_id: method, code: "SHIP", amount: "1.25", promotion_id: "promo-shipping" }]));
  expect(lifecycleIds(await connected.shipping("removeAdjustment", [adjustment]))).toEqual([adjustment]);
  expect(lifecycleIds(await connected.shipping("restoreAdjustment", [adjustment]))).toEqual([adjustment]);
  const children = await connected.fixture.readRows("cart", [tax, replacement, adjustment]);
  expect(children.filter(row => row.deleted_at === null)).toHaveLength(2);
  expect(await connected.readShippingGraph(cart)).toMatchObject([{ total: 12.375, shipping_total: 12.375, shipping_tax_total: 1.125,
    shipping_discount_total: 1.375, raw_total: { value: "12.375", precision: 20 }, shipping_methods: [{ id: method, amount: 12.5,
      subtotal: 12.5, original_subtotal: 12.5, total: 12.375, original_total: 13.75, discount_total: 1.375, discount_subtotal: 1.25,
      discount_tax_total: 0.125, tax_total: 1.125, original_tax_total: 1.25,
      raw_subtotal: { value: "12.5", precision: 20 }, raw_total: { value: "12.375", precision: 20 },
      raw_discount_total: { value: "1.375", precision: 20 }, raw_tax_total: { value: "1.125", precision: 20 },
      tax_lines: [{ id: replacement, rate: 10 }], adjustments: [{ id: adjustment, amount: 1.25 }] }] }]);
  expect(await connected.fixture.readRows("cart", [tax, replacement, adjustment])).toEqual(children);
  // These are the unchanged Shipping fields selected by native
  // updateTaxLinesWorkflow: it relies on native local hydration retaining id.
  expect(await connected.readShippingTaxGraph(cart)).toEqual([{ id: cart, shipping_methods: [{ id: method, shipping_option_id: null,
    amount: 12.5, raw_amount: { value: "12.5", precision: 20 }, tax_lines: [{ id: replacement, description: null, code: "REPLACED", rate: 10, provider_id: null }] }] }]);
  const deleted = await connected.shipping("softDelete", [method]);
  expect(Object.keys(Schema.decodeUnknownSync(Schema.JsonObject)(deleted))).toHaveLength(1);
  expect(lifecycleIds(deleted)).toEqual([method]);
  expect(await connected.shipping("list", { filters: { id: method } })).toEqual([]);
  expect(await connected.fixture.readRows("cart", [tax, replacement, adjustment])).toEqual(children);
  const trace = connected.traces.findLast(trace => trace.call.commandName === "cartSoftDeleteShippingForMutations");
  if (trace === undefined) throw new Error("Missing real native Shipping soft-delete evidence");
  expect(trace.activity.lifecycle.map(change => change.table)).toEqual(["cart_shipping_method"]);
  expect(trace.call.events).toMatchObject([{ metadata: { object: "shipping_method", action: "deleted" }, data: { id: method } }]);
  expect(lifecycleIds(await connected.shipping("restore", [method]))).toEqual([method]);
  expect(connected.traces.findLast(trace => trace.call.commandName === "cartRestoreShippingForMutations")?.call.events).toEqual([]);
  expect(await connected.fixture.readRows("cart", [tax, replacement, adjustment])).toEqual(children);
  expect(await connected.readShippingCart(cart)).toMatchObject([{ shipping_methods: [{ id: method,
    tax_lines: [{ id: replacement }], adjustments: [{ id: adjustment }] }] }]);
  const retained = await connected.makeShippingProbe("remove");
  expect(await Effect.runPromise(retained.run(retained.newRequestKey(), method))).toBeNull();
  expect(await connected.fixture.readRows("cart", [tax, replacement, adjustment])).toEqual(children);
  const before = await connected.fixture.snapshot();
  const physical = await Effect.runPromiseExit(connected.shippingAttempt("delete", [method]));
  expect(Exit.isFailure(physical)).toBe(true);
  if (Exit.isFailure(physical)) expect(failureReasons(physical.cause), Cause.pretty(physical.cause)).toEqual(expect.arrayContaining(["invalidInput", "deleteRestricted"]));
  expect(await connected.fixture.snapshot()).toEqual(before);
}, 120_000);

it("runs genuine Shipping retained physical inverses, durable replay and late-write rollback", async () => {
  const cart = "cart-shipping-inverse";
  await connected.createEmptyCart(cart);
  const bare = await connected.makeShippingProbe("add");
  expect(await Effect.runPromise(bare.run(bare.newRequestKey(), cart))).toBeNull();
  expect(await connected.shipping("list", { filters: { cart_id: cart } })).toEqual([]);
  const populated = await connected.makeShippingProbe("add", true), beforePopulated = await connected.fixture.snapshot();
  const refused = await Effect.runPromiseExit(populated.run(populated.newRequestKey(), cart));
  expect(Exit.isFailure(refused), Exit.isFailure(refused) ? Cause.pretty(refused.cause) : undefined).toBe(true);
  // The method is created and removed in one root. Its surviving Tax row's
  // final FK demand has no target; no committed method preimage is released.
  if (Exit.isFailure(refused)) expect(failureReasons(refused.cause), Cause.pretty(refused.cause)).toEqual(expect.arrayContaining(["invalidInput", "targetMissing"]));
  expect(await connected.fixture.snapshot()).toEqual(beforePopulated);
  const key = connected.newRequestKey(), fault = connected.fixture.loseNextNativeRootAcknowledgement();
  const input = [{ cart_id: cart, name: "Durable native Shipping", amount: 5 }];
  const committed = await Effect.runPromise(connected.shippingReplay(key, input)), method = shippingId(committed);
  expect(fault).toMatchObject({ armed: false, failures: 1 });
  const snapshot = await connected.fixture.snapshot(), calls = connected.traces.length;
  expect(await Effect.runPromise(connected.shippingReplay(key, input))).toEqual(committed);
  expect(connected.traces).toHaveLength(calls); expect(await connected.fixture.snapshot()).toEqual(snapshot);
  const failed = await Effect.runPromiseExit(connected.shippingLateFailure(method));
  expect(Exit.isFailure(failed), Exit.isFailure(failed) ? Cause.pretty(failed.cause) : undefined).toBe(true);
  if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("After real Shipping child writes");
  expect(await connected.fixture.snapshot()).toEqual(snapshot);
  expect(await connected.shipping("delete", [method])).toBeNull();
  expect(await connected.fixture.readRows("cart", [method])).toEqual([]);
}, 120_000);

it("authenticates Shipping parent and child receipts and retains authored cohort bounds", async () => {
  const traces = ["cartAddShippingForMutations", "cartUpdateShippingForMutations", "cartUpsertShippingTaxForMutations",
    "cartSetShippingTaxForCreation", "cartAddShippingAdjustmentsForCreation", "cartSoftDeleteShippingAdjustmentsForCreation",
    "cartRestoreShippingAdjustmentsForCreation", "cartSoftDeleteShippingForMutations", "cartRestoreShippingForMutations"]
    .map(name => {
      const trace = connected.traces.find(trace => trace.call.commandName === name && trace.activity.mutations.length > 0);
      if (trace === undefined) throw new Error("Missing genuine Shipping receipt " + name);
      return trace;
    });
  for (const trace of traces) {
    expect(Exit.isSuccess(await Effect.runPromiseExit(connected.policy.validateLogicalCall(trace.call, trace.activity)))).toBe(true);
    const altered = [
      { ...trace, activity: { ...trace.activity, mutations: trace.activity.mutations.slice(1) } },
      { ...trace, activity: { ...trace.activity, observedRows: [...trace.activity.observedRows, { table: "unrelated", row: { id: "unrelated" } }] } },
      { ...trace, call: { ...trace.call, result: { unrelated: ["unrelated"] } } },
      ...(trace.call.events.length ? [{ ...trace, call: { ...trace.call, events: [] } }] : []),
    ];
    for (const changed of altered) expect(Exit.isFailure(await Effect.runPromiseExit(connected.policy.validateLogicalCall(changed.call, changed.activity)))).toBe(true);
  }
  const before = await connected.fixture.snapshot();
  await expect(connected.shipping("add", Array.from({ length: 5 }, (_, index) => ({ cart_id: "cart-shipping-owner", name: "Authored " + index, amount: 1 })))).rejects.toBeDefined();
  expect(await connected.fixture.snapshot()).toEqual(before);
});

it("refuses null and omitted Sales Channels at the native Shipping-profile Cart read before projection", async () => {
  const shipping = await prepare("cart-shipping", [
    { table: "cart", row: { id: "cart-owner-shipping-null-channel", currency_code: "usd", sales_channel_id: null } },
    { table: "cart", row: { id: "cart-owner-shipping-omitted-channel", currency_code: "usd" } },
    { table: "cart", row: { id: "cart-owner-shipping-with-channel", currency_code: "usd", sales_channel_id: "sc-shipping-owner" } },
  ]);
  for (const [id, channel] of [["cart-owner-shipping-null-channel", null], ["cart-owner-shipping-omitted-channel", undefined]] as const) {
    const before = await shipping.fixture.snapshot(), result = await Effect.runPromiseExit(shipping.readCartAttempt(id));
    expect(Exit.isFailure(result), Exit.isFailure(result) ? Cause.pretty(result.cause) : undefined).toBe(true);
    if (Exit.isFailure(result)) expect(failureReasons(result.cause)).toContain("unsupportedProfile");
    expect(await shipping.fixture.snapshot()).toEqual(before);
    // The ordinary Cart profile preserves native Store fallback eligibility.
    await connected.createEmptyCart(id, channel);
    expect(await Effect.runPromise(connected.readCartAttempt(id))).toEqual([{ id }]);
  }
  const id = "cart-owner-shipping-with-channel";
  expect(await Effect.runPromise(shipping.readCartAttempt(id))).toEqual([{ id }]);
  const trace = shipping.traces.findLast(trace => trace.call.commandName === "cartListForCheckout");
  if (trace === undefined) throw new Error("Missing genuine Shipping-profile Cart read receipt");
  expect(Exit.isFailure(await Effect.runPromiseExit(shipping.policy.validateLogicalCall(trace.call, { ...trace.activity,
    observedRows: trace.activity.observedRows.map(observation => observation.table !== "cart" ? observation
      : { ...observation, row: { ...observation.row, sales_channel_id: null } }),
  })))).toBe(true);
}, 120_000);

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
