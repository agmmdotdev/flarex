import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { prepareListQuery } from "../../medusa-framework/src/http/utils/get-query-config";
import { retrieveTransformQueryConfig } from "../../medusa-http/src/api/store/carts/query-config";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import { prepareCartCreationModules } from "../src/workflows/cart/creation-graph";
import { workflowModuleDefinition } from "../src/workflow/module";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareLocalGraph } from "../src/local-graph/query";

it("admits every native HTTP Cart default field through the genuine creation graph", async () => {
  const { catalog } = await Effect.runPromise(compileStoreCartRequestFixtureCatalog());
  const selected = await Effect.runPromise(prepareCartCreationModules(catalog.modules, catalog.runtimes.salesChannelRead));
  const graph = Result.getOrThrow(prepareLocalGraph(catalog.nativeSources.map(source => {
    const definition = workflowModuleDefinition(selected.modules[source.name].module);
    if (definition === undefined) throw new Error("Missing authenticated Cart module");
    return { participant: defineAtomicCommerceParticipant(source.name), module: definition.graph };
  })));
  const parsed = await prepareListQuery({}, retrieveTransformQueryConfig);
  const refused = parsed.remoteQueryConfig.fields.filter(field => Result.isFailure(graph.admitProjection("cart", ["id", field])));
  expect(refused).toEqual([]);
  expect(Result.isSuccess(graph.admitProjection("cart", parsed.remoteQueryConfig.fields))).toBe(true);
});
