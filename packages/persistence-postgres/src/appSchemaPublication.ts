import { Cause, Data, Effect, Exit } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  prepareAppSchemaPublicationV1FromSource,
  snapshotAppSchemaPublicationV1Input,
  type PrepareAppSchemaPublicationV1Input,
  type PreparedAppSchemaPublicationV1,
} from "./appSchemaPublicationPreparation";
import {
  publishPreparedAppSchemaV1InTransactionEffect,
  type AppSchemaPublicationV1Result,
  type PublishPreparedAppSchemaV1InTransactionError,
} from "./appSchemaPublicationTransaction";
import {
  SchemaManifestAppSchemaBindingPlanStaleError,
  type SchemaManifestAppSchemaBindingPlanStale,
} from "./schemaManifestAppSchemaBindings";
import { reconcileEffectTransactionFailure } from
  "./effectTransactionFailure";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

export const MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS = 3;

export type PublishAppSchemaV1Input =
  PrepareAppSchemaPublicationV1Input;

export type PublishAppSchemaV1Result =
  AppSchemaPublicationV1Result;

export type AppSchemaPublicationV1Stale =
  SchemaManifestAppSchemaBindingPlanStale;

export class AppSchemaPublicationV1RetryExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
    readonly lastStale: AppSchemaPublicationV1Stale,
    options?: ErrorOptions,
  ) {
    super(
      `App-schema V1 publication remained stale after ${attempts} attempts for ${deploymentId}.`,
      options,
    );
    this.name = "AppSchemaPublicationV1RetryExhaustedError";
  }
}

export class AppSchemaPublicationV1TransactionError extends Data.TaggedError(
  "AppSchemaPublicationV1TransactionError",
)<{
  readonly cause: unknown;
  readonly callbackCause?: Cause.Cause<unknown>;
}> {}

/** Package-internal transaction boundary for one publication attempt. */
export interface AppSchemaPublicationV1Repository {
  readonly db: FlarexMetadataDatabase;
  runTransaction<Result>(
    run: (tx: StableTableCatalogTransaction) => Promise<Result>,
  ): Promise<Result>;
}

/**
 * Publish or replay one full app-schema envelope through a bounded coordinator.
 *
 * The caller request is validated and snapshotted once. Every typed-stale
 * retry then rebuilds all database-dependent bindings, compiled requirements,
 * canonical bytes, and hashes before opening a new write transaction.
 */
export async function publishAppSchemaV1WithRepository(
  repository: AppSchemaPublicationV1Repository,
  input: PublishAppSchemaV1Input,
): Promise<PublishAppSchemaV1Result> {
  const source = snapshotAppSchemaPublicationV1Input(input);
  return runAppSchemaPublicationV1Attempts(
    source.deploymentId,
    async () => {
      const publication =
        await prepareAppSchemaPublicationV1FromSource(
          repository.db,
          source,
        );
      return runPreparedAppSchemaPublicationTransaction(
        repository,
        publication,
      );
    },
  );
}

// D2d remains a Promise compatibility API. Delete this public runtime bridge
// when its coordinator and repository contract become Effect-native.
function runPreparedAppSchemaPublicationTransaction(
  repository: AppSchemaPublicationV1Repository,
  publication: PreparedAppSchemaPublicationV1,
): Promise<AppSchemaPublicationV1Result> {
  return Effect.runPromise(
    runPreparedAppSchemaPublicationTransactionEffect(
      repository,
      publication,
    ),
  );
}

function runPreparedAppSchemaPublicationTransactionEffect(
  repository: AppSchemaPublicationV1Repository,
  publication: PreparedAppSchemaPublicationV1,
): Effect.Effect<
  AppSchemaPublicationV1Result,
  | PublishPreparedAppSchemaV1InTransactionError
  | AppSchemaPublicationV1TransactionError
> {
  return Effect.suspend(() => {
    let callbackCause:
      | Cause.Cause<PublishPreparedAppSchemaV1InTransactionError>
      | undefined;
    const rollbackSignal = new Error(
      "App-schema publication Effect work failed; roll back the transaction.",
    );
    // Drizzle 0.45 owns a Promise callback, so this inner bridge captures the
    // complete callback Exit before the transaction can commit or roll back.
    return Effect.uninterruptible(
      Effect.tryPromise({
        try: () => repository.runTransaction(
          async (tx): Promise<AppSchemaPublicationV1Result> => {
            const exit = await Effect.runPromise(Effect.exit(
              publishPreparedAppSchemaV1InTransactionEffect(tx, publication),
            ));
            if (Exit.isFailure(exit)) {
              callbackCause = exit.cause;
              throw rollbackSignal;
            }
            return exit.value;
          },
        ),
        catch: (cause) => new AppSchemaPublicationV1TransactionError({
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

/** Package-internal deterministic retry seam for focused failure tests. */
export async function runAppSchemaPublicationV1Attempts<Result>(
  deploymentId: string,
  runFreshAttempt: () => Promise<Result>,
): Promise<Result> {
  for (
    let attempt = 1;
    attempt <= MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await runFreshAttempt();
    } catch (error) {
      if (!(error instanceof SchemaManifestAppSchemaBindingPlanStaleError)) {
        throw error;
      }
      if (attempt === MAX_APP_SCHEMA_PUBLICATION_V1_ATTEMPTS) {
        throw new AppSchemaPublicationV1RetryExhaustedError(
          deploymentId,
          attempt,
          error.stale,
          { cause: error },
        );
      }
    }
  }

  throw new Error(
    "App-schema V1 publication retry loop exited unexpectedly.",
  );
}
