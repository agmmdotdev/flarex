import type { AppRowTransaction } from "../documents/appRows";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { ApplicationWriteOwnershipHistoryBudget } from "../../application/ownership/Policy";
import { readApplicationWriteOwnershipInTransaction } from "../../application/ownership/Repository";
import { withApplicationWriteOwnershipCatalog } from "../../application/ownership/Catalog";
import { ApplicationWriteOwnershipError } from "../../application/ownership/Model";
import {
  hasLocatedReadCommittedTargetDatabaseV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../database/locatedTransactionIdentity";
import { Effect } from "effect";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from
  "flarex-protocol/transaction-grant";
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
import type { FlarexMetadataDatabase } from "../../application/deployments";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runEffectTransaction } from "../../database/effectTransaction";

export { lowerCanonicalAppUniqueConstraintV1Result, type LoweredCanonicalAppUniqueConstraintV1 } from "./appUniqueConstraintKeys";

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
