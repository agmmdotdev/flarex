import type { JsonObject } from "flarex-protocol/json";

import type {
  FrameworkSchemaArtifactIdentity,
  FrameworkSchemaLineageId,
} from "../../frameworkSchema/artifact/model";
import type {
  FrameworkSchemaTargetNamespace,
  FrameworkSchemaTargetNamespaceFrame,
} from "../../migrationCoordination/targetNamespace";
import type {
  RelationalPhysicalLayoutSha256,
  RelationalPhysicalNameAssignmentSha256,
  RelationalPhysicalNameSha256,
} from "../../migrationCoordination/identity";
import type { ScopePhysicalLocator } from "../../scopeMetadataTypes";
import type {
  RelationalColumnDefault,
  RelationalColumnIdentity,
  RelationalConstraintIdentity,
  RelationalIndexIdentity,
  RelationalKeyIdentity,
  RelationalPersistenceCapabilityIdentity,
  RelationalRelationshipIdentity,
  RelationalSchemaOwner,
  RelationalTableIdentity,
} from "../model";

export const RELATIONAL_PHYSICAL_NAME_FORMAT =
  "flarex.relational-physical-name";
export const RELATIONAL_PHYSICAL_NAME_VERSION = 1;
export const RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT =
  "flarex.relational-physical-name-assignment";
export const RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION = 1;
export const RELATIONAL_PHYSICAL_LAYOUT_FORMAT =
  "flarex.relational-physical-layout";
export const RELATIONAL_PHYSICAL_LAYOUT_VERSION = 1;

export const RELATIONAL_PHYSICAL_NAMESPACE_PROFILE =
  "relational-postgres-scope-isolated-stable-names";
export const RELATIONAL_PHYSICAL_LOWERING_PROFILE =
  "relational-postgres-expansion";
export const RELATIONAL_PHYSICAL_ISOLATION_PROFILE = "scope-uuid-prefix";

export type RelationalPhysicalNamespaceProfile =
  typeof RELATIONAL_PHYSICAL_NAMESPACE_PROFILE;

export type RelationalPhysicalNameSubject =
  | (Readonly<{
      readonly kind: "table";
      readonly identity: RelationalTableIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "column";
      readonly identity: RelationalColumnIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "key";
      readonly identity: RelationalKeyIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "index";
      readonly identity: RelationalIndexIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "foreignKey";
      readonly identity: RelationalConstraintIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "checkConstraint";
      readonly identity: RelationalConstraintIdentity;
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "scopeAuthorityForeignKey";
      readonly identity: RelationalTableIdentity;
    }> & JsonObject);

export type RelationalPhysicalNameFrame = Readonly<{
  readonly format: typeof RELATIONAL_PHYSICAL_NAME_FORMAT;
  readonly version: typeof RELATIONAL_PHYSICAL_NAME_VERSION;
  readonly deploymentId: string;
  readonly owner: RelationalSchemaOwner;
  readonly lineageId: FrameworkSchemaLineageId;
  readonly subject: RelationalPhysicalNameSubject;
  readonly physicalNamespaceProfile: RelationalPhysicalNamespaceProfile;
}> & JsonObject;

export interface RelationalPhysicalName {
  readonly frame: RelationalPhysicalNameFrame;
  readonly nameSha256: RelationalPhysicalNameSha256;
  readonly canonicalJson: string;
  readonly spelling: string;
}

export type RelationalPhysicalNameAssignmentFrame = Readonly<{
  readonly format: typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_FORMAT;
  readonly version: typeof RELATIONAL_PHYSICAL_NAME_ASSIGNMENT_VERSION;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly name: RelationalPhysicalNameFrame;
  readonly nameSha256: RelationalPhysicalNameSha256;
  readonly nameCanonicalJson: string;
  readonly spelling: string;
}> & JsonObject;

export interface RelationalPhysicalNameAssignment {
  readonly frame: RelationalPhysicalNameAssignmentFrame;
  readonly assignmentSha256: RelationalPhysicalNameAssignmentSha256;
  readonly canonicalJson: string;
}

export type RelationalPhysicalColumnType =
  | "text"
  | "integer"
  | "numeric"
  | "jsonb"
  | "timestamp with time zone";

export type RelationalPhysicalDefault = RelationalColumnDefault;

export type RelationalPhysicalColumn = Readonly<{
  readonly identity: RelationalColumnIdentity;
  readonly name: string;
  readonly type: RelationalPhysicalColumnType;
  readonly nullable: boolean;
  readonly default: RelationalPhysicalDefault;
}> & JsonObject;

export type RelationalPhysicalKey = Readonly<{
  readonly identity: RelationalKeyIdentity;
  readonly name: string;
  readonly kind: "primary" | "unique";
  readonly columns: readonly string[];
}> & JsonObject;

export type RelationalPhysicalIndexPredicate =
  | null
  | (Readonly<{
      readonly kind: "isNull";
      readonly column: string;
    }> & JsonObject);

export type RelationalPhysicalIndex = Readonly<{
  readonly identity: RelationalIndexIdentity;
  readonly table: RelationalTableIdentity;
  readonly name: string;
  readonly kind: "btree";
  readonly columns: readonly string[];
  readonly predicate: RelationalPhysicalIndexPredicate;
}> & JsonObject;

export type RelationalPhysicalIntegerRangeCheck = Readonly<{
  readonly identity: RelationalConstraintIdentity;
  readonly name: string;
  readonly kind: "integerRange";
  readonly column: string;
  readonly minimum: number | null;
  readonly maximum: number | null;
}> & JsonObject;

export type RelationalPhysicalTable = Readonly<{
  readonly identity: RelationalTableIdentity;
  readonly name: string;
  readonly scopeColumn: Readonly<{
    readonly name: "scope_uuid";
    readonly type: "uuid";
    readonly nullable: false;
  }> & JsonObject;
  readonly columns: readonly RelationalPhysicalColumn[];
  readonly keys: readonly RelationalPhysicalKey[];
  readonly checks: readonly RelationalPhysicalIntegerRangeCheck[];
  readonly indexes: readonly RelationalPhysicalIndex[];
}> & JsonObject;

export type RelationalPhysicalForeignKey =
  | (Readonly<{
      readonly kind: "scopeAuthorityForeignKey";
      readonly table: RelationalTableIdentity;
      readonly name: string;
      readonly sourceColumns: readonly ["scope_uuid"];
      readonly targetTable: "fx_system_scope_clock";
      readonly targetColumns: readonly ["scope_uuid"];
      readonly onDelete: "restrict";
      readonly onUpdate: "restrict";
    }> & JsonObject)
  | (Readonly<{
      readonly kind: "foreignKey";
      readonly identity: RelationalConstraintIdentity;
      readonly sourceTable: RelationalTableIdentity;
      readonly name: string;
      readonly sourceColumns: readonly string[];
      readonly targetTable: RelationalTableIdentity;
      readonly targetTableName: string;
      readonly targetColumns: readonly string[];
      readonly onDelete: "restrict";
      readonly onUpdate: "restrict";
    }> & JsonObject);

export type RelationalPhysicalRelationshipEvidence = Readonly<{
  readonly identity: RelationalRelationshipIdentity;
  readonly kind: "manyToOne" | "oneToOne";
  readonly foreignKeyName: string;
  readonly sourceUnique: boolean;
}> & JsonObject;

export type RelationalPhysicalColumnReference = Readonly<{
  readonly identity: RelationalColumnIdentity;
  readonly tableName: string;
  readonly columnName: string;
}> & JsonObject;

export type RelationalPhysicalCapabilityEvidence =
  | (Readonly<{
      readonly identity: RelationalPersistenceCapabilityIdentity;
      readonly kind: "searchableText";
      readonly columns: readonly RelationalPhysicalColumnReference[];
      readonly residualRequirement: "searchableTextQueryBehavior";
    }> & JsonObject)
  | (Readonly<{
      readonly identity: RelationalPersistenceCapabilityIdentity;
      readonly kind: "exactNumericCompanion";
      readonly numericColumn: RelationalPhysicalColumnReference;
      readonly rawColumn: RelationalPhysicalColumnReference;
      readonly matchingNullability: true;
      readonly numericDefault: RelationalPhysicalDefault;
      readonly rawDefault: RelationalPhysicalDefault;
      readonly residualRequirement: "exactNumericCompanionWriteBehavior";
    }> & JsonObject)
  | (Readonly<{
      readonly identity: RelationalPersistenceCapabilityIdentity;
      readonly kind: "managedTimestamps";
      readonly createdAtColumn: RelationalPhysicalColumnReference;
      readonly updatedAtColumn: RelationalPhysicalColumnReference;
      readonly databaseCurrentDefaults: true;
      readonly residualRequirement: "managedTimestampUpdateBehavior";
    }> & JsonObject)
  | (Readonly<{
      readonly identity: RelationalPersistenceCapabilityIdentity;
      readonly kind: "softDelete";
      readonly deletedAtColumn: RelationalPhysicalColumnReference;
      readonly activeRowsIndex: RelationalIndexIdentity;
      readonly activeRowsIndexName: string;
      readonly residualRequirement: "softDeleteStoreBehavior";
    }> & JsonObject);

export type RelationalPhysicalLayoutFrame = Readonly<{
  readonly format: typeof RELATIONAL_PHYSICAL_LAYOUT_FORMAT;
  readonly version: typeof RELATIONAL_PHYSICAL_LAYOUT_VERSION;
  readonly artifact: Readonly<FrameworkSchemaArtifactIdentity> & JsonObject;
  readonly physicalLocator: Readonly<ScopePhysicalLocator> & JsonObject;
  readonly targetNamespace: FrameworkSchemaTargetNamespaceFrame;
  readonly profiles: Readonly<{
    readonly namespace: typeof RELATIONAL_PHYSICAL_NAMESPACE_PROFILE;
    readonly lowering: typeof RELATIONAL_PHYSICAL_LOWERING_PROFILE;
    readonly isolation: typeof RELATIONAL_PHYSICAL_ISOLATION_PROFILE;
  }> & JsonObject;
  readonly nameAssignments: readonly RelationalPhysicalNameAssignmentFrame[];
  readonly tables: readonly RelationalPhysicalTable[];
  readonly foreignKeys: readonly RelationalPhysicalForeignKey[];
  readonly relationships: readonly RelationalPhysicalRelationshipEvidence[];
  readonly requiredPhysicalCapabilities:
    readonly RelationalPhysicalCapabilityEvidence[];
}> & JsonObject;

export interface RelationalPhysicalLayout {
  readonly frame: RelationalPhysicalLayoutFrame;
  readonly layoutSha256: RelationalPhysicalLayoutSha256;
  readonly canonicalJson: string;
  readonly nameAssignments: readonly RelationalPhysicalNameAssignment[];
  readonly targetNamespace: FrameworkSchemaTargetNamespace;
}
