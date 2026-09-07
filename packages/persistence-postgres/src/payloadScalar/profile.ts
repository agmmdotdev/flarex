import { payloadScalarFields, payloadScalarProvenance, payloadContentConfiguration, type PayloadContentProfile } from "./contract";
export { payloadScalarFields } from "./contract";
import { createHash } from "node:crypto";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CollectionConfig } from "payload";

export function scalarPostsCollection(profile: PayloadContentProfile = "payload.scalar"): CollectionConfig {
  return { slug: "posts", lockDocuments: false, enableQueryPresets: false, timestamps: true, defaultSort: "id",
    // The private host authenticates the command; these fixed local policies
    // exercise Payload access execution without admitting dynamic user callbacks.
    access: { read: () => true, create: () => true, update: () => true, delete: () => true },
    fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "score", type: "number", required: true, defaultValue: 0 },
      { name: "enabled", type: "checkbox", required: true, defaultValue: false },
      { name: "publishedAt", type: "date", required: true },
      ...(profile === "payload.content-relations" ? [{ name: "relatedPost", type: "relationship", relationTo: "posts", hasMany: false, required: false } as const] : []),
    ] };
}

const digest = (value: Json) => createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid fixed Payload profile"); })).digest("hex");
const provenanceSha256 = digest(payloadScalarProvenance);
export const payloadScalarConfiguration: PayloadConfiguration = {
  format: "flarex.payload-configuration", version: 1, profile: "payload.scalar", provenanceSha256,
  tables: [{ logicalTableName: "posts", fields: payloadScalarFields }],
};
export const payloadScalarContentIdentity = Object.freeze({ configSha256: digest(payloadScalarConfiguration), provenanceSha256 });
export const payloadRelationConfiguration = payloadContentConfiguration("payload.content-relations", provenanceSha256);
export const payloadRelationContentIdentity = Object.freeze({ configSha256: digest(payloadRelationConfiguration), provenanceSha256 });
