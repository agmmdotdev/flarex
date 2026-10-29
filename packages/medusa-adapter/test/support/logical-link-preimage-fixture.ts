import { Effect, Result, Schema } from "effect";
import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartPromotionsStep, type UpdateCartPromotionStepInput } from "@medusajs/core-flows/cart/update-cart-promotions-step";
import { PromotionActions } from "@medusajs/framework/utils/portable";
import { LinkPreimageOperationRequestSchema, LinkPreimageOperationHandleSchema } from "@medusajs/link-modules";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { capturePrivateCanonicalValue, commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { compileCartPromotionCreationLinkDefinition } from "../../src/links/cart-promotion-creation-schema";
import { prepareCartPromotionPreimageLinks } from "../../src/links/cart-promotion-preimages";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../src/workflow/host";
import { prepareWorkflowResources } from "../../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../../src/workflow/events";
import { logicalCurrencyFixture } from "./logical-currency-fixture";
import { logicalCurrencyInventory } from "./logical-currency-inventory";
import { cartPromotionPreimageResources } from "../../src/workflow/policy";
import { ExecutionDiagnostics } from "../../../persistence-postgres/src/execution/diagnostics/operation";
import { defineWorkflowModule } from "../../src/workflow/module";
import type { LogicalCallReceiptValidation } from "../../src/repository/call-receipt";

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

/** Real native protocol + service + logical receipt/storage owners. The probe
 * root supplies only calls and fault boundaries; it implements no Link logic. */
export async function prepareLogicalLinkPreimages(driver: "pglite" | "postgres", close: (work: () => Promise<void>) => void) {
  const definition = await Effect.runPromise(compileCartPromotionCreationLinkDefinition());
  const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.cart-promotion-preimages", owner: "medusa", writeProfile: "medusa.cart-promotion-preimages",
    evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
    bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
  }));
  const fixture = await logicalCurrencyFixture(driver, close, { additionalSources: [source] });
  const links = await Effect.runPromise(prepareCartPromotionPreimageLinks());
  const evidence = new Map<string, { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }>();
  const observedModule = Result.getOrThrow(defineWorkflowModule({ name: links.workflow.name,
    source: { name: links.prepared.serviceName, profile: "cart-promotion.exact-preimages" }, // This one-source fixture selects direct Link reads only; native Cart/Promotion
    // traversals remain for the full Cart graph composition, not mocked targets.
    graph: { ...links.graph, remotePaths: [], linkEndpoints: [] }, methods: links.workflow.methods,
    logical: { ...links.policy, commands: links.commands, validateLogicalCall: Effect.fn(function* (call, activity) {
      yield* links.policy.validateLogicalCall(call, activity);
      evidence.set(call.commandName, { call, activity });
    }) } }));
  const read = defineCommerceCommand("cartPreimageRead", "read", Effect.fn(function* (ctx, input) {
    const table = yield* Effect.fromResult(Schema.decodeUnknownResult(Schema.Literals(["cart_promotion", "link_workflow_operation", "link_pair_revision"]))(input))
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    return [...yield* (yield* ctx.table(table)).find(ctx.manager, { take: 256, order: { column: table === "cart_promotion" ? "cart_id" : "id", direction: "asc" },
      predicate: { kind: "and", children: [] } })];
  }));
  const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid empty Link dataset"), hashFailure: cause => new Error("Link dataset hash", { cause }) }));
  const storage = { ...fixture.hostInput.logicalStorage, source: { sourceKey: source.key, writeProfile: source.writeProfile, schema: definition.schema, evidence: definition.provenance },
    initialization: { stepId: "cart-promotion-preimages-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read] }));
  close(() => Effect.runPromise(reader.close)); await Effect.runPromise(reader.initialize([]));
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
  const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: fixture.hostInput.identityAndAccessPolicy,
    prepare: composition => makeAtomicCommerceHost({ ...fixture.hostInput, ...composition }) };
  const options = { execution,
    modules: { links: { module: observedModule, logicalStorage: storage } }, revision: "d".repeat(64), subscribers: [{ id: "native-link-preimages", revision: "e".repeat(64) }],
    workflow: { name: "probeNativeLinkPreimages", resources, prepared: Result.getOrThrow(flow.prepare()), input: ProbeInput,
      output: Schema.Json, events: internalModuleWorkflowEvents } };
  const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued",
    executionIsolation: "scopeExclusive", requestCallLimit: cartPromotionPreimageResources.calls }));
  const ordinary = await Effect.runPromise(prepareAtomicWorkflowHost({ ...options, operationScheduling: "queued", borrowedOperationScheduling: "queued", executionIsolation: "scopeExclusive" }));
  close(() => Effect.runPromise(host.close)); close(() => Effect.runPromise(ordinary.close));
  const rows = () => Effect.runPromise(reader.read(read, "cart_promotion").pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.JsonObject)))));
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
    snapshot: () => logicalCurrencyInventory(fixture),
    handle: (request: typeof LinkPreimageOperationRequestSchema.Type) => ({ operationId: request.operationId, serviceName: links.prepared.serviceName, request }) };
}
