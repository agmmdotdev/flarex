import { and, eq } from "drizzle-orm";
import {
  decodeCatalogIndexId,
  decodeCatalogTableId,
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlIndexes } from "./schema";
import { StableLogicalIndexCatalogCorruptionError } from "./stableLogicalIndexCatalogAllocation";

export { StableLogicalIndexCatalogCorruptionError } from "./stableLogicalIndexCatalogAllocation";

export interface StableLogicalIndexIdentityName {
  readonly deploymentId: string;
  readonly tableId: CatalogTableId;
  readonly descriptor: string;
}

export interface StableLogicalIndexIdentity
  extends StableLogicalIndexIdentityName {
  readonly logicalIndexId: CatalogIndexId;
  readonly createdAt: Date;
}

export class InvalidStableLogicalIndexIdentityInputError extends Error {
  constructor(
    readonly field:
      | "deploymentId"
      | "logicalIndexId"
      | "tableId"
      | "descriptor",
  ) {
    super(`Stable logical index identity ${field} is invalid.`);
    this.name = "InvalidStableLogicalIndexIdentityInputError";
  }
}

export async function getStableLogicalIndexIdentityById(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  logicalIndexId: CatalogIndexId,
): Promise<StableLogicalIndexIdentity | null> {
  validateNonBlank(deploymentId, "deploymentId");
  const decodedLogicalIndexId = decodeInputIndexId(logicalIndexId);
  const rows = await db
    .select()
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, deploymentId),
        eq(fxControlIndexes.logicalIndexId, decodedLogicalIndexId),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStableLogicalIndexIdentity(row);
}

export async function getStableLogicalIndexIdentityByName(
  db: FlarexMetadataDatabase,
  input: StableLogicalIndexIdentityName,
): Promise<StableLogicalIndexIdentity | null> {
  const name = validateIdentityName(input);
  const rows = await db
    .select()
    .from(fxControlIndexes)
    .where(
      and(
        eq(fxControlIndexes.deploymentId, name.deploymentId),
        eq(fxControlIndexes.tableId, name.tableId),
        eq(fxControlIndexes.descriptor, name.descriptor),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : decodeStableLogicalIndexIdentity(row);
}

function validateIdentityName(
  input: StableLogicalIndexIdentityName,
): StableLogicalIndexIdentityName {
  validateNonBlank(input.deploymentId, "deploymentId");
  validateNonBlank(input.descriptor, "descriptor");
  return {
    deploymentId: input.deploymentId,
    tableId: decodeInputTableId(input.tableId),
    descriptor: input.descriptor,
  } satisfies StableLogicalIndexIdentityName;
}

function validateNonBlank(
  value: string,
  field: "deploymentId" | "descriptor",
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidStableLogicalIndexIdentityInputError(field);
  }
}

function decodeInputIndexId(value: unknown): CatalogIndexId {
  try {
    return decodeCatalogIndexId(value);
  } catch {
    throw new InvalidStableLogicalIndexIdentityInputError("logicalIndexId");
  }
}

function decodeInputTableId(value: unknown): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new InvalidStableLogicalIndexIdentityInputError("tableId");
  }
}

function decodeStoredIndexId(
  deploymentId: string,
  value: unknown,
): CatalogIndexId {
  try {
    return decodeCatalogIndexId(value);
  } catch {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid logical index ID: ${String(value)}`,
    );
  }
}

function decodeStoredTableId(
  deploymentId: string,
  value: unknown,
): CatalogTableId {
  try {
    return decodeCatalogTableId(value);
  } catch {
    throw new StableLogicalIndexCatalogCorruptionError(
      deploymentId,
      `invalid table ID: ${String(value)}`,
    );
  }
}

function decodeStableLogicalIndexIdentity(
  row: typeof fxControlIndexes.$inferSelect,
): StableLogicalIndexIdentity {
  if (row.deploymentId.trim().length === 0) {
    throw new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "deployment ID is blank",
    );
  }
  if (row.descriptor.trim().length === 0) {
    throw new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "descriptor is blank",
    );
  }
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    throw new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "created timestamp is invalid",
    );
  }
  return {
    deploymentId: row.deploymentId,
    logicalIndexId: decodeStoredIndexId(
      row.deploymentId,
      row.logicalIndexId,
    ),
    tableId: decodeStoredTableId(row.deploymentId, row.tableId),
    descriptor: row.descriptor,
    createdAt: row.createdAt,
  } satisfies StableLogicalIndexIdentity;
}
