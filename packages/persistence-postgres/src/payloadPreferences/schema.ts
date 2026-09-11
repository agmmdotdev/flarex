import { Effect } from "effect";
import { captureRelationalSchemaArtifact } from "../relationalSchema/artifact";

/** Exact source revision for the currently admitted preference storage shape. */
export const payloadPreferenceSourceRevision =
  "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22";

const origin = (sourceId: string) => ({ kind: "authored", sourceId });

/** Reserved lifecycle data only. Opaque user references grant no auth/relation authority. */
export function payloadPreferenceSchemaInput() {
  const columns = ["storage_generation", "id", "key", "user_collection", "user_id", "value", "created_at", "updated_at"];
  return { owner: "payload", lineageId: "payload-preferences", tables: [{
    tableId: "preferences", origin: origin("payload.preferences"),
    columns: columns.map(columnId => ({ columnId, type: columnId === "value" ? "jsonb" : columnId.endsWith("_at") ? "timestamptz" : "text",
      nullable: columnId === "key" || columnId === "value", default: { kind: "none" }, origin: origin(`payload.preferences.${columnId}`) })),
    keys: [{ keyId: "preferences.primary", kind: "primary", columns: ["storage_generation", "id"], origin: origin("payload.preferences.primary") }],
    indexes: [{ indexId: "preferences.key", kind: "btree", columns: ["storage_generation", "key"], predicate: null, origin: origin("payload.preferences.key") }],
    constraints: [], relationships: [],
  }], capabilities: [] };
}
export const capturePayloadPreferenceArtifact = Effect.fn("PayloadPreferences.captureArtifact")((deploymentId: string) =>
  captureRelationalSchemaArtifact({ deploymentId, schema: payloadPreferenceSchemaInput(), provenance: {
    kind: "sourceSnapshot", repository: "https://github.com/payloadcms/payload", revision: payloadPreferenceSourceRevision,
    paths: ["packages/payload/src/preferences/config.ts", "packages/payload/src/preferences/deleteUserPreferences.ts"],
  } }));
