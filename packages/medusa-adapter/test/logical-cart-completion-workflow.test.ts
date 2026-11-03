import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CartModuleService } from "@medusajs/cart/services";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartsStep, updateCartsStepId, type UpdateCartsStepInput } from "@medusajs/core-flows/cart/update-carts-step";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import * as completionReceipt from "../src/modules/cart/completion-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { prepareCoreCartFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";
import type { CoreNativeWorkflowSnapshot } from "./support/core-native-workflow-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), cleanup: Array<() => Promise<void>> = [];
const cartId = "cart-native-completion", completedAt = "2026-10-27T00:00:00.000Z";
const initialTimestamp = "2026-10-26T00:00:00.000Z";
const decodeTimestamp = Schema.decodeUnknownSync(Schema.String);

function expectCompletionCommit(before: CoreNativeWorkflowSnapshot, after: CoreNativeWorkflowSnapshot,
  key: string, table: string, id: string, completion: string | null) {
  const outcome = after.outcomes.find(record => record.value.key === key);
  const prior = before.rows.find(row => row.table === table && row.value.id === id);
  if (outcome === undefined || prior === undefined) throw new Error("Missing committed Cart outcome or preimage");
  expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
  expect(after.outcomes.length - before.outcomes.length).toBe(1);
  expect(after.rows).toHaveLength(before.rows.length);
  expect(after.revisions.length - before.revisions.length).toBe(1);
  const revisions = after.revisions.filter(row => row.timestamp === outcome.timestamp);
  expect(revisions).toHaveLength(1);
  const [revision] = revisions;
  if (revision?.value == null) throw new Error("Missing committed Cart row");
  const updated = decodeTimestamp(revision.value.updated_at);
  expect(revision).toMatchObject({ table, previous: prior.timestamp, deleted: false });
  expect(revision.value).toEqual({ ...prior.value, completed_at: completion, updated_at: updated });
  expect(Date.parse(updated)).toBeGreaterThanOrEqual(Date.parse(decodeTimestamp(prior.value.updated_at)));
  expect(after.rows).toContainEqual({ table, timestamp: outcome.timestamp, value: revision.value });
  expect(after.indexes).toContainEqual(expect.objectContaining({ table, id: revision.id, name: "by_id",
    timestamp: outcome.timestamp }));
  expect(after.families.length - before.families.length).toBe(1);
  expect(after.events.length - before.events.length).toBe(1);
  expect(after.events.filter(event => event.timestamp === outcome.timestamp)).toMatchObject([{
    envelope: { contract: "cart.cart.updated", message: { data: { id } } },
  }]);
  return updated;
}

describe("genuine native Cart completion and retained inverse", () => {
  let local: Awaited<ReturnType<typeof prepareCoreCartFixture>>;
  const accepted: Parameters<LogicalCallReceiptValidation>[0][] = [];
  const originalPolicy = completionReceipt.cartCompletionPolicy;
  beforeAll(async () => {
    vi.spyOn(completionReceipt, "cartCompletionPolicy").mockImplementation(prepared => {
      const policy = originalPolicy(prepared);
      return { ...policy, validateLogicalCall: Effect.fn("CartCompletion.observeAcceptedCall")(function* (call, activity) {
        yield* policy.validateLogicalCall(call, activity);
        accepted.push(call);
      }) };
    });
    local = await prepareCoreCartFixture(driver, close => cleanup.push(close), [
      { table: "cart_address", row: { id: "ca-completion-retained", city: "Retained", metadata: { nested: true } } },
      { table: "cart", row: { id: cartId, currency_code: "usd", metadata: { nested: { retained: true } },
        created_at: initialTimestamp, updated_at: initialTimestamp } },
      { table: "cart", row: { id: "cart-customer-completion", currency_code: "usd", customer_id: "cus-completion-retained",
        shipping_address_id: "ca-completion-retained", billing_address_id: "ca-completion-retained" } },
    ]);
  }, 240_000);
  afterAll(() => { vi.restoreAllMocks(); return finishOrderFixture(cleanup.reverse()); }, 120_000);

  const cartTable = () => {
    const table = local.cartDefinition.tables.find(declaration => declaration.localName === "cart");
    if (table === undefined) throw new Error("Missing authenticated Cart table");
    return table.name;
  };

  const prepare = async (mode: "forward" | "inverse" | "late") => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: local.cart.workflow,
      methods: ["listCarts", "updateCarts", "listAddresses", "updateAddresses"], graph: false } }, true));
    const nativeFlow = createWorkflow("retain-native-cart-completion", (input: WorkflowData<UpdateCartsStepInput>) =>
      new WorkflowResponse(updateCartsStep(input)));
    const native = Result.getOrThrow(nativeFlow.prepare()).nodes.find(node => node.name === updateCartsStepId);
    if (native?.kind !== "step" || native.compensate === undefined) throw new Error("Missing native Cart inverse");
    const compensate = native.compensate;
    const step = createStep("native-cart-completion-" + mode, resources.callback<unknown, unknown>(async (input: unknown, context) => {
      if (mode !== "forward") {
        const result = await compensate(input, context);
        if (mode === "late") throw new Error("Late failure after actual native Cart inverse");
        return new StepResponse(result);
      }
      const response = await native.invoke(input, context);
      if (!(response instanceof StepResponse)) throw new Error("Missing native Cart preimage");
      return new StepResponse({ output: response.output, retained: response.compensateInput });
    }));
    const flow = createWorkflow("native-cart-completion-root-" + mode, (input: WorkflowData<unknown>) => new WorkflowResponse(step(input)));
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options, modules: local.modules,
      workflow: { name: "nativeCartCompletion-" + mode, resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(host.close)); return host;
  };

  it("completes, retains exact native scalar preimages, restores them and replays without duplicate publication", async () => {
    const forward = await prepare("forward"), inverse = await prepare("inverse"), late = await prepare("late");
    const key = forward.newRequestKey(), input = [{ id: cartId, completed_at: completedAt }];
    const before = await local.snapshot(), start = accepted.length;
    const result = object(await Effect.runPromise(forward.run(key, input)));
    const completed = await local.snapshot();
    const updatedAt = expectCompletionCommit(before, completed, key, cartTable(), cartId, completedAt);
    expect(Date.parse(updatedAt)).toBeGreaterThan(Date.parse(initialTimestamp));
    expect(result.output).toMatchObject([{ id: cartId, completed_at: completedAt, created_at: initialTimestamp,
      updated_at: updatedAt, metadata: { nested: { retained: true } } }]);
    expect(result.retained).toMatchObject({ cartsBeforeUpdate: [{ id: cartId, completed_at: null,
      region_id: null, customer_id: null, sales_channel_id: null, email: null, currency_code: "usd",
      metadata: { nested: { retained: true } } }], addressesBeforeUpdate: [] });
    expect(accepted.slice(start)).toMatchObject([
      { commandName: "cartListForCheckout", mode: "read" },
      { commandName: "cartAddressesForCheckout", mode: "read", input: { filters: { id: [] } }, result: [], toAttempt: 0 },
      { commandName: "cartCompleteForCheckout", mode: "write", toAttempt: 1 },
    ]);
    expect(await Effect.runPromise(forward.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(completed);
    expect(accepted).toHaveLength(start + 3);
    const retained = result.retained;
    if (retained === undefined) throw new Error("Missing retained Cart preimage");
    const failure = await Effect.runPromiseExit(late.run(late.newRequestKey(), retained));
    expect(Exit.isFailure(failure)).toBe(true);
    if (Exit.isFailure(failure)) expect(Cause.pretty(failure.cause)).toContain("Late failure after actual native Cart inverse");
    const inverseCalls = [
      { commandName: "cartEmptyAddressesUpdateForCheckout", mode: "write", input: [], result: [], toAttempt: 0 },
      { commandName: "cartCompleteForCheckout", mode: "write", toAttempt: 1 },
    ];
    expect(accepted.slice(start + 3)).toMatchObject(inverseCalls);
    expect(await local.snapshot()).toEqual(completed);
    const inverseKey = inverse.newRequestKey();
    const restored = await Effect.runPromise(inverse.run(inverseKey, retained));
    const after = await local.snapshot();
    const restoredAt = expectCompletionCommit(completed, after, inverseKey, cartTable(), cartId, null);
    expect(restored).toMatchObject([{ id: cartId, completed_at: null, created_at: initialTimestamp,
      updated_at: restoredAt, metadata: { nested: { retained: true } } }]);
    expect(accepted.slice(start + 5)).toMatchObject(inverseCalls);
    expect(await Effect.runPromise(inverse.run(inverseKey, retained))).toEqual(restored);
    expect(await local.snapshot()).toEqual(after);
    expect(accepted).toHaveLength(start + 7);
  }, 240_000);

  it("refuses a non-completion scalar mutation before publication", async () => {
    const forward = await prepare("forward"), before = await local.snapshot(), start = accepted.length;
    const input = [{ id: cartId, completed_at: completedAt, email: "unadmitted@example.test" }];
    const result = await Effect.runPromise(Effect.result(forward.run(forward.newRequestKey(), input)));
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
    expect(accepted.slice(start)).toMatchObject([
      { commandName: "cartListForCheckout", mode: "read", input: { filters: { id: [cartId] } }, toAttempt: 0 },
      { commandName: "cartAddressesForCheckout", mode: "read", input: { filters: { id: [] } }, result: [], toAttempt: 0 },
    ]);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("restores native completion while retaining the Customer and both Cart Address references", async () => {
    const forward = await prepare("forward"), inverse = await prepare("inverse");
    const id = "cart-customer-completion", before = await local.snapshot(), key = forward.newRequestKey();
    const result = object(await Effect.runPromise(forward.run(key, [{ id, completed_at: completedAt }])));
    const completed = await local.snapshot();
    expectCompletionCommit(before, completed, key, cartTable(), id, completedAt);
    expect(result.retained).toMatchObject({ cartsBeforeUpdate: [{ customer_id: "cus-completion-retained", completed_at: null }], addressesBeforeUpdate: [] });
    if (result.retained === undefined) throw new Error("Missing populated Cart preimage");
    const inverseKey = inverse.newRequestKey();
    const restored = await Effect.runPromise(inverse.run(inverseKey, result.retained));
    expect(restored).toMatchObject([{ customer_id: "cus-completion-retained", completed_at: null,
      shipping_address_id: "ca-completion-retained", billing_address_id: "ca-completion-retained" }]);
    const after = await local.snapshot();
    expectCompletionCommit(completed, after, inverseKey, cartTable(), id, null);
    expect(after.rows.filter(row => row.table !== cartTable())).toEqual(before.rows.filter(row => row.table !== cartTable()));
  }, 240_000);

  it("rolls back the actual native write when its returned DTO is corrupted", async () => {
    const forward = await prepare("forward"), before = await local.snapshot(), original = CartModuleService.prototype.updateCarts;
    const spy = vi.spyOn(CartModuleService.prototype, "updateCarts").mockImplementation(async function (this: CartModuleService, ...args) {
      const rows = await original.apply(this, args);
      return rows.map(row => ({ ...row, completed_at: "2026-12-31T00:00:00.000Z" }));
    });
    try {
      const result = await Effect.runPromise(Effect.result(forward.run(forward.newRequestKey(), [{ id: cartId, completed_at: completedAt }])));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await local.snapshot()).toEqual(before);
    } finally { spy.mockRestore(); }
  }, 240_000);
});
