import { Effect } from "effect";
import { decodeReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  compactRetainedCommitHistoryPageEffect,
  createRetainedCommitHistoryCompactionPort,
  type RetainedCommitHistoryCompactionQuery,
} from "../src/retainedCommitHistoryCompaction";
import {
  createLocatedRetainedHistoryFloorTargetInternal,
} from "../src/retainedHistoryFloorObservation";
import type { ScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import {
  LocatedReadCommittedTransactionFailureV1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { setFlarexActivationClock } from
  "./transactionSessionActivationTestSupport";

const physicalLocator = Object.freeze({
  kind: "shared_database" as const,
  databaseKey: "retained-commit-history-compaction-primary",
  schemaName: "public",
});

describe("O11-D retained commit-history compaction", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `98000000-0000-4000-8000-${suffix}`;
  }

  async function provision(label: string) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_retained_commit_compaction_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator, randomUuid: () => nextUuid() },
    ).ensure({
      deploymentId,
      projectId: `project_retained_commit_compaction_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  function port(options: {
    readonly targetCopy?: boolean;
    readonly runReadCommitted?: RunLocatedReadCommittedTransactionV1;
    readonly observeQuery?: (
      query: RetainedCommitHistoryCompactionQuery,
    ) => void;
  } = {}) {
    return createRetainedCommitHistoryCompactionPort({
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scope must not read split receipts.");
          },
        },
        scopeClockTargets: {
          resolve: async (locator: ScopePhysicalLocator) => {
            const target = createLocatedRetainedHistoryFloorTargetInternal(
              persistence.drizzle,
              locator,
              options.runReadCommitted ??
                createDefaultLocatedReadCommittedTransactionRunnerV1(
                  persistence.drizzle,
                ),
            );
            return options.targetCopy === true ? { ...target } : target;
          },
        },
      },
      ...(options.observeQuery === undefined
        ? {}
        : { observeQuery: options.observeQuery }),
    });
  }

  it("deletes one exact child-first page and retains the inclusive floor", async () => {
    const context = await provision("child_first");
    await seedCommitHistory(persistence, context.scopeId, {
      floor: 2n,
      commits: [
        { commitSeq: 1n, changeCount: 2, relationChangeCount: 3 },
        { commitSeq: 2n, changeCount: 0 },
      ],
    });
    const queries = new Map<
      RetainedCommitHistoryCompactionQuery["name"],
      RetainedCommitHistoryCompactionQuery
    >();

    await expect(runEffect(compactRetainedCommitHistoryPageEffect(
      port({ observeQuery: query => queries.set(query.name, query) }),
      context.deploymentId,
    ))).resolves.toEqual({
      status: "compacted",
      disposition: "deleted",
      deploymentId: context.deploymentId,
      scopeId: context.scopeId,
      retainedFloor: 2n,
      deletedCommitSeq: 1n,
      deletedChangeCount: 2,
      deletedRelationAdjacencyChangeCount: 3,
    });
    expect([...queries.keys()]).toEqual([
      "headerDirectory",
      "changeDirectory",
      "relationChangeDirectory",
      "changeDeletion",
      "relationChangeDeletion",
      "headerDeletion",
    ]);
    await expect(readHistoryCounts(persistence, context.scopeId)).resolves
      .toEqual({
        commits: ["2"],
        changes: [],
        relationChanges: [],
        revisions: ["1", "1"],
      });

    await expect(runEffect(compactRetainedCommitHistoryPageEffect(
      port(),
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "exhausted",
      retainedFloor: 2n,
    });
    await expect(readHistoryCounts(persistence, context.scopeId)).resolves
      .toEqual({
        commits: ["2"],
        changes: [],
        relationChanges: [],
        revisions: ["1", "1"],
      });
  });

  it("fails closed on unexpected child cardinality without healing it", async () => {
    const context = await provision("cardinality");
    await seedCommitHistory(persistence, context.scopeId, {
      floor: 2n,
      commits: [
        { commitSeq: 1n, changeCount: 0 },
        { commitSeq: 2n, changeCount: 0 },
      ],
    });
    await persistence.query(
      `update fx_system_commit set change_count = 1
       where scope_uuid = (
         select scope_uuid from fx_system_scope_clock where scope_id = $1
       ) and commit_seq = 1`,
      [context.scopeId],
    );

    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      port(),
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readHistoryCounts(persistence, context.scopeId)).resolves
      .toMatchObject({ commits: ["1", "2"], changes: [] });

    const relationContext = await provision("relation_cardinality");
    await seedCommitHistory(persistence, relationContext.scopeId, {
      floor: 2n,
      commits: [
        { commitSeq: 1n, changeCount: 0 },
        { commitSeq: 2n, changeCount: 0 },
      ],
    });
    await persistence.query(
      `update fx_system_commit set relation_adjacency_change_count = 1
       where scope_uuid = (
         select scope_uuid from fx_system_scope_clock where scope_id = $1
       ) and commit_seq = 1`,
      [relationContext.scopeId],
    );

    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      port(),
      relationContext.deploymentId,
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readHistoryCounts(persistence, relationContext.scopeId))
      .resolves.toMatchObject({
        commits: ["1", "2"],
        relationChanges: [],
      });
  });

  it("rejects copied ports, copied targets, and stale authority", async () => {
    const copiedPort = await provision("copied_port");
    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      { ...port() },
      copiedPort.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidPort" });

    const copiedTarget = await provision("copied_target");
    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      port({ targetCopy: true }),
      copiedTarget.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidTarget" });

    const stale = await provision("stale");
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    let rotateBeforeTransaction = true;
    const staleRunner: RunLocatedReadCommittedTransactionV1 = async work => {
      if (rotateBeforeTransaction) {
        rotateBeforeTransaction = false;
        await persistence.query(
          `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
          [
            stale.scopeId,
            "epoch_98000000-0000-4000-8000-999999999999",
          ],
        );
      }
      return base(work);
    };
    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      port({ runReadCommitted: staleRunner }),
      stale.deploymentId,
    ))).resolves.toMatchObject({ reason: "staleAuthority" });
  });

  it("rolls back both child and header deletion after a late failure", async () => {
    const context = await provision("rollback");
    await seedCommitHistory(persistence, context.scopeId, {
      floor: 2n,
      commits: [
        { commitSeq: 1n, changeCount: 1, relationChangeCount: 2 },
        { commitSeq: 2n, changeCount: 0 },
      ],
    });
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    const rollbackRunner: RunLocatedReadCommittedTransactionV1 = work =>
      base(async tx => {
        await work(tx);
        throw new Error("late compaction rollback");
      });

    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      port({ runReadCommitted: rollbackRunner }),
      context.deploymentId,
    ))).resolves.toMatchObject({ issue: { kind: "callbackRolledBack" } });
    await expect(readHistoryCounts(persistence, context.scopeId)).resolves
      .toEqual({
        commits: ["1", "2"],
        changes: ["1:0"],
        relationChanges: ["1:0", "1:1"],
        revisions: ["1"],
      });
  });

  it("recovers a committed but uncertain page through a cold retry", async () => {
    const context = await provision("uncertain");
    await seedCommitHistory(persistence, context.scopeId, {
      floor: 2n,
      commits: [
        { commitSeq: 1n, changeCount: 1, relationChangeCount: 1 },
        { commitSeq: 2n, changeCount: 0 },
      ],
    });
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    let loseFirstResponse = true;
    const uncertainRunner: RunLocatedReadCommittedTransactionV1 = async work => {
      const result = await base(work);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain" as const,
          settlementCause: new Error("lost compaction response"),
        }));
      }
      return result;
    };
    const uncertainPort = port({ runReadCommitted: uncertainRunner });

    await expect(runEffectFailure(compactRetainedCommitHistoryPageEffect(
      uncertainPort,
      context.deploymentId,
    ))).resolves.toMatchObject({ issue: { kind: "decisionUncertain" } });
    await expect(readHistoryCounts(persistence, context.scopeId)).resolves
      .toEqual({
        commits: ["2"],
        changes: [],
        relationChanges: [],
        revisions: ["1"],
      });
    await expect(runEffect(compactRetainedCommitHistoryPageEffect(
      uncertainPort,
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "exhausted",
      retainedFloor: 2n,
    });
  });
});

async function seedCommitHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  input: Readonly<{
    readonly floor: bigint;
    readonly commits: ReadonlyArray<Readonly<{
      readonly commitSeq: bigint;
      readonly changeCount: number;
      readonly relationChangeCount?: number;
    }>>;
  }>,
): Promise<void> {
  for (const commit of input.commits) {
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count,
          relation_adjacency_change_count, committed_at)
       select scope_uuid, epoch_uuid, $2, $3, $4, clock_timestamp()
       from fx_system_scope_clock where scope_id = $1`,
      [
        scopeId,
        commit.commitSeq,
        commit.changeCount,
        commit.relationChangeCount ?? 0,
      ],
    );
    for (let ordinal = 0; ordinal < commit.changeCount; ordinal += 1) {
      const rowIdHex = (commit.commitSeq * 10_000n + BigInt(ordinal) + 1n)
        .toString(16).padStart(32, "0");
      await persistence.query(
        `insert into fx_app_row_rev
           (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
            write_epoch_uuid, schema_version_id, creation_time,
            value_codec_version, is_tombstone,
            value_json, value_bytes, value_sha256)
         select scope_uuid, 1, decode($3, 'hex'), $2, null,
                epoch_uuid, 'schema_v1', $4, 1, true, null, null, null
         from fx_system_scope_clock where scope_id = $1`,
        [scopeId, commit.commitSeq, rowIdHex, ordinal + 1],
      );
      await persistence.query(
        `insert into fx_system_commit_app_row_change
           (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
         select scope_uuid, epoch_uuid, $2, $3, 1, decode($4, 'hex')
         from fx_system_scope_clock where scope_id = $1`,
        [scopeId, commit.commitSeq, ordinal, rowIdHex],
      );
    }
    for (
      let ordinal = 0;
      ordinal < (commit.relationChangeCount ?? 0);
      ordinal += 1
    ) {
      const rowIdHex = (commit.commitSeq * 20_000n + BigInt(ordinal) + 1n)
        .toString(16).padStart(32, "0");
      await persistence.query(
        `insert into fx_system_commit_relation_adjacency_change
           (scope_uuid, epoch_uuid, commit_seq, change_ordinal,
            edge_definition_id, direction, endpoint_row_id)
         select scope_uuid, epoch_uuid, $2, $3, 1,
                case when $3 % 2 = 0 then 'outgoing' else 'incoming' end,
                decode($4, 'hex')
         from fx_system_scope_clock where scope_id = $1`,
        [scopeId, commit.commitSeq, ordinal, rowIdHex],
      );
    }
  }
  const lastCommitSeq = input.commits.at(-1)?.commitSeq ?? 0n;
  await persistence.query(
    `update fx_system_scope_clock
     set last_commit_seq = $2, oldest_available_commit_seq = $3
     where scope_id = $1`,
    [scopeId, lastCommitSeq, input.floor],
  );
}

async function readHistoryCounts(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  readonly commits: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<string>;
  readonly relationChanges: ReadonlyArray<string>;
  readonly revisions: ReadonlyArray<string>;
}>> {
  const commits = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_commit
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by commit_seq`,
    [scopeId],
  );
  const changes = await persistence.query<{
    commit_seq: string;
    change_ordinal: number;
  }>(
    `select commit_seq::text, change_ordinal
     from fx_system_commit_app_row_change
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by commit_seq, change_ordinal`,
    [scopeId],
  );
  const revisions = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_app_row_rev
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by commit_seq, row_id`,
    [scopeId],
  );
  const relationChanges = await persistence.query<{
    commit_seq: string;
    change_ordinal: number;
  }>(
    `select commit_seq::text, change_ordinal
     from fx_system_commit_relation_adjacency_change
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by commit_seq, change_ordinal`,
    [scopeId],
  );
  return Object.freeze({
    commits: Object.freeze(commits.rows.map(row => row.commit_seq)),
    changes: Object.freeze(changes.rows.map(
      row => `${row.commit_seq}:${row.change_ordinal}`,
    )),
    relationChanges: Object.freeze(relationChanges.rows.map(
      row => `${row.commit_seq}:${row.change_ordinal}`,
    )),
    revisions: Object.freeze(revisions.rows.map(row => row.commit_seq)),
  });
}
