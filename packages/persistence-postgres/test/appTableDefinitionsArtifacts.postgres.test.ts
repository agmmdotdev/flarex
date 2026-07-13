import {
  canonicalizeSchemaManifestV1,
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  decodeSchemaManifestJson,
  decodeSchemaManifestTableDefinitionsV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestTableDefinitionsV1,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import type {
  EnsureAppTableDefinitionsArtifactV1Input,
  EnsureAppTableDefinitionsArtifactV1Result,
  EnsureSchemaVersionArtifactInput,
} from "../src";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { prepareSchemaManifestAppTableBindingsV1 } from "../src/schemaManifestTableBindings";
import {
  ensureSchemaVersionArtifactInTransaction,
  getSchemaVersionArtifactByVersion,
  prepareSchemaVersionArtifact,
} from "../src/schemaVersionArtifacts";
import {
  ensureStableTableIdentityInTransaction,
  getStableTableIdentityByName,
} from "../src/stableTableCatalog";
import {
  acquirePostgresDeploymentLock,
  postgresUrl,
  waitForBlockedPostgresDeploymentLocks,
  withTemporaryPostgresPersistence,
  type HeldPostgresDeploymentLock,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres table-definitions artifact compatibility", () => {
  it("converges concurrent exact mapping and artifact publications", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_replay";
      await insertDeployment(persistence, deploymentId);
      const input = appSchemaInput(
        deploymentId,
        "schema_app_pg_replay",
        ["users", "products"],
      );
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const publications = [
        attemptPublication(persistence, input),
        attemptPublication(persistence, input),
      ] as const;

      await releaseAfterBlocked(lock, persistence, 2, publications);
      const attempts = await Promise.all(publications);
      const fulfilled = attempts.filter(
        (attempt) => attempt.status === "fulfilled",
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === "rejected",
      );
      expect(rejected).toEqual([]);
      expect(fulfilled).toHaveLength(2);
      expect(
        fulfilled.map((attempt) => attempt.result.status).sort(),
      ).toEqual(["created", "existing"]);
      const first = fulfilled[0]?.result;
      if (first === undefined) {
        throw new Error("Expected one fulfilled app schema publication.");
      }
      const section = decodeSchemaManifestTableDefinitionsV1(
        first.artifact.manifestJson,
      );
      await expectCatalogMatchesSection(
        persistence,
        deploymentId,
        section,
      );
      await expect(rowCounts(persistence, deploymentId)).resolves.toEqual({
        artifacts: 1,
        tables: 2,
      });
    });
  }, 30_000);

  it("replans and rehashes after an existing allocator wins the lock queue", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_stale";
      await insertDeployment(persistence, deploymentId);
      const input = appSchemaInput(
        deploymentId,
        "schema_app_pg_stale",
        ["users"],
      );
      const initialBindings = await prepareSchemaManifestAppTableBindingsV1(
        persistence.drizzle,
        { deploymentId, tables: input.tables },
      );
      const initialCanonical = await canonicalizeSchemaManifestV1(
        decodeSchemaManifestJson(initialBindings.section),
      );
      const lock = await acquirePostgresDeploymentLock(
        persistence,
        deploymentId,
      );
      const allocation = persistence.drizzle.transaction((tx) =>
        ensureStableTableIdentityInTransaction(tx, {
          deploymentId,
          namespace: "payload",
          logicalName: "allocator_winner",
        }),
      );
      let publication: Promise<PublicationAttempt> | undefined;
      let released = false;
      let setupError: unknown;
      try {
        await waitForBlockedPostgresDeploymentLocks(persistence, lock, 1);
        publication = attemptPublication(persistence, input);
        await waitForBlockedPostgresDeploymentLocks(persistence, lock, 2);
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
        await Promise.allSettled(
          publication === undefined
            ? [allocation]
            : [allocation, publication],
        );
        throw setupError;
      }

      await expect(allocation).resolves.toMatchObject({
        status: "created",
        table: { tableId: 1 },
      });
      if (publication === undefined) {
        throw new Error("Expected the app schema publication to be queued.");
      }
      const publicationAttempt = await publication;
      if (publicationAttempt.status !== "fulfilled") {
        throw publicationAttempt.error;
      }
      expect(publicationAttempt.result.status).toBe("created");
      const section = decodeSchemaManifestTableDefinitionsV1(
        publicationAttempt.result.artifact.manifestJson,
      );
      expect(tableIdentities(section)).toEqual([
        { logicalName: "users", tableId: 2 },
      ]);
      expect(
        Array.from(publicationAttempt.result.artifact.manifestSha256),
      ).not.toEqual(Array.from(initialCanonical.sha256));
      await expectCatalogMatchesSection(
        persistence,
        deploymentId,
        section,
      );
      await expect(rowCounts(persistence, deploymentId)).resolves.toEqual({
        artifacts: 1,
        tables: 2,
      });
    });
  }, 30_000);

  it("rolls mapping inserts back when immutable artifact replay conflicts", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_app_schema_pg_conflict";
      await insertDeployment(persistence, deploymentId);
      const input = appSchemaInput(
        deploymentId,
        "schema_app_pg_conflict",
        ["users"],
      );
      const existing = await ensureArtifact(persistence, {
        deploymentId,
        schemaVersionId: input.schemaVersionId,
        version: input.version,
        manifest: { existing: true },
      });

      const attempt = await attemptPublication(persistence, input);

      expect(attempt).toMatchObject({
        status: "rejected",
        error: {
          name: "SchemaVersionArtifactConflictError",
          conflict: { reason: "artifactMismatch" },
        },
      });
      await expect(
        getStableTableIdentityByName(persistence.drizzle, {
          deploymentId,
          namespace: "app",
          logicalName: "users",
        }),
      ).resolves.toBeNull();
      const next = await persistence.drizzle.transaction((tx) =>
        ensureStableTableIdentityInTransaction(tx, {
          deploymentId,
          namespace: "payload",
          logicalName: "after_failed_publication",
        }),
      );
      expect(next.table.tableId).toBe(1);
      await expect(
        getSchemaVersionArtifactByVersion(
          persistence.drizzle,
          deploymentId,
          input.version,
        ),
      ).resolves.toEqual(existing.artifact);
    });
  }, 30_000);
});

type PublicationAttempt =
  | {
      readonly status: "fulfilled";
      readonly result: EnsureAppTableDefinitionsArtifactV1Result;
    }
  | {
      readonly status: "rejected";
      readonly error: unknown;
    };

async function attemptPublication(
  persistence: PostgresFlarexPersistence,
  input: EnsureAppTableDefinitionsArtifactV1Input,
): Promise<PublicationAttempt> {
  try {
    return {
      status: "fulfilled",
      result: await persistence.ensureAppTableDefinitionsArtifactV1(input),
    };
  } catch (error) {
    return { status: "rejected", error };
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

async function insertDeployment(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function appSchemaInput(
  deploymentId: string,
  schemaVersionId: string,
  logicalNames: ReadonlyArray<string>,
): EnsureAppTableDefinitionsArtifactV1Input {
  return {
    deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
    version: CatalogSchemaVersionSchema.make(1),
    tables: logicalNames.map(appDeclaration),
  };
}

function appDeclaration(
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
          name: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

function tableIdentities(
  section: SchemaManifestTableDefinitionsV1,
): ReadonlyArray<{ readonly logicalName: string; readonly tableId: number }> {
  return section.tables.map((table) => ({
    logicalName: table.logicalName,
    tableId: table.tableId,
  }));
}

async function expectCatalogMatchesSection(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
  section: SchemaManifestTableDefinitionsV1,
): Promise<void> {
  const rows = await persistence.query<CatalogRow>(
    `
      select
        deployment_id as "deploymentId",
        logical_name as "logicalName",
        namespace,
        table_id as "tableId"
      from fx_control_table
      where deployment_id = $1
      order by table_id
    `,
    [deploymentId],
  );
  for (const table of section.tables) {
    expect(rows.rows).toContainEqual({
      deploymentId,
      logicalName: table.logicalName,
      namespace: table.namespace,
      tableId: table.tableId,
    });
  }
}

interface CatalogRow extends Record<string, unknown> {
  deploymentId: string;
  logicalName: string;
  namespace: string;
  tableId: number;
}

async function rowCounts(
  persistence: PostgresFlarexPersistence,
  deploymentId: string,
): Promise<{ readonly artifacts: number; readonly tables: number }> {
  const [artifactRows, tableRows] = await Promise.all([
    persistence.query<{ count: number }>(
      `
        select count(*)::int as count
        from fx_control_schema_version
        where deployment_id = $1
      `,
      [deploymentId],
    ),
    persistence.query<{ count: number }>(
      `
        select count(*)::int as count
        from fx_control_table
        where deployment_id = $1
      `,
      [deploymentId],
    ),
  ]);
  return {
    artifacts: artifactRows.rows[0]?.count ?? 0,
    tables: tableRows.rows[0]?.count ?? 0,
  };
}

async function ensureArtifact(
  persistence: PostgresFlarexPersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await prepareSchemaVersionArtifact(input);
  return persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, prepared),
  );
}
