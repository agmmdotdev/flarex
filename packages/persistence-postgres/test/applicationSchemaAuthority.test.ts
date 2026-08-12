import { webcrypto } from "node:crypto";
import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import { applicationSchemaPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
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
} from "../src/applicationSchemaAuthority";
import type { AppSchemaPublicationV1Repository } from
  "../src/appSchemaPublication";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import { createPGlitePersistence } from "../src/pglite";
import { runEffect } from "./effectTestRuntime";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application schema authority", () => {
  it("binds analyzer-local ordinals to stable catalog identities and replays", async () => {
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
            if (property === "select") return () => { throw cause; };
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
    }
  });

  it("identifies read-only authority failures separately from publication", async () => {
    const persistence = await migratedPersistence();
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
    const persistence = await migratedPersistence();
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
