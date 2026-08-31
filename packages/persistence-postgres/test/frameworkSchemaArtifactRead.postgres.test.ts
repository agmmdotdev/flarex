import { Result } from "effect";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import {
  makeFrameworkSchemaArtifactControlSessionStarter,
} from "../src/frameworkSchema/artifact/controlSession";
import type { FrameworkSchemaArtifact } from
  "../src/frameworkSchema/artifact/model";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from
  "../src/frameworkSchema/artifact/postgresControlSession";
import { getFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/read";
import {
  makeFrameworkSchemaArtifactRepository,
  prepareFrameworkSchemaArtifactAdmission,
} from "../src/frameworkSchema/artifact/repository";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import {
  ARTIFACT_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("private framework schema artifact point read - PostgreSQL", () => {
  it("runs the exact point read through the real control-session adapter", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await persistence.query(`
        insert into deployments (deployment_id, project_id)
        values ('deployment-framework-read-pg', 'project-framework-read-pg')
      `);
      const artifact = await runEffect(captureFrameworkSchemaArtifact({
        deploymentId: "deployment-framework-read-pg",
        owner: "medusa",
        lineageId: "catalog-schema",
        payloadCodec: { format: "medusa-dml", version: 1 },
        provenance: { source: "module-loader" },
        capabilities: ["framework.medusa.catalog"],
        dependencies: [],
        payload: { modules: ["product"] },
      }));
      await insertCapturedArtifact(persistence, artifact);
      const repository = makePostgresReadRepository(persistence);

      const reconstructed = await runEffect(
        getFrameworkSchemaArtifactEffect(repository, artifact.identity),
      );
      expect(reconstructed).toEqual(artifact);
      expect(reconstructed).not.toBe(artifact);
      expect(reconstructed === null).toBe(false);
      if (reconstructed !== null) {
        expect(Result.isSuccess(
          prepareFrameworkSchemaArtifactAdmission(reconstructed),
        )).toBe(true);
      }

      const absent = await runEffect(captureFrameworkSchemaArtifact({
        deploymentId: "deployment-framework-read-pg",
        owner: "medusa",
        lineageId: "absent-schema",
        payloadCodec: { format: "medusa-dml", version: 1 },
        provenance: { source: "module-loader" },
        capabilities: [],
        dependencies: [],
        payload: { modules: [] },
      }));
      expect(await runEffect(getFrameworkSchemaArtifactEffect(
        repository,
        absent.identity,
      ))).toBeNull();
    });
  }, 180_000);
});

function makePostgresReadRepository(
  persistence: PostgresFlarexPersistence,
) {
  const controlDb: FlarexMetadataDatabase = persistence.drizzle;
  return Result.getOrThrow(makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({
      controlDb,
      driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(
        persistence.pool,
      ),
    }),
    readTimeoutMilliseconds: 5_000,
    attemptTimeoutMilliseconds: 5_000,
    recoveryTimeoutMilliseconds: 5_000,
    lockTimeoutMilliseconds: 1_000,
  }));
}

async function insertCapturedArtifact(
  persistence: PostgresFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<void> {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic framework artifact evidence.");
  }
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    values ($1, $2, $3, decode($4, 'hex'), $5, $6, $7,
      decode($8, 'hex'))
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
    artifact.identity.artifactSha256,
    "flarex.framework-schema-artifact",
    1,
    evidence.canonicalBytes.byteLength,
    Buffer.from(evidence.canonicalBytes).toString("hex"),
  ]);
}
