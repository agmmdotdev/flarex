import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import type {
  EnsureSchemaVersionArtifactInput,
  EnsureSchemaVersionArtifactResult,
} from "../../../src";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import {
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
} from "../../../src/storage/catalog/appSchemaPublicationPolicy";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByVersionEffect,
  prepareSchemaVersionArtifactEffect,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactConflictError,
} from "../../../src/storage/catalog/schemaVersionArtifacts";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
  withTemporaryPostgresPersistence,
} from "../../support/postgresHelpers";

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

describePostgres("real Postgres schema version artifacts", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence();

  it("converges concurrent exact artifact replays", async () => {
    await withPersistence(async (persistence) => {
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

      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, () => ensure(persistence, input)),
      );
      const results = attempts.map(attempt => {
        if (attempt.status === "rejected") throw attempt.reason;
        return attempt.value;
      });

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

  it("size-gates oversized stored evidence before worker hashing", async () => {
    await withPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_artifact_size_gate";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_schema_artifact_size_gate",
      });
      await ensure(persistence, {
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_artifact_size_gate",
        ),
        version: version1,
        manifest: { ok: true },
      });
      await persistence.query(
        `
          update fx_control_schema_version
          set manifest_bytes = decode(repeat('00', $2), 'hex')
          where deployment_id = $1
        `,
        [
          deploymentId,
          MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
        ],
      );
      const digest = vi.spyOn(crypto.subtle, "digest");
      try {
        const failure = await runEffectFailure(
          getSchemaVersionArtifactByVersionEffect(
            persistence.drizzle,
            deploymentId,
            version1,
          ),
        );

        expect(failure).toBeInstanceOf(
          SchemaVersionArtifactCorruptionError,
        );
        expect(failure).toMatchObject({
          deploymentId,
          detail: "manifest evidence exceeds the artifact read limit",
        });
        expect(digest).not.toHaveBeenCalled();
      } finally {
        digest.mockRestore();
      }
    });
  }, 60_000);

  it("corroborates timestamp microseconds across session time zones", async () => {
    await withPersistence(async (persistence) => {
      const deploymentId = "deployment_schema_artifact_timestamp";
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_schema_artifact_timestamp",
      });
      const input = {
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make(
          "schema_artifact_timestamp",
        ),
        version: version1,
        manifest: { ok: true },
      } satisfies EnsureSchemaVersionArtifactInput;
      await ensure(persistence, input);
      await persistence.query(
        `
          update fx_control_schema_version
          set created_at = '2026-01-01 00:00:00.123456+00'::timestamptz
          where deployment_id = $1
        `,
        [deploymentId],
      );

      if (postgresUrl === null) {
        throw new Error("PostgreSQL URL disappeared during the test.");
      }
      const currentSchema = await persistence.query<{ schemaName: string }>(
        `select current_schema() as "schemaName"`,
      );
      const schemaName = currentSchema.rows[0]?.schemaName;
      if (schemaName === undefined) {
        throw new Error("Temporary PostgreSQL schema was not resolved.");
      }
      const utc = new Client({ connectionString: postgresUrl });
      const yangon = new Client({ connectionString: postgresUrl });
      try {
        const connecting = [utc.connect(), yangon.connect()];
        await Promise.allSettled(connecting);
        await Promise.all(connecting);
        const configuring = [
          utc.query("select set_config('search_path', $1, false)", [
            schemaName,
          ]),
          yangon.query("select set_config('search_path', $1, false)", [
            schemaName,
          ]),
        ];
        await Promise.allSettled(configuring);
        await Promise.all(configuring);
        await utc.query("set time zone 'UTC'");
        await yangon.query("set time zone 'Asia/Yangon'");
        const tokenQuery = `
          select (
            extract(epoch from created_at) * 1000000
          )::numeric(30, 0)::text as token
          from fx_control_schema_version
          where deployment_id = $1
        `;
        const reading = [
          utc.query<{ token: string }>(tokenQuery, [deploymentId]),
          yangon.query<{ token: string }>(tokenQuery, [deploymentId]),
        ];
        await Promise.allSettled(reading);
        const [utcToken, yangonToken] = await Promise.all(reading);
        expect(utcToken.rows[0]?.token).toBe(yangonToken.rows[0]?.token);
      } finally {
        const closing = [utc.end(), yangon.end()];
        await Promise.allSettled(closing);
        await Promise.all(closing);
      }

      const read = await getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        deploymentId,
        version1,
      );
      expect(read?.createdAt.toISOString())
        .toBe("2026-01-01T00:00:00.123Z");
      const replay = await ensure(persistence, input);
      expect(replay.status).toBe("existing");
      expect(replay.artifact.createdAt.toISOString())
        .toBe("2026-01-01T00:00:00.123Z");

      await persistence.query(
        `
          update fx_control_schema_version
          set created_at = 'infinity'::timestamptz
          where deployment_id = $1
        `,
        [deploymentId],
      );
      const infiniteFailure = await runEffectFailure(
        getSchemaVersionArtifactByVersionEffect(
          persistence.drizzle,
          deploymentId,
          version1,
        ),
      );
      expect(infiniteFailure).toMatchObject({
        _tag: "SchemaVersionArtifactCorruptionError",
        detail: "creation timestamp is invalid",
      });
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
