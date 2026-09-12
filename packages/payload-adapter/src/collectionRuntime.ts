import { payloadIsManagedField } from "./contract";
import { makePayloadQuery, type PayloadCollection } from "./query";

/** Stable metadata only. Requests, principals, loaders and transactions never live here. */
export function makePayloadCollectionRuntime(collection: PayloadCollection) {
  return {
    ...collection,
    query: makePayloadQuery(collection),
    writableNames: new Set(collection.fields.filter(field => !payloadIsManagedField(field.name)).map(field => field.name)),
  };
}
export type PayloadCollectionRuntime = ReturnType<typeof makePayloadCollectionRuntime>;
