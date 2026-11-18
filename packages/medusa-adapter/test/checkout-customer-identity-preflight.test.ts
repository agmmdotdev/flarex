import { randomUUID } from "node:crypto";
import { Effect, Result } from "effect";
import { expect, it, vi } from "vitest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { customerCheckoutRuntimes } from "./support/core-checkout-fixture";
import { checkoutCoreDefinitions } from "./support/checkout-core-definitions";
import { prepareCustomerCompleteCartWorkflow } from "../src/workflows/cart/complete-cart";
import { customerCheckoutModuleNames } from "../src/workflows/cart/checkout-graph";
import { captureInstalledWorkflowModules } from "../src/workflow/host";
import * as configuration from "../src/workflow/configuration";

it("captures the complete Customer checkout identity before storage admission", async () => {
  const runtime = await customerCheckoutRuntimes(), original = configuration.captureWorkflowPolicy;
  let bytes = 0, admission = 0;
  const spy = vi.spyOn(configuration, "captureWorkflowPolicy").mockImplementation(input => {
    if (input !== null && typeof input === "object" && "workflow" in input) bytes = Buffer.byteLength(JSON.stringify(input));
    return original(input);
  });
  try {
    const definitions = await Effect.runPromise(checkoutCoreDefinitions({ scopeUuid: randomUUID(), epochUuid: randomUUID() }, true));
    // Issued definition selectors exercise preparation without database access.
    const registrations = Object.fromEntries(customerCheckoutModuleNames.map(name => {
      const definition = definitions[name];
      if (definition === undefined) throw new Error("Missing Customer checkout source " + name);
      return [name, { module: runtime.workflows[name], nativeStorage: Result.getOrThrow(defineAtomicCommerceNativeSource(name, definition)) }];
    }));
    const modules = Result.getOrThrow(captureInstalledWorkflowModules(registrations, customerCheckoutModuleNames));
    const effect = prepareCustomerCompleteCartWorkflow({
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
