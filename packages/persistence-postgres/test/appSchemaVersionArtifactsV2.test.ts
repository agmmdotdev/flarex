import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestJson,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { describe, expect, it, vi } from "vitest";

import {
  getPreparedAppSchemaCatalogPublicationV2State,
  prepareAppSchemaCatalogPublicationV2,
} from "../src/appSchemaCatalogPublicationV2";
import {
  AppSchemaCatalogPublicationV2QuotaExceededError,
  enforceAppSchemaCatalogPublicationV2CanonicalByteQuota,
  enforceAppSchemaCatalogPublicationV2DeclarationQuotas,
  MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
  MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS,
  MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES,
  MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES,
} from "../src/appSchemaCatalogPublicationV2Policy";
import {
  AppSchemaVersionArtifactV2RetryExhaustedError,
  ensureAppSchemaVersionArtifactV2WithRepository,
  MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS,
  runAppSchemaVersionArtifactV2Attempts,
  type AppSchemaVersionArtifactV2Repository,
} from "../src/appSchemaVersionArtifactsV2";
import { createPGlitePersistence } from "../src/pglite";
import { SchemaManifestAppSchemaBindingPlanStaleError } from "../src/schemaManifestAppSchemaBindings";
import { ensureStableTableIdentityInTransaction } from "../src/stableTableCatalog";
import type { StableTableCatalogTransaction } from "../src/stableTableCatalog";

describe("app-schema version artifact V2 facade", () => {
  it("publishes and exactly replays the complete projection", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_facade_replay";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(
      deploymentId,
      "schema_catalog_v2_facade_replay",
    );

    const created = await persistence.ensureAppSchemaVersionArtifactV2(input);
    const replayed = await persistence.ensureAppSchemaVersionArtifactV2(input);

    expect(created).toEqual(replayed);
    expect(created.manifest).toEqual(created.artifact.manifestJson);
    expect(created.manifest.tableDefinitions.tables).toMatchObject([
      { logicalName: "users", tableId: 1 },
    ]);
    expect(created.manifest.indexBindings.indexes).toMatchObject([
      { descriptor: "byEmail", logicalIndexId: 1, tableId: 1 },
    ]);
    expect(created.creationTimeIndexDefinitions).toMatchObject([
      { indexDefinitionId: 1, access: { kind: "by_creation_time", tableId: 1 } },
    ]);
    expect(created.developerIndexDefinitions).toMatchObject([
      {
        indexDefinitionId: 2,
        access: { kind: "developer", tableId: 1, logicalIndexId: 1 },
      },
    ]);
    expect(created.schemaVersionIndexBindings).toMatchObject([
      { logicalIndexId: 1, indexDefinitionId: 2 },
    ]);
    await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
      tables: 1,
      indexes: 1,
      schemaVersions: 1,
      definitions: 2,
      schemaBindings: 1,
      buildStates: 0,
    });
  });

  it("snapshots once, then replans and rehashes every stale attempt", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_facade_stale";
    await insertDeployment(persistence, deploymentId);
    const input = publicationInput(
      deploymentId,
      "schema_catalog_v2_facade_stale",
    );
    const initial = await prepareAppSchemaCatalogPublicationV2(
      persistence.drizzle,
      input,
    );
    const initialState = getPreparedAppSchemaCatalogPublicationV2State(initial);
    const initialCanonical = await canonicalizeSchemaManifestV1(
      decodeSchemaManifestJson(initialState.logicalBindings.manifest),
    );
    let transactionAttempts = 0;
    const digest = vi.spyOn(crypto.subtle, "digest");
    const digestCountsAtTransaction: number[] = [];
    const repository = {
      db: persistence.drizzle,
      async runTransaction<Result>(
        run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionAttempts += 1;
        digestCountsAtTransaction.push(digest.mock.calls.length);
        if (transactionAttempts === 1) {
          const firstTable = input.tables[0];
          const firstIndex = input.indexes[0];
          if (firstTable === undefined || firstIndex === undefined) {
            throw new Error("Expected mutable V2 facade fixtures.");
          }
          replaceOwnDataProperty(firstTable, "logicalName", "mutatedAfterCall");
          replaceOwnDataProperty(firstIndex.fields, 0, "mutatedAfterCall");
          await persistence.drizzle.transaction((tx) =>
            ensureStableTableIdentityInTransaction(tx, {
              deploymentId,
              namespace: "payload",
              logicalName: "allocator_winner",
            })
          );
        }
        return persistence.drizzle.transaction(run);
      },
    } satisfies AppSchemaVersionArtifactV2Repository;

    try {
      const result = await ensureAppSchemaVersionArtifactV2WithRepository(
        repository,
        input,
      );

      expect(transactionAttempts).toBe(2);
      expect(digestCountsAtTransaction).toHaveLength(2);
      expect(digestCountsAtTransaction[1]).toBeGreaterThan(
        digestCountsAtTransaction[0] ?? 0,
      );
      expect(result.manifest.tableDefinitions.tables).toMatchObject([
        { logicalName: "users", tableId: 2 },
      ]);
      expect(result.manifest.indexBindings.indexes).toMatchObject([
        { descriptor: "byEmail", logicalIndexId: 1, tableId: 2 },
      ]);
      expect(Array.from(result.artifact.manifestSha256)).not.toEqual(
        Array.from(initialCanonical.sha256),
      );
      await expect(catalogCounts(persistence, deploymentId)).resolves.toEqual({
        tables: 2,
        indexes: 1,
        schemaVersions: 1,
        definitions: 2,
        schemaBindings: 1,
        buildStates: 0,
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("retries only typed combined-stale outcomes and retains the last cause", async () => {
    const staleErrors = Array.from(
      { length: MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS },
      (_, attempt) =>
        new SchemaManifestAppSchemaBindingPlanStaleError({
          reason: "tableCatalogHighWaterChanged",
          observedTableId: null,
          currentTableId: CatalogTableIdSchema.make(attempt + 1),
        }),
    );
    let attempts = 0;

    const exhausted = await runAppSchemaVersionArtifactV2Attempts(
      "deployment_catalog_v2_exhausted",
      async () => {
        const stale = staleErrors[attempts];
        attempts += 1;
        if (stale === undefined) {
          throw new Error("Expected a typed stale fixture.");
        }
        throw stale;
      },
    ).catch((error: unknown) => error);

    expect(attempts).toBe(MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS);
    expect(exhausted).toBeInstanceOf(
      AppSchemaVersionArtifactV2RetryExhaustedError,
    );
    expect(exhausted).toMatchObject({
      deploymentId: "deployment_catalog_v2_exhausted",
      attempts: MAX_APP_SCHEMA_VERSION_ARTIFACT_V2_ATTEMPTS,
      lastStale: staleErrors.at(-1)?.stale,
      cause: staleErrors.at(-1),
    });

    const terminal = new Error("terminal V2 failure");
    let terminalAttempts = 0;
    const rejected = await runAppSchemaVersionArtifactV2Attempts(
      "deployment_catalog_v2_terminal",
      async () => {
        terminalAttempts += 1;
        throw terminal;
      },
    ).catch((error: unknown) => error);
    expect(terminalAttempts).toBe(1);
    expect(rejected).toBe(terminal);
  });

  it("enforces fixed declaration and canonical-byte quotas at their boundaries", () => {
    expect(() =>
      enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
        Array.from({
          length: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS,
        }),
        [],
      )
    ).not.toThrow();
    expect(() =>
      enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
        Array.from({
          length:
            MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
        }),
        [],
      )
    ).toThrowError(
      new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "definitionWorkItemCountExceeded",
        tableCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
        developerIndexCount: 0,
        actualCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
        maximumCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS,
      }),
    );
    expect(() =>
      enforceAppSchemaCatalogPublicationV2CanonicalByteQuota(
        MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
      )
    ).not.toThrow();
    expect(() =>
      enforceAppSchemaCatalogPublicationV2CanonicalByteQuota(
        MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES + 1,
      )
    ).toThrowError(
      new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "canonicalBytesExceeded",
        actualBytes: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES + 1,
        maximumBytes: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
      }),
    );
    expect(() =>
      enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
        Array.from({
          length: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES + 1,
        }),
        [],
      )
    ).toThrowError(
      new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "tableCountExceeded",
        actualCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES + 1,
        maximumCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES,
      }),
    );
    expect(() =>
      enforceAppSchemaCatalogPublicationV2DeclarationQuotas(
        [],
        Array.from({
          length:
            MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES + 1,
        }),
      )
    ).toThrowError(
      new AppSchemaCatalogPublicationV2QuotaExceededError({
        reason: "developerIndexCountExceeded",
        actualCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES + 1,
        maximumCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEVELOPER_INDEXES,
      }),
    );
  });

  it("rejects declaration counts before reading the catalog or opening a transaction", async () => {
    let databaseRead = false;
    let transactionOpened = false;
    const repository = {
      get db(): never {
        databaseRead = true;
        throw new Error("The catalog must not be read for a count violation.");
      },
      async runTransaction<Result>(
        _run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionOpened = true;
        throw new Error("A count violation must not open a transaction.");
      },
    } satisfies AppSchemaVersionArtifactV2Repository;
    const valid = publicationInput(
      "deployment_catalog_v2_count_quota",
      "schema_catalog_v2_count_quota",
    );

    await expect(
      ensureAppSchemaVersionArtifactV2WithRepository(repository, {
        ...valid,
        tables: Array.from(
          { length: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES + 1 },
          () => appTable("users"),
        ),
      }),
    ).rejects.toMatchObject({
      name: "AppSchemaCatalogPublicationV2QuotaExceededError",
      issue: {
        reason: "tableCountExceeded",
        actualCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES + 1,
        maximumCount: MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_TABLES,
      },
    });
    expect(databaseRead).toBe(false);
    expect(transactionOpened).toBe(false);

    await expect(
      ensureAppSchemaVersionArtifactV2WithRepository(repository, {
        ...valid,
        tables: Array.from(
          {
            length:
              MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
          },
          (_, index) => appTable(`table${index}`),
        ),
        indexes: [],
      }),
    ).rejects.toMatchObject({
      name: "AppSchemaCatalogPublicationV2QuotaExceededError",
      issue: {
        reason: "definitionWorkItemCountExceeded",
        tableCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
        developerIndexCount: 0,
        actualCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS + 1,
        maximumCount:
          MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_DEFINITION_WORK_ITEMS,
      },
    });
    expect(databaseRead).toBe(false);
    expect(transactionOpened).toBe(false);
  });

  it("rejects JSON-escape amplification before cloning or catalog access", async () => {
    let databaseRead = false;
    let transactionOpened = false;
    const repository = {
      get db(): never {
        databaseRead = true;
        throw new Error("The catalog must not be read for an early byte violation.");
      },
      async runTransaction<Result>(
        _run: (tx: StableTableCatalogTransaction) => Promise<Result>,
      ): Promise<Result> {
        transactionOpened = true;
        throw new Error("An early byte violation must not open a transaction.");
      },
    } satisfies AppSchemaVersionArtifactV2Repository;
    const clone = vi.spyOn(globalThis, "structuredClone");
    const escapedControlLiteral = "\u0001".repeat(
      Math.floor(
        MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES / 6,
      ) + 1,
    );

    try {
      await expect(
        ensureAppSchemaVersionArtifactV2WithRepository(repository, {
          deploymentId: "deployment_catalog_v2_oversized",
          schemaVersionId: CatalogSchemaVersionIdSchema.make(
            "schema_catalog_v2_oversized",
          ),
          version: CatalogSchemaVersionSchema.make(1),
          tables: [literalTable("oversized", escapedControlLiteral)],
          indexes: [],
        }),
      ).rejects.toMatchObject({
        name: "AppSchemaCatalogPublicationV2QuotaExceededError",
        issue: {
          reason: "canonicalByteLowerBoundExceeded",
          maximumBytes:
            MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
        },
      });
      expect(clone).not.toHaveBeenCalled();
      expect(databaseRead).toBe(false);
      expect(transactionOpened).toBe(false);
    } finally {
      clone.mockRestore();
    }
  });

  it("retains the exact post-preparation byte gate before the transaction", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_catalog_v2_exact_byte_fallback";
    await insertDeployment(persistence, deploymentId);
    const baseline = await prepareAppSchemaCatalogPublicationV2(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_catalog_v2_exact_byte_calibration",
        ),
        version: CatalogSchemaVersionSchema.make(1),
        tables: [literalTable("exactFallback", "")],
        indexes: [],
      },
    );
    const baselineState =
      getPreparedAppSchemaCatalogPublicationV2State(baseline);
    const baselineCanonical = await canonicalizeSchemaManifestV1(
      decodeSchemaManifestJson(baselineState.logicalBindings.manifest),
    );
    const literalLength =
      MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES -
      baselineCanonical.canonicalBytes.byteLength +
      1;
    if (literalLength <= 0) {
      throw new Error("Expected positive exact-byte fallback fixture length.");
    }
    const transaction = vi.spyOn(persistence.drizzle, "transaction");

    try {
      await expect(
        persistence.ensureAppSchemaVersionArtifactV2({
          deploymentId,
          schemaVersionId: CatalogSchemaVersionIdSchema.make(
            "schema_catalog_v2_exact_byte_fallback",
          ),
          version: CatalogSchemaVersionSchema.make(2),
          tables: [
            literalTable("exactFallback", "x".repeat(literalLength)),
          ],
          indexes: [],
        }),
      ).rejects.toMatchObject({
        name: "AppSchemaCatalogPublicationV2QuotaExceededError",
        issue: {
          reason: "canonicalBytesExceeded",
          actualBytes:
            MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES + 1,
          maximumBytes:
            MAX_APP_SCHEMA_CATALOG_PUBLICATION_V2_CANONICAL_BYTES,
        },
      });
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      transaction.mockRestore();
    }
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertDeployment(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function publicationInput(deploymentId: string, schemaVersionId: string) {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [appIndex("users", "byEmail", ["email"])],
  };
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

function literalTable(
  logicalName: string,
  literal: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          oversized: {
            fieldType: { type: "literal", value: literal },
            optional: false,
          },
        },
      },
    },
  };
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

async function catalogCounts(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<{
  readonly tables: number;
  readonly indexes: number;
  readonly schemaVersions: number;
  readonly definitions: number;
  readonly schemaBindings: number;
  readonly buildStates: number;
}> {
  const result = await persistence.query<{
    tables: number;
    indexes: number;
    schema_versions: number;
    definitions: number;
    schema_bindings: number;
    build_states: number;
  }>(
    `
      select
        (select count(*)::int from fx_control_table where deployment_id = $1) as tables,
        (select count(*)::int from fx_control_index where deployment_id = $1) as indexes,
        (select count(*)::int from fx_control_schema_version where deployment_id = $1) as schema_versions,
        (select count(*)::int from fx_control_index_definition where deployment_id = $1) as definitions,
        (select count(*)::int from fx_control_schema_version_index_binding where deployment_id = $1) as schema_bindings,
        (select count(*)::int from fx_system_index_build_state) as build_states
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected catalog count row.");
  return {
    tables: row.tables,
    indexes: row.indexes,
    schemaVersions: row.schema_versions,
    definitions: row.definitions,
    schemaBindings: row.schema_bindings,
    buildStates: row.build_states,
  };
}

function replaceOwnDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
