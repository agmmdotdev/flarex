import { payloadHasMany, payloadJoins, payloadRelatedPostField, payloadRelatedPostsField } from "./contract";
import { payloadIsManagedField, payloadScalarProvenance, type PayloadContentProfile } from "./contract";
import { createHash } from "node:crypto";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CollectionConfig } from "payload";
import { Effect } from "effect";
import { registerPayloadContentProfiles, type PayloadContentProfiles } from "@flarex/persistence-postgres/internal/cms-adapter";

/** Concrete collections and identities are conformance data, never ordinary defaults. */
export const payloadScalarFields = Object.freeze(([
  { name: "title", kind: "text", unique: true },
  { name: "score", kind: "number", defaultValue: 0 },
  { name: "enabled", kind: "boolean", defaultValue: false },
  { name: "publishedAt", kind: "date" },
  { name: "updatedAt", kind: "date" },
  { name: "createdAt", kind: "date" },
] as const).map(field => Object.freeze(field)));
const payloadRelationFields = Object.freeze([...payloadScalarFields.filter(field => !payloadIsManagedField(field.name)), payloadRelatedPostField, ...payloadScalarFields.filter(field => payloadIsManagedField(field.name))]);
const payloadManyFields = Object.freeze([...payloadRelationFields.filter(field => !payloadIsManagedField(field.name)), payloadRelatedPostsField, ...payloadScalarFields.filter(field => payloadIsManagedField(field.name))]);
export const payloadContentFields = (profile: PayloadContentProfile) =>
  profile === "payload.scalar" ? payloadScalarFields : payloadHasMany(profile) ? payloadManyFields : payloadRelationFields;
export function payloadContentConfiguration(profile: PayloadContentProfile, provenanceSha256: string): PayloadConfiguration {
  const tables = [{ logicalTableName: "posts", collectionSlug: "posts", timestamps: true, fields: payloadContentFields(profile) }];
  if (profile === "payload.content-joins") return { format: "flarex.payload-configuration", version: 3, profile, provenanceSha256, tables, joins: payloadJoins };
  return { format: "flarex.payload-configuration", version: 3, profile, provenanceSha256, tables };
}

export function payloadPostsCollection(profile: PayloadContentProfile = "payload.scalar"): CollectionConfig {
  return { slug: "posts", lockDocuments: false, enableQueryPresets: false, timestamps: true, defaultSort: "id",
    // The private host authenticates the command; these fixed local policies
    // exercise Payload access execution without admitting dynamic user callbacks.
    access: { read: () => true, create: () => true, update: () => true, delete: () => true },
    fields: [
      { name: "title", type: "text", required: true, unique: true },
      { name: "score", type: "number", required: true, defaultValue: 0 },
      { name: "enabled", type: "checkbox", required: true, defaultValue: false },
      { name: "publishedAt", type: "date", required: true },
      ...(profile !== "payload.scalar" ? [{ name: payloadRelatedPostField.name, type: "relationship", relationTo: payloadRelatedPostField.target, hasMany: false, required: payloadRelatedPostField.required } as const] : []),
      ...(payloadHasMany(profile) ? [{ name: payloadRelatedPostsField.name, type: "relationship", relationTo: payloadRelatedPostsField.target, hasMany: true, required: false, maxRows: payloadRelatedPostsField.maxItems, defaultValue: [] } as const] : []),
      ...(profile === "payload.content-joins" ? payloadJoins.map(({ maximumLimit: _maximum, ...join }) => ({ ...join, type: "join" as const })) : []),
    ] };
}

const digest = (value: Json) => createHash("sha256").update(encodeCanonicalJson(value, () => { throw new Error("Invalid fixed Payload profile"); })).digest("hex");
const provenanceSha256 = digest(payloadScalarProvenance);
export const payloadScalarConfiguration: PayloadConfiguration = payloadContentConfiguration("payload.scalar", provenanceSha256);
export const payloadScalarContentIdentity = Object.freeze({ configSha256: digest(payloadScalarConfiguration), provenanceSha256 });
export const payloadRelationConfiguration = payloadContentConfiguration("payload.content-relations", provenanceSha256);
export const payloadRelationContentIdentity = Object.freeze({ configSha256: digest(payloadRelationConfiguration), provenanceSha256 });
export const payloadManyConfiguration = payloadContentConfiguration("payload.content-many", provenanceSha256);
export const payloadManyContentIdentity = Object.freeze({ configSha256: digest(payloadManyConfiguration), provenanceSha256 });

export const payloadJoinConfiguration = payloadContentConfiguration("payload.content-joins", provenanceSha256);
export const payloadJoinContentIdentity = Object.freeze({ configSha256: digest(payloadJoinConfiguration), provenanceSha256 });

export function payloadContentIdentity(profile: PayloadContentProfile) {
  switch (profile) {
    case "payload.scalar": return payloadScalarContentIdentity;
    case "payload.content-relations": return payloadRelationContentIdentity;
    case "payload.content-many": return payloadManyContentIdentity;
    case "payload.content-joins": return payloadJoinContentIdentity;
  }
}

/** Test-only registration of the retained closed conformance configurations. */
export const makePayloadConformanceProfiles: () => Effect.Effect<PayloadContentProfiles> =
  Effect.fn("PayloadConformance.makeContentProfiles")(function* () {
    return yield* registerPayloadContentProfiles([
      { relationCount: 0, identity: payloadScalarContentIdentity },
      { relationCount: 1, identity: payloadRelationContentIdentity },
      { relationCount: 2, identity: payloadManyContentIdentity },
      { relationCount: 2, identity: payloadJoinContentIdentity },
    ]).pipe(Effect.orDie);
  });

export function payloadConformanceConfiguration(profile: PayloadContentProfile) {
  return {
    configuration: payloadContentConfiguration(profile, provenanceSha256),
    contentIdentity: payloadContentIdentity(profile),
    createNativeCollections: () => [payloadPostsCollection(profile)],
  };
}
