import { PGlite } from "@electric-sql/pglite";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import type { FlarexMetadataDatabase } from "../src/deployments";
import { admitFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/admission";
import {
  captureFrameworkSchemaArtifact,
  copyCapturedFrameworkSchemaArtifactEvidence,
} from "../src/frameworkSchema/artifact/canonical";
import type {
  FrameworkSchemaArtifact,
  FrameworkSchemaArtifactCaptureInput,
  FrameworkSchemaArtifactIdentity,
} from "../src/frameworkSchema/artifact/model";
import {
  decodeFrameworkSchemaArtifactIdentityResult,
  MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES,
} from "../src/frameworkSchema/artifact/policy";
import { getFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/read";
import {
  prepareFrameworkSchemaArtifactAdmission,
  type FrameworkSchemaArtifactRepository,
} from "../src/frameworkSchema/artifact/repository";
import { loadStoredFrameworkSchemaArtifactEffect } from
  "../src/frameworkSchema/artifact/storedLoader";
import {
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  makePGliteFrameworkSchemaArtifactAdmissionFixture,
} from "./frameworkSchemaArtifactAdmissionTestSupport";
import {
  ARTIFACT_TABLE,
  DEPENDENCY_TABLE,
} from "./frameworkSchemaArtifactStorageTestSupport";

interface CorruptionGraph {
  readonly repository: FrameworkSchemaArtifactRepository;
  readonly parent: FrameworkSchemaArtifact;
  readonly parentStorageId: string;
  readonly dependencies: readonly [
    FrameworkSchemaArtifact,
    FrameworkSchemaArtifact,
  ];
  readonly dependencyStorageIds: readonly [string, string];
  readonly alternateTarget: FrameworkSchemaArtifact;
  readonly alternateTargetStorageId: string;
  readonly sameLineageTarget: FrameworkSchemaArtifact;
  readonly sameLineageTargetStorageId: string;
}

interface StoredReadCorruptionScenario {
  readonly label: string;
  readonly identity: FrameworkSchemaArtifactIdentity;
  readonly storedStage: "artifactRow" | "canonicalFrame" | "dependencyRows";
  readonly mutate: () => Promise<void>;
  readonly inspectLoader?: () => Promise<void>;
}

describe("private framework schema artifact point-read corruption - PGlite", () => {
  it("rejects persisted artifact-row, bounded-byte, frame, identity, digest, and audit corruption", async () => {
    await withPGlitePersistence(async persistence => {
      const graph = await seedCorruptionGraph(persistence);
      await dropArtifactCorruptionConstraints(persistence);
      const canonicalDrift = await captureArtifact({
        lineageId: "lineage-canonical-identity-drift",
        payload: { tables: ["drifted"] },
      });
      const canonicalDriftEvidence = requireCapturedEvidence(canonicalDrift);
      const canonicalDriftHex = Buffer.from(
        canonicalDriftEvidence.canonicalBytes,
      ).toString("hex");
      const driftDigest = graph.parent.identity.artifactSha256 ===
          "00".repeat(32)
        ? "ff".repeat(32)
        : "00".repeat(32);
      const ownerDriftIdentity = Object.freeze({
        ...graph.parent.identity,
        owner: "medusa" as const,
      });
      const digestDriftIdentity = Result.getOrThrow(
        decodeFrameworkSchemaArtifactIdentityResult({
          ...graph.parent.identity,
          artifactSha256: driftDigest,
        }),
      ).identity;

      const scenarios: readonly StoredReadCorruptionScenario[] = [
        {
          label: "bounded canonical-byte gate",
          identity: graph.parent.identity,
          storedStage: "artifactRow",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set canonical_byte_length = $2,
                canonical_bytes = decode(repeat('ff', $2), 'hex')
            where artifact_storage_id = $1
          `, [
            graph.parentStorageId,
            MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES + 1,
          ]).then(() => undefined),
          inspectLoader: async () => {
            const detached = await loadStoredArtifact(
              persistence,
              graph.parent.identity,
            );
            expect(detached).not.toBeNull();
            expect(detached?.artifactRow).toMatchObject({
              canonicalByteLength:
                MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES + 1,
              observedCanonicalByteLength:
                MAX_FRAMEWORK_SCHEMA_ARTIFACT_CANONICAL_BYTES + 1,
              canonicalBytes: null,
            });
          },
        },
        {
          label: "invalid UTF-8",
          identity: graph.parent.identity,
          storedStage: "canonicalFrame",
          mutate: () => replaceCanonicalBytes(
            persistence,
            graph.parentStorageId,
            "ff",
          ),
        },
        {
          label: "invalid JSON",
          identity: graph.parent.identity,
          storedStage: "canonicalFrame",
          mutate: () => replaceCanonicalBytes(
            persistence,
            graph.parentStorageId,
            "7b",
          ),
        },
        {
          label: "noncanonical trailing whitespace",
          identity: graph.parent.identity,
          storedStage: "canonicalFrame",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set canonical_byte_length = canonical_byte_length + 1,
                canonical_bytes = canonical_bytes || decode('20', 'hex')
            where artifact_storage_id = $1
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "canonical identity drift",
          identity: graph.parent.identity,
          storedStage: "canonicalFrame",
          mutate: () => replaceCanonicalBytes(
            persistence,
            graph.parentStorageId,
            canonicalDriftHex,
          ),
        },
        {
          label: "physical owner drift",
          identity: ownerDriftIdentity,
          storedStage: "canonicalFrame",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set owner = 'medusa'
            where artifact_storage_id = $1
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "physical digest drift",
          identity: digestDriftIdentity,
          storedStage: "canonicalFrame",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set artifact_sha256 = decode($2, 'hex')
            where artifact_storage_id = $1
          `, [graph.parentStorageId, driftDigest]).then(() => undefined),
        },
        {
          label: "stored frame-format drift",
          identity: graph.parent.identity,
          storedStage: "artifactRow",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set frame_format = 'other.framework-artifact'
            where artifact_storage_id = $1
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "stored frame-version drift",
          identity: graph.parent.identity,
          storedStage: "artifactRow",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set frame_version = 2
            where artifact_storage_id = $1
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "invalid audit time",
          identity: graph.parent.identity,
          storedStage: "artifactRow",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set admitted_at = 'infinity'::timestamptz
            where artifact_storage_id = $1
          `, [graph.parentStorageId]).then(() => undefined),
        },
      ];

      for (const scenario of scenarios) {
        await withRolledBackCorruption(persistence, async () => {
          await scenario.mutate();
          await scenario.inspectLoader?.();
          await expectStoredReadCorruption(
            graph.repository,
            scenario.identity,
            scenario.storedStage,
            scenario.label,
          );
        });
      }

      expect(await runEffect(getFrameworkSchemaArtifactEffect(
        graph.repository,
        graph.parent.identity,
      ))).toEqual(graph.parent);
    });
  }, 180_000);

  it("rejects every persisted dependency mismatch observable through the bounded loader", async () => {
    await withPGlitePersistence(async persistence => {
      const graph = await seedCorruptionGraph(persistence);
      await dropDependencyCorruptionConstraints(persistence);
      await insertOverflowTargets(persistence);
      const firstDependencyStorageId = graph.dependencyStorageIds[0];
      const secondDependencyStorageId = graph.dependencyStorageIds[1];

      const scenarios: readonly StoredReadCorruptionScenario[] = [
        {
          label: "missing dependency row",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => mutateDependency(persistence, graph, `
            delete from ${DEPENDENCY_TABLE}
            where artifact_storage_id = $1 and dependency_ordinal = 1
          `),
        },
        {
          label: "extra dependency row",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => insertDependencyEdge(
            persistence,
            graph,
            graph.alternateTargetStorageId,
            2,
            graph.alternateTarget.identity.lineageId,
          ),
        },
        {
          label: "ordinal gap",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => mutateDependency(persistence, graph, `
            update ${DEPENDENCY_TABLE}
            set dependency_ordinal = 2
            where artifact_storage_id = $1 and dependency_ordinal = 1
          `),
        },
        {
          label: "duplicate target storage ID",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_storage_id = $2,
                dependency_lineage_id = $3
            where artifact_storage_id = $1 and dependency_ordinal = 1
          `, [
            graph.parentStorageId,
            firstDependencyStorageId,
            graph.dependencies[0].identity.lineageId,
          ]).then(() => undefined),
        },
        {
          label: "zero target storage ID",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_storage_id = 0
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "self target storage ID",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_storage_id = $2,
                dependency_lineage_id = $3
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [
            graph.parentStorageId,
            graph.parentStorageId,
            graph.parent.identity.lineageId,
          ]).then(() => undefined),
        },
        {
          label: "wrong dependency deployment",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set deployment_id = 'deployment-other'
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "wrong dependency owner",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set owner = 'medusa'
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "wrong parent lineage",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set artifact_lineage_id = 'lineage-other-parent'
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "same dependency lineage as parent",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_storage_id = $2,
                dependency_lineage_id = $3
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [
            graph.parentStorageId,
            graph.sameLineageTargetStorageId,
            graph.sameLineageTarget.identity.lineageId,
          ]).then(() => undefined),
        },
        {
          label: "unmatched dependency lineage",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_lineage_id = 'lineage-unmatched-target'
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [graph.parentStorageId]).then(() => undefined),
        },
        {
          label: "coherent wrong dependency target",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${DEPENDENCY_TABLE}
            set dependency_storage_id = $2,
                dependency_lineage_id = $3
            where artifact_storage_id = $1 and dependency_ordinal = 0
          `, [
            graph.parentStorageId,
            graph.alternateTargetStorageId,
            graph.alternateTarget.identity.lineageId,
          ]).then(() => undefined),
        },
        {
          label: "short joined dependency digest",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set artifact_sha256 = decode(repeat('ab', 31), 'hex')
            where artifact_storage_id = $1
          `, [firstDependencyStorageId]).then(() => undefined),
        },
        {
          label: "joined dependency digest drift",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => persistence.query(`
            update ${ARTIFACT_TABLE}
            set artifact_sha256 = decode(repeat('cd', 32), 'hex')
            where artifact_storage_id = $1
          `, [secondDependencyStorageId]).then(() => undefined),
        },
        {
          label: "257 stored dependency rows",
          identity: graph.parent.identity,
          storedStage: "dependencyRows",
          mutate: () => insertOverflowEdges(persistence, graph),
          inspectLoader: async () => {
            const detached = await loadStoredArtifact(
              persistence,
              graph.parent.identity,
            );
            expect(detached?.dependencyRows).toHaveLength(256);
            expect(detached?.dependencyRows.every(row =>
              row.dependencyRowCountText === "257"
            )).toBe(true);
          },
        },
      ];

      for (const scenario of scenarios) {
        await withRolledBackCorruption(persistence, async () => {
          await scenario.mutate();
          await scenario.inspectLoader?.();
          await expectStoredReadCorruption(
            graph.repository,
            scenario.identity,
            scenario.storedStage,
            scenario.label,
          );
        });
      }

      expect(await runEffect(getFrameworkSchemaArtifactEffect(
        graph.repository,
        graph.parent.identity,
      ))).toEqual(graph.parent);
    });
  }, 180_000);
});

async function withPGlitePersistence(
  run: (persistence: PGliteFlarexPersistence) => Promise<void>,
): Promise<void> {
  const database = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db: database });
    await persistence.migrate();
    await run(persistence);
  } finally {
    await database.close();
  }
}

async function seedCorruptionGraph(
  persistence: PGliteFlarexPersistence,
): Promise<CorruptionGraph> {
  await persistence.query(`
    insert into deployments (deployment_id, project_id)
    values
      ('deployment-main', 'project-main'),
      ('deployment-other', 'project-other')
  `);
  const fixture = makePGliteFrameworkSchemaArtifactAdmissionFixture(
    persistence,
  );
  const firstDependency = await captureArtifact({
    lineageId: "lineage-corruption-dependency-0",
    payload: { table: "corruption-dependency-0" },
  });
  const secondDependency = await captureArtifact({
    lineageId: "lineage-corruption-dependency-1",
    payload: { table: "corruption-dependency-1" },
  });
  const dependencies = Object.freeze([
    firstDependency,
    secondDependency,
  ] as const);
  const parent = await captureArtifact({
    lineageId: "lineage-corruption-parent",
    dependencies: dependencies.map(dependency => dependency.identity),
  });
  const alternateTarget = await captureArtifact({
    lineageId: "lineage-corruption-alternate-target",
  });
  const sameLineageTarget = await captureArtifact({
    lineageId: parent.identity.lineageId,
    payload: { tables: ["same-lineage-history"] },
  });
  for (const artifact of [
    ...dependencies,
    alternateTarget,
    sameLineageTarget,
    parent,
  ]) {
    await admitArtifact(fixture.repository, artifact);
  }
  return Object.freeze({
    repository: fixture.repository,
    parent,
    parentStorageId: await requireArtifactStorageId(persistence, parent),
    dependencies,
    dependencyStorageIds: Object.freeze([
      await requireArtifactStorageId(persistence, dependencies[0]),
      await requireArtifactStorageId(persistence, dependencies[1]),
    ] as const),
    alternateTarget,
    alternateTargetStorageId: await requireArtifactStorageId(
      persistence,
      alternateTarget,
    ),
    sameLineageTarget,
    sameLineageTargetStorageId: await requireArtifactStorageId(
      persistence,
      sameLineageTarget,
    ),
  });
}

async function captureArtifact(
  overrides: Partial<FrameworkSchemaArtifactCaptureInput> = {},
): Promise<FrameworkSchemaArtifact> {
  return runEffect(captureFrameworkSchemaArtifact({
    deploymentId: "deployment-main",
    owner: "payload",
    lineageId: "lineage-corruption-default",
    payloadCodec: { format: "json", version: 1 },
    provenance: { source: "compiler" },
    capabilities: [],
    dependencies: [],
    payload: { tables: ["posts"] },
    ...overrides,
  }));
}

async function admitArtifact(
  repository: FrameworkSchemaArtifactRepository,
  artifact: FrameworkSchemaArtifact,
): Promise<void> {
  const prepared = Result.getOrThrow(
    prepareFrameworkSchemaArtifactAdmission(artifact),
  );
  const result = await runEffect(admitFrameworkSchemaArtifactEffect(
    repository,
    prepared,
  ));
  expect(result.status).toBe("created");
}

async function expectStoredReadCorruption(
  repository: FrameworkSchemaArtifactRepository,
  identity: FrameworkSchemaArtifactIdentity,
  storedStage: StoredReadCorruptionScenario["storedStage"],
  label: string,
): Promise<void> {
  const error = await runEffectFailure(
    getFrameworkSchemaArtifactEffect(repository, identity),
  );
  expect(error, label).toMatchObject({
    operation: "read",
    reason: "storedStateCorrupt",
    storedStage,
    identity,
  });
  expect(Object.hasOwn(error, "stage"), label).toBe(false);
  expect(Object.hasOwn(error, "cause"), label).toBe(false);
}

async function withRolledBackCorruption(
  persistence: PGliteFlarexPersistence,
  run: () => Promise<void>,
): Promise<void> {
  await persistence.query("begin");
  try {
    await run();
  } finally {
    await persistence.query("rollback");
  }
}

async function replaceCanonicalBytes(
  persistence: PGliteFlarexPersistence,
  artifactStorageId: string,
  canonicalHex: string,
): Promise<void> {
  await persistence.query(`
    update ${ARTIFACT_TABLE}
    set canonical_byte_length = $2,
        canonical_bytes = decode($3, 'hex')
    where artifact_storage_id = $1
  `, [artifactStorageId, canonicalHex.length / 2, canonicalHex]);
}

async function mutateDependency(
  persistence: PGliteFlarexPersistence,
  graph: CorruptionGraph,
  statement: string,
): Promise<void> {
  await persistence.query(statement, [graph.parentStorageId]);
}

async function insertDependencyEdge(
  persistence: PGliteFlarexPersistence,
  graph: CorruptionGraph,
  targetStorageId: string,
  ordinal: number,
  targetLineageId: string,
): Promise<void> {
  await persistence.query(`
    insert into ${DEPENDENCY_TABLE}
      (artifact_storage_id, dependency_storage_id, deployment_id, owner,
       artifact_lineage_id, dependency_ordinal, dependency_lineage_id)
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [
    graph.parentStorageId,
    targetStorageId,
    graph.parent.identity.deploymentId,
    graph.parent.identity.owner,
    graph.parent.identity.lineageId,
    ordinal,
    targetLineageId,
  ]);
}

async function loadStoredArtifact(
  persistence: PGliteFlarexPersistence,
  identity: FrameworkSchemaArtifactIdentity,
) {
  return runEffect(loadStoredFrameworkSchemaArtifactEffect(
    pgliteControlDatabase(persistence),
    {
      decodedIdentity: Result.getOrThrow(
        decodeFrameworkSchemaArtifactIdentityResult(identity),
      ),
      observePersistenceStage: () => {},
    },
  ));
}

function pgliteControlDatabase(
  persistence: PGliteFlarexPersistence,
): FlarexMetadataDatabase {
  // SAFETY: PGlite's Drizzle adapter exposes the exact PgDatabase query surface
  // consumed by the private loader, as proven by this focused repository lane.
  return persistence.drizzle as unknown as FlarexMetadataDatabase;
}

async function requireArtifactStorageId(
  persistence: PGliteFlarexPersistence,
  artifact: FrameworkSchemaArtifact,
): Promise<string> {
  const result = await persistence.query<{ storage_id: string }>(`
    select artifact_storage_id::text as storage_id
    from ${ARTIFACT_TABLE}
    where deployment_id = $1
      and owner = $2
      and lineage_id = $3
      and artifact_sha256 = decode($4, 'hex')
  `, [
    artifact.identity.deploymentId,
    artifact.identity.owner,
    artifact.identity.lineageId,
    artifact.identity.artifactSha256,
  ]);
  const storageId = result.rows[0]?.storage_id;
  if (storageId === undefined) {
    throw new Error("Missing framework artifact storage identity.");
  }
  return storageId;
}

function requireCapturedEvidence(artifact: FrameworkSchemaArtifact) {
  const evidence = copyCapturedFrameworkSchemaArtifactEvidence(artifact);
  if (evidence === undefined) {
    throw new Error("Expected authentic framework artifact evidence.");
  }
  return evidence;
}

async function dropArtifactCorruptionConstraints(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    alter table ${DEPENDENCY_TABLE}
      drop constraint fx_framework_artifact_dependency_parent_fk,
      drop constraint fx_framework_artifact_dependency_target_fk
  `);
  await persistence.query(`
    alter table ${ARTIFACT_TABLE}
      drop constraint fx_framework_artifact_identity_check,
      drop constraint fx_framework_artifact_frame_check,
      drop constraint fx_framework_artifact_time_check
  `);
}

async function dropDependencyCorruptionConstraints(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    alter table ${ARTIFACT_TABLE}
      drop constraint fx_framework_artifact_identity_check
  `);
  await persistence.query(`
    alter table ${DEPENDENCY_TABLE}
      drop constraint fx_framework_artifact_dependency_target_unique,
      drop constraint fx_framework_artifact_dependency_parent_fk,
      drop constraint fx_framework_artifact_dependency_target_fk,
      drop constraint fx_framework_artifact_dependency_identity_check
  `);
}

async function insertOverflowTargets(
  persistence: PGliteFlarexPersistence,
): Promise<void> {
  await persistence.query(`
    insert into ${ARTIFACT_TABLE}
      (deployment_id, owner, lineage_id, artifact_sha256,
       frame_format, frame_version, canonical_byte_length, canonical_bytes)
    select 'deployment-main', 'payload',
      'lineage-overflow-target-' || lpad(value::text, 3, '0'),
      decode(lpad(to_hex(value), 64, '0'), 'hex'),
      'flarex.framework-schema-artifact', 1, 2, decode('7b7d', 'hex')
    from generate_series(0, 254) as values(value)
  `);
}

async function insertOverflowEdges(
  persistence: PGliteFlarexPersistence,
  graph: CorruptionGraph,
): Promise<void> {
  await persistence.query(`
    insert into ${DEPENDENCY_TABLE}
      (artifact_storage_id, dependency_storage_id, deployment_id, owner,
       artifact_lineage_id, dependency_ordinal, dependency_lineage_id)
    select $1, target.artifact_storage_id, 'deployment-main', 'payload', $2,
      (row_number() over (order by target.artifact_storage_id) + 1)::integer,
      target.lineage_id
    from ${ARTIFACT_TABLE} as target
    where target.lineage_id like 'lineage-overflow-target-%'
    order by target.artifact_storage_id
  `, [graph.parentStorageId, graph.parent.identity.lineageId]);
}
