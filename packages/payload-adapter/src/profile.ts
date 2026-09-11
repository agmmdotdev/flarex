import { payloadHasMany, payloadJoins, payloadRelatedPostField, payloadRelatedPostsField } from "./contract";
import { payloadScalarFields, payloadScalarProvenance, payloadContentConfiguration, type PayloadContentProfile } from "./contract";
export { payloadScalarFields } from "./contract";
import { createHash } from "node:crypto";
import { encodeCanonicalJson, type Json } from "flarex-protocol/json";
import type { PayloadConfiguration } from "@flarex/analysis/internal/application-write-policy";
import type { CollectionConfig } from "payload";
import { Effect } from "effect";
import { registerPayloadContentProfiles, type PayloadContentProfiles } from "@flarex/persistence-postgres/internal/cms-adapter";

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
export const payloadScalarConfiguration: PayloadConfiguration = {
  format: "flarex.payload-configuration", version: 2, profile: "payload.scalar", provenanceSha256,
  tables: [{ logicalTableName: "posts", fields: payloadScalarFields }],
};
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

/** Opaque binding verifier for the exact closed profiles implemented by this package. */
export const makePayloadContentProfiles: () => Effect.Effect<PayloadContentProfiles> =
  Effect.fn("PayloadAdapter.makeContentProfiles")(function* () {
    return yield* registerPayloadContentProfiles([
      { relationCount: 0, identity: payloadScalarContentIdentity },
      { relationCount: 1, identity: payloadRelationContentIdentity },
      { relationCount: 2, identity: payloadManyContentIdentity },
      { relationCount: 2, identity: payloadJoinContentIdentity },
    ]).pipe(Effect.orDie);
  });
