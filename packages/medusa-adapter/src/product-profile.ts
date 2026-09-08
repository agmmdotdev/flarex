import { Effect } from "effect";
import { registerLocalCommerceProfile, type LocalCommerceTableAdmission } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductSchemaProfile } from "./product-schema";
import { productRuntimeMetadata } from "./product-runtime-metadata";

export const prepareLocalProductProfile = Effect.fn("ProductAdapter.prepareLocalProfile")(function* (
  ...args: Parameters<typeof prepareProductSchemaProfile>
) {
  const prepared = yield* prepareProductSchemaProfile(...args);
  const metadata = yield* productRuntimeMetadata(prepared.metadata.frame);
  const capabilities: LocalCommerceTableAdmission[] = [];
  for (const selected of metadata.tables) {
    const tableId = selected.name;
    const table = prepared.layout.frame.tables.find(candidate => candidate.identity.tableId === tableId);
    const key = table?.keys.find(candidate => candidate.kind === (selected.columns.some(column => column.primaryKey) ? "primary" : "unique"));
    if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    capabilities.push({ tableId, keyId: key.identity.keyId,
      ...(metadata.entities.some(entity => entity.table === selected && entity !== metadata.assignment) ? { update: "existingPrimaryKey" as const } : {}),
      ...(selected === metadata.product.table ? { referenceColumns: ["collection_id", "type_id"] } : {}),
      ...([metadata.option.table, metadata.value.table, metadata.variant.table, metadata.image.table, ...metadata.writablePivots].includes(selected) ? { remove: "declaredKey" as const } : {}),
    });
  }
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.product.local", capabilities);
  return { ...prepared, profile, initialization: { rows: undefined } };
});
