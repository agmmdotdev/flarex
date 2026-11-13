import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { checkoutRuntimes } from "./support/core-checkout-fixture";
import { prepareCheckoutGraphs } from "../src/workflows/cart/checkout-graph";
import { checkoutRoot } from "../src/workflows/cart/complete-cart";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";
import { graphNativeConfiguration } from "../src/local-graph/native-metadata";

it("prepares the entire genuine checkout module graph before database installation", async () => {
  const native = await checkoutRuntimes(), modules = await Effect.runPromise(prepareCheckoutGraphs(native.workflows));
  const orderMetadata = workflowModuleDefinition(native.workflows.order)?.graph.native;
  if (orderMetadata === undefined) throw new Error("Missing genuine Order native metadata");
  const order = Result.getOrThrow(graphNativeConfiguration(orderMetadata)).servicesConfig.find(config => config.serviceName === "order");
  if (order === undefined) throw new Error("Missing actual Order service declaration");
  for (const name of ["order_cart_links", "order_payment_collection_links"] as const) {
    const endpointMetadata = workflowModuleDefinition(native.workflows[name])?.graph.native;
    if (endpointMetadata === undefined) throw new Error("Missing Order Link endpoint metadata");
    expect(Result.getOrThrow(graphNativeConfiguration(endpointMetadata)).servicesConfig.filter(config => config.serviceName === "order"))
      .toEqual([order]);
  }
  const graph = Result.getOrThrow(prepareLocalGraph(Object.entries(modules).map(([name, module]) => {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined) throw new Error("Missing genuine checkout graph");
    return { participant: defineAtomicCommerceParticipant(name), module: definition.graph };
  })));
  expect(graph.entities).toContain("cart");
  expect(graph.entities).toContain("order_cart");
  expect(Result.isSuccess(checkoutRoot.prepare())).toBe(true);
});
