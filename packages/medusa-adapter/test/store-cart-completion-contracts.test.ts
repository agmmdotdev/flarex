import { Effect, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { atomicCommerceNativeSourceIdentity } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { prepareRetrieveQuery } from "@medusajs/framework/http";
import { retrieveTransformQueryConfig } from "../../medusa-http/src/api/store/orders/query-config";
import { prepareLocalGraph } from "../src/local-graph/query";
import { prepareStoreCheckoutModules, storeCheckoutModuleNames } from "../src/workflows/cart/checkout-graph";
import { prepareStoreCompleteCartWorkflow } from "../src/workflows/cart/complete-cart";
import { workflowModuleDefinition } from "../src/workflow/module";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import type { AtomicWorkflowExecution } from "../src/workflow/host";

let catalog: Effect.Success<ReturnType<typeof compileStoreCartRequestFixtureCatalog>>["catalog"];
beforeAll(async () => { catalog = (await Effect.runPromise(compileStoreCartRequestFixtureCatalog())).catalog; }, 60_000);

it("prepares the complete twenty-source native checkout with the existing settlement and policy ceilings", async () => {
  const captures: Parameters<AtomicWorkflowExecution["prepare"]>[0][] = [];
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: { profile: "store-completion-construction" }, prepare: composition => {
    captures.push(composition);
    return Effect.succeed({ newRequestKey: () => "construction-only", close: Effect.void,
      run: () => Effect.die("Construction proof must not execute native work") });
  } };
  const workflow = await Effect.runPromise(prepareStoreCompleteCartWorkflow({ execution, modules: catalog.completionModules,
    link: catalog.completionRuntimes.link, logger: catalog.completionRuntimes.logger, revision: "a".repeat(64), subscribers: [] }));
  try {
    expect(captures).toHaveLength(1);
    const composition = captures[0];
    if (composition === undefined) throw new Error("Missing prepared composition");
    expect(composition.participants.map(participant => participant.nativeStorage === undefined ? undefined
      : atomicCommerceNativeSourceIdentity(participant.nativeStorage)?.name).sort()).toEqual([...storeCheckoutModuleNames].sort());
    expect(composition.requestParticipantLimit).toBe(20);
    expect(composition.requestCallLimit).toBe(512);
    expect(composition.executionIsolation).toBe("scopeExclusive");
    expect(composition.requestByteLimit).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(composition.identityAndAccessPolicy))).toBeLessThanOrEqual(65_536);
  } finally { await Effect.runPromise(workflow.close); }
});

it("admits the pinned default completion Order graph through actual native module projections", async () => {
  const modules = await Effect.runPromise(prepareStoreCheckoutModules(catalog.completionModules));
  const graph = Result.getOrThrow(prepareLocalGraph(storeCheckoutModuleNames.map(name => {
    const definition = workflowModuleDefinition(modules[name].module);
    if (definition === undefined) throw new Error("Missing native module");
    return { participant: defineAtomicCommerceParticipant(name), module: definition.graph };
  })));
  const query = await prepareRetrieveQuery({}, retrieveTransformQueryConfig);
  expect(query.remoteQueryConfig.fields.filter(field => Result.isFailure(graph.admitProjection("order", ["id", field])))).toEqual([]);
  expect(Result.isSuccess(graph.admitProjection("order", query.remoteQueryConfig.fields))).toBe(true);
  expect(Result.isFailure(graph.admitProjection("order", ["payment_collections.payments.provider.secret"]))).toBe(true);
});
