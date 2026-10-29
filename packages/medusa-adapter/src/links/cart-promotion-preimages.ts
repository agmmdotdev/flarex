import { Effect, Schema } from "effect";
import { LinkPreimageOperationRequestSchema, LinkPreimageOperationHandleSchema, LinkOperationResultSchema,
  LinkOperationCompensationSchema } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { commerceCommandPreparation, commerceServiceCommands } from "../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../workflow/module";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { prepareCartPromotionLinkRead } from "./cart-promotion-service";
// Read construction and preimage writes share one actual native Link service.
// Protocol tables are selected once by the creation-profile read construction.
// The read owner also supplies the existing checked graph and read receipts.
import { linkPreimageEventPolicy } from "./preimage-events";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const boundedRequest = LinkPreimageOperationRequestSchema.check(Schema.makeFilter(request => request.mutations.length <= 2 &&
  request.mutations.every(mutation => mutation.pairs.length <= 4) &&
  new Set(request.mutations.flatMap(mutation => mutation.pairs.map(pair => pair.primary))).size <= 1));
const isBounded = Schema.is(boundedRequest);
const decodeResult = commerceDecoder(LinkOperationResultSchema, "storedCorruption");
const decodeCompensation = commerceDecoder(LinkOperationCompensationSchema, "storedCorruption");

/** Explicit finite access to the genuine native ordered preimage protocol.
 * It cannot obtain caller-supplied preimages, another family or a settlement. */
export const prepareCartPromotionPreimageLinks = Effect.fn("CartPromotionPreimages.prepare")(function* () {
  const read = yield* prepareCartPromotionLinkRead("creation");
  const { metadata, prepared } = read;
  const serviceName = prepared.serviceName;
  if (prepared.lifecycle.preimageOperations !== true) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const boundedHandle = LinkPreimageOperationHandleSchema.check(Schema.makeFilter(handle => handle.serviceName === serviceName && isBounded(handle.request)));
  const applyArguments = commerceDecoder(Schema.Tuple([Schema.Literal(serviceName), boundedRequest]), "invalidInput");
  const compensateArguments = commerceDecoder(Schema.Tuple([boundedHandle]), "invalidInput");
  const commands = commerceServiceCommands(prepared.useService), prepare = commerceCommandPreparation("CartPromotionPreimages.prepareInput");
  const applyName = "cartPromotionApplyPreimages", compensateName = "cartPromotionCompensatePreimages";
  const createName = "cartPromotionCreate", dismissName = "cartPromotionDismiss";
  const apply = commands.write(applyName, prepare(commerceDecoder(boundedRequest, "invalidInput")),
    ({ service, context }, request) => service.applyPreimageOperation(request, context));
  const compensate = commands.write(compensateName, prepare(commerceDecoder(boundedHandle, "invalidInput")),
    ({ service, context }, handle) => service.compensatePreimageOperation(handle, context));
  const createInput = Schema.Array(Schema.Tuple([Id, Id, Schema.Struct({})]).pipe(Schema.mutable)).pipe(Schema.mutable).check(Schema.isMaxLength(4));
  const dismissInput = Schema.Array(Schema.Tuple([Id, Id]).pipe(Schema.mutable)).pipe(Schema.mutable).check(Schema.isMaxLength(4));
  const create = commands.write(createName, prepare(commerceDecoder(createInput, "invalidInput")),
    ({ service, context }, pairs) => service.create(pairs, undefined, undefined, context));
  const dismiss = commands.write(dismissName, prepare(commerceDecoder(dismissInput, "invalidInput")),
    ({ service, context }, pairs) => service.dismiss(pairs, undefined, context));
  const createArguments = commerceDecoder(Schema.Tuple([createInput]), "invalidInput");
  const dismissArguments = commerceDecoder(Schema.Tuple([dismissInput]), "invalidInput");
  const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject), "storedCorruption");
  const events = [prepared.entityName + ".attached", prepared.entityName + ".detached"];
  const applyPreimageOperation = yield* Effect.fromResult(defineWorkflowMethod({ command: apply, arguments: applyArguments,
    encode: ([, request]) => request, output: decodeResult, moduleEvents: events }));
  const compensatePreimageOperation = yield* Effect.fromResult(defineWorkflowMethod({ command: compensate, arguments: compensateArguments,
    encode: ([handle]) => handle, output: decodeCompensation, moduleEvents: events }));
  const nativeCreate = yield* Effect.fromResult(defineWorkflowMethod({ command: create,
    arguments: createArguments, encode: ([pairs]) => pairs,
    output: decodeRows, moduleEvents: events }));
  const nativeDismiss = yield* Effect.fromResult(defineWorkflowMethod({ command: dismiss,
    arguments: dismissArguments, encode: ([pairs]) => pairs,
    output: decodeRows, moduleEvents: events }));
  const writePolicy = linkPreimageEventPolicy({ tableName: metadata.frame.name, serviceName, entityName: prepared.entityName,
    endpoints: ["cart_id", "promotion_id"], applyName, compensateName, createName, dismissName });
  const policy = { ...writePolicy, validateLogicalCall: Effect.fn("CartPromotionPreimages.validateCall")(function* (call, activity) {
    yield* call.commandName === "cartPromotionCount" ? read.logicalEventPolicy().validateLogicalCall(call, activity)
      : writePolicy.validateLogicalCall(call, activity);
  }) } satisfies typeof writePolicy;
  const allCommands = [...read.commands, apply, compensate, create, dismiss];
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "cart_promotion_preimage_links",
    source: { name: serviceName, profile: "cart-promotion.exact-preimages" }, graph: read.graph,
    methods: { applyPreimageOperation, compensatePreimageOperation, create: nativeCreate, dismiss: nativeDismiss },
    logical: { ...policy, commands: allCommands } }));
  const resource = yield* Effect.fromResult(defineComposedWorkflowResource({
    identity: { format: "medusa.cart-promotion.exact-preimages", serviceName, maximumMutations: 2, maximumPairsPerMutation: 4 },
    dependencies: [applyPreimageOperation, compensatePreimageOperation], scopeExclusive: true,
    methods: {
      applyPreimageOperation: { arguments: applyArguments, output: decodeResult },
      compensatePreimageOperation: { arguments: compensateArguments, output: decodeCompensation },
    },
    bind: invoke => ({ applyPreimageOperation: (selected, request) => invoke(applyPreimageOperation, selected, request),
      compensatePreimageOperation: handle => invoke(compensatePreimageOperation, handle) }),
  }));
  return { metadata, prepared, workflow, resource, commands: allCommands, policy, graph: read.graph };
});
