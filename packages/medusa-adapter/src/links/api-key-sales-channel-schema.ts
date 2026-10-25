import { Effect } from "effect";
import { PublishableApiKeySalesChannel } from "@medusajs/link-modules";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLinkMetadata, linkSchemaOrigins, LinkSchemaError } from "./schema";
import { lowerDmlSchema } from "../schema/lower";
import { captureLinkOperationMetadata } from "./operation-schema";

export const captureApiKeySalesChannelLinkMetadata = Effect.fn("ApiKeySalesChannelLink.captureMetadata")(function* () {
  const [primary, foreign] = PublishableApiKeySalesChannel.relationships ?? [];
  if (primary?.serviceName !== "api_key" || primary.foreignKey !== "publishable_key_id" || primary.hasMany !== true ||
    foreign?.serviceName !== "sales_channel" || foreign.foreignKey !== "sales_channel_id" || foreign.hasMany !== true ||
    PublishableApiKeySalesChannel.databaseConfig?.tableName !== "publishable_api_key_sales_channel" ||
    PublishableApiKeySalesChannel.databaseConfig.idPrefix !== "pksc")
    return yield* Effect.fail(new LinkSchemaError({ cause: "Unsupported API Key Sales Channel Link" }));
  return yield* captureLinkMetadata(PublishableApiKeySalesChannel);
});

export const apiKeySalesChannelLinkProvenance = Object.freeze({
  kind: "sourceSnapshot", repository: "https://github.com/agmmdotdev/medusa-fork.git",
  revision: "48d5cc675e4e8bc821e22c20c88a751acc66fb5f",
  paths: Object.freeze(["packages/modules/link-modules/src/definitions/publishable-api-key-sales-channel.ts",
    "packages/modules/link-modules/src/utils/generate-entity.ts"]),
  correction: { owner: "nativeLink", profile: "durableOperations", sources: [
    "packages/medusa-link-modules/src/models/link-workflow-operation.ts",
    "packages/medusa-link-modules/src/models/link-pair-revision.ts",
    "packages/medusa-link-modules/src/operations/contracts.ts",
    "packages/medusa-link-modules/src/operations/store.ts",
    "packages/medusa-link-modules/src/operations/service.ts",
  ] },
} as const);

export const compileApiKeySalesChannelLinkDefinition = Effect.fn("ApiKeySalesChannelLink.compileDefinition")(function* () {
  const metadata = yield* captureApiKeySalesChannelLinkMetadata();
  const operations = yield* captureLinkOperationMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema(
    [metadata.frame, ...operations.frame.tables], "commerce.link.api-key-sales-channel", linkSchemaOrigins,
  )));
  return Object.freeze({ schema, provenance: apiKeySalesChannelLinkProvenance });
});
