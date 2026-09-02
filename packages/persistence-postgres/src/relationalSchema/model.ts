import type { Brand } from "effect";
import type { JsonObject } from "flarex-protocol/json";

import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactOwner,
  FrameworkSchemaLineageId,
} from "../frameworkSchema/artifact/model";

export const RELATIONAL_SCHEMA_FORMAT = "flarex.relational-schema";
export const RELATIONAL_SCHEMA_FORMAT_VERSION = 1;

export type RelationalSchemaOwner = Extract<
  FrameworkSchemaArtifactOwner,
  "medusa" | "system"
>;

export type RelationalTableId = Brand.Branded<
  string,
  "FlarexDB/RelationalTableId"
>;
export type RelationalColumnId = Brand.Branded<
  string,
  "FlarexDB/RelationalColumnId"
>;
export type RelationalKeyId = Brand.Branded<
  string,
  "FlarexDB/RelationalKeyId"
>;
export type RelationalIndexId = Brand.Branded<
  string,
  "FlarexDB/RelationalIndexId"
>;
export type RelationalConstraintId = Brand.Branded<
  string,
  "FlarexDB/RelationalConstraintId"
>;
export type RelationalRelationshipId = Brand.Branded<
  string,
  "FlarexDB/RelationalRelationshipId"
>;
export type RelationalPersistenceCapabilityId = Brand.Branded<
  string,
  "FlarexDB/RelationalPersistenceCapabilityId"
>;
export type RelationalDefinitionSourceId = Brand.Branded<
  string,
  "FlarexDB/RelationalDefinitionSourceId"
>;

export type RelationalSchemaCoordinate = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
}> & JsonObject;

export type RelationalTableIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
}> & JsonObject;

export type RelationalColumnIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
  readonly columnId: RelationalColumnId;
}> & JsonObject;

export type RelationalKeyIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
  readonly keyId: RelationalKeyId;
}> & JsonObject;

export type RelationalIndexIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
  readonly indexId: RelationalIndexId;
}> & JsonObject;

export type RelationalConstraintIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
  readonly constraintId: RelationalConstraintId;
}> & JsonObject;

export type RelationalRelationshipIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly tableId: RelationalTableId;
  readonly relationshipId: RelationalRelationshipId;
}> & JsonObject;

export type RelationalPersistenceCapabilityIdentity = Readonly<{
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly capabilityId: RelationalPersistenceCapabilityId;
}> & JsonObject;

export type RelationalDefinitionOrigin = Readonly<{
  readonly kind: "authored" | "derived" | "implicit" | "synthetic";
  readonly sourceId: RelationalDefinitionSourceId;
}> & JsonObject;

export type RelationalColumnType =
  | "text"
  | "integer"
  | "numeric"
  | "jsonb"
  | "timestamptz";

export type RelationalColumnDefault =
  | (Readonly<{ readonly kind: "none" }> & JsonObject)
  | (Readonly<{
      readonly kind: "textLiteral";
      readonly value: string;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "integerLiteral";
      readonly value: number;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "exactNumericLiteral";
      readonly value: string;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "exactNumericRawLiteral";
      readonly value: string;
      readonly precision: number;
    }> & JsonObject)
  | (Readonly<{ readonly kind: "currentTimestamp" }> & JsonObject);

export type RelationalColumnDefinition = Readonly<{
  readonly identity: RelationalColumnIdentity;
  readonly type: RelationalColumnType;
  readonly nullable: boolean;
  readonly default: RelationalColumnDefault;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalKeyDefinition = Readonly<{
  readonly identity: RelationalKeyIdentity;
  readonly kind: "primary" | "unique";
  readonly columns: readonly RelationalColumnIdentity[];
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalIndexPredicate =
  | null
  | (Readonly<{
      readonly kind: "isNull";
      readonly column: RelationalColumnIdentity;
    }> & JsonObject);

export type RelationalIndexDefinition = Readonly<{
  readonly identity: RelationalIndexIdentity;
  readonly kind: "btree";
  readonly columns: readonly RelationalColumnIdentity[];
  readonly predicate: RelationalIndexPredicate;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalForeignKeyConstraint = Readonly<{
  readonly identity: RelationalConstraintIdentity;
  readonly kind: "foreignKey";
  readonly sourceColumns: readonly RelationalColumnIdentity[];
  readonly targetColumns: readonly RelationalColumnIdentity[];
  readonly onDelete: "restrict";
  readonly onUpdate: "restrict";
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalIntegerRangeConstraint = Readonly<{
  readonly identity: RelationalConstraintIdentity;
  readonly kind: "integerRange";
  readonly column: RelationalColumnIdentity;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalConstraintDefinition =
  | RelationalForeignKeyConstraint
  | RelationalIntegerRangeConstraint;

export type RelationalRelationshipDefinition = Readonly<{
  readonly identity: RelationalRelationshipIdentity;
  readonly kind: "manyToOne" | "oneToOne";
  readonly foreignKey: RelationalConstraintIdentity;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalTableDefinition = Readonly<{
  readonly identity: RelationalTableIdentity;
  readonly origin: RelationalDefinitionOrigin;
  readonly columns: readonly RelationalColumnDefinition[];
  readonly keys: readonly RelationalKeyDefinition[];
  readonly indexes: readonly RelationalIndexDefinition[];
  readonly constraints: readonly RelationalConstraintDefinition[];
  readonly relationships: readonly RelationalRelationshipDefinition[];
}> & JsonObject;

export type RelationalColumnReference = RelationalColumnIdentity;

export type RelationalSearchableTextCapability = Readonly<{
  readonly identity: RelationalPersistenceCapabilityIdentity;
  readonly kind: "searchableText";
  readonly columns: readonly RelationalColumnReference[];
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalExactNumericCompanionCapability = Readonly<{
  readonly identity: RelationalPersistenceCapabilityIdentity;
  readonly kind: "exactNumericCompanion";
  readonly numericColumn: RelationalColumnReference;
  readonly rawColumn: RelationalColumnReference;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalManagedTimestampsCapability = Readonly<{
  readonly identity: RelationalPersistenceCapabilityIdentity;
  readonly kind: "managedTimestamps";
  readonly createdAtColumn: RelationalColumnReference;
  readonly updatedAtColumn: RelationalColumnReference;
  readonly updateBehavior: "currentTimestampOnUpdate";
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalSoftDeleteCapability = Readonly<{
  readonly identity: RelationalPersistenceCapabilityIdentity;
  readonly kind: "softDelete";
  readonly deletedAtColumn: RelationalColumnReference;
  readonly activeRowsIndex: RelationalIndexIdentity;
  readonly origin: RelationalDefinitionOrigin;
}> & JsonObject;

export type RelationalPersistenceCapability =
  | RelationalSearchableTextCapability
  | RelationalExactNumericCompanionCapability
  | RelationalManagedTimestampsCapability
  | RelationalSoftDeleteCapability;

export type RelationalSchema = Readonly<{
  readonly format: typeof RELATIONAL_SCHEMA_FORMAT;
  readonly version: typeof RELATIONAL_SCHEMA_FORMAT_VERSION;
  readonly coordinate: RelationalSchemaCoordinate;
  readonly tables: readonly RelationalTableDefinition[];
  readonly capabilities: readonly RelationalPersistenceCapability[];
}> & JsonObject;

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
