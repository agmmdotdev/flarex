import { Schema } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";

/** Deployment attempts and selection share the existing logical program catalog. */
export const CoreApplicationDeploymentSchema = Schema.Struct({
  kind: Schema.Literal("applicationDeployment"), candidateId: DeveloperDocumentIdSchema,
  schemaId: DeveloperDocumentIdSchema, proof: Schema.String, metadata: Schema.optionalKey(Schema.String),
  createdAt: Schema.Finite, updatedAt: Schema.Finite, exclusiveFresh: Schema.Boolean,
  state: Schema.Literals(["prepared", "activated", "abandoned"]), activatedAt: Schema.optionalKey(Schema.Finite),
}).check(Schema.makeFilter(value => (value.state === "activated") === (value.activatedAt !== undefined)
  ? undefined : "Only an activated deployment carries its terminal activation date"));
export type CoreApplicationDeploymentValue = typeof CoreApplicationDeploymentSchema.Type;
export const decodeCoreApplicationDeployment = Schema.decodeUnknownResult(CoreApplicationDeploymentSchema);
export const CoreActiveApplicationSchema = Schema.Struct({ kind: Schema.Literal("activeApplication"), candidateId: DeveloperDocumentIdSchema });
export const decodeCoreActiveApplication = Schema.decodeUnknownResult(CoreActiveApplicationSchema);
export interface CoreApplicationDeploymentRecord {
  readonly value: CoreApplicationDeploymentValue;
  readonly id: Uint8Array;
  readonly ts: bigint | null;
}
export interface CoreActiveApplicationRecord {
  readonly candidateId: string;
  readonly id: Uint8Array;
  readonly ts: bigint | null;
}
