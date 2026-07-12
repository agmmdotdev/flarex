import { and, eq } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import {
  decodeCatalogTableId,
  decodeCatalogTableNamespace,
  type CatalogTableId,
  type CatalogTableNamespace,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { deployments, fxControlTables } from "./schema";
import {
  nextStableTableCatalogId,
  readStableTableCatalogHighWater,
  StableTableCatalogCorruptionError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";

export {
  StableTableCatalogCorruptionError,
  StableTableCatalogIdExhaustedError,
} from "./stableTableCatalogAllocation";

export interface StableTableIdentityName {
  readonly deploymentId: string;
  readonly namespace: CatalogTableNamespace;
  readonly logicalName: string;
}

export interface StableTableIdentity extends StableTableIdentityName {
  readonly tableId: CatalogTableId;
  readonly createdAt: Date;
}

export interface EnsureStableTableIdentityInput extends StableTableIdentityName {
  readonly tableId?: never;
}

export type EnsureStableTableIdentityResult =
  | {
      readonly status: "created";
      readonly table: StableTableIdentity;
    }
  | {
      readonly status: "existing";
      readonly table: StableTableIdentity;
    };

export type StableTableCatalogTransaction = FlarexMetadataDatabase & {
  rollback(): never;
  setTransaction(config: PgTransactionConfig): Promise<void>;
};

export class InvalidStableTableIdentityInputError extends Error {
  constructor(
    readonly field:
      | "deploymentId"
      | "namespace"
      | "logicalName"
      | "tableId",
  ) {
    super(`Stable table identity ${field} is invalid.`);
    this.name = "InvalidStableTableIdentityInputError";
  }
}

export class StableTableCatalogDeploymentNotFoundError extends Error {
  constructor(readonly deploymentId: string) {
    super(`Cannot allocate a table identity for missing deployment: ${deploymentId}`);
    this.name = "StableTableCatalogDeploymentNotFoundError";
  }
}

/**
 * Allocate or replay one deployment-scoped logical table identity.
 *
 * The caller must use a short database transaction. Locking the owning
 * deployment serializes the append-only numeric allocation without holding a
 * transaction open across analyzer or user-code execution.
 */
export async function ensureStableTableIdentityInTransaction(
  tx: StableTableCatalogTransaction,
  input: EnsureStableTableIdentityInput,
): Promise<EnsureStableTableIdentityResult> {
  if (Object.hasOwn(input, "tableId")) {
    throw new InvalidStableTableIdentityInputError("tableId");
  }
  const name = validateIdentityName(input);
  const deploymentRows = await tx
    .select({ deploymentId: deployments.deploymentId })
    .from(deployments)
    .where(eq(deployments.deploymentId, name.deploymentId))
    .limit(1)
    .for("update");
  if (deploymentRows[0] === undefined) {
    throw new StableTableCatalogDeploymentNotFoundError(name.deploymentId);
  }

  const existing = await getStableTableIdentityByName(tx, name);
  if (existing !== null) {
    return { status: "existing", table: existing };
  }

  const latestTableId = await readStableTableCatalogHighWater(
    tx,
    name.deploymentId,
  );
  const tableId = nextStableTableCatalogId(name.deploymentId, latestTableId);
  const inserted = await tx
    .insert(fxControlTables)
    .values({ ...name, tableId })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw new StableTableCatalogCorruptionError(
      name.deploymentId,
      "insert returned no row",
    );
  }

  return {
    status: "created",
    table: decodeStableTableIdentity(row),
  } satisfies EnsureStableTableIdentityResult;
}

export async function getStableTableIdentityById(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: CatalogTableId,
): Promise<StableTableIdentity | null> {
  validateNonBlank(deploymentId, "deploymentId");
  const decodedTableId = decodeTableId(deploymentId, tableId);
  const rows = await db
    .select()
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, deploymentId),
        eq(fxControlTables.tableId, decodedTableId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStableTableIdentity(row);
}

export async function getStableTableIdentityByName(
  db: FlarexMetadataDatabase,
  input: StableTableIdentityName,
): Promise<StableTableIdentity | null> {
  const name = validateIdentityName(input);
  const rows = await db
    .select()
    .from(fxControlTables)
    .where(
      and(
        eq(fxControlTables.deploymentId, name.deploymentId),
        eq(fxControlTables.namespace, name.namespace),
        eq(fxControlTables.logicalName, name.logicalName),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStableTableIdentity(row);
}

function validateIdentityName(
  input: StableTableIdentityName,
): StableTableIdentityName {
  validateNonBlank(input.deploymentId, "deploymentId");
  validateNonBlank(input.logicalName, "logicalName");
  let namespace: CatalogTableNamespace;
  try {
    namespace = decodeCatalogTableNamespace(input.namespace);
  } catch {
    throw new InvalidStableTableIdentityInputError("namespace");
  }
  return {
    deploymentId: input.deploymentId,
    namespace,
    logicalName: input.logicalName,
  } satisfies StableTableIdentityName;
}

function validateNonBlank(
  value: string,
  field: "deploymentId" | "logicalName",
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidStableTableIdentityInputError(field);
  }
}

function decodeTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new StableTableCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    );
  }
}

function decodeStableTableIdentity(
  row: typeof fxControlTables.$inferSelect,
): StableTableIdentity {
  let namespace: CatalogTableNamespace;
  try {
    namespace = decodeCatalogTableNamespace(row.namespace);
  } catch {
    throw new StableTableCatalogCorruptionError(
      row.deploymentId,
      `invalid namespace: ${String(row.namespace)}`,
    );
  }
  if (row.deploymentId.trim().length === 0) {
    throw new StableTableCatalogCorruptionError(
      row.deploymentId,
      "deployment ID is blank",
    );
  }
  if (row.logicalName.trim().length === 0) {
    throw new StableTableCatalogCorruptionError(
      row.deploymentId,
      "logical name is blank",
    );
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    throw new StableTableCatalogCorruptionError(
      row.deploymentId,
      "created timestamp is invalid",
    );
  }
  return {
    deploymentId: row.deploymentId,
    tableId: decodeTableId(row.deploymentId, row.tableId),
    namespace,
    logicalName: row.logicalName,
    createdAt: row.createdAt,
  } satisfies StableTableIdentity;
}
