import type {
  FlarexPersistenceCheck,
  FlarexPersistenceTx,
  FlarexRuntimePersistence,
  FlarexSqlClient,
} from "./index";
import { commitInvokeSessionWrites as commitInvokeSessionWritesWithDb } from "./commits";
import {
  getDeploymentPackageMetadata as getDeploymentPackageMetadataWithDb,
  insertDeploymentPackageMetadata as insertDeploymentPackageMetadataWithDb,
} from "./deploymentPackages";
import {
  getDeploymentMetadata as getDeploymentMetadataWithDb,
  insertDeploymentMetadata as insertDeploymentMetadataWithDb,
  listDeploymentMetadata as listDeploymentMetadataWithDb,
  type FlarexMetadataDatabase,
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
  listInvokeSessionDocumentWrites as listInvokeSessionDocumentWritesWithDb,
  stageInvokeSessionDocumentWrite as stageInvokeSessionDocumentWriteWithDb,
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
  listPendingLiveQueryDeliveryDeployments as listPendingLiveQueryDeliveriesWithDb,
  listStuckLiveQueryDeliveries as listStuckLiveQueryDeliveriesWithDb,
  listUndeliveredLiveQueryDeliveries as listUndeliveredLiveQueryDeliveriesWithDb,
  markLiveQueryDeliveriesDeadLettered as markLiveQueryDeliveriesDeadLetteredWithDb,
  markLiveQueryDeliveriesDelivered as markLiveQueryDeliveriesDeliveredWithDb,
  recordLiveQueryDeliveryFailure as recordLiveQueryDeliveryFailureWithDb,
} from "./liveQueryDeliveries";
import {
  ensureAppSchemaVersionArtifactV1WithRepository,
  type AppSchemaVersionArtifactV1Repository,
} from "./appSchemaVersionArtifacts";

export interface FlarexRuntimePersistenceTransaction {
  readonly drizzle: FlarexMetadataDatabase;
  readonly sql: FlarexPersistenceTx;
}

export interface FlarexRuntimePersistenceDriver {
  readonly drizzle: FlarexMetadataDatabase;
  readonly sql: FlarexSqlClient;
  readonly appSchemaVersionArtifactRepository: AppSchemaVersionArtifactV1Repository;
  transaction<T>(
    run: (transaction: FlarexRuntimePersistenceTransaction) => Promise<T>,
  ): Promise<T>;
}

export function createFlarexRuntimePersistence(
  driver: FlarexRuntimePersistenceDriver,
): FlarexRuntimePersistence {
  const drizzleDb = driver.drizzle;

  return {
    execute: <Row extends Record<string, unknown> = Record<string, unknown>>(
      query: Parameters<FlarexSqlClient["execute"]>[0],
    ) => driver.sql.execute<Row>(query),
    exec: (sql) => driver.sql.exec(sql),
    query: <Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => driver.sql.query<Row>(sql, params),

    async check(): Promise<FlarexPersistenceCheck> {
      await driver.sql.query("select 1 as ok");
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
    ensureAppSchemaVersionArtifactV1: (input) =>
      ensureAppSchemaVersionArtifactV1WithRepository(
        driver.appSchemaVersionArtifactRepository,
        input,
      ),
    insertScopeMetadata: (input) =>
      insertScopeMetadataWithDb(drizzleDb, input),
    getScopeMetadata: (scopeId) => getScopeMetadataWithDb(drizzleDb, scopeId),
    getScopeMetadataByDeploymentId: (deploymentId) =>
      getScopeMetadataByDeploymentIdWithDb(drizzleDb, deploymentId),
    listScopeMetadata: (input) => listScopeMetadataWithDb(drizzleDb, input),
    getScopeClock: (scopeId) => getScopeClockWithDb(drizzleDb, scopeId),
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
      driver.transaction(({ drizzle }) =>
        commitInvokeSessionWritesWithDb(drizzle, input),
      ),
    insertOutboxEvent: (input) => insertOutboxEventWithDb(drizzleDb, input),
    listOutboxEvents: (input) => listOutboxEventsWithDb(drizzleDb, input),
    listUndeliveredOutboxEvents: (input) =>
      listUndeliveredOutboxEventsWithDb(drizzleDb, input),
    markOutboxEventsDelivered: (input) =>
      markOutboxEventsDeliveredWithDb(drizzleDb, input),
    applyFreshnessCommit: (input) =>
      driver.transaction(({ drizzle }) =>
        applyFreshnessCommitWithDb(drizzle, input),
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
      driver.transaction(({ drizzle }) =>
        upsertLiveQuerySubscriptionWithLeaseWithDb(drizzle, input),
      ),
    upsertLiveQuerySubscription: (input) =>
      upsertLiveQuerySubscriptionWithDb(drizzleDb, input),
    recordLiveQueryRerunResult: (input) =>
      driver.transaction(({ drizzle }) =>
        recordLiveQueryRerunResultWithDb(drizzle, input),
      ),
    recordLiveQueryRerunFailure: (input) =>
      driver.transaction(({ drizzle }) =>
        recordLiveQueryRerunFailureWithDb(drizzle, input),
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
      driver.transaction(({ sql }) =>
        deleteExpiredLiveQuerySubscriptionsWithDb(sql, input),
      ),
    insertLiveQueryDelivery: (input) =>
      insertLiveQueryDeliveryWithDb(drizzleDb, input),
    listUndeliveredLiveQueryDeliveries: (input) =>
      listUndeliveredLiveQueryDeliveriesWithDb(drizzleDb, input),
    listPendingLiveQueryDeliveryDeployments: (input) =>
      listPendingLiveQueryDeliveriesWithDb(drizzleDb, input),
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
    transaction: (fn) => driver.transaction(({ sql }) => fn(sql)),
  };
}

export function rowsFromDriver<
  Row extends Record<string, unknown> = Record<string, unknown>,
>(rows: unknown[]): Row[] {
  // FlarexSqlClient's existing generic row type is caller-declared, like
  // pg.query<Row>. No runtime row schema exists at this low-level boundary, so
  // keep the unavoidable trust assertion here rather than in every adapter.
  return rows as Row[];
}
