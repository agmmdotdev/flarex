import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { customerCheckoutRuntimes } from "./support/logical-checkout-fixture";
import { prepareCustomerCompleteCartWorkflow } from "../src/workflows/cart/complete-cart";
import * as configuration from "../src/workflow/configuration";

it("captures the complete Customer checkout identity before storage admission", async () => {
  const runtime = await customerCheckoutRuntimes(), original = configuration.captureWorkflowPolicy;
  let bytes = 0, admission = 0;
  const spy = vi.spyOn(configuration, "captureWorkflowPolicy").mockImplementation(input => {
    if (input !== null && typeof input === "object" && "workflow" in input) bytes = Buffer.byteLength(JSON.stringify(input));
    return original(input);
  });
  try {
    // Deliberately unauthenticated envelopes isolate preparation before the
    // storage owner; no request or database capability is fabricated here.
    const modules = Object.fromEntries(Object.entries(runtime.workflows).map(([name, module]) => [name, { module, logicalStorage: null }]));
    const effect = prepareCustomerCompleteCartWorkflow({
      // @ts-expect-error Deliberately unauthenticated storage envelopes test preparation only.
      modules, link: runtime.link,
      logger: runtime.payment.loggerResource, revision: "c".repeat(64), subscribers: [{ id: "customer-identity", revision: "d".repeat(64) }],
      execution: { identityAndAccessPolicy: { profile: "customer-identity-preflight" }, prepare: () => {
        admission++; return Effect.fail(commerceError("invalidAuthority", "Storage admission intentionally unavailable"));
      } },
    });
    const result = await Effect.runPromise(Effect.result(effect));
    expect(admission).toBe(1);
    expect(bytes).toBeGreaterThan(0); expect(bytes).toBeLessThanOrEqual(65_536);
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority", cause: "Storage admission intentionally unavailable" } });
  } finally { spy.mockRestore(); }
});
