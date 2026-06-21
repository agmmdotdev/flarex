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
  getDocumentRevisionAtTs as getDocumentRevisionAtTsWithDb,
  insertDocumentRevision as insertDocumentRevisionWithDb,
  listDocumentsInTableAtTs as listDocumentsInTableAtTsWithDb,
} from "./documents";
import {
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
  listLiveQuerySubscriptions as listLiveQuerySubscriptionsWithDb,
  recordLiveQueryRerunResult as recordLiveQueryRerunResultWithDb,
  upsertLiveQuerySubscription as upsertLiveQuerySubscriptionWithDb,
} from "./liveQuerySubscriptions";
import {
  insertLiveQueryDelivery as insertLiveQueryDeliveryWithDb,
  listPendingLiveQueryDeliveryDeployments as listPendingLiveQueryDeliveryDeploymentsWithDb,
  listUndeliveredLiveQueryDeliveries as listUndeliveredLiveQueryDeliveriesWithDb,
  markLiveQueryDeliveriesDelivered as markLiveQueryDeliveriesDeliveredWithDb,
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
    upsertLiveQuerySubscription: (input) =>
      upsertLiveQuerySubscriptionWithDb(drizzleDb, input),
    recordLiveQueryRerunResult: (input) =>
      drizzleDb.transaction((tx) =>
        recordLiveQueryRerunResultWithDb(
          tx as unknown as Parameters<typeof recordLiveQueryRerunResultWithDb>[0],
          input,
        ),
      ),
    deleteLiveQuerySubscription: (input) =>
      deleteLiveQuerySubscriptionWithDb(drizzleDb, input),
    listLiveQuerySubscriptions: (input) =>
      listLiveQuerySubscriptionsWithDb(drizzleDb, input),
    insertLiveQueryDelivery: (input) =>
      insertLiveQueryDeliveryWithDb(drizzleDb, input),
    listUndeliveredLiveQueryDeliveries: (input) =>
      listUndeliveredLiveQueryDeliveriesWithDb(drizzleDb, input),
    listPendingLiveQueryDeliveryDeployments: (input) =>
      listPendingLiveQueryDeliveryDeploymentsWithDb(drizzleDb, input),
    markLiveQueryDeliveriesDelivered: (input) =>
      markLiveQueryDeliveriesDeliveredWithDb(drizzleDb, input),

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
