import type { AppRowTransaction } from "./appRows";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ApplicationWriteOwnershipHistoryBudget } from "./applicationWriteOwnership/Policy";
import { readApplicationWriteOwnershipInTransaction } from "./applicationWriteOwnership/Repository";
import { withApplicationWriteOwnershipCatalog } from "./applicationWriteOwnership/Catalog";
import { ApplicationWriteOwnershipError } from "./applicationWriteOwnership/Model";
import { hasLocatedReadCommittedTargetDatabaseV1, type LocatedReadCommittedAttemptTargetV1 } from "./transactionSessionAttemptKernel";
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

import { appDocumentPathIsNull, lowerAppDocumentOrderedFieldValuesV1 } from
  "./appDocumentOrderedFieldValuesV1";
import {
  locateAppUniqueConstraintDefinitionsForSchemaEffect,
  type LocatedAppUniqueConstraintDefinitionV1,
} from "./appUniqueConstraintDefinitions";
import {
  appUniqueConstraintDefinitionsMatchMembers,
  AppUniqueConstraintSetClosureCorruptionV1Error,
  AppUniqueConstraintSetClosurePersistenceV1Error,
  readAppUniqueConstraintSetClosureV1Effect,
  type LocatedAppUniqueConstraintSetClosureV1,
  type ReadAppUniqueConstraintSetClosureV1Error,
} from "./appUniqueConstraintSetClosureV1";
import {
  canonicalizeAppUniqueKeyV1Result,
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyClaimV1,
  type OmittedAppUniqueKeyClaimV1,
  type InvalidAppUniqueKeyContractV1Error,
} from "./appUniqueKeyContract";
import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runEffectTransaction } from "./effectTransaction";

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
    reader?: FlarexMetadataTransaction,
  ) => Effect.Effect<
    ReadonlyArray<LocatedAppUniqueConstraintDefinitionV1> | null,
    ReadAppUniqueConstraintSetClosureV1Error
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
  // Retain immutable requirements only; scope ownership and the selected
  // definitions remain fresh. Concurrent misses can repeat verification, and
  // only successful loads replace this bounded single-schema slot.
  let retained: LocatedAppUniqueConstraintSetClosureV1 | null = null;
  const port = Object.freeze({
    locate: Effect.fn("AppUniqueConstraintDefinition.locate")(
      function (input: LocateAppUniqueConstraintDefinitionsV1Input, reader?: FlarexMetadataTransaction) {
        const locate = (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
        const definitions = yield* locateAppUniqueConstraintDefinitionsForSchemaEffect(
          tx,
          input.deploymentId,
          input.scopeId,
          input.schemaVersionId,
          input.tableIds,
          input.maximumDefinitions,
        );
        if (definitions === null || input.tableIds.length === 0) return definitions;
        let snapshot = retained;
        if (snapshot === null || snapshot.closure.deploymentId !== input.deploymentId ||
          snapshot.closure.schemaVersionId !== input.schemaVersionId) {
          snapshot = yield* readAppUniqueConstraintSetClosureV1Effect(
            controlDb, input.deploymentId, input.schemaVersionId, undefined, tx,
          );
          if (snapshot === null) return null;
          retained = snapshot;
        }
        const tables = new Set(input.tableIds);
        const required = snapshot.members.filter(member => tables.has(member.tableId));
        if (!appUniqueConstraintDefinitionsMatchMembers(definitions, required)) {
          return yield* Effect.fail(new AppUniqueConstraintSetClosureCorruptionV1Error({
            detail: "the touched unique definitions do not match the closed schema requirements",
          }));
        }
        return definitions;
        });
        return reader === undefined
          ? runEffectTransaction<Effect.Success<ReturnType<typeof locate>>, Effect.Error<ReturnType<typeof locate>>,
            AppUniqueConstraintSetClosurePersistenceV1Error, FlarexMetadataTransaction>(callback => controlDb.transaction(callback),
            "Unique definitions control acquisition rolled back", locate,
            cause => new AppUniqueConstraintSetClosurePersistenceV1Error({ operation: "locateDefinitionsTransaction", cause }))
          : locate(reader);
      },
    ),
  });
  appUniqueConstraintDefinitionPortsV1.set(port, controlDb);
  return port;
}

/** Pure lowering from one authenticated document into the S11 projection. */
function lowerAppUniqueConstraintProjectionV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<AppUniqueKeyProjectionV1 | OmittedAppUniqueKeyClaimV1, OrderedIndexKeyTooLargeError> {
  return Result.try({
    try: () => {
      const spec = definition.physicalSpec;
      if (spec.predicate !== undefined && !appDocumentPathIsNull(document, spec.predicate.field)) {
        return Object.freeze({ kind: "omitted" as const, reason: "predicateExcluded" as const, localeKey: "" });
      }
      if (spec.nullsDistinct === true && spec.orderedFields.some(field => appDocumentPathIsNull(document, field))) {
        return Object.freeze({ kind: "omitted" as const, reason: "nullDistinct" as const, localeKey: "" });
      }
      return Object.freeze({ sparse: spec.sparse, localeKey: null,
        values: lowerAppDocumentOrderedFieldValuesV1(document, spec.orderedFields) });
    },
    catch: (cause) => {
      if (cause instanceof OrderedIndexKeyTooLargeError) return cause;
      throw cause;
    },
  });
}

export type LoweredCanonicalAppUniqueConstraintV1 =
  | (CanonicalAppUniqueKeyClaimV1 & { readonly projection: AppUniqueKeyProjectionV1 })
  | OmittedAppUniqueKeyClaimV1;

/** One canonical lowering owner shared by point commit, CMS and backfill. */
export function lowerCanonicalAppUniqueConstraintV1Result(
  definition: LocatedAppUniqueConstraintDefinitionV1,
  document: CanonicalFlarexValueV1,
): Result.Result<
  LoweredCanonicalAppUniqueConstraintV1,
  InvalidAppUniqueKeyContractV1Error | OrderedIndexKeyTooLargeError
> {
  return Result.gen(function* () {
    const projection = yield* lowerAppUniqueConstraintProjectionV1Result(definition, document);
    if ("kind" in projection) return projection;
    const canonical = yield* canonicalizeAppUniqueKeyV1Result(projection);
    return canonical.kind === "omitted" ? canonical : Object.freeze({ ...canonical, projection });
  });
}

/** Reuse the nominal control-catalog composition for ownership recovery. */
export const readApplicationOwnershipForUniqueDefinitions = Effect.fn("AppUniqueConstraintDefinition.readOwnership")(function (
  port: AppUniqueConstraintDefinitionPortV1 | undefined, tx: AppRowTransaction, scopeId: ScopeId, budget: ApplicationWriteOwnershipHistoryBudget,
  target?: LocatedReadCommittedAttemptTargetV1,
) {
  const controlDatabase = port === undefined ? undefined : appUniqueConstraintDefinitionPortsV1.get(port);
  return controlDatabase === undefined
    ? readApplicationWriteOwnershipInTransaction(tx, scopeId, budget)
    : target === undefined ? Effect.fail(new ApplicationWriteOwnershipError({ reason: "invalidEvidence" }))
    : withApplicationWriteOwnershipCatalog(controlDatabase, hasLocatedReadCommittedTargetDatabaseV1(target, controlDatabase) ? tx : undefined,
      catalog => readApplicationWriteOwnershipInTransaction(tx, scopeId, budget, catalog));
});
