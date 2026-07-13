import type { FlarexMetadataDatabase } from "./deployments";
import {
  prepareAppSchemaPublicationV1FromSource,
  snapshotAppSchemaPublicationV1Input,
  type PrepareAppSchemaPublicationV1Input,
} from "./appSchemaPublicationPreparation";
import {
  publishPreparedAppSchemaV1InTransaction,
  type AppSchemaPublicationV1Result,
} from "./appSchemaPublicationTransaction";
import {
  SchemaManifestAppSchemaBindingPlanStaleError,
  type SchemaManifestAppSchemaBindingPlanStale,
} from "./schemaManifestAppSchemaBindings";
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
      return repository.runTransaction((tx) =>
        publishPreparedAppSchemaV1InTransaction(tx, publication),
      );
    },
  );
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
