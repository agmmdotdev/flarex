import { setTimeout as delay } from "node:timers/promises";

import { and, asc, eq, sql } from "drizzle-orm";
import { Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity } from
  "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  type ApplicationRelationBindingPublication,
  type ApplicationRelationBindingRepository,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { createApplicationRelationServingInspector } from
  "../src/applicationRelationServing";
import {
  createApplicationRelationBuildPort,
  type ApplicationRelationBuildPort,
} from "../src/applicationRelationBuild";
import { createApplicationRelationCommitPort } from
  "../src/applicationRelationCommit";
import {
  createApplicationRelationReadinessPort,
  type PreparedApplicationRelationReadiness,
  type ApplicationRelationReadinessPort,
  type ApplicationRelationReadinessStepResult,
  validateApplicationRelationSetReadinessInTransactionEffect,
} from "../src/applicationRelationReadiness";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from
  "../src/appRows";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxControlEdgeDefinitions,
  fxControlRelations,
  fxSystemApplicationRelationSemanticReadiness,
  fxSystemApplicationRelationSemanticValidations,
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../src/schema";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { resolveLocatedTrustedScopeAuthorityEffect } from
  "../src/scopeAuthorityResolution";
import { lockScopeClockForUpdateInTransactionEffect } from
  "../src/scopeClock";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildDocumentId,
  relationBuildPublicationInput,
  relationBuildRowId,
  type RelationBuildPublicationOptions,
} from "./applicationRelationBuildTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "e01-b-postgres",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describe("E01-B PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting E01-B.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL E01-B application relation readiness", () => {
  it("migrates, restarts, rolls back, serializes settlement, replays, and chains without sidecar writes", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const version = await target.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const original = await publishNew(fixture, 20_001);
      await seedPopulatedRows(fixture, original, 3);
      const edgeDefinitionId = await enablePhysicalReadiness(
        fixture,
        original,
      );
      const sidecarsBefore = await sidecarCounts(fixture, edgeDefinitionId);
      expect(sidecarsBefore).toEqual({ edges: "3", versions: "6" });

      const reused = await publishReuse(fixture, 20_002, original, {
        extraUserField: true,
      });
      const chained = await publishReuse(fixture, 20_003, reused, {
        extraUserField: true,
        inverseName: "articles",
      });
      const chainedBlocked = await runEffect(fixture.readiness.advance(
        readinessInput(fixture, chained),
      ));
      expect(chainedBlocked).toMatchObject({
        status: "not_ready",
        reason: "semanticOriginMissing",
      });

      const reusedInput = readinessInput(fixture, reused);
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "initialized",
          lifecycle: "validating_sources",
          attemptFence: 1n,
          frontierCommitSeq: 1n,
        });
      await target.drizzle.update(fxSystemScopeClocks).set({
        lastCommitSeq: CommitSeqSchema.make(2n),
      }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "restarted",
          lifecycle: "validating_sources",
          attemptFence: 2n,
          frontierCommitSeq: 2n,
        });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "advanced",
          lifecycle: "validating_edges",
        });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({
          status: "advanced",
          lifecycle: "validating_versions",
        });

      const rollback = await runEffectFailure(fixture.readiness.advance(
        reusedInput,
        {
          faultAfter: (point) => {
            if (point === "afterReceiptInsert") {
              throw new Error("injected PostgreSQL E01-B receipt failure");
            }
          },
        },
      ));
      expect(rollback).toMatchObject({
        _tag: "ApplicationRelationReadinessPersistenceError",
        retryable: false,
      });
      expect(await semanticReceiptCount(fixture)).toBe("0");
      expect(await semanticHead(fixture, reused)).toMatchObject({
        lifecycle: "validating_versions",
        attempt_fence: "2",
        frontier_commit_seq: "2",
        readiness_sha256: null,
      });

      const blocker = await acquireScopeClockLock(fixture);
      let released = false;
      let concurrent: ReadonlyArray<ApplicationRelationReadinessStepResult> |
        undefined;
      const pending = Array.from({ length: 3 }, () =>
        runEffect(fixture.readiness.advance(reusedInput))
      );
      try {
        await waitForBlockedScopeClockOperations(target, blocker.pid, 3);
        await blocker.client.query("commit");
        released = true;
        concurrent = await Promise.all(pending);
      } finally {
        if (!released) {
          await blocker.client.query("rollback").catch(() => undefined);
        }
        blocker.client.release();
        if (concurrent === undefined) await Promise.allSettled(pending);
      }
      if (concurrent === undefined) {
        throw new Error("PostgreSQL E01-B concurrent settlement did not finish.");
      }
      expect(concurrent.map((result) => result.status).sort()).toEqual([
        "complete",
        "complete",
        "ready",
      ]);
      expect(await semanticReceiptCount(fixture)).toBe("1");
      expect(await semanticHead(fixture, reused)).toMatchObject({
        lifecycle: "ready",
        attempt_fence: "2",
        frontier_commit_seq: "2",
        source_count: "3",
        edge_count: "3",
        version_count: "6",
      });
      expect(await runEffect(fixture.readiness.advance(reusedInput)))
        .toMatchObject({ status: "complete" });

      const cold = composePorts(fixture).readiness;
      expect(await runEffect(cold.advance(reusedInput))).toMatchObject({
        status: "complete",
      });
      const chainedSteps = await advanceUntilComplete(fixture, chained);
      expect(chainedSteps.at(-1)?.status).toBe("complete");
      const reusedHead = await semanticHead(fixture, reused);
      const chainedReceipt = await semanticReceipt(fixture, chained);
      expect(chainedReceipt).toMatchObject({
        origin_readiness_kind: "semantic",
        origin_schema_version_id: reused.binding.schemaVersionId,
        origin_semantic_attempt_fence: reusedHead?.attempt_fence,
        physical_origin_schema_version_id: original.binding.schemaVersionId,
        physical_frontier_commit_seq: "1",
        frontier_commit_seq: "2",
      });
      expect(chainedReceipt?.origin_semantic_readiness_sha256).toEqual(
        reusedHead?.readiness_sha256,
      );
      expect(await semanticReceiptCount(fixture)).toBe("2");
      expect(await sidecarCounts(fixture, edgeDefinitionId)).toEqual(
        sidecarsBefore,
      );
    });
  }, 240_000);

  it("authenticates an ordered two-relation set across semantic reuse", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const original = await publishNew(fixture, 30_001, {
        secondRelation: true,
        inverseName: "authoredPosts",
        secondInverseName: "reviewedPosts",
      });
      const enabled = await enablePhysicalReadinessSet(fixture, original);
      expect(enabled.map(definition => definition.relationOrdinal)).toEqual([
        1,
        2,
      ]);
      const originalPrepared = await runEffect(fixture.readiness.prepare(
        readinessInput(fixture, original),
      ));
      const direct = await validateSet(fixture, originalPrepared);
      expect(direct.status).toBe("ready");
      if (direct.status !== "ready") {
        throw new Error("PostgreSQL direct relation set was not ready.");
      }
      expect(direct.evidence.receipt.relations.map(child => ({
        ordinal: child.relationOrdinal,
        kind: child.readinessKind,
      }))).toEqual([
        { ordinal: 1, kind: "physical" },
        { ordinal: 2, kind: "physical" },
      ]);
      const before = await physicalStateSnapshot(fixture);

      const successor = await publishReuse(fixture, 30_002, original, {
        inverseName: "articlesAuthored",
        secondInverseName: "articlesReviewed",
      });
      await advanceUntilComplete(fixture, successor);
      const successorPrepared = await runEffect(fixture.readiness.prepare(
        readinessInput(fixture, successor),
      ));
      const semantic = await validateSet(fixture, successorPrepared);
      expect(semantic.status).toBe("ready");
      if (semantic.status !== "ready") {
        throw new Error("PostgreSQL semantic relation set was not ready.");
      }
      expect(semantic.evidence.receipt.relations.map(child => ({
        ordinal: child.relationOrdinal,
        kind: child.readinessKind,
      }))).toEqual([
        { ordinal: 1, kind: "semantic" },
        { ordinal: 2, kind: "semantic" },
      ]);
      expect(new Set(semantic.evidence.receipt.relations.map(child =>
        child.readinessSha256
      )).size).toBe(2);
      expect(semantic.evidence.sha256).not.toEqual(direct.evidence.sha256);
      expect(await physicalStateSnapshot(fixture)).toEqual(before);
    });
  }, 240_000);
});

interface Fixture {
  readonly control: PostgresFlarexPersistence;
  readonly target: PostgresFlarexPersistence;
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly authority: Parameters<typeof createApplicationRelationBuildPort>[1];
  readonly build: ApplicationRelationBuildPort;
  readonly readiness: ApplicationRelationReadinessPort;
}

async function fixtureFor(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
): Promise<Fixture> {
  ensureRelationBuildTestWebCrypto();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_e01_b_postgres",
  );
  const scopeId = ScopeIdSchema.make(
    "scope_e01b0000-0000-4000-8000-000000000001",
  );
  const epoch = ScopeEpochSchema.make(
    "epoch_e01b0000-0000-4000-8000-000000000001",
  );
  await control.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_e01_b_postgres",
  });
  await control.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await target.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, storage_generation_fence,
        last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const pointTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(
    target,
    LOCATOR,
  );
  const relationCommit = createApplicationRelationCommitPort(
    control.drizzle,
    {
      scopeMetadata: control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeSessionTargets: { resolve: async () => pointTarget },
    },
  );
  const base = Object.freeze({
    control,
    target,
    deploymentId,
    scopeId,
    epoch,
    relationCommit,
  });
  return Object.freeze({ ...base, ...composePorts(base) });
}

function composePorts(fixture: Pick<
  Fixture,
  "control" | "target" | "relationCommit"
>): Pick<Fixture, "authority" | "build" | "readiness"> {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    fixture.target,
    LOCATOR,
  );
  const authority = {
    scopeMetadata: fixture.control,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeClockTargets: { resolve: async () => target },
  } satisfies Parameters<typeof createApplicationRelationBuildPort>[1];
  const build = createApplicationRelationBuildPort(
    fixture.control.drizzle,
    authority,
    fixture.relationCommit,
    createApplicationRelationServingInspector(),
  );
  return Object.freeze({
    authority,
    build,
    readiness: createApplicationRelationReadinessPort(
      fixture.control.drizzle,
      authority,
      fixture.relationCommit,
      build,
    ),
  });
}

function repositoryFor(fixture: Fixture): ApplicationRelationBindingRepository {
  return {
    db: fixture.control.drizzle,
    runTransaction: (run) => fixture.control.drizzle.transaction(run),
  };
}

async function publishNew(
  fixture: Fixture,
  ordinal: number,
  options: RelationBuildPublicationOptions = {},
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(
      fixture.deploymentId,
      ordinal,
      options,
    ),
  ));
}

async function publishReuse(
  fixture: Fixture,
  ordinal: number,
  origin: ApplicationRelationBindingPublication,
  options: Readonly<{
    readonly extraUserField?: boolean;
    readonly inverseName?: string;
    readonly secondInverseName?: string;
  }>,
): Promise<ApplicationRelationBindingPublication> {
  return runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(fixture),
    await relationBuildPublicationInput(fixture.deploymentId, ordinal, {
      ...options,
      secondRelation: origin.binding.relationBindings.length === 2,
      decisions: Object.freeze(origin.binding.relationBindings.map(
        binding => Object.freeze({
          relationOrdinal: binding.relationOrdinal,
          evolution: Object.freeze({
            kind: "preserve" as const,
            fromSchemaVersionId: origin.binding.schemaVersionId,
            fromRelationOrdinal: binding.relationOrdinal,
            physical: "reuse" as const,
          }),
        }))),
    }),
  ));
}

function readinessInput(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    applicationManifestSha256:
      publication.manifestBinding.applicationManifestSha256,
  });
}

async function enablePhysicalReadiness(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const enabled = await enablePhysicalReadinessSet(fixture, publication);
  const first = enabled[0];
  if (first === undefined) {
    throw new Error("PostgreSQL E01-B physical definition is missing.");
  }
  return first.edgeDefinitionId;
}

async function enablePhysicalReadinessSet(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const definitions = await runEffect(fixture.relationCommit.locate({
    deploymentId: fixture.deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  if (definitions === null) {
    throw new Error("PostgreSQL E01-B physical definition set is missing.");
  }
  const enabled: Array<Readonly<{
    readonly relationOrdinal: number;
    readonly edgeDefinitionId: Parameters<
      ApplicationRelationBuildPort["advance"]
    >[0]["edgeDefinitionId"];
  }>> = [];
  for (let index = 0; index < definitions.definitions.length; index += 1) {
    const definition = definitions.definitions[index];
    if (
      definition === undefined ||
      definition.binding.relationOrdinal !== index + 1
    ) {
      throw new Error("PostgreSQL E01-B definition set is not dense.");
    }
    const input = Object.freeze({
      deploymentId: fixture.deploymentId,
      schemaVersionId: publication.binding.schemaVersionId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    });
    let settled = false;
    for (let step = 0; step < 32; step += 1) {
      if ((await runEffect(fixture.build.advance(input))).lifecycle ===
        "enabled") {
        settled = true;
        break;
      }
    }
    if (!settled) {
      throw new Error("PostgreSQL E01-B physical readiness did not settle.");
    }
    enabled.push(Object.freeze({
      relationOrdinal: definition.binding.relationOrdinal,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
    }));
  }
  return Object.freeze(enabled);
}

async function seedPopulatedRows(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
  count: number,
): Promise<void> {
  const rows = Array.from({ length: count }, (_, index) => [{
    tableIdValue: 2,
    ordinal: 201 + index,
    fields: Object.freeze({ name: `target-${index + 1}` }),
  }, {
    tableIdValue: 1,
    ordinal: 101 + index,
    fields: Object.freeze({
      author: relationBuildDocumentId(2, 201 + index),
    }),
  }]).flat();
  const commitSeq = CommitSeqSchema.make(1n);
  await fixture.target.drizzle.transaction(async (tx) => {
    for (const row of rows) {
      const tableId = decodeCatalogTableId(row.tableIdValue);
      const rowId = relationBuildRowId(row.ordinal);
      const creationTime = decodeAppCreationTimeV1(row.ordinal);
      const value = await canonicalizeFlarexValueV1({
        _id: appDocumentIdV1FromRowIdentity({ tableId, rowId }),
        _creationTime: creationTime,
        ...row.fields,
      }, "appDocument");
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.scopeId,
        tableId,
        rowId,
        writeEpoch: fixture.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: publication.binding.schemaVersionId,
        creationTime,
        value: {
          codecVersion: value.codecVersion,
          valueJson: value.valueJson,
          canonicalBytes: value.canonicalBytes,
          sha256: value.sha256,
        },
      });
    }
    await tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
  });
}

async function advanceUntilComplete(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
): Promise<ReadonlyArray<ApplicationRelationReadinessStepResult>> {
  const input = readinessInput(fixture, publication);
  const steps: ApplicationRelationReadinessStepResult[] = [];
  for (let step = 0; step < 32; step += 1) {
    const result = await runEffect(fixture.readiness.advance(input));
    steps.push(result);
    if (result.status === "complete") return Object.freeze(steps);
    if (result.status === "not_ready") {
      throw new Error(`PostgreSQL E01-B blocked: ${result.reason}.`);
    }
  }
  throw new Error("PostgreSQL E01-B semantic readiness did not settle.");
}

async function validateSet(
  fixture: Fixture,
  prepared: PreparedApplicationRelationReadiness,
) {
  const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
    fixture.deploymentId,
    fixture.authority,
  ));
  return fixture.target.drizzle.transaction(async (tx) => {
    const clock = await runEffect(
      lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId),
    );
    return runEffect(
      validateApplicationRelationSetReadinessInTransactionEffect(
        fixture.readiness,
        tx,
        located.authority,
        clock,
        prepared,
      ),
    );
  });
}

async function physicalStateSnapshot(fixture: Fixture) {
  const [relations, definitions, builds, receipts, edges, versions] =
    await Promise.all([
      fixture.control.drizzle.select().from(fxControlRelations).orderBy(
        asc(fxControlRelations.relationId),
      ),
      fixture.control.drizzle.select().from(
        fxControlEdgeDefinitions,
      ).orderBy(asc(fxControlEdgeDefinitions.edgeDefinitionId)),
      fixture.target.drizzle.select().from(
        fxSystemEdgeDefinitionBuilds,
      ).orderBy(asc(fxSystemEdgeDefinitionBuilds.edgeDefinitionId)),
      fixture.target.drizzle.select().from(
        fxSystemEdgeDefinitionReadiness,
      ).orderBy(
        asc(fxSystemEdgeDefinitionReadiness.edgeDefinitionId),
        asc(fxSystemEdgeDefinitionReadiness.attemptFence),
      ),
      fixture.target.drizzle.select().from(fxAppEdgeCurrent).orderBy(
        asc(fxAppEdgeCurrent.edgeDefinitionId),
        asc(fxAppEdgeCurrent.sourceRowId),
        asc(fxAppEdgeCurrent.targetRowId),
        asc(fxAppEdgeCurrent.duplicateOrdinal),
      ),
      fixture.target.drizzle.select().from(
        fxAppEdgeAdjacencyVersions,
      ).orderBy(
        asc(fxAppEdgeAdjacencyVersions.edgeDefinitionId),
        asc(fxAppEdgeAdjacencyVersions.direction),
        asc(fxAppEdgeAdjacencyVersions.endpointRowId),
      ),
    ]);
  return structuredClone({
    relations,
    definitions,
    builds,
    receipts,
    edges,
    versions,
  });
}

async function sidecarCounts(
  fixture: Fixture,
  edgeDefinitionId: Awaited<ReturnType<typeof enablePhysicalReadiness>>,
) {
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(fixture.scopeId),
  ).scopeUuid;
  const [edges, versions] = await Promise.all([
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, scopeUuid),
        eq(fxAppEdgeCurrent.edgeDefinitionId, edgeDefinitionId),
      )),
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid),
        eq(fxAppEdgeAdjacencyVersions.edgeDefinitionId, edgeDefinitionId),
      )),
  ]);
  return Object.freeze({
    edges: edges[0]?.count ?? "missing",
    versions: versions[0]?.count ?? "missing",
  });
}

async function semanticReceiptCount(fixture: Fixture): Promise<string> {
  const rows = await fixture.target.drizzle.select({
    count: sql<string>`count(*)::text`,
  }).from(fxSystemApplicationRelationSemanticReadiness).where(eq(
    fxSystemApplicationRelationSemanticReadiness.scopeId,
    fixture.scopeId,
  ));
  return rows[0]?.count ?? "missing";
}

async function semanticHead(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const result = await fixture.target.query<{
    lifecycle: string;
    attempt_fence: string;
    frontier_commit_seq: string;
    source_count: string;
    edge_count: string;
    version_count: string;
    readiness_sha256: Uint8Array | null;
  }>(
    `select lifecycle, attempt_fence::text, frontier_commit_seq::text,
            validated_source_count::text source_count,
            validated_edge_count::text edge_count,
            validated_version_count::text version_count,
            readiness_sha256
       from fx_system_application_relation_semantic_validation
      where scope_id = $1 and schema_version_id = $2 and relation_ordinal = 1`,
    [fixture.scopeId, publication.binding.schemaVersionId],
  );
  return result.rows[0] ?? null;
}

async function semanticReceipt(
  fixture: Fixture,
  publication: ApplicationRelationBindingPublication,
) {
  const result = await fixture.target.query<{
    origin_readiness_kind: string;
    origin_schema_version_id: string;
    origin_semantic_attempt_fence: string | null;
    origin_semantic_readiness_sha256: Uint8Array | null;
    physical_origin_schema_version_id: string;
    physical_frontier_commit_seq: string;
    frontier_commit_seq: string;
  }>(
    `select origin_readiness_kind, origin_schema_version_id,
            origin_semantic_attempt_fence::text,
            origin_semantic_readiness_sha256,
            physical_origin_schema_version_id,
            physical_frontier_commit_seq::text,
            frontier_commit_seq::text
       from fx_system_application_relation_semantic_readiness
      where scope_id = $1 and schema_version_id = $2 and relation_ordinal = 1`,
    [fixture.scopeId, publication.binding.schemaVersionId],
  );
  return result.rows[0] ?? null;
}

async function acquireScopeClockLock(fixture: Fixture): Promise<{
  readonly client: PoolClient;
  readonly pid: number;
}> {
  const client = await fixture.target.pool.connect();
  try {
    await client.query("begin");
    const pid = await client.query<{ pid: number }>(
      "select pg_backend_pid()::int pid",
    );
    const value = pid.rows[0]?.pid;
    if (value === undefined) throw new Error("E01-B blocker PID missing.");
    await client.query(
      `select 1 from fx_system_scope_clock
        where scope_id = $1 for update`,
      [fixture.scopeId],
    );
    return Object.freeze({ client, pid: value });
  } catch (cause) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw cause;
  }
}

async function waitForBlockedScopeClockOperations(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity activity
          where $1::int = any(pg_blocking_pids(activity.pid))
         union
         select activity.pid
           from pg_stat_activity activity
           join blocked blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int blocked
         from blocked
         join pg_stat_activity activity using (pid)
        where activity.datname = current_database()`,
      [blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= expected) return;
    await delay(25);
  }
  throw new Error(`Expected ${expected} E01-B scope-clock waiters.`);
}
