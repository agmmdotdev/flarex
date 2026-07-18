import { copyFiniteDate } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
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
import {
  decodeStableLogicalIndexCatalogIndexId as decodeStoredIndexId,
  decodeStableLogicalIndexCatalogTableId as decodeStoredTableId,
} from "./stableLogicalIndexCatalogDecoding";

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
  if (!isNonBlankString(value)) {
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

function decodeStableLogicalIndexIdentity(
  row: typeof fxControlIndexes.$inferSelect,
): StableLogicalIndexIdentity {
  if (!isNonBlankString(row.deploymentId)) {
    throw new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "deployment ID is blank",
    );
  }
  if (!isNonBlankString(row.descriptor)) {
    throw new StableLogicalIndexCatalogCorruptionError(
      row.deploymentId,
      "descriptor is blank",
    );
  }
  const createdAt = copyFiniteDate(row.createdAt);
  if (createdAt === undefined) {
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
    createdAt,
  } satisfies StableLogicalIndexIdentity;
}
