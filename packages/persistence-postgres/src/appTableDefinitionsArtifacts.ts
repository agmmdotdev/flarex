import { isNonBlankString } from "@flarex/utils/strings";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestAppTableDeclarationsV1,
  decodeSchemaManifestJson,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";
import { Cause, Data, Effect, Exit, Result, Schema } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  applySchemaManifestAppTableBindingsV1InTransactionEffect,
  prepareSchemaManifestAppTableBindingsV1Effect,
  SchemaManifestTableBindingPlanStaleError,
  type ApplySchemaManifestAppTableBindingsV1Error,
  type PreparedSchemaManifestAppTableBindingsV1,
  type PrepareSchemaManifestAppTableBindingsV1Input,
  type PrepareSchemaManifestAppTableBindingsV1Error,
  type SchemaManifestTableBindingPlanStale,
} from "./schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  prepareSchemaVersionArtifactEffect,
  type EnsureSchemaVersionArtifactInput,
  type EnsureSchemaVersionArtifactError,
  type EnsureSchemaVersionArtifactResult,
  type PrepareSchemaVersionArtifactError,
  type PreparedSchemaVersionArtifact,
  type SchemaVersionArtifactTransaction,
} from "./schemaVersionArtifacts";
import { reconcileEffectTransactionFailure } from
  "./effectTransactionFailure";
import { snapshotSchemaManifestValue } from "./schemaManifestValueSnapshot";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

const decodeCatalogSchemaVersionIdResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionIdSchema,
);
const decodeCatalogSchemaVersionResult = Schema.decodeUnknownResult(
  CatalogSchemaVersionSchema,
);

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
  readonly _tag = "InvalidAppTableDefinitionsArtifactV1InputError" as const;

  constructor(
    readonly issue: InvalidAppTableDefinitionsArtifactV1InputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidAppTableDefinitionsArtifactV1InputError";
  }
}

export class AppTableDefinitionsArtifactV1RetryExhaustedError extends Error {
  readonly _tag = "AppTableDefinitionsArtifactV1RetryExhaustedError" as const;

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
  readonly _tag =
    "InvalidPreparedAppTableDefinitionsArtifactV1Error" as const;

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

export class AppTableDefinitionsArtifactV1TransactionError extends
  Data.TaggedError("AppTableDefinitionsArtifactV1TransactionError")<{
    readonly cause: unknown;
    readonly callbackCause?: Cause.Cause<unknown>;
  }> {}

export type PrepareAppTableDefinitionsArtifactV1Error =
  | InvalidAppTableDefinitionsArtifactV1InputError
  | PrepareSchemaManifestAppTableBindingsV1Error
  | PrepareSchemaVersionArtifactError;

export type EnsurePreparedAppTableDefinitionsArtifactV1Error =
  | InvalidPreparedAppTableDefinitionsArtifactV1Error
  | ApplySchemaManifestAppTableBindingsV1Error
  | EnsureSchemaVersionArtifactError;

export type EnsureAppTableDefinitionsArtifactV1Error =
  | PrepareAppTableDefinitionsArtifactV1Error
  | EnsurePreparedAppTableDefinitionsArtifactV1Error
  | AppTableDefinitionsArtifactV1TransactionError
  | AppTableDefinitionsArtifactV1RetryExhaustedError;

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
export const prepareAppTableDefinitionsArtifactV1Effect = Effect.fn(
  "AppTableDefinitionsArtifacts.prepare",
)(function* (
  db: FlarexMetadataDatabase,
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Effect.fn.Return<
  PreparedAppTableDefinitionsArtifactV1,
  PrepareAppTableDefinitionsArtifactV1Error
> {
  return yield* prepareValidatedAppTableDefinitionsArtifactV1Effect(
    db,
    yield* Effect.fromResult(
      validateAndSnapshotAppTableDefinitionsArtifactV1InputResult(input),
    ),
  );
});

/** Apply mappings and insert/replay their exact artifact in one caller tx. */
export const ensurePreparedAppTableDefinitionsArtifactV1InTransactionEffect =
Effect.fn(
  "AppTableDefinitionsArtifacts.ensurePreparedInTransaction",
)(function* (
  tx: AppTableDefinitionsArtifactV1Transaction,
  prepared: PreparedAppTableDefinitionsArtifactV1,
): Effect.fn.Return<
  EnsureAppTableDefinitionsArtifactV1Result,
  EnsurePreparedAppTableDefinitionsArtifactV1Error
> {
  const state = preparedAppTableDefinitionsArtifactStates.get(prepared);
  if (state === undefined) {
    return yield* Effect.fail(
      new InvalidPreparedAppTableDefinitionsArtifactV1Error(),
    );
  }

  yield* applySchemaManifestAppTableBindingsV1InTransactionEffect(
    tx,
    state.bindings,
  );
  return yield* ensureSchemaVersionArtifactInTransactionEffect(
    tx,
    state.artifact,
  );
});

/**
 * Trusted table-only compatibility boundary used by the persistence facade.
 *
 * Each typed stale failure discards both child tokens and reruns binding
 * planning plus canonical artifact preparation. Every other failure is
 * terminal and propagates unchanged.
 */
export const ensureAppTableDefinitionsArtifactV1WithRepositoryEffect =
Effect.fn(
  "AppTableDefinitionsArtifacts.ensureWithRepository",
)(function* (
  repository: AppTableDefinitionsArtifactV1Repository,
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Effect.fn.Return<
  EnsureAppTableDefinitionsArtifactV1Result,
  EnsureAppTableDefinitionsArtifactV1Error
> {
  const validated = yield* Effect.fromResult(
    validateAndSnapshotAppTableDefinitionsArtifactV1InputResult(input),
  );
  return yield* runAppTableDefinitionsArtifactV1AttemptsEffect(
    validated.deploymentId,
    () => prepareValidatedAppTableDefinitionsArtifactV1Effect(
        repository.db,
        validated,
      ).pipe(Effect.flatMap((prepared) =>
        runPreparedAppTableDefinitionsArtifactTransactionEffect(
          repository,
          prepared,
        )
      )),
  );
});

/** Package-internal bounded retry seam; one callback is one full fresh attempt. */
export const runAppTableDefinitionsArtifactV1AttemptsEffect = Effect.fn(
  "AppTableDefinitionsArtifacts.runAttempts",
)(<Value, Failure>(
  deploymentId: string,
  runFreshAttempt: () => Effect.Effect<
    Value,
    Failure | SchemaManifestTableBindingPlanStaleError
  >,
): Effect.Effect<
  Value,
  Failure | AppTableDefinitionsArtifactV1RetryExhaustedError
> => {
  const runAttempt = (
    attempt: number,
  ): Effect.Effect<
    Value,
    Failure | AppTableDefinitionsArtifactV1RetryExhaustedError
  > => Effect.suspend(runFreshAttempt).pipe(
    Effect.catch((error) => {
      if (!(error instanceof SchemaManifestTableBindingPlanStaleError)) {
        return Effect.fail(error);
      }
      return attempt === MAX_APP_TABLE_DEFINITIONS_ARTIFACT_V1_ATTEMPTS
        ? Effect.fail(new AppTableDefinitionsArtifactV1RetryExhaustedError(
          deploymentId,
          attempt,
          error.stale,
          { cause: error },
        ))
        : runAttempt(attempt + 1);
    }),
  );
  return runAttempt(1);
});

const prepareValidatedAppTableDefinitionsArtifactV1Effect = Effect.fn(
  "AppTableDefinitionsArtifacts.prepareValidated",
)(function* (
  db: FlarexMetadataDatabase,
  input: ValidatedEnsureAppTableDefinitionsArtifactV1Input,
): Effect.fn.Return<
  PreparedAppTableDefinitionsArtifactV1,
  PrepareSchemaManifestAppTableBindingsV1Error
    | PrepareSchemaVersionArtifactError
> {
  const bindings = yield* prepareSchemaManifestAppTableBindingsV1Effect(db, {
    deploymentId: input.deploymentId,
    tables: input.tables,
  });
  const artifact = yield* prepareSchemaVersionArtifactEffect({
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
});

function runPreparedAppTableDefinitionsArtifactTransactionEffect(
  repository: AppTableDefinitionsArtifactV1Repository,
  prepared: PreparedAppTableDefinitionsArtifactV1,
): Effect.Effect<
  EnsureAppTableDefinitionsArtifactV1Result,
  | EnsurePreparedAppTableDefinitionsArtifactV1Error
  | AppTableDefinitionsArtifactV1TransactionError
> {
  return Effect.suspend(() => {
    let callbackCause:
      | Cause.Cause<EnsurePreparedAppTableDefinitionsArtifactV1Error>
      | undefined;
    const rollbackSignal = new Error(
      "App table-definitions artifact Effect work failed; roll back the transaction.",
    );
    return Effect.uninterruptible(
      Effect.tryPromise({
        try: () => repository.runTransaction(
          async (tx): Promise<EnsureAppTableDefinitionsArtifactV1Result> => {
            const exit = await Effect.runPromise(Effect.exit(
              ensurePreparedAppTableDefinitionsArtifactV1InTransactionEffect(
                tx,
                prepared,
              ),
            ));
            if (Exit.isFailure(exit)) {
              callbackCause = exit.cause;
              throw rollbackSignal;
            }
            return exit.value;
          },
        ),
        catch: (cause) => new AppTableDefinitionsArtifactV1TransactionError({
          cause,
          ...(callbackCause === undefined ? {} : { callbackCause }),
        }),
      }).pipe(
        Effect.catch((failure) => reconcileEffectTransactionFailure(
          failure,
          callbackCause,
          rollbackSignal,
        )),
      ),
    );
  });
}

function validateAndSnapshotAppTableDefinitionsArtifactV1InputResult(
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Result.Result<
  ValidatedEnsureAppTableDefinitionsArtifactV1Input,
  InvalidAppTableDefinitionsArtifactV1InputError
> {
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowedInputFields.has(key)) {
      return Result.fail(new InvalidAppTableDefinitionsArtifactV1InputError({
        reason: "unexpectedField",
        field: String(key),
      }));
    }
  }

  const deploymentId = input.deploymentId;
  if (!isNonBlankString(deploymentId)) {
    return Result.fail(invalidField("deploymentId"));
  }

  return Result.gen(function* () {
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      input.schemaVersionId,
    ).pipe(Result.mapError((cause) => invalidField("schemaVersionId", cause)));
    const version = yield* decodeCatalogSchemaVersionResult(
      input.version,
    ).pipe(Result.mapError((cause) => invalidField("version", cause)));
    const decodedTables = yield* decodeThrowingInputFieldResult(
      "tables",
      input.tables,
      decodeSchemaManifestAppTableDeclarationsV1,
    );
    const tables = snapshotSchemaManifestValue(decodedTables);
    return Object.freeze({
      deploymentId,
      schemaVersionId,
      version,
      tables,
    } satisfies ValidatedEnsureAppTableDefinitionsArtifactV1Input);
  });
}

function decodeThrowingInputFieldResult<Value>(
  field: "tables",
  value: unknown,
  decode: (value: unknown) => Value,
): Result.Result<Value, InvalidAppTableDefinitionsArtifactV1InputError> {
  return Result.try({
    try: () => decode(value),
    catch: (cause) => {
      if (!Schema.isSchemaError(cause)) throw cause;
      return invalidField(field, cause);
    },
  });
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
