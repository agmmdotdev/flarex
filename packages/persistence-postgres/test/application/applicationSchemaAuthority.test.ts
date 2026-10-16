import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { applicationSchemaPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeApplicationSchemaAuthorityPublisher,
} from "../../src/application/applicationSchemaAuthority";
import type { AppSchemaPublicationV1Repository } from
  "../../src/storage/catalog/appSchemaPublication";
import type { StableTableCatalogTransaction } from
  "../../src/storage/catalog/stableTableCatalog";
import { createPGlitePersistence } from "../../src/database/pglite";
import { deployments, fxControlApplicationSchemaAuthoritiesV1, fxControlSchemaVersions } from "../../src/database/schema";
import { runEffect } from "../support/effectTestRuntime";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { createMigratedPGlitePersistence, migratedPGliteDataDir } from "../support/pgliteTestFixture";

beforeAll(async () => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  await migratedPGliteDataDir();
}, 120_000);

describe("Application schema authority", () => {
  it("returns the published schema with detached original stored evidence", async () => {
    const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
    const deploymentId = "deployment_application_schema_original_evidence";
    try {
      const persistence = await createPGlitePersistence({ db });
      await insertDeployment(persistence, deploymentId);
      const publisher = makeApplicationSchemaAuthorityPublisher({
        db: persistence.drizzle,
        runTransaction: run => persistence.drizzle.transaction(run),
      });
      const manifest = applicationManifest();
      const schema = await runEffect(publisher.publish({ deploymentId, manifest }));
      const selected = await persistence.drizzle.transaction(tx => runEffect(
        publisher.readPublished({ deploymentId, manifest }, tx),
      ));
      const rows = await persistence.drizzle.select({
        deploymentId: fxControlSchemaVersions.deploymentId,
        schemaVersionId: fxControlSchemaVersions.schemaVersionId,
        version: fxControlSchemaVersions.version,
        manifestCodecVersion: fxControlSchemaVersions.manifestCodecVersion,
        manifestSha256: fxControlSchemaVersions.manifestSha256,
        createdAt: fxControlSchemaVersions.createdAt,
        manifestJsonText: sql<string>`${fxControlSchemaVersions.manifestJson}::text`,
        manifestBytes: fxControlSchemaVersions.manifestBytes,
      }).from(fxControlSchemaVersions).where(and(
        eq(fxControlSchemaVersions.deploymentId, deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, schema.schemaVersionId),
      ));
      const stored = rows[0];
      if (stored === undefined) throw new Error("Missing genuinely published schema artifact");
      const payload = selected.originalArtifact.payload;
      if (payload === null) throw new Error("Published fixture artifact payload was withheld");
      expect(selected.schema).toEqual(schema);
      expect(payload).toEqual(stored);
      const original = structuredClone(selected.originalArtifact);
      payload.manifestBytes.fill(0);
      payload.manifestSha256.fill(0);
      payload.createdAt.setTime(0);
      selected.originalArtifact.sizes.manifestSha256.fill(0);
      selected.originalArtifact.sizes.createdAt.setTime(0);
      const reread = await runEffect(publisher.readPublished({ deploymentId, manifest }));
      expect(reread.schema).toEqual(schema);
      expect(reread.originalArtifact).toEqual(original);
    } finally {
      await db.close();
    }
  });

  it("binds analyzer-local ordinals to stable catalog identities and replays", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_authority";
    await insertDeployment(persistence, deploymentId);
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("prior_schema"),
      version: CatalogSchemaVersionSchema.make(1),
      tables: [tableDeclaration("prior")],
      indexes: [{
        tableLogicalName: "prior",
        descriptor: "by_value",
        fields: ["value"],
      }],
    });
    const publisher = makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    });
    const manifest = applicationManifest();

    const first = await runEffect(publisher.publish({
      deploymentId,
      manifest,
    }));
    const replay = await runEffect(publisher.publish({
      deploymentId,
      manifest,
    }));

    expect(replay).toEqual(first);
    expect(first.schemaVersionId).toBe(
      `application_${first.applicationSchemaSha256}`,
    );
    expect(first.applicationSchemaSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.schemaManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(first.tables).toEqual([{
      applicationTableId: 1,
      logicalName: "users",
      tableId: 2,
    }]);
    expect(first.indexes).toEqual([{
      applicationIndexId: 1,
      applicationTableId: 1,
      descriptor: "by_email",
      logicalIndexId: 2,
      tableId: 2,
    }]);
    expect(first.manifest.tableDefinitions.tables).toMatchObject([{
      logicalName: "users",
      tableId: 2,
    }]);
  });

  it("rejects an analyzed table outside the existing object-document schema", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_invalid";
    await insertDeployment(persistence, deploymentId);
    const publisher = makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    });
    const invalid = applicationManifest({ validator: { type: "string" } });
    const result = await runEffect(Effect.result(
      publisher.publish({
        deploymentId,
        manifest: invalid,
      }),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidSchema" });
    }
    expect((await persistence.query<{ count: string }>(
      "select count(*)::text as count from fx_control_schema_version",
    )).rows).toEqual([{ count: "0" }]);
  });

  it("rejects a publication result relabeled from another artifact identity", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_forged_artifact";
    await insertDeployment(persistence, deploymentId);
    const repository: AppSchemaPublicationV1Repository = {
      db: persistence.drizzle,
      async runTransaction<Value>(
        run: (tx: StableTableCatalogTransaction) => Promise<Value>,
      ): Promise<Value> {
        const value: Value = await persistence.drizzle.transaction(run);
        if (!isPublicationResult(value)) return value;
        return {
          ...value,
          artifact: {
            ...value.artifact,
            deploymentId: "deployment_foreign_artifact",
          },
        } as Value;
      },
    };
    const publisher = makeApplicationSchemaAuthorityPublisher(repository);

    const result = await runEffect(Effect.result(publisher.publish({
      deploymentId,
      manifest: applicationManifest(),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "projectionMismatch" });
    }
  });

  it("rejects publication artifact manifest evidence that does not correlate", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_forged_manifest";
    await insertDeployment(persistence, deploymentId);
    const repository: AppSchemaPublicationV1Repository = {
      db: persistence.drizzle,
      async runTransaction<Value>(
        run: (tx: StableTableCatalogTransaction) => Promise<Value>,
      ): Promise<Value> {
        const value: Value = await persistence.drizzle.transaction(run);
        if (!isPublicationResult(value)) return value;
        return {
          ...value,
          artifact: {
            ...value.artifact,
            manifestSha256: new Uint8Array(32),
          },
        } as Value;
      },
    };
    const publisher = makeApplicationSchemaAuthorityPublisher(repository);

    const result = await runEffect(Effect.result(publisher.publish({
      deploymentId,
      manifest: applicationManifest(),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "projectionMismatch" });
    }
  });

  it("keeps a rejected reservation-selection query in the typed error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_selection_failure";
    await insertDeployment(persistence, deploymentId);
    const cause = Object.assign(new Error("selection query failed"), {
      code: "42501",
    });
    const publisher = makeApplicationSchemaAuthorityPublisher({
      db: new Proxy(persistence.drizzle, {
        get(target, property, receiver) {
          if (property === "select") return () => { throw cause; };
          return Reflect.get(target, property, receiver);
        },
      }),
      runTransaction: run => persistence.drizzle.transaction(run),
    });

    const result = await runEffect(Effect.result(publisher.publish({
      deploymentId,
      manifest: applicationManifest(),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationSchemaAuthorityError",
        operation: "publish",
        reason: "resourceFailure",
        cause,
      });
    }
  });

  it("keeps a rejected in-gate query in the typed error channel", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_gate_failure";
    await insertDeployment(persistence, deploymentId);
    const cause = Object.assign(new Error("gate query failed"), {
      code: "42501",
    });
    const repository: AppSchemaPublicationV1Repository = {
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(tx => run(
        new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "select") return (...fields: Parameters<typeof target.select>) =>
              new Proxy(target.select(...fields), {
                get(builder, key, builderReceiver) {
                  if (key === "from") return (table: unknown) => {
                    if (table === deployments) throw cause;
                    return Reflect.apply(builder.from, builder, [table]);
                  };
                  return Reflect.get(builder, key, builderReceiver);
                },
              });
            return Reflect.get(target, property, receiver);
          },
        }),
      )),
    };
    const publisher = makeApplicationSchemaAuthorityPublisher(repository);

    const result = await runEffect(Effect.result(publisher.publish({
      deploymentId,
      manifest: applicationManifest(),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationSchemaAuthorityError",
        operation: "publish",
        reason: "resourceFailure",
        cause,
      });
      expect(result.failure.cause).toBe(cause);
    }
    expect(await persistence.drizzle.select().from(fxControlApplicationSchemaAuthoritiesV1)
      .where(eq(fxControlApplicationSchemaAuthoritiesV1.deploymentId, deploymentId))).toEqual([]);
    expect(await persistence.drizzle.select().from(fxControlSchemaVersions)
      .where(eq(fxControlSchemaVersions.deploymentId, deploymentId))).toEqual([]);
  });

  it("identifies read-only authority failures separately from publication", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const publisher = makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    });

    const result = await runEffect(Effect.result(publisher.readPublished({
      deploymentId: "",
      manifest: applicationManifest(),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationSchemaAuthorityError",
        operation: "readPublished",
        reason: "invalidDeployment",
      });
    }
  });

  it("repairs a reserved version occupied by the retained publisher", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const deploymentId = "deployment_application_schema_stranded";
    await insertDeployment(persistence, deploymentId);
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId: CatalogSchemaVersionIdSchema.make("retained_schema"),
      version: CatalogSchemaVersionSchema.make(1),
      tables: [tableDeclaration("retained")],
      indexes: [],
    });
    const manifest = applicationManifest();
    const frame = Result.getOrThrow(applicationSchemaPublicationFrameV1(
      manifest,
    ));
    const digest = new Uint8Array(await crypto.subtle.digest(
      "SHA-256",
      frame.slice().buffer,
    ));
    const digestHex = Array.from(
      digest,
      byte => byte.toString(16).padStart(2, "0"),
    ).join("");
    const schemaVersionId = `application_${digestHex}`;
    await persistence.query(
      `insert into fx_control_application_schema_authority_v1 (
         deployment_id,
         application_schema_sha256,
         schema_version_id,
         schema_version,
         status
       ) values ($1, $2, $3, 1, 'reserved')`,
      [deploymentId, digest, schemaVersionId],
    );
    const publisher = makeApplicationSchemaAuthorityPublisher({
      db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run),
    });

    const published = await runEffect(publisher.publish({
      deploymentId,
      manifest,
    }));
    const authority = await persistence.query<{
      schema_version: number;
      status: string;
    }>(
      `select schema_version, status
         from fx_control_application_schema_authority_v1
        where deployment_id = $1`,
      [deploymentId],
    );

    expect(published.schemaVersion).toBe(2);
    expect(authority.rows).toEqual([{
      schema_version: 2,
      status: "reserved",
    }]);
  });
});

function isPublicationResult(value: unknown): value is {
  readonly artifact: {
    readonly deploymentId: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
} {
  if (value === null || typeof value !== "object" ||
    !("artifact" in value)) return false;
  const artifact = value.artifact;
  return artifact !== null && typeof artifact === "object" &&
    "deploymentId" in artifact &&
    typeof artifact.deploymentId === "string";
}

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function insertDeployment(
  persistence: PGlitePersistence,
  deploymentId: string,
): Promise<void> {
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_${deploymentId}`,
  });
}

function tableDeclaration(logicalName: string) {
  return {
    logicalName,
    definition: {
      kind: "appDocument" as const,
      definitionVersion: 1 as const,
      documentType: objectValidator(),
    },
  };
}

function applicationManifest(options: {
  readonly validator?: unknown;
} = {}): ApplicationManifestV1 {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: "a".repeat(64),
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "b".repeat(64),
        sourceByteLength: 64,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "c".repeat(64),
        sourceByteLength: 64,
      }],
    },
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "users",
        validator: options.validator ?? objectValidator(),
        placement: { kind: "global" },
      }],
      indexes: [{
        indexId: 1,
        tableId: 1,
        name: "by_email",
        fields: ["email"],
      }],
    },
    functions: [],
  })).manifest;
}

function objectValidator() {
  return {
    type: "object" as const,
    value: {
      email: {
        fieldType: { type: "string" as const },
        optional: false as const,
      },
      value: {
        fieldType: { type: "string" as const },
        optional: false as const,
      },
    },
  };
}
