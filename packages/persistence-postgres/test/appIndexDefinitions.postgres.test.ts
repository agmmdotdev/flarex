import {
  type CatalogIndexId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
} from "flarex-protocol/index-definition";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  type CatalogSchemaVersionId,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import {
  prepareAppSchemaPublicationV1,
} from "../src/appSchemaPublicationPreparation";
import {
  AppSchemaVersionIndexBindingConflictError,
  ensureAppCreationTimeIndexDefinitionV1InTransaction,
  ensureAppDeveloperIndexDefinitionBindingV1InTransaction,
  prepareAppCreationTimeIndexDefinitionsV1,
  prepareAppDeveloperIndexDefinitionBindingV1,
  type PreparedAppCreationTimeIndexDefinitionV1,
  type PreparedAppDeveloperIndexDefinitionBindingV1,
} from "../src/appIndexDefinitions";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  applySchemaManifestAppSchemaBindingsV1InTransaction,
  prepareSchemaManifestAppSchemaBindingsV1,
} from "../src/schemaManifestAppSchemaBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  prepareSchemaVersionArtifact,
} from "../src/schemaVersionArtifacts";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
  type HeldPostgresDeploymentLock,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres immutable app index definitions", () => {
  it("converges concurrent exact definition and binding replay", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_definition_pg_replay";
      const registered = await registerAppSchemaVersion(
        persistence,
        deploymentId,
        "schema_definition_pg_replay",
        ["email"],
      );
      const prepared = await prepareDefinition(registered);
      const held = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const operations = [
        ensurePrepared(persistence, prepared),
        ensurePrepared(persistence, prepared),
      ] as const;

      await releaseAfterBlocked(held, persistence, 2, operations);
      const results = await Promise.all(operations);
      expect(results.map((result) => result.definitionStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(results.map((result) => result.bindingStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(results[0].definition.indexDefinitionId).toBe(1);
      expect(results[1].definition.indexDefinitionId).toBe(1);
      await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
        definitions: 1,
        bindings: 1,
      });
    });
  }, 30_000);

  it("converges concurrent exact table-owned creation-time replay", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_creation_time_pg_replay";
      await registerAppSchemaVersion(
        persistence,
        deploymentId,
        "schema_creation_time_pg_parent",
        ["email"],
      );
      const publication = await prepareAppSchemaPublicationV1(
        persistence.drizzle,
        {
          deploymentId,
          schemaVersionId: CatalogSchemaVersionIdSchema.make(
            "schema_creation_time_pg_plan",
          ),
          version: CatalogSchemaVersionSchema.make(2),
          tables: [appTable("users")],
          indexes: [],
        },
      );
      const prepared = prepareAppCreationTimeIndexDefinitionsV1(publication)[0];
      if (prepared === undefined) {
        throw new Error("Expected one creation-time definition token.");
      }
      const held = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const operations = [
        ensureCreationTimePrepared(persistence, prepared),
        ensureCreationTimePrepared(persistence, prepared),
      ] as const;

      await releaseAfterBlocked(held, persistence, 2, operations);
      const results = await Promise.all(operations);
      expect(results.map((result) => result.definitionStatus).sort()).toEqual([
        "created",
        "existing",
      ]);
      expect(results[0].definition.indexDefinitionId).toBe(1);
      expect(results[1].definition.indexDefinitionId).toBe(1);
      expect(results[0].definition.access).toEqual({
        kind: "by_creation_time",
        tableId: 1,
      });
      await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
        definitions: 1,
        bindings: 0,
      });
    });
  }, 30_000);

  it("gives competing schema bindings one winner without an orphan definition", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_definition_pg_competing";
      const registered = await registerAppSchemaVersion(
        persistence,
        deploymentId,
        "schema_definition_pg_competing",
        ["email"],
      );
      const email = await prepareDefinition(registered);
      const profileEmail = await prepareAppDeveloperIndexDefinitionBindingV1({
        ...registered,
        logicalSpec: decodeSchemaManifestAppDeveloperOrderedIndexSpecV1({
          kind: "developerOrdered",
          specVersion: 1,
          fields: ["profile.email"],
        }),
      });
      const held = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const operations = [
        attemptEnsure(persistence, "email", email),
        attemptEnsure(persistence, "profile.email", profileEmail),
      ];

      await releaseAfterBlocked(held, persistence, 2, operations);
      const outcomes = await Promise.all(operations);
      const fulfilled = outcomes.filter(
        (outcome) => outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter(
        (outcome) => outcome.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const loser = rejected[0];
      if (loser?.status !== "rejected") {
        throw new Error("Expected one rejected physical definition binding.");
      }
      expect(loser.error).toBeInstanceOf(
        AppSchemaVersionIndexBindingConflictError,
      );
      await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
        definitions: 1,
        bindings: 1,
      });
    });
  }, 30_000);

  it("rolls definition identity and binding back with the caller transaction", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_definition_pg_rollback";
      const registered = await registerAppSchemaVersion(
        persistence,
        deploymentId,
        "schema_definition_pg_rollback",
        ["email"],
      );
      const prepared = await prepareDefinition(registered);

      await expect(
        persistence.drizzle.transaction(async (tx) => {
          await runEffect(
            ensureAppDeveloperIndexDefinitionBindingV1InTransaction(
              tx,
              prepared,
            ),
          );
          throw new Error("injected real Postgres definition rollback");
        }),
      ).rejects.toThrow("injected real Postgres definition rollback");
      await expect(definitionCounts(persistence, deploymentId)).resolves.toEqual({
        definitions: 0,
        bindings: 0,
      });
      const committed = await ensurePrepared(persistence, prepared);
      expect(committed.definition.indexDefinitionId).toBe(1);
    });
  }, 30_000);

  it("rejects a TOAST-compressed oversized spec by logical JSON text size", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_definition_pg_logical_size";
      const registered = await registerAppSchemaVersion(
        persistence,
        deploymentId,
        "schema_definition_pg_logical_size",
        ["email"],
      );
      const ensured = await ensurePrepared(
        persistence,
        await prepareDefinition(registered),
      );
      const oversizedJson = JSON.stringify({
        ...ensured.definition.physicalSpec,
        orderedFields: [
          { kind: "documentPath", path: "a".repeat(131_073) },
        ],
      });
      const client = await persistence.pool.connect();
      try {
        await client.query(
          "create temporary table compressed_index_spec (payload jsonb)",
        );
        await client.query(
          "alter table compressed_index_spec alter column payload set storage extended",
        );
        await client.query(
          "insert into compressed_index_spec (payload) values ($1::jsonb)",
          [oversizedJson],
        );
        const measurements = await client.query<{
          stored_size: number;
          logical_size: number;
        }>(
          `
            select
              pg_column_size(payload)::int as stored_size,
              octet_length(payload::text)::int as logical_size
            from compressed_index_spec
          `,
        );
        const measurement = measurements.rows[0];
        expect(measurement?.stored_size).toBeLessThanOrEqual(
          MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
        );
        expect(measurement?.logical_size).toBeGreaterThan(
          MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1,
        );

        await expect(
          client.query(
            `
              insert into fx_control_index_definition
                (
                  deployment_id,
                  index_definition_id,
                  access_kind,
                  access_identity_id,
                  table_id,
                  logical_index_id,
                  physical_spec_codec_version,
                  physical_spec_json,
                  physical_spec_bytes,
                  physical_spec_sha256
                )
              select $1, 90, 'developer', $2, $3, $2, 1, payload, $4, $5
              from compressed_index_spec
            `,
            [
              deploymentId,
              registered.logicalIndexId,
              registered.tableId,
              new Uint8Array([1]),
              new Uint8Array(32).fill(1),
            ],
          ),
        ).rejects.toThrow();
      } finally {
        client.release();
      }
    });
  }, 30_000);
});

interface RegisteredDefinitionInput {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly logicalSpec: ReturnType<
    typeof decodeSchemaManifestAppDeveloperOrderedIndexSpecV1
  >;
}

type EnsureAttempt =
  | {
      readonly status: "fulfilled";
      readonly label: string;
      readonly indexDefinitionId: number;
    }
  | {
      readonly status: "rejected";
      readonly label: string;
      readonly error: unknown;
    };

async function registerAppSchemaVersion(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  schemaVersionIdValue: string,
  fields: ReadonlyArray<string>,
): Promise<RegisteredDefinitionInput> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
  const plan = await prepareSchemaManifestAppSchemaBindingsV1(
    persistence.drizzle,
    {
      deploymentId,
      tables: [appTable("users")],
      indexes: [appIndex("users", "by_email", fields)],
    },
  );
  const manifest = await persistence.drizzle.transaction((tx) =>
    applySchemaManifestAppSchemaBindingsV1InTransaction(tx, plan)
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    schemaVersionIdValue,
  );
  const artifact = await prepareSchemaVersionArtifact({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    manifest,
  });
  await persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, artifact)
  );
  const table = manifest.tableDefinitions.tables[0];
  const index = manifest.indexBindings.indexes[0];
  if (table === undefined || index === undefined) {
    throw new Error("Registered real-Postgres schema has no app index.");
  }
  return Object.freeze({
    deploymentId,
    schemaVersionId,
    tableId: table.tableId,
    logicalIndexId: index.logicalIndexId,
    logicalSpec: index.spec,
  });
}

function prepareDefinition(
  input: RegisteredDefinitionInput,
): Promise<PreparedAppDeveloperIndexDefinitionBindingV1> {
  return prepareAppDeveloperIndexDefinitionBindingV1(input);
}

function ensurePrepared(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedAppDeveloperIndexDefinitionBindingV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppDeveloperIndexDefinitionBindingV1InTransaction(tx, prepared),
    )
  );
}

function ensureCreationTimePrepared(
  persistence: PostgresFlarexPersistence,
  prepared: PreparedAppCreationTimeIndexDefinitionV1,
) {
  return persistence.drizzle.transaction((tx) =>
    runEffect(
      ensureAppCreationTimeIndexDefinitionV1InTransaction(tx, prepared),
    )
  );
}

async function attemptEnsure(
  persistence: PostgresFlarexPersistence,
  label: string,
  prepared: PreparedAppDeveloperIndexDefinitionBindingV1,
): Promise<EnsureAttempt> {
  try {
    const result = await ensurePrepared(persistence, prepared);
    return {
      status: "fulfilled",
      label,
      indexDefinitionId: result.definition.indexDefinitionId,
    };
  } catch (error) {
    return { status: "rejected", label, error };
  }
}

async function releaseAfterBlocked(
  lock: HeldPostgresDeploymentLock,
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
  operations: ReadonlyArray<Promise<unknown>>,
): Promise<void> {
  let released = false;
  let setupError: unknown;
  try {
    await waitForBlockedPostgresDeploymentLocks(
      persistence,
      lock,
      expectedBlocked,
    );
    await lock.client.query("commit");
    released = true;
  } catch (error) {
    setupError = error;
  } finally {
    if (!released) {
      await lock.client.query("rollback").catch(() => undefined);
    }
    lock.client.release();
  }
  if (setupError !== undefined) {
    await Promise.allSettled(operations);
    throw setupError;
  }
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
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
            optional: true,
          },
          profile: {
            fieldType: {
              type: "object",
              value: {
                email: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
            optional: true,
          },
        },
      },
    },
  };
}

async function definitionCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<{ readonly definitions: number; readonly bindings: number }> {
  const result = await persistence.query<{
    definitions: number;
    bindings: number;
  }>(
    `
      select
        (
          select count(*)::int
          from fx_control_index_definition
          where deployment_id = $1
        ) as definitions,
        (
          select count(*)::int
          from fx_control_schema_version_index_binding
          where deployment_id = $1
        ) as bindings
    `,
    [deploymentId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Definition count query returned no row.");
  return row;
}
