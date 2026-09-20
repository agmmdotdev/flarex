import { payloadIsManagedField } from "./contract";
import { payloadUniqueSelections } from "@flarex/analysis/internal/application-write-policy";
import { makePayloadQuery, type PayloadCollection } from "./query";

/** Stable metadata only. Requests, principals, loaders and transactions never live here. */
export function makePayloadCollectionRuntime(collection: PayloadCollection) {
  return {
    ...collection,
    uniqueSelections: payloadUniqueSelections(collection),
    oneRelationship: collection.fields.find(field => field.kind === "relationship" && field.cardinality === "one"),
    query: makePayloadQuery(collection),
    writableNames: new Set(collection.fields.filter(field => !payloadIsManagedField(field.name)).map(field => field.name)),
  };
}
export type PayloadCollectionRuntime = ReturnType<typeof makePayloadCollectionRuntime>;
