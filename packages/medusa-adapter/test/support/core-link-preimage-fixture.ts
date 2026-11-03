import { randomUUID } from "node:crypto";
import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartPromotionsStep, type UpdateCartPromotionStepInput } from "@medusajs/core-flows/cart/update-cart-promotions-step";
import { PromotionActions } from "@medusajs/framework/utils/portable";
import { LinkPreimageOperationRequestSchema, LinkPreimageOperationHandleSchema } from "@medusajs/link-modules";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileCoreNativeEventStorageDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { compileCartPromotionCreationLinkCoreDefinition } from "../../src/links/cart-promotion-creation-schema";
import { prepareCartPromotionPreimageLinks } from "../../src/links/cart-promotion-preimages";
import { prepareAtomicWorkflowHost } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { cartPromotionPreimageResources } from "../../src/workflow/policy";
import { ExecutionDiagnostics } from "../../../persistence-postgres/src/execution/diagnostics/operation";
import { defineWorkflowModule } from "../../src/workflow/module";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";
import { createCoreNativeWorkflowFixture } from "./core-native-workflow-fixture";
import { orderFixtureHosts } from "./core-order-fixture";

const Id = Schema.String;
const NativeInput = Schema.Struct({ id: Id, action: Schema.optionalKey(Schema.Literals([PromotionActions.ADD, PromotionActions.REMOVE, PromotionActions.REPLACE])) });
const ProbeInput = Schema.Union([
  Schema.Struct({ action: Schema.Literal("nativeForward"), input: NativeInput }),
  Schema.Struct({ action: Schema.Literal("nativeInverse"), handle: LinkPreimageOperationHandleSchema }),
  Schema.Struct({ action: Schema.Literal("create"), pairs: Schema.Array(Schema.Tuple([Id, Id, Schema.Struct({})]).pipe(Schema.mutable)).pipe(Schema.mutable) }),
  Schema.Struct({ action: Schema.Literal("dismiss"), pairs: Schema.Array(Schema.Tuple([Id, Id]).pipe(Schema.mutable)).pipe(Schema.mutable) }),
  Schema.Struct({ action: Schema.Literal("apply"), request: LinkPreimageOperationRequestSchema, failAfter: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ action: Schema.Literal("compensate"), handle: LinkPreimageOperationHandleSchema, failAfter: Schema.optionalKey(Schema.Boolean) }),
]);

/** Real native protocol, service, receipts and Core storage owners. The probe
 * root supplies only calls and fault boundaries; it implements no Link logic. */
export async function prepareCoreLinkPreimages(driver: "pglite" | "postgres", close: (work: () => Promise<void>) => void) {
  const target = { scopeUuid: randomUUID(), epochUuid: randomUUID() };
  const [definition, eventDefinition, links] = await Effect.runPromise(Effect.all([
    compileCartPromotionCreationLinkCoreDefinition(target), compileCoreNativeEventStorageDefinition(target), prepareCartPromotionPreimageLinks(),
  ]));
  const fixture = await createCoreNativeWorkflowFixture(driver, { eventDefinition, sources: [
    { name: "links", definition, initialCommands: links.commands, rows: [] },
  ] });
  close(fixture.close);
  const { own } = orderFixtureHosts(close);
  const evidence = new Map<string, { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }>();
  const observedModule = Result.getOrThrow(defineWorkflowModule({ name: links.workflow.name,
    source: { name: links.prepared.serviceName, profile: "cart-promotion.exact-preimages" },
    // This one-source fixture selects direct Link reads. Cart and Promotion
    // endpoint traversals belong to the complete Cart graph.
    graph: { ...links.graph, remotePaths: [], linkEndpoints: [] }, methods: links.workflow.methods,
    logical: { ...links.policy, commands: links.commands, validateLogicalCall: Effect.fn("LinkPreimageFixture.observeCall")(function* (call, activity) {
      yield* links.policy.validateLogicalCall(call, activity);
      evidence.set(call.commandName, { call, activity });
    }) } }));
  const resources = Result.getOrThrow(prepareWorkflowResources({ links: { module: observedModule,
    methods: ["create", "dismiss", "applyPreimageOperation", "compensatePreimageOperation"], graph: true } }, true, { link: links.resource }));
  const nativeFlow = createWorkflow("native-cart-promotion-callback-witness", (input: WorkflowData<UpdateCartPromotionStepInput>) => new WorkflowResponse(updateCartPromotionsStep(input)));
  const native = Result.getOrThrow(nativeFlow.prepare()).nodes[0];
  if (native?.kind !== "step" || native.compensate === undefined) throw new Error("Missing genuine native Cart promotion callbacks");
  const nativeInverse = native.compensate;
  const step = createStep("probe-native-link-preimages", resources.callback(async (input: typeof ProbeInput.Type, context): Promise<StepResponse<Json>> => {
    const { resources } = context;
    if (input.action === "nativeForward") {
      const result = await Reflect.apply(native.invoke, undefined, [input.input, context]);
      if (!(result instanceof StepResponse)) throw new Error("Missing retained native Cart promotion response");
      return new StepResponse(result.compensateInput);
    }
    if (input.action === "nativeInverse") {
      await Reflect.apply(nativeInverse, undefined, [input.handle, context]);
      return new StepResponse(null);
    }
    const service = resources.links;
    if (input.action === "create") return new StepResponse(await service.create(input.pairs));
    if (input.action === "dismiss") return new StepResponse(await service.dismiss(input.pairs));
    const result = input.action === "apply" ? await service.applyPreimageOperation(links.prepared.serviceName, input.request)
      : await service.compensatePreimageOperation(input.handle);
    if (input.failAfter === true) throw new Error("Late native Link preimage parent fault");
    return new StepResponse(result);
  }));
  const flow = createWorkflow("probe-native-link-preimages", (input: WorkflowData<typeof ProbeInput.Type>) => new WorkflowResponse(step(input)));
  const options = { execution: fixture.execution,
    modules: { links: { module: observedModule, nativeStorage: fixture.source("links") } },
    revision: "d".repeat(64), subscribers: [{ id: "native-link-preimages", revision: "e".repeat(64) }],
    workflow: { name: "probeNativeLinkPreimages", resources, prepared: Result.getOrThrow(flow.prepare()), input: ProbeInput,
      output: Schema.Json, events: internalModuleWorkflowEvents },
    operationScheduling: "queued", borrowedOperationScheduling: "queued", executionIsolation: "scopeExclusive" } as const;
  const host = own(await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, requestCallLimit: cartPromotionPreimageResources.calls })));
  const ordinary = own(await Effect.runPromise(prepareAtomicWorkflowHost(options)));
  // The shared observer orders by stored identity, so restoring the original
  // rows preserves the comparison order within a Cart as well as their values.
  const rows = async () => (await fixture.readRows("links")).filter(row => typeof row.cart_id === "string");
  return { fixture, links, host, ordinary, rows,
    evidence: (name: string) => { const value = evidence.get(name); if (value === undefined) throw new Error("Missing actual native Link receipt evidence"); return value; },
    measured: async (input: typeof ProbeInput.Type) => {
      let calls = 0;
      const value = await Effect.runPromise(host.run(host.newRequestKey(), input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      return { value, calls };
    },
    run: (input: typeof ProbeInput.Type) => Effect.runPromise(host.run(host.newRequestKey(), input)),
    snapshot: fixture.snapshot,
    handle: (request: typeof LinkPreimageOperationRequestSchema.Type) => ({ operationId: request.operationId, serviceName: links.prepared.serviceName, request }) };
}
