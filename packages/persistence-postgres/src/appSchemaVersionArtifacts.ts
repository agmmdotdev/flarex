import {
  decodeCatalogSchemaVersion,
  decodeCatalogSchemaVersionId,
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestJson,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  applySchemaManifestAppTableBindingsV1InTransaction,
  prepareSchemaManifestAppTableBindingsV1,
  SchemaManifestTableBindingPlanStaleError,
  type PreparedSchemaManifestAppTableBindingsV1,
  type PrepareSchemaManifestAppTableBindingsV1Input,
  type SchemaManifestTableBindingPlanStale,
} from "./schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  prepareSchemaVersionArtifact,
  type EnsureSchemaVersionArtifactInput,
  type EnsureSchemaVersionArtifactResult,
  type PreparedSchemaVersionArtifact,
  type SchemaVersionArtifactTransaction,
} from "./schemaVersionArtifacts";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

export const MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS = 3;

export interface EnsureAppSchemaVersionArtifactV1Input
  extends Pick<
      EnsureSchemaVersionArtifactInput,
      "deploymentId" | "schemaVersionId" | "version"
    >,
    Pick<PrepareSchemaManifestAppTableBindingsV1Input, "tables"> {
  readonly manifest?: never;
  readonly section?: never;
  readonly manifestCodecVersion?: never;
  readonly manifestJson?: never;
  readonly manifestBytes?: never;
  readonly manifestSha256?: never;
  readonly createdAt?: never;
  readonly bindingPlan?: never;
  readonly preparedArtifact?: never;
}

export type EnsureAppSchemaVersionArtifactV1Result =
  EnsureSchemaVersionArtifactResult;

export type InvalidAppSchemaVersionArtifactV1InputIssue =
  | {
      readonly reason: "invalidField";
      readonly field: "deploymentId" | "schemaVersionId" | "version" | "tables";
    }
  | {
      readonly reason: "unexpectedField";
      readonly field: string;
    };

export class InvalidAppSchemaVersionArtifactV1InputError extends Error {
  constructor(
    readonly issue: InvalidAppSchemaVersionArtifactV1InputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppSchemaVersionArtifactV1InputError";
  }
}

export class AppSchemaVersionArtifactRetryExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
    readonly lastStale: SchemaManifestTableBindingPlanStale,
    options?: ErrorOptions,
  ) {
    super(
      `App schema version artifact publication remained stale after ${attempts} attempts for ${deploymentId}.`,
      options,
    );
    this.name = "AppSchemaVersionArtifactRetryExhaustedError";
  }
}

const preparedAppSchemaVersionArtifactBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppSchemaVersionArtifactV1",
);

export interface PreparedAppSchemaVersionArtifactV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [preparedAppSchemaVersionArtifactBrand]: true;
}

export class InvalidPreparedAppSchemaVersionArtifactV1Error extends Error {
  constructor() {
    super(
      "App schema version artifact was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedAppSchemaVersionArtifactV1Error";
  }
}

export type AppSchemaVersionArtifactV1Transaction =
  StableTableCatalogTransaction & SchemaVersionArtifactTransaction;

export interface AppSchemaVersionArtifactV1Repository {
  readonly db: FlarexMetadataDatabase;
  runTransaction<Result>(
    run: (tx: AppSchemaVersionArtifactV1Transaction) => Promise<Result>,
  ): Promise<Result>;
}

interface ValidatedEnsureAppSchemaVersionArtifactV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
}

interface PreparedAppSchemaVersionArtifactV1State {
  readonly bindings: PreparedSchemaManifestAppTableBindingsV1;
  readonly artifact: PreparedSchemaVersionArtifact;
}

const preparedAppSchemaVersionArtifactStates = new WeakMap<
  PreparedAppSchemaVersionArtifactV1,
  PreparedAppSchemaVersionArtifactV1State
>();

const allowedInputFields = new Set([
  "deploymentId",
  "schemaVersionId",
  "version",
  "tables",
]);

/**
 * Build one repository-authenticated mapping plus artifact token outside SQL.
 *
 * The artifact is always derived from the exact frozen B2b1 binding section;
 * callers cannot independently supply either child token or canonical bytes.
 */
export async function prepareAppSchemaVersionArtifactV1(
  db: FlarexMetadataDatabase,
  input: EnsureAppSchemaVersionArtifactV1Input,
): Promise<PreparedAppSchemaVersionArtifactV1> {
  return prepareValidatedAppSchemaVersionArtifactV1(
    db,
    validateAndSnapshotInput(input),
  );
}

/** Apply mappings and insert/replay their exact artifact in one caller tx. */
export async function ensurePreparedAppSchemaVersionArtifactV1InTransaction(
  tx: AppSchemaVersionArtifactV1Transaction,
  prepared: PreparedAppSchemaVersionArtifactV1,
): Promise<EnsureAppSchemaVersionArtifactV1Result> {
  const state = preparedAppSchemaVersionArtifactStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedAppSchemaVersionArtifactV1Error();
  }

  await applySchemaManifestAppTableBindingsV1InTransaction(
    tx,
    state.bindings,
  );
  return ensureSchemaVersionArtifactInTransaction(tx, state.artifact);
}

/**
 * Trusted app-schema registration boundary used by the persistence facade.
 *
 * Each typed stale failure discards both child tokens and reruns binding
 * planning plus canonical artifact preparation. Every other failure is
 * terminal and propagates unchanged.
 */
export async function ensureAppSchemaVersionArtifactV1WithRepository(
  repository: AppSchemaVersionArtifactV1Repository,
  input: EnsureAppSchemaVersionArtifactV1Input,
): Promise<EnsureAppSchemaVersionArtifactV1Result> {
  const validated = validateAndSnapshotInput(input);
  return runAppSchemaVersionArtifactV1Attempts(
    validated.deploymentId,
    async () => {
      const prepared = await prepareValidatedAppSchemaVersionArtifactV1(
        repository.db,
        validated,
      );
      return repository.runTransaction((tx) =>
        ensurePreparedAppSchemaVersionArtifactV1InTransaction(tx, prepared),
      );
    },
  );
}

/** Package-internal bounded retry seam; one callback is one full fresh attempt. */
export async function runAppSchemaVersionArtifactV1Attempts<Result>(
  deploymentId: string,
  runFreshAttempt: () => Promise<Result>,
): Promise<Result> {
  for (
    let attempt = 1;
    attempt <= MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await runFreshAttempt();
    } catch (error) {
      if (!(error instanceof SchemaManifestTableBindingPlanStaleError)) {
        throw error;
      }
      if (attempt === MAX_APP_SCHEMA_VERSION_ARTIFACT_ATTEMPTS) {
        throw new AppSchemaVersionArtifactRetryExhaustedError(
          deploymentId,
          attempt,
          error.stale,
          { cause: error },
        );
      }
    }
  }

  throw new Error("App schema version artifact retry loop exited unexpectedly.");
}

async function prepareValidatedAppSchemaVersionArtifactV1(
  db: FlarexMetadataDatabase,
  input: ValidatedEnsureAppSchemaVersionArtifactV1Input,
): Promise<PreparedAppSchemaVersionArtifactV1> {
  const bindings = await prepareSchemaManifestAppTableBindingsV1(db, {
    deploymentId: input.deploymentId,
    tables: input.tables,
  });
  const artifact = await prepareSchemaVersionArtifact({
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
    version: input.version,
    manifest: decodeSchemaManifestJson(bindings.section),
  });
  const prepared = Object.freeze({
    deploymentId: input.deploymentId,
    schemaVersionId: input.schemaVersionId,
    version: input.version,
    [preparedAppSchemaVersionArtifactBrand]: true,
  } satisfies PreparedAppSchemaVersionArtifactV1);
  preparedAppSchemaVersionArtifactStates.set(prepared, {
    bindings,
    artifact,
  });
  return prepared;
}

function validateAndSnapshotInput(
  input: EnsureAppSchemaVersionArtifactV1Input,
): ValidatedEnsureAppSchemaVersionArtifactV1Input {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowedInputFields.has(key)) {
      throw new InvalidAppSchemaVersionArtifactV1InputError({
        reason: "unexpectedField",
        field: String(key),
      });
    }
  }

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

  let tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  try {
    tables = structuredClone(
      decodeSchemaManifestAppTableDeclarationsV1(input.tables),
    );
    deepFreeze(tables);
  } catch (cause) {
    throw invalidField("tables", cause);
  }

  return Object.freeze({
    deploymentId,
    schemaVersionId,
    version,
    tables,
  } satisfies ValidatedEnsureAppSchemaVersionArtifactV1Input);
}

function invalidField(
  field: Extract<
    InvalidAppSchemaVersionArtifactV1InputIssue,
    { readonly reason: "invalidField" }
  >["field"],
  cause?: unknown,
): InvalidAppSchemaVersionArtifactV1InputError {
  return new InvalidAppSchemaVersionArtifactV1InputError(
    { reason: "invalidField", field },
    cause === undefined ? undefined : { cause },
  );
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    deepFreeze(item);
  }
  Object.freeze(value);
}

function invalidInputMessage(
  issue: InvalidAppSchemaVersionArtifactV1InputIssue,
): string {
  switch (issue.reason) {
    case "invalidField":
      return `App schema version artifact ${issue.field} is invalid.`;
    case "unexpectedField":
      return `App schema version artifact input field ${issue.field} is not accepted.`;
  }
  return assertNever(issue);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled app schema version artifact case: ${String(value)}`);
}
