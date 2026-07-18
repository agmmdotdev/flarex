import { isNonBlankString } from "@flarex/utils/strings";
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
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  enforceAppSchemaPublicationV1CanonicalByteLowerBound,
  enforceAppSchemaPublicationV1CanonicalByteQuota,
  enforceAppSchemaPublicationV1DeclarationQuotas,
} from "./appSchemaPublicationPolicy";
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

export interface PrepareAppSchemaPublicationV1Input
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

export type InvalidAppSchemaPublicationV1InputIssue =
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

export class InvalidAppSchemaPublicationV1InputError extends Error {
  constructor(
    readonly issue: InvalidAppSchemaPublicationV1InputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppSchemaPublicationV1InputError";
  }
}

const publicationSourceBrand: unique symbol = Symbol(
  "FlarexDB/AppSchemaPublicationV1Source",
);

/** Opaque, process-local snapshot reused across every fresh D2d attempt. */
export interface AppSchemaPublicationV1Source {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [publicationSourceBrand]: true;
}

export class InvalidAppSchemaPublicationV1SourceError extends Error {
  constructor() {
    super(
      "App-schema V1 publication source was not snapshotted by this repository instance.",
    );
    this.name = "InvalidAppSchemaPublicationV1SourceError";
  }
}

const preparedPublicationBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppSchemaPublicationV1",
);

/**
 * Process-local identity for one coherently prepared full app-schema attempt.
 *
 * WeakMap membership, not the visible symbol, authenticates this token. It is
 * neither a durable/serializable receipt nor a cryptographic capability.
 */
export interface PreparedAppSchemaPublicationV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [preparedPublicationBrand]: true;
}

export class InvalidPreparedAppSchemaPublicationV1Error extends Error {
  constructor() {
    super(
      "App-schema catalog publication was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedAppSchemaPublicationV1Error";
  }
}

interface ValidatedPrepareAppSchemaPublicationV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
}

const publicationSourceStates = new WeakMap<
  AppSchemaPublicationV1Source,
  ValidatedPrepareAppSchemaPublicationV1Input
>();

interface PreparedAppSchemaPublicationV1State {
  readonly logicalBindings: PreparedSchemaManifestAppSchemaBindingsV1;
  readonly requirements: CompiledAppSchemaCatalogRequirementsV1;
  readonly artifact: PreparedSchemaVersionArtifact;
}

const preparedPublicationStates = new WeakMap<
  PreparedAppSchemaPublicationV1,
  PreparedAppSchemaPublicationV1State
>();

/**
 * Prepare one coherent full-envelope publication attempt without writing SQL.
 *
 * Stable binding observations may become stale after this returns. A later
 * transaction must revalidate them and discard this entire token on the typed
 * stale outcome; D2a performs no retries, locks, or transactions itself.
 */
export async function prepareAppSchemaPublicationV1(
  db: FlarexMetadataDatabase,
  input: PrepareAppSchemaPublicationV1Input,
): Promise<PreparedAppSchemaPublicationV1> {
  return prepareAppSchemaPublicationV1FromSource(
    db,
    snapshotAppSchemaPublicationV1Input(input),
  );
}

/** Snapshot and authenticate the public request exactly once before retries. */
export function snapshotAppSchemaPublicationV1Input(
  input: PrepareAppSchemaPublicationV1Input,
): AppSchemaPublicationV1Source {
  const validated = validateAndSnapshotInput(input);
  const source = Object.freeze({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    [publicationSourceBrand]: true,
  } satisfies AppSchemaPublicationV1Source);
  publicationSourceStates.set(source, validated);
  return source;
}

/** Rebuild every database-dependent and canonical fact from one frozen source. */
export async function prepareAppSchemaPublicationV1FromSource(
  db: FlarexMetadataDatabase,
  source: AppSchemaPublicationV1Source,
): Promise<PreparedAppSchemaPublicationV1> {
  const validated = publicationSourceStates.get(source);
  if (validated === undefined) {
    throw new InvalidAppSchemaPublicationV1SourceError();
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
  enforceAppSchemaPublicationV1CanonicalByteQuota(
    getPreparedSchemaVersionArtifactCanonicalByteLength(artifact),
  );
  const prepared = Object.freeze({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    [preparedPublicationBrand]: true,
  } satisfies PreparedAppSchemaPublicationV1);
  preparedPublicationStates.set(prepared, Object.freeze({
    logicalBindings,
    requirements,
    artifact,
  } satisfies PreparedAppSchemaPublicationV1State));
  return prepared;
}

/** Package-internal authenticated composition seam for D2b/D2c. */
export function getPreparedAppSchemaPublicationV1State(
  prepared: PreparedAppSchemaPublicationV1,
): PreparedAppSchemaPublicationV1State {
  const state = preparedPublicationStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedAppSchemaPublicationV1Error();
  }
  return state;
}

function validateAndSnapshotInput(
  input: PrepareAppSchemaPublicationV1Input,
): ValidatedPrepareAppSchemaPublicationV1Input {
  if (!hasExactOwnDataKeys(input, PREPARE_INPUT_KEYS)) {
    throw new InvalidAppSchemaPublicationV1InputError({
      reason: "invalidInputShape",
    });
  }
  enforceAppSchemaPublicationV1DeclarationQuotas(
    input.tables,
    input.indexes,
  );
  const deploymentId = input.deploymentId;
  if (!isNonBlankString(deploymentId)) {
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
  enforceAppSchemaPublicationV1CanonicalByteLowerBound(
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
  } satisfies ValidatedPrepareAppSchemaPublicationV1Input);
}

function invalidField(
  field: Extract<
    InvalidAppSchemaPublicationV1InputIssue,
    { readonly reason: "invalidField" }
  >["field"],
  cause?: unknown,
): InvalidAppSchemaPublicationV1InputError {
  return new InvalidAppSchemaPublicationV1InputError(
    { reason: "invalidField", field },
    cause === undefined ? undefined : { cause },
  );
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) deepFreeze(child);
  Object.freeze(value);
}

function invalidInputMessage(
  issue: InvalidAppSchemaPublicationV1InputIssue,
): string {
  switch (issue.reason) {
    case "invalidInputShape":
      return "App-schema catalog publication input must contain only deploymentId, schemaVersionId, version, tables, and indexes.";
    case "invalidField":
      return `App-schema catalog publication ${issue.field} is invalid.`;
  }
}
