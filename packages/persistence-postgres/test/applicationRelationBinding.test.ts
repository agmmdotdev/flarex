import { webcrypto } from "node:crypto";
import {
  ApplicationManifestSchemaBindingSha256HexSchema,
} from "flarex-protocol/internal/application-schema-binding";
import {
  canonicalizeApplicationManifestV2,
  type ApplicationManifestV2,
} from "@flarex/analysis/application-analysis";
import {
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import { eq } from "drizzle-orm";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { beforeAll, describe, expect, it } from "vitest";

import {
  locateApplicationRelationManifestBindingEffect,
  publishApplicationRelationBindingEffect,
  type ApplicationRelationBindingRepository,
  type PublishApplicationRelationBindingInput,
} from "../src/applicationRelationBinding";
import { createPGlitePersistence } from "../src/pglite";
import {
  fxControlApplicationManifestSchemaBindings,
  fxControlBoundApplicationSchemas,
} from "../src/schema";
import type { StableTableCatalogTransaction } from
  "../src/stableTableCatalog";
import { runEffect } from "./effectTestRuntime";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application relation binding", () => {
  it("publishes, replays, and reuses one bound schema across full manifests", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_replay";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    const firstInput = await publicationInput(
      deploymentId,
      "a".repeat(64),
      [{ relationOrdinal: 1, evolution: { kind: "new" } }],
    );

    const first = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      firstInput,
    ));
    const replay = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      firstInput,
    ));
    const secondInput = await publicationInput(
      deploymentId,
      "d".repeat(64),
      [{ relationOrdinal: 1, evolution: { kind: "new" } }],
    );
    const secondManifest = await runEffect(
      publishApplicationRelationBindingEffect(repository, secondInput),
    );

    expect(first.status).toBe("created");
    expect(replay.status).toBe("existing");
    expect(replay.binding).toEqual(first.binding);
    expect(secondManifest.status).toBe("existing");
    expect(secondManifest.binding.schemaVersionId).toBe(
      first.binding.schemaVersionId,
    );
    expect(secondManifest.boundPublicationSha256).toBe(
      first.boundPublicationSha256,
    );
    expect(secondManifest.manifestBinding.applicationManifestSha256).not.toBe(
      first.manifestBinding.applicationManifestSha256,
    );
    const located = await runEffect(
      locateApplicationRelationManifestBindingEffect(persistence.drizzle, {
        deploymentId,
        applicationManifestSha256:
          first.manifestBinding.applicationManifestSha256,
      }),
    );
    expect(located?.manifestBinding.binding).toEqual(first.manifestBinding);
    expect(located?.relationBinding).toMatchObject({
      deploymentId,
      schemaVersionId: first.binding.schemaVersionId,
      binding: first.binding,
    });
    const absent = await runEffect(
      locateApplicationRelationManifestBindingEffect(persistence.drizzle, {
        deploymentId,
        applicationManifestSha256:
          ApplicationManifestSchemaBindingSha256HexSchema.make(
            "0".repeat(64),
          ),
      }),
    );
    expect(absent).toBeNull();
    await expectCounts(persistence, {
      fx_control_schema_version: 1,
      fx_control_table: 2,
      fx_control_relation: 1,
      fx_control_edge_definition: 1,
      fx_control_schema_relation_binding: 1,
      fx_control_bound_application_schema: 1,
      fx_control_application_manifest_schema_binding: 2,
    });
  });

  it("requires explicit exact physical reuse and keeps replacements alongside it", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_evolution";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    const first = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      await publicationInput(
        deploymentId,
        "a".repeat(64),
        [{ relationOrdinal: 1, evolution: { kind: "new" } }],
      ),
    ));
    const renamed = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      await publicationInput(
        deploymentId,
        "b".repeat(64),
        [{
          relationOrdinal: 1,
          evolution: {
            kind: "preserve",
            fromSchemaVersionId: first.binding.schemaVersionId,
            fromRelationOrdinal: 1,
            physical: "reuse",
          },
        }],
        { inverseName: "articles" },
      ),
    ));

    expect(renamed.binding.schemaVersion).toBe(first.binding.schemaVersion + 1);
    expect(renamed.binding.relationBindings[0]?.relationId).toBe(
      first.binding.relationBindings[0]?.relationId,
    );
    expect(renamed.binding.relationBindings[0]?.edgeDefinitionId).toBe(
      first.binding.relationBindings[0]?.edgeDefinitionId,
    );
    expect(renamed.binding.relationBindings[0]?.semanticDefinitionSha256)
      .not.toBe(
        first.binding.relationBindings[0]?.semanticDefinitionSha256,
      );

    const unnecessaryReplacement = await runEffect(Effect.result(
      publishApplicationRelationBindingEffect(
        repository,
        await publicationInput(
          deploymentId,
          "e".repeat(64),
          [{
            relationOrdinal: 1,
            evolution: {
              kind: "preserve",
              fromSchemaVersionId: renamed.binding.schemaVersionId,
              fromRelationOrdinal: 1,
              physical: "replace",
            },
          }],
          { inverseName: "entries" },
        ),
      ),
    ));
    expect(Result.isFailure(unnecessaryReplacement)).toBe(true);
    if (Result.isFailure(unnecessaryReplacement)) {
      expect(unnecessaryReplacement.failure.reason).toBe(
        "physicalReplacementMatch",
      );
    }

    const changedPhysicalInput = await publicationInput(
      deploymentId,
      "c".repeat(64),
      [{
        relationOrdinal: 1,
        evolution: {
          kind: "preserve",
          fromSchemaVersionId: renamed.binding.schemaVersionId,
          fromRelationOrdinal: 1,
          physical: "reuse",
        },
      }],
      { inverseName: "articles", many: true },
    );
    const rejectedReuse = await runEffect(Effect.result(
      publishApplicationRelationBindingEffect(
        repository,
        changedPhysicalInput,
      ),
    ));
    expect(Result.isFailure(rejectedReuse)).toBe(true);
    if (Result.isFailure(rejectedReuse)) {
      expect(rejectedReuse.failure.reason).toBe("physicalReuseMismatch");
    }

    const replaced = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      {
        ...changedPhysicalInput,
        decisions: [{
          relationOrdinal: 1,
          evolution: {
            kind: "preserve",
            fromSchemaVersionId: renamed.binding.schemaVersionId,
            fromRelationOrdinal: 1,
            physical: "replace",
          },
        }],
      },
    ));
    expect(replaced.binding.relationBindings[0]?.relationId).toBe(
      first.binding.relationBindings[0]?.relationId,
    );
    expect(replaced.binding.relationBindings[0]?.edgeDefinitionId).not.toBe(
      first.binding.relationBindings[0]?.edgeDefinitionId,
    );
    await expectCounts(persistence, {
      fx_control_relation: 1,
      fx_control_edge_definition: 2,
      fx_control_schema_relation_binding: 3,
      fx_control_bound_application_schema: 3,
      fx_control_application_manifest_schema_binding: 3,
    });
  });

  it("rolls back the base catalogs and relation projections as one unit", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_rollback";
    await insertDeployment(persistence, deploymentId);
    const rollback = new Error("rollback after relation publication");
    const repository: ApplicationRelationBindingRepository = {
      db: persistence.drizzle,
      runTransaction: <Value>(
        run: (tx: StableTableCatalogTransaction) => Promise<Value>,
      ): Promise<Value> => persistence.drizzle.transaction(async tx => {
        await run(tx);
        throw rollback;
      }),
    };
    const result = await runEffect(Effect.result(
      publishApplicationRelationBindingEffect(
        repository,
        await publicationInput(
          deploymentId,
          "a".repeat(64),
          [{ relationOrdinal: 1, evolution: { kind: "new" } }],
        ),
      ),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        reason: "resourceFailure",
        retryable: false,
        cause: rollback,
      });
    }
    await expectCounts(persistence, {
      fx_control_schema_version: 0,
      fx_control_table: 0,
      fx_control_relation: 0,
      fx_control_edge_definition: 0,
      fx_control_schema_relation_binding: 0,
      fx_control_bound_application_schema: 0,
      fx_control_application_manifest_schema_binding: 0,
    });
  });

  it("fails closed when retained application-schema collision evidence drifts", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_schema_evidence";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    const input = await publicationInput(
      deploymentId,
      "a".repeat(64),
      [{ relationOrdinal: 1, evolution: { kind: "new" } }],
    );
    await runEffect(publishApplicationRelationBindingEffect(repository, input));
    await persistence.drizzle.update(fxControlBoundApplicationSchemas).set({
      applicationSchemaFrameBytes: new Uint8Array([1]),
    }).where(eq(
      fxControlBoundApplicationSchemas.deploymentId,
      deploymentId,
    ));

    const replay = await runEffect(Effect.result(
      publishApplicationRelationBindingEffect(repository, input),
    ));
    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure.reason).toBe("storedState");
    }
  });

  it("fails closed when retained analyzed-manifest collision evidence drifts", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_manifest_evidence";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    const input = await publicationInput(
      deploymentId,
      "a".repeat(64),
      [{ relationOrdinal: 1, evolution: { kind: "new" } }],
    );
    const publication = await runEffect(
      publishApplicationRelationBindingEffect(repository, input),
    );
    await persistence.drizzle.update(
      fxControlApplicationManifestSchemaBindings,
    ).set({
      applicationManifestBytes: new Uint8Array([1]),
    }).where(eq(
      fxControlApplicationManifestSchemaBindings.deploymentId,
      deploymentId,
    ));

    const located = await runEffect(Effect.result(
      locateApplicationRelationManifestBindingEffect(persistence.drizzle, {
        deploymentId,
        applicationManifestSha256:
          publication.manifestBinding.applicationManifestSha256,
      }),
    ));
    expect(Result.isFailure(located)).toBe(true);
    if (Result.isFailure(located)) {
      expect(located.failure).toMatchObject({
        operation: "locateManifestBinding",
        reason: "storedState",
      });
    }

    const replay = await runEffect(Effect.result(
      publishApplicationRelationBindingEffect(repository, input),
    ));
    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure.reason).toBe("bindingConflict");
    }
  });

  it("round-trips canonical negative zero through JSONB", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_negative_zero";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    const input = await publicationInput(
      deploymentId,
      "a".repeat(64),
      [{ relationOrdinal: 1, evolution: { kind: "new" } }],
      { many: true, minItems: -0 },
    );

    const created = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      input,
    ));
    const replay = await runEffect(publishApplicationRelationBindingEffect(
      repository,
      input,
    ));

    expect(created.status).toBe("created");
    expect(replay.status).toBe("existing");
    expect(replay.boundPublicationSha256).toBe(
      created.boundPublicationSha256,
    );
  });

  it("rejects missing and self-referential preserved origins in SQL", async () => {
    const persistence = await migratedPersistence();
    const deploymentId = "deployment_relation_binding_origin_check";
    await insertDeployment(persistence, deploymentId);
    const repository = repositoryFor(persistence);
    await runEffect(publishApplicationRelationBindingEffect(
      repository,
      await publicationInput(
        deploymentId,
        "a".repeat(64),
        [{ relationOrdinal: 1, evolution: { kind: "new" } }],
      ),
    ));

    await expect(persistence.query(`
      update fx_control_schema_relation_binding
      set evolution_kind = 'preserve',
          origin_schema_version_id = null,
          origin_relation_ordinal = null,
          physical_evolution = 'reuse'
      where deployment_id = $1
    `, [deploymentId])).rejects.toThrow();
    await expect(persistence.query(`
      update fx_control_schema_relation_binding
      set evolution_kind = 'preserve',
          origin_schema_version_id = schema_version_id,
          origin_relation_ordinal = relation_ordinal,
          physical_evolution = 'reuse'
      where deployment_id = $1
    `, [deploymentId])).rejects.toThrow();

    const retained = await persistence.query<{
      evolution_kind: string;
      origin_schema_version_id: string | null;
      origin_relation_ordinal: number | null;
      physical_evolution: string;
    }>(`
      select evolution_kind, origin_schema_version_id,
        origin_relation_ordinal, physical_evolution
      from fx_control_schema_relation_binding
      where deployment_id = $1
    `, [deploymentId]);
    expect(retained.rows).toEqual([{
      evolution_kind: "new",
      origin_schema_version_id: null,
      origin_relation_ordinal: null,
      physical_evolution: "new",
    }]);
  });
});

interface RelationOptions {
  readonly inverseName?: string;
  readonly many?: boolean;
  readonly minItems?: number;
}

async function publicationInput(
  deploymentId: string,
  rootSha256: string,
  decisions: PublishApplicationRelationBindingInput["decisions"],
  options: RelationOptions = {},
): Promise<PublishApplicationRelationBindingInput> {
  const canonical = Result.getOrThrow(canonicalizeApplicationManifestV2(
    manifestInput(rootSha256, options),
  ));
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    copyBytesToArrayBuffer(canonical.canonicalBytes),
  ));
  return Object.freeze({
    deploymentId,
    manifest: canonical.manifest,
    manifestSha256: encodeBytesToLowercaseHex(digest),
    decisions,
  });
}

function manifestInput(
  rootSha256: string,
  options: RelationOptions,
): ApplicationManifestV2 {
  const many = options.many === true;
  return Result.getOrThrow(canonicalizeApplicationManifestV2({
    format: "flarex.application-manifest",
    version: 2,
    sourceArtifact: {
      rootSha256,
      executionModulePath: "functions.js",
      schemaModulePath: "schema.js",
      modules: [{
        path: "functions.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: "e".repeat(64),
        sourceByteLength: 18,
      }, {
        path: "schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: "f".repeat(64),
        sourceByteLength: 32,
      }],
    },
    schema: {
      version: 2,
      tables: [{
        tableId: 1,
        name: "posts",
        validator: {
          type: "object",
          value: {
            author: {
              fieldType: many
                ? {
                    type: "array",
                    value: { type: "id", tableName: "users" },
                  }
                : { type: "id", tableName: "users" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }, {
        tableId: 2,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }],
      indexes: [],
      relations: [{
        relationOrdinal: 1,
        sourceTableOrdinal: 1,
        targetTableOrdinal: 2,
        declaration: {
          format: "flarex.relation-declaration",
          version: 1,
          source: {
            table: "posts",
            path: [{ kind: "field", name: "author" }],
            forwardName: "author",
          },
          target: { table: "users" },
          value: many
            ? {
                cardinality: "many",
                minItems: options.minItems ?? 0,
                maxItems: 32,
                ordered: true,
                duplicates: "forbid",
              }
            : { cardinality: "one", required: true },
          inverse: {
            cardinality: "many",
            name: options.inverseName ?? "posts",
          },
          localized: false,
          onTargetDelete: "restrict",
        },
      }],
    },
    functions: [],
  })).manifest;
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

function repositoryFor(
  persistence: PGlitePersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run),
  };
}

async function expectCounts(
  persistence: PGlitePersistence,
  expected: Readonly<Record<string, number>>,
): Promise<void> {
  for (const [table, count] of Object.entries(expected)) {
    const result = await persistence.query<{ count: string }>(
      `select count(*)::text as count from ${table}`,
    );
    expect(result.rows).toEqual([{ count: String(count) }]);
  }
}
