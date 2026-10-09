import { Effect, Result } from "effect";
import { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";

import {
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  encodeAppOrderedIndexKeyV1,
  OrderedIndexKeyTooLargeError,
  orderedIndexCreationTimeV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexComponentV1,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

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
import { appDocumentPathEqualsText, appDocumentPathIsNull, lowerAppDocumentOrderedFieldValuesV1 } from
  "./appDocumentOrderedFieldValuesV1";

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

/**
 * Pure C08-A lowering from an authenticated final or prior document into the
 * physical ordered-key contract already committed by the located definition.
 */
export function lowerAppDeveloperIndexKeyV1(
  definition: LocatedAppIndexDefinitionV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): Result.Result<OrderedIndexKeyHexV1 | null, OrderedIndexKeyTooLargeError | ExactDecimalError> {
  if (definition.access.kind !== "developer") throw new TypeError("Expected a located developer index definition.");
  return lowerAppOrderedIndexPhysicalKeyV1(definition.physicalSpec, document, creationTime);
}

/** Same canonical key lowering for an authenticated target-side activation
 * projection. The trusted publisher owns the definition and its digest. */
export function lowerAppOrderedIndexPhysicalKeyV1(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
  document: CanonicalFlarexValueV1,
  creationTime: AppCreationTimeV1,
): Result.Result<OrderedIndexKeyHexV1 | null, OrderedIndexKeyTooLargeError | ExactDecimalError> {
  try {
    const predicate = physicalSpec.predicate;
    if (predicate !== undefined && !(predicate.kind === "fieldIsNull"
      ? appDocumentPathIsNull(document, predicate.field)
      : appDocumentPathIsNull(document, predicate.nullField) &&
        appDocumentPathEqualsText(document, predicate.textField, predicate.value))) return Result.succeed(null);
    const values: OrderedIndexComponentV1[] = [];
    const documentFields = physicalSpec.orderedFields.filter(
      (field): field is Extract<typeof field, { readonly kind: "documentPath" }> =>
        field.kind === "documentPath",
    );
    const loweredDocumentValues = lowerAppDocumentOrderedFieldValuesV1(
      document,
      documentFields,
    );
    let documentFieldIndex = 0;
    for (const field of physicalSpec.orderedFields) {
      switch (field.kind) {
        case "documentPath":
          values.push(loweredDocumentValues[documentFieldIndex]!);
          documentFieldIndex += 1;
          break;
        case "systemCreationTime":
          values.push(orderedIndexCreationTimeV1(creationTime));
          break;
      }
    }
    return Result.succeed(encodeAppOrderedIndexKeyV1({
      spec: physicalSpec,
      values: Object.freeze(values),
    }));
  } catch (cause) {
    if (cause instanceof OrderedIndexKeyTooLargeError || cause instanceof ExactDecimalError) {
      return Result.fail(cause);
    }
    throw cause;
  }
}
