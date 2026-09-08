import { Effect } from "effect";
import { registerLocalCommerceProfile, type CommerceResources, type LocalCommerceTableAdmission } from "@flarex/persistence-postgres/internal/commerce-profile";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareProductSchemaProfile } from "./product-schema";
import { productRuntimeMetadata } from "./product-runtime-metadata";

const prepareProductProfile = Effect.fn("ProductAdapter.prepareLocalProfile")(function* (
  resources: CommerceResources | undefined,
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
      remove: "declaredKey",
      ...([metadata.product.table, metadata.option.table, metadata.value.table, metadata.variant.table, metadata.image.table].includes(selected) ? { lifecycle: "managedSoftDelete" as const } : {}),
    });
  }
  const profile = yield* registerLocalCommerceProfile(prepared.artifact, prepared.layout, "medusa.product.local", capabilities, resources);
  return { ...prepared, profile, initialization: { rows: undefined } };
});

/** Private scale conformance contract; deadlines and ordinary profiles stay unchanged. */
export const productScaleResources: CommerceResources = Object.freeze({
  catalogRows: 2048, queryRows: 2048, writeBatchRows: 256, facts: 2048,
  calls: 2048, eventMessages: 1024, eventIds: 256, commandBytes: 4_194_304, valueNodes: 32_768,
});
export const prepareLocalProductProfile = (...args: Parameters<typeof prepareProductSchemaProfile>) => prepareProductProfile(undefined, ...args);
export const prepareLocalProductScaleProfile = (...args: Parameters<typeof prepareProductSchemaProfile>) => prepareProductProfile(productScaleResources, ...args);
