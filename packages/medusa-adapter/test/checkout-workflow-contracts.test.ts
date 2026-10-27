import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { checkoutRuntimes } from "./support/logical-checkout-fixture";
import { prepareCheckoutGraphs } from "../src/workflows/cart/checkout-graph";
import { checkoutRoot } from "../src/workflows/cart/complete-cart";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";

it("prepares the entire genuine checkout module graph before database installation", async () => {
  const native = await checkoutRuntimes(), modules = await Effect.runPromise(prepareCheckoutGraphs(native.workflows));
  const graph = Result.getOrThrow(prepareLocalGraph(Object.entries(modules).map(([name, module]) => {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined) throw new Error("Missing genuine checkout graph");
    return { participant: defineAtomicCommerceParticipant(name), module: definition.graph };
  })));
  expect(graph.entities).toContain("cart");
  expect(graph.entities).toContain("order_cart");
  expect(Result.isSuccess(checkoutRoot.prepare())).toBe(true);
});
