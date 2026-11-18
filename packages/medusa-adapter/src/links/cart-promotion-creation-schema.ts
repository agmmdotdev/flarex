import { Effect } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCoreRelationalNativeDefinition } from "@flarex/persistence-postgres/internal/core";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { lowerDmlSchema } from "../schema/lower";
import { captureLinkMetadata, linkSchemaOrigins } from "./schema";
import { captureLinkOperationMetadata } from "./operation-schema";
import { captureCartPromotionLinkMetadata, cartPromotionLinkProvenance } from "./cart-promotion-schema";

/** Fresh opt-in source. The existing one-table checkout read profile stays
 * separate; populated sources need an explicitly designed migration. */
export const captureCartPromotionCreationLinkMetadata = Effect.fn("CartPromotionCreationLink.captureMetadata")(function* () {
  const original = yield* captureCartPromotionLinkMetadata();
  return yield* captureLinkMetadata({ ...original.joiner, databaseConfig: {
    ...original.joiner.databaseConfig, workflowOperations: true, preimageOperations: true,
  } });
});
export const cartPromotionCreationLinkProvenance = Object.freeze({ ...cartPromotionLinkProvenance,
  correction: { owner: "nativeLink", profile: "exactPreimageOperations", sources: [
    "packages/medusa-link-modules/src/operations/preimage-contracts.ts",
    "packages/medusa-link-modules/src/operations/preimage-service.ts",
    "packages/medusa-link-modules/src/operations/preimage-storage.ts",
    "packages/medusa-link-modules/src/operations/store.ts",
  ] },
} as const);
export const compileCartPromotionCreationLinkDefinition = Effect.fn("CartPromotionCreationLink.compileDefinition")(function* () {
  const metadata = yield* captureCartPromotionCreationLinkMetadata(), operations = yield* captureLinkOperationMetadata();
  const schema = yield* Effect.fromResult(normalizeRelationalSchema(lowerDmlSchema([metadata.frame, ...operations.frame.tables],
    "commerce.link.cart-promotion-creation", linkSchemaOrigins)));
  return Object.freeze({ schema, provenance: cartPromotionCreationLinkProvenance });
});

/** Keep the association, operation preimages and pair revisions in one source. */
export const compileCartPromotionCreationLinkCoreDefinition = Effect.fn("CartPromotionCreationLink.compileCoreDefinition")(function* ({ scopeUuid, epochUuid }: Readonly<{
  scopeUuid: string;
  epochUuid: string;
}>) {
  const { schema, provenance } = yield* compileCartPromotionCreationLinkDefinition();
  const source = yield* captureLogicalSchemaSource({ key: "medusa.cart-promotion-preimages", owner: "medusa", writeProfile: "medusa.cart-promotion-preimages",
    evidence: { provenance, profile: "medusa.cart-promotion-preimages" }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ scopeUuid, epochUuid, applicationRead: false, source, provenance, commands: [] });
});
