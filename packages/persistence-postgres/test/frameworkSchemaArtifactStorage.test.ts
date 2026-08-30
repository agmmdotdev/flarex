import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
  expectFrameworkArtifactStorageCatalog,
} from "./frameworkSchemaArtifactStorageTestSupport";
const ECMASCRIPT_TRIM_CODE_POINTS = [
  0x0009,
  0x000a,
  0x000b,
  0x000c,
  0x000d,
  0x0020,
  0x00a0,
  0x1680,
  0x2000,
  0x2001,
  0x2002,
  0x2003,
  0x2004,
  0x2005,
  0x2006,
  0x2007,
  0x2008,
  0x2009,
  0x200a,
  0x2028,
  0x2029,
  0x202f,
  0x205f,
  0x3000,
  0xfeff,
] as const;

interface ArtifactInsert {
  readonly deploymentId: string;
  readonly lineageId: string;
  readonly owner?: string;
  readonly digestHex?: string;
  readonly frameFormat?: string;
  readonly frameVersion?: number;
  readonly canonicalHex?: string;
  readonly canonicalByteLength?: number;
  readonly admittedAt?: string;
}
describe("framework schema artifact storage - PGlite", () => {
  it("enforces the accepted physical artifact and dependency contract", async () => {
    const testRoot = await mkdtemp(resolve(
      tmpdir(),
      "flarex-framework-artifact-storage-",
    ));
    const dataDirectory = resolve(testRoot, "database");
    let db: PGlite | undefined = new PGlite(dataDirectory);

    try {
      let persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      await expect(persistence.migrate()).resolves.toBeUndefined();

      await expectFrameworkArtifactStorageCatalog(persistence, "public");
      await persistence.query(`
        insert into deployments (deployment_id, project_id)
        values
          ('deployment_framework_artifacts', 'project_framework_artifacts')
      `);

      const dependencyStorageId = await insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "dependency_lineage",
        digestHex: "11".repeat(32),
      });
      const artifactStorageId = await insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "artifact_lineage",
        digestHex: "22".repeat(32),
      });
      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "artifact_lineage",
        digestHex: "22".repeat(32),
      }), "23505", "fx_framework_artifact_identity_unique");
      await expectSqlFailure(persistence.query(`
        insert into ${ARTIFACT_TABLE}
          (artifact_storage_id, deployment_id, owner, lineage_id,
           artifact_sha256, frame_format, frame_version,
           canonical_byte_length, canonical_bytes, admitted_at)
        values
          (999, 'deployment_framework_artifacts', 'payload',
           'caller_supplied_storage_id', decode(repeat('33', 32), 'hex'),
           'flarex.framework-schema-artifact', 1, 2, decode('7b7d', 'hex'),
           '2030-01-01T00:00:00.000Z')
      `), "428C9");

      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "invalid_owner",
        owner: "application",
      }), "23514", "fx_framework_artifact_owner_check");
      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "invalid_digest",
        digestHex: "aa",
      }), "23514", "fx_framework_artifact_identity_check");
      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "invalid_format",
        frameFormat: "other.framework-artifact",
      }), "23514", "fx_framework_artifact_frame_check");
      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "invalid_length",
        canonicalByteLength: 1,
      }), "23514", "fx_framework_artifact_frame_check");
      await expectSqlFailure(insertArtifact(persistence, {
        deploymentId: "deployment_framework_artifacts",
        lineageId: "invalid_time",
        admittedAt: "infinity",
      }), "23514", "fx_framework_artifact_time_check");

      await expectSqlFailure(insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId,
        deploymentId: "deployment_framework_artifacts",
        owner: "payload",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 256,
        dependencyLineageId: "dependency_lineage",
      }), "23514", "fx_framework_artifact_dependency_identity_check");
      await expectSqlFailure(insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId,
        deploymentId: "another_deployment",
        owner: "payload",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 1,
        dependencyLineageId: "dependency_lineage",
      }), "23503", "fx_framework_artifact_dependency_parent_fk");
      await expectSqlFailure(insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId,
        deploymentId: "deployment_framework_artifacts",
        owner: "medusa",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 1,
        dependencyLineageId: "dependency_lineage",
      }), "23503", "fx_framework_artifact_dependency_parent_fk");
      await insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId,
        deploymentId: "deployment_framework_artifacts",
        owner: "payload",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 0,
        dependencyLineageId: "dependency_lineage",
      });
      await expectSqlFailure(insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId,
        deploymentId: "deployment_framework_artifacts",
        owner: "payload",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 1,
        dependencyLineageId: "dependency_lineage",
      }), "23505", "fx_framework_artifact_dependency_target_unique");
      await expectSqlFailure(insertDependency(persistence, {
        artifactStorageId,
        dependencyStorageId: artifactStorageId,
        deploymentId: "deployment_framework_artifacts",
        owner: "payload",
        artifactLineageId: "artifact_lineage",
        dependencyOrdinal: 1,
        dependencyLineageId: "artifact_lineage",
      }), "23514", "fx_framework_artifact_dependency_identity_check");
      await expectSqlFailure(persistence.query(
        `delete from ${ARTIFACT_TABLE} where artifact_storage_id = $1`,
        [dependencyStorageId],
      ), "23503", "fx_framework_artifact_dependency_target_fk");
      await expectSqlFailure(persistence.query(
        `delete from ${ARTIFACT_TABLE} where artifact_storage_id = $1`,
        [artifactStorageId],
      ), "23503", "fx_framework_artifact_dependency_parent_fk");
      await expectSqlFailure(persistence.query(
        "delete from deployments where deployment_id = $1",
        ["deployment_framework_artifacts"],
      ), "23503", "fx_framework_artifact_deployment_fk");

      await expectExactTrimContract(persistence);
      await expectUtf8ByteLimits(persistence);

      const beforeClose = await storedArtifactCounts(persistence);
      expect(beforeClose).toEqual({ artifacts: "4", dependencies: "1" });

      await db.close();
      db = undefined;
      db = new PGlite(dataDirectory);
      persistence = await createPGlitePersistence({ db });
      await expect(persistence.migrate()).resolves.toBeUndefined();
      expect(await storedArtifactCounts(persistence)).toEqual(beforeClose);
      await expectFrameworkArtifactStorageCatalog(persistence, "public");
    } finally {
      try {
        await db?.close();
      } finally {
        await rm(testRoot, { recursive: true, force: true });
      }
    }
  }, 120_000);
});

async function expectExactTrimContract(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values ('deployment_framework_trim', 'project_framework_trim')
  `);
  for (const codePoint of ECMASCRIPT_TRIM_CODE_POINTS) {
    const whitespace = String.fromCodePoint(codePoint);
    await persistence.query(
      `insert into deployments (deployment_id, project_id) values ($1, $2)`,
      [whitespace, `project_trim_${codePoint}`],
    );
    await expectSqlFailure(insertArtifact(persistence, {
      deploymentId: whitespace,
      lineageId: "valid_lineage",
    }), "23514", "fx_framework_artifact_identity_check");
    await expectSqlFailure(insertArtifact(persistence, {
      deploymentId: "deployment_framework_trim",
      lineageId: whitespace,
    }), "23514", "fx_framework_artifact_identity_check");
  }

  const mixedWhitespace = ECMASCRIPT_TRIM_CODE_POINTS
    .map(codePoint => String.fromCodePoint(codePoint))
    .join("");
  await persistence.query(
    `insert into deployments (deployment_id, project_id) values ($1, $2)`,
    [mixedWhitespace, "project_trim_mixed"],
  );
  await expectSqlFailure(insertArtifact(persistence, {
    deploymentId: mixedWhitespace,
    lineageId: "valid_lineage",
  }), "23514", "fx_framework_artifact_identity_check");
  await expectSqlFailure(insertArtifact(persistence, {
    deploymentId: "deployment_framework_trim",
    lineageId: mixedWhitespace,
  }), "23514", "fx_framework_artifact_identity_check");

  const zeroWidthSpace = "\u200b";
  await persistence.query(
    `insert into deployments (deployment_id, project_id) values ($1, $2)`,
    [zeroWidthSpace, "project_zero_width_space"],
  );
  await expect(insertArtifact(persistence, {
    deploymentId: zeroWidthSpace,
    lineageId: zeroWidthSpace,
    digestHex: "44".repeat(32),
  })).resolves.toMatch(/^\d+$/);
}

async function expectUtf8ByteLimits(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  const exactUtf8Limit = "é".repeat(512);
  const overUtf8Limit = `${exactUtf8Limit}é`;
  await persistence.query(
    `insert into deployments (deployment_id, project_id) values ($1, $2)`,
    [exactUtf8Limit, "project_exact_utf8_limit"],
  );
  await expect(insertArtifact(persistence, {
    deploymentId: exactUtf8Limit,
    lineageId: exactUtf8Limit,
    digestHex: "55".repeat(32),
  })).resolves.toMatch(/^\d+$/);

  await persistence.query(
    `insert into deployments (deployment_id, project_id) values ($1, $2)`,
    [overUtf8Limit, "project_over_utf8_limit"],
  );
  await expectSqlFailure(insertArtifact(persistence, {
    deploymentId: overUtf8Limit,
    lineageId: "valid_lineage",
  }), "23514", "fx_framework_artifact_identity_check");
  await expectSqlFailure(insertArtifact(persistence, {
    deploymentId: "deployment_framework_trim",
    lineageId: overUtf8Limit,
  }), "23514", "fx_framework_artifact_identity_check");
}

async function expectSqlFailure(
  operation: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({ code });
  if (constraint !== undefined) {
    await expect(operation).rejects.toThrow(constraint);
  }
}

async function insertArtifact(
  persistence: PGliteFlarexPersistence,
  input: ArtifactInsert,
): Promise<string> {
  const canonicalHex = input.canonicalHex ?? "7b7d";
  const result = await persistence.query<{ storage_id: string }>(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length,
       canonical_bytes, admitted_at)
    values
      ($1, $2, $3, decode($4, 'hex'), $5, $6, $7,
       decode($8, 'hex'), $9)
    returning artifact_storage_id::text as storage_id
  `, [
    input.deploymentId,
    input.owner ?? "payload",
    input.lineageId,
    input.digestHex ?? "aa".repeat(32),
    input.frameFormat ?? "flarex.framework-schema-artifact",
    input.frameVersion ?? 1,
    input.canonicalByteLength ?? canonicalHex.length / 2,
    canonicalHex,
    input.admittedAt ?? "2030-01-01T00:00:00.000Z",
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Framework artifact insert returned no storage identity.");
  }
  return storageId;
}

async function insertDependency(
  persistence: PGliteFlarexPersistence,
  input: Readonly<{
    artifactStorageId: string;
    dependencyStorageId: string;
    deploymentId: string;
    owner: string;
    artifactLineageId: string;
    dependencyOrdinal: number;
    dependencyLineageId: string;
  }>,
): Promise<void> {
  await persistence.query(`
    insert into ${DEPENDENCY_TABLE}
      (artifact_storage_id, dependency_storage_id, deployment_id, owner,
       artifact_lineage_id, dependency_ordinal, dependency_lineage_id)
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [
    input.artifactStorageId,
    input.dependencyStorageId,
    input.deploymentId,
    input.owner,
    input.artifactLineageId,
    input.dependencyOrdinal,
    input.dependencyLineageId,
  ]);
}

async function storedArtifactCounts(
  persistence: PGliteFlarexPersistence,
): Promise<Readonly<{ artifacts: string; dependencies: string }>> {
  const result = await persistence.query<{
    artifacts: string;
    dependencies: string;
  }>(`
    select
      (select count(*)::text from ${ARTIFACT_TABLE}) as artifacts,
      (select count(*)::text from ${DEPENDENCY_TABLE}) as dependencies
  `);
  const counts = result.rows[0];
  if (counts === undefined) {
    throw new Error("Framework artifact count query returned no row.");
  }
  return counts;
}
