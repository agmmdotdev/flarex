import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { deletePaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/delete-payment-sessions";

describe("native Payment workflow preparation", () => {
  it("prepares the genuine root without granting compensation to the explicitly configured account-holder step", () => {
    expect(Result.isSuccess(deletePaymentSessionsWorkflow.prepare())).toBe(true);
    const prepared = Result.getOrThrow(createPaymentSessionsWorkflow.prepare());
    expect(prepared.nodes.find(node => node.name === "create-payment-account-holder"))
      .toMatchObject({ kind: "step", compensate: undefined, compensation: undefined });
    expect(prepared.parallel).toHaveLength(1);
  });
});
