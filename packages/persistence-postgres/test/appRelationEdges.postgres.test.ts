import { webcrypto } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { eq } from "drizzle-orm";
import { Effect, Result } from "effect";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogRelationId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  decodeRelationDeclarationV1Result,
} from "flarex-protocol/internal/relation-declaration-v1";
import {
  decodeRelationOccurrenceV1Result,
  RelationOccurrenceSha256,
  RelationOccurrenceSha256Error,
  type RelationOccurrenceV1,
} from "flarex-protocol/internal/relation-occurrence-v1";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  applyAppRelationEdgeChangesInTransactionEffect,
  AppRelationEdgePersistenceError,
  hasIncomingAppRelationEdgeInTransactionEffect,
  readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect,
  readIncomingAppRelationEdgePageInTransactionEffect,
  type AppRelationEdgeDefinitionPin,
  type AppRelationEdgeMutationStatementName,
  type AppRelationEdgeQueryObservation,
  type AppRelationEdgeStorageAction,
} from "../src/appRelationEdges";
import { makePhysicalEdgeDefinition } from
  "../src/applicationRelationBinding/Policy";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxSystemScopeClocks,
} from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = ScopeIdSchema.make(
  "scope_5b000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_5b000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_5b000000-0000-0000-0000-000000000002",
);
const otherEpoch = ScopeEpochSchema.make(
  "epoch_5b000000-0000-0000-0000-000000000098",
);
const scopeUuid = "5b000000-0000-0000-0000-000000000001";
const epochUuid = "5b000000-0000-0000-0000-000000000002";
const sourceTableId = decodeCatalogTableId(11);
const targetTableId = decodeCatalogTableId(12);
const relationId = decodeCatalogRelationId(21);
const edgeDefinitionId = decodeCatalogEdgeDefinitionId(31);
const schemaVersionId = decodeCatalogSchemaVersionId("schema_edges_postgres");
const definition = definitionPin();
const repositorySource = decodeAppRowIdHexV1(
  "fffffffffffffffffffffffffffffff1",
);
const repositoryTarget = decodeAppRowIdHexV1(
  "fffffffffffffffffffffffffffffff2",
);
const hotTarget = decodeAppRowIdHexV1(
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);

describePostgres("real PostgreSQL S12 relation-edge storage", () => {
  it("reads 128 incoming adjacency versions through one indexed query", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      const endpoints = Object.freeze(Array.from({ length: 128 }, (_, index) =>
        Object.freeze({
          edgeDefinitionId,
          targetRowId: rowIdFromInteger(400_000 + index),
        })
      ));
      await persistence.drizzle.insert(fxAppEdgeAdjacencyVersions).values(
        endpoints.flatMap((endpoint, index) =>
          index % 2 === 0
            ? [{
                scopeUuid: projectScopeIdUuidV1(scopeId).scopeUuid,
                edgeDefinitionId: endpoint.edgeDefinitionId,
                direction: "incoming" as const,
                endpointRowId: appRowIdHexV1ToBytes(endpoint.targetRowId),
                lastChangedCommitSeq: CommitSeqSchema.make(BigInt(index + 1)),
              }]
            : []
        ),
      );
      const observations: AppRelationEdgeQueryObservation[] = [];
      const versions = await persistence.drizzle.transaction((tx) => runEffect(
        readIncomingAppRelationEdgeAdjacencyVersionsInTransactionEffect(tx, {
          scopeId,
          endpoints,
          observeQuery: (query) => observations.push(query),
        }),
      ));
      expect(versions).toHaveLength(128);
      expect(versions.map((version) => version.adjacencyVersion)).toEqual(
        endpoints.map((_endpoint, index) =>
          CommitSeqSchema.make(index % 2 === 0 ? BigInt(index + 1) : 0n)
        ),
      );
      expect(observations).toHaveLength(1);
      const observation = observations[0];
      if (observation === undefined) {
        throw new Error("Expected one adjacency-version query observation");
      }
      const client = await persistence.pool.connect();
      try {
        await client.query("begin");
        await client.query("set local enable_seqscan = off");
        const plan = await client.query(
          `explain (format json) ${observation.sql}`,
          [...observation.params],
        );
        expect(JSON.stringify(plan.rows)).toMatch(
          /fx_app_edge_adjacency_version_pk/,
        );
        await client.query("rollback");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
  }, 120_000);

  it("proves production constraints, write path, and populated access plans", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      await seedSkewedEdges(persistence);

      const applied = await persistence.drizzle.transaction((tx) => runEdge(
        applyAppRelationEdgeChangesInTransactionEffect(tx, {
          scopeId,
          schemaVersionId,
          commitSeq: CommitSeqSchema.make(101n),
          actions: [{
            kind: "put",
            definition,
            occurrence: occurrence(repositorySource, repositoryTarget),
            position: 0,
          }],
        }),
      ));
      expect(applied).toEqual({
        putCount: 1,
        removeCount: 0,
        reorderCount: 0,
        advancedEndpointCount: 2,
      });
      const hasIncoming = await persistence.drizzle.transaction((tx) =>
        runEffect(hasIncomingAppRelationEdgeInTransactionEffect(tx, {
          scopeId,
          definition,
          targetRowId: repositoryTarget,
        }))
      );
      expect(hasIncoming).toBe(true);
      const page = await persistence.drizzle.transaction((tx) => runEffect(
        readIncomingAppRelationEdgePageInTransactionEffect(tx, {
          scopeId,
          definition,
          targetRowId: repositoryTarget,
          maximumIdentities: 128,
        }),
      ));
      expect(page.items.map((item) => item.sourceRowId)).toEqual([
        repositorySource,
      ]);
      expect(page.versionBefore).toBe(101n);
      expect(page.versionAfter).toBe(101n);

      const observedQueries: AppRelationEdgeQueryObservation[] = [];
      const resumed = await persistence.drizzle.transaction((tx) => runEffect(
        readIncomingAppRelationEdgePageInTransactionEffect(tx, {
          scopeId,
          definition,
          targetRowId: hotTarget,
          maximumIdentities: 128,
          after: {
            sourceRowId: rowIdFromInteger(19_871),
            duplicateOrdinal: 0,
          },
          observeQuery: (query) => observedQueries.push(query),
        }),
      ));
      expect(resumed.items).toHaveLength(128);
      expect(resumed.items[0]?.sourceRowId).toBe(rowIdFromInteger(19_872));
      expect(resumed.items.at(-1)?.sourceRowId).toBe(rowIdFromInteger(19_999));
      expect(resumed.nextFrontier).toEqual({
        sourceRowId: rowIdFromInteger(19_999),
        duplicateOrdinal: 0,
      });
      expect(resumed.exhausted).toBe(false);
      const resumedFrontier = resumed.nextFrontier;
      if (resumedFrontier === null) {
        throw new Error("Expected a resumed incoming-page frontier");
      }
      const resumedFinal = await persistence.drizzle.transaction((tx) =>
        runEffect(readIncomingAppRelationEdgePageInTransactionEffect(tx, {
          scopeId,
          definition,
          targetRowId: hotTarget,
          maximumIdentities: 128,
          after: resumedFrontier,
        }))
      );
      expect(resumedFinal.items.map((item) => item.sourceRowId)).toEqual([
        rowIdFromInteger(20_000),
      ]);
      expect(resumedFinal.exhausted).toBe(true);

      await expect(persistence.query(`
        update fx_app_edge_current
        set locale = 'en'
        where scope_uuid = $1 and edge_definition_id = 31
      `, [scopeUuid])).rejects.toThrow();
      await expect(persistence.query(`
        update fx_app_edge_current
        set occurrence_sha256 = decode('00', 'hex')
        where scope_uuid = $1 and edge_definition_id = 31
      `, [scopeUuid])).rejects.toThrow();

      const indexDefinition = await persistence.query<{ indexdef: string }>(`
        select pg_get_indexdef(indexrelid) as indexdef
        from pg_index
        where indexrelid = 'fx_app_edge_current_incoming_idx'::regclass
      `);
      expect(indexDefinition.rows[0]?.indexdef).toMatch(
        /\(scope_uuid, edge_definition_id, target_row_id, source_row_id, duplicate_ordinal\) INCLUDE \("?position"?, commit_seq\)$/,
      );

      const observedResumedQuery = observedQueries[0];
      if (observedResumedQuery === undefined) {
        throw new Error("Expected the compiled resumed-page query");
      }
      expect(observedResumedQuery.params).toEqual([
        scopeUuid,
        edgeDefinitionId,
        appRowIdHexV1ToBytes(hotTarget),
        appRowIdHexV1ToBytes(rowIdFromInteger(19_871)),
        0,
        129,
      ]);
      const plans = await populatedPlans(persistence, observedResumedQuery);
      expect(plans.incoming).toMatch(/fx_app_edge_current_incoming_idx/);
      expect(plans.incoming).not.toMatch(/Seq Scan|Sort/);
      expect(plans.incoming).toMatch(/actual rows=129/);
      expect(plans.outgoing).toMatch(/fx_app_edge_current_pk/);
      expect(plans.outgoing).not.toMatch(/Seq Scan|Sort/);
      expect(plans.version).toMatch(/fx_app_edge_adjacency_version_pk/);
      expect(plans.version).not.toMatch(/Seq Scan/);
      expectBoundedResumedPlan(plans.resumedAuto);
      expectBoundedResumedPlan(plans.resumedGeneric);
      expect(plans.resumedGeneric).toMatch(/\$[1-6]/);
    });
  }, 120_000);

  it("applies the frozen 4,096-occurrence ceiling with bounded batches", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      const target = decodeAppRowIdHexV1(
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      );
      const actions: AppRelationEdgeStorageAction[] = Array.from(
        { length: 4_096 },
        (_, index) => {
          const source = rowIdFromInteger(300_000 + index);
          return {
            kind: "put",
            definition,
            occurrence: occurrence(source, target),
            position: index % 1024,
          };
        },
      );
      const startedAt = Date.now();
      const statements: AppRelationEdgeMutationStatementName[] = [];
      const applied = await persistence.drizzle.transaction((tx) => runEdge(
        applyAppRelationEdgeChangesInTransactionEffect(
          tx,
          {
            scopeId,
            schemaVersionId,
            commitSeq: CommitSeqSchema.make(101n),
            actions,
          },
          { observeStatement: (statement) => statements.push(statement) },
        ),
      ));
      const elapsedMilliseconds = Date.now() - startedAt;
      expect(applied).toEqual({
        putCount: 4_096,
        removeCount: 0,
        reorderCount: 0,
        advancedEndpointCount: 4_097,
      });
      expect(elapsedMilliseconds).toBeLessThan(30_000);
      expect(statements).toHaveLength(54);
      expect(statementCount(statements, "createMutationSavepoint")).toBe(1);
      expect(statementCount(statements, "lockScopeClock")).toBe(1);
      expect(statementCount(statements, "readCurrentBatch")).toBe(16);
      expect(statementCount(statements, "readAffectedVersions")).toBe(17);
      expect(statementCount(statements, "insertCurrent")).toBe(9);
      expect(statementCount(statements, "advanceAdjacencyVersions")).toBe(9);
      expect(statementCount(statements, "releaseMutationSavepoint")).toBe(1);
      expect(statementCount(statements, "rollbackMutationSavepoint")).toBe(0);
      expect(statementCount(statements, "updateCurrent")).toBe(0);
      expect(statementCount(statements, "deleteCurrent")).toBe(0);
      const counts = await persistence.query<{
        currentCount: number;
        versionCount: number;
      }>(`
        select
          (select count(*)::int from fx_app_edge_current) as "currentCount",
          (select count(*)::int from fx_app_edge_adjacency_version) as "versionCount"
      `);
      expect(counts.rows[0]).toEqual({
        currentCount: 4_096,
        versionCount: 4_097,
      });
      const page = await persistence.drizzle.transaction((tx) => runEffect(
        readIncomingAppRelationEdgePageInTransactionEffect(tx, {
          scopeId,
          definition,
          targetRowId: target,
          maximumIdentities: 128,
        }),
      ));
      expect(page.items).toHaveLength(128);
      expect(page.nextFrontier).not.toBeNull();
      expect(page.versionBefore).toBe(101n);
      expect(page.versionAfter).toBe(101n);
    });
  }, 120_000);

  it("rolls back only S12 work after a captured late PostgreSQL failure", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      await persistence.query(`
        create function reject_edge_version_insert() returns trigger
        language plpgsql as $$
        begin
          raise exception 'injected edge-version failure';
        end
        $$
      `);
      await persistence.query(`
        create trigger reject_edge_version_insert
        before insert on fx_app_edge_adjacency_version
        for each statement execute function reject_edge_version_insert()
      `);
      const captured = await persistence.drizzle.transaction(async (tx) => {
        await tx.update(fxSystemScopeClocks).set({
          lastCommitSeq: CommitSeqSchema.make(101n),
        }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
        const failure = await runEdgeFailure(
          applyAppRelationEdgeChangesInTransactionEffect(tx, {
            scopeId,
            schemaVersionId,
            commitSeq: CommitSeqSchema.make(101n),
            actions: [{
              kind: "put",
              definition,
              occurrence: occurrence(repositorySource, repositoryTarget),
              position: 0,
            }],
          }),
        );
        const clocks = await tx.select({
          lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
        }).from(fxSystemScopeClocks).where(eq(
          fxSystemScopeClocks.scopeId,
          scopeId,
        ));
        const currentEdges = await tx.select().from(fxAppEdgeCurrent);
        const versions = await tx.select().from(fxAppEdgeAdjacencyVersions);
        return { failure, clocks, currentEdges, versions };
      });
      expect(captured.failure).toBeInstanceOf(AppRelationEdgePersistenceError);
      expect(captured.clocks).toEqual([{ lastCommitSeq: 101n }]);
      expect(captured.currentEdges).toEqual([]);
      expect(captured.versions).toEqual([]);
      expect(await persistence.drizzle.select({
        lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
      }).from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        scopeId,
      ))).toEqual([{ lastCommitSeq: 101n }]);
    });
  }, 120_000);

  it("serializes one scope through the shared clock without blocking another", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      const blocker = await persistence.pool.connect();
      let blockerReleased = false;
      try {
        await blocker.query("begin");
        await blocker.query(
          `select 1 from fx_system_scope_clock where scope_id = $1 for update`,
          [scopeId],
        );
        const pid = await blocker.query<{ pid: number }>(
          `select pg_backend_pid()::int as pid`,
        );
        const blockerPid = pid.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("Missing blocker PID");
        const blockedWrite = applyOne(persistence, scopeId, 1n);
        await waitForBlockedScopeLock(
          persistence,
          blockerPid,
          1,
        );
        const independentWrite = applyOne(persistence, otherScopeId, 1n);
        await expect(withTimeout(independentWrite, 5_000)).resolves.toMatchObject({
          putCount: 1,
        });
        await blocker.query("commit");
        blockerReleased = true;
        await expect(blockedWrite).resolves.toMatchObject({ putCount: 1 });
      } finally {
        if (!blockerReleased) {
          await blocker.query("rollback").catch(() => undefined);
        }
        blocker.release();
      }
    });
  }, 120_000);
});

async function insertClocks(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, last_commit_seq, epoch)
     values ($1, 'flarexdb_v1', 100, $2),
            ($3, 'flarexdb_v1', 100, $4)`,
    [scopeId, epoch, otherScopeId, otherEpoch],
  );
}

async function seedSkewedEdges(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const hotTargetHex = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await persistence.query(`
    insert into fx_app_edge_current (
      scope_uuid, relation_id, edge_definition_id,
      source_table_id, source_row_id, target_table_id, target_row_id,
      duplicate_ordinal, occurrence_codec_version,
      occurrence_bytes, occurrence_sha256, locale, position,
      schema_version_id, write_epoch_uuid, commit_seq
    )
    select
      $1::uuid, 21, 31,
      11, decode(lpad(to_hex(item), 32, '0'), 'hex'),
      12,
      case when item <= 20000
        then decode($2, 'hex')
        else decode(lpad(to_hex(100000 + item), 32, '0'), 'hex')
      end,
      0, 1,
      convert_to('{"item":' || item::text || '}', 'UTF8'),
      decode(md5(item::text) || md5('edge:' || item::text), 'hex'),
      null, item % 1024,
      'schema_edges_postgres', $3::uuid, 1
    from generate_series(1, 25000) as item
  `, [scopeUuid, hotTargetHex, epochUuid]);
  await persistence.query(`
    insert into fx_app_edge_adjacency_version (
      scope_uuid, edge_definition_id, direction,
      endpoint_row_id, last_changed_commit_seq
    )
    select
      $1::uuid, 31, 'incoming',
      case when item = 0
        then decode($2, 'hex')
        else decode(lpad(to_hex(100000 + item), 32, '0'), 'hex')
      end,
      1
    from generate_series(0, 5000) as item
  `, [scopeUuid, hotTargetHex]);
  await persistence.query(`vacuum analyze fx_app_edge_current`);
  await persistence.query(`vacuum analyze fx_app_edge_adjacency_version`);
}

async function populatedPlans(
  persistence: PostgresFlarexPersistence,
  resumedQuery: AppRelationEdgeQueryObservation,
): Promise<Readonly<{
  incoming: string;
  outgoing: string;
  version: string;
  resumedAuto: string;
  resumedGeneric: string;
}>> {
  const client = await persistence.pool.connect();
  try {
    if (resumedQuery.params.length !== 6) {
      throw new Error(
        "Expected the compiled resumed-page query to have six parameters",
      );
    }
    const incoming = await client.query<{ "QUERY PLAN": string }>(`
      explain (analyze, costs off, summary off, timing off)
      select source_row_id, duplicate_ordinal, position, commit_seq
      from fx_app_edge_current
      where scope_uuid = $1
        and edge_definition_id = 31
        and target_row_id = decode($2, 'hex')
      order by source_row_id, duplicate_ordinal
      limit 129
    `, [scopeUuid, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    const outgoing = await client.query<{ "QUERY PLAN": string }>(`
      explain (analyze, costs off, summary off, timing off)
      select target_row_id, duplicate_ordinal, position, commit_seq
      from fx_app_edge_current
      where scope_uuid = $1
        and edge_definition_id = 31
        and source_row_id = decode(lpad(to_hex(1), 32, '0'), 'hex')
      order by target_row_id, duplicate_ordinal
      limit 129
    `, [scopeUuid]);
    const version = await client.query<{ "QUERY PLAN": string }>(`
      explain (analyze, costs off, summary off, timing off)
      select last_changed_commit_seq
      from fx_app_edge_adjacency_version
      where scope_uuid = $1
        and edge_definition_id = 31
        and direction = 'incoming'
        and endpoint_row_id = decode($2, 'hex')
    `, [scopeUuid, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    await client.query("begin");
    let resumedAuto: ReadonlyArray<{ "QUERY PLAN": string }>;
    let resumedGeneric: ReadonlyArray<{ "QUERY PLAN": string }>;
    try {
      await client.query(`
        prepare flarex_s12_resumed_page as ${resumedQuery.sql}
      `);
      const resumedExplainSql = `
        explain (analyze, costs off, summary off, timing off, buffers)
        execute flarex_s12_resumed_page(
          '${scopeUuid}'::uuid, 31::bigint,
          decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex'),
          decode('00000000000000000000000000004d9f', 'hex'),
          0::integer, 129::integer
        )
      `;
      resumedAuto = (await client.query<{ "QUERY PLAN": string }>(
        resumedExplainSql,
      )).rows;
      await client.query("set local plan_cache_mode = force_generic_plan");
      resumedGeneric = (await client.query<{ "QUERY PLAN": string }>(
        resumedExplainSql,
      )).rows;
      await client.query("deallocate flarex_s12_resumed_page");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
    return Object.freeze({
      incoming: planText(incoming.rows),
      outgoing: planText(outgoing.rows),
      version: planText(version.rows),
      resumedAuto: planText(resumedAuto),
      resumedGeneric: planText(resumedGeneric),
    });
  } finally {
    client.release();
  }
}

function expectBoundedResumedPlan(plan: string): void {
  expect(plan).toMatch(/Index Only Scan using fx_app_edge_current_incoming_idx/);
  expect(plan).toMatch(/ROW\(source_row_id, duplicate_ordinal\) > ROW\(/);
  expect(plan).toMatch(/actual rows=129(?:\.00)? loops=1/);
  expect(plan).toMatch(/Heap Fetches: 0/);
  expect(plan).toMatch(/Index Searches: 1/);
  expect(plan).not.toMatch(/Seq Scan|Sort|Filter:|Rows Removed by Filter/);
}

function planText(rows: ReadonlyArray<{ "QUERY PLAN": string }>): string {
  return rows.map((row) => row["QUERY PLAN"]).join("\n");
}

function statementCount(
  statements: ReadonlyArray<AppRelationEdgeMutationStatementName>,
  name: AppRelationEdgeMutationStatementName,
): number {
  return statements.filter((statement) => statement === name).length;
}

function definitionPin(): AppRelationEdgeDefinitionPin {
  const declaration = Result.getOrThrow(decodeRelationDeclarationV1Result({
    format: "flarex.relation-declaration",
    version: 1,
    source: {
      table: "posts",
      path: [{ kind: "field", name: "authors" }],
      forwardName: "authors",
    },
    target: { table: "users" },
    value: {
      cardinality: "many",
      minItems: 0,
      maxItems: 1024,
      ordered: true,
      duplicates: "forbid",
    },
    inverse: { cardinality: "many", name: "posts" },
    localized: false,
    onTargetDelete: "restrict",
  }));
  return Object.freeze({
    relationId,
    edgeDefinitionId,
    physical: makePhysicalEdgeDefinition(
      sourceTableId,
      targetTableId,
      declaration,
    ),
  });
}

function occurrence(
  sourceRowId: typeof repositorySource,
  targetRowId: typeof repositoryTarget,
): RelationOccurrenceV1 {
  return Result.getOrThrow(decodeRelationOccurrenceV1Result({
    format: "flarex.relation-occurrence",
    version: 1,
    sourceDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: sourceTableId,
      rowId: sourceRowId,
    }),
    sourcePath: [{ kind: "field", name: "authors" }],
    targetDocumentId: appDocumentIdV1FromRowIdentity({
      tableId: targetTableId,
      rowId: targetRowId,
    }),
    duplicateOrdinal: 0,
  }));
}

function rowIdFromInteger(value: number) {
  return decodeAppRowIdHexV1(value.toString(16).padStart(32, "0"));
}

function applyOne(
  persistence: PostgresFlarexPersistence,
  owningScopeId: typeof scopeId,
  commitSeq: bigint,
) {
  return persistence.drizzle.transaction((tx) => runEdge(
    applyAppRelationEdgeChangesInTransactionEffect(tx, {
      scopeId: owningScopeId,
      schemaVersionId,
      commitSeq: CommitSeqSchema.make(commitSeq),
      actions: [{
        kind: "put",
        definition,
        occurrence: occurrence(repositorySource, repositoryTarget),
        position: 0,
      }],
    }),
  ));
}

const relationOccurrenceSha256 = RelationOccurrenceSha256.of({
  digest: (bytes) => Effect.tryPromise({
    try: async () => new Uint8Array(await webcrypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    )),
    catch: (cause) => new RelationOccurrenceSha256Error({
      operation: "digest",
      cause,
    }),
  }),
});

function runEdge<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
): Promise<A> {
  return runEffect(effect.pipe(
    Effect.provideService(RelationOccurrenceSha256, relationOccurrenceSha256),
  ));
}

function runEdgeFailure<A, E>(
  effect: Effect.Effect<A, E, RelationOccurrenceSha256>,
): Promise<E> {
  return runEffectFailure(effect.pipe(
    Effect.provideService(RelationOccurrenceSha256, relationOccurrenceSha256),
  ));
}

function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMilliseconds: number,
): Promise<Value> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Cross-scope edge write timed out"));
      }, timeoutMilliseconds);
      timeout.unref();
    }),
  ]);
}

async function waitForBlockedScopeLock(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(`
      select count(*)::int as blocked
      from pg_stat_activity as activity
      where $1::int = any(pg_blocking_pids(activity.pid))
        and activity.datname = current_database()
        and activity.wait_event_type = 'Lock'
        and activity.query ilike '%fx_system_scope_clock%'
        and activity.query ilike '%for update%'
    `, [blockerPid]);
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} scope-clock locks blocked by backend ${blockerPid}.`,
  );
}
