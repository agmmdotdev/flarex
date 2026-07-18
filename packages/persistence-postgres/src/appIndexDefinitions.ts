import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
  decodeCatalogTableId,
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
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppDeveloperOrderedIndexSpecV1,
  type SchemaManifestAppIndexDescriptor,
  type SchemaManifestAppTableName,
} from "flarex-protocol/schema-manifest";

import {
  getPreparedAppSchemaPublicationV1State,
  type PreparedAppSchemaPublicationV1,
} from "./appSchemaPublicationPreparation";
import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  lockSchemaManifestBindingDeployment,
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
  constructor(
    readonly issue: InvalidAppIndexDefinitionBindingInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppIndexDefinitionBindingInputError";
  }
}

export class InvalidPreparedAppIndexDefinitionBindingError extends Error {
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

export type AppIndexDefinitionParentIssue =
  | { readonly reason: "schemaVersionNotFound" }
  | { readonly reason: "logicalIndexNotFound" }
  | {
      readonly reason: "logicalIndexTableMismatch";
      readonly requestedTableId: CatalogTableId;
      readonly currentTableId: CatalogTableId;
    };

export class AppIndexDefinitionParentError extends Error {
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

export class AppSchemaVersionIndexBindingConflictError extends Error {
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
export async function prepareAppDeveloperIndexDefinitionBindingV1(
  input: PrepareAppDeveloperIndexDefinitionBindingV1Input,
): Promise<PreparedAppDeveloperIndexDefinitionBindingV1> {
  if (!hasExactOwnDataKeys(input, PREPARE_INPUT_KEYS)) {
    throw new InvalidAppIndexDefinitionBindingInputError({
      reason: "invalidInputShape",
    });
  }
  const deploymentId = decodeDeploymentId(input.deploymentId);
  const schemaVersionId = decodeSchemaVersionIdInput(input.schemaVersionId);
  const tableId = decodeTableIdInput(input.tableId);
  const logicalIndexId = decodeLogicalIndexIdInput(input.logicalIndexId);
  const logicalSpec = decodeLogicalSpecInput(input.logicalSpec);
  const physicalSpec = lowerAppDeveloperOrderedIndexPhysicalSpecV1(logicalSpec);
  let canonical: CanonicalAppIndexPhysicalSpecV1;
  try {
    canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  } catch (cause) {
    throw new AppIndexDefinitionPreparationError(
      deploymentId,
      schemaVersionId,
      logicalIndexId,
      { cause },
    );
  }
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
}

/**
 * Derive the complete intrinsic definition-token set from one authenticated
 * D2a preparation without re-lowering or re-hashing its D1 evidence.
 *
 * Tokens are ordered by table ID and expose no logical name, canonical bytes,
 * digest, physical ID, lifecycle, or readiness authority. D2c later owns
 * consuming the complete set; D2b only provides the per-table row primitive.
 */
export function prepareAppCreationTimeIndexDefinitionsV1(
  publication: PreparedAppSchemaPublicationV1,
): ReadonlyArray<PreparedAppCreationTimeIndexDefinitionV1> {
  const publicationState =
    getPreparedAppSchemaPublicationV1State(publication);
  const tables = publicationState.logicalBindings.manifest
    .tableDefinitions.tables;
  const requirements = publicationState.requirements.creationTimeIndexes;
  if (tables.length !== requirements.length) {
    throw new AppCreationTimeIndexDefinitionRequirementError(
      publication.deploymentId,
      {
        reason: "requirementCountMismatch",
        tableCount: tables.length,
        requirementCount: requirements.length,
      },
    );
  }
  const tablesById = new Map(
    tables.map((table) => [table.tableId, table] as const),
  );
  const seenTableIds = new Set<CatalogTableId>();
  const prepared = requirements.map((requirement) => {
    const table = tablesById.get(requirement.tableId);
    if (table === undefined) {
      throw new AppCreationTimeIndexDefinitionRequirementError(
        publication.deploymentId,
        {
          reason: "requirementTableNotFound",
          tableId: requirement.tableId,
        },
      );
    }
    if (seenTableIds.has(requirement.tableId)) {
      throw new AppCreationTimeIndexDefinitionRequirementError(
        publication.deploymentId,
        {
          reason: "duplicateRequirementTable",
          tableId: requirement.tableId,
        },
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
    return token;
  });
  if (seenTableIds.size !== tablesById.size) {
    throw new AppCreationTimeIndexDefinitionRequirementError(
      publication.deploymentId,
      {
        reason: "incompleteRequirementSet",
        coveredTableCount: seenTableIds.size,
        tableCount: tablesById.size,
      },
    );
  }
  return Object.freeze(prepared);
}

/**
 * Derive the complete developer definition/binding token set from one
 * authenticated D2a preparation without re-lowering or re-hashing D1 output.
 *
 * Tokens are ordered by logical index ID. The defensive identity checks keep
 * an internally inconsistent requirement set from becoming persistence
 * authority even if a future compiler refactor changes one side of the seam.
 */
export function prepareAppDeveloperIndexDefinitionBindingsV1(
  publication: PreparedAppSchemaPublicationV1,
): ReadonlyArray<PreparedAppDeveloperIndexDefinitionBindingV1> {
  const publicationState =
    getPreparedAppSchemaPublicationV1State(publication);
  const indexes = publicationState.logicalBindings.manifest.indexBindings.indexes;
  const requirements = publicationState.requirements.developerIndexes;
  if (indexes.length !== requirements.length) {
    throw new AppDeveloperIndexDefinitionRequirementError(
      publication.deploymentId,
      {
        reason: "requirementCountMismatch",
        indexCount: indexes.length,
        requirementCount: requirements.length,
      },
    );
  }

  const indexesById = new Map(
    indexes.map((index) => [index.logicalIndexId, index] as const),
  );
  const seenLogicalIndexIds = new Set<CatalogIndexId>();
  const prepared = requirements.map((requirement) => {
    const index = indexesById.get(requirement.logicalIndexId);
    if (index === undefined) {
      throw new AppDeveloperIndexDefinitionRequirementError(
        publication.deploymentId,
        {
          reason: "requirementLogicalIndexNotFound",
          logicalIndexId: requirement.logicalIndexId,
        },
      );
    }
    if (
      index.tableId !== requirement.tableId ||
      index.descriptor !== requirement.descriptor
    ) {
      throw new AppDeveloperIndexDefinitionRequirementError(
        publication.deploymentId,
        {
          reason: "requirementIdentityMismatch",
          logicalIndexId: requirement.logicalIndexId,
          requirementTableId: requirement.tableId,
          currentTableId: index.tableId,
          requirementDescriptor: requirement.descriptor,
          currentDescriptor: index.descriptor,
        },
      );
    }
    if (seenLogicalIndexIds.has(requirement.logicalIndexId)) {
      throw new AppDeveloperIndexDefinitionRequirementError(
        publication.deploymentId,
        {
          reason: "duplicateRequirementLogicalIndex",
          logicalIndexId: requirement.logicalIndexId,
        },
      );
    }
    seenLogicalIndexIds.add(requirement.logicalIndexId);
    const access = Object.freeze({
      kind: "developer",
      tableId: requirement.tableId,
      logicalIndexId: requirement.logicalIndexId,
    } satisfies AppDeveloperPhysicalIndexAccessIdentityV1);
    return registerPreparedDeveloperIndexDefinitionBinding({
      deploymentId: publication.deploymentId,
      schemaVersionId: publication.schemaVersionId,
      tableId: requirement.tableId,
      logicalIndexId: requirement.logicalIndexId,
      access,
      storageIdentity: appPhysicalIndexAccessStorageIdentityV1(access),
      canonical: requirement.canonical,
    });
  });
  if (seenLogicalIndexIds.size !== indexesById.size) {
    throw new AppDeveloperIndexDefinitionRequirementError(
      publication.deploymentId,
      {
        reason: "incompleteRequirementSet",
        coveredIndexCount: seenLogicalIndexIds.size,
        indexCount: indexesById.size,
      },
    );
  }
  return Object.freeze(prepared);
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
export async function ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
  tx: StableTableCatalogTransaction,
  prepared: PreparedAppDeveloperIndexDefinitionBindingV1,
): Promise<EnsureAppDeveloperIndexDefinitionBindingV1Result> {
  const state = preparedDefinitionBindingStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedAppIndexDefinitionBindingError();
  }

  await lockSchemaManifestBindingDeployment(tx, state.deploymentId);
  await verifyParents(tx, state);
  const existingDefinition = await findExistingDefinition(tx, state);
  const existingBinding = await readExistingBinding(tx, state);
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
    throw new AppSchemaVersionIndexBindingConflictError(
      state.deploymentId,
      state.schemaVersionId,
      state.logicalIndexId,
      existingBinding.indexDefinitionId,
      existingDefinition?.indexDefinitionId ?? null,
    );
  }

  const ensuredDefinition = existingDefinition === null
    ? await insertDefinition(tx, state)
    : Object.freeze({
      status: "existing",
      definition: existingDefinition,
    } satisfies {
      readonly status: "existing";
      readonly definition:
        AppIndexDefinitionRecordForAccessKindV1<"developer">;
    });
  const insertedBinding = await insertBinding(
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
}

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

export async function getAppIndexDefinitionById(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  indexDefinitionId: CatalogIndexDefinitionId,
): Promise<AppIndexDefinitionRecord | null> {
  const decodedDeploymentId = decodeDeploymentId(deploymentId);
  const decodedDefinitionId = decodeDefinitionIdInput(indexDefinitionId);
  const rows = await db
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, decodedDeploymentId),
        eq(
          fxControlIndexDefinitions.indexDefinitionId,
          decodedDefinitionId,
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStoredDefinition(row);
}

export async function listAppIndexDefinitionsForLogicalIndex(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalIndexId: CatalogIndexId,
): Promise<ReadonlyArray<AppIndexDefinitionRecord>> {
  const decodedDeploymentId = decodeDeploymentId(deploymentId);
  const decodedLogicalIndexId = decodeLogicalIndexIdInput(logicalIndexId);
  const rows = await db
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, decodedDeploymentId),
        eq(fxControlIndexDefinitions.accessKind, "developer"),
        eq(
          fxControlIndexDefinitions.accessIdentityId,
          decodedLogicalIndexId,
        ),
        eq(
          fxControlIndexDefinitions.logicalIndexId,
          decodedLogicalIndexId,
        ),
      ),
    )
    .orderBy(fxControlIndexDefinitions.indexDefinitionId);
  return Object.freeze(await Promise.all(rows.map(decodeStoredDefinition)));
}

export async function getAppSchemaVersionIndexBinding(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  logicalIndexId: CatalogIndexId,
): Promise<AppSchemaVersionIndexBindingRecord | null> {
  const decodedDeploymentId = decodeDeploymentId(deploymentId);
  const decodedSchemaVersionId = decodeSchemaVersionIdInput(schemaVersionId);
  const decodedLogicalIndexId = decodeLogicalIndexIdInput(logicalIndexId);
  const rows = await db
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(
      and(
        eq(
          fxControlSchemaVersionIndexBindings.deploymentId,
          decodedDeploymentId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.schemaVersionId,
          decodedSchemaVersionId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.logicalIndexId,
          decodedLogicalIndexId,
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStoredBinding(row);
}

export async function listAppSchemaVersionIndexBindings(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<ReadonlyArray<AppSchemaVersionIndexBindingRecord>> {
  const decodedDeploymentId = decodeDeploymentId(deploymentId);
  const decodedSchemaVersionId = decodeSchemaVersionIdInput(schemaVersionId);
  const rows = await db
    .select()
    .from(fxControlSchemaVersionIndexBindings)
    .where(
      and(
        eq(
          fxControlSchemaVersionIndexBindings.deploymentId,
          decodedDeploymentId,
        ),
        eq(
          fxControlSchemaVersionIndexBindings.schemaVersionId,
          decodedSchemaVersionId,
        ),
      ),
    )
    .orderBy(fxControlSchemaVersionIndexBindings.logicalIndexId);
  return Object.freeze(rows.map(decodeStoredBinding));
}

async function verifyParents(
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Promise<void> {
  const schemaRows = await tx
    .select({ schemaVersionId: fxControlSchemaVersions.schemaVersionId })
    .from(fxControlSchemaVersions)
    .where(
      and(
        eq(fxControlSchemaVersions.deploymentId, state.deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, state.schemaVersionId),
      ),
    )
    .limit(1);
  if (schemaRows[0] === undefined) {
    throw new AppIndexDefinitionParentError(
      state.deploymentId,
      state.schemaVersionId,
      state.logicalIndexId,
      { reason: "schemaVersionNotFound" },
    );
  }

  const logicalRows = await tx
    .select({ tableId: fxControlIndexes.tableId })
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, state.deploymentId),
        eq(fxControlIndexes.logicalIndexId, state.logicalIndexId),
      ),
    )
    .limit(1);
  const logicalRow = logicalRows[0];
  if (logicalRow === undefined) {
    throw new AppIndexDefinitionParentError(
      state.deploymentId,
      state.schemaVersionId,
      state.logicalIndexId,
      { reason: "logicalIndexNotFound" },
    );
  }
  const currentTableId = decodeStoredTableId(
    state.deploymentId,
    logicalRow.tableId,
  );
  if (currentTableId !== state.tableId) {
    throw new AppIndexDefinitionParentError(
      state.deploymentId,
      state.schemaVersionId,
      state.logicalIndexId,
      {
        reason: "logicalIndexTableMismatch",
        requestedTableId: state.tableId,
        currentTableId,
      },
    );
  }
}

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

async function findExistingDefinition<
  Kind extends AppPhysicalIndexAccessKindV1,
>(
  tx: StableTableCatalogTransaction,
  state: PreparedPhysicalDefinitionState<Kind>,
): Promise<AppIndexDefinitionRecordForAccessKindV1<Kind> | null> {
  const existingRows = await selectExistingDefinitionRows(tx, state);
  const existingRow = existingRows[0];
  if (existingRow === undefined) return null;
  return decodeStoredDefinitionAgainstPrepared(existingRow, state);
}

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
  const rows = yield* readCreationTimeDefinitionRowsEffect(
    "findExistingDefinition",
    query,
  );
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(decodeCreationTimeDefinitionResult(() =>
      decodeStoredDefinitionAgainstPrepared(row, state)
    ));
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
  const highWaterRows = yield* readCreationTimeDefinitionRowsEffect(
    "readDefinitionHighWater",
    highWaterQuery,
  );
  const highWaterValue = highWaterRows[0]?.indexDefinitionId;
  const currentHighWater = highWaterValue === undefined
    ? null
    : yield* Effect.fromResult(
      decodeCreationTimeDefinitionAllocationResult(() =>
        decodeStoredDefinitionId(state.deploymentId, highWaterValue)
      ),
    );
  const indexDefinitionId = yield* Effect.fromResult(
    decodeCreationTimeDefinitionAllocationResult(() =>
      nextDefinitionId(state.deploymentId, currentHighWater)
    ),
  );
  const insertQuery = insertDefinitionRows(tx, state, indexDefinitionId);
  const rows = yield* readCreationTimeDefinitionRowsEffect(
    "insertDefinition",
    insertQuery,
  );
  const row = rows[0];
  if (row === undefined) {
    return yield* Effect.fail(new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "definition insert returned no row",
    ));
  }
  const definition = yield* Effect.fromResult(
    decodeCreationTimeDefinitionResult(() =>
      decodeStoredDefinitionAgainstPrepared(row, state)
    ),
  );
  return Object.freeze({ status: "created", definition });
});

const readCreationTimeDefinitionRowsEffect = Effect.fn(<Row>(
  operation: AppCreationTimeIndexDefinitionPersistenceError["operation"],
  query: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  AppCreationTimeIndexDefinitionPersistenceError
> => Effect.uninterruptible(Effect.tryPromise({
    try: () => query,
    catch: (cause) =>
      new AppCreationTimeIndexDefinitionPersistenceError(operation, cause),
  })));

type CreationTimeDefinitionDecodeFailure =
  | AppIndexDefinitionCatalogCorruptionError
  | AppCreationTimeIndexDefinitionChecksumCollisionError;

function decodeCreationTimeDefinitionResult<Value>(
  evaluate: () => Value,
): Result.Result<Value, CreationTimeDefinitionDecodeFailure> {
  return Result.try({
    try: evaluate,
    catch: (cause) => {
      if (
        cause instanceof AppIndexDefinitionCatalogCorruptionError ||
        cause instanceof AppCreationTimeIndexDefinitionChecksumCollisionError
      ) {
        return cause;
      }
      throw cause;
    },
  });
}

function decodeCreationTimeDefinitionAllocationResult<Value>(
  evaluate: () => Value,
): Result.Result<
  Value,
  AppIndexDefinitionCatalogCorruptionError | AppIndexDefinitionIdExhaustedError
> {
  return Result.try({
    try: evaluate,
    catch: (cause) => {
      if (
        cause instanceof AppIndexDefinitionCatalogCorruptionError ||
        cause instanceof AppIndexDefinitionIdExhaustedError
      ) {
        return cause;
      }
      throw cause;
    },
  });
}

async function insertDefinition<
  Kind extends AppPhysicalIndexAccessKindV1,
>(
  tx: StableTableCatalogTransaction,
  state: PreparedPhysicalDefinitionState<Kind>,
): Promise<{
  readonly status: "created";
  readonly definition: AppIndexDefinitionRecordForAccessKindV1<Kind>;
}> {
  const currentHighWater = await readDefinitionHighWater(
    tx,
    state.deploymentId,
  );
  const indexDefinitionId = nextDefinitionId(
    state.deploymentId,
    currentHighWater,
  );
  const rows = await insertDefinitionRows(tx, state, indexDefinitionId);
  const row = rows[0];
  if (row === undefined) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "definition insert returned no row",
    );
  }
  return Object.freeze({
    status: "created",
    definition: decodeStoredDefinitionAgainstPrepared(row, state),
  });
}

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

async function readExistingBinding(
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Promise<AppSchemaVersionIndexBindingRecord | null> {
  const existingRows = await tx
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
  const existingRow = existingRows[0];
  return existingRow === undefined ? null : decodeStoredBinding(existingRow);
}

async function insertBinding(
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
  indexDefinitionId: CatalogIndexDefinitionId,
): Promise<AppSchemaVersionIndexBindingRecord> {
  const rows = await tx
    .insert(fxControlSchemaVersionIndexBindings)
    .values({
      deploymentId: state.deploymentId,
      schemaVersionId: state.schemaVersionId,
      logicalIndexId: state.logicalIndexId,
      indexDefinitionId,
      requiredForActivation: true,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "schema binding insert returned no row",
    );
  }
  return decodeStoredBinding(row);
}

async function readDefinitionHighWater(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<CatalogIndexDefinitionId | null> {
  const rows = await selectDefinitionHighWaterRows(db, deploymentId);
  const value = rows[0]?.indexDefinitionId;
  return value === undefined
    ? null
    : decodeStoredDefinitionId(deploymentId, value);
}

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

function nextDefinitionId(
  deploymentId: string,
  currentHighWater: CatalogIndexDefinitionId | null,
): CatalogIndexDefinitionId {
  if (currentHighWater === MAX_CATALOG_INDEX_DEFINITION_ID) {
    throw new AppIndexDefinitionIdExhaustedError(deploymentId);
  }
  return decodeStoredDefinitionId(
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
function decodeStoredDefinitionAgainstPrepared<
  Kind extends AppPhysicalIndexAccessKindV1,
>(
  row: typeof fxControlIndexDefinitions.$inferSelect,
  state: PreparedPhysicalDefinitionState<Kind>,
): AppIndexDefinitionRecordForAccessKindV1<Kind> {
  const deploymentId = decodeStoredDeploymentId(row.deploymentId);
  if (deploymentId !== state.deploymentId) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      state.deploymentId,
      "definition query returned another deployment",
    );
  }
  const indexDefinitionId = decodeStoredDefinitionId(
    deploymentId,
    row.indexDefinitionId,
  );
  const tableId = decodeStoredTableId(deploymentId, row.tableId);
  const access = decodeStoredAccess(
    deploymentId,
    row.accessKind,
    row.accessIdentityId,
    tableId,
    row.logicalIndexId,
  );
  if (!appPhysicalIndexAccessIdentitiesEqual(access, state.access)) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} does not match its prepared access owner`,
    );
  }

  let physicalSpecCodecVersion: AppIndexPhysicalSpecCodecVersion;
  let physicalSpecBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  let physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1;
  let storedPhysicalSpec: AppOrderedIndexPhysicalSpecV1;
  try {
    physicalSpecCodecVersion = decodeAppIndexPhysicalSpecCodecVersion(
      row.physicalSpecCodecVersion,
    );
    physicalSpecBytesHex =
      canonicalAppIndexPhysicalSpecBytesHexV1FromBytes(
        row.physicalSpecBytes,
      );
    physicalSpecSha256Hex = appIndexPhysicalSpecSha256HexV1FromBytes(
      row.physicalSpecSha256,
    );
    storedPhysicalSpec = decodeAppOrderedIndexPhysicalSpecV1(
      row.physicalSpecJson,
    );
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} has invalid prepared evidence`,
      { cause },
    );
  }
  if (physicalSpecCodecVersion !== state.canonical.codecVersion) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} physical-spec codec changed after preparation`,
    );
  }
  if (physicalSpecSha256Hex !== state.canonical.sha256Hex) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} digest changed after preparation`,
    );
  }
  if (physicalSpecBytesHex !== state.canonical.canonicalBytesHex) {
    throw checksumCollisionError(
      state.deploymentId,
      state.access,
      indexDefinitionId,
    );
  }
  if (!physicalSpecsEqual(storedPhysicalSpec, state.canonical.physicalSpec)) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} JSON changed after canonical preparation`,
    );
  }
  const createdAt = decodeStoredTimestamp(
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
  } satisfies AppIndexDefinitionRecordForAccessKindV1<Kind>);
}

async function decodeStoredDefinition(
  row: typeof fxControlIndexDefinitions.$inferSelect,
): Promise<AppIndexDefinitionRecord> {
  const deploymentId = decodeStoredDeploymentId(row.deploymentId);
  const indexDefinitionId = decodeStoredDefinitionId(
    deploymentId,
    row.indexDefinitionId,
  );
  const tableId = decodeStoredTableId(deploymentId, row.tableId);
  const access = decodeStoredAccess(
    deploymentId,
    row.accessKind,
    row.accessIdentityId,
    tableId,
    row.logicalIndexId,
  );
  let physicalSpecCodecVersion: AppIndexPhysicalSpecCodecVersion;
  let physicalSpecBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  let physicalSpecSha256Hex: AppIndexPhysicalSpecSha256HexV1;
  let canonical: CanonicalAppIndexPhysicalSpecV1;
  try {
    physicalSpecCodecVersion = decodeAppIndexPhysicalSpecCodecVersion(
      row.physicalSpecCodecVersion,
    );
    physicalSpecBytesHex =
      canonicalAppIndexPhysicalSpecBytesHexV1FromBytes(
        row.physicalSpecBytes,
      );
    physicalSpecSha256Hex = appIndexPhysicalSpecSha256HexV1FromBytes(
      row.physicalSpecSha256,
    );
    canonical = await canonicalizeAppIndexPhysicalSpecV1(row.physicalSpecJson);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} has an invalid physical specification`,
      { cause },
    );
  }
  if (canonical.physicalSpec.accessPath !== access.kind) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} physical access path does not match its owner`,
    );
  }
  if (physicalSpecCodecVersion !== canonical.codecVersion) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} physical-spec codec does not match canonical bytes`,
    );
  }
  if (physicalSpecBytesHex !== canonical.canonicalBytesHex) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} canonical bytes do not match physical-spec JSON`,
    );
  }
  if (physicalSpecSha256Hex !== canonical.sha256Hex) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} SHA-256 does not match canonical bytes`,
    );
  }
  const createdAt = decodeStoredTimestamp(
    deploymentId,
    indexDefinitionId,
    row.createdAt,
  );

  return Object.freeze({
    deploymentId,
    indexDefinitionId,
    access,
    physicalSpecCodecVersion,
    physicalSpec: canonical.physicalSpec,
    physicalSpecBytesHex,
    physicalSpecSha256Hex,
    createdAt,
  } satisfies AppIndexDefinitionRecord);
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
): Error {
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

function decodeStoredBinding(
  row: typeof fxControlSchemaVersionIndexBindings.$inferSelect,
): AppSchemaVersionIndexBindingRecord {
  const deploymentId = decodeStoredDeploymentId(row.deploymentId);
  let schemaVersionId: CatalogSchemaVersionId;
  try {
    schemaVersionId = decodeCatalogSchemaVersionId(row.schemaVersionId);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      "schema binding has an invalid schema version ID",
      { cause },
    );
  }
  const logicalIndexId = decodeStoredLogicalIndexId(
    deploymentId,
    row.logicalIndexId,
  );
  const indexDefinitionId = decodeStoredDefinitionId(
    deploymentId,
    row.indexDefinitionId,
  );
  if (row.requiredForActivation !== true) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `schema binding ${schemaVersionId}/${logicalIndexId} has an invalid activation requirement`,
    );
  }
  const createdAt = decodeStoredTimestamp(
    deploymentId,
    indexDefinitionId,
    row.createdAt,
  );
  return Object.freeze({
    deploymentId,
    schemaVersionId,
    logicalIndexId,
    indexDefinitionId,
    requiredForActivation: true,
    createdAt,
  } satisfies AppSchemaVersionIndexBindingRecord);
}

function decodeStoredAccess(
  deploymentId: string,
  accessKind: unknown,
  accessIdentityId: unknown,
  tableId: CatalogTableId,
  logicalIndexId: unknown,
): AppPhysicalIndexAccessIdentityV1 {
  try {
    if (accessKind === "developer") {
      const decodedLogicalIndexId = decodeCatalogIndexId(logicalIndexId);
      if (accessIdentityId !== decodedLogicalIndexId) {
        throw new Error("developer access identity does not match logical ID");
      }
      return decodeAppPhysicalIndexAccessIdentityV1({
        kind: accessKind,
        tableId,
        logicalIndexId: decodedLogicalIndexId,
      });
    }
    if (accessKind === "by_creation_time") {
      if (logicalIndexId !== null || accessIdentityId !== tableId) {
        throw new Error("creation-time access identity does not match table ID");
      }
      return decodeAppPhysicalIndexAccessIdentityV1({
        kind: accessKind,
        tableId,
      });
    }
    throw new Error(`unsupported access kind: ${String(accessKind)}`);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      "definition has an invalid access owner",
      { cause },
    );
  }
}

function decodeDeploymentId(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new InvalidAppIndexDefinitionBindingInputError({
      reason: "invalidDeploymentId",
    });
  }
  return value;
}

function decodeSchemaVersionIdInput(value: unknown): CatalogSchemaVersionId {
  try {
    return decodeCatalogSchemaVersionId(value);
  } catch (cause) {
    throw new InvalidAppIndexDefinitionBindingInputError(
      { reason: "invalidSchemaVersionId" },
      { cause },
    );
  }
}

function decodeTableIdInput(value: unknown): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch (cause) {
    throw new InvalidAppIndexDefinitionBindingInputError(
      { reason: "invalidTableId" },
      { cause },
    );
  }
}

function decodeLogicalIndexIdInput(value: unknown): CatalogIndexId {
  try {
    return decodeCatalogIndexId(value);
  } catch (cause) {
    throw new InvalidAppIndexDefinitionBindingInputError(
      { reason: "invalidLogicalIndexId" },
      { cause },
    );
  }
}

function decodeDefinitionIdInput(value: unknown): CatalogIndexDefinitionId {
  try {
    return decodeCatalogIndexDefinitionId(value);
  } catch (cause) {
    throw new InvalidAppIndexDefinitionBindingInputError(
      { reason: "invalidIndexDefinitionId" },
      { cause },
    );
  }
}

function decodeLogicalSpecInput(
  value: unknown,
): SchemaManifestAppDeveloperOrderedIndexSpecV1 {
  try {
    return decodeSchemaManifestAppDeveloperOrderedIndexSpecV1(value);
  } catch (cause) {
    throw new InvalidAppIndexDefinitionBindingInputError(
      { reason: "invalidLogicalSpec" },
      { cause },
    );
  }
}

function decodeStoredDeploymentId(value: unknown): string {
  if (!isNonBlankString(value)) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      typeof value === "string" ? value : "<invalid>",
      "definition deployment ID is invalid",
    );
  }
  return value;
}

function decodeStoredDefinitionId(
  deploymentId: string,
  value: unknown,
): CatalogIndexDefinitionId {
  try {
    return decodeCatalogIndexDefinitionId(value);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `invalid physical definition ID: ${String(value)}`,
      { cause },
    );
  }
}

function decodeStoredLogicalIndexId(
  deploymentId: string,
  value: unknown,
): CatalogIndexId {
  try {
    return decodeCatalogIndexId(value);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `invalid logical index ID: ${String(value)}`,
      { cause },
    );
  }
}

function decodeStoredTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch (cause) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
      { cause },
    );
  }
}

function decodeStoredTimestamp(
  deploymentId: string,
  indexDefinitionId: CatalogIndexDefinitionId,
  value: unknown,
): Date {
  const timestamp = copyFiniteDate(value);
  if (timestamp === undefined) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} has an invalid created timestamp`,
    );
  }
  return timestamp;
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
