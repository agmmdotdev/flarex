import { Effect, Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId, } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, it } from "vitest";

import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
  readAppRowAtSnapshotInTransactionEffect,
} from "../src/appRows";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  compactRetainedAppRowHistoryPageEffect,
  createRetainedAppRowHistoryCompactionPort,
  MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS,
  type RetainedAppRowHistoryCompactionPort,
  type RetainedAppRowHistoryCompactionQuery,
  type RetainedAppRowHistoryCompactionResult,
  type RetainedAppRowHistoryCursor,
} from "../src/retainedAppRowHistoryCompaction";
import {
  createLocatedRetainedHistoryFloorTargetInternal,
} from "../src/retainedHistoryFloorObservation";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
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
  databaseKey: "retained-app-row-history-compaction-primary",
  schemaName: "public",
});

describe("O11-D retained app-row history compaction", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `9c000000-0000-4000-8000-${suffix}`;
  }

  async function provision(label: string) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_retained_app_row_compaction_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator, randomUuid: () => nextUuid() },
    ).ensure({
      deploymentId,
      projectId: `project_retained_app_row_compaction_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  function port(options: {
    readonly targetCopy?: boolean;
    readonly runReadCommitted?: RunLocatedReadCommittedTransactionV1;
    readonly observeQuery?: (
      query: RetainedAppRowHistoryCompactionQuery,
    ) => void;
  } = {}): RetainedAppRowHistoryCompactionPort {
    return createRetainedAppRowHistoryCompactionPort({
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

  it("preserves roots and anchors while advancing across identities", async () => {
    const context = await provision("identity_walk");
    await seedHistory(persistence, context.scopeId, {
      rowIdHex: rowIdHex(1), commits: [1, 2, 3, 4], currentCommit: 4,
    });
    await seedHistory(persistence, context.scopeId, {
      rowIdHex: rowIdHex(2), commits: [1], currentCommit: 1,
    });
    await seedHistory(persistence, context.scopeId, {
      rowIdHex: rowIdHex(3), commits: [4], currentCommit: 4,
    });
    await setClock(persistence, context.scopeId, 4n, 3n);
    const queries: RetainedAppRowHistoryCompactionQuery["name"][] = [];
    const cleanup = port({ observeQuery: query => queries.push(query.name) });

    const first = await runEffect(compactRetainedAppRowHistoryPageEffect(
      cleanup, context.deploymentId, { kind: "start" },
    ));
    expect(first).toMatchObject({
      disposition: "deleted",
      rootCommitSeq: 1n,
      anchorCommitSeq: 3n,
      deletedRevisionCount: 1,
      continuation: { kind: "after" },
    });
    if (first.disposition === "exhausted") throw new Error("Missing row A.");
    const second = await runEffect(compactRetainedAppRowHistoryPageEffect(
      cleanup, context.deploymentId, first.continuation,
    ));
    expect(second).toMatchObject({
      disposition: "advanced", rootCommitSeq: 1n, anchorCommitSeq: 1n,
    });
    if (second.disposition === "exhausted") throw new Error("Missing row B.");
    const third = await runEffect(compactRetainedAppRowHistoryPageEffect(
      cleanup, context.deploymentId, second.continuation,
    ));
    expect(third).toMatchObject({
      disposition: "advanced", rootCommitSeq: 4n, anchorCommitSeq: null,
    });
    if (third.disposition === "exhausted") throw new Error("Missing row C.");
    await expect(runEffect(compactRetainedAppRowHistoryPageEffect(
      cleanup, context.deploymentId, third.continuation,
    ))).resolves.toMatchObject({ disposition: "exhausted" });
    expect(queries).toEqual([
      "identityDirectory", "anchor", "candidateDirectory",
      "revisionDeletion", "identityDirectory", "anchor",
      "candidateDirectory", "identityDirectory", "anchor",
      "identityDirectory",
    ]);
    await expect(readHistory(persistence, context.scopeId)).resolves.toEqual([
      `${rowIdHex(1)}:1`, `${rowIdHex(1)}:3`, `${rowIdHex(1)}:4`,
      `${rowIdHex(2)}:1`, `${rowIdHex(3)}:4`,
    ]);
    await expect(readCurrent(persistence, context.scopeId)).resolves.toEqual([
      `${rowIdHex(1)}:4`, `${rowIdHex(2)}:1`, `${rowIdHex(3)}:4`,
    ]);
  });

  it("pages one hot identity without deleting its root or inclusive anchor", async () => {
    const context = await provision("hot_identity");
    const revisionCount =
      MAX_RETAINED_APP_ROW_HISTORY_PAGE_REVISIONS * 2 + 44;
    await seedHistory(persistence, context.scopeId, {
      rowIdHex: rowIdHex(4),
      commits: Array.from({ length: revisionCount }, (_, index) => index + 1),
      currentCommit: revisionCount,
    });
    await setClock(
      persistence, context.scopeId, BigInt(revisionCount), BigInt(revisionCount),
    );
    let cursor: RetainedAppRowHistoryCursor = { kind: "start" };
    const deletions: number[] = [];
    for (let page = 0; page < 3; page += 1) {
      const result: RetainedAppRowHistoryCompactionResult = await runEffect(
        compactRetainedAppRowHistoryPageEffect(
          port(), context.deploymentId, cursor,
        ),
      );
      expect(result.disposition).toBe("deleted");
      if (result.disposition === "exhausted") throw new Error("Missing row.");
      deletions.push(result.deletedRevisionCount);
      cursor = result.continuation;
    }
    expect(deletions).toEqual([128, 128, 42]);
    expect(cursor.kind).toBe("after");
    await expect(readHistory(persistence, context.scopeId)).resolves.toEqual([
      `${rowIdHex(4)}:1`, `${rowIdHex(4)}:${revisionCount}`,
    ]);
    await expect(readCurrent(persistence, context.scopeId)).resolves.toEqual([
      `${rowIdHex(4)}:${revisionCount}`,
    ]);
  });

  it("keeps snapshot reads and the real writer compatible with a pruned chain", async () => {
    const context = await provision("reader_writer");
    const testRowId = rowIdHex(5);
    await seedHistory(persistence, context.scopeId, {
      rowIdHex: testRowId, commits: [1, 2, 3], currentCommit: 3,
    });
    await setClock(persistence, context.scopeId, 3n, 3n);
    await expect(runEffect(compactRetainedAppRowHistoryPageEffect(
      port(), context.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({
      disposition: "deleted", rootCommitSeq: 1n, anchorCommitSeq: 3n,
    });

    const snapshot = await persistence.drizzle.transaction(tx =>
      runEffect(readAppRowAtSnapshotInTransactionEffect(tx, {
        scopeId: context.scopeId,
        tableId: decodeCatalogTableId(1),
        rowId: decodeAppRowIdHexV1(testRowId),
        snapshotCommitSeq: CommitSeqSchema.make(3n),
      }))
    );
    expect(snapshot).toMatchObject({ kind: "tombstone", commitSeq: 3n });
    const epochRows = await persistence.query<{ epoch: string }>(
      "select epoch from fx_system_scope_clock where scope_id = $1",
      [context.scopeId],
    );
    const epoch = epochRows.rows[0]?.epoch;
    if (epoch === undefined) throw new Error("Missing scope epoch.");
    const appended = await persistence.drizzle.transaction(tx =>
      appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(tx, {
        kind: "tombstone",
        scopeId: context.scopeId,
        tableId: decodeCatalogTableId(1),
        rowId: decodeAppRowIdHexV1(testRowId),
        writeEpoch: ScopeEpochSchema.make(epoch),
        commitSeq: CommitSeqSchema.make(4n),
        prevCommitSeq: CommitSeqSchema.make(3n),
        schemaVersionId: decodeCatalogSchemaVersionId("schema_v1"),
        creationTime: decodeAppCreationTimeV1(42),
      })
    );
    expect(Result.isSuccess(appended)).toBe(true);
    await expect(readHistory(persistence, context.scopeId)).resolves.toEqual([
      `${testRowId}:1`, `${testRowId}:3`, `${testRowId}:4`,
    ]);
    await expect(readCurrent(persistence, context.scopeId)).resolves.toEqual([
      `${testRowId}:4`,
    ]);
  });

  it("rejects missing roots and immutable creation-time drift", async () => {
    const missingRoot = await provision("missing_root");
    await seedHistory(persistence, missingRoot.scopeId, {
      rowIdHex: rowIdHex(6), commits: [3], currentCommit: 3,
      previousCommitOverride: 2,
    });
    await setClock(persistence, missingRoot.scopeId, 3n, 3n);
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port(), missingRoot.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });

    const drift = await provision("creation_time_drift");
    await seedHistory(persistence, drift.scopeId, {
      rowIdHex: rowIdHex(7), commits: [1, 2, 3], currentCommit: 3,
      creationTimeByCommit: new Map([[2, 43]]),
    });
    await setClock(persistence, drift.scopeId, 3n, 3n);
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port(), drift.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readHistory(persistence, drift.scopeId)).resolves.toEqual([
      `${rowIdHex(7)}:1`, `${rowIdHex(7)}:2`, `${rowIdHex(7)}:3`,
    ]);

    const candidateBelowRoot = await provision("candidate_below_root");
    await seedHistory(persistence, candidateBelowRoot.scopeId, {
      rowIdHex: rowIdHex(70), commits: [5, 6, 7], currentCommit: 7,
    });
    await setPreviousCommit(
      persistence, candidateBelowRoot.scopeId, rowIdHex(70), 6, 1,
    );
    await setClock(persistence, candidateBelowRoot.scopeId, 7n, 7n);
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port(), candidateBelowRoot.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readHistory(
      persistence,
      candidateBelowRoot.scopeId,
    )).resolves.toEqual([
      `${rowIdHex(70)}:5`, `${rowIdHex(70)}:6`, `${rowIdHex(70)}:7`,
    ]);

    const anchorBelowRoot = await provision("anchor_below_root");
    await seedHistory(persistence, anchorBelowRoot.scopeId, {
      rowIdHex: rowIdHex(71), commits: [5, 6], currentCommit: 6,
    });
    await setPreviousCommit(
      persistence, anchorBelowRoot.scopeId, rowIdHex(71), 6, 1,
    );
    await setClock(persistence, anchorBelowRoot.scopeId, 6n, 6n);
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port(), anchorBelowRoot.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readHistory(
      persistence,
      anchorBelowRoot.scopeId,
    )).resolves.toEqual([
      `${rowIdHex(71)}:5`, `${rowIdHex(71)}:6`,
    ]);
  });

  it("lets foreign keys block deletion and rolls back late failure", async () => {
    const blocked = await provision("current_blocker");
    await seedHistory(persistence, blocked.scopeId, {
      rowIdHex: rowIdHex(8), commits: [1, 2, 3], currentCommit: 2,
    });
    await setClock(persistence, blocked.scopeId, 3n, 3n);
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port(), blocked.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ operation: "revisionDeletion" });
    await expect(readHistory(persistence, blocked.scopeId)).resolves.toEqual([
      `${rowIdHex(8)}:1`, `${rowIdHex(8)}:2`, `${rowIdHex(8)}:3`,
    ]);

    const rollback = await provision("late_rollback");
    await seedHistory(persistence, rollback.scopeId, {
      rowIdHex: rowIdHex(9), commits: [1, 2, 3], currentCommit: 3,
    });
    await setClock(persistence, rollback.scopeId, 3n, 3n);
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    const rollbackRunner: RunLocatedReadCommittedTransactionV1 = work =>
      base(async tx => {
        await work(tx);
        throw new Error("late app-row compaction rollback");
      });
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port({ runReadCommitted: rollbackRunner }),
      rollback.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ issue: { kind: "callbackRolledBack" } });
    await expect(readHistory(persistence, rollback.scopeId)).resolves.toEqual([
      `${rowIdHex(9)}:1`, `${rowIdHex(9)}:2`, `${rowIdHex(9)}:3`,
    ]);
  });

  it("rejects copied authority and cold-replays a committed uncertain page", async () => {
    const observerCapture = await provision("observer_capture");
    let observerReads = 0;
    const observed: RetainedAppRowHistoryCompactionQuery["name"][] = [];
    const input = Object.defineProperty({
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scope must not read split receipts.");
          },
        },
        scopeClockTargets: {
          resolve: async (locator: ScopePhysicalLocator) =>
            createLocatedRetainedHistoryFloorTargetInternal(
              persistence.drizzle,
              locator,
              createDefaultLocatedReadCommittedTransactionRunnerV1(
                persistence.drizzle,
              ),
            ),
        },
      },
    }, "observeQuery", {
      enumerable: true,
      get: () => {
        observerReads += 1;
        return (query: RetainedAppRowHistoryCompactionQuery) => {
          observed.push(query.name);
        };
      },
    });
    const captured = createRetainedAppRowHistoryCompactionPort(input);
    expect(observerReads).toBe(1);
    await expect(runEffect(compactRetainedAppRowHistoryPageEffect(
      captured, observerCapture.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ disposition: "exhausted" });
    expect(observed).toEqual(["identityDirectory"]);

    const copiedPort = await provision("copied_port");
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      { ...port() }, copiedPort.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "invalidPort" });
    const copiedTarget = await provision("copied_target");
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      port({ targetCopy: true }), copiedTarget.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ reason: "invalidTarget" });

    const uncertain = await provision("uncertain");
    await seedHistory(persistence, uncertain.scopeId, {
      rowIdHex: rowIdHex(10), commits: [1, 2, 3], currentCommit: 3,
    });
    await setClock(persistence, uncertain.scopeId, 3n, 3n);
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
          settlementCause: new Error("lost app-row cleanup response"),
        }));
      }
      return result;
    };
    const cleanup = port({ runReadCommitted: uncertainRunner });
    await expect(runEffectFailure(compactRetainedAppRowHistoryPageEffect(
      cleanup, uncertain.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({ issue: { kind: "decisionUncertain" } });
    await expect(readHistory(persistence, uncertain.scopeId)).resolves.toEqual([
      `${rowIdHex(10)}:1`, `${rowIdHex(10)}:3`,
    ]);
    await expect(runEffect(compactRetainedAppRowHistoryPageEffect(
      cleanup, uncertain.deploymentId, { kind: "start" },
    ))).resolves.toMatchObject({
      disposition: "advanced", deletedRevisionCount: 0,
      rootCommitSeq: 1n, anchorCommitSeq: 3n,
    });
  });
});

interface SeedHistoryInput {
  readonly rowIdHex: string;
  readonly commits: ReadonlyArray<number>;
  readonly currentCommit: number;
  readonly previousCommitOverride?: number;
  readonly creationTimeByCommit?: ReadonlyMap<number, number>;
}

async function seedHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  input: SeedHistoryInput,
): Promise<void> {
  let previousCommit: number | null = null;
  for (const commit of input.commits) {
    const storedPrevious = input.previousCommitOverride ?? previousCommit;
    const creationTime = input.creationTimeByCommit?.get(commit) ?? 42;
    await persistence.query(
      `insert into fx_app_row_rev
         (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
          write_epoch_uuid, schema_version_id, creation_time,
          value_codec_version, is_tombstone,
          value_json, value_bytes, value_sha256)
       select scope_uuid, 1, decode($3, 'hex'), $2::bigint, $4::bigint,
              epoch_uuid, 'schema_v1', $5::double precision,
              1, true, null, null, null
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, commit, input.rowIdHex, storedPrevious, creationTime],
    );
    previousCommit = commit;
  }
  await persistence.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     select scope_uuid, 1, decode($2, 'hex'), $3
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, input.rowIdHex, input.currentCommit],
  );
}

async function setClock(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  lastCommitSeq: bigint,
  retainedFloor: bigint,
): Promise<void> {
  await persistence.query(
    `update fx_system_scope_clock
     set last_commit_seq = $2, oldest_available_commit_seq = $3
     where scope_id = $1`,
    [scopeId, lastCommitSeq, retainedFloor],
  );
}

async function setPreviousCommit(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  rowId: string,
  commitSeq: number,
  previousCommitSeq: number,
): Promise<void> {
  await persistence.query(
    `update fx_app_row_rev
     set prev_commit_seq = $4
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) and table_id = 1 and row_id = decode($2, 'hex') and commit_seq = $3`,
    [scopeId, rowId, commitSeq, previousCommitSeq],
  );
}

async function readHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select encode(row_id, 'hex') as row_id_hex, commit_seq::text
     from fx_app_row_rev
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by table_id, row_id, commit_seq`,
    [scopeId],
  );
  return result.rows.map(row => `${row.row_id_hex}:${row.commit_seq}`);
}

async function readCurrent(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select encode(row_id, 'hex') as row_id_hex, commit_seq::text
     from fx_app_row_current
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by table_id, row_id`,
    [scopeId],
  );
  return result.rows.map(row => `${row.row_id_hex}:${row.commit_seq}`);
}

function rowIdHex(value: number): string {
  return value.toString(16).padStart(32, "0");
}
