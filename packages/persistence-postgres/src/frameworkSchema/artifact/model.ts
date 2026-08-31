import type { Brand } from "effect";
import type { JsonObject } from "flarex-protocol/json";

export const FRAMEWORK_SCHEMA_ARTIFACT_FORMAT =
  "flarex.framework-schema-artifact";
export const FRAMEWORK_SCHEMA_ARTIFACT_VERSION = 1;

export type FrameworkSchemaOwner =
  | "application"
  | "payload"
  | "medusa"
  | "system";

export type FrameworkSchemaArtifactOwner = Exclude<
  FrameworkSchemaOwner,
  "application"
>;

export type FrameworkSchemaLineageId = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaLineageId"
>;

export type FrameworkSchemaCapabilityId = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaCapabilityId"
>;

export type FrameworkSchemaArtifactCodecFormat = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactCodecFormat"
>;

export type FrameworkSchemaArtifactCodecVersion = Brand.Branded<
  number,
  "FlarexDB/FrameworkSchemaArtifactCodecVersion"
>;

export type FrameworkSchemaArtifactSha256 = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactSha256"
>;

export type FrameworkSchemaArtifactCanonicalJson = Brand.Branded<
  string,
  "FlarexDB/FrameworkSchemaArtifactCanonicalJson"
>;

export interface FrameworkSchemaArtifactCoordinate {
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: FrameworkSchemaLineageId;
}

export interface FrameworkSchemaArtifactIdentity
  extends FrameworkSchemaArtifactCoordinate {
  readonly artifactSha256: FrameworkSchemaArtifactSha256;
}

export interface ListFrameworkSchemaArtifactIdentitiesInput
  extends FrameworkSchemaArtifactCoordinate {
  readonly afterArtifactSha256: FrameworkSchemaArtifactSha256 | null;
  readonly limit: number;
}

export interface FrameworkSchemaArtifactIdentityPage {
  readonly items: readonly FrameworkSchemaArtifactIdentity[];
  readonly nextAfterArtifactSha256: FrameworkSchemaArtifactSha256 | null;
}

export interface FrameworkSchemaArtifactCodec {
  readonly format: FrameworkSchemaArtifactCodecFormat;
  readonly version: FrameworkSchemaArtifactCodecVersion;
}

export interface FrameworkSchemaArtifact {
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly codec: FrameworkSchemaArtifactCodec;
  readonly provenance: JsonObject;
  readonly capabilities: readonly FrameworkSchemaCapabilityId[];
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly payload: JsonObject;
  readonly canonicalJson: FrameworkSchemaArtifactCanonicalJson;
}

export interface FrameworkSchemaArtifactFrame {
  readonly format: typeof FRAMEWORK_SCHEMA_ARTIFACT_FORMAT;
  readonly version: typeof FRAMEWORK_SCHEMA_ARTIFACT_VERSION;
  readonly deploymentId: string;
  readonly owner: FrameworkSchemaArtifactOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly payloadCodec: FrameworkSchemaArtifactCodec;
  readonly provenance: JsonObject;
  readonly capabilities: readonly FrameworkSchemaCapabilityId[];
  readonly dependencies: readonly FrameworkSchemaArtifactIdentity[];
  readonly payload: JsonObject;
}

export interface FrameworkSchemaArtifactCaptureInput {
  readonly deploymentId: unknown;
  readonly owner: unknown;
  readonly lineageId: unknown;
  readonly payloadCodec: unknown;
  readonly provenance: unknown;
  readonly capabilities: unknown;
  readonly dependencies: unknown;
  readonly payload: unknown;
}

export type FrameworkSchemaArtifactReplayClassification =
  | "exact"
  | "differentIdentity";
