import { createHash } from "node:crypto";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { PayloadProvenance, PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CollectionConfig } from "payload";

/** Closed compatibility profile; these fields also feed Application analysis. */
export const payloadScalarFields = [
  { name: "createdAt", kind: "date" },
  { name: "enabled", kind: "boolean" },
  { name: "publishedAt", kind: "date" },
  { name: "score", kind: "number" },
  { name: "title", kind: "text" },
  { name: "updatedAt", kind: "date" },
] as const;

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

const provenance: PayloadProvenance = {
  format: "flarex.payload-provenance", version: 1, package: "payload", release: "3.88.0",
  npmIntegrity: "sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==",
  gitTagObject: "c54dea8f4010d9cb194780f2ee1e4b3ec697f9be", gitCommit: "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22",
};
const digest = (value: Json) => createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid fixed Payload profile"); })).digest("hex");
const provenanceSha256 = digest(provenance);
export const payloadScalarConfiguration: PayloadConfiguration = {
  format: "flarex.payload-configuration", version: 1, profile: "payload.scalar", provenanceSha256,
  tables: [{ logicalTableName: "posts", fields: payloadScalarFields }],
};
export const payloadScalarContentIdentity = Object.freeze({ configSha256: digest(payloadScalarConfiguration), provenanceSha256 });
