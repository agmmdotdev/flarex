import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { CommitSeqSchema, decodeScopeUuidV1 } from "flarex-protocol/storage-authority";
import { expect } from "vitest";

import type { FlarexPersistence } from "../../../src";
import {
  captureApplicationQueryCacheRefresh,
  type ApplicationQueryCacheRefreshInput,
} from "../../../src/application/applicationQueryCacheRefresh";
import {
  CommitFeedCorruptionErrorV1,
  readBoundedCommitFeedPageInTransactionEffect,
  type BoundedCommitFeedTransactionReadInput,
  type CommitFeedQueryV1,
} from "../../../src/commit/commitFeed";
import type { LocatedReadCommittedAttemptTargetV1 } from "../../../src/database/locatedTransactionIdentity";
import { liveScopeExecution } from "../../../src/scope/execution/ScopeExecution";
import { defineScopedReadOperation } from "../../../src/scope/execution/ScopedTransaction";
import { resolveLocatedTrustedScopeAuthorityEffect, type LocatedTrustedScopeAuthority } from "../../../src/scope/scopeAuthorityResolution";
import type { SharedScopeAuthorityProvisioner } from "../../../src/scope/scopeAuthorityProvisioning";
import { AppRowStorageCorruptionError } from "../../../src/storage/documents/appRowErrors";
import { runEffect } from "../../support/effectTestRuntime";

export const QUERY_CACHE_REFRESH_LOCATOR = Object.freeze({
  kind: "shared_database" as const, databaseKey: "query-cache-refresh-proof", schemaName: "public",
});
export function createQueryCacheRefreshUuid(): () => string {
  let next = 0;
  const values = ["b3100000-0000-4000-8000-000000000001", "b3100000-0000-4000-8000-000000000002"];
  return () => {
    const value = values[next++];
    if (value === undefined) throw new Error("Refresh fixture UUID sequence exhausted");
    return value;
  };
}

export async function prepareQueryCacheRefreshScope(
  persistence: FlarexPersistence,
  provisioner: SharedScopeAuthorityProvisioner,
  target: LocatedReadCommittedAttemptTargetV1,
): Promise<LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>> {
  const provisioned = await provisioner.ensure({ deploymentId: "deployment_query_cache_refresh", projectId: "project_query_cache_refresh" });
  await persistence.query("update fx_system_scope_execution_authority set storage_generation='flarexdb_v1' where scope_id=$1",
    [provisioned.scope.scopeId]);
  return runEffect(resolveLocatedTrustedScopeAuthorityEffect(provisioned.scope.deploymentId, {
    scopeMetadata: persistence,
    provisioningReceipts: { getScopeAuthorityProvisioningReceipt: async () => { throw new Error("Shared fixture must not resolve split receipts"); } },
    scopeClockTargets: { resolve: async () => target },
  }));
}

const settlement = Object.freeze({ rollbackMessage: "Cache refresh proof read rolled back", cleanupDefect: (cause: unknown) => cause });
const captureOperation = defineScopedReadOperation((_tx, _context, input: ApplicationQueryCacheRefreshInput, scoped) =>
  captureApplicationQueryCacheRefresh(scoped, input));

/** Canonical structural histories exercise the storage owner. Genuine producer
 * publication is proved separately by the connected query consumer. */
export async function assertQueryCacheRefresh(
  persistence: FlarexPersistence,
  located: LocatedTrustedScopeAuthority<LocatedReadCommittedAttemptTargetV1>,
): Promise<void> {
  const [scope] = (await persistence.query<{ scope_uuid: string; epoch_uuid: string }>(
    `select c.scope_uuid::text,a.epoch_uuid::text from fx_system_scope_clock c
      join fx_system_scope_execution_authority a using(scope_id) where scope_id=$1`, [located.authority.scopeId])).rows;
  if (scope === undefined) throw new Error("Missing refresh fixture scope");
  const tableId = decodeCatalogTableId(1), rowA = decodeAppRowIdHexV1("11".repeat(16)), rowB = decodeAppRowIdHexV1("22".repeat(16));
  const creationTime = decodeAppCreationTimeV1(42);
  const documents = await Promise.all(["one", "two", "four", "future"].map(padding => canonicalizeAppDocumentV1({
    tableId, rowId: padding === "future" ? rowB : rowA, creationTime, fields: { name: "Ada", padding },
  })));
  const [one, two, four, future] = documents;
  if (one === undefined || two === undefined || four === undefined || future === undefined) throw new Error("Missing canonical fixture document");
  for (const [seq, previous, rowId, document] of [
    [1, null, rowA, one], [2, 1, rowA, two], [3, 2, rowA, null], [4, 3, rowA, four], [5, null, rowB, future],
  ] as const) {
    await persistence.query(`insert into fx_system_commit(scope_uuid,epoch_uuid,commit_seq,change_count,committed_at)
      values($1::uuid,$2::uuid,$3,1,now())`, [scope.scope_uuid, scope.epoch_uuid, seq]);
    await persistence.query(`insert into fx_app_row_rev(scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,
      write_epoch_uuid,schema_version_id,creation_time,value_codec_version,is_tombstone,value_bytes,value_sha256)
      values($1::uuid,1,decode($2,'hex'),$3,$4,$5::uuid,'query_cache_refresh',42,1,$6,$7,$8)`,
    [scope.scope_uuid, rowId, seq, previous, scope.epoch_uuid, document === null, document?.canonicalBytes ?? null, document?.sha256 ?? null]);
    await persistence.query(`insert into fx_system_commit_app_row_change(scope_uuid,epoch_uuid,commit_seq,change_ordinal,table_id,row_id)
      values($1::uuid,$2::uuid,$3,0,1,decode($4,'hex'))`, [scope.scope_uuid, scope.epoch_uuid, seq, rowId]);
  }
  await persistence.query(`insert into fx_app_row_current(scope_uuid,table_id,row_id,commit_seq)
    values($1::uuid,1,decode($2,'hex'),4),($1::uuid,1,decode($3,'hex'),5)`, [scope.scope_uuid, rowA, rowB]);
  await persistence.query(`insert into fx_system_commit(scope_uuid,epoch_uuid,commit_seq,change_count,relation_adjacency_change_count,committed_at)
    values($1::uuid,$2::uuid,6,0,1,now())`, [scope.scope_uuid, scope.epoch_uuid]);
  await persistence.query(`insert into fx_system_commit_relation_adjacency_change
    (scope_uuid,epoch_uuid,commit_seq,change_ordinal,edge_definition_id,direction,endpoint_row_id)
    values($1::uuid,$2::uuid,6,0,1,'incoming',decode($3,'hex'))`, [scope.scope_uuid, scope.epoch_uuid, rowA]);
  await persistence.query("update fx_system_scope_clock set last_commit_seq=6 where scope_id=$1", [located.authority.scopeId]);

  const capture = (overrides: Partial<ApplicationQueryCacheRefreshInput> = {}) => runEffect(liveScopeExecution.runRead(
    located, settlement, captureOperation, {
      fromCommitSeq: CommitSeqSchema.make(0n), targetCommitSeq: CommitSeqSchema.make(4n),
      maximumCommits: 10, maximumChanges: 10, maximumSemanticBytes: 1_000_000, ...overrides,
    }));
  const complete = await capture();
  expect(complete.kind).toBe("captured");
  if (complete.kind !== "captured") throw new Error("Expected captured refresh");
  expect(complete.snapshotCommitSeq).toBe(4n);
  expect(complete.changes.map(change => change.commitSeq)).toEqual([1n, 2n, 3n, 4n]);
  expect(complete.changes.map(change => [change.previous.kind, change.next.kind])).toEqual([
    ["missing", "live"], ["live", "live"], ["live", "tombstone"], ["tombstone", "live"],
  ]);
  expect(complete.changes[1]).toMatchObject({ previous: { commitSeq: 1n, document: { value: { name: "Ada", padding: "one" } } },
    next: { commitSeq: 2n, document: { value: { name: "Ada", padding: "two" } } } });
  expect(complete.changes.every(change => change.rowId === rowA)).toBe(true);

  const observations: CommitFeedQueryV1[] = [];
  const boundedOperation = defineScopedReadOperation((tx, _context, input: BoundedCommitFeedTransactionReadInput) =>
    readBoundedCommitFeedPageInTransactionEffect(tx, input, query => { observations.push(query); }));
  const bounded = (overrides: Partial<BoundedCommitFeedTransactionReadInput> = {}) => runEffect(liveScopeExecution.runRead(
    located, settlement, boundedOperation, {
      scopeUuid: decodeScopeUuidV1(scope.scope_uuid), exclusiveCommitSeq: CommitSeqSchema.make(0n),
      inclusiveCommitSeq: CommitSeqSchema.make(2n), maximumCommits: 10,
      maximumAppRowChanges: 10, maximumRelationAdjacencyChanges: 10, ...overrides,
    }));
  const page = await bounded();
  expect(page.kind).toBe("page");
  if (page.kind !== "page") throw new Error("Expected bounded page");
  expect(page.page.observedLastCommitSeq).toBe(6n);
  expect(page.page.commits.map(commit => commit.commitSeq)).toEqual([1n, 2n]);
  expect(observations.map(query => query.name)).toEqual(["clock", "headers", "appRowChanges", "relationAdjacencyChanges"]);
  observations.length = 0;
  expect(await bounded({ maximumAppRowChanges: 1 })).toEqual({ kind: "capacityExceeded" });
  expect(observations.map(query => query.name)).toEqual(["clock", "headers"]);

  // Header-only over-budget window: the preflight must refuse before looking
  // at either child family. This is not a production-writer fixture.
  await persistence.query(`insert into fx_system_commit(scope_uuid,epoch_uuid,commit_seq,change_count,committed_at)
    values($1::uuid,$2::uuid,7,10000,now()),($1::uuid,$2::uuid,8,10000,now())`, [scope.scope_uuid, scope.epoch_uuid]);
  await persistence.query("update fx_system_scope_clock set last_commit_seq=8 where scope_id=$1", [located.authority.scopeId]);
  observations.length = 0;
  expect(await bounded({ exclusiveCommitSeq: CommitSeqSchema.make(6n), inclusiveCommitSeq: CommitSeqSchema.make(8n),
    maximumAppRowChanges: 16_000 })).toEqual({ kind: "capacityExceeded" });
  expect(observations.map(query => query.name)).toEqual(["clock", "headers"]);
  await persistence.query("delete from fx_system_commit where scope_uuid=$1::uuid and commit_seq in(7,8)", [scope.scope_uuid]);
  await persistence.query("update fx_system_scope_clock set last_commit_seq=6 where scope_id=$1", [located.authority.scopeId]);
  observations.length = 0;
  expect(await bounded({ exclusiveCommitSeq: CommitSeqSchema.make(5n), inclusiveCommitSeq: CommitSeqSchema.make(6n),
    maximumRelationAdjacencyChanges: 0 })).toEqual({ kind: "capacityExceeded" });
  expect(observations.map(query => query.name)).toEqual(["clock", "headers"]);

  expect(await capture({ maximumCommits: 1 })).toEqual({ kind: "cold", reason: "capacityExceeded" });
  expect(await capture({ maximumChanges: 1 })).toEqual({ kind: "cold", reason: "capacityExceeded" });
  expect(await capture({ maximumSemanticBytes: 0 })).toEqual({ kind: "cold", reason: "capacityExceeded" });
  expect(await capture({ fromCommitSeq: CommitSeqSchema.make(4n) })).toEqual({ kind: "captured", snapshotCommitSeq: 4n, changes: [] });
  await persistence.query("update fx_system_scope_execution_authority set oldest_available_commit_seq=2 where scope_id=$1", [located.authority.scopeId]);
  expect(await capture({ fromCommitSeq: CommitSeqSchema.make(1n), targetCommitSeq: CommitSeqSchema.make(2n) }))
    .toEqual({ kind: "cold", reason: "historyUnavailable" });
  await persistence.query("update fx_system_scope_execution_authority set oldest_available_commit_seq=0 where scope_id=$1", [located.authority.scopeId]);

  await persistence.query("update fx_app_row_rev set value_sha256=decode(repeat('00',32),'hex') where scope_uuid=$1::uuid and commit_seq=5", [scope.scope_uuid]);
  expect((await capture()).kind).toBe("captured"); // Future corrupt body is outside target S.
  await expect(capture({ fromCommitSeq: CommitSeqSchema.make(4n), targetCommitSeq: CommitSeqSchema.make(5n) }))
    .rejects.toBeInstanceOf(AppRowStorageCorruptionError);
  await persistence.query("update fx_app_row_rev set value_sha256=$2 where scope_uuid=$1::uuid and commit_seq=5", [scope.scope_uuid, future.sha256]);

  await persistence.query("delete from fx_system_commit_relation_adjacency_change where scope_uuid=$1::uuid and commit_seq=6", [scope.scope_uuid]);
  await persistence.query("delete from fx_system_commit where scope_uuid=$1::uuid and commit_seq=6", [scope.scope_uuid]);
  observations.length = 0;
  await expect(bounded({ inclusiveCommitSeq: CommitSeqSchema.make(6n), maximumAppRowChanges: 0 }))
    .rejects.toMatchObject({ _tag: "CommitFeedCorruptionErrorV1", reason: "commitHeaderMissingBeforeClock" });
  expect(observations.map(query => query.name)).toEqual(["clock", "headers"]);
  await expect(capture({ targetCommitSeq: CommitSeqSchema.make(6n) })).rejects.toBeInstanceOf(CommitFeedCorruptionErrorV1);
  expect((await capture()).kind).toBe("captured"); // A valid bounded prefix does not require future headers.
}
