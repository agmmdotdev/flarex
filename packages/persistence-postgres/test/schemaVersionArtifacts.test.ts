import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersion,
  type CatalogSchemaVersionId,
  type SchemaManifestJson,
} from "flarex-protocol/schema-manifest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import type {
  EnsureSchemaVersionArtifactInput,
  FlarexPersistence,
  SchemaVersionArtifact,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  ensureSchemaVersionArtifactInTransactionEffect,
  getSchemaVersionArtifactByIdEffect,
  getSchemaVersionArtifactByVersionEffect,
  InvalidPreparedSchemaVersionArtifactError,
  InvalidSchemaVersionArtifactInputError,
  prepareSchemaVersionArtifactEffect,
  type PrepareSchemaVersionArtifactError,
  type PreparedSchemaVersionArtifact,
  type ReadSchemaVersionArtifactError,
  SchemaVersionArtifactCorruptionError,
  SchemaVersionArtifactDeploymentNotFoundError,
  SchemaVersionArtifactPersistenceError,
  SchemaVersionArtifactPreparationError,
  type SchemaVersionArtifactTransaction,
} from "../src/schemaVersionArtifacts";
import {
  MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES,
} from "../src/appSchemaPublicationPolicy";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const prepareSchemaVersionArtifact = (
  ...args: Parameters<typeof prepareSchemaVersionArtifactEffect>
) => runEffect(prepareSchemaVersionArtifactEffect(...args));

const ensureSchemaVersionArtifactInTransaction = (
  ...args: Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>
) => runEffect(ensureSchemaVersionArtifactInTransactionEffect(...args));

const getSchemaVersionArtifactById = (
  ...args: Parameters<typeof getSchemaVersionArtifactByIdEffect>
) => runEffect(getSchemaVersionArtifactByIdEffect(...args));

const getSchemaVersionArtifactByVersion = (
  ...args: Parameters<typeof getSchemaVersionArtifactByVersionEffect>
) => runEffect(getSchemaVersionArtifactByVersionEffect(...args));

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

type LegacySchemaVersionReaderExport = Extract<
  keyof typeof import("../src"),
  "getSchemaVersionArtifactById" | "getSchemaVersionArtifactByVersion"
>;

type PublicSchemaVersionReaderErrorExport = Extract<
  keyof typeof import("../src"),
  "SchemaVersionArtifactPersistenceError"
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
    expectTypeOf<LegacySchemaVersionReaderExport>().toEqualTypeOf<never>();
    expectTypeOf<PublicSchemaVersionReaderErrorExport>()
      .toEqualTypeOf<"SchemaVersionArtifactPersistenceError">();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>[0]
      >();
    expectTypeOf<EnsureSchemaVersionArtifactInput>()
      .not.toMatchTypeOf<
        Parameters<typeof ensureSchemaVersionArtifactInTransactionEffect>[1]
      >();
    expectTypeOf<SchemaVersionArtifact["schemaVersionId"]>()
      .toEqualTypeOf<CatalogSchemaVersionId>();
    expectTypeOf<SchemaVersionArtifact["version"]>()
      .toEqualTypeOf<CatalogSchemaVersion>();
    expectTypeOf<
      ReturnType<typeof prepareSchemaVersionArtifactEffect>
    >().toEqualTypeOf<Effect.Effect<
      PreparedSchemaVersionArtifact,
      PrepareSchemaVersionArtifactError
    >>();
    expectTypeOf<
      ReturnType<typeof getSchemaVersionArtifactByIdEffect>
    >().toEqualTypeOf<Effect.Effect<
      SchemaVersionArtifact | null,
      ReadSchemaVersionArtifactError
    >>();
  });

  it("rejects invalid reader identity before constructing a query", async () => {
    const queryConstructionDefect = new Error(
      "schema-version reader query must not be constructed",
    );
    const db = {
      select() {
        throw queryConstructionDefect;
      },
    } as unknown as FlarexMetadataDatabase;

    const failure = await runEffectFailure(
      getSchemaVersionArtifactByIdEffect(db, " ", schemaVersionA),
    );

    expect(failure).toBeInstanceOf(InvalidSchemaVersionArtifactInputError);
    expect(failure).toMatchObject({
      _tag: "InvalidSchemaVersionArtifactInputError",
      field: "deploymentId",
    });
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

  it("reads canonical numbers whose JSONB text representation expands", async () => {
    const persistence = await migratedPGlite("jsonb_number_expansion");
    const deploymentId = "deployment_schema_jsonb_number_expansion";
    const created = await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: { literal: 1e-323 },
    });
    const measurement = await persistence.query<{ jsonBytes: number }>(
      `
        select octet_length(manifest_json::text)::int as "jsonBytes"
        from fx_control_schema_version
        where deployment_id = $1 and schema_version_id = $2
      `,
      [deploymentId, schemaVersionA],
    );

    expect(measurement.rows[0]?.jsonBytes).toBeGreaterThan(
      created.artifact.manifestBytes.byteLength,
    );
    await expect(
      getSchemaVersionArtifactById(
        persistence.drizzle,
        deploymentId,
        schemaVersionA,
      ),
    ).resolves.toEqual(created.artifact);
  });

  it("corroborates timestamps without losing stored microseconds", async () => {
    const persistence = await migratedPGlite("timestamp_precision");
    const deploymentId = "deployment_schema_timestamp_precision";
    await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query(
      `
        update fx_control_schema_version
        set created_at = '2026-01-01 00:00:00.123456+00'::timestamptz
        where deployment_id = $1 and schema_version_id = $2
      `,
      [deploymentId, schemaVersionA],
    );

    const read = await getSchemaVersionArtifactById(
      persistence.drizzle,
      deploymentId,
      schemaVersionA,
    );
    expect(read?.createdAt.toISOString()).toBe("2026-01-01T00:00:00.123Z");
    const replay = await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    expect(replay.status).toBe("existing");
    expect(replay.artifact.createdAt.toISOString())
      .toBe("2026-01-01T00:00:00.123Z");
  });

  it("maps infinite stored timestamps to typed corruption", async () => {
    const persistence = await migratedPGlite("infinite_timestamp");
    const deploymentId = "deployment_schema_infinite_timestamp";
    await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      for (const timestamp of ["infinity", "-infinity"] as const) {
        await persistence.query(
          `
            update fx_control_schema_version
            set created_at = $3::timestamptz
            where deployment_id = $1 and schema_version_id = $2
          `,
          [deploymentId, schemaVersionA, timestamp],
        );
        const failure = await runEffectFailure(
          getSchemaVersionArtifactByIdEffect(
            persistence.drizzle,
            deploymentId,
            schemaVersionA,
          ),
        );
        expect(failure).toMatchObject({
          _tag: "SchemaVersionArtifactCorruptionError",
          detail: "creation timestamp is invalid",
        });
        await expect(persistence.query("select 1 as ok"))
          .resolves.toMatchObject({ rows: [{ ok: 1 }] });
      }
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it("maps finite-to-infinite timestamp drift to typed corruption", async () => {
    const persistence = await migratedPGlite("timestamp_drift_infinite");
    const deploymentId = "deployment_schema_timestamp_drift_infinite";
    await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const driftingDatabase = beforeSelectedQuery(
      persistence.drizzle,
      2,
      async () => {
        await persistence.query(
          `
            update fx_control_schema_version
            set created_at = 'infinity'::timestamptz
            where deployment_id = $1 and schema_version_id = $2
          `,
          [deploymentId, schemaVersionA],
        );
      },
    );

    const failure = await runEffectFailure(
      getSchemaVersionArtifactByIdEffect(
        driftingDatabase,
        deploymentId,
        schemaVersionA,
      ),
    );
    expect(failure).toMatchObject({
      _tag: "SchemaVersionArtifactCorruptionError",
      detail:
        "stored manifest JSON or immutable evidence changed during verification",
    });
    await expect(persistence.query("select 1 as ok"))
      .resolves.toMatchObject({ rows: [{ ok: 1 }] });
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
    const forgedFailure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(
        ensureSchemaVersionArtifactInTransactionEffect(
          tx,
          // @ts-expect-error Transactional insertion accepts only prepared tokens.
          forgedPreparedArtifact,
        ),
      )
    );
    expect(forgedFailure).toBeInstanceOf(
      InvalidPreparedSchemaVersionArtifactError,
    );
    expect(forgedFailure).toMatchObject({
      _tag: "InvalidPreparedSchemaVersionArtifactError",
    });
  });

  it("preserves caller input accessor failures as defects", async () => {
    const defect = new Error("schema-version input accessor defect");
    const input = {
      deploymentId: "deployment_schema_input_accessor_defect",
      get schemaVersionId(): never {
        throw defect;
      },
      version: version1,
      manifest: manifestA,
    };

    const exit = await Effect.runPromiseExit(
      prepareSchemaVersionArtifactEffect(input),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("maps Web Crypto rejection at the preparation boundary", async () => {
    const rejection = new Error("schema artifact digest rejected");
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      rejection,
    );
    try {
      const failure = await runEffectFailure(
        prepareSchemaVersionArtifactEffect({
          deploymentId: "deployment_schema_prepare_failure",
          schemaVersionId: schemaVersionA,
          version: version1,
          manifest: manifestA,
        }),
      );
      expect(failure).toBeInstanceOf(SchemaVersionArtifactPreparationError);
      expect(failure).toMatchObject({
        _tag: "SchemaVersionArtifactPreparationError",
        deploymentId: "deployment_schema_prepare_failure",
        cause: rejection,
      });
    } finally {
      digest.mockRestore();
    }
  });

  it("preserves reader canonicalization rejection as a defect", async () => {
    const persistence = await migratedPGlite("reader_canonical_failure");
    await ensure(persistence, {
      deploymentId: "deployment_schema_reader_canonical_failure",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const rejection = new Error("reader canonical digest unavailable");
    const digest = vi
      .spyOn(crypto.subtle, "digest")
      .mockRejectedValue(rejection);
    try {
      const exit = await Effect.runPromiseExit(
        getSchemaVersionArtifactByIdEffect(
          persistence.drizzle,
          "deployment_schema_reader_canonical_failure",
          schemaVersionA,
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
        expect(exit.cause.toString()).toContain(rejection.message);
      }
    } finally {
      digest.mockRestore();
    }
  });

  it("preserves an invalid Web Crypto digest result as a defect", async () => {
    const persistence = await migratedPGlite("reader_digest_defect");
    await ensure(persistence, {
      deploymentId: "deployment_schema_reader_digest_defect",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const digest = vi.spyOn(crypto.subtle, "digest").mockResolvedValue(
      new ArrayBuffer(31),
    );
    try {
      const exit = await Effect.runPromiseExit(
        getSchemaVersionArtifactByIdEffect(
          persistence.drizzle,
          "deployment_schema_reader_digest_defect",
          schemaVersionA,
        ),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.hasFails(exit.cause)).toBe(false);
      }
    } finally {
      digest.mockRestore();
    }
  });

  it("maps malformed canonical manifest bytes to catalog corruption", async () => {
    const deploymentId = "deployment_schema_manifest_json_corruption";
    const row = {
      ...storedSchemaVersionArtifactRow(deploymentId),
      manifestBytes: new TextEncoder().encode(
        '{"format":"flarexdb-schema-manifest","manifest":[],"manifestCodecVersion":1}',
      ),
    };
    const db = schemaVersionArtifactSelectTransaction(() =>
      Promise.resolve([row])
    );

    const failure = await runEffectFailure(
      getSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionA),
    );

    expect(failure).toBeInstanceOf(SchemaVersionArtifactCorruptionError);
    expect(failure).toMatchObject({
      deploymentId,
      detail: "canonical manifest JSON is invalid",
    });
  });

  it("rejects hostile canonical bytes without poisoning PGlite", async () => {
    const persistence = await migratedPGlite("hostile_canonical_bytes");
    const deploymentId = "deployment_schema_hostile_canonical_bytes";
    await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      await persistence.query(
        `
          update fx_control_schema_version
          set manifest_bytes = $3
          where deployment_id = $1 and schema_version_id = $2
        `,
        [deploymentId, schemaVersionA, new Uint8Array([0xff])],
      );
      const invalidUtf8 = await runEffectFailure(
        getSchemaVersionArtifactByIdEffect(
          persistence.drizzle,
          deploymentId,
          schemaVersionA,
        ),
      );
      expect(invalidUtf8).toMatchObject({
        _tag: "SchemaVersionArtifactCorruptionError",
        detail: "canonical manifest bytes are invalid",
      });
      await expect(persistence.query("select 1 as ok"))
        .resolves.toMatchObject({ rows: [{ ok: 1 }] });

      const nestedManifest = new TextEncoder().encode(
        '{"format":"flarexdb-schema-manifest","manifest":{"value":' +
          "[".repeat(10_000) + "null" + "]".repeat(10_000) +
          '},"manifestCodecVersion":1}',
      );
      await persistence.query(
        `
          update fx_control_schema_version
          set manifest_bytes = $3
          where deployment_id = $1 and schema_version_id = $2
        `,
        [deploymentId, schemaVersionA, nestedManifest],
      );
      const excessiveNesting = await runEffectFailure(
        getSchemaVersionArtifactByIdEffect(
          persistence.drizzle,
          deploymentId,
          schemaVersionA,
        ),
      );
      expect(excessiveNesting).toMatchObject({
        _tag: "SchemaVersionArtifactCorruptionError",
        detail: "canonical manifest JSON is invalid",
      });
      await expect(persistence.query("select 1 as ok"))
        .resolves.toMatchObject({ rows: [{ ok: 1 }] });
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it("rejects oversized manifest evidence before payload access or hashing", async () => {
    const deploymentId = "deployment_schema_manifest_size_corruption";
    const row = {
      ...storedSchemaVersionArtifactRow(deploymentId),
      manifestCanonicalByteLength:
        MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
    };
    let evidenceObserved = false;
    for (const field of ["manifestBytes"] as const) {
      Object.defineProperty(row, field, {
        enumerable: true,
        get(): never {
          evidenceObserved = true;
          throw new Error(`Oversized ${field} must not be materialized.`);
        },
      });
    }
    const db = schemaVersionArtifactSelectTransaction(() =>
      Promise.resolve([row])
    );
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      const failure = await runEffectFailure(
        getSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionA),
      );

      expect(failure).toBeInstanceOf(SchemaVersionArtifactCorruptionError);
      expect(failure).toMatchObject({
        deploymentId,
        detail: "manifest evidence exceeds the artifact read limit",
      });
      expect(evidenceObserved).toBe(false);
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  });

  it("size-gates an oversized stored payload in the SQL projection", async () => {
    const persistence = await migratedPGlite("reader_size_gate");
    const deploymentId = "deployment_schema_reader_size_gate";
    await ensure(persistence, {
      deploymentId,
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_bytes = $3
        where deployment_id = $1 and schema_version_id = $2
      `,
      [
        deploymentId,
        schemaVersionA,
        new Uint8Array(
          MAX_APP_SCHEMA_PUBLICATION_V1_CANONICAL_BYTES + 1,
        ),
      ],
    );
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      const failure = await runEffectFailure(
        getSchemaVersionArtifactByIdEffect(
          persistence.drizzle,
          deploymentId,
          schemaVersionA,
        ),
      );

      expect(failure).toBeInstanceOf(SchemaVersionArtifactCorruptionError);
      expect(failure).toMatchObject({
        deploymentId,
        detail: "manifest evidence exceeds the artifact read limit",
      });
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
  }, 30_000);

  it("short-circuits malformed stored columns as typed corruption", async () => {
    const deploymentId = "deployment_schema_stored_column_corruption";
    const row = {
      ...storedSchemaVersionArtifactRow(deploymentId),
      schemaVersionId: "",
    };
    let versionObserved = false;
    Object.defineProperty(row, "version", {
      enumerable: true,
      get(): never {
        versionObserved = true;
        throw new Error("later artifact version accessor must not run");
      },
    });
    const db = schemaVersionArtifactSelectTransaction(() =>
      Promise.resolve([row])
    );

    const failure = await runEffectFailure(
      getSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionA),
    );

    expect(failure).toBeInstanceOf(SchemaVersionArtifactCorruptionError);
    expect(failure).toMatchObject({
      detail: "schema version ID is invalid",
    });
    expect(versionObserved).toBe(false);
  });

  it("preserves stored artifact accessor failures as defects", async () => {
    const deploymentId = "deployment_schema_stored_accessor_defect";
    const defect = new Error("stored schema-version accessor defect");
    const row = storedSchemaVersionArtifactRow(deploymentId);
    Object.defineProperty(row, "schemaVersionId", {
      enumerable: true,
      get(): never {
        throw defect;
      },
    });
    const db = schemaVersionArtifactSelectTransaction(() =>
      Promise.resolve([row])
    );

    const exit = await Effect.runPromiseExit(
      getSchemaVersionArtifactByIdEffect(db, deploymentId, schemaVersionA),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("maps SQL rejection at the owning artifact query boundary", async () => {
    const persistence = await migratedPGlite("query_failure");
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_query_failure",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    await persistence.query("drop table fx_control_schema_version cascade");

    const failure = await persistence.drizzle.transaction((tx) =>
      runEffectFailure(
        ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
      )
    );

    expect(failure).toBeInstanceOf(SchemaVersionArtifactPersistenceError);
    expect(failure).toMatchObject({
      _tag: "SchemaVersionArtifactPersistenceError",
      operation: "readById",
    });
    if (failure instanceof SchemaVersionArtifactPersistenceError) {
      expect(failure.cause).toBeInstanceOf(Error);
    }

    const readerFailure = await runEffectFailure(
      getSchemaVersionArtifactByIdEffect(
        persistence.drizzle,
        "deployment_schema_query_failure",
        schemaVersionA,
      ),
    );
    expect(readerFailure).toBeInstanceOf(
      SchemaVersionArtifactPersistenceError,
    );
    expect(readerFailure).toMatchObject({
      _tag: "SchemaVersionArtifactPersistenceError",
      operation: "readById",
    });
  });

  it("preserves artifact query construction failures as defects", async () => {
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_construction_defect",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const defect = new Error("artifact deployment query construction defect");
    const tx = {
      select() {
        throw defect;
      },
    } as unknown as SchemaVersionArtifactTransaction;

    const exit = await Effect.runPromiseExit(
      ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }

    const readerExit = await Effect.runPromiseExit(
      getSchemaVersionArtifactByIdEffect(
        tx,
        "deployment_schema_construction_defect",
        schemaVersionA,
      ),
    );
    expect(Exit.isFailure(readerExit)).toBe(true);
    if (Exit.isFailure(readerExit)) {
      expect(Cause.hasDies(readerExit.cause)).toBe(true);
      expect(Cause.hasFails(readerExit.cause)).toBe(false);
      expect(readerExit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending artifact query before interruption completes", async () => {
    const prepared = await prepareSchemaVersionArtifact({
      deploymentId: "deployment_schema_interruption",
      schemaVersionId: schemaVersionA,
      version: version1,
      manifest: manifestA,
    });
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const tx = schemaVersionArtifactSelectTransaction((selectCall) => {
      if (selectCall !== 1) {
        throw new Error(`Unexpected select call: ${selectCall}.`);
      }
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      ensureSchemaVersionArtifactInTransactionEffect(tx, prepared),
    );

    await entered.promise;
    const completion = runEffect(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      query.resolve([{ deploymentId: prepared.deploymentId }]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
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

function storedSchemaVersionArtifactRow(deploymentId: string) {
  return {
    deploymentId,
    schemaVersionId: schemaVersionA,
    version: version1,
    manifestCodecVersion: 1,
    manifestCanonicalByteLength: 145,
    manifestBytes: new TextEncoder().encode(
      '{"format":"flarexdb-schema-manifest","manifest":{"tables":[{"fields":{"age":"number","name":"string"},"name":"users"}]},"manifestCodecVersion":1}',
    ),
    manifestSha256: new Uint8Array(32),
    createdAtEpochMicrosecondsText: "1767225600000000",
    createdAt: new Date(),
  };
}

function mutateFirstByte(bytes: Uint8Array): void {
  const first = bytes[0];
  if (first === undefined) {
    throw new Error("Expected a nonempty byte sequence.");
  }
  bytes[0] = first ^ 0xff;
}

interface SchemaVersionArtifactQueryStub
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): SchemaVersionArtifactQueryStub;
  where(): SchemaVersionArtifactQueryStub;
  limit(): SchemaVersionArtifactQueryStub;
  for(): SchemaVersionArtifactQueryStub;
}

function schemaVersionArtifactSelectTransaction(
  runSelect: (selectCall: number) => Promise<ReadonlyArray<unknown>>,
): SchemaVersionArtifactTransaction {
  let selectCall = 0;
  return {
    select() {
      selectCall += 1;
      const promise = runSelect(selectCall);
      const query: SchemaVersionArtifactQueryStub = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as SchemaVersionArtifactTransaction;
}

function beforeSelectedQuery(
  database: FlarexMetadataDatabase,
  selectedSelectNumber: number,
  beforeQuery: () => Promise<void>,
): FlarexMetadataDatabase {
  let selectNumber = 0;
  return new Proxy(database, {
    get(target, property, receiver) {
      if (property !== "select") {
        return Reflect.get(target, property, receiver);
      }
      return (...args: ReadonlyArray<unknown>) => {
        selectNumber += 1;
        const query = Reflect.apply(target.select, target, args);
        return selectNumber === selectedSelectNumber
          ? new BeforeSelectedQuery(query, beforeQuery)
          : query;
      };
    },
  });
}

class BeforeSelectedQuery implements PromiseLike<ReadonlyArray<unknown>> {
  constructor(
    private query: unknown,
    private readonly beforeQuery: () => Promise<void>,
  ) {}

  from(...args: ReadonlyArray<unknown>): this {
    this.query = invokeQueryMethod(this.query, "from", args);
    return this;
  }

  where(...args: ReadonlyArray<unknown>): this {
    this.query = invokeQueryMethod(this.query, "where", args);
    return this;
  }

  limit(...args: ReadonlyArray<unknown>): this {
    this.query = invokeQueryMethod(this.query, "limit", args);
    return this;
  }

  then<TResult1 = ReadonlyArray<unknown>, TResult2 = never>(
    onfulfilled?: (
      (value: ReadonlyArray<unknown>) => TResult1 | PromiseLike<TResult1>
    ) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.beforeQuery()
      .then(() => this.query as PromiseLike<ReadonlyArray<unknown>>)
      .then(onfulfilled, onrejected);
  }
}

function invokeQueryMethod(
  query: unknown,
  method: "from" | "where" | "limit",
  args: ReadonlyArray<unknown>,
): unknown {
  if (
    (typeof query !== "object" && typeof query !== "function") ||
    query === null
  ) {
    throw new Error(`Cannot call ${method} on a non-object query.`);
  }
  const operation = Reflect.get(query, method);
  if (typeof operation !== "function") {
    throw new Error(`Query does not implement ${method}.`);
  }
  return Reflect.apply(operation, query, args);
}

function deferredValue<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: Value) {
      if (resolvePromise === undefined) {
        throw new Error("Deferred value was not initialized.");
      }
      resolvePromise(value);
    },
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
