import { Effect } from "effect";
import { registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductSchemaProfile } from "./product-schema";
import { productRuntimeMetadata } from "./product-runtime-metadata";

export const prepareLocalProductProfile = Effect.fn("ProductAdapter.prepareLocalProfile")(function* (
  ...args: Parameters<typeof prepareProductSchemaProfile>
) {
  const prepared = yield* prepareProductSchemaProfile(...args);
  const metadata = yield* productRuntimeMetadata(prepared.metadata.frame);
  const capabilities: { tableId: string; keyId: string }[] = [];
  for (const tableId of [...metadata.entities.map(entity => entity.table.name), metadata.pivot.table.name]) {
    const table = prepared.layout.frame.tables.find(candidate => candidate.identity.tableId === tableId);
    const key = table?.keys.find(candidate => candidate.kind === (tableId === metadata.pivot.table.name ? "unique" : "primary"));
    if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    capabilities.push({ tableId, keyId: key.identity.keyId });
  }
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.product.local", capabilities);
  return { ...prepared, profile, initialization: { rows: undefined } };
});
