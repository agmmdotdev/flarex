import { Effect, Result } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";

import { lowerAppDocumentOrderedFieldValuesV1 } from
  "./appDocumentOrderedFieldValuesV1";
import {
  locateAppUniqueConstraintDefinitionsForSchemaEffect,
  type LocatedAppUniqueConstraintDefinitionV1,
  type ReadAppUniqueConstraintDefinitionV1Error,
} from "./appUniqueConstraintDefinitions";
import {
  canonicalizeAppUniqueKeyV1Result,
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyV1,
  type InvalidAppUniqueKeyContractV1Error,
} from "./appUniqueKeyContract";
import type { FlarexMetadataDatabase } from "./deployments";

export interface LocateAppUniqueConstraintDefinitionsV1Input {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableIds: ReadonlyArray<CatalogTableId>;
  readonly maximumDefinitions: number;
}

export interface AppUniqueConstraintDefinitionPortV1 {
  readonly locate: (
    input: LocateAppUniqueConstraintDefinitionsV1Input,
  ) => Effect.Effect<
    ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1> | null,
    ReadAppUniqueConstraintDefinitionV1Error
  >;
}

const appUniqueConstraintDefinitionPortsV1 = new WeakMap<
  object,
  FlarexMetadataDatabase
>();

/** Process-local authority check; structural locator copies fail closed. */
export function hasAppUniqueConstraintDefinitionAuthorityV1(
  value: unknown,
): value is AppUniqueConstraintDefinitionPortV1 {
  return typeof value === "object" && value !== null &&
    appUniqueConstraintDefinitionPortsV1.has(value);
}

/** Exact composition check for owners that must share one control catalog. */
export function hasAppUniqueConstraintDefinitionAuthorityForControlDbV1(
  value: unknown,
  controlDb: FlarexMetadataDatabase,
): value is AppUniqueConstraintDefinitionPortV1 {
  return typeof value === "object" && value !== null &&
    appUniqueConstraintDefinitionPortsV1.get(value) === controlDb;
}

/** Control-catalog adapter for C08-B2's private point-commit composition. */
export function createAppUniqueConstraintDefinitionPortV1(
  controlDb: FlarexMetadataDatabase,
): AppUniqueConstraintDefinitionPortV1 {
  const port = Object.freeze({
    locate: Effect.fn("AppUniqueConstraintDefinition.locate")(
      (input: LocateAppUniqueConstraintDefinitionsV1Input) =>
        locateAppUniqueConstraintDefinitionsForSchemaEffect(
          controlDb,
          input.deploymentId,
          input.scopeId,
          input.schemaVersionId,
          input.tableIds,
          input.maximumDefinitions,
        ),
    ),
  });
  appUniqueConstraintDefinitionPortsV1.set(port, controlDb);
  return port;
}

/** Pure lowering from one authenticated document into the S11 projection. */
export function lowerAppUniqueConstraintProjectionV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<AppUniqueKeyProjectionV1, OrderedIndexKeyTooLargeError> {
  return Result.try({
    try: () => Object.freeze({
      sparse: definition.physicalSpec.sparse,
      localeKey: null,
      values: lowerAppDocumentOrderedFieldValuesV1(
        document,
        definition.physicalSpec.orderedFields,
      ),
    }),
    catch: (cause) => {
      if (cause instanceof OrderedIndexKeyTooLargeError) return cause;
      throw cause;
    },
  });
}

export interface LoweredCanonicalAppUniqueConstraintV1 {
  readonly projection: AppUniqueKeyProjectionV1;
  readonly canonical: CanonicalAppUniqueKeyV1;
}

/** One canonical lowering owner shared by point commit and future backfill. */
export function lowerCanonicalAppUniqueConstraintV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<
  LoweredCanonicalAppUniqueConstraintV1,
  InvalidAppUniqueKeyContractV1Error | OrderedIndexKeyTooLargeError
> {
  return lowerAppUniqueConstraintProjectionV1Result(
    definition,
    document,
  ).pipe(
    Result.flatMap((projection) =>
      canonicalizeAppUniqueKeyV1Result(projection).pipe(
        Result.map((canonical) => Object.freeze({ projection, canonical })),
      )
    ),
  );
}
