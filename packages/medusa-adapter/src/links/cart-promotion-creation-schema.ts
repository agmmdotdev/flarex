import { Effect } from "effect";
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
