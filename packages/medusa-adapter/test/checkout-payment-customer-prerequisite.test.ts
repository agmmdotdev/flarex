import { readFileSync } from "node:fs";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { capturePaymentMetadata } from "../src/modules/payment/schema";
import { preparePaymentSessionRepository } from "../src/modules/payment/repository";
import { captureCommerceInput } from "../src/value/input";

describe("native checkout retained Payment customer selector", () => {
  it("admits the corrected native fields and refuses the nonexistent Payment Customer relation", async () => {
    const source = readFileSync(new URL("../../medusa-core-flows/src/cart/steps/compensate-payment-if-needed.ts", import.meta.url), "utf8");
    const selected = source.match(/fields: \[([\s\S]*?)\]/)?.[1];
    if (selected === undefined) throw new Error("Missing native inverse field selection");
    const correctedFields = [...selected.matchAll(/"([^"]+)"/g)].map(match => match[1]!);
    const fields = [...correctedFields.filter(field => field !== "context"), "payment.customer.id"];
    expect(fields).toContain("payment.customer.id");
    const metadata = await Effect.runPromise(capturePaymentMetadata()), prepared = Result.getOrThrow(preparePaymentSessionRepository(metadata.frame));
    const query = (select: string[]) => captureCommerceInput(buildQuery({ id: "payses-checkout" }, { select }))
      .pipe(Result.flatMap(value => prepared.query(prepared.contracts.session, value)));
    expect(Result.isSuccess(query(fields.filter(field => field !== "payment.customer.id")))).toBe(true);
    // Payment defines no customer FK/relation, and no pinned Link extends
    // Payment with Customer. The native selector is not an admission omission.
    expect(prepared.contracts.payment.relationships.some(relation => relation.name === "customer")).toBe(false);
    expect(Result.isFailure(query(fields))).toBe(true);
    expect(correctedFields).toContain("context");
    expect(correctedFields).not.toContain("payment.customer.id");
    expect(Result.isSuccess(query(correctedFields))).toBe(true);
  });
});
