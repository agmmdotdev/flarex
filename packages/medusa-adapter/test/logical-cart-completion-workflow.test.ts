import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CartModuleService } from "@medusajs/cart/services";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartsStep, updateCartsStepId, type UpdateCartsStepInput } from "@medusajs/core-flows/cart/update-carts-step";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const object = Schema.decodeUnknownSync(Schema.JsonObject), cleanup: Array<() => Promise<void>> = [];
const cartId = "cart-native-completion", completedAt = "2026-10-27T00:00:00.000Z";

describe("genuine native Cart completion and retained inverse", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => { local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close), undefined,
    [{ table: "cart_address", row: { id: "ca-completion-retained", city: "Retained", metadata: { nested: true } } },
      { table: "cart", row: { id: cartId, currency_code: "usd", metadata: { nested: { retained: true } } } },
      { table: "cart", row: { id: "cart-customer-completion", currency_code: "usd", customer_id: "cus-completion-retained",
        shipping_address_id: "ca-completion-retained", billing_address_id: "ca-completion-retained" } }], [], "completion"); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

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
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options, modules: { cart: local.modules.cart },
      operationScheduling: "queued", borrowedOperationScheduling: "queued", workflow: { name: "nativeCartCompletion-" + mode,
        resources, prepared: Result.getOrThrow(flow.prepare()), input: Schema.Json, output: Schema.Json, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(host.close)); return host;
  };

  it("completes, retains exact native scalar preimages, restores them and replays without duplicate publication", async () => {
    const forward = await prepare("forward"), inverse = await prepare("inverse"), late = await prepare("late");
    const key = forward.newRequestKey(), input = [{ id: cartId, completed_at: completedAt }];
    const result = object(await Effect.runPromise(forward.run(key, input)));
    expect(result.output).toMatchObject([{ id: cartId, completed_at: completedAt, metadata: { nested: { retained: true } } }]);
    expect(result.retained).toMatchObject({ cartsBeforeUpdate: [{ id: cartId, completed_at: null,
      region_id: null, customer_id: null, sales_channel_id: null, metadata: { nested: { retained: true } } }], addressesBeforeUpdate: [] });
    const completed = await local.snapshot();
    expect(await Effect.runPromise(forward.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(completed);
    const retained = result.retained;
    if (retained === undefined) throw new Error("Missing retained Cart preimage");
    const failure = await Effect.runPromiseExit(late.run(late.newRequestKey(), retained));
    expect(Exit.isFailure(failure)).toBe(true);
    if (Exit.isFailure(failure)) expect(Cause.pretty(failure.cause)).toContain("Late failure after actual native Cart inverse");
    expect(await local.snapshot()).toEqual(completed);
    const inverseKey = inverse.newRequestKey();
    const restored = await Effect.runPromise(inverse.run(inverseKey, retained));
    expect(restored).toMatchObject([{ id: cartId, completed_at: null, metadata: { nested: { retained: true } } }]);
    const after = await local.snapshot();
    expect(await Effect.runPromise(inverse.run(inverseKey, retained))).toEqual(restored);
    expect(await local.snapshot()).toEqual(after);
    expect(local.errors).toEqual([]);
  }, 240_000);

  it("refuses a non-completion scalar mutation before publication", async () => {
    const forward = await prepare("forward"), before = await local.snapshot();
    const exit = await Effect.runPromiseExit(forward.run(forward.newRequestKey(), [{ id: cartId, completed_at: completedAt, email: "unadmitted@example.test" }]));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);

  it("restores native completion with an existing Customer and leaves both Cart Address references intact", async () => {
    const forward = await prepare("forward"), inverse = await prepare("inverse");
    const result = object(await Effect.runPromise(forward.run(forward.newRequestKey(), [{ id: "cart-customer-completion", completed_at: completedAt }])));
    expect(result.retained).toMatchObject({ cartsBeforeUpdate: [{ customer_id: "cus-completion-retained", completed_at: null }], addressesBeforeUpdate: [] });
    if (result.retained === undefined) throw new Error("Missing populated Cart preimage");
    const restored = await Effect.runPromise(inverse.run(inverse.newRequestKey(), result.retained));
    expect(restored).toMatchObject([{ customer_id: "cus-completion-retained", completed_at: null,
      shipping_address_id: "ca-completion-retained", billing_address_id: "ca-completion-retained" }]);
    expect(local.errors).toEqual([]);
  }, 240_000);

  it("rolls back the actual native write when its returned DTO is corrupted", async () => {
    const forward = await prepare("forward"), before = await local.snapshot(), original = CartModuleService.prototype.updateCarts;
    const spy = vi.spyOn(CartModuleService.prototype, "updateCarts").mockImplementation(async function (this: CartModuleService, ...args) {
      const rows = await original.apply(this, args);
      return rows.map(row => ({ ...row, completed_at: "2026-12-31T00:00:00.000Z" }));
    });
    try {
      const exit = await Effect.runPromiseExit(forward.run(forward.newRequestKey(), [{ id: cartId, completed_at: completedAt }]));
      expect(Exit.isFailure(exit)).toBe(true);
      expect(await local.snapshot()).toEqual(before);
    } finally { spy.mockRestore(); }
  }, 240_000);
});
