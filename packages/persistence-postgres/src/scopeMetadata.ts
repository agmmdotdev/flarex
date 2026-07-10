import { asc, eq, gt } from "drizzle-orm";
import {
  ScopeIdSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxControlScopes } from "./schema";
import type {
  ScopePhysicalLocator,
  ScopePlacement,
} from "./scopeMetadataTypes";

export interface InsertScopeMetadataInput {
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly physicalLocator: ScopePhysicalLocator;
}

interface ScopeMetadataRecordBase {
  readonly scopeId: ScopeId;
  readonly deploymentId: string;
  readonly activeSchemaVersionId: string | null;
  readonly createdAt: Date;
}

export type ScopeMetadataRecord = ScopeMetadataRecordBase & ScopePlacement;

export interface ScopeMetadataCursor {
  readonly scopeId: ScopeId;
}

export interface ListScopeMetadataInput {
  readonly limit: number;
  readonly cursor?: ScopeMetadataCursor;
}

export interface ListScopeMetadataResult {
  readonly scopes: ScopeMetadataRecord[];
  readonly nextCursor: ScopeMetadataCursor | null;
  readonly hasMore: boolean;
}

export class ScopeMetadataAlreadyExistsError extends Error {
  constructor(
    readonly scopeId: ScopeId,
    readonly deploymentId: string,
  ) {
    super(
      `Scope metadata already exists for scope ${scopeId} or deployment ${deploymentId}`,
    );
    this.name = "ScopeMetadataAlreadyExistsError";
  }
}

export class ScopeMetadataCorruptionError extends Error {
  constructor(
    readonly scopeId: string,
    readonly reason: string,
  ) {
    super(`Scope metadata ${scopeId} is invalid: ${reason}`);
    this.name = "ScopeMetadataCorruptionError";
  }
}

export class InvalidScopeMetadataListLimitError extends Error {
  constructor(readonly limit: number) {
    super(
      `Scope metadata list limit must be an integer from 1 to ${MAX_SCOPE_METADATA_LIST_LIMIT}: ${limit}`,
    );
    this.name = "InvalidScopeMetadataListLimitError";
  }
}

export type InvalidScopeMetadataInputField =
  | "scopeId"
  | "physicalLocator.databaseKey"
  | "physicalLocator.schemaName";

export class InvalidScopeMetadataInputError extends Error {
  constructor(readonly field: InvalidScopeMetadataInputField) {
    super(`Scope metadata ${field} must contain a non-whitespace character`);
    this.name = "InvalidScopeMetadataInputError";
  }
}

const MAX_SCOPE_METADATA_LIST_LIMIT = 1_000;

export async function insertScopeMetadata(
  db: FlarexMetadataDatabase,
  input: InsertScopeMetadataInput,
): Promise<ScopeMetadataRecord> {
  requireNonBlankInput(input.scopeId, "scopeId");
  requireNonBlankInput(
    input.physicalLocator.databaseKey,
    "physicalLocator.databaseKey",
  );
  requireNonBlankInput(
    input.physicalLocator.schemaName,
    "physicalLocator.schemaName",
  );

  const rows = await db
    .insert(fxControlScopes)
    .values({
      scopeId: input.scopeId,
      deploymentId: input.deploymentId,
      isolationKind: input.physicalLocator.kind,
      physicalLocator: input.physicalLocator,
    })
    .onConflictDoNothing()
    .returning();

  const scope = rows[0];
  if (scope === undefined) {
    throw new ScopeMetadataAlreadyExistsError(
      input.scopeId,
      input.deploymentId,
    );
  }

  return decodeScopeMetadataRecord(scope);
}

export async function getScopeMetadata(
  db: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<ScopeMetadataRecord | null> {
  const rows = await db
    .select()
    .from(fxControlScopes)
    .where(eq(fxControlScopes.scopeId, scopeId))
    .limit(1);

  const scope = rows[0];
  return scope === undefined ? null : decodeScopeMetadataRecord(scope);
}

export async function getScopeMetadataByDeploymentId(
  db: FlarexMetadataDatabase,
  deploymentId: string,
): Promise<ScopeMetadataRecord | null> {
  const rows = await db
    .select()
    .from(fxControlScopes)
    .where(eq(fxControlScopes.deploymentId, deploymentId))
    .limit(1);

  const scope = rows[0];
  return scope === undefined ? null : decodeScopeMetadataRecord(scope);
}

export async function listScopeMetadata(
  db: FlarexMetadataDatabase,
  input: ListScopeMetadataInput,
): Promise<ListScopeMetadataResult> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit <= 0 ||
    input.limit > MAX_SCOPE_METADATA_LIST_LIMIT
  ) {
    throw new InvalidScopeMetadataListLimitError(input.limit);
  }

  const cursorFilter =
    input.cursor === undefined
      ? undefined
      : gt(fxControlScopes.scopeId, input.cursor.scopeId);
  const rows = await db
    .select()
    .from(fxControlScopes)
    .where(cursorFilter)
    .orderBy(asc(fxControlScopes.scopeId))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit).map(decodeScopeMetadataRecord);
  const last = page.at(-1);

  return {
    scopes: page,
    nextCursor:
      hasMore && last !== undefined
        ? {
            scopeId: last.scopeId,
          }
        : null,
    hasMore,
  };
}

type ScopeMetadataRow = typeof fxControlScopes.$inferSelect;

function decodeScopeMetadataRecord(
  row: ScopeMetadataRow,
): ScopeMetadataRecord {
  if (row.scopeId.trim().length === 0) {
    throw new ScopeMetadataCorruptionError(row.scopeId, "scope ID is empty");
  }
  if (
    row.activeSchemaVersionId !== null &&
    row.activeSchemaVersionId.trim().length === 0
  ) {
    throw new ScopeMetadataCorruptionError(
      row.scopeId,
      "active schema version ID is empty",
    );
  }

  const scopeId = ScopeIdSchema.make(row.scopeId);
  const physicalLocator = decodeScopePhysicalLocator(
    row.physicalLocator,
    row.scopeId,
  );
  if (row.isolationKind !== physicalLocator.kind) {
    throw new ScopeMetadataCorruptionError(
      row.scopeId,
      "isolation kind does not match the physical locator",
    );
  }

  const base = {
    scopeId,
    deploymentId: row.deploymentId,
    activeSchemaVersionId: row.activeSchemaVersionId,
    createdAt: row.createdAt,
  } satisfies ScopeMetadataRecordBase;

  switch (physicalLocator.kind) {
    case "shared_database":
      return {
        ...base,
        isolationKind: physicalLocator.kind,
        physicalLocator,
      };
    case "schema_per_scope":
      return {
        ...base,
        isolationKind: physicalLocator.kind,
        physicalLocator,
      };
    case "database_per_scope":
      return {
        ...base,
        isolationKind: physicalLocator.kind,
        physicalLocator,
      };
  }
}

function decodeScopePhysicalLocator(
  value: unknown,
  scopeId: string,
): ScopePhysicalLocator {
  if (!isJsonObject(value)) {
    throw new ScopeMetadataCorruptionError(
      scopeId,
      "physical locator is not an object",
    );
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("kind") ||
    !keys.includes("databaseKey") ||
    !keys.includes("schemaName")
  ) {
    throw new ScopeMetadataCorruptionError(
      scopeId,
      "physical locator must contain only kind, databaseKey, and schemaName",
    );
  }
  if (
    typeof value.databaseKey !== "string" ||
    value.databaseKey.trim().length === 0 ||
    typeof value.schemaName !== "string" ||
    value.schemaName.trim().length === 0
  ) {
    throw new ScopeMetadataCorruptionError(
      scopeId,
      "physical locator databaseKey and schemaName must be non-empty strings",
    );
  }

  switch (value.kind) {
    case "shared_database":
      return {
        kind: value.kind,
        databaseKey: value.databaseKey,
        schemaName: value.schemaName,
      };
    case "schema_per_scope":
      return {
        kind: value.kind,
        databaseKey: value.databaseKey,
        schemaName: value.schemaName,
      };
    case "database_per_scope":
      return {
        kind: value.kind,
        databaseKey: value.databaseKey,
        schemaName: value.schemaName,
      };
    default:
      throw new ScopeMetadataCorruptionError(
        scopeId,
        "physical locator kind is unsupported",
      );
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonBlankInput(
  value: string,
  field: InvalidScopeMetadataInputField,
): void {
  if (value.trim().length === 0) {
    throw new InvalidScopeMetadataInputError(field);
  }
}
