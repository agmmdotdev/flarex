import { Effect, Result } from "effect";
import {
  decodeCatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  decodeOrderedIndexRowIdHexV1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  decodeReplacementScopeIdV1,
} from
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
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
} from "../src/appIndexDefinitions";
import {
  compactRetainedIndexHistoryPageEffect,
  createRetainedIndexHistoryCompactionPort,
  MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS,
  type RetainedIndexHistoryCompactionPort,
  type RetainedIndexHistoryCompactionQuery,
  type RetainedIndexHistoryCursor,
  type RetainedIndexHistoryCompactionResult,
} from "../src/retainedIndexHistoryCompaction";
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
  databaseKey: "retained-index-history-compaction-primary",
  schemaName: "public",
});

describe("O11-D retained ordered-index history compaction", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `9a000000-0000-4000-8000-${suffix}`;
  }

  async function provision(label: string) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_retained_index_compaction_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator, randomUuid: () => nextUuid() },
    ).ensure({
      deploymentId,
      projectId: `project_retained_index_compaction_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  function port(options: {
    readonly targetCopy?: boolean;
    readonly runReadCommitted?: RunLocatedReadCommittedTransactionV1;
    readonly observeQuery?: (
      query: RetainedIndexHistoryCompactionQuery,
    ) => void;
  } = {}): RetainedIndexHistoryCompactionPort {
    return createRetainedIndexHistoryCompactionPort({
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

  it("deletes only pre-anchor revisions and advances across identities", async () => {
    const context = await provision("identity_walk");
    await seedIdentityHistory(persistence, context.scopeId, {
      keyHex: "11",
      rowIdHex: rowIdHex(1),
      commits: [1, 2, 3],
      currentCommit: 3,
    });
    await seedIdentityHistory(persistence, context.scopeId, {
      keyHex: "22",
      rowIdHex: rowIdHex(2),
      commits: [1],
      currentCommit: 1,
    });
    await seedIdentityHistory(persistence, context.scopeId, {
      keyHex: "33",
      rowIdHex: rowIdHex(3),
      commits: [3],
      currentCommit: 3,
    });
    await setClock(persistence, context.scopeId, 3n, 2n);
    const queries: RetainedIndexHistoryCompactionQuery["name"][] = [];
    const cleanup = port({ observeQuery: query => queries.push(query.name) });

    const first = await runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      context.deploymentId,
      { kind: "start" },
    ));
    expect(first).toMatchObject({
      disposition: "deleted",
      anchorCommitSeq: 2n,
      deletedRevisionCount: 1,
      continuation: { kind: "after" },
    });
    if (first.disposition === "exhausted") {
      throw new Error("Expected the first ordered-index identity.");
    }
    const second = await runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      context.deploymentId,
      first.continuation,
    ));
    expect(second).toMatchObject({
      disposition: "advanced",
      anchorCommitSeq: 1n,
      deletedRevisionCount: 0,
    });
    if (second.disposition === "exhausted") {
      throw new Error("Expected the second ordered-index identity.");
    }
    const third = await runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      context.deploymentId,
      second.continuation,
    ));
    expect(third).toMatchObject({
      disposition: "advanced",
      anchorCommitSeq: null,
      deletedRevisionCount: 0,
    });
    if (third.disposition === "exhausted") {
      throw new Error("Expected the post-floor ordered-index identity.");
    }
    await expect(runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      context.deploymentId,
      third.continuation,
    ))).resolves.toMatchObject({ disposition: "exhausted" });
    expect(queries).toEqual([
      "identityDirectory",
      "anchor",
      "candidateDirectory",
      "revisionDeletion",
      "identityDirectory",
      "anchor",
      "candidateDirectory",
      "identityDirectory",
      "anchor",
      "identityDirectory",
    ]);
    await expect(readIndexHistory(persistence, context.scopeId)).resolves
      .toEqual([
        "11:2", "11:3", "22:1", "33:3",
      ]);
    await expect(readIndexCurrent(persistence, context.scopeId)).resolves
      .toEqual(["11:3", "22:1", "33:3"]);
  });

  it("pages one hot identity without deleting its inclusive anchor", async () => {
    const context = await provision("hot_identity");
    const revisionCount = MAX_RETAINED_INDEX_HISTORY_PAGE_REVISIONS * 2 + 44;
    await seedIdentityHistory(persistence, context.scopeId, {
      keyHex: "44",
      rowIdHex: rowIdHex(4),
      commits: Array.from({ length: revisionCount }, (_, index) => index + 1),
      currentCommit: revisionCount,
    });
    await setClock(
      persistence,
      context.scopeId,
      BigInt(revisionCount),
      BigInt(revisionCount),
    );
    const cleanup = port();
    let cursor: RetainedIndexHistoryCursor = { kind: "start" };
    const deletions: number[] = [];
    for (let page = 0; page < 3; page += 1) {
      const result: RetainedIndexHistoryCompactionResult = await runEffect(
        compactRetainedIndexHistoryPageEffect(
        cleanup,
        context.deploymentId,
        cursor,
        ),
      );
      expect(result.disposition).toBe("deleted");
      if (result.disposition === "exhausted") {
        throw new Error("Expected the hot ordered-index identity.");
      }
      deletions.push(result.deletedRevisionCount);
      cursor = result.continuation;
    }
    expect(deletions).toEqual([128, 128, 43]);
    expect(cursor.kind).toBe("after");
    await expect(runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      context.deploymentId,
      cursor,
    ))).resolves.toMatchObject({ disposition: "exhausted" });
    await expect(readIndexHistory(persistence, context.scopeId)).resolves
      .toEqual([`44:${revisionCount}`]);
    await expect(readIndexCurrent(persistence, context.scopeId)).resolves
      .toEqual([`44:${revisionCount}`]);
  });

  it("preserves the retained anchor as the real writer's chain head", async () => {
    const context = await provision("writer_compatibility");
    const definitionCanonical = await canonicalizeAppIndexPhysicalSpecV1(
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
    );
    const key = encodeOrderedIndexComponentsV1([
      orderedIndexCreationTimeV1(42),
    ]);
    const testRowIdHex = rowIdHex(40);
    await installIndexDefinition(
      persistence,
      context.deploymentId,
      definitionCanonical,
    );
    await seedIdentityHistory(persistence, context.scopeId, {
      keyHex: key,
      rowIdHex: testRowIdHex,
      commits: [1, 2],
      physicalSpecSha256HexByCommit: new Map([
        [1, definitionCanonical.sha256Hex],
        [2, definitionCanonical.sha256Hex],
      ]),
      currentCommit: 2,
    });
    await setClock(persistence, context.scopeId, 2n, 2n);
    await expect(runEffect(compactRetainedIndexHistoryPageEffect(
      port(),
      context.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({
      disposition: "deleted",
      anchorCommitSeq: 2n,
      deletedRevisionCount: 1,
    });

    await persistence.query(
      `insert into fx_app_row_rev
         (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
          write_epoch_uuid, schema_version_id, creation_time,
          value_codec_version, is_tombstone,
          value_json, value_bytes, value_sha256)
       select scope_uuid, 1, decode($2, 'hex'), 3, 2,
              epoch_uuid, 'schema_v1', 3, 1, true, null, null, null
       from fx_system_scope_clock where scope_id = $1`,
      [context.scopeId, testRowIdHex],
    );
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      context.scopeId,
      decodeCatalogIndexDefinitionId(1),
    ));
    if (located === null) throw new Error("Expected the installed index owner.");
    const epochRows = await persistence.query<{ epoch: string }>(
      `select epoch from fx_system_scope_clock where scope_id = $1`,
      [context.scopeId],
    );
    const epoch = epochRows.rows[0]?.epoch;
    if (epoch === undefined) throw new Error("Expected the scope epoch.");
    const appended = await persistence.drizzle.transaction(tx =>
      appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(tx, {
        kind: "tombstone",
        scopeId: context.scopeId,
        definition: located,
        encodedKey: key,
        rowId: decodeOrderedIndexRowIdHexV1(testRowIdHex),
        writeEpoch: ScopeEpochSchema.make(epoch),
        commitSeq: CommitSeqSchema.make(3n),
        prevCommitSeq: CommitSeqSchema.make(2n),
      })
    );
    expect(Result.isSuccess(appended)).toBe(true);
    await expect(readIndexHistory(persistence, context.scopeId)).resolves
      .toEqual([`${key}:2`, `${key}:3`]);
    await expect(readIndexCurrent(persistence, context.scopeId)).resolves
      .toEqual([]);
  });

  it("rejects missing anchors and stable-evidence drift without mutation", async () => {
    const missingAnchor = await provision("missing_anchor");
    await seedIdentityHistory(persistence, missingAnchor.scopeId, {
      keyHex: "55",
      rowIdHex: rowIdHex(5),
      commits: [3],
      previousCommitOverride: 2,
      currentCommit: 3,
    });
    await setClock(persistence, missingAnchor.scopeId, 3n, 2n);
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      port(),
      missingAnchor.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readIndexHistory(persistence, missingAnchor.scopeId)).resolves
      .toEqual(["55:3"]);

    const evidenceDrift = await provision("evidence_drift");
    await seedIdentityHistory(persistence, evidenceDrift.scopeId, {
      keyHex: "66",
      rowIdHex: rowIdHex(6),
      commits: [1, 2],
      physicalSpecSha256HexByCommit: new Map([
        [1, "11".repeat(32)],
        [2, "22".repeat(32)],
      ]),
      currentCommit: 2,
    });
    await setClock(persistence, evidenceDrift.scopeId, 2n, 2n);
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      port(),
      evidenceDrift.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
    await expect(readIndexHistory(persistence, evidenceDrift.scopeId)).resolves
      .toEqual(["66:1", "66:2"]);
  });

  it("lets the current-pointer FK block deletion and rolls back late failure", async () => {
    const blocked = await provision("current_blocker");
    await seedIdentityHistory(persistence, blocked.scopeId, {
      keyHex: "77",
      rowIdHex: rowIdHex(7),
      commits: [1, 2],
      currentCommit: 1,
    });
    await setClock(persistence, blocked.scopeId, 2n, 2n);
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      port(),
      blocked.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ operation: "revisionDeletion" });
    await expect(readIndexHistory(persistence, blocked.scopeId)).resolves
      .toEqual(["77:1", "77:2"]);

    const rollback = await provision("late_rollback");
    await seedIdentityHistory(persistence, rollback.scopeId, {
      keyHex: "88",
      rowIdHex: rowIdHex(8),
      commits: [1, 2],
      currentCommit: 2,
    });
    await setClock(persistence, rollback.scopeId, 2n, 2n);
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    const rollbackRunner: RunLocatedReadCommittedTransactionV1 = work =>
      base(async tx => {
        await work(tx);
        throw new Error("late ordered-index compaction rollback");
      });
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      port({ runReadCommitted: rollbackRunner }),
      rollback.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ issue: { kind: "callbackRolledBack" } });
    await expect(readIndexHistory(persistence, rollback.scopeId)).resolves
      .toEqual(["88:1", "88:2"]);
  });

  it("rejects copied authority and cold-replays a committed uncertain page", async () => {
    const observerCapture = await provision("observer_capture");
    let observerReads = 0;
    const observedQueries: RetainedIndexHistoryCompactionQuery["name"][] = [];
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
        return (query: RetainedIndexHistoryCompactionQuery) => {
          observedQueries.push(query.name);
        };
      },
    });
    const capturedObserverPort = createRetainedIndexHistoryCompactionPort(input);
    expect(observerReads).toBe(1);
    await expect(runEffect(compactRetainedIndexHistoryPageEffect(
      capturedObserverPort,
      observerCapture.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ disposition: "exhausted" });
    expect(observedQueries).toEqual(["identityDirectory"]);

    const copiedPort = await provision("copied_port");
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      { ...port() },
      copiedPort.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ reason: "invalidPort" });

    const copiedTarget = await provision("copied_target");
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      port({ targetCopy: true }),
      copiedTarget.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ reason: "invalidTarget" });

    const uncertain = await provision("uncertain");
    await seedIdentityHistory(persistence, uncertain.scopeId, {
      keyHex: "99",
      rowIdHex: rowIdHex(9),
      commits: [1, 2],
      currentCommit: 2,
    });
    await setClock(persistence, uncertain.scopeId, 2n, 2n);
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
          settlementCause: new Error("lost ordered-index cleanup response"),
        }));
      }
      return result;
    };
    const cleanup = port({ runReadCommitted: uncertainRunner });
    await expect(runEffectFailure(compactRetainedIndexHistoryPageEffect(
      cleanup,
      uncertain.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({ issue: { kind: "decisionUncertain" } });
    await expect(readIndexHistory(persistence, uncertain.scopeId)).resolves
      .toEqual(["99:2"]);
    await expect(runEffect(compactRetainedIndexHistoryPageEffect(
      cleanup,
      uncertain.deploymentId,
      { kind: "start" },
    ))).resolves.toMatchObject({
      disposition: "advanced",
      deletedRevisionCount: 0,
      anchorCommitSeq: 2n,
    });
  });
});

interface SeedIdentityHistoryInput {
  readonly keyHex: string;
  readonly rowIdHex: string;
  readonly commits: ReadonlyArray<number>;
  readonly currentCommit: number;
  readonly previousCommitOverride?: number;
  readonly physicalSpecSha256HexByCommit?: ReadonlyMap<number, string>;
}

async function seedIdentityHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
  input: SeedIdentityHistoryInput,
): Promise<void> {
  let previousCommit: number | null = null;
  for (const commit of input.commits) {
    const storedPrevious = input.previousCommitOverride ?? previousCommit;
    await persistence.query(
      `insert into fx_app_row_rev
         (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
          write_epoch_uuid, schema_version_id, creation_time,
          value_codec_version, is_tombstone,
          value_json, value_bytes, value_sha256)
       select scope_uuid, 1, decode($3, 'hex'), $2::bigint, $4::bigint,
              epoch_uuid, 'schema_v1', $2::double precision,
              1, true, null, null, null
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, commit, input.rowIdHex, storedPrevious],
    );
    const physicalSpecSha256Hex = input.physicalSpecSha256HexByCommit?.get(
      commit,
    ) ?? "11".repeat(32);
    await persistence.query(
      `insert into fx_app_index_entry_rev
         (scope_uuid, index_definition_id, table_id, key_codec_version,
          physical_spec_sha256, encoded_key, key_sha256, row_id,
          commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
       select scope_uuid, 1, 1, 1, decode($5, 'hex'),
              decode($3, 'hex'), decode(repeat('22', 32), 'hex'),
              decode($4, 'hex'), $2::bigint, $6::bigint, epoch_uuid, false
       from fx_system_scope_clock where scope_id = $1`,
      [
        scopeId,
        commit,
        input.keyHex,
        input.rowIdHex,
        physicalSpecSha256Hex,
        storedPrevious,
      ],
    );
    previousCommit = commit;
  }
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, 1, decode($2, 'hex'), decode($3, 'hex'), $4
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, input.keyHex, input.rowIdHex, input.currentCommit],
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

async function readIndexHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{
    key_hex: string;
    commit_seq: string;
  }>(
    `select encode(encoded_key, 'hex') as key_hex, commit_seq::text
     from fx_app_index_entry_rev
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by encoded_key, row_id, commit_seq`,
    [scopeId],
  );
  return result.rows.map(row => `${row.key_hex}:${row.commit_seq}`);
}

async function readIndexCurrent(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<ReadonlyArray<string>> {
  const result = await persistence.query<{
    key_hex: string;
    commit_seq: string;
  }>(
    `select encode(encoded_key, 'hex') as key_hex, commit_seq::text
     from fx_app_index_entry_current
     where scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     ) order by encoded_key, row_id`,
    [scopeId],
  );
  return result.rows.map(row => `${row.key_hex}:${row.commit_seq}`);
}

function rowIdHex(value: number): string {
  return value.toString(16).padStart(32, "0");
}

async function installIndexDefinition(
  persistence: PGliteFlarexPersistence,
  deploymentId: string,
  canonical: Awaited<ReturnType<typeof canonicalizeAppIndexPhysicalSpecV1>>,
): Promise<void> {
  await persistence.query(
    `insert into fx_control_table
       (deployment_id, table_id, namespace, logical_name)
     values ($1, 1, 'app', 'documents')`,
    [deploymentId],
  );
  await persistence.query(
    `insert into fx_control_index_definition
       (deployment_id, index_definition_id, access_kind, access_identity_id,
        table_id, logical_index_id, physical_spec_codec_version,
        physical_spec_json, physical_spec_bytes, physical_spec_sha256)
     values ($1, 1, 'by_creation_time', 1, 1, null, 1, $2, $3, $4)`,
    [
      deploymentId,
      APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        canonical.canonicalBytesHex,
      ),
      appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex),
    ],
  );
}
