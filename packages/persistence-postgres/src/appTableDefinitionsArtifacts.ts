import { isNonBlankString } from "@flarex/utils/strings";
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

export const MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS = 3;

export interface EnsureAppTableDefinitionsArtifactV1Input
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

export type EnsureAppTableDefinitionsArtifactV1Result =
  EnsureSchemaVersionArtifactResult;

export type InvalidAppTableDefinitionsArtifactV1InputIssue =
  | {
      readonly reason: "invalidField";
      readonly field: "deploymentId" | "schemaVersionId" | "version" | "tables";
    }
  | {
      readonly reason: "unexpectedField";
      readonly field: string;
    };

export class InvalidAppTableDefinitionsArtifactV1InputError extends Error {
  constructor(
    readonly issue: InvalidAppTableDefinitionsArtifactV1InputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppTableDefinitionsArtifactV1InputError";
  }
}

export class AppTableDefinitionsArtifactV1RetryExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
    readonly lastStale: SchemaManifestTableBindingPlanStale,
    options?: ErrorOptions,
  ) {
    super(
      `App table-definitions artifact remained stale after ${attempts} attempts for ${deploymentId}.`,
      options,
    );
    this.name = "AppTableDefinitionsArtifactV1RetryExhaustedError";
  }
}

const preparedAppTableDefinitionsArtifactBrand: unique symbol = Symbol(
  "FlarexDB/PreparedAppTableDefinitionsArtifactV1",
);

export interface PreparedAppTableDefinitionsArtifactV1 {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly [preparedAppTableDefinitionsArtifactBrand]: true;
}

export class InvalidPreparedAppTableDefinitionsArtifactV1Error extends Error {
  constructor() {
    super(
      "App table-definitions artifact was not prepared by this repository instance.",
    );
    this.name = "InvalidPreparedAppTableDefinitionsArtifactV1Error";
  }
}

export type AppTableDefinitionsArtifactV1Transaction =
  StableTableCatalogTransaction & SchemaVersionArtifactTransaction;

export interface AppTableDefinitionsArtifactV1Repository {
  readonly db: FlarexMetadataDatabase;
  runTransaction<Result>(
    run: (tx: AppTableDefinitionsArtifactV1Transaction) => Promise<Result>,
  ): Promise<Result>;
}

interface ValidatedEnsureAppTableDefinitionsArtifactV1Input {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
}

interface PreparedAppTableDefinitionsArtifactV1State {
  readonly bindings: PreparedSchemaManifestAppTableBindingsV1;
  readonly artifact: PreparedSchemaVersionArtifact;
}

const preparedAppTableDefinitionsArtifactStates = new WeakMap<
  PreparedAppTableDefinitionsArtifactV1,
  PreparedAppTableDefinitionsArtifactV1State
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
export async function prepareAppTableDefinitionsArtifactV1(
  db: FlarexMetadataDatabase,
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Promise<PreparedAppTableDefinitionsArtifactV1> {
  return prepareValidatedAppTableDefinitionsArtifactV1(
    db,
    validateAndSnapshotInput(input),
  );
}

/** Apply mappings and insert/replay their exact artifact in one caller tx. */
export async function ensurePreparedAppTableDefinitionsArtifactV1InTransaction(
  tx: AppTableDefinitionsArtifactV1Transaction,
  prepared: PreparedAppTableDefinitionsArtifactV1,
): Promise<EnsureAppTableDefinitionsArtifactV1Result> {
  const state = preparedAppTableDefinitionsArtifactStates.get(prepared);
  if (state === undefined) {
    throw new InvalidPreparedAppTableDefinitionsArtifactV1Error();
  }

  await applySchemaManifestAppTableBindingsV1InTransaction(
    tx,
    state.bindings,
  );
  return ensureSchemaVersionArtifactInTransaction(tx, state.artifact);
}

/**
 * Trusted table-only compatibility boundary used by the persistence facade.
 *
 * Each typed stale failure discards both child tokens and reruns binding
 * planning plus canonical artifact preparation. Every other failure is
 * terminal and propagates unchanged.
 */
export async function ensureAppTableDefinitionsArtifactV1WithRepository(
  repository: AppTableDefinitionsArtifactV1Repository,
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Promise<EnsureAppTableDefinitionsArtifactV1Result> {
  const validated = validateAndSnapshotInput(input);
  return runAppTableDefinitionsArtifactV1Attempts(
    validated.deploymentId,
    async () => {
      const prepared = await prepareValidatedAppTableDefinitionsArtifactV1(
        repository.db,
        validated,
      );
      return repository.runTransaction((tx) =>
        ensurePreparedAppTableDefinitionsArtifactV1InTransaction(tx, prepared),
      );
    },
  );
}

/** Package-internal bounded retry seam; one callback is one full fresh attempt. */
export async function runAppTableDefinitionsArtifactV1Attempts<Result>(
  deploymentId: string,
  runFreshAttempt: () => Promise<Result>,
): Promise<Result> {
  for (
    let attempt = 1;
    attempt <= MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await runFreshAttempt();
    } catch (error) {
      if (!(error instanceof SchemaManifestTableBindingPlanStaleError)) {
        throw error;
      }
      if (attempt === MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS) {
        throw new AppTableDefinitionsArtifactV1RetryExhaustedError(
          deploymentId,
          attempt,
          error.stale,
          { cause: error },
        );
      }
    }
  }

  throw new Error(
    "App table-definitions artifact retry loop exited unexpectedly.",
  );
}

async function prepareValidatedAppTableDefinitionsArtifactV1(
  db: FlarexMetadataDatabase,
  input: ValidatedEnsureAppTableDefinitionsArtifactV1Input,
): Promise<PreparedAppTableDefinitionsArtifactV1> {
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
    [preparedAppTableDefinitionsArtifactBrand]: true,
  } satisfies PreparedAppTableDefinitionsArtifactV1);
  preparedAppTableDefinitionsArtifactStates.set(prepared, {
    bindings,
    artifact,
  });
  return prepared;
}

function validateAndSnapshotInput(
  input: EnsureAppTableDefinitionsArtifactV1Input,
): ValidatedEnsureAppTableDefinitionsArtifactV1Input {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowedInputFields.has(key)) {
      throw new InvalidAppTableDefinitionsArtifactV1InputError({
        reason: "unexpectedField",
        field: String(key),
      });
    }
  }

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
  } satisfies ValidatedEnsureAppTableDefinitionsArtifactV1Input);
}

function invalidField(
  field: Extract<
    InvalidAppTableDefinitionsArtifactV1InputIssue,
    { readonly reason: "invalidField" }
  >["field"],
  cause?: unknown,
): InvalidAppTableDefinitionsArtifactV1InputError {
  return new InvalidAppTableDefinitionsArtifactV1InputError(
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
  issue: InvalidAppTableDefinitionsArtifactV1InputIssue,
): string {
  switch (issue.reason) {
    case "invalidField":
      return `App table-definitions artifact ${issue.field} is invalid.`;
    case "unexpectedField":
      return `App table-definitions artifact input field ${issue.field} is not accepted.`;
  }
  return assertNever(issue);
}

function assertNever(value: never): never {
  throw new Error(
    `Unhandled app table-definitions artifact case: ${String(value)}`,
  );
}
