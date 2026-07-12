import { and, desc, eq } from "drizzle-orm";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
  decodeCatalogTableId,
  MAX_CATALOG_INDEX_DEFINITION_ID,
  type CatalogIndexDefinitionId,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1FromBytes,
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
  canonicalAppIndexPhysicalSpecBytesHexV1FromBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  decodeAppIndexPhysicalSpecCodecVersion,
  decodeAppPhysicalIndexAccessIdentityV1,
  type AppIndexPhysicalSpecCodecVersion,
  type AppIndexPhysicalSpecSha256HexV1,
  type AppPhysicalIndexAccessIdentityV1,
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
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
import { lockSchemaManifestBindingDeployment } from "./schemaManifestTableBindings";
import {
  fxControlIndexDefinitions,
  fxControlIndexes,
  fxControlSchemaVersionIndexBindings,
  fxControlSchemaVersions,
} from "./schema";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

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
  readonly definition: AppIndexDefinitionRecord;
  readonly binding: AppSchemaVersionIndexBindingRecord;
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
  constructor(readonly deploymentId: string) {
    super(
      `Physical index definition identity space is exhausted for deployment: ${deploymentId}`,
    );
    this.name = "AppIndexDefinitionIdExhaustedError";
  }
}

export class AppIndexDefinitionCatalogCorruptionError extends Error {
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

interface PreparedDefinitionBindingState {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly canonical: CanonicalAppIndexPhysicalSpecV1;
}

const preparedDefinitionBindingStates = new WeakMap<
  PreparedAppDeveloperIndexDefinitionBindingV1,
  PreparedDefinitionBindingState
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
  const prepared = Object.freeze({
    deploymentId,
    schemaVersionId,
    tableId,
    logicalIndexId,
    [preparedDefinitionBindingBrand]: true,
  } satisfies PreparedAppDeveloperIndexDefinitionBindingV1);
  preparedDefinitionBindingStates.set(prepared, {
    deploymentId,
    schemaVersionId,
    tableId,
    logicalIndexId,
    canonical,
  });
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
      readonly definition: AppIndexDefinitionRecord;
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

async function findExistingDefinition(
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Promise<AppIndexDefinitionRecord | null> {
  const existingRows = await tx
    .select()
    .from(fxControlIndexDefinitions)
    .where(
      and(
        eq(fxControlIndexDefinitions.deploymentId, state.deploymentId),
        eq(fxControlIndexDefinitions.accessKind, "developer"),
        eq(
          fxControlIndexDefinitions.accessIdentityId,
          state.logicalIndexId,
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
  const existingRow = existingRows[0];
  if (existingRow === undefined) return null;
  const definition = decodeStoredDefinitionAgainstPrepared(existingRow, state);
  if (
    definition.physicalSpecBytesHex !== state.canonical.canonicalBytesHex
  ) {
    throw new AppIndexDefinitionChecksumCollisionError(
      state.deploymentId,
      state.logicalIndexId,
      definition.indexDefinitionId,
    );
  }
  return definition;
}

async function insertDefinition(
  tx: StableTableCatalogTransaction,
  state: PreparedDefinitionBindingState,
): Promise<{
  readonly status: "created";
  readonly definition: AppIndexDefinitionRecord;
}> {
  const currentHighWater = await readDefinitionHighWater(
    tx,
    state.deploymentId,
  );
  const indexDefinitionId = nextDefinitionId(
    state.deploymentId,
    currentHighWater,
  );
  const rows = await tx
    .insert(fxControlIndexDefinitions)
    .values({
      deploymentId: state.deploymentId,
      indexDefinitionId,
      accessKind: "developer",
      accessIdentityId: state.logicalIndexId,
      tableId: state.tableId,
      logicalIndexId: state.logicalIndexId,
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
  const rows = await db
    .select({
      indexDefinitionId: fxControlIndexDefinitions.indexDefinitionId,
    })
    .from(fxControlIndexDefinitions)
    .where(eq(fxControlIndexDefinitions.deploymentId, deploymentId))
    .orderBy(desc(fxControlIndexDefinitions.indexDefinitionId))
    .limit(1);
  const value = rows[0]?.indexDefinitionId;
  return value === undefined
    ? null
    : decodeStoredDefinitionId(deploymentId, value);
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
function decodeStoredDefinitionAgainstPrepared(
  row: typeof fxControlIndexDefinitions.$inferSelect,
  state: PreparedDefinitionBindingState,
): AppIndexDefinitionRecord {
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
  if (
    access.kind !== "developer" ||
    access.tableId !== state.tableId ||
    access.logicalIndexId !== state.logicalIndexId
  ) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} does not match its prepared logical owner`,
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
    throw new AppIndexDefinitionChecksumCollisionError(
      deploymentId,
      state.logicalIndexId,
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
    access,
    physicalSpecCodecVersion,
    physicalSpec: state.canonical.physicalSpec,
    physicalSpecBytesHex,
    physicalSpecSha256Hex,
    createdAt,
  } satisfies AppIndexDefinitionRecord);
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
  if (typeof value !== "string" || value.trim().length === 0) {
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
  if (typeof value !== "string" || value.trim().length === 0) {
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
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AppIndexDefinitionCatalogCorruptionError(
      deploymentId,
      `definition ${indexDefinitionId} has an invalid created timestamp`,
    );
  }
  return new Date(value.getTime());
}

function hasExactOwnDataKeys(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): boolean {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length) return false;
  const expected = new Set(expectedKeys);
  for (const key of keys) {
    if (typeof key !== "string" || !expected.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      return false;
    }
  }
  return true;
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
