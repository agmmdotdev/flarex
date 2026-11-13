import { Cause, Effect, Exit, Result, Schema } from "effect";
import { expect, it } from "vitest";
import { createWorkflow, WorkflowResponse } from "@medusajs/workflows-sdk";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { prepareCreateCartWorkflow } from "../src/workflows/cart/create-cart";
import { compileStoreCartRequestFixtureCatalog } from "./support/store-cart-request-catalog";
import { currencyWorkflowModule } from "../src/modules/currency/service";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareWorkflowComposition, type InstalledWorkflowModule } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { captureWorkflowResourceDigest } from "../src/workflow/configuration";
import { prepareLocalGraph } from "../src/local-graph/query";

it("prepares the complete Cart resource proof within its existing identity budget before host admission", async () => {
  const reached = commerceError("resourceFailure", new Error("reached trusted host preparation"));
  const exit = await Effect.runPromiseExit(Effect.gen(function* () {
    const { catalog } = yield* compileStoreCartRequestFixtureCatalog();
    return yield* prepareCreateCartWorkflow({ execution: { identityAndAccessPolicy: {}, prepare: () => Effect.fail(reached) },
      modules: catalog.modules, salesChannelRead: catalog.runtimes.salesChannelRead, link: catalog.runtimes.link,
      logger: catalog.runtimes.logger, revision: "a".repeat(64), subscribers: [{ id: "native-query-budget", revision: "b".repeat(64) }] });
  }));
  expect(Exit.isFailure(exit), Exit.isFailure(exit) ? Cause.pretty(exit.cause) : undefined).toBe(true);
  if (Exit.isFailure(exit)) expect(exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : []), Cause.pretty(exit.cause))
    .toContain(reached);
}, 60_000);

it("binds the complete native metadata digest in the outer resource identity", async () => {
  const module = Result.getOrThrow(currencyWorkflowModule);
  const native = workflowModuleDefinition(module)?.graph.native;
  if (native === undefined) throw new Error("Missing genuine Currency query metadata");
  const resources = Result.getOrThrow(prepareWorkflowResources({ currency: { module, methods: [], graph: true } }, false));
  const workflow = createWorkflow("native-query-identity", () => new WorkflowResponse(null));
  // Preparation authenticates metadata; storage is admitted by the outer Core
  // host. This witness never issues or executes a database capability.
  const modules: Record<string, InstalledWorkflowModule> = {};
  Object.defineProperty(modules, "currency", { enumerable: true, value: { module, logicalStorage: {} } });
  const result = await Effect.runPromise(prepareWorkflowComposition({ identityAndAccessPolicy: {}, modules, revision: "a".repeat(64),
    workflow: { name: "native-query-identity", resources, prepared: Result.getOrThrow(workflow.prepare()), input: Schema.Json, output: Schema.Json } }));
  const identity = Schema.decodeUnknownSync(Schema.Struct({ workflow: Schema.Struct({ resources: Schema.Array(Schema.Struct({
    graph: Schema.Struct({ native: Schema.Struct({ digest: Schema.String }) }),
  })) }) }))(result.composition.identityAndAccessPolicy);
  expect(identity.workflow.resources.map(resource => resource.graph.native.digest))
    .toEqual([await Effect.runPromise(captureWorkflowResourceDigest(native.identity))]);
});

it("refuses missing, forged and conflicting native registries during graph preparation", () => {
  const graph = workflowModuleDefinition(Result.getOrThrow(currencyWorkflowModule))?.graph;
  if (graph === undefined) throw new Error("Missing Currency graph");
  const first = defineAtomicCommerceParticipant("nativeRegistryFirst"), second = defineAtomicCommerceParticipant("nativeRegistrySecond");
  const missing = { ...graph }, forged = { ...graph };
  Reflect.deleteProperty(missing, "native");
  Reflect.set(forged, "native", {});
  for (const { module, reason } of [{ module: missing, reason: "unsupportedProfile" }, { module: forged, reason: "invalidAuthority" }]) {
    expect(prepareLocalGraph([{ participant: first, module }]))
      .toMatchObject({ _tag: "Failure", failure: { reason } });
  }
  const conflicting = { ...graph, aliases: graph.aliases.map(alias => ({ ...alias, name: "alternate_" + alias.name })) };
  expect(prepareLocalGraph([{ participant: first, module: graph }, { participant: second, module: conflicting }]))
    .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
});
