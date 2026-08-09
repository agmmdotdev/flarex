import { Effect, Result } from "effect";

import {
  type AppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  encodeAppOrderedIndexKeyV1,
  ORDERED_INDEX_MISSING_V1,
  OrderedIndexKeyTooLargeError,
  orderedIndexCreationTimeV1,
  orderedIndexValueFromFlarexValueV1,
  type OrderedIndexComponentV1,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import {
  isCanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type CanonicalFlarexValueV1,
} from "flarex-protocol/value";

import {
  locateAppDeveloperIndexDefinitionsForSchemaEffect,
  type LocatedAppIndexDefinitionV1,
  type ReadAppIndexDefinitionError,
  type ReadAppSchemaVersionIndexBindingError,
} from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "./deployments";

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

/** Control-catalog adapter for C08-A's private point-commit composition. */
export function createAppDeveloperIndexDefinitionPortV1(
  controlDb: FlarexMetadataDatabase,
): AppDeveloperIndexDefinitionPortV1 {
  return Object.freeze({
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
    const root = document.value;
    if (!isCanonicalFlarexRuntimeObjectV1(root)) {
      throw new TypeError("Expected a canonical application document object.");
    }
    const values: OrderedIndexComponentV1[] = [];
    for (const field of definition.physicalSpec.orderedFields) {
      switch (field.kind) {
        case "documentPath": {
          const value = readCanonicalDocumentPath(root, field.path);
          values.push(value === MISSING_DOCUMENT_PATH
            ? ORDERED_INDEX_MISSING_V1
            : orderedIndexValueFromFlarexValueV1(value));
          break;
        }
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

const MISSING_DOCUMENT_PATH: unique symbol = Symbol(
  "FlarexDB/MissingDeveloperIndexDocumentPath",
);

function readCanonicalDocumentPath(
  root: Readonly<Record<string, CanonicalFlarexRuntimeValueV1>>,
  path: string,
): CanonicalFlarexRuntimeValueV1 | typeof MISSING_DOCUMENT_PATH {
  let current: CanonicalFlarexRuntimeValueV1 = root;
  for (const segment of path.split(".")) {
    if (
      !isCanonicalFlarexRuntimeObjectV1(current) ||
      !Object.hasOwn(current, segment)
    ) {
      return MISSING_DOCUMENT_PATH;
    }
    current = current[segment]!;
  }
  return current;
}
