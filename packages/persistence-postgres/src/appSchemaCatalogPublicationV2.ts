import {
  compileAppSchemaCatalogRequirementsV1,
  type CompiledAppSchemaCatalogRequirementsV1,
} from "flarex-protocol/app-schema-catalog";
import {
  decodeCatalogSchemaVersion,
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppIndexDeclarationsV1,
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestJson,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  enforceAppSchemaCatalogPublicationV2CanonicalByteLowerBound,
  enforceAppSchemaCatalogPublicationV2CanonicalByteQuota,
  enforceAppSchemaCatalogPublicationV2DeclarationQuotas,
} from "./appSchemaCatalogPublicationV2Policy";
import {
  prepareSchemaManifestAppSchemaBindingsV1,
  type PreparedSchemaManifestAppSchemaBindingsV1,
  type PrepareSchemaManifestAppSchemaBindingsV1Input,
} from "./schemaManifestAppSchemaBindings";
import {
  getPreparedSchemaVersionArtifactCanonicalByteLength,
  prepareSchemaVersionArtifact,
  type EnsureSchemaVersionArtifactInput,
  type PreparedSchemaVersionArtifact,
} from "./schemaVersionArtifacts";

const PREPARE_INPUT_KEYS = Object.freeze([
  "deploymentId",
  "schemaVersionId",
  "version",
  "tables",
  "indexes",
]);

export interface PrepareAppSchemaCatalogPublicationV2Input
  extends Pick<
      EnsureSchemaVersionArtifactInput,
      "deploymentId" | "schemaVersionId" | "version"
    >,
    Pick<
      PrepareSchemaManifestAppSchemaBindingsV1Input,
      "tables" | "indexes"
    > {
  readonly manifest?: never;
  readonly boundManifest?: never;
  readonly compiledRequirements?: never;
  readonly bindingPlan?: never;
  readonly preparedArtifact?: never;
  readonly indexDefinitions?: never;
  readonly indexDefinitionIds?: never;
  readonly manifestCodecVersion?: never;
  readonly manifestJson?: never;
  readonly manifestBytes?: never;
  readonly manifestSha256?: never;
  readonly requiredForActivation?: never;
  readonly scopeId?: never;
  readonly storageGeneration?: never;
  readonly storageGenerationFence?: never;
  readonly epoch?: never;
  readonly lifecycle?: never;
  readonly buildState?: never;
  readonly readiness?: never;
  readonly activeSchemaVersionId?: never;
}

export type InvalidAppSchemaCatalogPublicationV2InputIssue =
  | { readonly reason: "invalidInputShape" }
  | {
      readonly reason: "invalidField";
      readonly field:
        | "deploymentId"
        | "schemaVersionId"
        | "version"
        | "tables"
        | "indexes";
    };

export class InvalidAppSchemaCatalogPublicationV2InputError extends Error {
  constructor(
    readonly issue: InvalidAppSchemaCatalogPublicationV2InputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppSchemaCatalogPublicationV2InputError";
  }
}

const publicationSourceBrand: unique symbol = Symbol(
  "FlarexDB/AppSchemaCatalogPublicationV2Source",
);

/** Opaque, process-local snapshot reused across every fresh D2d attempt. */
export interface AppSchemaCatalogPublicationV2Source {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [publicationSourceBrand]: true;
}

export class InvalidAppSchemaCatalogPublicationV2SourceError extends Error {
  constructor() {
    super(
      "App-schema catalog V2 source was not snapshotted by this repository instance.",
    );
    this.name = "InvalidAppSchemaCatalogPublicationV2SourceError";
  }
}

const preparedPublicationBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppSchemaCatalogPublicationV2",
);

/**
 * Process-local identity for one coherently prepared full app-schema attempt.
 *
 * WeakMap membership, not the visible symbol, authenticates this token. It is
 * neither a durable/serializable receipt nor a cryptographic capability.
 */
export interface PreparedAppSchemaCatalogPublicationV2 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [preparedPublicationBrand]: true;
}

export class InvalidPreparedAppSchemaCatalogPublicationV2Error extends Error {
  constructor() {
    super(
      "App-schema catalog publication was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedAppSchemaCatalogPublicationV2Error";
  }
}

interface ValidatedPrepareAppSchemaCatalogPublicationV2Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
}

const publicationSourceStates = new WeakMap<
  AppSchemaCatalogPublicationV2Source,
  ValidatedPrepareAppSchemaCatalogPublicationV2Input
>();

interface PreparedAppSchemaCatalogPublicationV2State {
  readonly logicalBindings: PreparedSchemaManifestAppSchemaBindingsV1;
  readonly requirements: CompiledAppSchemaCatalogRequirementsV1;
  readonly artifact: PreparedSchemaVersionArtifact;
}

const preparedPublicationStates = new WeakMap<
  PreparedAppSchemaCatalogPublicationV2,
  PreparedAppSchemaCatalogPublicationV2State
>();

/**
 * Prepare one coherent full-envelope publication attempt without writing SQL.
 *
 * Stable binding observations may become stale after this returns. A later
 * transaction must revalidate them and discard this entire token on the typed
 * stale outcome; D2a performs no retries, locks, or transactions itself.
 */
export async function prepareAppSchemaCatalogPublicationV2(
  db: FlarexMetadataDatabase,
  input: PrepareAppSchemaCatalogPublicationV2Input,
): Promise<PreparedAppSchemaCatalogPublicationV2> {
  return prepareAppSchemaCatalogPublicationV2FromSource(
    db,
    snapshotAppSchemaCatalogPublicationV2Input(input),
  );
}

/** Snapshot and authenticate the public request exactly once before retries. */
export function snapshotAppSchemaCatalogPublicationV2Input(
  input: PrepareAppSchemaCatalogPublicationV2Input,
): AppSchemaCatalogPublicationV2Source {
  const validated = validateAndSnapshotInput(input);
  const source = Object.freeze({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    [publicationSourceBrand]: true,
  } satisfies AppSchemaCatalogPublicationV2Source);
  publicationSourceStates.set(source, validated);
  return source;
}

/** Rebuild every database-dependent and canonical fact from one frozen source. */
export async function prepareAppSchemaCatalogPublicationV2FromSource(
  db: FlarexMetadataDatabase,
  source: AppSchemaCatalogPublicationV2Source,
): Promise<PreparedAppSchemaCatalogPublicationV2> {
  const validated = publicationSourceStates.get(source);
  if (validated === undefined) {
    throw new InvalidAppSchemaCatalogPublicationV2SourceError();
  }
  const logicalBindings = await prepareSchemaManifestAppSchemaBindingsV1(
    db,
    {
      deploymentId: validated.deploymentId,
      tables: validated.tables,
      indexes: validated.indexes,
    },
  );
  const requirements = await compileAppSchemaCatalogRequirementsV1(
    logicalBindings.manifest,
  );
  const artifact = await prepareSchemaVersionArtifact({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    manifest: decodeSchemaManifestJson(logicalBindings.manifest),
  });
  enforceAppSchemaCatalogPublicationV2CanonicalByteQuota(
    getPreparedSchemaVersionArtifactCanonicalByteLength(artifact),
  );
  const prepared = Object.freeze({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    [preparedPublicationBrand]: true,
  } satisfies PreparedAppSchemaCatalogPublicationV2);
  preparedPublicationStates.set(prepared, Object.freeze({
    logicalBindings,
    requirements,
    artifact,
  } satisfies PreparedAppSchemaCatalogPublicationV2State));
  return prepared;
}

/** Package-internal authenticated composition seam for D2b/D2c. */
export function getPreparedAppSchemaCatalogPublicationV2State(
  prepared: PreparedAppSchemaCatalogPublicationV2,
): PreparedAppSchemaCatalogPublicationV2State {
  const state = preparedPublicationStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedAppSchemaCatalogPublicationV2Error();
  }
  return state;
}

function validateAndSnapshotInput(
  input: PrepareAppSchemaCatalogPublicationV2Input,
): ValidatedPrepareAppSchemaCatalogPublicationV2Input {
  if (!hasExactOwnDataKeys(input, PREPARE_INPUT_KEYS)) {
    throw new InvalidAppSchemaCatalogPublicationV2InputError({
      reason: "invalidInputShape",
    });
  }
  enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
    input.tables,
    input.indexes,
  );
  const deploymentId = input.deploymentId;
  if (typeof deploymentId !== "string" || deploymentId.trim().length === 0) {
    throw invalidField("deploymentId");
  }

  let schemaVersionId: CatalogSchemaVersionId;
  try {
    schemaVersionId = decodeCatalogSchemaVersionId(input.schemaVersionId);
  } catch (cause) {
    throw invalidField("schemaVersionId", cause);
  }
  let version: CatalogSchemaVersion;
  try {
    version = decodeCatalogSchemaVersion(input.version);
  } catch (cause) {
    throw invalidField("version", cause);
  }
  let decodedTables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  try {
    decodedTables = decodeSchemaManifestAppTableDeclarationsV1(input.tables);
  } catch (cause) {
    throw invalidField("tables", cause);
  }
  let decodedIndexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
  try {
    decodedIndexes = decodeSchemaManifestAppIndexDeclarationsV1(input.indexes);
  } catch (cause) {
    throw invalidField("indexes", cause);
  }
  enforceAppSchemaCatalogPublicationV2CanonicalByteLowerBound(
    decodedTables,
    decodedIndexes,
  );

  const tables = structuredClone(decodedTables);
  const indexes = structuredClone(decodedIndexes);
  deepFreeze(tables);
  deepFreeze(indexes);

  return Object.freeze({
    deploymentId,
    schemaVersionId,
    version,
    tables,
    indexes,
  } satisfies ValidatedPrepareAppSchemaCatalogPublicationV2Input);
}

function invalidField(
  field: Extract<
    InvalidAppSchemaCatalogPublicationV2InputIssue,
    { readonly reason: "invalidField" }
  >["field"],
  cause?: unknown,
): InvalidAppSchemaCatalogPublicationV2InputError {
  return new InvalidAppSchemaCatalogPublicationV2InputError(
    { reason: "invalidField", field },
    cause === undefined ? undefined : { cause },
  );
}

function hasExactOwnDataKeys(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
): value is Record<string, unknown> {
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

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) deepFreeze(child);
  Object.freeze(value);
}

function invalidInputMessage(
  issue: InvalidAppSchemaCatalogPublicationV2InputIssue,
): string {
  switch (issue.reason) {
    case "invalidInputShape":
      return "App-schema catalog publication input must contain only deploymentId, schemaVersionId, version, tables, and indexes.";
    case "invalidField":
      return `App-schema catalog publication ${issue.field} is invalid.`;
  }
}
