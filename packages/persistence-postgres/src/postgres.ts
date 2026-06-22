import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolConfig, type PoolClient } from "pg";

import type {
  FlarexPersistence,
  FlarexPersistenceCheck,
  FlarexPersistenceTx,
  QueryResult,
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
  updateDeploymentMetadataActivation as updateDeploymentMetadataActivationWithDb,
} from "./deployments";
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
  listLiveQuerySubscriptions as listLiveQuerySubscriptionsWithDb,
  recordLiveQueryRerunResult as recordLiveQueryRerunResultWithDb,
  upsertLiveQuerySubscription as upsertLiveQuerySubscriptionWithDb,
} from "./liveQuerySubscriptions";
import {
  insertLiveQueryDelivery as insertLiveQueryDeliveryWithDb,
  listPendingLiveQueryDeliveryDeployments as listPendingLiveQueryDeliveryDeploymentsWithDb,
  listStuckLiveQueryDeliveries as listStuckLiveQueryDeliveriesWithDb,
  listUndeliveredLiveQueryDeliveries as listUndeliveredLiveQueryDeliveriesWithDb,
  markLiveQueryDeliveriesDeadLettered as markLiveQueryDeliveriesDeadLetteredWithDb,
  markLiveQueryDeliveriesDelivered as markLiveQueryDeliveriesDeliveredWithDb,
  recordLiveQueryDeliveryFailure as recordLiveQueryDeliveryFailureWithDb,
} from "./liveQueryDeliveries";
import { flarexSchema } from "./schema";

export interface PostgresPersistenceOptions {
  pool?: Pool;
  poolConfig?: PoolConfig;
  connectionString?: string;
  migrationsFolder?: string;
  migrationsSchema?: string;
  migrationsTable?: string;
}

export interface PostgresFlarexPersistence extends FlarexPersistence {
  drizzle: NodePgDatabase<typeof flarexSchema>;
  pool: Pool;
  close(): Promise<void>;
}

export async function createPostgresPersistence(
  options: PostgresPersistenceOptions = {},
): Promise<PostgresFlarexPersistence> {
  const ownsPool = options.pool === undefined;
  const pool =
    options.pool ??
    new Pool({
      ...(options.connectionString === undefined
        ? {}
        : { connectionString: options.connectionString }),
      ...options.poolConfig,
    });
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const drizzleDb = drizzle(pool, { schema: flarexSchema });

  return {
    drizzle: drizzleDb,
    pool,
    execute: async (query) => {
      const result =
        typeof query === "string"
          ? await pool.query(query)
          : await drizzleDb.execute(query);
      return toQueryResult(result.rows);
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    query: async (sql, params) => await runPgQuery(pool, sql, params),

    async check(): Promise<FlarexPersistenceCheck> {
      await pool.query("select 1 as ok");
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
          tx as Parameters<typeof commitInvokeSessionWritesWithDb>[0],
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
          tx as Parameters<typeof applyFreshnessCommitWithDb>[0],
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
          tx as Parameters<typeof recordLiveQueryRerunResultWithDb>[0],
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
    listStuckLiveQueryDeliveries: (input) =>
      listStuckLiveQueryDeliveriesWithDb(drizzleDb, input),
    markLiveQueryDeliveriesDelivered: (input) =>
      markLiveQueryDeliveriesDeliveredWithDb(drizzleDb, input),
    markLiveQueryDeliveriesDeadLettered: (input) =>
      markLiveQueryDeliveriesDeadLetteredWithDb(drizzleDb, input),
    recordLiveQueryDeliveryFailure: (input) =>
      recordLiveQueryDeliveryFailureWithDb(drizzleDb, input),

    async migrate(): Promise<void> {
      await migrateNodePg(drizzleDb, {
        migrationsFolder,
        ...(options.migrationsSchema === undefined
          ? {}
          : { migrationsSchema: options.migrationsSchema }),
        ...(options.migrationsTable === undefined
          ? {}
          : { migrationsTable: options.migrationsTable }),
      });
    },

    async transaction<T>(fn: (tx: FlarexPersistenceTx) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(transactionClient(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

function transactionClient(client: PoolClient): FlarexPersistenceTx {
  const txDrizzle = drizzle(client, { schema: flarexSchema });
  return {
    execute: async (query) =>
      toQueryResult(
        (typeof query === "string"
          ? await client.query(query)
          : await txDrizzle.execute(query)).rows,
      ),
    exec: async (sql) => {
      await client.query(sql);
    },
    query: async (sql, params) => await runPgQuery(client, sql, params),
  };
}

async function runPgQuery<Row extends Record<string, unknown>>(
  client: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] | undefined,
): Promise<QueryResult<Row>> {
  const result = await client.query<Row>(
    sql,
    params === undefined ? [] : [...params],
  );
  return { rows: result.rows };
}

function toQueryResult<Row extends Record<string, unknown>>(
  rows: unknown[],
): QueryResult<Row> {
  return { rows: rows as Row[] };
}

function defaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
}
