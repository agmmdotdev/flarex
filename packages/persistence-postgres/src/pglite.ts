import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";

import { defaultMigrationsFolder } from "./defaultMigrationsFolder";
import {
  createLocatedApplicationRevisionRegistrationTargetV1,
  type LocatedApplicationRevisionRegistrationTargetV1,
} from "./applicationRevisionRegistrationV1";
import type {
  FlarexPersistence,
  FlarexSqlClient,
  QueryResult,
} from "./index";
import {
  createSharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
} from "./scopeAuthorityBootstrap";
import {
  createSharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
} from "./scopeAuthorityProvisioning";
import {
  createSplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisionerOptions,
} from "./splitScopeAuthorityProvisioning";
import {
  createLocatedSplitScopeClockTarget,
  type LocatedSplitScopeClockTarget,
} from "./splitScopeClockTarget";
import {
  createLocatedScopeAuthorizationEpochTarget,
} from "./scopeAuthorizationEpochAuthority";
import {
  createLocatedPointMutationSessionActivationTargetV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./transactionSessionActivation";
import type { LocatedScopeClockReader } from "./scopeAuthorityResolution";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "./scopeMetadataTypes";
import {
  createFlarexRuntimePersistence,
  rowsFromDriver,
} from "./runtimePersistence";
import {
  createFlarexRuntimePersistenceTransaction,
} from "./runtimePersistenceTransaction";
import { flarexSchema } from "./schema";

type PGliteLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  transaction<T>(fn: (tx: PGliteTransactionLike) => Promise<T>): Promise<T>;
};

type PGliteTransactionLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
};

export interface PGlitePersistenceOptions {
  dataDir?: string;
  db?: PGliteLike;
  migrationsFolder?: string;
}

export interface PGliteFlarexPersistence extends FlarexPersistence {
  drizzle: PgliteDatabase<typeof flarexSchema>;
}

export function createPGliteSharedScopeAuthorityProvisioner(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SharedScopeAuthorityProvisionerOptions,
): SharedScopeAuthorityProvisioner {
  return createSharedScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}

export function createPGliteSharedScopeAuthorityBootstrapper(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SharedScopeAuthorityBootstrapperOptions,
): SharedScopeAuthorityBootstrapper {
  return createSharedScopeAuthorityBootstrapper(
    persistence.drizzle,
    options,
  );
}

export function createPGliteSplitScopeAuthorityProvisioner(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SplitScopeAuthorityProvisionerOptions,
): SplitScopeAuthorityProvisioner {
  return createSplitScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}

export function createPGliteLocatedSplitScopeClockTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: SplitScopePhysicalLocator,
): LocatedSplitScopeClockTarget {
  return createLocatedSplitScopeClockTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedScopeAuthorizationEpochTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedScopeClockReader {
  return createLocatedScopeAuthorizationEpochTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedPointMutationSessionActivationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  return createLocatedPointMutationSessionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    options,
  );
}

export function createPGliteLocatedApplicationRevisionRegistrationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionRegistrationTargetV1 {
  return createLocatedApplicationRevisionRegistrationTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export {
  InvalidSharedScopeAuthorityBootstrapBatchLimitError,
  InvalidSharedScopeAuthorityBootstrapFrontierError,
  MAX_SHARED_SCOPE_AUTHORITY_BOOTSTRAP_BATCH_SIZE,
  SharedScopeAuthorityBootstrapFrontierVersion,
  SharedScopeAuthorityParityRowError,
  type RunSharedScopeAuthorityBootstrapBatchInput,
  type RunSharedScopeAuthorityBootstrapBatchResult,
  type SharedScopeAuthorityBootstrapCursor,
  type SharedScopeAuthorityBootstrapFrontier,
  type SharedScopeAuthorityBootstrapItemResult,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
  type SharedScopeAuthorityParityCounts,
  type SharedScopeAuthorityParityReport,
} from "./scopeAuthorityBootstrap";

export {
  InvalidGeneratedScopeAuthorityIdError,
  ScopeAuthorityIdGenerationExhaustedError,
  SharedScopeAuthorityConflictError,
  SharedScopeAuthorityProvisioningStatuses,
  UnsupportedScopeAuthorityProvisioningTopologyError,
  type EnsureSharedScopeAuthorityInput,
  type EnsureSharedScopeAuthorityResult,
  type SharedScopeAuthorityConflict,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
  type SharedScopeAuthorityProvisioningStatus,
} from "./scopeAuthorityProvisioning";

export {
  SplitScopeAuthorityConflictError,
  SplitScopeAuthorityPlacementPlanningError,
  SplitScopeAuthorityProvisioningStatuses,
  SplitScopeAuthorityTargetResolutionError,
  type EnsureSplitScopeAuthorityInput,
  type EnsureSplitScopeAuthorityResult,
  type SplitScopeAuthorityConflict,
  type SplitScopeAuthorityPlacementPlanner,
  type SplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisionerOptions,
  type SplitScopeAuthorityTargetResolutionConflict,
  type SplitScopeClockTargetResolver,
} from "./splitScopeAuthorityProvisioning";

export {
  EnsureSplitScopeInitialClockStatuses,
  SplitScopeInitialClockConflictError,
  type EnsureSplitScopeInitialClockInput,
  type EnsureSplitScopeInitialClockResult,
  type LocatedSplitScopeClockTarget,
} from "./splitScopeClockTarget";

export async function createPGlitePersistence(
  options: PGlitePersistenceOptions = {},
): Promise<PGliteFlarexPersistence> {
  const db: PGliteLike =
    options.db ?? (new PGlite(options.dataDir) as unknown as PGliteLike);
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const drizzleDb = drizzle({
    client: db as unknown as PGlite,
    schema: flarexSchema,
  });
  const runtime = createFlarexRuntimePersistence({
    drizzle: drizzleDb,
    sql: createPGliteSqlClient(drizzleDb, db),
    appTableDefinitionsArtifactRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    appSchemaPublicationRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    transaction: (run) =>
      db.transaction((tx) => {
        // Drizzle narrows its PGlite client to the concrete class even though
        // PGlite's transaction object implements the same query protocol.
        const txDrizzle = drizzle({
          client: tx as unknown as PGlite,
          schema: flarexSchema,
        });
        return run(createFlarexRuntimePersistenceTransaction(
          txDrizzle,
          createPGliteSqlClient(txDrizzle, tx),
        ));
      }),
  });

  return {
    ...runtime,
    drizzle: drizzleDb,
    async migrate(): Promise<void> {
      await migratePGlite(drizzleDb, { migrationsFolder });
    },
  };
}

function createPGliteSqlClient(
  database: PgliteDatabase<typeof flarexSchema>,
  client: PGliteTransactionLike,
): FlarexSqlClient {
  return {
    async execute<Row extends Record<string, unknown> = Record<string, unknown>>(
      query: Parameters<FlarexSqlClient["execute"]>[0],
    ): Promise<QueryResult<Row>> {
      const result = await database.execute<Row>(query);
      return { rows: rowsFromDriver<Row>(result.rows) };
    },
    exec: (sql) => client.exec(sql),
    query: <Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => client.query<Row>(sql, params),
  };
}
