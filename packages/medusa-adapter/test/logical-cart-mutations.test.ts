import { afterAll, beforeAll, expect, it } from "vitest";
import { Effect, Exit, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { deleteLineItemsStep } from "@medusajs/core-flows/line-item/delete-line-items-step";
import { commerceError, defaultCommerceResources, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeCartCreationWorkflowCommands } from "../src/modules/cart/refresh-service";
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
    commands: [seed, tax, adjustment, removeAdjustment, list] }));
  cleanup.push(() => Effect.runPromise(host.close));
  const native = createWorkflow("native-cart-line-delete-retained-node", (input: WorkflowData<string[]>) => new WorkflowResponse(deleteLineItemsStep(input)));
  const node = Result.getOrThrow(native.prepare()).nodes.find(node => node.name === "delete-line-items");
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native LineItem deletion inverse");
  const invoke = node.invoke, compensate = node.compensate;
  const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: cart.workflow,
    methods: ["softDeleteLineItems", "restoreLineItems"], graph: false } }, true));
  const makeProbe = async (lateFailure: boolean) => {
    const retained = createStep("native-cart-line-retained-inverse", resources.callback(async (ids: string[], context) => {
      const response = await invoke(ids, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native LineItem deletion payload");
      await compensate(response.compensateInput, context);
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
    addAdjustment: (code: string) => run(adjustment, [{ item_id: "cali-retained", amount: 1, code, promotion_id: "promo-retained" }]),
    removeAdjustment: (id: string) => run(removeAdjustment, [id]) };
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
