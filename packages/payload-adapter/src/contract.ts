import type { PayloadProvenance, PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";

/** Closed compatibility profile; these fields also feed Application analysis. */
export const payloadScalarFields = Object.freeze(([
  { name: "title", kind: "text", unique: true },
  { name: "score", kind: "number", defaultValue: 0 },
  { name: "enabled", kind: "boolean", defaultValue: false },
  { name: "publishedAt", kind: "date" },
  { name: "updatedAt", kind: "date" },
  { name: "createdAt", kind: "date" },
] as const).map(field => Object.freeze(field)));

export type PayloadContentProfile = PayloadConfiguration["profile"];
export const payloadRelatedPostField = Object.freeze({ name: "relatedPost", kind: "relationship", target: "posts",
  cardinality: "one", required: false, localized: false, onTargetDelete: "restrict" } as const);
export const payloadRelationFields = Object.freeze([...payloadScalarFields.filter(field => !payloadIsManagedField(field.name)), payloadRelatedPostField, ...payloadScalarFields.filter(field => payloadIsManagedField(field.name))]);
export const payloadRelatedPostsField = Object.freeze({ name: "relatedPosts", kind: "relationship", target: "posts",
  cardinality: "many", minItems: 0, maxItems: 32, localized: false, onTargetDelete: "restrict" } as const);
export const payloadManyFields = Object.freeze([...payloadRelationFields.filter(field => !payloadIsManagedField(field.name)), payloadRelatedPostsField, ...payloadScalarFields.filter(field => payloadIsManagedField(field.name))]);
export const payloadHasMany = (profile: PayloadContentProfile): boolean => profile === "payload.content-many" || profile === "payload.content-joins";
export const payloadContentFields = (profile: PayloadContentProfile) =>
  profile === "payload.scalar" ? payloadScalarFields : payloadHasMany(profile) ? payloadManyFields : payloadRelationFields;

/** These fields are assigned by Payload, not accepted from command callers. */
export function payloadIsManagedField(name: string): boolean { return name === "createdAt" || name === "updatedAt"; }
export const payloadJoins = Object.freeze([
  Object.freeze({ name: "referencedBy", collection: "posts", on: "relatedPost", orderable: false, localized: false, maxDepth: 1, defaultLimit: 8, maximumLimit: 16 } as const),
  Object.freeze({ name: "referencedByMany", collection: "posts", on: "relatedPosts", orderable: false, localized: false, maxDepth: 1, defaultLimit: 8, maximumLimit: 16 } as const),
] as const);
export function payloadContentConfiguration(profile: PayloadContentProfile, provenanceSha256: string): PayloadConfiguration {
  const tables = [{ logicalTableName: "posts", collectionSlug: "posts", timestamps: true, fields: payloadContentFields(profile) }];
  if (profile === "payload.content-joins") return { format: "flarex.payload-configuration", version: 3, profile, provenanceSha256, tables, joins: payloadJoins };
  return { format: "flarex.payload-configuration", version: 3, profile, provenanceSha256,
    tables };
}

export const payloadScalarProvenance: PayloadProvenance = Object.freeze({
  format: "flarex.payload-provenance", version: 1, package: "payload", release: "3.88.0",
  npmIntegrity: "sha512-O7zuS80bvEGLte+7xZjwN05+ox5BCsGcQT2M6+CTote07JQOOvHJoiuoyQFw6cUElcFTWGMC5dy03w7J7sTYGg==",
  gitTagObject: "c54dea8f4010d9cb194780f2ee1e4b3ec697f9be", gitCommit: "fea6f8a47a50ff1330d8a5071b43e7dcffb97b22",
});
