import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { PromotionActions, LINKS } from "@medusajs/framework/utils/portable";
import { updateCartPromotionsStep, type UpdateCartPromotionStepInput } from "@medusajs/core-flows/cart/update-cart-promotions-step";
import { PermanentStepFailureError } from "@medusajs/orchestration/transaction/errors";
import type { LinkPreimageOperationRequest } from "@medusajs/types";

function nativeStep() {
  const flow = createWorkflow("native-cart-promotion-step-witness", (input: WorkflowData<UpdateCartPromotionStepInput>) =>
    new WorkflowResponse(updateCartPromotionsStep(input)));
  const node = Result.getOrThrow(flow.prepare()).nodes[0];
  if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing genuine native Cart promotion step and inverse");
  return { ...node, compensate: node.compensate };
}

function ports(options: { incomplete?: boolean; applyFailure?: Error } = {}) {
  const calls: unknown[] = [], requests: LinkPreimageOperationRequest[] = [], inverses: unknown[] = [];
  const query = Object.assign(async (input: unknown) => { calls.push(input); return [
    { cart_id: "cart", promotion_id: "old" }, { cart_id: "cart", promotion_id: "overlap" },
  ]; }, { maxPageSize: 256, graph: async (...args: unknown[]) => {
    calls.push(args); return { data: [{ id: "overlap", code: "SAME" }, { id: "new", code: "NEW" }],
      metadata: { count: options.incomplete ? 3 : 2, skip: 0, take: 256 } };
  } });
  const link = { applyPreimageOperation: async (_service: string, request: LinkPreimageOperationRequest) => {
    requests.push(request); if (options.applyFailure) throw options.applyFailure;
    return { operationId: request.operationId, serviceName: LINKS.CartPromotion, state: "applied", replayed: false, changedPairs: 2 };
  }, compensatePreimageOperation: async (handle: unknown) => { inverses.push(handle); } };
  return { calls, requests, inverses, context: { idempotencyKey: "actual-native-step-occurrence", eventGroupId: "native-step",
    container: { resolve: (name: string) => { if (name === "link") return link;
      if (name === "query" || name === "remoteQuery") return query; throw new Error("Unexpected native resource " + name); } } } };
}

describe("native Cart promotion selection and retained Link inverse", () => {
  it.each([
    { action: PromotionActions.ADD, mutations: [{ action: "create", pairs: [{ primary: "cart", foreign: "overlap" }, { primary: "cart", foreign: "new" }] }] },
    { action: PromotionActions.REMOVE, mutations: [{ action: "dismiss", pairs: [{ primary: "cart", foreign: "overlap" }] }] },
    { action: PromotionActions.REPLACE, mutations: [
      { action: "dismiss", pairs: [{ primary: "cart", foreign: "old" }, { primary: "cart", foreign: "overlap" }] },
      { action: "create", pairs: [{ primary: "cart", foreign: "overlap" }, { primary: "cart", foreign: "new" }] },
    ] },
  ])("preserves native $action selection and ordering", async ({ action, mutations }) => {
    const node = nativeStep(), fixture = ports();
    const response = await Reflect.apply(node.invoke, undefined, [{ id: "cart", promo_codes: ["SAME", "NEW", "UNKNOWN"], action }, fixture.context]);
    if (!(response instanceof StepResponse)) throw new Error("Missing retained native response");
    expect(response.output).toBeNull();
    expect(fixture.requests).toEqual([{ kind: "preimage", operationId: expect.stringMatching(/^lop_[a-f0-9]{64}$/), mutations }]);
    expect(fixture.calls).toEqual([
      { entryPoint: "cart_promotion", fields: ["cart_id", "promotion_id"], variables: { cart_id: ["cart"] } },
      [{ entity: "promotion", fields: ["id", "code"], filters: { code: ["SAME", "NEW", "UNKNOWN"] }, pagination: { take: 256 } }, { cache: { enable: true } }],
    ]);
    await Reflect.apply(node.compensate, undefined, [response.compensateInput, fixture.context]);
    expect(fixture.inverses).toEqual([response.compensateInput]);
    expect(response.compensateInput).toEqual({ serviceName: LINKS.CartPromotion, operationId: fixture.requests[0]?.operationId, request: fixture.requests[0] });
  });
  it.each([{}, { promo_codes: [] }])("keeps omitted/empty ADD a native no-op after the existing-Link read", async input => {
    const fixture = ports(), node = nativeStep();
    const response = await Reflect.apply(node.invoke, undefined, [{ id: "cart", ...input }, { ...fixture.context, idempotencyKey: undefined }]);
    expect(fixture.calls).toHaveLength(1); expect(fixture.requests).toEqual([]);
    if (!(response instanceof StepResponse)) throw new Error("Missing native no-op response");
    await Reflect.apply(node.compensate, undefined, [response.compensateInput, fixture.context]); expect(fixture.inverses).toEqual([]);
  });
  it("retains the exact request before an apply failure and preserves its cause", async () => {
    const cause = new Error("Lost apply response"), fixture = ports({ applyFailure: cause }), node = nativeStep();
    let caught: unknown;
    try { await Reflect.apply(node.invoke, undefined, [{ id: "cart", action: PromotionActions.REPLACE }, fixture.context]); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(PermanentStepFailureError);
    if (!(caught instanceof PermanentStepFailureError)) throw new Error("Missing native permanent failure");
    expect(caught.cause).toBe(cause);
    const retained = caught.getStepResponse();
    if (!(retained instanceof StepResponse)) throw new Error("Missing native failed-step response");
    await Reflect.apply(node.compensate, undefined, [retained.compensateInput, fixture.context]);
    expect(fixture.inverses).toEqual([{ serviceName: LINKS.CartPromotion, operationId: fixture.requests[0]?.operationId, request: fixture.requests[0] }]);
  });
  it("refuses incomplete Promotion selection before Link mutation", async () => {
    const fixture = ports({ incomplete: true });
    await expect(Reflect.apply(nativeStep().invoke, undefined, [{ id: "cart", promo_codes: ["NEW"] }, fixture.context])).rejects.toThrow("complete bounded result");
    expect(fixture.requests).toEqual([]);
  });
});
