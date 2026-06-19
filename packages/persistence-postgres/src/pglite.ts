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
  getDeploymentPackageMetadata as getDeploymentPackageMetadataWithDb,
  insertDeploymentPackageMetadata as insertDeploymentPackageMetadataWithDb,
} from "./deploymentPackages";
import {
  getDeploymentMetadata as getDeploymentMetadataWithDb,
  insertDeploymentMetadata as insertDeploymentMetadataWithDb,
  updateDeploymentMetadataActivation as updateDeploymentMetadataActivationWithDb,
} from "./deployments";
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
    updateDeploymentMetadataActivation: (input) =>
      updateDeploymentMetadataActivationWithDb(drizzleDb, input),

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
