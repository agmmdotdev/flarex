import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  EnsureSchemaVersionArtifactInput,
  FlarexPersistence,
  SchemaVersionArtifact,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  ensureSchemaVersionArtifactInTransaction,
  getSchemaVersionArtifactById,
  getSchemaVersionArtifactByVersion,
  InvalidPreparedSchemaVersionArtifactError,
  InvalidSchemaVersionArtifactInputError,
  prepareSchemaVersionArtifact,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
} from "../src/schemaVersionArtifacts";

interface CallerComputedArtifactInput {
  readonly deploymentId: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly version: CatalogSchemaVersion;
  readonly manifest: SchemaManifestJson;
  readonly manifestSha256: Uint8Array;
}

type CallerComputedArtifactAccepted = CallerComputedArtifactInput extends
  EnsureSchemaVersionArtifactInput
  ? true
  : false;

type PublicSchemaVersionWriter = Extract<
  keyof FlarexPersistence,
  "ensureSchemaVersionArtifact" | "insertSchemaVersionArtifact"
>;

const schemaVersionA = CatalogSchemaVersionIdSchema.make("schema_version_a");
const schemaVersionB = CatalogSchemaVersionIdSchema.make("schema_version_b");
const version1 = CatalogSchemaVersionSchema.make(1);
const version2 = CatalogSchemaVersionSchema.make(2);
const manifestA = {
  tables: [{ name: "users", fields: { name: "string", age: "number" } }],
} satisfies SchemaManifestJson;
const reorderedManifestA = {
  tables: [{ fields: { age: "number", name: "string" }, name: "users" }],
} satisfies SchemaManifestJson;
const manifestB = {
  tables: [{ name: "users", fields: { name: "string" } }],
} satisfies SchemaManifestJson;

describe("schema version artifacts", () => {
  it("keeps computed fields out of input and registration transaction-only", () => {
    expectTypeOf<CallerComputedArtifactAccepted>().toEqualTypeOf<false>();
    expectTypeOf<PublicSchemaVersionWriter>().toEqualTypeOf<never>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransaction>[0]
      >();
    expectTypeOf<EnsureSchemaVersionArtifactInput>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransaction>[1]
      >();
    expectTypeOf<SchemaVersionArtifact["schemaVersionId"]>()
      .toEqualTypeOf<CatalogSchemaVersionId>();
    expectTypeOf<SchemaVersionArtifact["version"]>()
      .toEqualTypeOf<CatalogSchemaVersion>();
  });

  it("persists one canonical artifact and replays reordered JSON exactly", async () => {
    const persistence = await migratedPGlite("canonical");
    const created = await ensure(persistence, {
      deploymentId: "deployment_schema_canonical",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const replay = await ensure(persistence, {
      deploymentId: "deployment_schema_canonical",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: reorderedManifestA,
    });

    expect(created.status).toBe("created");
    expect(created.artifact.manifestCodecVersion).toBe(1);
    expect(created.artifact.manifestSha256).toHaveLength(32);
    expect(replay).toEqual({
      status: "existing",
      artifact: created.artifact,
    });
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_canonical",
        schemaVersionA,
      ),
    ).resolves.toEqual(created.artifact);
    await expect(
      getSchemaVersionArtifactByVersion(
        persistence.drizzle,
        "deployment_schema_canonical",
        version1,
      ),
    ).resolves.toEqual(created.artifact);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_canonical",
        schemaVersionB,
      ),
    ).resolves.toBeNull();
  });

  it("rejects ID, version, and immutable-artifact reuse independently", async () => {
    const persistence = await migratedPGlite("conflict");
    await ensure(persistence, {
      deploymentId: "deployment_schema_conflict",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });

    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionA,
        version: version2,
        manifest: manifestA,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "schemaVersionIdReused" },
    });
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionB,
        version: version1,
        manifest: manifestA,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "versionReused" },
    });
    await expect(
      ensure(persistence, {
        deploymentId: "deployment_schema_conflict",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestB,
      }),
    ).rejects.toMatchObject({
      name: "SchemaVersionArtifactConflictError",
      conflict: { reason: "artifactMismatch" },
    });

    const repeatedContent = await ensure(persistence, {
      deploymentId: "deployment_schema_conflict",
      schemaVersionId: schemaVersionB,
      version: version2,
      manifest: reorderedManifestA,
    });
    expect(repeatedContent.status).toBe("created");
  });

  it("isolates schema identities and versions by deployment", async () => {
    const persistence = await migratedPGlite("isolated_a");
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_schema_isolated_b",
      projectId: "project_schema_isolated_b",
    });
    const [left, right] = await Promise.all([
      ensure(persistence, {
        deploymentId: "deployment_schema_isolated_a",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
      }),
      ensure(persistence, {
        deploymentId: "deployment_schema_isolated_b",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestB,
      }),
    ]);

    expect(left.status).toBe("created");
    expect(right.status).toBe("created");
    expect(left.artifact.manifestSha256).not.toEqual(
      right.artifact.manifestSha256,
    );
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_isolated_a",
        schemaVersionA,
      ),
    ).resolves.toEqual(left.artifact);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_isolated_b",
        schemaVersionA,
      ),
    ).resolves.toEqual(right.artifact);
  });

  it("fails closed for missing ownership, invalid manifests, and computed fields", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await expect(
      ensure(persistence, {
        deploymentId: "missing_schema_deployment",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
      }),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactDeploymentNotFoundError);

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_schema_invalid",
      projectId: "project_schema_invalid",
    });
    await expect(
      prepareSchemaVersionArtifact({
        deploymentId: "deployment_schema_invalid",
        schemaVersionId: schemaVersionA,
        version: version1,
        // @ts-expect-error Schema manifests must be JSON objects.
        manifest: [],
      }),
    ).rejects.toBeInstanceOf(InvalidSchemaVersionArtifactInputError);
    await expect(
      prepareSchemaVersionArtifact({
        deploymentId: "deployment_schema_invalid",
        schemaVersionId: schemaVersionA,
        version: version1,
        manifest: manifestA,
        // @ts-expect-error Callers cannot provide a manifest digest.
        manifestSha256: new Uint8Array(32),
      }),
    ).rejects.toMatchObject({
      name: "InvalidSchemaVersionArtifactInputError",
      field: "manifestSha256",
    });
    const forgedPreparedArtifact = {
      deploymentId: "deployment_schema_invalid",
      schemaVersionId: schemaVersionA,
      version: version1,
    };
    await expect(
      persistence.drizzle.transaction((tx) =>
        ensureSchemaVersionArtifactInTransaction(
          tx,
          // @ts-expect-error Transactional insertion accepts only prepared tokens.
          forgedPreparedArtifact,
        ),
      ),
    ).rejects.toBeInstanceOf(InvalidPreparedSchemaVersionArtifactError);
  });

  it("rolls registration back without leaving an artifact", async () => {
    const persistence = await migratedPGlite("rollback");
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_rollback",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const rolledBackArtifacts: SchemaVersionArtifact[] = [];
    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const result = await ensureSchemaVersionArtifactInTransaction(
          tx,
          prepared,
        );
        rolledBackArtifacts.push(result.artifact);
        throw new Error("injected schema artifact rollback");
      }),
    ).rejects.toThrow("injected schema artifact rollback");

    const rolledBackArtifact = rolledBackArtifacts[0];
    if (rolledBackArtifact === undefined) {
      throw new Error("Rollback test did not capture the created artifact.");
    }
    mutateFirstByte(rolledBackArtifact.manifestBytes);
    mutateFirstByte(rolledBackArtifact.manifestSha256);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_rollback",
        schemaVersionA,
      ),
    ).resolves.toBeNull();

    const retried = await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, prepared),
    );
    expect(retried.status).toBe("created");
    mutateFirstByte(retried.artifact.manifestBytes);
    mutateFirstByte(retried.artifact.manifestSha256);
    const replayed = await persistence.drizzle.transaction((tx) =>
      ensureSchemaVersionArtifactInTransaction(tx, prepared),
    );
    expect(replayed.status).toBe("existing");
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_rollback",
        schemaVersionA,
      ),
    ).resolves.toEqual(replayed.artifact);
  });

  it("enforces physical constraints and detects stored-byte drift", async () => {
    const persistence = await migratedPGlite("constraints");
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_version', 0,
          1, '{}'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_codec', 1,
          2, '{}'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();
    await expect(
      persistence.query(`
        insert into fx_control_schema_version (
          deployment_id, schema_version_id, version,
          manifest_codec_version, manifest_json, manifest_bytes,
          manifest_sha256
        ) values (
          'deployment_schema_constraints', 'invalid_manifest', 1,
          1, '[]'::jsonb, decode('00', 'hex'),
          decode(repeat('00', 32), 'hex')
        )
      `),
    ).rejects.toThrow();

    await ensure(persistence, {
      deploymentId: "deployment_schema_constraints",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query(`
      update fx_control_schema_version
      set manifest_bytes = decode('00', 'hex')
      where deployment_id = 'deployment_schema_constraints'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionA,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);

    await ensure(persistence, {
      deploymentId: "deployment_schema_constraints",
      schemaVersionId: schemaVersionB,
      version: version2,
      manifest: manifestB,
    });
    await persistence.query(`
      update fx_control_schema_version
      set manifest_json = '{"tampered": true}'::jsonb
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionB,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);
    await persistence.query(`
      update fx_control_schema_version
      set manifest_json = '{"tables":[{"name":"users","fields":{"name":"string"}}]}'::jsonb
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await persistence.query(`
      update fx_control_schema_version
      set manifest_sha256 = decode(repeat('00', 32), 'hex')
      where deployment_id = 'deployment_schema_constraints'
        and schema_version_id = 'schema_version_b'
    `);
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        "deployment_schema_constraints",
        schemaVersionB,
      ),
    ).rejects.toBeInstanceOf(SchemaVersionArtifactCorruptionError);
  });
});

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPGlite(suffix: string): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await persistence.insertDeploymentMetadata({
    deploymentId: `deployment_schema_${suffix}`,
    projectId: `project_schema_${suffix}`,
  });
  return persistence;
}

async function ensure(
  persistence: PGlitePersistence,
  input: EnsureSchemaVersionArtifactInput,
) {
  const prepared = await prepareSchemaVersionArtifact(input);
  return persistence.drizzle.transaction((tx) =>
    ensureSchemaVersionArtifactInTransaction(tx, prepared),
  );
}

function mutateFirstByte(bytes: Uint8Array): void {
  const first = bytes[0];
  if (first === undefined) {
    throw new Error("Expected a nonempty byte sequence.");
  }
  bytes[0] = first ^ 0xff;
}
