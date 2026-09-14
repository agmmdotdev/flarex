import type { JsonObject } from "flarex-protocol/json";
import type { RelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { FrameworkSchemaArtifact } from "../frameworkSchema/artifact/model";

export interface RelationalSchemaArtifactCaptureInput {
  readonly deploymentId: unknown;
  readonly provenance: unknown;
  readonly schema: unknown;
}

export type RelationalSchemaArtifactProvenance =
  | (Readonly<{
      readonly kind: "sourceSnapshot";
      readonly repository: string;
      readonly revision: string;
      readonly paths: readonly string[];
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "synthetic";
      readonly fixtureId: string;
    }> & JsonObject);

export interface CapturedRelationalSchemaArtifact {
  readonly schema: RelationalSchema;
  readonly artifact: FrameworkSchemaArtifact;
}
