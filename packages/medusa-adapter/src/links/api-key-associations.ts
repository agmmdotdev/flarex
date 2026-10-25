import { Effect, Schema } from "effect";
import { LinkOperationRequestSchema, LinkOperationHandleSchema, LinkOperationResultSchema,
  LinkOperationCompensationSchema } from "@medusajs/link-modules";
import { LINKS } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { commerceCommandPreparation, commerceServiceCommands } from "../module/commands";
import { defineWorkflowMethod, defineWorkflowModule } from "../workflow/module";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { captureApiKeySalesChannelLinkMetadata } from "./api-key-sales-channel-schema";
import { captureLinkOperationMetadata } from "./operation-schema";
import { prepareLinkService } from "./service";
import { apiKeyLinkEventPolicy } from "./api-key-events";

const serviceName = LINKS.PublishableApiKeySalesChannel;
const boundedRequest = LinkOperationRequestSchema.check(Schema.makeFilter(request =>
  request.add.length <= 4 && request.remove.length <= 4 &&
  new Set([...request.add, ...request.remove].map(pair => pair.primary)).size <= 1));
const isBoundedRequest = Schema.is(boundedRequest);
const boundedHandle = LinkOperationHandleSchema.check(Schema.makeFilter(handle =>
  handle.serviceName === serviceName && isBoundedRequest(handle.request)));
const decodeRequest = commerceDecoder(boundedRequest, "invalidInput");
const decodeHandle = commerceDecoder(boundedHandle, "invalidInput");
const decodeResult = commerceDecoder(LinkOperationResultSchema, "storedCorruption");
const decodeCompensation = commerceDecoder(LinkOperationCompensationSchema, "storedCorruption");
const decodeApplyArguments = commerceDecoder(Schema.Tuple([Schema.Literal(serviceName), boundedRequest]), "invalidInput");
const decodeCompensateArguments = commerceDecoder(Schema.Tuple([boundedHandle]), "invalidInput");

/** The genuine native Link protocol owns replay and compensation. This finite
 * resource only translates its two named methods into authenticated commands. */
export const prepareApiKeyAssociationLinks = Effect.fn("ApiKeyAssociationLinks.prepare")(function* () {
  const prepared = yield* prepareLinkService(yield* captureApiKeySalesChannelLinkMetadata(), 8, true,
    (yield* captureLinkOperationMetadata()).frame);
  if (prepared.lifecycle.durableOperations !== true) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const commands = commerceServiceCommands(prepared.useService);
  const prepare = commerceCommandPreparation("ApiKeyAssociationLinks.prepareCommand");
  const applyName = "apiKeySalesChannelApplyOperation", compensateName = "apiKeySalesChannelCompensateOperation";
  const apply = commands.write(applyName, prepare(decodeRequest), ({ service, context }, request) => service.applyOperation(request, context));
  const compensate = commands.write(compensateName, prepare(decodeHandle), ({ service, context }, handle) => service.compensateOperation(handle, context));
  const events = [prepared.entityName + ".attached", prepared.entityName + ".detached"];
  const applyOperation = yield* Effect.fromResult(defineWorkflowMethod({ command: apply, arguments: decodeApplyArguments,
    encode: ([, request]) => request, output: decodeResult, moduleEvents: events }));
  const compensateOperation = yield* Effect.fromResult(defineWorkflowMethod({ command: compensate, arguments: decodeCompensateArguments,
    encode: ([handle]) => handle, output: decodeCompensation, moduleEvents: events }));
  const logicalEventPolicy = () => apiKeyLinkEventPolicy({ tableName: prepared.prepared.table.name,
    serviceName: prepared.serviceName, entityName: prepared.entityName,
    createName: "apiKeyAssociationSeedCreate", softDeleteName: "apiKeyAssociationDeletion",
    applyName, compensateName });
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "api_key_sales_channel_association_links",
    source: { name: prepared.serviceName, profile: "api-key.association-links" }, graph: { aliases: [], reads: [] },
    methods: { applyOperation, compensateOperation }, logical: { ...logicalEventPolicy(), commands: [apply, compensate] } }));
  const resource = yield* Effect.fromResult(defineComposedWorkflowResource({
    identity: { format: "medusa.api-key.association-links", serviceName, maximumAdds: 4, maximumRemoves: 4 },
    dependencies: [applyOperation, compensateOperation], scopeExclusive: true,
    methods: {
      applyOperation: { arguments: decodeApplyArguments, output: decodeResult },
      compensateOperation: { arguments: decodeCompensateArguments, output: decodeCompensation },
    },
    bind: invoke => ({
      applyOperation: (selected, request) => invoke(applyOperation, selected, request),
      compensateOperation: handle => invoke(compensateOperation, handle),
    }),
  }));
  return { workflow, resource, commands: [apply, compensate], logicalEventPolicy, apply, compensate };
});
