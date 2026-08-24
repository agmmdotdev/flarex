import type { ApplicationManifestV2 } from
  "@flarex/analysis/application-analysis";
import { Data } from "effect";
import type {
  ApplicationManifestSchemaBindingV1,
  ApplicationManifestSchemaBindingSha256Hex,
  ApplicationSchemaBindingSha256Hex,
  ApplicationSchemaBindingV2,
  ApplicationSchemaRelationBindingV2,
} from "flarex-protocol/internal/application-schema-binding";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";

type PersistedRelationEvolution =
  ApplicationSchemaRelationBindingV2["evolution"];
type PersistedPreserveEvolution = Extract<
  PersistedRelationEvolution,
  { readonly kind: "preserve" }
>;

export type RelationEvolutionDecision =
  | Readonly<{
      readonly relationOrdinal: number;
      readonly evolution: Readonly<{ readonly kind: "new" }>;
    }>
  | Readonly<{
      readonly relationOrdinal: number;
      readonly evolution: Readonly<
        Pick<
          PersistedPreserveEvolution,
          | "kind"
          | "fromSchemaVersionId"
          | "fromRelationOrdinal"
          | "physical"
        >
      >;
    }>;

export interface PublishApplicationRelationBindingInput {
  readonly deploymentId: string;
  readonly manifest: ApplicationManifestV2;
  readonly manifestSha256: string;
  readonly decisions: ReadonlyArray<RelationEvolutionDecision>;
}

export interface ApplicationRelationBindingPublication {
  readonly status: "created" | "existing";
  readonly binding: ApplicationSchemaBindingV2;
  readonly boundPublicationSha256: ApplicationSchemaBindingSha256Hex;
  readonly manifestBinding: ApplicationManifestSchemaBindingV1;
  readonly manifestSchemaBindingSha256:
    ApplicationManifestSchemaBindingSha256Hex;
}

/** Canonical R02 root revalidated for one private commit consumer. */
export interface LocatedApplicationRelationBinding {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly binding: ApplicationSchemaBindingV2;
  readonly applicationSchemaSha256: Uint8Array;
  readonly schemaManifestSha256: Uint8Array;
  readonly boundPublicationSha256: Uint8Array;
}

export class ReadApplicationRelationBindingError extends Data.TaggedError(
  "ReadApplicationRelationBindingError",
)<{
  readonly operation: "locateCommitBinding";
  readonly reason: "invalidInput" | "storedState" | "resourceFailure";
  readonly cause?: unknown;
}> {}

export type ApplicationRelationBindingFailureReason =
  | "invalidDeployment"
  | "invalidManifest"
  | "manifestDigestMismatch"
  | "invalidEvolution"
  | "schemaVersionExhausted"
  | "relationIdExhausted"
  | "edgeDefinitionIdExhausted"
  | "missingOrigin"
  | "physicalReuseMismatch"
  | "physicalReplacementMatch"
  | "bindingConflict"
  | "storedState"
  | "resourceFailure"
  | "retryExhausted";

export class ApplicationRelationBindingError extends Data.TaggedError(
  "ApplicationRelationBindingError",
)<{
  readonly operation: "publish";
  readonly reason: ApplicationRelationBindingFailureReason;
  readonly retryable: boolean;
  readonly detail?: string;
  readonly cause?: unknown;
}> {}
