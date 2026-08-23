import type {
  ApplicationManifest,
} from "@flarex/analysis/application-analysis";
import { Result } from "effect";
import type {
  CatalogIndexId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import {
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";

import type { PublishAppSchemaV1Input } from "./appSchemaPublication";

export type AnalyzedApplicationSchema = ApplicationManifest["schema"];

export interface ApplicationSchemaTableProjection {
  readonly applicationTableId: number;
  readonly logicalName: string;
  readonly tableId: CatalogTableId;
}

export interface ApplicationSchemaIndexProjection {
  readonly applicationIndexId: number;
  readonly applicationTableId: number;
  readonly descriptor: string;
  readonly logicalIndexId: CatalogIndexId;
  readonly tableId: CatalogTableId;
}

export interface BoundApplicationSchemaProjection {
  readonly tables: ReadonlyArray<ApplicationSchemaTableProjection>;
  readonly indexes: ReadonlyArray<ApplicationSchemaIndexProjection>;
}

export class ApplicationSchemaProjectionError extends Error {
  readonly _tag = "ApplicationSchemaProjectionError" as const;

  constructor(
    readonly phase: "publicationInput" | "boundProjection",
    options?: ErrorOptions,
  ) {
    super(`Application schema ${phase} is invalid.`, options);
    this.name = "ApplicationSchemaProjectionError";
  }
}

/**
 * Lower the shared table/index portion of an analyzed Application schema.
 *
 * Relation-bearing manifests deliberately reuse the existing table/index-only
 * schema-manifest publication as one component of their distinct bound
 * publication. This helper never reads or drops relation semantics on behalf
 * of a caller; the relation binder remains responsible for pinning the exact
 * V2 schema and analyzed-manifest digest.
 */
export function applicationSchemaPublicationInputResult(
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
  schemaVersion: CatalogSchemaVersion,
  schema: AnalyzedApplicationSchema,
): Result.Result<PublishAppSchemaV1Input, ApplicationSchemaProjectionError> {
  const tableNames = new Map(
    schema.tables.map(table => [table.tableId, table.name] as const),
  );
  const tables = schema.tables.map(table => ({
    logicalName: table.name,
    definition: {
      kind: "appDocument" as const,
      definitionVersion: 1 as const,
      documentType: table.validator,
    },
  }));
  const indexes: Array<{
    readonly tableLogicalName: string;
    readonly descriptor: string;
    readonly fields: ReadonlyArray<string>;
  }> = [];
  for (const index of schema.indexes) {
    const tableLogicalName = tableNames.get(index.tableId);
    if (tableLogicalName === undefined) {
      return Result.fail(new ApplicationSchemaProjectionError(
        "publicationInput",
      ));
    }
    indexes.push({
      tableLogicalName,
      descriptor: index.name,
      fields: index.fields,
    });
  }
  return Result.gen(function* () {
    const decodedTables = yield*
      decodeSchemaManifestAppTableDeclarationsV1Result(tables).pipe(
        Result.mapError(cause => new ApplicationSchemaProjectionError(
          "publicationInput",
          { cause },
        )),
      );
    const decodedIndexes = yield*
      decodeSchemaManifestAppIndexDeclarationsV1Result(indexes).pipe(
        Result.mapError(cause => new ApplicationSchemaProjectionError(
          "publicationInput",
          { cause },
        )),
      );
    return Object.freeze({
      deploymentId,
      schemaVersionId,
      version: schemaVersion,
      tables: decodedTables,
      indexes: decodedIndexes,
    });
  });
}

/** Map analysis-local table/index ordinals to stable catalog identities. */
export function projectBoundApplicationSchemaResult(
  schema: AnalyzedApplicationSchema,
  manifest: SchemaManifestAppSchemaV1,
): Result.Result<
  BoundApplicationSchemaProjection,
  ApplicationSchemaProjectionError
> {
  const boundTablesByName = new Map<string,
    SchemaManifestAppSchemaV1["tableDefinitions"]["tables"][number]
  >(
    manifest.tableDefinitions.tables.map(table => [
      table.logicalName,
      table,
    ] as const),
  );
  if (boundTablesByName.size !== schema.tables.length) {
    return projectionFailure();
  }

  const tables: ApplicationSchemaTableProjection[] = [];
  const boundTableIdsByApplicationId = new Map<number, CatalogTableId>();
  for (const table of schema.tables) {
    const bound = boundTablesByName.get(table.name);
    if (
      bound === undefined ||
      !canonicalJsonEqual(bound.definition.documentType, table.validator)
    ) {
      return projectionFailure();
    }
    boundTableIdsByApplicationId.set(table.tableId, bound.tableId);
    tables.push(Object.freeze({
      applicationTableId: table.tableId,
      logicalName: table.name,
      tableId: bound.tableId,
    }));
  }

  const indexes: ApplicationSchemaIndexProjection[] = [];
  const unmatched = new Set(manifest.indexBindings.indexes);
  for (const index of schema.indexes) {
    const tableId = boundTableIdsByApplicationId.get(index.tableId);
    if (tableId === undefined) return projectionFailure();
    const bound = manifest.indexBindings.indexes.find(candidate =>
      candidate.tableId === tableId && candidate.descriptor === index.name
    );
    if (
      bound === undefined ||
      !stringArraysEqual(bound.spec.fields, index.fields)
    ) {
      return projectionFailure();
    }
    unmatched.delete(bound);
    indexes.push(Object.freeze({
      applicationIndexId: index.indexId,
      applicationTableId: index.tableId,
      descriptor: index.name,
      logicalIndexId: bound.logicalIndexId,
      tableId,
    }));
  }
  if (unmatched.size !== 0) return projectionFailure();

  return Result.succeed(Object.freeze({
    tables: Object.freeze(tables),
    indexes: Object.freeze(indexes),
  }));
}

function projectionFailure(): Result.Result<
  never,
  ApplicationSchemaProjectionError
> {
  return Result.fail(new ApplicationSchemaProjectionError("boundProjection"));
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  if (!isJson(left) || !isJson(right)) return false;
  return encodeCanonicalJson(left, canonicalJsonInvariant) ===
    encodeCanonicalJson(right, canonicalJsonInvariant);
}

function canonicalJsonInvariant(issue: { readonly reason: string }): never {
  throw new Error(`Application schema JSON invariant: ${issue.reason}`);
}

function stringArraysEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
