import { payloadScalarFields, payloadScalarProvenance } from "./contract";
export { payloadScalarFields } from "./contract";
import { createHash } from "node:crypto";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CollectionConfig } from "payload";

export function scalarPostsCollection(): CollectionConfig {
  return { slug: "posts", lockDocuments: false, enableQueryPresets: false, timestamps: true, defaultSort: "id",
    // The private host authenticates the command; these fixed local policies
    // exercise Payload access execution without admitting dynamic user callbacks.
    access: { read: () => true, create: () => true, update: () => true, delete: () => true },
    fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "score", type: "number", required: true, defaultValue: 0 },
      { name: "enabled", type: "checkbox", required: true, defaultValue: false },
      { name: "publishedAt", type: "date", required: true },
    ] };
}

const digest = (value: Json) => createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid fixed Payload profile"); })).digest("hex");
const provenanceSha256 = digest(payloadScalarProvenance);
export const payloadScalarConfiguration: PayloadConfiguration = {
  format: "flarex.payload-configuration", version: 1, profile: "payload.scalar", provenanceSha256,
  tables: [{ logicalTableName: "posts", fields: payloadScalarFields }],
};
export const payloadScalarContentIdentity = Object.freeze({ configSha256: digest(payloadScalarConfiguration), provenanceSha256 });
