import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  CatalogIndexDefinitionIdSchema,
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  MAX_CATALOG_INDEX_DEFINITION_ID,
  type CatalogIndexDefinitionId,
  type CatalogIndexId,
  type CatalogTableId,
  type CatalogTableNamespace,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1FromBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes,
  appPhysicalIndexAccessStorageIdentityV1,
  canonicalizeAppIndexPhysicalSpecV1,
  canonicalAppIndexPhysicalSpecBytesHexV1FromBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  decodeAppIndexPhysicalSpecCodecVersion,
  decodeAppPhysicalIndexAccessIdentityV1,
  type AppCreationTimePhysicalIndexAccessIdentityV1,
  type AppDeveloperPhysicalIndexAccessIdentityV1,
  type AppIndexPhysicalSpecCodecVersion,
  type AppIndexPhysicalSpecSha256HexV1,
  type AppPhysicalIndexAccessKindV1,
  type AppPhysicalIndexAccessIdentityV1,
  type AppPhysicalIndexAccessStorageIdentityV1,
  type CanonicalAppIndexPhysicalSpecBytesHexV1,
  type CanonicalAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  decodeAppOrderedIndexPhysicalSpecV1,
  lowerAppDeveloperOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalSpecV1,
} from "flarex-protocol/ordered-index";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppDeveloperOrderedIndexSpecV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";

import {
  getPreparedAppSchemaPublicationV1StateResult,
  type InvalidPreparedAppSchemaPublicationV1Error,
  type PreparedAppSchemaPublicationV1,
} from "./appSchemaPublicationPreparation";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  lockSchemaManifestBindingDeploymentEffect,
  type SchemaManifestTableBindingPersistenceError,
} from "./schemaManifestTableBindings";
import {
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
} from "./schema";
import {
  getStableTableIdentityByValidatedIdEffect,
  type StableTableCatalogCorruptionError,
  type StableTableCatalogDeploymentNotFoundError,
  type StableTableCatalogTransaction,
  type StableTableIdentityPersistenceError,
} from "./stableTableCatalog";

const PREPARE_INPUT_KEYS = Object.freeze([
  "deploymentId",
  "schemaVersionId",
  "tableId",
  "logicalIndexId",
  "logicalSpec",
]);

const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeCatalogIndexIdResult = Schema.decodeUnknownResult(
  CatalogIndexIdSchema,
);
const decodeCatalogIndexDefinitionIdResult = Schema.decodeUnknownResult(
  CatalogIndexDefinitionIdSchema,
);
const decodeCatalogTableIdResult = Schema.decodeUnknownResult(
  CatalogTableIdSchema,
);

export interface PrepareAppDeveloperIndexDefinitionBindingV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly logicalSpec: SchemaManifestAppDeveloperOrderedIndexSpecV1;
  readonly indexDefinitionId?: never;
  readonly physicalSpec?: never;
  readonly physicalSpecSha256?: never;
  readonly requiredForActivation?: never;
}

const preparedDefinitionBindingBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppDeveloperIndexDefinitionBindingV1",
);

export interface PreparedAppDeveloperIndexDefinitionBindingV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly [preparedDefinitionBindingBrand]: true;
}

const preparedCreationTimeDefinitionBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppCreationTimeIndexDefinitionV1",
);

export interface PreparedAppCreationTimeIndexDefinitionV1 {
  readonly deploymentId: string;
  readonly tableId: CatalogTableId;
  readonly [preparedCreationTimeDefinitionBrand]: true;
}

export interface AppIndexDefinitionRecord {
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly access: AppPhysicalIndexAccessIdentityV1;
  readonly physicalSpecCodecVersion: AppIndexPhysicalSpecCodecVersion;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  readonly physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1;
  readonly createdAt: Date;
}

export type AppIndexDefinitionRecordForAccessKindV1<
  Kind extends AppPhysicalIndexAccessKindV1,
> = Omit<AppIndexDefinitionRecord, "access"> & {
  readonly access: Extract<
    AppPhysicalIndexAccessIdentityV1,
    { readonly kind: Kind }
  >;
};

export interface AppSchemaVersionIndexBindingRecord {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly logicalIndexId: CatalogIndexId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly requiredForActivation: true;
  readonly createdAt: Date;
}

export interface EnsureAppDeveloperIndexDefinitionBindingV1Result {
  readonly definitionStatus: "created" | "existing";
  readonly bindingStatus: "created" | "existing";
  readonly definition: AppIndexDefinitionRecordForAccessKindV1<"developer">;
  readonly binding: AppSchemaVersionIndexBindingRecord;
}

export interface EnsureAppCreationTimeIndexDefinitionV1Result {
  readonly definitionStatus: "created" | "existing";
  readonly definition:
    AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">;
}

export type InvalidAppIndexDefinitionBindingInputIssue =
  | { readonly reason: "invalidInputShape" }
  | { readonly reason: "invalidDeploymentId" }
  | { readonly reason: "invalidSchemaVersionId" }
  | { readonly reason: "invalidTableId" }
  | { readonly reason: "invalidLogicalIndexId" }
  | { readonly reason: "invalidIndexDefinitionId" }
  | { readonly reason: "invalidLogicalSpec" };

export class InvalidAppIndexDefinitionBindingInputError extends Error {
  readonly _tag = "InvalidAppIndexDefinitionBindingInputError" as const;

  constructor(
    readonly issue: InvalidAppIndexDefinitionBindingInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppIndexDefinitionBindingInputError";
  }
}

export class InvalidPreparedAppIndexDefinitionBindingError extends Error {
  readonly _tag = "InvalidPreparedAppIndexDefinitionBindingError" as const;

  constructor() {
    super(
      "App index definition binding was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedAppIndexDefinitionBindingError";
  }
}

export class InvalidPreparedAppCreationTimeIndexDefinitionError extends Error {
  readonly _tag = "InvalidPreparedAppCreationTimeIndexDefinitionError" as const;

  constructor() {
    super(
      "App creation-time index definition was not prepared from an authenticated app-schema publication.",
    );
    this.name = "InvalidPreparedAppCreationTimeIndexDefinitionError";
  }
}

export type AppCreationTimeIndexDefinitionRequirementIssue =
  | {
      readonly reason: "requirementCountMismatch";
      readonly tableCount: number;
      readonly requirementCount: number;
    }
  | {
      readonly reason: "requirementTableNotFound";
      readonly tableId: CatalogTableId;
    }
  | {
      readonly reason: "duplicateRequirementTable";
      readonly tableId: CatalogTableId;
    }
  | {
      readonly reason: "incompleteRequirementSet";
      readonly coveredTableCount: number;
      readonly tableCount: number;
    };

export class AppCreationTimeIndexDefinitionRequirementError extends Error {
  readonly _tag = "AppCreationTimeIndexDefinitionRequirementError" as const;

  constructor(
    readonly deploymentId: string,
    readonly issue: AppCreationTimeIndexDefinitionRequirementIssue,
  ) {
    super(
      `Prepared app-schema creation-time requirements are inconsistent for ${deploymentId}: ${creationTimeRequirementIssueMessage(issue)}`,
    );
    this.name = "AppCreationTimeIndexDefinitionRequirementError";
  }
}

export type AppDeveloperIndexDefinitionRequirementIssue =
  | {
      readonly reason: "requirementCountMismatch";
      readonly indexCount: number;
      readonly requirementCount: number;
    }
  | {
      readonly reason: "requirementLogicalIndexNotFound";
      readonly logicalIndexId: CatalogIndexId;
    }
  | {
      readonly reason: "requirementIdentityMismatch";
      readonly logicalIndexId: CatalogIndexId;
      readonly requirementTableId: CatalogTableId;
      readonly currentTableId: CatalogTableId;
      readonly requirementDescriptor: SchemaManifestAppIndexDescriptor;
      readonly currentDescriptor: SchemaManifestAppIndexDescriptor;
    }
  | {
      readonly reason: "duplicateRequirementLogicalIndex";
      readonly logicalIndexId: CatalogIndexId;
    }
  | {
      readonly reason: "incompleteRequirementSet";
      readonly coveredIndexCount: number;
      readonly indexCount: number;
    };

export class AppDeveloperIndexDefinitionRequirementError extends Error {
  readonly _tag = "AppDeveloperIndexDefinitionRequirementError" as const;

  constructor(
    readonly deploymentId: string,
    readonly issue: AppDeveloperIndexDefinitionRequirementIssue,
  ) {
    super(
      `Prepared app-schema developer-index requirements are inconsistent for ${deploymentId}: ${developerRequirementIssueMessage(issue)}`,
    );
    this.name = "AppDeveloperIndexDefinitionRequirementError";
  }
}

export class AppIndexDefinitionPreparationError extends Error {
  readonly _tag = "AppIndexDefinitionPreparationError" as const;

  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly logicalIndexId: CatalogIndexId,
    options?: ErrorOptions,
  ) {
    super(
      `App index physical-spec canonicalization or SHA-256 failed for ${deploymentId}/${schemaVersionId}/${logicalIndexId}.`,
      options,
    );
    this.name = "AppIndexDefinitionPreparationError";
  }
}

export type PrepareAppDeveloperIndexDefinitionBindingV1Error =
  | InvalidAppIndexDefinitionBindingInputError
  | AppIndexDefinitionPreparationError;

export type AppIndexDefinitionParentIssue =
  | { readonly reason: "schemaVersionNotFound" }
  | { readonly reason: "logicalIndexNotFound" }
  | {
      readonly reason: "logicalIndexTableMismatch";
      readonly requestedTableId: CatalogTableId;
      readonly currentTableId: CatalogTableId;
    };

export class AppIndexDefinitionParentError extends Error {
  readonly _tag = "AppIndexDefinitionParentError" as const;

  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly logicalIndexId: CatalogIndexId,
    readonly issue: AppIndexDefinitionParentIssue,
  ) {
    super(
      `App index definition parents are invalid for ${deploymentId}/${schemaVersionId}/${logicalIndexId}: ${parentIssueMessage(issue)}`,
    );
    this.name = "AppIndexDefinitionParentError";
  }
}

export class AppIndexDefinitionIdExhaustedError extends Error {
  readonly _tag = "AppIndexDefinitionIdExhaustedError" as const;

  constructor(readonly deploymentId: string) {
    super(
      `Physical index definition identity space is exhausted for deployment: ${deploymentId}`,
    );
    this.name = "AppIndexDefinitionIdExhaustedError";
  }
}

export class AppIndexDefinitionCatalogCorruptionError extends Error {
  readonly _tag = "AppIndexDefinitionCatalogCorruptionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Physical index definition catalog is corrupt for ${deploymentId}: ${detail}`,
      options,
    );
    this.name = "AppIndexDefinitionCatalogCorruptionError";
  }
}

export class AppIndexDefinitionChecksumCollisionError extends Error {
  readonly _tag = "AppIndexDefinitionChecksumCollisionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly logicalIndexId: CatalogIndexId,
    readonly existingIndexDefinitionId: CatalogIndexDefinitionId,
  ) {
    super(
      `Physical index definitions have equal SHA-256 but unequal canonical bytes for ${deploymentId}/${logicalIndexId}.`,
    );
    this.name = "AppIndexDefinitionChecksumCollisionError";
  }
}

export class AppCreationTimeIndexDefinitionChecksumCollisionError
  extends Error {
  readonly _tag =
    "AppCreationTimeIndexDefinitionChecksumCollisionError" as const;

  constructor(
    readonly deploymentId: string,
    readonly tableId: CatalogTableId,
    readonly existingIndexDefinitionId: CatalogIndexDefinitionId,
  ) {
    super(
      `Physical index definitions have equal SHA-256 but unequal canonical bytes for ${deploymentId}/by_creation_time/${tableId}.`,
    );
    this.name = "AppCreationTimeIndexDefinitionChecksumCollisionError";
  }
}

export type AppCreationTimeIndexDefinitionParentIssue =
  | { readonly reason: "tableNotFound" }
  | {
      readonly reason: "tableBindingChanged";
      readonly currentNamespace: CatalogTableNamespace;
      readonly currentLogicalName: string;
    };

export class AppCreationTimeIndexDefinitionParentError extends Error {
  readonly _tag = "AppCreationTimeIndexDefinitionParentError" as const;

  constructor(
    readonly deploymentId: string,
    readonly tableId: CatalogTableId,
    readonly expectedLogicalName: SchemaManifestAppTableName,
    readonly issue: AppCreationTimeIndexDefinitionParentIssue,
  ) {
    super(
      `App creation-time index definition parent is invalid for ${deploymentId}/${tableId}/${expectedLogicalName}: ${creationTimeParentIssueMessage(issue)}`,
    );
    this.name = "AppCreationTimeIndexDefinitionParentError";
  }
}

export class AppCreationTimeIndexDefinitionPersistenceError extends Error {
  readonly _tag = "AppCreationTimeIndexDefinitionPersistenceError" as const;

  constructor(
    readonly operation:
      | "findExistingDefinition"
      | "readDefinitionHighWater"
      | "insertDefinition",
    readonly cause: unknown,
  ) {
    super(`Failed to ${creationTimePersistenceOperationMessage(operation)}.`, {
      cause,
    });
    this.name = "AppCreationTimeIndexDefinitionPersistenceError";
  }
}

export type EnsureAppCreationTimeIndexDefinitionV1Error =
  | InvalidPreparedAppCreationTimeIndexDefinitionError
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
  | StableTableCatalogCorruptionError
  | StableTableIdentityPersistenceError
  | AppCreationTimeIndexDefinitionParentError
  | AppCreationTimeIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionIdExhaustedError
  | AppCreationTimeIndexDefinitionChecksumCollisionError;

export class AppDeveloperIndexDefinitionPersistenceError extends Error {
  readonly _tag = "AppDeveloperIndexDefinitionPersistenceError" as const;

  constructor(
    readonly operation:
      | "readSchemaParent"
      | "readLogicalIndexParent"
      | "findExistingDefinition"
      | "readExistingBinding"
      | "readDefinitionHighWater"
      | "insertDefinition"
      | "insertBinding",
    readonly cause: unknown,
  ) {
    super(`Failed to ${developerPersistenceOperationMessage(operation)}.`, {
      cause,
    });
    this.name = "AppDeveloperIndexDefinitionPersistenceError";
  }
}

export type EnsureAppDeveloperIndexDefinitionBindingV1Error =
  | InvalidPreparedAppIndexDefinitionBindingError
  | StableTableCatalogDeploymentNotFoundError
  | SchemaManifestTableBindingPersistenceError
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionParentError
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionIdExhaustedError
  | AppIndexDefinitionChecksumCollisionError
  | AppSchemaVersionIndexBindingConflictError;

export class AppSchemaVersionIndexBindingPersistenceError extends Error {
  readonly _tag = "AppSchemaVersionIndexBindingPersistenceError" as const;

  constructor(
    readonly operation:
      | "readByLogicalIndexId"
      | "listBySchemaVersion",
    readonly cause: unknown,
  ) {
    super(
      operation === "readByLogicalIndexId"
        ? "Failed to read an app schema-version index binding."
        : "Failed to list app schema-version index bindings.",
      { cause },
    );
    this.name = "AppSchemaVersionIndexBindingPersistenceError";
  }
}

export class AppIndexDefinitionReadPersistenceError extends Error {
  readonly _tag = "AppIndexDefinitionReadPersistenceError" as const;

  constructor(
    readonly operation: "readByDefinitionId" | "listByLogicalIndexId",
    readonly cause: unknown,
  ) {
    super(
      operation === "readByDefinitionId"
        ? "Failed to read an app physical index definition."
        : "Failed to list app physical index definitions.",
      { cause },
    );
    this.name = "AppIndexDefinitionReadPersistenceError";
  }
}

export type ReadAppIndexDefinitionError =
  | InvalidAppIndexDefinitionBindingInputError
  | AppIndexDefinitionReadPersistenceError
  | AppIndexDefinitionCatalogCorruptionError;

export type ReadAppSchemaVersionIndexBindingError =
  | InvalidAppIndexDefinitionBindingInputError
  | AppSchemaVersionIndexBindingPersistenceError
  | AppIndexDefinitionCatalogCorruptionError;

export class AppSchemaVersionIndexBindingConflictError extends Error {
  readonly _tag = "AppSchemaVersionIndexBindingConflictError" as const;

  constructor(
    readonly deploymentId: string,
    readonly schemaVersionId: CatalogSchemaVersionId,
    readonly logicalIndexId: CatalogIndexId,
    readonly existingIndexDefinitionId: CatalogIndexDefinitionId,
    readonly requestedIndexDefinitionId: CatalogIndexDefinitionId | null,
  ) {
    super(
      `Schema version index binding already targets another physical definition for ${deploymentId}/${schemaVersionId}/${logicalIndexId}.`,
    );
    this.name = "AppSchemaVersionIndexBindingConflictError";
  }
}

interface PreparedPhysicalDefinitionState<
  Kind extends AppPhysicalIndexAccessKindV1,
> {
  readonly deploymentId: string;
  readonly access: Extract<
    AppPhysicalIndexAccessIdentityV1,
    { readonly kind: Kind }
  >;
  readonly storageIdentity: Extract<
    AppPhysicalIndexAccessStorageIdentityV1,
    { readonly kind: Kind }
  >;
  readonly canonical: CanonicalAppIndexPhysicalSpecV1;
}

interface PreparedDefinitionBindingState
  extends PreparedPhysicalDefinitionState<"developer"> {
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly access: AppDeveloperPhysicalIndexAccessIdentityV1;
}

interface PreparedCreationTimeDefinitionState
  extends PreparedPhysicalDefinitionState<"by_creation_time"> {
  readonly tableId: CatalogTableId;
  readonly expectedLogicalName: SchemaManifestAppTableName;
  readonly access: AppCreationTimePhysicalIndexAccessIdentityV1;
}

const preparedDefinitionBindingStates = new WeakMap<
  PreparedAppDeveloperIndexDefinitionBindingV1,
  PreparedDefinitionBindingState
>();

const preparedCreationTimeDefinitionStates = new WeakMap<
  PreparedAppCreationTimeIndexDefinitionV1,
  PreparedCreationTimeDefinitionState
>();

/**
 * Lower and canonicalize one developer index outside the SQL transaction.
 *
 * The opaque token exposes no physical ID, canonical bytes, digest, codec, or
 * activation flag for a caller to forge. Current app indexes are always
 * required for activation; optional-index semantics are not part of v1.
 */
export const prepareAppDeveloperIndexDefinitionBindingV1Effect = Effect.fn(
  "AppIndexDefinitions.prepareDeveloperBinding",
)(function* (
  input: PrepareAppDeveloperIndexDefinitionBindingV1Input,
): Effect.fn.Return<
  PreparedAppDeveloperIndexDefinitionBindingV1,
  PrepareAppDeveloperIndexDefinitionBindingV1Error
> {
  const {
    deploymentId,
    schemaVersionId,
    tableId,
    logicalIndexId,
    logicalSpec,
  } = yield* Effect.fromResult(
    decodePrepareAppDeveloperIndexDefinitionBindingV1InputResult(input),
  );
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(logicalSpec);
  const canonical = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(physicalSpec),
    catch: (cause) => new AppIndexDefinitionPreparationError(
      deploymentId,
      schemaVersionId,
      logicalIndexId,
      { cause },
    ),
  });
  const access = Object.freeze({
    kind: "developer",
    tableId,
    logicalIndexId,
  } satisfies AppDeveloperPhysicalIndexAccessIdentityV1);
  return registerPreparedDeveloperIndexDefinitionBinding({
    deploymentId,
    schemaVersionId,
    tableId,
    logicalIndexId,
    access,
    storageIdentity: appPhysicalIndexAccessStorageIdentityV1(access),
    canonical,
  });
});

/**
 * Derive the complete intrinsic definition-token set from one authenticated
 * D2a preparation without re-lowering or re-hashing its D1 evidence.
 *
 * Tokens are ordered by table ID and expose no logical name, canonical bytes,
 * digest, physical ID, lifecycle, or readiness authority. D2c later owns
 * consuming the complete set; D2b only provides the per-table row primitive.
 */
export function prepareAppCreationTimeIndexDefinitionsV1Result(
  publication: PreparedAppSchemaPublicationV1,
): Result.Result<
  ReadonlyArray<PreparedAppCreationTimeIndexDefinitionV1>,
  | InvalidPreparedAppSchemaPublicationV1Error
  | AppCreationTimeIndexDefinitionRequirementError
> {
  return Result.gen(function* () {
    const publicationState = yield*
      getPreparedAppSchemaPublicationV1StateResult(publication);
    const tables = publicationState.logicalBindings.manifest
      .tableDefinitions.tables;
    const requirements = publicationState.requirements.creationTimeIndexes;
    if (tables.length !== requirements.length) {
      return yield* Result.fail(
        new AppCreationTimeIndexDefinitionRequirementError(
          publication.deploymentId,
          {
            reason: "requirementCountMismatch",
            tableCount: tables.length,
            requirementCount: requirements.length,
          },
        ),
      );
    }
    const tablesById = new Map(
      tables.map((table) => [table.tableId, table] as const),
    );
    const seenTableIds = new Set<CatalogTableId>();
    const prepared: PreparedAppCreationTimeIndexDefinitionV1[] = [];
    for (const requirement of requirements) {
      const table = tablesById.get(requirement.tableId);
      if (table === undefined) {
        return yield* Result.fail(
          new AppCreationTimeIndexDefinitionRequirementError(
            publication.deploymentId,
            {
              reason: "requirementTableNotFound",
              tableId: requirement.tableId,
            },
          ),
        );
      }
      if (seenTableIds.has(requirement.tableId)) {
        return yield* Result.fail(
          new AppCreationTimeIndexDefinitionRequirementError(
            publication.deploymentId,
            {
              reason: "duplicateRequirementTable",
              tableId: requirement.tableId,
            },
          ),
        );
      }
      seenTableIds.add(requirement.tableId);
      const access = Object.freeze({
        kind: "by_creation_time",
        tableId: requirement.tableId,
      } satisfies AppCreationTimePhysicalIndexAccessIdentityV1);
      const token = Object.freeze({
        deploymentId: publication.deploymentId,
        tableId: requirement.tableId,
        [preparedCreationTimeDefinitionBrand]: true,
      } satisfies PreparedAppCreationTimeIndexDefinitionV1);
      preparedCreationTimeDefinitionStates.set(token, Object.freeze({
        deploymentId: publication.deploymentId,
        tableId: requirement.tableId,
        expectedLogicalName: table.logicalName,
        access,
        storageIdentity: appPhysicalIndexAccessStorageIdentityV1(access),
        canonical: requirement.canonical,
      } satisfies PreparedCreationTimeDefinitionState));
      prepared.push(token);
    }
    if (seenTableIds.size !== tablesById.size) {
      return yield* Result.fail(
        new AppCreationTimeIndexDefinitionRequirementError(
          publication.deploymentId,
          {
            reason: "incompleteRequirementSet",
            coveredTableCount: seenTableIds.size,
            tableCount: tablesById.size,
          },
        ),
      );
    }
    return Object.freeze(prepared);
  });
}

/**
 * Derive the complete developer definition/binding token set from one
 * authenticated D2a preparation without re-lowering or re-hashing D1 output.
 *
 * Tokens are ordered by logical index ID. The defensive identity checks keep
 * an internally inconsistent requirement set from becoming persistence
 * authority even if a future compiler refactor changes one side of the seam.
 */
export function prepareAppDeveloperIndexDefinitionBindingsV1Result(
  publication: PreparedAppSchemaPublicationV1,
): Result.Result<
  ReadonlyArray<PreparedAppDeveloperIndexDefinitionBindingV1>,
  | InvalidPreparedAppSchemaPublicationV1Error
  | AppDeveloperIndexDefinitionRequirementError
> {
  return Result.gen(function* () {
    const publicationState = yield*
      getPreparedAppSchemaPublicationV1StateResult(publication);
    const indexes = publicationState.logicalBindings.manifest
      .indexBindings.indexes;
    const requirements = publicationState.requirements.developerIndexes;
    if (indexes.length !== requirements.length) {
      return yield* Result.fail(
        new AppDeveloperIndexDefinitionRequirementError(
          publication.deploymentId,
          {
            reason: "requirementCountMismatch",
            indexCount: indexes.length,
            requirementCount: requirements.length,
          },
        ),
      );
    }

    const indexesById = new Map(
      indexes.map((index) => [index.logicalIndexId, index] as const),
    );
    const seenLogicalIndexIds = new Set<CatalogIndexId>();
    const prepared: PreparedAppDeveloperIndexDefinitionBindingV1[] = [];
    for (const requirement of requirements) {
      const index = indexesById.get(requirement.logicalIndexId);
      if (index === undefined) {
        return yield* Result.fail(
          new AppDeveloperIndexDefinitionRequirementError(
            publication.deploymentId,
            {
              reason: "requirementLogicalIndexNotFound",
              logicalIndexId: requirement.logicalIndexId,
            },
          ),
        );
      }
      if (
        index.tableId !== requirement.tableId ||
        index.descriptor !== requirement.descriptor
      ) {
        return yield* Result.fail(
          new AppDeveloperIndexDefinitionRequirementError(
            publication.deploymentId,
            {
              reason: "requirementIdentityMismatch",
              logicalIndexId: requirement.logicalIndexId,
              requirementTableId: requirement.tableId,
              currentTableId: index.tableId,
              requirementDescriptor: requirement.descriptor,
              currentDescriptor: index.descriptor,
            },
          ),
        );
      }
      if (seenLogicalIndexIds.has(requirement.logicalIndexId)) {
        return yield* Result.fail(
          new AppDeveloperIndexDefinitionRequirementError(
            publication.deploymentId,
            {
              reason: "duplicateRequirementLogicalIndex",
              logicalIndexId: requirement.logicalIndexId,
            },
          ),
        );
      }
      seenLogicalIndexIds.add(requirement.logicalIndexId);
      const access = Object.freeze({
        kind: "developer",
        tableId: requirement.tableId,
        logicalIndexId: requirement.logicalIndexId,
      } satisfies AppDeveloperPhysicalIndexAccessIdentityV1);
      prepared.push(registerPreparedDeveloperIndexDefinitionBinding({
        deploymentId: publication.deploymentId,
        schemaVersionId: publication.schemaVersionId,
        tableId: requirement.tableId,
        logicalIndexId: requirement.logicalIndexId,
        access,
        storageIdentity: appPhysicalIndexAccessStorageIdentityV1(access),
        canonical: requirement.canonical,
      }));
    }
    if (seenLogicalIndexIds.size !== indexesById.size) {
      return yield* Result.fail(
        new AppDeveloperIndexDefinitionRequirementError(
          publication.deploymentId,
          {
            reason: "incompleteRequirementSet",
            coveredIndexCount: seenLogicalIndexIds.size,
            indexCount: indexesById.size,
          },
        ),
      );
    }
    return Object.freeze(prepared);
  });
}

function registerPreparedDeveloperIndexDefinitionBinding(
  state: PreparedDefinitionBindingState,
): PreparedAppDeveloperIndexDefinitionBindingV1 {
  const prepared = Object.freeze({
    deploymentId: state.deploymentId,
    schemaVersionId: state.schemaVersionId,
    tableId: state.tableId,
    logicalIndexId: state.logicalIndexId,
    [preparedDefinitionBindingBrand]: true,
  } satisfies PreparedAppDeveloperIndexDefinitionBindingV1);
  preparedDefinitionBindingStates.set(prepared, Object.freeze(state));
  return prepared;
}

/**
 * Ensure one immutable developer definition and its schema binding inside a
 * caller-owned transaction. This helper never commits and is intentionally not
 * exported from the package root; S03-D must compose it with full publication.
 */
export const ensureAppDeveloperIndexDefinitionBindingV1InTransaction = Effect.fn(
  "AppIndexDefinitions.ensureDeveloperBindingInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  prepared: PreparedAppDeveloperIndexDefinitionBindingV1,
): Effect.fn.Return<
  EnsureAppDeveloperIndexDefinitionBindingV1Result,
  EnsureAppDeveloperIndexDefinitionBindingV1Error
> {
  const state = preparedDefinitionBindingStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedAppIndexDefinitionBindingError(),
    );
  }

  yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
  yield* verifyDeveloperParentsEffect(tx, state);
  const existingDefinition = yield* findExistingDeveloperDefinitionEffect(
    tx,
    state,
  );
  const existingBinding = yield* readExistingDeveloperBindingEffect(tx, state);
  if (existingBinding !== null) {
    if (
      existingDefinition !== null &&
      existingBinding.indexDefinitionId ===
        existingDefinition.indexDefinitionId
    ) {
      return Object.freeze({
        definitionStatus: "existing",
        bindingStatus: "existing",
        definition: existingDefinition,
        binding: existingBinding,
      } satisfies EnsureAppDeveloperIndexDefinitionBindingV1Result);
    }
    return yield* Effect.fail(
      new AppSchemaVersionIndexBindingConflictError(
        state.deploymentId,
        state.schemaVersionId,
        state.logicalIndexId,
        existingBinding.indexDefinitionId,
        existingDefinition?.indexDefinitionId ?? null,
      ),
    );
  }

  const ensuredDefinition = existingDefinition === null
    ? yield* insertDeveloperDefinitionEffect(tx, state)
    : Object.freeze({
      status: "existing",
      definition: existingDefinition,
    } satisfies {
      readonly status: "existing";
      readonly definition:
        AppIndexDefinitionRecordForAccessKindV1<"developer">;
    });
  const insertedBinding = yield* insertDeveloperBindingEffect(
    tx,
    state,
    ensuredDefinition.definition.indexDefinitionId,
  );

  return Object.freeze({
    definitionStatus: ensuredDefinition.status,
    bindingStatus: "created",
    definition: ensuredDefinition.definition,
    binding: insertedBinding,
  } satisfies EnsureAppDeveloperIndexDefinitionBindingV1Result);
});

/**
 * Ensure one table-owned intrinsic definition in a caller-owned transaction.
 *
 * The exact bound app table is checked under the deployment lock before any
 * definition lookup or allocation. This helper never creates a stable table,
 * schema binding, build row, lifecycle state, or transaction commit.
 */
export const ensureAppCreationTimeIndexDefinitionV1InTransaction = Effect.fn(
  "AppIndexDefinitions.ensureCreationTimeInTransaction",
)(function* (
  tx: StableTableCatalogTransaction,
  prepared: PreparedAppCreationTimeIndexDefinitionV1,
): Effect.fn.Return<
  EnsureAppCreationTimeIndexDefinitionV1Result,
  EnsureAppCreationTimeIndexDefinitionV1Error
> {
  const state = preparedCreationTimeDefinitionStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedAppCreationTimeIndexDefinitionError(),
    );
  }

  yield* lockSchemaManifestBindingDeploymentEffect(tx, state.deploymentId);
  yield* verifyCreationTimeTableParentEffect(tx, state);
  const existingDefinition = yield* findExistingCreationTimeDefinitionEffect(
    tx,
    state,
  );
  if (existingDefinition !== null) {
    return Object.freeze({
      definitionStatus: "existing",
      definition: existingDefinition,
    } satisfies EnsureAppCreationTimeIndexDefinitionV1Result);
  }
  const created = yield* insertCreationTimeDefinitionEffect(tx, state);
  return Object.freeze({
    definitionStatus: created.status,
    definition: created.definition,
  } satisfies EnsureAppCreationTimeIndexDefinitionV1Result);
});

export const getAppIndexDefinitionByIdEffect = Effect.fn(
  "AppIndexDefinitions.getDefinitionById",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexDefinitionId: CatalogIndexDefinitionId,
): Effect.fn.Return<
  AppIndexDefinitionRecord | null,
  ReadAppIndexDefinitionError
> {
  const decoded = yield* Effect.fromResult(
    decodeAppIndexDefinitionReadInputResult(
      deploymentId,
      indexDefinitionId,
    ),
  );
  const query = db
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, decoded.deploymentId),
        eq(
          fxControlIndexDefinitions.indexDefinitionId,
          decoded.indexDefinitionId,
        ),
      ),
    )
    .limit(1);
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppIndexDefinitionReadPersistenceError(
      "readByDefinitionId",
      cause,
    ),
  );
  const row = rows[0];
  return row === undefined ? null : yield* decodeStoredDefinitionEffect(row);
});

export const listAppIndexDefinitionsForLogicalIndexEffect = Effect.fn(
  "AppIndexDefinitions.listDefinitionsForLogicalIndex",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalIndexId: CatalogIndexId,
): Effect.fn.Return<
  ReadonlyArray<AppIndexDefinitionRecord>,
  ReadAppIndexDefinitionError
> {
  const decoded = yield* Effect.fromResult(
    decodeAppIndexDefinitionsListInputResult(deploymentId, logicalIndexId),
  );
  const query = db
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, decoded.deploymentId),
        eq(fxControlIndexDefinitions.accessKind, "developer"),
        eq(
          fxControlIndexDefinitions.accessIdentityId,
          decoded.logicalIndexId,
        ),
        eq(
          fxControlIndexDefinitions.logicalIndexId,
          decoded.logicalIndexId,
        ),
      ),
    )
    .orderBy(fxControlIndexDefinitions.indexDefinitionId);
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppIndexDefinitionReadPersistenceError(
      "listByLogicalIndexId",
      cause,
    ),
  );
  const definitions = yield* Effect.all(
    rows.map(decodeStoredDefinitionEffect),
    { concurrency: "unbounded" },
  );
  return Object.freeze(definitions);
});

function decodePrepareAppDeveloperIndexDefinitionBindingV1InputResult(
  input: PrepareAppDeveloperIndexDefinitionBindingV1Input,
): Result.Result<{
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly logicalSpec: SchemaManifestAppDeveloperOrderedIndexSpecV1;
}, InvalidAppIndexDefinitionBindingInputError> {
  if (!hasExactOwnDataKeys(input, PREPARE_INPUT_KEYS)) {
    return Result.fail(new InvalidAppIndexDefinitionBindingInputError({
      reason: "invalidInputShape",
    }));
  }
  return Result.gen(function* () {
    if (!isNonBlankString(input.deploymentId)) {
      return yield* Result.fail(invalidAppIndexDefinitionInput(
        "invalidDeploymentId",
      ));
    }
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError((cause) => invalidAppIndexDefinitionInput(
      "invalidSchemaVersionId",
      cause,
    )));
    const tableId = yield* decodeCatalogTableIdResult(input.tableId).pipe(
      Result.mapError((cause) => invalidAppIndexDefinitionInput(
        "invalidTableId",
        cause,
      )),
    );
    const logicalIndexId = yield* decodeCatalogIndexIdResult(
      input.logicalIndexId,
    ).pipe(Result.mapError((cause) => invalidAppIndexDefinitionInput(
      "invalidLogicalIndexId",
      cause,
    )));
    const logicalSpec = yield* Result.try({
      try: () => decodeSchemaManifestAppDeveloperOrderedIndexSpecV1(
        input.logicalSpec,
      ),
      catch: (cause) => invalidAppIndexDefinitionInput(
        "invalidLogicalSpec",
        cause,
      ),
    });
    return Object.freeze({
      deploymentId: input.deploymentId,
      schemaVersionId,
      tableId,
      logicalIndexId,
      logicalSpec,
    });
  });
}

function decodeAppIndexDefinitionReadInputResult(
  deploymentId: unknown,
  indexDefinitionId: unknown,
): Result.Result<{
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
}, InvalidAppIndexDefinitionBindingInputError> {
  return Result.gen(function* () {
    if (!isNonBlankString(deploymentId)) {
      return yield* Result.fail(invalidAppIndexDefinitionInput(
        "invalidDeploymentId",
      ));
    }
    const decodedDefinitionId = yield* decodeCatalogIndexDefinitionIdResult(
      indexDefinitionId,
    ).pipe(Result.mapError((cause) => invalidAppIndexDefinitionInput(
      "invalidIndexDefinitionId",
      cause,
    )));
    return Object.freeze({
      deploymentId,
      indexDefinitionId: decodedDefinitionId,
    });
  });
}

function decodeAppIndexDefinitionsListInputResult(
  deploymentId: unknown,
  logicalIndexId: unknown,
): Result.Result<{
  readonly deploymentId: string;
  readonly logicalIndexId: CatalogIndexId;
}, InvalidAppIndexDefinitionBindingInputError> {
  return Result.gen(function* () {
    if (!isNonBlankString(deploymentId)) {
      return yield* Result.fail(invalidAppIndexDefinitionInput(
        "invalidDeploymentId",
      ));
    }
    const decodedLogicalIndexId = yield* decodeCatalogIndexIdResult(
      logicalIndexId,
    ).pipe(Result.mapError((cause) => invalidAppIndexDefinitionInput(
      "invalidLogicalIndexId",
      cause,
    )));
    return Object.freeze({
      deploymentId,
      logicalIndexId: decodedLogicalIndexId,
    });
  });
}

function invalidAppIndexDefinitionInput(
  reason: InvalidAppIndexDefinitionBindingInputIssue["reason"],
  cause?: unknown,
): InvalidAppIndexDefinitionBindingInputError {
  return new InvalidAppIndexDefinitionBindingInputError(
    { reason },
    cause === undefined ? undefined : { cause },
  );
}

export const getAppSchemaVersionIndexBindingEffect = Effect.fn(
  "AppIndexDefinitions.getSchemaVersionBinding",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  logicalIndexId: CatalogIndexId,
): Effect.fn.Return<
  AppSchemaVersionIndexBindingRecord | null,
  ReadAppSchemaVersionIndexBindingError
> {
  const decoded = yield* Effect.fromResult(
    decodeSchemaVersionBindingReadInputResult(
      deploymentId,
      schemaVersionId,
      logicalIndexId,
    ),
  );
  const query = db
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(
      and(
        eq(
          fxControlSchemaVersionIndexBindings.deploymentId,
          decoded.deploymentId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.schemaVersionId,
          decoded.schemaVersionId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.logicalIndexId,
          decoded.logicalIndexId,
        ),
      ),
    )
    .limit(1);
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppSchemaVersionIndexBindingPersistenceError(
      "readByLogicalIndexId",
      cause,
    ),
  );
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeStoredBindingResult(row));
});

export const listAppSchemaVersionIndexBindingsEffect = Effect.fn(
  "AppIndexDefinitions.listSchemaVersionBindings",
)(function* (
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Effect.fn.Return<
  ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
  ReadAppSchemaVersionIndexBindingError
> {
  const decoded = yield* Effect.fromResult(
    decodeSchemaVersionBindingListInputResult(
      deploymentId,
      schemaVersionId,
    ),
  );
  const query = db
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(
      and(
        eq(
          fxControlSchemaVersionIndexBindings.deploymentId,
          decoded.deploymentId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.schemaVersionId,
          decoded.schemaVersionId,
        ),
      ),
    )
    .orderBy(fxControlSchemaVersionIndexBindings.logicalIndexId);
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppSchemaVersionIndexBindingPersistenceError(
      "listBySchemaVersion",
      cause,
    ),
  );
  return yield* Effect.fromResult(decodeStoredBindingsResult(rows));
});

function decodeSchemaVersionBindingListInputResult(
  deploymentId: unknown,
  schemaVersionId: unknown,
): Result.Result<{
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}, InvalidAppIndexDefinitionBindingInputError> {
  return Result.gen(function* () {
    if (!isNonBlankString(deploymentId)) {
      return yield* Result.fail(
        new InvalidAppIndexDefinitionBindingInputError({
          reason: "invalidDeploymentId",
        }),
      );
    }
    const decodedSchemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      schemaVersionId,
    ).pipe(
      Result.mapError((cause) =>
        new InvalidAppIndexDefinitionBindingInputError(
          { reason: "invalidSchemaVersionId" },
          { cause },
        )
      ),
    );
    return Object.freeze({
      deploymentId,
      schemaVersionId: decodedSchemaVersionId,
    });
  });
}

function decodeSchemaVersionBindingReadInputResult(
  deploymentId: unknown,
  schemaVersionId: unknown,
  logicalIndexId: unknown,
): Result.Result<{
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly logicalIndexId: CatalogIndexId;
}, InvalidAppIndexDefinitionBindingInputError> {
  return Result.gen(function* () {
    const decoded = yield* decodeSchemaVersionBindingListInputResult(
      deploymentId,
      schemaVersionId,
    );
    const decodedLogicalIndexId = yield* decodeCatalogIndexIdResult(
      logicalIndexId,
    ).pipe(
      Result.mapError((cause) =>
        new InvalidAppIndexDefinitionBindingInputError(
          { reason: "invalidLogicalIndexId" },
          { cause },
        )
      ),
    );
    return Object.freeze({ ...decoded, logicalIndexId: decodedLogicalIndexId });
  });
}

function decodeStoredBindingsResult(
  rows: ReadonlyArray<
    typeof fxControlSchemaVersionIndexBindings.$inferSelect
  >,
): Result.Result<
  ReadonlyArray<AppSchemaVersionIndexBindingRecord>,
  AppIndexDefinitionCatalogCorruptionError
> {
  return Result.gen(function* () {
    const bindings: AppSchemaVersionIndexBindingRecord[] = [];
    for (const row of rows) {
      bindings.push(yield* decodeStoredBindingResult(row));
    }
    return Object.freeze(bindings);
  });
}

function decodeStoredBindingResult(
  row: typeof fxControlSchemaVersionIndexBindings.$inferSelect,
): Result.Result<
  AppSchemaVersionIndexBindingRecord,
  AppIndexDefinitionCatalogCorruptionError
> {
  return Result.gen(function* () {
    if (!isNonBlankString(row.deploymentId)) {
      return yield* Result.fail(
        new AppIndexDefinitionCatalogCorruptionError(
          typeof row.deploymentId === "string"
            ? row.deploymentId
            : "<invalid>",
          "definition deployment ID is invalid",
        ),
      );
    }
    const deploymentId = row.deploymentId;
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      row.schemaVersionId,
    ).pipe(
      Result.mapError((cause) =>
        new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          "schema binding has an invalid schema version ID",
          { cause },
        )
      ),
    );
    const logicalIndexId = yield* decodeCatalogIndexIdResult(
      row.logicalIndexId,
    ).pipe(
      Result.mapError((cause) =>
        new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          `invalid logical index ID: ${String(row.logicalIndexId)}`,
          { cause },
        )
      ),
    );
    const indexDefinitionId = yield* decodeCatalogIndexDefinitionIdResult(
      row.indexDefinitionId,
    ).pipe(
      Result.mapError((cause) =>
        new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          `invalid physical definition ID: ${String(row.indexDefinitionId)}`,
          { cause },
        )
      ),
    );
    if (row.requiredForActivation !== true) {
      return yield* Result.fail(
        new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          `schema binding ${schemaVersionId}/${logicalIndexId} has an invalid activation requirement`,
        ),
      );
    }
    const createdAt = copyFiniteDate(row.createdAt);
    if (createdAt === undefined) {
      return yield* Result.fail(
        new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          `definition ${indexDefinitionId} has an invalid created timestamp`,
        ),
      );
    }
    return Object.freeze({
      deploymentId,
      schemaVersionId,
      logicalIndexId,
      indexDefinitionId,
      requiredForActivation: true,
      createdAt,
    } satisfies AppSchemaVersionIndexBindingRecord);
  });
}

const verifyDeveloperParentsEffect = Effect.fn(
  "AppIndexDefinitions.verifyDeveloperParents",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Effect.fn.Return<
  void,
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionParentError
  | AppIndexDefinitionCatalogCorruptionError
> {
  const schemaQuery = tx
    .select({ schemaVersionId: fxControlSchemaVersions.schemaVersionId })
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, state.deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, state.schemaVersionId),
      ),
    )
    .limit(1);
  const schemaRows = yield* readDefinitionRowsEffect(
    schemaQuery,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "readSchemaParent",
      cause,
    ),
  );
  if (schemaRows[0] === undefined) {
    return yield* Effect.fail(
      new AppIndexDefinitionParentError(
        state.deploymentId,
        state.schemaVersionId,
        state.logicalIndexId,
        { reason: "schemaVersionNotFound" },
      ),
    );
  }

  const logicalQuery = tx
    .select({ tableId: fxControlIndexes.tableId })
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, state.deploymentId),
        eq(fxControlIndexes.logicalIndexId, state.logicalIndexId),
      ),
    )
    .limit(1);
  const logicalRows = yield* readDefinitionRowsEffect(
    logicalQuery,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "readLogicalIndexParent",
      cause,
    ),
  );
  const logicalRow = logicalRows[0];
  if (logicalRow === undefined) {
    return yield* Effect.fail(
      new AppIndexDefinitionParentError(
        state.deploymentId,
        state.schemaVersionId,
        state.logicalIndexId,
        { reason: "logicalIndexNotFound" },
      ),
    );
  }
  const currentTableId = yield* Effect.fromResult(
    decodeStoredTableIdResult(
      state.deploymentId,
      logicalRow.tableId,
    ),
  );
  if (currentTableId !== state.tableId) {
    return yield* Effect.fail(
      new AppIndexDefinitionParentError(
        state.deploymentId,
        state.schemaVersionId,
        state.logicalIndexId,
        {
          reason: "logicalIndexTableMismatch",
          requestedTableId: state.tableId,
          currentTableId,
        },
      ),
    );
  }
});

const verifyCreationTimeTableParentEffect = Effect.fn(
  "AppIndexDefinitions.verifyCreationTimeTableParent",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedCreationTimeDefinitionState,
): Effect.fn.Return<
  void,
  | StableTableCatalogCorruptionError
  | StableTableIdentityPersistenceError
  | AppCreationTimeIndexDefinitionParentError
> {
  const current = yield* getStableTableIdentityByValidatedIdEffect(
    tx,
    {
      deploymentId: state.deploymentId,
      tableId: state.tableId,
    },
  );
  if (current === null) {
    return yield* Effect.fail(
      new AppCreationTimeIndexDefinitionParentError(
        state.deploymentId,
        state.tableId,
        state.expectedLogicalName,
        { reason: "tableNotFound" },
      ),
    );
  }
  if (
    current.namespace !== "app" ||
    current.logicalName !== state.expectedLogicalName
  ) {
    return yield* Effect.fail(
      new AppCreationTimeIndexDefinitionParentError(
        state.deploymentId,
        state.tableId,
        state.expectedLogicalName,
        {
          reason: "tableBindingChanged",
          currentNamespace: current.namespace,
          currentLogicalName: current.logicalName,
        },
      ),
    );
  }
});

const findExistingDeveloperDefinitionEffect = Effect.fn(
  "AppIndexDefinitions.findExistingDeveloperDefinition",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Effect.fn.Return<
  AppIndexDefinitionRecordForAccessKindV1<"developer"> | null,
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionChecksumCollisionError
> {
  const query = selectExistingDefinitionRows(tx, state);
  const existingRows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "findExistingDefinition",
      cause,
    ),
  );
  const existingRow = existingRows[0];
  if (existingRow === undefined) return null;
  return yield* Effect.fromResult(
    decodeStoredDefinitionAgainstPreparedResult(existingRow, state),
  );
});

function selectExistingDefinitionRows<
  Kind extends AppPhysicalIndexAccessKindV1,
>(
  tx: StableTableCatalogTransaction,
  state: PreparedPhysicalDefinitionState<Kind>,
) {
  return tx
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, state.deploymentId),
        eq(
          fxControlIndexDefinitions.accessKind,
          state.storageIdentity.kind,
        ),
        eq(
          fxControlIndexDefinitions.accessIdentityId,
          state.storageIdentity.accessIdentityId,
        ),
        eq(
          fxControlIndexDefinitions.physicalSpecSha256,
          appIndexPhysicalSpecSha256HexV1ToBytes(
            state.canonical.sha256Hex,
          ),
        ),
      ),
    )
    .limit(1);
}

const findExistingCreationTimeDefinitionEffect = Effect.fn(
  "AppIndexDefinitions.findExistingCreationTimeDefinition",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedCreationTimeDefinitionState,
): Effect.fn.Return<
  AppIndexDefinitionRecordForAccessKindV1<"by_creation_time"> | null,
  | AppCreationTimeIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
  | AppCreationTimeIndexDefinitionChecksumCollisionError
> {
  const query = selectExistingDefinitionRows(tx, state);
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppCreationTimeIndexDefinitionPersistenceError(
      "findExistingDefinition",
      cause,
    ),
  );
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(
      decodeStoredDefinitionAgainstPreparedResult(row, state),
    );
});

const insertCreationTimeDefinitionEffect = Effect.fn(
  "AppIndexDefinitions.insertCreationTimeDefinition",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedCreationTimeDefinitionState,
): Effect.fn.Return<
  {
    readonly status: "created";
    readonly definition:
      AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">;
  },
  | AppCreationTimeIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionIdExhaustedError
  | AppCreationTimeIndexDefinitionChecksumCollisionError
> {
  const highWaterQuery = selectDefinitionHighWaterRows(
    tx,
    state.deploymentId,
  );
  const highWaterRows = yield* readDefinitionRowsEffect(
    highWaterQuery,
    (cause) => new AppCreationTimeIndexDefinitionPersistenceError(
      "readDefinitionHighWater",
      cause,
    ),
  );
  const highWaterValue = highWaterRows[0]?.indexDefinitionId;
  const currentHighWater = highWaterValue === undefined
    ? null
    : yield* Effect.fromResult(decodeStoredDefinitionIdResult(
      state.deploymentId,
      highWaterValue,
    ));
  const indexDefinitionId = yield* Effect.fromResult(
    nextDefinitionIdResult(state.deploymentId, currentHighWater),
  );
  const insertQuery = insertDefinitionRows(tx, state, indexDefinitionId);
  const rows = yield* readDefinitionRowsEffect(
    insertQuery,
    (cause) => new AppCreationTimeIndexDefinitionPersistenceError(
      "insertDefinition",
      cause,
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "definition insert returned no row",
    ));
  }
  const definition = yield* Effect.fromResult(
    decodeStoredDefinitionAgainstPreparedResult(row, state),
  );
  return Object.freeze({ status: "created", definition });
});

const readDefinitionRowsEffect = Effect.fn(
  "AppIndexDefinitions.readRows",
)(<Row, Failure>(
  query: PromiseLike<ReadonlyArray<Row>>,
  onFailure: (cause: unknown) => Failure,
): Effect.Effect<
  ReadonlyArray<Row>,
  Failure
> => Effect.uninterruptible(Effect.tryPromise({
  try: () => query,
  catch: onFailure,
})));

const insertDeveloperDefinitionEffect = Effect.fn(
  "AppIndexDefinitions.insertDeveloperDefinition",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Effect.fn.Return<{
  readonly status: "created";
  readonly definition: AppIndexDefinitionRecordForAccessKindV1<"developer">;
},
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionIdExhaustedError
  | AppIndexDefinitionChecksumCollisionError
> {
  const highWaterQuery = selectDefinitionHighWaterRows(
    tx,
    state.deploymentId,
  );
  const highWaterRows = yield* readDefinitionRowsEffect(
    highWaterQuery,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "readDefinitionHighWater",
      cause,
    ),
  );
  const highWaterValue = highWaterRows[0]?.indexDefinitionId;
  const currentHighWater = highWaterValue === undefined
    ? null
    : yield* Effect.fromResult(decodeStoredDefinitionIdResult(
      state.deploymentId,
      highWaterValue,
    ));
  const indexDefinitionId = yield* Effect.fromResult(
    nextDefinitionIdResult(state.deploymentId, currentHighWater),
  );
  const insertQuery = insertDefinitionRows(tx, state, indexDefinitionId);
  const rows = yield* readDefinitionRowsEffect(
    insertQuery,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "insertDefinition",
      cause,
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "definition insert returned no row",
    ));
  }
  const definition = yield* Effect.fromResult(
    decodeStoredDefinitionAgainstPreparedResult(row, state),
  );
  return Object.freeze({
    status: "created",
    definition,
  });
});

function insertDefinitionRows<Kind extends AppPhysicalIndexAccessKindV1>(
  tx: StableTableCatalogTransaction,
  state: PreparedPhysicalDefinitionState<Kind>,
  indexDefinitionId: CatalogIndexDefinitionId,
) {
  return tx
    .insert(fxControlIndexDefinitions)
    .values({
      deploymentId: state.deploymentId,
      indexDefinitionId,
      accessKind: state.storageIdentity.kind,
      accessIdentityId: state.storageIdentity.accessIdentityId,
      tableId: state.storageIdentity.tableId,
      logicalIndexId: state.storageIdentity.logicalIndexId,
      physicalSpecCodecVersion: state.canonical.codecVersion,
      physicalSpecJson: state.canonical.physicalSpec,
      physicalSpecBytes: canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        state.canonical.canonicalBytesHex,
      ),
      physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
        state.canonical.sha256Hex,
      ),
    })
    .returning();
}

const readExistingDeveloperBindingEffect = Effect.fn(
  "AppIndexDefinitions.readExistingDeveloperBinding",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Effect.fn.Return<
  AppSchemaVersionIndexBindingRecord | null,
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
> {
  const query = tx
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(
      and(
        eq(
          fxControlSchemaVersionIndexBindings.deploymentId,
          state.deploymentId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.schemaVersionId,
          state.schemaVersionId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.logicalIndexId,
          state.logicalIndexId,
        ),
      ),
    )
    .limit(1);
  const existingRows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "readExistingBinding",
      cause,
    ),
  );
  const existingRow = existingRows[0];
  return existingRow === undefined
    ? null
    : yield* Effect.fromResult(decodeStoredBindingResult(existingRow));
});

const insertDeveloperBindingEffect = Effect.fn(
  "AppIndexDefinitions.insertDeveloperBinding",
)(function* (
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
  indexDefinitionId: CatalogIndexDefinitionId,
): Effect.fn.Return<
  AppSchemaVersionIndexBindingRecord,
  | AppDeveloperIndexDefinitionPersistenceError
  | AppIndexDefinitionCatalogCorruptionError
> {
  const query = tx
    .insert(fxControlSchemaVersionIndexBindings)
    .values({
      deploymentId: state.deploymentId,
      schemaVersionId: state.schemaVersionId,
      logicalIndexId: state.logicalIndexId,
      indexDefinitionId,
      requiredForActivation: true,
    })
    .returning();
  const rows = yield* readDefinitionRowsEffect(
    query,
    (cause) => new AppDeveloperIndexDefinitionPersistenceError(
      "insertBinding",
      cause,
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "schema binding insert returned no row",
    ));
  }
  return yield* Effect.fromResult(decodeStoredBindingResult(row));
});

function selectDefinitionHighWaterRows(
  db: FlarexMetadataDatabase,
  deploymentId: string,
) {
  return db
    .select({
      indexDefinitionId: fxControlIndexDefinitions.indexDefinitionId,
    })
    .from(fxControlIndexDefinitions)
    .where(eq(fxControlIndexDefinitions.deploymentId, deploymentId))
    .orderBy(desc(fxControlIndexDefinitions.indexDefinitionId))
    .limit(1);
}

function nextDefinitionIdResult(
  deploymentId: string,
  currentHighWater: CatalogIndexDefinitionId | null,
): Result.Result<
  CatalogIndexDefinitionId,
  AppIndexDefinitionCatalogCorruptionError | AppIndexDefinitionIdExhaustedError
> {
  if (currentHighWater === MAX_CATALOG_INDEX_DEFINITION_ID) {
    return Result.fail(new AppIndexDefinitionIdExhaustedError(deploymentId));
  }
  return decodeStoredDefinitionIdResult(
    deploymentId,
    currentHighWater === null ? 1 : currentHighWater + 1,
  );
}

/**
 * Validate a row against canonical evidence already prepared before SQL.
 *
 * This path deliberately performs no Web Crypto while the deployment lock is
 * held. Root read APIs use the stronger independent re-canonicalization path
 * below because they are outside the publication critical section.
 */
function decodeStoredDefinitionAgainstPreparedResult(
  row: typeof fxControlIndexDefinitions.$inferSelect,
  state: PreparedDefinitionBindingState,
): Result.Result<
  AppIndexDefinitionRecordForAccessKindV1<"developer">,
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionChecksumCollisionError
>;
function decodeStoredDefinitionAgainstPreparedResult(
  row: typeof fxControlIndexDefinitions.$inferSelect,
  state: PreparedCreationTimeDefinitionState,
): Result.Result<
  AppIndexDefinitionRecordForAccessKindV1<"by_creation_time">,
  | AppIndexDefinitionCatalogCorruptionError
  | AppCreationTimeIndexDefinitionChecksumCollisionError
>;
function decodeStoredDefinitionAgainstPreparedResult(
  row: typeof fxControlIndexDefinitions.$inferSelect,
  state: PreparedDefinitionBindingState | PreparedCreationTimeDefinitionState,
): Result.Result<
  AppIndexDefinitionRecord,
  | AppIndexDefinitionCatalogCorruptionError
  | AppIndexDefinitionChecksumCollisionError
  | AppCreationTimeIndexDefinitionChecksumCollisionError
> {
  return Result.gen(function* () {
    const deploymentId = yield* decodeStoredDeploymentIdResult(row.deploymentId);
    if (deploymentId !== state.deploymentId) {
      return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
        state.deploymentId,
        "definition query returned another deployment",
      ));
    }
    const indexDefinitionId = yield* decodeStoredDefinitionIdResult(
      deploymentId,
      row.indexDefinitionId,
    );
    const tableId = yield* decodeStoredTableIdResult(
      deploymentId,
      row.tableId,
    );
    const access = yield* decodeStoredAccessResult(
      deploymentId,
      row.accessKind,
      row.accessIdentityId,
      tableId,
      row.logicalIndexId,
    );
    if (!appPhysicalIndexAccessIdentitiesEqual(access, state.access)) {
      return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
        deploymentId,
        `definition ${indexDefinitionId} does not match its prepared access owner`,
      ));
    }

    const invalidPreparedEvidenceDetail =
      `definition ${indexDefinitionId} has invalid prepared evidence`;
    const physicalSpecCodecVersion = yield*
      decodeStoredProtocolValueResult(
        deploymentId,
        invalidPreparedEvidenceDetail,
        row.physicalSpecCodecVersion,
        decodeAppIndexPhysicalSpecCodecVersion,
      );
    const physicalSpecBytesHex = yield* decodeStoredProtocolValueResult(
      deploymentId,
      invalidPreparedEvidenceDetail,
      row.physicalSpecBytes,
      canonicalAppIndexPhysicalSpecBytesHexV1FromBytes,
    );
    const physicalSpecSha256Hex = yield* decodeStoredProtocolValueResult(
      deploymentId,
      invalidPreparedEvidenceDetail,
      row.physicalSpecSha256,
      appIndexPhysicalSpecSha256HexV1FromBytes,
    );
    const storedPhysicalSpec = yield* decodeStoredProtocolValueResult(
      deploymentId,
      invalidPreparedEvidenceDetail,
      row.physicalSpecJson,
      decodeAppOrderedIndexPhysicalSpecV1,
    );
    if (physicalSpecCodecVersion !== state.canonical.codecVersion) {
      return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
        deploymentId,
        `definition ${indexDefinitionId} physical-spec codec changed after preparation`,
      ));
    }
    if (physicalSpecSha256Hex !== state.canonical.sha256Hex) {
      return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
        deploymentId,
        `definition ${indexDefinitionId} digest changed after preparation`,
      ));
    }
    if (physicalSpecBytesHex !== state.canonical.canonicalBytesHex) {
      return yield* Result.fail(checksumCollisionError(
        state.deploymentId,
        state.access,
        indexDefinitionId,
      ));
    }
    if (!physicalSpecsEqual(storedPhysicalSpec, state.canonical.physicalSpec)) {
      return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
        deploymentId,
        `definition ${indexDefinitionId} JSON changed after canonical preparation`,
      ));
    }
    const createdAt = yield* decodeStoredTimestampResult(
      deploymentId,
      indexDefinitionId,
      row.createdAt,
    );
    return Object.freeze({
      deploymentId,
      indexDefinitionId,
      access: state.access,
      physicalSpecCodecVersion,
      physicalSpec: state.canonical.physicalSpec,
      physicalSpecBytesHex,
      physicalSpecSha256Hex,
      createdAt,
    } satisfies AppIndexDefinitionRecord);
  });
}

const decodeStoredDefinitionEffect = Effect.fn(
  "AppIndexDefinitions.decodeStoredDefinition",
)(function* (
  row: typeof fxControlIndexDefinitions.$inferSelect,
): Effect.fn.Return<
  AppIndexDefinitionRecord,
  AppIndexDefinitionCatalogCorruptionError
> {
  const decoded = yield* Effect.fromResult(
    decodeStoredDefinitionScalarsResult(row),
  );
  const physicalSpecJson = row.physicalSpecJson;
  const canonical = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(physicalSpecJson),
    catch: (cause) => new AppIndexDefinitionCatalogCorruptionError(
      decoded.deploymentId,
      `definition ${decoded.indexDefinitionId} has an invalid physical specification`,
      { cause },
    ),
  });
  if (canonical.physicalSpec.accessPath !== decoded.access.kind) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      decoded.deploymentId,
      `definition ${decoded.indexDefinitionId} physical access path does not match its owner`,
    ));
  }
  if (decoded.physicalSpecCodecVersion !== canonical.codecVersion) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      decoded.deploymentId,
      `definition ${decoded.indexDefinitionId} physical-spec codec does not match canonical bytes`,
    ));
  }
  if (decoded.physicalSpecBytesHex !== canonical.canonicalBytesHex) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      decoded.deploymentId,
      `definition ${decoded.indexDefinitionId} canonical bytes do not match physical-spec JSON`,
    ));
  }
  if (decoded.physicalSpecSha256Hex !== canonical.sha256Hex) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      decoded.deploymentId,
      `definition ${decoded.indexDefinitionId} SHA-256 does not match canonical bytes`,
    ));
  }
  const createdAt = yield* Effect.fromResult(
    decodeStoredTimestampResult(
      decoded.deploymentId,
      decoded.indexDefinitionId,
      row.createdAt,
    ),
  );

  return Object.freeze({
    deploymentId: decoded.deploymentId,
    indexDefinitionId: decoded.indexDefinitionId,
    access: decoded.access,
    physicalSpecCodecVersion: decoded.physicalSpecCodecVersion,
    physicalSpec: canonical.physicalSpec,
    physicalSpecBytesHex: decoded.physicalSpecBytesHex,
    physicalSpecSha256Hex: decoded.physicalSpecSha256Hex,
    createdAt,
  } satisfies AppIndexDefinitionRecord);
});

function decodeStoredDefinitionScalarsResult(
  row: typeof fxControlIndexDefinitions.$inferSelect,
): Result.Result<{
  readonly deploymentId: string;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly access: AppPhysicalIndexAccessIdentityV1;
  readonly physicalSpecCodecVersion: AppIndexPhysicalSpecCodecVersion;
  readonly physicalSpecBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  readonly physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1;
}, AppIndexDefinitionCatalogCorruptionError> {
  return Result.gen(function* () {
    const deploymentId = yield* decodeStoredDeploymentIdResult(row.deploymentId);
    const indexDefinitionId = yield* decodeStoredDefinitionIdResult(
      deploymentId,
      row.indexDefinitionId,
    );
    const tableId = yield* decodeStoredTableIdResult(
      deploymentId,
      row.tableId,
    );
    const access = yield* decodeStoredAccessResult(
      deploymentId,
      row.accessKind,
      row.accessIdentityId,
      tableId,
      row.logicalIndexId,
    );
    const physicalEvidence = yield* Result.gen(function* () {
      const invalidPhysicalSpecificationDetail =
        `definition ${indexDefinitionId} has an invalid physical specification`;
      const physicalSpecCodecVersion = yield*
        decodeStoredProtocolValueResult(
          deploymentId,
          invalidPhysicalSpecificationDetail,
          row.physicalSpecCodecVersion,
          decodeAppIndexPhysicalSpecCodecVersion,
        );
      const physicalSpecBytesHex = yield* decodeStoredProtocolValueResult(
        deploymentId,
        invalidPhysicalSpecificationDetail,
        row.physicalSpecBytes,
        canonicalAppIndexPhysicalSpecBytesHexV1FromBytes,
      );
      const physicalSpecSha256Hex = yield* decodeStoredProtocolValueResult(
        deploymentId,
        invalidPhysicalSpecificationDetail,
        row.physicalSpecSha256,
        appIndexPhysicalSpecSha256HexV1FromBytes,
      );
      return Object.freeze({
        physicalSpecCodecVersion,
        physicalSpecBytesHex,
        physicalSpecSha256Hex,
      });
    });
    return Object.freeze({
      deploymentId,
      indexDefinitionId,
      access,
      ...physicalEvidence,
    });
  });
}

function decodeStoredProtocolValueResult<Input, Value>(
  deploymentId: string,
  detail: string,
  value: Input,
  decode: (value: Input) => Value,
): Result.Result<Value, AppIndexDefinitionCatalogCorruptionError> {
  return Result.try({
    try: () => decode(value),
    catch: (cause) => new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      detail,
      { cause },
    ),
  });
}

function appPhysicalIndexAccessIdentitiesEqual(
  left: AppPhysicalIndexAccessIdentityV1,
  right: AppPhysicalIndexAccessIdentityV1,
): boolean {
  if (left.kind !== right.kind || left.tableId !== right.tableId) return false;
  return left.kind === "by_creation_time" ||
    (right.kind === "developer" &&
      left.logicalIndexId === right.logicalIndexId);
}

function checksumCollisionError(
  deploymentId: string,
  access: AppPhysicalIndexAccessIdentityV1,
  indexDefinitionId: CatalogIndexDefinitionId,
):
  | AppIndexDefinitionChecksumCollisionError
  | AppCreationTimeIndexDefinitionChecksumCollisionError {
  return access.kind === "developer"
    ? new AppIndexDefinitionChecksumCollisionError(
      deploymentId,
      access.logicalIndexId,
      indexDefinitionId,
    )
    : new AppCreationTimeIndexDefinitionChecksumCollisionError(
      deploymentId,
      access.tableId,
      indexDefinitionId,
    );
}

function physicalSpecsEqual(
  left: AppOrderedIndexPhysicalSpecV1,
  right: AppOrderedIndexPhysicalSpecV1,
): boolean {
  if (
    left.accessPath !== right.accessPath ||
    left.orderedFields.length !== right.orderedFields.length
  ) {
    return false;
  }
  for (let index = 0; index < left.orderedFields.length; index += 1) {
    const leftField = left.orderedFields[index];
    const rightField = right.orderedFields[index];
    if (leftField === undefined || rightField === undefined) return false;
    if (leftField.kind !== rightField.kind) return false;
    if (
      leftField.kind === "documentPath" &&
      (rightField.kind !== "documentPath" || leftField.path !== rightField.path)
    ) {
      return false;
    }
  }
  return true;
}

function decodeStoredAccessResult(
  deploymentId: string,
  accessKind: unknown,
  accessIdentityId: unknown,
  tableId: CatalogTableId,
  logicalIndexId: unknown,
): Result.Result<
  AppPhysicalIndexAccessIdentityV1,
  AppIndexDefinitionCatalogCorruptionError
> {
  const detail = "definition has an invalid access owner";
  return Result.gen(function* () {
    if (accessKind === "developer") {
      const decodedLogicalIndexId = yield* decodeCatalogIndexIdResult(
        logicalIndexId,
      ).pipe(
        Result.mapError((cause) => new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          detail,
          { cause },
        )),
      );
      if (accessIdentityId !== decodedLogicalIndexId) {
        return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          detail,
          {
            cause: new Error(
              "developer access identity does not match logical ID",
            ),
          },
        ));
      }
      return yield* decodeStoredProtocolValueResult(
        deploymentId,
        detail,
        {
          kind: accessKind,
          tableId,
          logicalIndexId: decodedLogicalIndexId,
        },
        decodeAppPhysicalIndexAccessIdentityV1,
      );
    }
    if (accessKind === "by_creation_time") {
      if (logicalIndexId !== null || accessIdentityId !== tableId) {
        return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
          deploymentId,
          detail,
          {
            cause: new Error(
              "creation-time access identity does not match table ID",
            ),
          },
        ));
      }
      return yield* decodeStoredProtocolValueResult(
        deploymentId,
        detail,
        { kind: accessKind, tableId },
        decodeAppPhysicalIndexAccessIdentityV1,
      );
    }
    return yield* Result.fail(new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      detail,
      { cause: new Error(`unsupported access kind: ${String(accessKind)}`) },
    ));
  });
}

function decodeStoredDeploymentIdResult(
  value: unknown,
): Result.Result<string, AppIndexDefinitionCatalogCorruptionError> {
  if (!isNonBlankString(value)) {
    return Result.fail(new AppIndexDefinitionCatalogCorruptionError(
      typeof value === "string" ? value : "<invalid>",
      "definition deployment ID is invalid",
    ));
  }
  return Result.succeed(value);
}

function decodeStoredDefinitionIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<
  CatalogIndexDefinitionId,
  AppIndexDefinitionCatalogCorruptionError
> {
  return decodeCatalogIndexDefinitionIdResult(value).pipe(
    Result.mapError((cause) => new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `invalid physical definition ID: ${String(value)}`,
      { cause },
    )),
  );
}

function decodeStoredTableIdResult(
  deploymentId: string,
  value: unknown,
): Result.Result<CatalogTableId, AppIndexDefinitionCatalogCorruptionError> {
  return decodeCatalogTableIdResult(value).pipe(
    Result.mapError((cause) => new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
      { cause },
    )),
  );
}

function decodeStoredTimestampResult(
  deploymentId: string,
  indexDefinitionId: CatalogIndexDefinitionId,
  value: unknown,
): Result.Result<Date, AppIndexDefinitionCatalogCorruptionError> {
  const timestamp = copyFiniteDate(value);
  if (timestamp === undefined) {
    return Result.fail(new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} has an invalid created timestamp`,
    ));
  }
  return Result.succeed(timestamp);
}

function invalidInputMessage(
  issue: InvalidAppIndexDefinitionBindingInputIssue,
): string {
  switch (issue.reason) {
    case "invalidInputShape":
      return "App index definition binding input must contain only the trusted logical fields.";
    case "invalidDeploymentId":
      return "App index definition deployment ID is invalid.";
    case "invalidSchemaVersionId":
      return "App index definition schema version ID is invalid.";
    case "invalidTableId":
      return "App index definition table ID is invalid.";
    case "invalidLogicalIndexId":
      return "App index definition logical index ID is invalid.";
    case "invalidIndexDefinitionId":
      return "App index physical definition ID is invalid.";
    case "invalidLogicalSpec":
      return "App index definition logical specification is invalid.";
  }
}

function parentIssueMessage(issue: AppIndexDefinitionParentIssue): string {
  switch (issue.reason) {
    case "schemaVersionNotFound":
      return "schema version does not exist";
    case "logicalIndexNotFound":
      return "logical index does not exist";
    case "logicalIndexTableMismatch":
      return `logical index belongs to table ${issue.currentTableId}, not ${issue.requestedTableId}`;
  }
}

function creationTimeParentIssueMessage(
  issue: AppCreationTimeIndexDefinitionParentIssue,
): string {
  switch (issue.reason) {
    case "tableNotFound":
      return "bound app table does not exist";
    case "tableBindingChanged":
      return `table now belongs to ${issue.currentNamespace}/${issue.currentLogicalName}`;
  }
}

function creationTimePersistenceOperationMessage(
  operation: AppCreationTimeIndexDefinitionPersistenceError["operation"],
): string {
  switch (operation) {
    case "findExistingDefinition":
      return "read the existing creation-time index definition";
    case "readDefinitionHighWater":
      return "read the creation-time index definition high-water mark";
    case "insertDefinition":
      return "insert the creation-time index definition";
  }
}

function developerPersistenceOperationMessage(
  operation: AppDeveloperIndexDefinitionPersistenceError["operation"],
): string {
  switch (operation) {
    case "readSchemaParent":
      return "read the developer index schema-version parent";
    case "readLogicalIndexParent":
      return "read the developer logical-index parent";
    case "findExistingDefinition":
      return "read the existing developer index definition";
    case "readExistingBinding":
      return "read the existing developer schema binding";
    case "readDefinitionHighWater":
      return "read the developer index definition high-water mark";
    case "insertDefinition":
      return "insert the developer index definition";
    case "insertBinding":
      return "insert the developer schema binding";
  }
}

function creationTimeRequirementIssueMessage(
  issue: AppCreationTimeIndexDefinitionRequirementIssue,
): string {
  switch (issue.reason) {
    case "requirementCountMismatch":
      return `expected ${issue.tableCount} requirements but found ${issue.requirementCount}`;
    case "requirementTableNotFound":
      return `requirement table ${issue.tableId} is missing`;
    case "duplicateRequirementTable":
      return `requirement table ${issue.tableId} is duplicated`;
    case "incompleteRequirementSet":
      return `requirements cover ${issue.coveredTableCount} of ${issue.tableCount} tables`;
  }
}

function developerRequirementIssueMessage(
  issue: AppDeveloperIndexDefinitionRequirementIssue,
): string {
  switch (issue.reason) {
    case "requirementCountMismatch":
      return `expected ${issue.indexCount} requirements but found ${issue.requirementCount}`;
    case "requirementLogicalIndexNotFound":
      return `logical index ${issue.logicalIndexId} is missing`;
    case "requirementIdentityMismatch":
      return `logical index ${issue.logicalIndexId} is ${issue.currentTableId}/${issue.currentDescriptor}, not ${issue.requirementTableId}/${issue.requirementDescriptor}`;
    case "duplicateRequirementLogicalIndex":
      return `logical index ${issue.logicalIndexId} is duplicated`;
    case "incompleteRequirementSet":
      return `requirements cover ${issue.coveredIndexCount} of ${issue.indexCount} logical indexes`;
  }
}
