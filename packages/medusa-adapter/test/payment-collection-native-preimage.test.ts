import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updatePaymentCollectionStep, type UpdatePaymentCollectionStepInput } from "@medusajs/core-flows/payment-collection/update-payment-collection-step";

describe("native collection update compensation preimage", () => {
  it("selects native numeric amount objects as one scalar", async () => {
    const input: UpdatePaymentCollectionStepInput = { selector: { id: "paycol_preimage" }, update: {
      amount: { value: "20.625", precision: 20 }, currency_code: "eur",
    } };
    const flow = createWorkflow("native-preimage-selection-witness", (value: WorkflowData<UpdatePaymentCollectionStepInput>) =>
      new WorkflowResponse(updatePaymentCollectionStep(value)));
    const node = Result.getOrThrow(flow.prepare()).nodes[0];
    if (node?.kind !== "step") throw new Error("Missing genuine native update step");
    const selections: unknown[] = [];
    const service = { listPaymentCollections: async (_filter: unknown, config: unknown) => { selections.push(config); return []; },
      updatePaymentCollections: async () => [] };
    // Narrow method ports isolate the native selector. The database fixture
    // establishes persisted preimages and the actual retained inverse.
    await Reflect.apply(node.invoke, undefined, [input, { eventGroupId: "preimage", container: { resolve: () => service } }]);
    expect(selections).toEqual([{ select: ["amount", "currency_code"], relations: [] }]);
  });
  it("restores the exact retained amount rather than its rounded numeric DTO", async () => {
    const flow = createWorkflow("native-exact-preimage-inverse-witness", (value: WorkflowData<UpdatePaymentCollectionStepInput>) =>
      new WorkflowResponse(updatePaymentCollectionStep(value)));
    const node = Result.getOrThrow(flow.prepare()).nodes[0];
    if (node?.kind !== "step" || node.compensate === undefined) throw new Error("Missing native update inverse");
    const raw = { value: "9007199254740993", precision: 20 }, restored: unknown[] = [];
    let selectedAmount = true;
    const service = { listPaymentCollections: async () => [{ id: "paycol_exact", ...(selectedAmount ? { amount: 9007199254740992 } : {}), raw_amount: raw, currency_code: "usd" }],
      updatePaymentCollections: async () => [], upsertPaymentCollections: async (input: unknown) => { restored.push(input); return []; } };
    const context = { eventGroupId: "preimage", container: { resolve: () => service } };
    const response = await Reflect.apply(node.invoke, undefined, [{ selector: { id: "paycol_exact" }, update: { amount: 1 } }, context]);
    if (!(response instanceof StepResponse)) throw new Error("Missing retained native response");
    await Reflect.apply(node.compensate, undefined, [response.compensateInput, context]);
    expect(restored).toEqual([[{ id: "paycol_exact", amount: raw, currency_code: "usd", metadata: undefined }]]);
    selectedAmount = false;
    const omitted = await Reflect.apply(node.invoke, undefined, [{ selector: { id: "paycol_exact" }, update: { currency_code: "eur" } }, context]);
    if (!(omitted instanceof StepResponse)) throw new Error("Missing retained currency response");
    await Reflect.apply(node.compensate, undefined, [omitted.compensateInput, context]);
    expect(restored[1]).toEqual([{ id: "paycol_exact", amount: undefined, currency_code: "usd", metadata: undefined }]);
  });
});
