import { applicationSchemaPublicationFrameV1 } from "@flarex/analysis/internal/application-publication-v1";
import { canonicalizeApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { and, eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION, SOURCE_ARTIFACT_V2_ROLE_SCHEMA } from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema, SchemaManifestSha256Schema } from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import { makeApplicationSchemaAuthorityPublisher } from "../../src/application/applicationSchemaAuthority";
import type { PGliteFlarexPersistence } from "../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import { fxControlApplicationSchemaAuthoritiesV1, fxControlIndexes, fxControlSchemaVersions } from "../../src/database/schema";
import { runEffect } from "../support/effectTestRuntime";

type PublicationPersistence = Pick<PGliteFlarexPersistence | PostgresFlarexPersistence,
  "drizzle" | "query" | "insertDeploymentMetadata" | "publishAppSchemaV1">;

/** The same publication/replay obligations execute over both actual database fixtures. */
export function registerApplicationSchemaPublicationScenarios(label: string, current: () => PublicationPersistence): void {
  describe(label, { concurrent: false }, () => {
    it("publishes fresh V2 Source declarations and reopens exact literal values", async () => {
      const persistence = current(), deploymentId = "deployment_source_publication_fresh";
      await persistence.insertDeploymentMetadata({ deploymentId, projectId: deploymentId });
      const manifest = sourceManifest({ type: "object", value: {
        ...objectValidator().value,
        integer: { fieldType: { type: "literal", value: 9223372036854775807n }, optional: false },
        zero: { fieldType: { type: "literal", value: -0 }, optional: false },
        text: { fieldType: { type: "literal", value: "embedded\u0000literal" }, optional: false },
        dictionary: { fieldType: { type: "record", keys: { type: "string" },
          values: { type: "bytes" } }, optional: false },
      } });
      const publisher = makeApplicationSchemaAuthorityPublisher({ db: persistence.drizzle,
        runTransaction: run => persistence.drizzle.transaction(run) });
      const published = await runEffect(publisher.publish({ deploymentId, manifest }));
      const first = published.manifest.tableDefinitions.tables[0];
      if (first === undefined) throw new Error("Missing published Source table");
      expect(first.definition.definitionVersion).toBe(2);
      expect(first.definition.documentType).toEqual(manifest.schema.tables[0]?.validator);
      const reopened = await runEffect(publisher.readPublished({ deploymentId, manifest }));
      expect(reopened.schema).toEqual(published);
      expect(await runEffect(publisher.publish({ deploymentId, manifest }))).toEqual(published);
      expect((await persistence.query<{ kind: string }>(
        "select jsonb_typeof(manifest_json #> '{tableDefinitions,tables,0,definition,documentType}') as kind from fx_control_schema_version where deployment_id=$1",
        [deploymentId])).rows).toEqual([{ kind: "string" }]);
    });

    it("replays an occupied authenticated V1 publication without rewriting its original bytes", async () => {
      const persistence = current(), deploymentId = "deployment_source_publication_original";
      const retained = await originalPublication(persistence, deploymentId);
      const before = await artifactRows(persistence, deploymentId);
      let transactions = 0;
      const publisher = makeApplicationSchemaAuthorityPublisher({ db: persistence.drizzle,
        runTransaction: run => { transactions++; return persistence.drizzle.transaction(run); } });
      const published = await runEffect(publisher.publish({ deploymentId, manifest: retained.manifest }));
      expect(published.manifest).toEqual(retained.publication.manifest);
      expect(published.manifest.tableDefinitions.tables.map(table => table.definition.definitionVersion)).toEqual([1]);
      expect(transactions).toBe(1);
      expect(await runEffect(publisher.publish({ deploymentId, manifest: retained.manifest }))).toEqual(published);
      expect(transactions).toBe(2);
      const reopened = await runEffect(publisher.readPublished({ deploymentId, manifest: retained.manifest }));
      expect(reopened.schema).toEqual(published);
      expect(reopened.originalArtifact.payload?.manifestBytes).toEqual(retained.publication.artifact.manifestBytes);
      expect(await artifactRows(persistence, deploymentId)).toEqual(before);
    });

    it("refuses corrupt occupied V1 evidence before publication without choosing a fresh generation", async () => {
      const persistence = current(), deploymentId = "deployment_source_publication_corrupt";
      const retained = await originalPublication(persistence, deploymentId);
      await persistence.drizzle.update(fxControlSchemaVersions).set({ manifestSha256: SchemaManifestSha256Schema.make(new Uint8Array(32)) })
        .where(eq(fxControlSchemaVersions.deploymentId, deploymentId));
      const before = await artifactRows(persistence, deploymentId);
      let transactions = 0;
      const publisher = makeApplicationSchemaAuthorityPublisher({ db: persistence.drizzle,
        runTransaction: run => { transactions++; return persistence.drizzle.transaction(run); } });
      const result = await runEffect(Effect.result(publisher.publish({ deploymentId, manifest: retained.manifest })));
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "projectionMismatch",
        cause: { _tag: "SchemaVersionArtifactCorruptionError" } } });
      expect(transactions).toBe(0);
      expect(await artifactRows(persistence, deploymentId)).toEqual(before);
    });

    it("revalidates the full original table/index publication instead of returning a readable partial catalog", async () => {
      const persistence = current(), deploymentId = "deployment_source_publication_partial";
      const retained = await originalPublication(persistence, deploymentId);
      const before = await artifactRows(persistence, deploymentId);
      await persistence.drizzle.update(fxControlIndexes).set({ descriptor: "moved_by_email" })
        .where(and(eq(fxControlIndexes.deploymentId, deploymentId), eq(fxControlIndexes.descriptor, "by_email")));
      const publisher = makeApplicationSchemaAuthorityPublisher({ db: persistence.drizzle,
        runTransaction: run => persistence.drizzle.transaction(run) });
      expect((await runEffect(publisher.readPublished({ deploymentId, manifest: retained.manifest }))).schema.manifest)
        .toEqual(retained.publication.manifest);
      const result = await runEffect(Effect.result(publisher.publish({ deploymentId, manifest: retained.manifest })));
      expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "SchemaVersionArtifactConflictError",
        conflict: { reason: "artifactMismatch" } } });
      expect(await artifactRows(persistence, deploymentId)).toEqual(before);
      expect((await persistence.drizzle.select({ descriptor: fxControlIndexes.descriptor }).from(fxControlIndexes)
        .where(eq(fxControlIndexes.deploymentId, deploymentId)))).toEqual([{ descriptor: "moved_by_email" }]);
    });
  });
}

async function originalPublication(persistence: PublicationPersistence, deploymentId: string) {
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: deploymentId });
  const manifest = sourceManifest(objectValidator());
  const frame = Result.getOrThrow(applicationSchemaPublicationFrameV1(manifest));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", frame.slice().buffer));
  const digestHex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(`application_${digestHex}`);
  // Seed through the real retained publisher and its frozen V1 declaration codec.
  const publication = await persistence.publishAppSchemaV1({ deploymentId, schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [{ logicalName: "users", definition: { kind: "appDocument", definitionVersion: 1, documentType: objectValidator() } }],
    indexes: [{ tableLogicalName: "users", descriptor: "by_email", fields: ["email"] }] });
  await persistence.drizzle.insert(fxControlApplicationSchemaAuthoritiesV1).values({ deploymentId,
    applicationSchemaSha256: digest, schemaVersionId, schemaVersion: CatalogSchemaVersionSchema.make(1), status: "reserved" });
  return { manifest, publication };
}

async function artifactRows(persistence: PublicationPersistence, deploymentId: string) {
  return (await persistence.query<{ schema_version_id: string; version: number; bytes: string; sha: string; json: string }>(
    "select schema_version_id,version,encode(manifest_bytes,'hex') as bytes,encode(manifest_sha256,'hex') as sha,manifest_json::text as json from fx_control_schema_version where deployment_id=$1",
    [deploymentId])).rows;
}

function sourceManifest(validator: unknown) {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({ format: "flarex.application-manifest", version: 1,
    sourceArtifact: { rootSha256: "a".repeat(64), executionModulePath: "_flarex/application.js", schemaModulePath: "_flarex/schema.js",
      modules: [{ path: "_flarex/application.js", roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION, sourceSha256: "b".repeat(64), sourceByteLength: 64 },
        { path: "_flarex/schema.js", roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA, sourceSha256: "c".repeat(64), sourceByteLength: 64 }] },
    schema: { version: 1, tables: [{ tableId: 1, name: "users", validator, placement: { kind: "global" } }],
      indexes: [{ indexId: 1, tableId: 1, name: "by_email", fields: ["email"] }] }, functions: [] })).manifest;
}

function objectValidator() {
  return { type: "object" as const, value: { email: { fieldType: { type: "string" as const }, optional: false as const } } };
}
