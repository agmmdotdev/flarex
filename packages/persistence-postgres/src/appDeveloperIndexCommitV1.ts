import { Effect, Result } from "effect";

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
import type { FlarexMetadataDatabase } from "./deployments";
import { lowerAppDocumentOrderedFieldValuesV1 } from
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
  | ReadAppSchemaVersionIndexBindingError;

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
  const port = Object.freeze({
    locate: Effect.fn("AppDeveloperIndexDefinition.locate")(
      (input: LocateAppDeveloperIndexDefinitionsV1Input) =>
        locateAppDeveloperIndexDefinitionsForSchemaEffect(
          controlDb,
          input.deploymentId,
          input.scopeId,
          input.schemaVersionId,
          input.tableIds,
          input.maximumDefinitions,
        ),
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
): Result.Result<OrderedIndexKeyHexV1, OrderedIndexKeyTooLargeError> {
  try {
    if (definition.access.kind !== "developer") {
      throw new TypeError("Expected a located developer index definition.");
    }
    const values: OrderedIndexComponentV1[] = [];
    const documentFields = definition.physicalSpec.orderedFields.filter(
      (field): field is Extract<typeof field, { readonly kind: "documentPath" }> =>
        field.kind === "documentPath",
    );
    const loweredDocumentValues = lowerAppDocumentOrderedFieldValuesV1(
      document,
      documentFields.map((field) => field.path),
    );
    let documentFieldIndex = 0;
    for (const field of definition.physicalSpec.orderedFields) {
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
      spec: definition.physicalSpec,
      values: Object.freeze(values),
    }));
  } catch (cause) {
    if (cause instanceof OrderedIndexKeyTooLargeError) {
      return Result.fail(cause);
    }
    throw cause;
  }
}
