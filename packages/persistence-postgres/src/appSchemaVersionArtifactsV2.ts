import type { FlarexMetadataDatabase } from "./deployments";
import {
  prepareAppSchemaCatalogPublicationV2FromSource,
  snapshotAppSchemaCatalogPublicationV2Input,
  type PrepareAppSchemaCatalogPublicationV2Input,
} from "./appSchemaCatalogPublicationV2";
import {
  publishPreparedAppSchemaCatalogV2InTransaction,
  type AppSchemaCatalogPublicationV2Projection,
} from "./appSchemaCatalogPublicationV2Transaction";
import {
  SchemaManifestAppSchemaBindingPlanStaleError,
  type SchemaManifestAppSchemaBindingPlanStale,
} from "./schemaManifestAppSchemaBindings";
import type { StableTableCatalogTransaction } from "./stableTableCatalog";

export const MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS = 3;

export type EnsureAppSchemaVersionArtifactV2Input =
  PrepareAppSchemaCatalogPublicationV2Input;

export type EnsureAppSchemaVersionArtifactV2Result =
  AppSchemaCatalogPublicationV2Projection;

export type AppSchemaVersionArtifactV2Stale =
  SchemaManifestAppSchemaBindingPlanStale;

export class AppSchemaVersionArtifactV2RetryExhaustedError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly attempts: number,
    readonly lastStale: AppSchemaVersionArtifactV2Stale,
    options?: ErrorOptions,
  ) {
    super(
      `App-schema catalog V2 publication remained stale after ${attempts} attempts for ${deploymentId}.`,
      options,
    );
    this.name = "AppSchemaVersionArtifactV2RetryExhaustedError";
  }
}

/** Package-internal transaction boundary for one V2 facade attempt. */
export interface AppSchemaVersionArtifactV2Repository {
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
export async function ensureAppSchemaVersionArtifactV2WithRepository(
  repository: AppSchemaVersionArtifactV2Repository,
  input: EnsureAppSchemaVersionArtifactV2Input,
): Promise<EnsureAppSchemaVersionArtifactV2Result> {
  const source = snapshotAppSchemaCatalogPublicationV2Input(input);
  return runAppSchemaVersionArtifactV2Attempts(
    source.deploymentId,
    async () => {
      const publication =
        await prepareAppSchemaCatalogPublicationV2FromSource(
          repository.db,
          source,
        );
      return repository.runTransaction((tx) =>
        publishPreparedAppSchemaCatalogV2InTransaction(tx, publication),
      );
    },
  );
}

/** Package-internal deterministic retry seam for focused failure tests. */
export async function runAppSchemaVersionArtifactV2Attempts<Result>(
  deploymentId: string,
  runFreshAttempt: () => Promise<Result>,
): Promise<Result> {
  for (
    let attempt = 1;
    attempt <= MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await runFreshAttempt();
    } catch (error) {
      if (!(error instanceof SchemaManifestAppSchemaBindingPlanStaleError)) {
        throw error;
      }
      if (attempt === MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS) {
        throw new AppSchemaVersionArtifactV2RetryExhaustedError(
          deploymentId,
          attempt,
          error.stale,
          { cause: error },
        );
      }
    }
  }

  throw new Error(
    "App-schema catalog V2 publication retry loop exited unexpectedly.",
  );
}
