import { isNonBlankString } from "@flarex/utils/strings";
import {
  AppSchemaCatalogCompilationErrorV1,
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
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult,
  enforceAppSchemaPublicationV1CanonicalByteQuotaResult,
  enforceAppSchemaPublicationV1DeclarationQuotasResult,
  type AppSchemaPublicationV1QuotaExceededError,
} from "./appSchemaPublicationPolicy";
import {
  prepareSchemaManifestAppSchemaBindingsV1Effect,
  type PrepareSchemaManifestAppSchemaBindingsV1Error,
  type PreparedSchemaManifestAppSchemaBindingsV1,
  type PrepareSchemaManifestAppSchemaBindingsV1Input,
} from "./schemaManifestAppSchemaBindings";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import {
  getPreparedSchemaVersionArtifactCanonicalByteLength,
  prepareSchemaVersionArtifactEffect,
  type EnsureSchemaVersionArtifactInput,
  type PrepareSchemaVersionArtifactError,
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
  readonly _tag = "InvalidAppSchemaPublicationV1InputError" as const;

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
  readonly _tag = "InvalidAppSchemaPublicationV1SourceError" as const;

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
  readonly _tag = "InvalidPreparedAppSchemaPublicationV1Error" as const;

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

type PrepareValidatedAppSchemaPublicationV1Error =
  | PrepareSchemaManifestAppSchemaBindingsV1Error
  | AppSchemaCatalogCompilationErrorV1
  | PrepareSchemaVersionArtifactError
  | AppSchemaPublicationV1QuotaExceededError;

export type PrepareAppSchemaPublicationV1Error =
  | InvalidAppSchemaPublicationV1InputError
  | PrepareValidatedAppSchemaPublicationV1Error;

export type PrepareAppSchemaPublicationV1FromSourceError =
  | InvalidAppSchemaPublicationV1SourceError
  | PrepareValidatedAppSchemaPublicationV1Error;

/**
 * Prepare one coherent full-envelope publication attempt without writing SQL.
 *
 * Stable binding observations may become stale after this returns. A later
 * transaction must revalidate them and discard this entire token on the typed
 * stale outcome; D2a performs no retries, locks, or transactions itself.
 */
export const prepareAppSchemaPublicationV1Effect = Effect.fn(
  "AppSchemaPublicationPreparation.prepare",
)(function* (
  db: FlarexMetadataDatabase,
  input: PrepareAppSchemaPublicationV1Input,
): Effect.fn.Return<
  PreparedAppSchemaPublicationV1,
  PrepareAppSchemaPublicationV1Error
> {
  const validated = yield* Effect.fromResult(
    validateAndSnapshotInputResult(input),
  );
  return yield* prepareValidatedAppSchemaPublicationV1Effect(
    db,
    validated,
  );
});

/** Snapshot and authenticate the public request exactly once before retries. */
export function snapshotAppSchemaPublicationV1InputResult(
  input: PrepareAppSchemaPublicationV1Input,
): Result.Result<
  AppSchemaPublicationV1Source,
  InvalidAppSchemaPublicationV1InputError | AppSchemaPublicationV1QuotaExceededError
> {
  return validateAndSnapshotInputResult(input).pipe(Result.map(
    makeAppSchemaPublicationV1Source,
  ));
}

function makeAppSchemaPublicationV1Source(
  validated: ValidatedPrepareAppSchemaPublicationV1Input,
): AppSchemaPublicationV1Source {
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
export const prepareAppSchemaPublicationV1FromSourceEffect = Effect.fn(
  "AppSchemaPublicationPreparation.prepareFromSource",
)(function* (
  db: FlarexMetadataDatabase,
  source: AppSchemaPublicationV1Source,
): Effect.fn.Return<
  PreparedAppSchemaPublicationV1,
  PrepareAppSchemaPublicationV1FromSourceError
> {
  const validated = publicationSourceStates.get(source);
  if (validated === undefined) {
    return yield* Effect.fail(new InvalidAppSchemaPublicationV1SourceError());
  }
  return yield* prepareValidatedAppSchemaPublicationV1Effect(db, validated);
});

const prepareValidatedAppSchemaPublicationV1Effect = Effect.fn(
  "AppSchemaPublicationPreparation.prepareValidated",
)(function* (
  db: FlarexMetadataDatabase,
  validated: ValidatedPrepareAppSchemaPublicationV1Input,
): Effect.fn.Return<
  PreparedAppSchemaPublicationV1,
  PrepareValidatedAppSchemaPublicationV1Error
> {
  const logicalBindings = yield* prepareSchemaManifestAppSchemaBindingsV1Effect(
    db,
    {
      deploymentId: validated.deploymentId,
      tables: validated.tables,
      indexes: validated.indexes,
    },
  );
  const requirements = yield* compileAppSchemaCatalogRequirementsV1Effect(
    logicalBindings.manifest,
  );
  const artifact = yield* prepareSchemaVersionArtifactEffect({
    deploymentId: validated.deploymentId,
    schemaVersionId: validated.schemaVersionId,
    version: validated.version,
    manifest: decodeSchemaManifestJson(logicalBindings.manifest),
  });
  yield* Effect.fromResult(
    enforceAppSchemaPublicationV1CanonicalByteQuotaResult(
      getPreparedSchemaVersionArtifactCanonicalByteLength(artifact),
    ),
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
});

const compileAppSchemaCatalogRequirementsV1Effect = Effect.fn(
  "AppSchemaPublicationPreparation.compileRequirements",
)((manifest: Parameters<typeof compileAppSchemaCatalogRequirementsV1>[0]) =>
  Effect.tryPromise({
    try: () => compileAppSchemaCatalogRequirementsV1(manifest),
    catch: (cause) => ({ cause }),
  }).pipe(
    Effect.catch(({ cause }) =>
      cause instanceof AppSchemaCatalogCompilationErrorV1
        ? Effect.fail(cause)
        : Effect.die(cause)
    ),
  ));

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

function validateAndSnapshotInputResult(
  input: PrepareAppSchemaPublicationV1Input,
): Result.Result<
  ValidatedPrepareAppSchemaPublicationV1Input,
  InvalidAppSchemaPublicationV1InputError | AppSchemaPublicationV1QuotaExceededError
> {
  if (!hasExactOwnDataKeys(input, PREPARE_INPUT_KEYS)) {
    return Result.fail(new InvalidAppSchemaPublicationV1InputError({
      reason: "invalidInputShape",
    }));
  }
  return enforceAppSchemaPublicationV1DeclarationQuotasResult(
    input.tables,
    input.indexes,
  ).pipe(Result.flatMap(() => Result.gen(function* () {
    const deploymentId = input.deploymentId;
    if (!isNonBlankString(deploymentId)) {
      return yield* Result.fail(invalidField("deploymentId"));
    }
    const schemaVersionId = yield* decodePublicationInputFieldResult(
      "schemaVersionId",
      () => decodeCatalogSchemaVersionId(input.schemaVersionId),
    );
    const version = yield* decodePublicationInputFieldResult(
      "version",
      () => decodeCatalogSchemaVersion(input.version),
    );
    const decodedTables = yield* decodePublicationInputFieldResult(
      "tables",
      () => decodeSchemaManifestAppTableDeclarationsV1(input.tables),
    );
    const decodedIndexes = yield* decodePublicationInputFieldResult(
      "indexes",
      () => decodeSchemaManifestAppIndexDeclarationsV1(input.indexes),
    );
    yield* enforceAppSchemaPublicationV1CanonicalByteLowerBoundResult(
      decodedTables,
      decodedIndexes,
    );

    const tables = snapshotSchemaManifestValue(decodedTables);
    const indexes = snapshotSchemaManifestValue(decodedIndexes);

    return Object.freeze({
      deploymentId,
      schemaVersionId,
      version,
      tables,
      indexes,
    } satisfies ValidatedPrepareAppSchemaPublicationV1Input);
  })));
}

function decodePublicationInputFieldResult<Value>(
  field: "schemaVersionId" | "version" | "tables" | "indexes",
  decode: () => Value,
): Result.Result<Value, InvalidAppSchemaPublicationV1InputError> {
  return Result.try({
    try: decode,
    catch: (cause) => invalidField(field, cause),
  });
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
