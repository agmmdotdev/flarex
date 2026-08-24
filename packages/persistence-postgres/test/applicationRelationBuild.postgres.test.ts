import { setTimeout as delay } from "node:timers/promises";

import { and, eq, sql } from "drizzle-orm";
import { Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity } from
  "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
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
  type ApplicationRelationBindingRepository,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import { createApplicationRelationServingInspector } from
  "../src/applicationRelationServing";
import {
  createApplicationRelationBuildPort,
  hasApplicationRelationReadinessEvidenceAuthority,
  type ApplicationRelationBuildPort,
  type ApplicationRelationBuildStepResult,
} from "../src/applicationRelationBuild";
import { createApplicationRelationCommitPort } from
  "../src/applicationRelationCommit";
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
  fxSystemEdgeDefinitionBuilds,
  fxSystemEdgeDefinitionReadiness,
  fxSystemScopeClocks,
} from "../src/schema";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
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
  databaseKey: "e01-a-postgres",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describe("E01-A PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting E01-A.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL E01-A application relation builder", () => {
  it("serializes bounded progress, rolls back faults, replays readiness, and invalidates a moved frontier", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target);
      const version = await target.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);
      await seedPopulatedRows(fixture, 5);

      await runEffect(fixture.port.advance(fixture.input));
      await runEffect(fixture.port.advance(fixture.input));
      const rollback = await runEffectFailure(fixture.port.advance(
        fixture.input,
        {
          faultAfter: (point) => {
            if (point === "afterBackfillRow") {
              throw new Error("injected PostgreSQL E01-A failure");
            }
          },
        },
      ));
      expect(rollback._tag).toBe("ApplicationRelationBuildPersistenceError");
      expect(await counts(fixture)).toEqual({
        edges: "0",
        versions: "0",
        receipts: "0",
      });
      expect(await head(fixture)).toMatchObject({
        lifecycle: "backfilling",
        processed_source_count: "0",
      });

      await target.drizzle.update(fxSystemScopeClocks).set({
        lastCommitSeq: CommitSeqSchema.make(2n),
      }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
      const invalidated = await runEffect(
        fixture.port.advance(fixture.input),
      );
      expect(invalidated).toMatchObject({
        status: "restarted",
        lifecycle: "cleaning",
        attemptFence: 2n,
        frontierCommitSeq: 2n,
      });
      expect(await runEffect(fixture.port.advance(fixture.input)))
        .toMatchObject({ lifecycle: "backfilling" });

      const blocker = await acquireScopeClockLock(fixture);
      let released = false;
      let concurrent: ReadonlyArray<ApplicationRelationBuildStepResult> |
        undefined;
      const pending = Array.from({ length: 7 }, () =>
        runEffect(fixture.port.advance(fixture.input))
      );
      try {
        await waitForBlockedScopeClockOperations(target, blocker.pid, 7);
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
        throw new Error("PostgreSQL E01-A concurrent progress did not settle.");
      }
      expect(concurrent.map((result) => result.status).sort()).toEqual([
        "advanced",
        "advanced",
        "advanced",
        "advanced",
        "advanced",
        "enabled",
        "replayed",
      ]);
      expect(await counts(fixture)).toEqual({
        edges: "5",
        versions: "10",
        receipts: "1",
      });
      const replay = await runEffect(fixture.port.advance(fixture.input));
      expect(replay).toMatchObject({ status: "replayed", lifecycle: "enabled" });
      const evidence = await runEffect(fixture.port.readiness(fixture.input));
      expect(evidence?.receipt).toMatchObject({
        sourceCount: "5",
        edgeCount: "5",
        versionCount: "10",
        frontierCommitSeq: "2",
        attemptFence: "2",
      });
      expect(hasApplicationRelationReadinessEvidenceAuthority(
        fixture.port,
        evidence,
      )).toBe(true);
      expect(await exactContents(fixture)).toEqual(
        expectedContents("2"),
      );

      const coldPort = buildPort(fixture);
      const coldEvidence = await runEffect(coldPort.readiness(fixture.input));
      expect(coldEvidence?.canonicalBytes).toEqual(evidence?.canonicalBytes);
      expect(coldEvidence?.sha256).toEqual(evidence?.sha256);

      await target.drizzle.update(fxSystemScopeClocks).set({
        lastCommitSeq: CommitSeqSchema.make(3n),
      }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
      const moved = await runEffect(fixture.port.advance(fixture.input));
      expect(moved).toMatchObject({
        status: "restarted",
        lifecycle: "cleaning",
        attemptFence: 3n,
        frontierCommitSeq: 3n,
      });
      expect(await runEffect(fixture.port.readiness(fixture.input))).toBeNull();
      expect(await head(fixture)).toMatchObject({
        lifecycle: "cleaning",
        attempt_fence: "3",
        frontier_commit_seq: "3",
        processed_source_count: "0",
        validated_source_count: "0",
        validated_edge_count: "0",
        validated_version_count: "0",
        readiness_sha256: null,
      });
      await advanceUntilEnabled(fixture);
      expect(await exactContents(fixture)).toEqual(
        expectedContents("3"),
      );
      expect(await counts(fixture)).toEqual({
        edges: "5",
        versions: "10",
        receipts: "2",
      });
      expect((await runEffect(fixture.port.readiness(fixture.input)))?.receipt)
        .toMatchObject({
          attemptFence: "3",
          frontierCommitSeq: "3",
          sourceCount: "5",
          edgeCount: "5",
          versionCount: "10",
        });
    });
  }, 240_000);

  it("validates 129 edges and 130 versions through exact PostgreSQL keyset pages", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await fixtureFor(control, target, { many: true });
      await seedFanoutRows(fixture, 129);

      const progress: ApplicationRelationBuildStepResult[] = [];
      for (let step = 0; step < 16; step += 1) {
        const result = await runEffect(fixture.port.advance(fixture.input));
        progress.push(result);
        if (result.lifecycle === "enabled") break;
      }

      expect(progress.at(-1)?.lifecycle).toBe("enabled");
      expect(progress.filter((result) => result.processedEdges > 0)
        .map((result) => result.processedEdges)).toEqual([128, 1]);
      expect(progress.filter((result) => result.processedVersions > 0)
        .map((result) => result.processedVersions)).toEqual([128, 2]);
      expect(await counts(fixture)).toEqual({
        edges: "129",
        versions: "130",
        receipts: "1",
      });
      expect((await runEffect(fixture.port.readiness(fixture.input)))?.receipt)
        .toMatchObject({
          sourceCount: "1",
          edgeCount: "129",
          versionCount: "130",
        });
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
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly port: ApplicationRelationBuildPort;
  readonly input: Parameters<ApplicationRelationBuildPort["advance"]>[0];
}

async function fixtureFor(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
  publicationOptions: RelationBuildPublicationOptions = {},
): Promise<Fixture> {
  ensureRelationBuildTestWebCrypto();
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_e01_postgres",
  );
  const scopeId = ScopeIdSchema.make(
    "scope_e0110000-0000-4000-8000-000000000001",
  );
  const epoch = ScopeEpochSchema.make(
    "epoch_e0120000-0000-4000-8000-000000000001",
  );
  await control.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_e01_postgres",
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
  const publication = await runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(control),
    await relationBuildPublicationInput(deploymentId, 10_001, publicationOptions),
  ));
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
  const definitions = await runEffect(relationCommit.locate({
    deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  const definition = definitions?.definitions[0];
  if (definition === undefined) {
    throw new Error("PostgreSQL E01-A relation definition missing.");
  }
  const input = Object.freeze({
    deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
    edgeDefinitionId: definition.edge.edgeDefinitionId,
  });
  const base = Object.freeze({
    control,
    target,
    deploymentId,
    scopeId,
    epoch,
    schemaVersionId: publication.binding.schemaVersionId,
    relationCommit,
    input,
  });
  return Object.freeze({ ...base, port: buildPort(base) });
}

function buildPort(fixture: Pick<
  Fixture,
  "control" | "target" | "relationCommit"
>): ApplicationRelationBuildPort {
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    fixture.target,
    LOCATOR,
  );
  return createApplicationRelationBuildPort(
    fixture.control.drizzle,
    {
      scopeMetadata: fixture.control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
    fixture.relationCommit,
    createApplicationRelationServingInspector(),
  );
}

async function advanceUntilEnabled(fixture: Fixture): Promise<void> {
  for (let step = 0; step < 32; step += 1) {
    if ((await runEffect(fixture.port.advance(fixture.input))).lifecycle ===
      "enabled") return;
  }
  throw new Error("PostgreSQL E01-A build did not settle in 32 steps.");
}

async function seedPopulatedRows(fixture: Fixture, count: number): Promise<void> {
  await seedRows(fixture, Array.from({ length: count }, (_, index) => [{
    tableIdValue: 2,
    ordinal: 201 + index,
    fields: { name: `target-${index + 1}` },
  }, {
    tableIdValue: 1,
    ordinal: 101 + index,
    fields: { author: relationBuildDocumentId(2, 201 + index) },
  }]).flat());
}

async function seedFanoutRows(fixture: Fixture, count: number): Promise<void> {
  const targets = Array.from({ length: count }, (_, index) => ({
    tableIdValue: 2,
    ordinal: 201 + index,
    fields: { name: `target-${index + 1}` },
  }));
  await seedRows(fixture, [...targets, {
    tableIdValue: 1,
    ordinal: 101,
    fields: {
      author: targets.map((target) =>
        relationBuildDocumentId(target.tableIdValue, target.ordinal)
      ),
    },
  }]);
}

async function seedRows(
  fixture: Fixture,
  rows: ReadonlyArray<{
    readonly tableIdValue: number;
    readonly ordinal: number;
    readonly fields: Readonly<Record<string, unknown>>;
  }>,
): Promise<void> {
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
        schemaVersionId: fixture.schemaVersionId,
        creationTime,
        value: {
          codecVersion: value.codecVersion,
          valueJson: value.valueJson,
          canonicalBytes: value.canonicalBytes,
          sha256: value.sha256,
        },
      });
    }
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, fixture.scopeId),
    );
  });
}

async function counts(fixture: Fixture) {
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(fixture.scopeId),
  ).scopeUuid;
  const [edges, versions, receipts] = await Promise.all([
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, scopeUuid),
        eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
      )),
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, scopeUuid),
        eq(
          fxAppEdgeAdjacencyVersions.edgeDefinitionId,
          fixture.input.edgeDefinitionId,
        ),
      )),
    fixture.target.drizzle.select({ count: sql<string>`count(*)::text` })
      .from(fxSystemEdgeDefinitionReadiness).where(and(
        eq(fxSystemEdgeDefinitionReadiness.scopeId, fixture.scopeId),
        eq(
          fxSystemEdgeDefinitionReadiness.edgeDefinitionId,
          fixture.input.edgeDefinitionId,
        ),
      )),
  ]);
  return {
    edges: edges[0]?.count ?? "missing",
    versions: versions[0]?.count ?? "missing",
    receipts: receipts[0]?.count ?? "missing",
  };
}

interface ExactContents {
  readonly edges: ReadonlyArray<{
    readonly source_row_id: string;
    readonly target_row_id: string;
    readonly duplicate_ordinal: number;
    readonly locale: string | null;
    readonly position: number | null;
    readonly commit_seq: string;
  }>;
  readonly versions: ReadonlyArray<{
    readonly direction: string;
    readonly endpoint_row_id: string;
    readonly last_changed_commit_seq: string;
  }>;
}

async function exactContents(fixture: Fixture): Promise<ExactContents> {
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(fixture.scopeId),
  ).scopeUuid;
  const [edges, versions] = await Promise.all([
    fixture.target.query<ExactContents["edges"][number]>(
      `select encode(source_row_id, 'hex') source_row_id,
              encode(target_row_id, 'hex') target_row_id,
              duplicate_ordinal, locale, position, commit_seq::text
         from fx_app_edge_current
        where scope_uuid = $1 and edge_definition_id = $2
        order by source_row_id, target_row_id, duplicate_ordinal`,
      [scopeUuid, fixture.input.edgeDefinitionId],
    ),
    fixture.target.query<ExactContents["versions"][number]>(
      `select direction, encode(endpoint_row_id, 'hex') endpoint_row_id,
              last_changed_commit_seq::text
         from fx_app_edge_adjacency_version
        where scope_uuid = $1 and edge_definition_id = $2
        order by direction, endpoint_row_id`,
      [scopeUuid, fixture.input.edgeDefinitionId],
    ),
  ]);
  return Object.freeze({
    edges: Object.freeze(edges.rows),
    versions: Object.freeze(versions.rows),
  });
}

function expectedContents(frontier: string): ExactContents {
  return {
    edges: Array.from({ length: 5 }, (_, index) => ({
      source_row_id: rowHex(101 + index),
      target_row_id: rowHex(201 + index),
      duplicate_ordinal: 0,
      locale: null,
      position: null,
      commit_seq: frontier,
    })),
    versions: [
      ...Array.from({ length: 5 }, (_, index) => ({
        direction: "incoming",
        endpoint_row_id: rowHex(201 + index),
        last_changed_commit_seq: frontier,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        direction: "outgoing",
        endpoint_row_id: rowHex(101 + index),
        last_changed_commit_seq: frontier,
      })),
    ],
  };
}

function rowHex(ordinal: number): string {
  return ordinal.toString(16).padStart(32, "0");
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
    if (value === undefined) throw new Error("E01-A blocker PID missing.");
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
  throw new Error(`Expected ${expected} E01-A scope-clock waiters.`);
}

async function head(fixture: Fixture) {
  const result = await fixture.target.query<{
    lifecycle: string;
    attempt_fence: string;
    frontier_commit_seq: string;
    processed_source_count: string;
    validated_source_count: string;
    validated_edge_count: string;
    validated_version_count: string;
    readiness_sha256: Uint8Array | null;
  }>(
    `select lifecycle, attempt_fence::text, frontier_commit_seq::text,
            processed_source_count::text, validated_source_count::text,
            validated_edge_count::text, validated_version_count::text,
            readiness_sha256
       from fx_system_edge_definition_build
      where scope_id = $1 and edge_definition_id = $2`,
    [fixture.scopeId, fixture.input.edgeDefinitionId],
  );
  return result.rows[0] ?? null;
}

function repositoryFor(
  persistence: PostgresFlarexPersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: (run) => persistence.drizzle.transaction(run),
  };
}
