import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { PublishableApiKeySalesChannel } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { defineWorkflowModule } from "../workflow/module";
import { captureApiKeySalesChannelLinkMetadata } from "./api-key-sales-channel-schema";
import { decodeLinkCascade } from "./cascade-result";
import { apiKeyLinkEventPolicy } from "./api-key-events";
import { captureLinkOperationMetadata } from "./operation-schema";
import { prepareLinkService } from "./service";
import { prepareLinkWorkflowService, linkWorkflowServiceDefinition } from "./workflow-service";

const Ids = Schema.Array(Schema.String.check(Schema.isLengthBetween(1, 256))).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeEndpoint = commerceDecoder(Schema.Tuple([Schema.Struct({
  api_key: Schema.Struct({ publishable_key_id: Ids }),
})]), "invalidInput");

/** Guarded API Key deletion selects one genuine native Link family. Restoration
 * is absent because neither deleted keys nor their associations may be revived. */
export function prepareApiKeyDeletionLinkResource(service: unknown) {
  return Result.gen(function* () {
    const native = linkWorkflowServiceDefinition(service);
    if (native === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    if (native.admission !== "api-key-deletions" || native.lifecycle.durableOperations !== true || native.routing.__joinerConfig.serviceName !== PublishableApiKeySalesChannel.serviceName ||
      native.softDeleteMethod === undefined || native.restoreMethod !== undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDelete = native.softDeleteMethod;
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.api-key.deletion-links", services: [native.routing] },
      dependencies: [softDelete], scopeExclusive: true, methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade } },
      bind: invoke => {
        const loaded = { ...structuredClone(native.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config) };
        const router = new Link([loaded]);
        return { delete: endpoint => router.delete(structuredClone(endpoint)) };
      },
    });
  });
}

export const prepareApiKeyDeletionLinks = Effect.fn("ApiKeyDeletionLinks.prepare")(function* () {
  const prepared = yield* prepareLinkService(yield* captureApiKeySalesChannelLinkMetadata(), 8, true,
    (yield* captureLinkOperationMetadata()).frame);
  const nativeService = yield* Effect.fromResult(prepareLinkWorkflowService(prepared, "apiKeySalesChannelLink", "api-key-deletions"));
  const { softDelete, softDeleteName, softDeleteMethod } = nativeService;
  if (softDelete === undefined || softDeleteName === undefined || softDeleteMethod === undefined)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const commands = [nativeService.create, nativeService.list, softDelete];
  const logicalEventPolicy = () => apiKeyLinkEventPolicy({ tableName: prepared.prepared.table.name,
    serviceName: prepared.serviceName, entityName: prepared.entityName, createName: nativeService.createName, softDeleteName });
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: "api_key_sales_channel_deletion_links",
    source: { name: prepared.serviceName, profile: "api-key.deletion-links" }, graph: { aliases: [], reads: [] },
    methods: { create: nativeService.createMethod, list: nativeService.listMethod, softDelete: softDeleteMethod },
    logical: { ...logicalEventPolicy(), commands } }));
  const resource = yield* Effect.fromResult(prepareApiKeyDeletionLinkResource(nativeService));
  return { workflow, commands, logicalEventPolicy, nativeService, resource };
});
