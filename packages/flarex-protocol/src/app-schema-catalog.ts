import { compareUtf16Strings } from "@flarex/utils/strings";

import { snapshotDecodedProtocolPlainData } from "./decoded-protocol-snapshot";
import {
  canonicalizeAppIndexPhysicalSpecV1,
  type CanonicalAppIndexPhysicalSpecV1,
} from "./index-definition";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalSpecV1,
} from "./ordered-index";
import {
  decodeSchemaManifestAppSchemaV1,
  type SchemaManifestAppIndexBindingV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppIndexFieldPath,
  type SchemaManifestAppSchemaV1,
  type SchemaManifestAppTableDefinitionV1,
  type SchemaManifestAppTableName,
} from "./schema-manifest";
import type { CatalogIndexId, CatalogTableId } from "./catalog";
import type { ValidatorJsonV1 } from "./validator-json";

export const APP_SCHEMA_CATALOG_COMPILER_VERSION_V1 = 1 as const;

/**
 * Intrinsic ID targets accepted by the closed app-schema v1 compiler.
 *
 * Payload, Medusa, and other system namespaces must extend this policy through
 * a later source-driven schema contract; arbitrary reserved targets do not
 * become valid merely because they are syntactically well formed.
 */
export const APP_SCHEMA_INTRINSIC_ID_TARGETS_V1 = Object.freeze([
  "_storage",
] as const);

export type CanonicalAppIndexPhysicalSpecForAccessV1<
  Access extends AppOrderedIndexPhysicalSpecV1["accessPath"],
> = Omit<CanonicalAppIndexPhysicalSpecV1, "physicalSpec"> & {
  readonly physicalSpec: Omit<
    AppOrderedIndexPhysicalSpecV1,
    "accessPath"
  > & {
    readonly accessPath: Access;
  };
};

export interface AppSchemaCreationTimeIndexRequirementV1 {
  readonly kind: "by_creation_time";
  readonly tableId: CatalogTableId;
  readonly canonical:
    CanonicalAppIndexPhysicalSpecForAccessV1<"by_creation_time">;
  readonly requiredForActivation: true;
}

export interface AppSchemaDeveloperIndexRequirementV1 {
  readonly kind: "developer";
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly descriptor: SchemaManifestAppIndexDescriptor;
  readonly canonical: CanonicalAppIndexPhysicalSpecForAccessV1<"developer">;
  readonly requiredForActivation: true;
}

export interface CompiledAppSchemaCatalogRequirementsV1 {
  readonly kind: "appSchemaCatalogRequirements";
  readonly compilerVersion: typeof APP_SCHEMA_CATALOG_COMPILER_VERSION_V1;
  readonly creationTimeIndexes:
    ReadonlyArray<AppSchemaCreationTimeIndexRequirementV1>;
  readonly developerIndexes:
    ReadonlyArray<AppSchemaDeveloperIndexRequirementV1>;
}

export type AppSchemaCatalogCompilationIndexIdentityV1 =
  | {
      readonly kind: "by_creation_time";
      readonly tableId: CatalogTableId;
    }
  | {
      readonly kind: "developer";
      readonly tableId: CatalogTableId;
      readonly logicalIndexId: CatalogIndexId;
      readonly descriptor: SchemaManifestAppIndexDescriptor;
    };

export type AppSchemaCatalogCompilationIssueV1 =
  | { readonly reason: "invalidManifest" }
  | {
      readonly reason: "unknownIdTarget";
      readonly sourceTableId: CatalogTableId;
      readonly sourceTableLogicalName: SchemaManifestAppTableName;
      readonly targetTableName: string;
      readonly validatorPath: string;
    }
  | {
      readonly reason: "impossibleIndexField";
      readonly tableId: CatalogTableId;
      readonly logicalIndexId: CatalogIndexId;
      readonly descriptor: SchemaManifestAppIndexDescriptor;
      readonly fieldPath: SchemaManifestAppIndexFieldPath;
    }
  | {
      readonly reason: "canonicalizationFailed";
      readonly index: AppSchemaCatalogCompilationIndexIdentityV1;
    };

export class AppSchemaCatalogCompilationErrorV1 extends Error {
  constructor(
    readonly issue: AppSchemaCatalogCompilationIssueV1,
    options?: ErrorOptions,
  ) {
    super(compilationIssueMessage(issue), options);
    this.name = "AppSchemaCatalogCompilationErrorV1";
  }
}

/**
 * Verify and lower one complete, already-bound app-schema manifest.
 *
 * The result is derived evidence only. It contains no source-manifest copy,
 * physical definition ID, lifecycle, build state, or readiness receipt. A
 * later trusted publication facade must compile its own authenticated manifest
 * rather than accept this result as caller-supplied persistence authority.
 */
export async function compileAppSchemaCatalogRequirementsV1(
  value: unknown,
): Promise<CompiledAppSchemaCatalogRequirementsV1> {
  const manifest = decodeAndSnapshotManifest(value);
  const tables = [...manifest.tableDefinitions.tables].sort(compareTables);
  const indexes = [...manifest.indexBindings.indexes].sort(compareIndexes);
  const tablesById = new Map(
    tables.map((table) => [table.tableId, table] as const),
  );
  const allowedIdTargets = new Set<string>([
    ...tables.map((table) => table.logicalName),
    ...APP_SCHEMA_INTRINSIC_ID_TARGETS_V1,
  ]);

  for (const table of tables) {
    verifyValidatorIdTargets(
      table.definition.documentType,
      table,
      "documentType",
      allowedIdTargets,
    );
  }
  for (const index of indexes) {
    verifyIndexFields(index, tablesById);
  }

  const creationTimeIndexes: AppSchemaCreationTimeIndexRequirementV1[] = [];
  let creationTimeCanonical:
    CanonicalAppIndexPhysicalSpecForAccessV1<"by_creation_time"> | undefined;
  for (const table of tables) {
    const identity = Object.freeze({
      kind: "by_creation_time",
      tableId: table.tableId,
    } satisfies AppSchemaCatalogCompilationIndexIdentityV1);
    creationTimeCanonical ??= await canonicalizeRequirement(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      identity,
      "by_creation_time",
    );
    creationTimeIndexes.push(Object.freeze({
      ...identity,
      canonical: creationTimeCanonical,
      requiredForActivation: true,
    } satisfies AppSchemaCreationTimeIndexRequirementV1));
  }

  const developerIndexes: AppSchemaDeveloperIndexRequirementV1[] = [];
  for (const index of indexes) {
    const identity = Object.freeze({
      kind: "developer",
      tableId: index.tableId,
      logicalIndexId: index.logicalIndexId,
      descriptor: index.descriptor,
    } satisfies AppSchemaCatalogCompilationIndexIdentityV1);
    const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(
      index.spec,
    );
    const canonical = await canonicalizeRequirement(
      physicalSpec,
      identity,
      "developer",
    );
    developerIndexes.push(Object.freeze({
      ...identity,
      canonical,
      requiredForActivation: true,
    } satisfies AppSchemaDeveloperIndexRequirementV1));
  }

  return Object.freeze({
    kind: "appSchemaCatalogRequirements",
    compilerVersion: APP_SCHEMA_CATALOG_COMPILER_VERSION_V1,
    creationTimeIndexes: Object.freeze(creationTimeIndexes),
    developerIndexes: Object.freeze(developerIndexes),
  } satisfies CompiledAppSchemaCatalogRequirementsV1);
}

function decodeAndSnapshotManifest(
  value: unknown,
): SchemaManifestAppSchemaV1 {
  try {
    return snapshotDecodedProtocolPlainData(
      decodeSchemaManifestAppSchemaV1(value),
    );
  } catch (cause) {
    throw new AppSchemaCatalogCompilationErrorV1(
      { reason: "invalidManifest" },
      { cause },
    );
  }
}

function verifyValidatorIdTargets(
  validator: ValidatorJsonV1,
  sourceTable: SchemaManifestAppTableDefinitionV1,
  path: string,
  allowedTargets: ReadonlySet<string>,
): void {
  switch (validator.type) {
    case "id":
      if (!allowedTargets.has(validator.tableName)) {
        throw new AppSchemaCatalogCompilationErrorV1({
          reason: "unknownIdTarget",
          sourceTableId: sourceTable.tableId,
          sourceTableLogicalName: sourceTable.logicalName,
          targetTableName: validator.tableName,
          validatorPath: `${path}.tableName`,
        });
      }
      return;
    case "array":
      verifyValidatorIdTargets(
        validator.value,
        sourceTable,
        `${path}.value`,
        allowedTargets,
      );
      return;
    case "object": {
      const fieldNames = Object.keys(validator.value).sort(compareUtf16Strings);
      for (const fieldName of fieldNames) {
        const field = validator.value[fieldName];
        if (field === undefined) {
          throw invalidDecodedManifest(
            `decoded object validator lost field ${fieldName}`,
          );
        }
        verifyValidatorIdTargets(
          field.fieldType,
          sourceTable,
          `${path}.value.${fieldName}.fieldType`,
          allowedTargets,
        );
      }
      return;
    }
    case "record":
      verifyValidatorIdTargets(
        validator.keys,
        sourceTable,
        `${path}.keys`,
        allowedTargets,
      );
      verifyValidatorIdTargets(
        validator.values,
        sourceTable,
        `${path}.values`,
        allowedTargets,
      );
      return;
    case "union":
      for (const [index, member] of validator.value.entries()) {
        verifyValidatorIdTargets(
          member,
          sourceTable,
          `${path}.value[${index}]`,
          allowedTargets,
        );
      }
      return;
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
    case "literal":
      return;
  }

  return assertNeverValidator(validator);
}

function verifyIndexFields(
  index: SchemaManifestAppIndexBindingV1,
  tablesById: ReadonlyMap<CatalogTableId, SchemaManifestAppTableDefinitionV1>,
): void {
  const table = tablesById.get(index.tableId);
  if (table === undefined) {
    throw invalidDecodedManifest(
      `decoded index ${index.logicalIndexId} lost table ${index.tableId}`,
    );
  }
  for (const fieldPath of index.spec.fields) {
    if (
      !validatorCanContainField(
        table.definition.documentType,
        fieldPath.split("."),
      )
    ) {
      throw new AppSchemaCatalogCompilationErrorV1({
        reason: "impossibleIndexField",
        tableId: index.tableId,
        logicalIndexId: index.logicalIndexId,
        descriptor: index.descriptor,
        fieldPath,
      });
    }
  }
}

/** Close port of Convex Validator::_can_contain_field. */
function validatorCanContainField(
  validator: ValidatorJsonV1,
  fieldPathParts: ReadonlyArray<string>,
): boolean {
  const [firstPart, ...remainingParts] = fieldPathParts;
  if (firstPart === undefined) return true;

  switch (validator.type) {
    case "any":
      return true;
    case "union":
      return validator.value.some((member) =>
        validatorCanContainField(member, fieldPathParts)
      );
    case "object": {
      if (!Object.hasOwn(validator.value, firstPart)) return false;
      const field = validator.value[firstPart];
      return field !== undefined && validatorCanContainField(
        field.fieldType,
        remainingParts,
      );
    }
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "id":
    case "literal":
    case "array":
    case "record":
      return false;
  }

  return assertNeverValidator(validator);
}

async function canonicalizeRequirement<
  Access extends AppSchemaCatalogCompilationIndexIdentityV1["kind"],
>(
  physicalSpec: unknown,
  index: AppSchemaCatalogCompilationIndexIdentityV1 & {
    readonly kind: Access;
  },
  expectedAccess: Access,
): Promise<CanonicalAppIndexPhysicalSpecForAccessV1<Access>> {
  try {
    const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
    if (canonical.physicalSpec.accessPath !== expectedAccess) {
      throw new Error(
        `Canonical access path ${canonical.physicalSpec.accessPath} did not match ${expectedAccess}.`,
      );
    }
    return Object.freeze({
      ...canonical,
      physicalSpec: Object.freeze({
        ...canonical.physicalSpec,
        accessPath: expectedAccess,
      }),
    } satisfies CanonicalAppIndexPhysicalSpecForAccessV1<Access>);
  } catch (cause) {
    throw new AppSchemaCatalogCompilationErrorV1(
      { reason: "canonicalizationFailed", index },
      { cause },
    );
  }
}

function invalidDecodedManifest(detail: string): AppSchemaCatalogCompilationErrorV1 {
  return new AppSchemaCatalogCompilationErrorV1(
    { reason: "invalidManifest" },
    { cause: new Error(detail) },
  );
}

function compareTables(
  left: SchemaManifestAppTableDefinitionV1,
  right: SchemaManifestAppTableDefinitionV1,
): number {
  return left.tableId - right.tableId;
}

function compareIndexes(
  left: SchemaManifestAppIndexBindingV1,
  right: SchemaManifestAppIndexBindingV1,
): number {
  return left.logicalIndexId - right.logicalIndexId;
}

function compilationIssueMessage(
  issue: AppSchemaCatalogCompilationIssueV1,
): string {
  switch (issue.reason) {
    case "invalidManifest":
      return "App-schema catalog compilation requires a valid bound appSchema v1 manifest.";
    case "unknownIdTarget":
      return `App table ${issue.sourceTableLogicalName} references unknown ID target ${issue.targetTableName} at ${issue.validatorPath}.`;
    case "impossibleIndexField":
      return `App index ${issue.tableId}/${issue.descriptor} references field ${issue.fieldPath}, which cannot occur under the table validator.`;
    case "canonicalizationFailed":
      return `App index physical requirement ${formatIndexIdentity(issue.index)} could not be canonicalized.`;
  }
}

function formatIndexIdentity(
  index: AppSchemaCatalogCompilationIndexIdentityV1,
): string {
  return index.kind === "by_creation_time"
    ? `${index.tableId}/by_creation_time`
    : `${index.tableId}/${index.descriptor}/${index.logicalIndexId}`;
}

function assertNeverValidator(value: never): never {
  throw new Error(`Unexpected ValidatorJsonV1 variant: ${JSON.stringify(value)}`);
}
