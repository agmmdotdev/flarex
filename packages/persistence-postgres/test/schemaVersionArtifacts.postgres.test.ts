import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import type {
  EnsureSchemaVersionArtifactInput,
  EnsureSchemaVersionArtifactResult,
} from "../src";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByVersionEffect,
  prepareSchemaVersionArtifactEffect,
  SchemaVersionArtifactConflictError,
} from "../src/schemaVersionArtifacts";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const version1 = CatalogSchemaVersionSchema.make(1);

const prepareSchemaVersionArtifact = (
  ...args: Parameters<typeof prepareSchemaVersionArtifactEffect>
) => runEffect(prepareSchemaVersionArtifactEffect(...args));

const ensureSchemaVersionArtifactInTransaction = (
  ...args: Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>
) => runEffect(ensureSchemaVersionArtifactInTransactionEffect(...args));

const getSchemaVersionArtifactByVersion = (
  ...args: Parameters<typeof getSchemaVersionArtifactByVersionEffect>
) => runEffect(getSchemaVersionArtifactByVersionEffect(...args));

describePostgres("real Postgres schema version artifacts", () => {
  it("converges concurrent exact artifact replays", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await persistence.insertDeploymentMetadata({
        deploymentId: "deployment_schema_artifact_replay",
        projectId: "project_schema_artifact_replay",
      });
      const input = {
        deploymentId: "deployment_schema_artifact_replay",
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_artifact_replay",
        ),
        version: version1,
        manifest: {
          tables: [{ name: "users", fields: { name: "string" } }],
        },
      } satisfies EnsureSchemaVersionArtifactInput;

      const results = await Promise.all(
        Array.from({ length: 8 }, () => ensure(persistence, input)),
      );

      expect(results.filter((result) => result.status === "created"))
        .toHaveLength(1);
      expect(results.filter((result) => result.status === "existing"))
        .toHaveLength(7);
      expect(
        new Set(results.map((result) => result.artifact.createdAt.getTime()))
          .size,
      ).toBe(1);
      expect(
        new Set(results.map((result) => toHex(result.artifact.manifestSha256)))
          .size,
      ).toBe(1);
      const rows = await persistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_schema_version`,
      );
      expect(rows.rows).toEqual([{ count: "1" }]);
    });
  }, 30_000);

  it("serializes conflicting claims for one deployment version", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_artifact_conflict";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_schema_artifact_conflict",
      });
      await persistence.query(`
        create function fx_schema_artifact_insert_delay() returns trigger
        language plpgsql
        as $$
        begin
          perform pg_sleep(0.05);
          return new;
        end
        $$
      `);
      await persistence.query(`
        create trigger fx_schema_artifact_insert_delay
        before insert on fx_control_schema_version
        for each row execute function fx_schema_artifact_insert_delay()
      `);
      const inputs = Array.from(
        { length: 8 },
        (_, index) =>
          ({
            deploymentId,
            schemaVersionId: CatalogSchemaVersionIdSchema.make(
              `schema_artifact_conflict_${index}`,
            ),
            version: version1,
            manifest: { candidate: index } satisfies SchemaManifestJson,
          }) satisfies EnsureSchemaVersionArtifactInput,
      );

      const attempts = await Promise.all(
        inputs.map((input) => attemptEnsure(persistence, input)),
      );
      const fulfilled = attempts.filter(
        (attempt) => attempt.status === "fulfilled",
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === "rejected",
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]?.result.status).toBe("created");
      expect(rejected).toHaveLength(7);
      for (const attempt of rejected) {
        expect(attempt.error).toBeInstanceOf(
          SchemaVersionArtifactConflictError,
        );
        expect(attempt.error).toMatchObject({
          conflict: { reason: "versionReused" },
        });
      }
      const winner = fulfilled[0]?.result.artifact;
      if (winner === undefined) {
        throw new Error("Concurrent schema artifact registration had no winner.");
      }
      await expect(
        getSchemaVersionArtifactByVersion(
          persistence.drizzle,
          deploymentId,
          version1,
        ),
      ).resolves.toEqual(winner);
      const rows = await persistence.query<{ count: string }>(
        `select count(*)::text as count from fx_control_schema_version`,
      );
      expect(rows.rows).toEqual([{ count: "1" }]);
    });
  }, 30_000);
});

type EnsureAttempt =
  | {
      readonly status: "fulfilled";
      readonly result: EnsureSchemaVersionArtifactResult;
    }
  | {
      readonly status: "rejected";
      readonly error: unknown;
    };

async function attemptEnsure(
  persistence: PostgresFlarexPersistence,
  input: EnsureSchemaVersionArtifactInput,
): Promise<EnsureAttempt> {
  try {
    return { status: "fulfilled", result: await ensure(persistence, input) };
  } catch (error) {
    return { status: "rejected", error };
  }
}

async function ensure(
  persistence: PostgresFlarexPersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await prepareSchemaVersionArtifact(input);
  return persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, prepared),
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
