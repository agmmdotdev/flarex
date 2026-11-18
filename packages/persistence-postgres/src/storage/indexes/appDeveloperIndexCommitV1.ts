import { Effect } from "effect";
import {
  type CatalogTableId,
} from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";

import {
  locateAppDeveloperIndexDefinitionsForSchemaEffect,
  type LocatedAppIndexDefinitionV1,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import {
  IndexBuildReconciliationCatalogV1Error,
  loadPublishedPhysicalRequirementSnapshotV1,
  publishedPhysicalDefinitionMatchesLocated,
  type PublishedPhysicalRequirementSnapshotV1,
} from "./indexBuildReconciliation";
import type { ReadSchemaVersionArtifactError } from "../catalog/schemaVersionArtifacts";

export { lowerAppDeveloperIndexKeyV1, lowerAppOrderedIndexPhysicalKeyV1 } from "./appDeveloperIndexKeys";

export interface LocateAppDeveloperIndexDefinitionsV1Input {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableIds: ReadonlyArray<CatalogTableId>;
  readonly maximumDefinitions: number;
}

export type LocateAppDeveloperIndexDefinitionsV1Error =
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | ReadSchemaVersionArtifactError
  | IndexBuildReconciliationCatalogV1Error;

export interface AppDeveloperIndexDefinitionPortV1 {
  readonly locate: (
    input: LocateAppDeveloperIndexDefinitionsV1Input,
  ) => Effect.Effect<
    ReadonlyArray<LocatedAppIndexDefinitionV1> | null,
    LocateAppDeveloperIndexDefinitionsV1Error
  >;
}

const appDeveloperIndexDefinitionControlDbsV1 = new WeakMap<
  AppDeveloperIndexDefinitionPortV1,
  FlarexMetadataDatabase
>();

/** Control-catalog adapter for C08-A's private point-commit composition. */
export function createAppDeveloperIndexDefinitionPortV1(
  controlDb: FlarexMetadataDatabase,
): AppDeveloperIndexDefinitionPortV1 {
  // One immutable schema per port, never cached scope or serving authority.
  // Concurrent misses may repeat verification; each invocation keeps its own
  // snapshot and only a successfully verified snapshot can replace this slot.
  let retained: PublishedPhysicalRequirementSnapshotV1 | null = null;
  const port = Object.freeze({
    locate: Effect.fn("AppDeveloperIndexDefinition.locate")(
      function* (input: LocateAppDeveloperIndexDefinitionsV1Input) {
        const definitions = yield* locateAppDeveloperIndexDefinitionsForSchemaEffect(
          controlDb,
          input.deploymentId,
          input.scopeId,
          input.schemaVersionId,
          input.tableIds,
          input.maximumDefinitions,
        );
        if (definitions === null || input.tableIds.length === 0) return definitions;
        if (definitions.length > input.maximumDefinitions) {
          return yield* Effect.fail(new IndexBuildReconciliationCatalogV1Error({
            reason: "definitionLimitExceeded",
            deploymentId: input.deploymentId,
            schemaVersionId: input.schemaVersionId,
            detail: `the touched developer definition set exceeds ${input.maximumDefinitions}`,
          }));
        }
        let snapshot = retained;
        if (snapshot === null || snapshot.deploymentId !== input.deploymentId ||
          snapshot.schemaVersionId !== input.schemaVersionId) {
          snapshot = yield* loadPublishedPhysicalRequirementSnapshotV1(controlDb, input);
          if (snapshot === null) return null;
          retained = snapshot;
        }
        const tables = new Set(input.tableIds);
        const required = snapshot.definitions.filter(definition =>
          definition.access.kind === "developer" && tables.has(definition.tableId));
        if (required.length !== definitions.length ||
          !required.every((expected, position) => {
            const actual = definitions[position];
            return actual !== undefined && actual.access.kind === "developer" &&
              publishedPhysicalDefinitionMatchesLocated(expected, actual);
          })) {
          return yield* Effect.fail(new IndexBuildReconciliationCatalogV1Error({
            reason: "publishedProjectionContradictory",
            deploymentId: input.deploymentId,
            schemaVersionId: input.schemaVersionId,
            detail: "the touched developer definitions do not match the published schema requirements",
          }));
        }
        return definitions;
      },
    ),
  });
  appDeveloperIndexDefinitionControlDbsV1.set(port, controlDb);
  return port;
}

/** Exact control-catalog composition guard for private index-read owners. */
export function hasAppDeveloperIndexDefinitionAuthorityForControlDbV1(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
): value is AppDeveloperIndexDefinitionPortV1 {
  return typeof value === "object" && value !== null &&
    // SAFETY: the typeof guard above proved the value is a non-null
    // object; the cast only narrows it to the WeakMap's registered brand.
    appDeveloperIndexDefinitionControlDbsV1.get(
      value as AppDeveloperIndexDefinitionPortV1,
    ) === controlDb;
}
