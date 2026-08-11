import type {
  SchemaManifestAppIndexBindingV1,
  SchemaManifestAppTableDefinitionV1,
} from "flarex-protocol/schema-manifest";

type TableId = SchemaManifestAppTableDefinitionV1["tableId"];
type TableName = SchemaManifestAppTableDefinitionV1["logicalName"];
type LogicalIndexId = SchemaManifestAppIndexBindingV1["logicalIndexId"];
type IndexDescriptor = SchemaManifestAppIndexBindingV1["descriptor"];

export type ValidatorCompatibility =
  | Readonly<{
      readonly disposition: "universallyCompatible";
    }>
  | Readonly<{
      readonly disposition: "requiresDataValidation";
      readonly reason: "narrowingOrUnknown" | "comparisonBudgetExceeded";
      readonly path: string;
    }>;

export type AppSchemaEvolutionChange =
  | Readonly<{
      readonly kind: "tableAdded";
      readonly tableId: TableId;
      readonly logicalName: TableName;
    }>
  | Readonly<{
      readonly kind: "tableRemoved";
      readonly tableId: TableId;
      readonly logicalName: TableName;
    }>
  | Readonly<{
      readonly kind: "tableIdentityChanged";
      readonly logicalName: TableName;
      readonly activeTableId: TableId;
      readonly candidateTableId: TableId;
    }>
  | Readonly<{
      readonly kind: "tableLogicalNameChanged";
      readonly tableId: TableId;
      readonly activeLogicalName: TableName;
      readonly candidateLogicalName: TableName;
    }>
  | Readonly<{
      readonly kind: "tableValidatorChanged";
      readonly tableId: TableId;
      readonly logicalName: TableName;
      readonly compatibility: ValidatorCompatibility;
    }>
  | Readonly<{
      readonly kind: "indexAdded" | "indexRemoved";
      readonly logicalIndexId: LogicalIndexId;
      readonly tableId: TableId;
      readonly descriptor: IndexDescriptor;
    }>
  | Readonly<{
      readonly kind: "indexIdentityChanged";
      readonly tableId: TableId;
      readonly descriptor: IndexDescriptor;
      readonly activeLogicalIndexId: LogicalIndexId;
      readonly candidateLogicalIndexId: LogicalIndexId;
    }>
  | Readonly<{
      readonly kind: "indexDefinitionChanged";
      readonly logicalIndexId: LogicalIndexId;
      readonly activeTableId: TableId;
      readonly candidateTableId: TableId;
      readonly activeDescriptor: IndexDescriptor;
      readonly candidateDescriptor: IndexDescriptor;
    }>;

export type AppSchemaEvolutionDisposition =
  | "safeMetadataActivation"
  | "managedBuildAndValidation"
  | "blocked";

export interface AppSchemaEvolutionClassification {
  readonly disposition: AppSchemaEvolutionDisposition;
  readonly dataCompatibility:
    | "universallyCompatible"
    | "requiresDataValidation";
  readonly physicalRequirements:
    | "unchanged"
    | "requiresBuildOrRetirement";
  readonly identity: "consistent" | "requiresExplicitIntent";
  readonly changes: ReadonlyArray<AppSchemaEvolutionChange>;
}
