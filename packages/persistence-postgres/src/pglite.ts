import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  FlarexPersistence,
  FlarexPersistenceCheck,
  FlarexPersistenceTx,
  QueryResult,
} from "./index";
import {
  commitInvokeSessionWrites as commitInvokeSessionWritesWithDb,
} from "./commits";
import {
  getDeploymentPackageMetadata as getDeploymentPackageMetadataWithDb,
  insertDeploymentPackageMetadata as insertDeploymentPackageMetadataWithDb,
} from "./deploymentPackages";
import {
  getDeploymentMetadata as getDeploymentMetadataWithDb,
  insertDeploymentMetadata as insertDeploymentMetadataWithDb,
  listDeploymentMetadata as listDeploymentMetadataWithDb,
  updateDeploymentMetadataActivation as updateDeploymentMetadataActivationWithDb,
} from "./deployments";
import {
  getScopeMetadata as getScopeMetadataWithDb,
  getScopeMetadataByDeploymentId as getScopeMetadataByDeploymentIdWithDb,
  insertScopeMetadata as insertScopeMetadataWithDb,
  listScopeMetadata as listScopeMetadataWithDb,
} from "./scopeMetadata";
import { getScopeClock as getScopeClockWithDb } from "./scopeClock";
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
import type { SplitScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  getDocumentRevisionAtTs as getDocumentRevisionAtTsWithDb,
  insertDocumentRevision as insertDocumentRevisionWithDb,
  listDocumentsInTableAtTs as listDocumentsInTableAtTsWithDb,
} from "./documents";
import {
  hasIndexEntryAfterTs as hasIndexEntryAfterTsWithDb,
  listDocumentsInIndexAtTs as listDocumentsInIndexAtTsWithDb,
} from "./indexEntries";
import {
  applyFreshnessCommit as applyFreshnessCommitWithDb,
  getDocumentFreshnessVersion as getDocumentFreshnessVersionWithDb,
  getFreshnessProcessedEvent as getFreshnessProcessedEventWithDb,
  getTableFreshnessVersion as getTableFreshnessVersionWithDb,
} from "./freshness";
import {
  abortInvokeSessionMetadata as abortInvokeSessionMetadataWithDb,
  abortStaleInvokeSessionsMetadata as abortStaleInvokeSessionsMetadataWithDb,
  finishInvokeSessionMetadata as finishInvokeSessionMetadataWithDb,
  getInvokeSessionMetadata as getInvokeSessionMetadataWithDb,
  insertInvokeSessionMetadata as insertInvokeSessionMetadataWithDb,
} from "./invokeSessions";
import {
  insertInvokeSessionDocumentRead as insertInvokeSessionDocumentReadWithDb,
  listInvokeSessionDocumentReads as listInvokeSessionDocumentReadsWithDb,
} from "./invokeSessionReads";
import {
  insertInvokeSessionTableRead as insertInvokeSessionTableReadWithDb,
  listInvokeSessionTableReads as listInvokeSessionTableReadsWithDb,
} from "./invokeSessionTableReads";
import {
  insertInvokeSessionIndexRead as insertInvokeSessionIndexReadWithDb,
  listInvokeSessionIndexReads as listInvokeSessionIndexReadsWithDb,
} from "./invokeSessionIndexReads";
import {
  stageInvokeSessionDocumentWrite as stageInvokeSessionDocumentWriteWithDb,
  listInvokeSessionDocumentWrites as listInvokeSessionDocumentWritesWithDb,
} from "./invokeSessionWrites";
import {
  insertOutboxEvent as insertOutboxEventWithDb,
  listOutboxEvents as listOutboxEventsWithDb,
  listUndeliveredOutboxEvents as listUndeliveredOutboxEventsWithDb,
  markOutboxEventsDelivered as markOutboxEventsDeliveredWithDb,
} from "./outbox";
import {
  deleteLiveQuerySubscription as deleteLiveQuerySubscriptionWithDb,
  deleteLiveQuerySubscriptionsForConnection as deleteLiveQuerySubscriptionsForConnectionWithDb,
  listLiveQuerySubscriptions as listLiveQuerySubscriptionsWithDb,
  recordLiveQueryRerunFailure as recordLiveQueryRerunFailureWithDb,
  recordLiveQueryRerunResult as recordLiveQueryRerunResultWithDb,
  upsertLiveQuerySubscription as upsertLiveQuerySubscriptionWithDb,
} from "./liveQuerySubscriptions";
import {
  closeLiveQueryConnection as closeLiveQueryConnectionWithDb,
  deleteExpiredLiveQuerySubscriptions as deleteExpiredLiveQuerySubscriptionsWithDb,
  listActiveLiveQuerySubscriptions as listActiveLiveQuerySubscriptionsWithDb,
  listExpiredLiveQueryConnectionDeployments as listExpiredLiveQueryConnectionDeploymentsWithDb,
  upsertLiveQueryConnectionLease as upsertLiveQueryConnectionLeaseWithDb,
  upsertLiveQuerySubscriptionWithLease as upsertLiveQuerySubscriptionWithLeaseWithDb,
} from "./liveQueryConnections";
import {
  claimLiveQueryDeliveries as claimLiveQueryDeliveriesWithDb,
  insertLiveQueryDelivery as insertLiveQueryDeliveryWithDb,
  listPendingLiveQueryDeliveryDeployments as listPendingLiveQueryDeliveryDeploymentsWithDb,
  listStuckLiveQueryDeliveries as listStuckLiveQueryDeliveriesWithDb,
  listUndeliveredLiveQueryDeliveries as listUndeliveredLiveQueryDeliveriesWithDb,
  markLiveQueryDeliveriesDeadLettered as markLiveQueryDeliveriesDeadLetteredWithDb,
  markLiveQueryDeliveriesDelivered as markLiveQueryDeliveriesDeliveredWithDb,
  recordLiveQueryDeliveryFailure as recordLiveQueryDeliveryFailureWithDb,
} from "./liveQueryDeliveries";
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

  return {
    drizzle: drizzleDb,
    execute: (query) =>
      drizzleDb.execute(query) as unknown as Promise<QueryResult<never>>,
    exec: (sql) => db.exec(sql),
    query: (sql, params) => db.query(sql, params),

    async check(): Promise<FlarexPersistenceCheck> {
      await db.query("select 1 as ok");
      return { status: "ok" };
    },

    insertDeploymentPackageMetadata: (input) =>
      insertDeploymentPackageMetadataWithDb(drizzleDb, input),
    getDeploymentPackageMetadata: (deploymentId, packageId) =>
      getDeploymentPackageMetadataWithDb(drizzleDb, deploymentId, packageId),
    insertDeploymentMetadata: (input) =>
      insertDeploymentMetadataWithDb(drizzleDb, input),
    getDeploymentMetadata: (deploymentId) =>
      getDeploymentMetadataWithDb(drizzleDb, deploymentId),
    listDeploymentMetadata: (input) =>
      listDeploymentMetadataWithDb(drizzleDb, input),
    updateDeploymentMetadataActivation: (input) =>
      updateDeploymentMetadataActivationWithDb(drizzleDb, input),
    insertScopeMetadata: (input) =>
      insertScopeMetadataWithDb(drizzleDb, input),
    getScopeMetadata: (scopeId) =>
      getScopeMetadataWithDb(drizzleDb, scopeId),
    getScopeMetadataByDeploymentId: (deploymentId) =>
      getScopeMetadataByDeploymentIdWithDb(drizzleDb, deploymentId),
    listScopeMetadata: (input) =>
      listScopeMetadataWithDb(drizzleDb, input),
    getScopeClock: (scopeId) =>
      getScopeClockWithDb(drizzleDb, scopeId),
    insertInvokeSessionMetadata: (input) =>
      insertInvokeSessionMetadataWithDb(drizzleDb, input),
    getInvokeSessionMetadata: (deploymentId, sessionId) =>
      getInvokeSessionMetadataWithDb(drizzleDb, deploymentId, sessionId),
    finishInvokeSessionMetadata: (input) =>
      finishInvokeSessionMetadataWithDb(drizzleDb, input),
    abortInvokeSessionMetadata: (input) =>
      abortInvokeSessionMetadataWithDb(drizzleDb, input),
    abortStaleInvokeSessionsMetadata: (input) =>
      abortStaleInvokeSessionsMetadataWithDb(drizzleDb, input),
    insertDocumentRevision: (input) =>
      insertDocumentRevisionWithDb(drizzleDb, input),
    getDocumentRevisionAtTs: (deploymentId, id, ts) =>
      getDocumentRevisionAtTsWithDb(drizzleDb, deploymentId, id, ts),
    listDocumentsInTableAtTs: (deploymentId, tableId, ts, limit) =>
      listDocumentsInTableAtTsWithDb(
        drizzleDb,
        deploymentId,
        tableId,
        ts,
        limit,
      ),
    listDocumentsInIndexAtTs: (input) =>
      listDocumentsInIndexAtTsWithDb(drizzleDb, input),
    hasIndexEntryAfterTs: (input) =>
      hasIndexEntryAfterTsWithDb(drizzleDb, input),
    insertInvokeSessionDocumentRead: (input) =>
      insertInvokeSessionDocumentReadWithDb(drizzleDb, input),
    listInvokeSessionDocumentReads: (deploymentId, sessionId) =>
      listInvokeSessionDocumentReadsWithDb(drizzleDb, deploymentId, sessionId),
    insertInvokeSessionTableRead: (input) =>
      insertInvokeSessionTableReadWithDb(drizzleDb, input),
    listInvokeSessionTableReads: (deploymentId, sessionId) =>
      listInvokeSessionTableReadsWithDb(drizzleDb, deploymentId, sessionId),
    insertInvokeSessionIndexRead: (input) =>
      insertInvokeSessionIndexReadWithDb(drizzleDb, input),
    listInvokeSessionIndexReads: (deploymentId, sessionId) =>
      listInvokeSessionIndexReadsWithDb(drizzleDb, deploymentId, sessionId),
    stageInvokeSessionDocumentWrite: (input) =>
      stageInvokeSessionDocumentWriteWithDb(drizzleDb, input),
    listInvokeSessionDocumentWrites: (deploymentId, sessionId) =>
      listInvokeSessionDocumentWritesWithDb(drizzleDb, deploymentId, sessionId),
    commitInvokeSessionWrites: (input) =>
      drizzleDb.transaction((tx) =>
        commitInvokeSessionWritesWithDb(
          tx as unknown as Parameters<typeof commitInvokeSessionWritesWithDb>[0],
          input,
        ),
      ),
    insertOutboxEvent: (input) => insertOutboxEventWithDb(drizzleDb, input),
    listOutboxEvents: (input) => listOutboxEventsWithDb(drizzleDb, input),
    listUndeliveredOutboxEvents: (input) =>
      listUndeliveredOutboxEventsWithDb(drizzleDb, input),
    markOutboxEventsDelivered: (input) =>
      markOutboxEventsDeliveredWithDb(drizzleDb, input),
    applyFreshnessCommit: (input) =>
      drizzleDb.transaction((tx) =>
        applyFreshnessCommitWithDb(
          tx as unknown as Parameters<typeof applyFreshnessCommitWithDb>[0],
          input,
        ),
      ),
    getFreshnessProcessedEvent: (input) =>
      getFreshnessProcessedEventWithDb(drizzleDb, input),
    getDocumentFreshnessVersion: (deploymentId, documentId) =>
      getDocumentFreshnessVersionWithDb(drizzleDb, deploymentId, documentId),
    getTableFreshnessVersion: (deploymentId, tableId) =>
      getTableFreshnessVersionWithDb(drizzleDb, deploymentId, tableId),
    upsertLiveQueryConnectionLease: (input) =>
      upsertLiveQueryConnectionLeaseWithDb(drizzleDb, input),
    closeLiveQueryConnection: (input) =>
      closeLiveQueryConnectionWithDb(drizzleDb, input),
    upsertLiveQuerySubscriptionWithLease: (input) =>
      drizzleDb.transaction((tx) =>
        upsertLiveQuerySubscriptionWithLeaseWithDb(
          tx as unknown as Parameters<typeof upsertLiveQuerySubscriptionWithLeaseWithDb>[0],
          input,
        ),
      ),
    upsertLiveQuerySubscription: (input) =>
      upsertLiveQuerySubscriptionWithDb(drizzleDb, input),
    recordLiveQueryRerunResult: (input) =>
      drizzleDb.transaction((tx) =>
        recordLiveQueryRerunResultWithDb(
          tx as unknown as Parameters<typeof recordLiveQueryRerunResultWithDb>[0],
          input,
        ),
      ),
    recordLiveQueryRerunFailure: (input) =>
      drizzleDb.transaction((tx) =>
        recordLiveQueryRerunFailureWithDb(
          tx as unknown as Parameters<typeof recordLiveQueryRerunFailureWithDb>[0],
          input,
        ),
      ),
    deleteLiveQuerySubscription: (input) =>
      deleteLiveQuerySubscriptionWithDb(drizzleDb, input),
    deleteLiveQuerySubscriptionsForConnection: (input) =>
      deleteLiveQuerySubscriptionsForConnectionWithDb(drizzleDb, input),
    listLiveQuerySubscriptions: (input) =>
      listLiveQuerySubscriptionsWithDb(drizzleDb, input),
    listActiveLiveQuerySubscriptions: (input) =>
      listActiveLiveQuerySubscriptionsWithDb(drizzleDb, input),
    listExpiredLiveQueryConnectionDeployments: (input) =>
      listExpiredLiveQueryConnectionDeploymentsWithDb(drizzleDb, input),
    deleteExpiredLiveQuerySubscriptions: (input) =>
      drizzleDb.transaction((tx) =>
        deleteExpiredLiveQuerySubscriptionsWithDb(tx, input),
      ),
    insertLiveQueryDelivery: (input) =>
      insertLiveQueryDeliveryWithDb(drizzleDb, input),
    listUndeliveredLiveQueryDeliveries: (input) =>
      listUndeliveredLiveQueryDeliveriesWithDb(drizzleDb, input),
    listPendingLiveQueryDeliveryDeployments: (input) =>
      listPendingLiveQueryDeliveryDeploymentsWithDb(drizzleDb, input),
    listStuckLiveQueryDeliveries: (input) =>
      listStuckLiveQueryDeliveriesWithDb(drizzleDb, input),
    markLiveQueryDeliveriesDelivered: (input) =>
      markLiveQueryDeliveriesDeliveredWithDb(drizzleDb, input),
    markLiveQueryDeliveriesDeadLettered: (input) =>
      markLiveQueryDeliveriesDeadLetteredWithDb(drizzleDb, input),
    recordLiveQueryDeliveryFailure: (input) =>
      recordLiveQueryDeliveryFailureWithDb(drizzleDb, input),
    claimLiveQueryDeliveries: (input) =>
      claimLiveQueryDeliveriesWithDb(drizzleDb, input),

    async migrate(): Promise<void> {
      await migratePGlite(drizzleDb, { migrationsFolder });
    },

    transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T> {
      return db.transaction((tx) => {
        const txDrizzle = drizzle({
          client: tx as unknown as PGlite,
          schema: flarexSchema,
        });
        return fn({
          execute: (query) =>
            txDrizzle.execute(query) as unknown as Promise<QueryResult<never>>,
          exec: (sql) => tx.exec(sql),
          query: (sql, params) => tx.query(sql, params),
        });
      });
    },
  };
}

function defaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}
