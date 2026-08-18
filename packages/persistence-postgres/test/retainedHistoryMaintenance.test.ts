import { Clock, Effect, Result } from "effect";
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
  createLocatedRetainedHistoryFloorTargetInternal,
} from "../src/retainedHistoryFloorObservation";
import {
  createRetainedHistoryMaintenancePort,
  inspectRetainedHistoryMaintenanceContinuationEffect,
  restoreRetainedHistoryMaintenanceContinuationEffect,
  runRetainedHistoryMaintenanceEffect,
  type RetainedHistoryMaintenanceContinuation,
  type RetainedHistoryMaintenancePolicy,
  type RetainedHistoryMaintenanceReceipt,
} from "../src/retainedHistoryMaintenance";
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
  databaseKey: "retained-history-maintenance-primary",
  schemaName: "public",
});

describe("O11-E retained-history maintenance", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `9e000000-0000-4000-8000-${suffix}`;
  }

  async function provision(label: string) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_retained_history_maintenance_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator, randomUuid: () => nextUuid() },
    ).ensure({
      deploymentId,
      projectId: `project_retained_history_maintenance_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  function maintenance(options: {
    readonly policy?: RetainedHistoryMaintenancePolicy;
    readonly runReadCommitted?: RunLocatedReadCommittedTransactionV1;
    readonly beforeResolve?: (resolutionCount: number) => Promise<void>;
  } = {}) {
    let resolutionCount = 0;
    return Result.getOrThrow(createRetainedHistoryMaintenancePort({
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared scope must not read split receipts.");
          },
        },
        scopeClockTargets: {
          resolve: async (locator: ScopePhysicalLocator) => {
            resolutionCount += 1;
            await options.beforeResolve?.(resolutionCount);
            return createLocatedRetainedHistoryFloorTargetInternal(
              persistence.drizzle,
              locator,
              options.runReadCommitted ??
                createDefaultLocatedReadCommittedTransactionRunnerV1(
                  persistence.drizzle,
                ),
            );
          },
        },
      },
      policy: options.policy ?? {
        maximumPages: 32,
        maximumElapsedMilliseconds: 30_000,
      },
    }));
  }

  it("resumes exact dependency order under a one-page count budget", async () => {
    const context = await provision("count_resume");
    await seedConnectedHistory(persistence, context.scopeId);
    const cleanup = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    let continuation: RetainedHistoryMaintenanceContinuation | null = null;
    const phases: string[] = [];

    const first = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(first).toMatchObject({
      status: "maintenancePaused",
      stopReason: "pageBudget",
      pagesExecuted: 1,
      commitPagesExecuted: 1,
      deletedCommitCount: 1,
      deletedChangeCount: 1,
      continuation: { phase: "commitHistory" },
    });
    continuation = first.continuation;
    if (continuation === null) throw new Error("Missing commit continuation.");
    phases.push(continuation.phase);
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual({ commits: ["3"], changes: [], indexes: ["1", "2", "3"], appRows: ["1", "2", "3"] });

    const second = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(second.continuation).toMatchObject({ phase: "indexHistory" });
    continuation = second.continuation;
    if (continuation === null) throw new Error("Missing index continuation.");
    phases.push(continuation.phase);

    const third = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(third).toMatchObject({
      deletedIndexRevisionCount: 2,
      continuation: { phase: "indexHistory" },
    });
    continuation = third.continuation;
    if (continuation === null) throw new Error("Missing index continuation.");
    phases.push(continuation.phase);
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual({ commits: ["3"], changes: [], indexes: ["3"], appRows: ["1", "2", "3"] });

    const fourth = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(fourth.continuation).toMatchObject({ phase: "appRowHistory" });
    continuation = fourth.continuation;
    if (continuation === null) throw new Error("Missing row continuation.");
    phases.push(continuation.phase);

    const fifth = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(fifth).toMatchObject({
      deletedAppRowRevisionCount: 1,
      continuation: { phase: "appRowHistory" },
    });
    continuation = fifth.continuation;
    if (continuation === null) throw new Error("Missing row continuation.");
    phases.push(continuation.phase);

    const completed = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(completed).toMatchObject({
      status: "maintenanceComplete",
      stopReason: "exhausted",
      pagesExecuted: 1,
      appRowPagesExecuted: 1,
      continuation: null,
    });
    expect(phases).toEqual([
      "commitHistory", "indexHistory", "indexHistory",
      "appRowHistory", "appRowHistory",
    ]);
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual({ commits: ["3"], changes: [], indexes: ["3"], appRows: ["1", "3"] });
  });

  it("exports and restores owned continuation evidence across port reconstruction", async () => {
    const context = await provision("durable_continuation");
    await seedConnectedHistory(persistence, context.scopeId);
    const firstPort = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    const first = await runEffect(runRetainedHistoryMaintenanceEffect(
      firstPort,
      context.deploymentId,
      null,
    ));
    if (first.continuation === null) {
      throw new Error("Expected a paused retained-history continuation.");
    }
    const evidence = await runEffect(
      inspectRetainedHistoryMaintenanceContinuationEffect(
        firstPort,
        first.continuation,
      ),
    );
    expect(evidence).toMatchObject({
      version: "flarex.retained-history-maintenance-continuation.v1",
      deploymentId: context.deploymentId,
      scopeId: context.scopeId,
      retainedFloor: "3",
      phase: { kind: "commitHistory" },
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.authority)).toBe(true);

    const reconstructedPort = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    const restored = await runEffect(
      restoreRetainedHistoryMaintenanceContinuationEffect(
        reconstructedPort,
        structuredClone(evidence),
      ),
    );
    expect(restored).not.toBe(first.continuation);
    expect(restored).toMatchObject({
      deploymentId: context.deploymentId,
      scopeId: context.scopeId,
      retainedFloor: 3n,
      phase: "commitHistory",
    });
    await expect(runEffect(runRetainedHistoryMaintenanceEffect(
      reconstructedPort,
      context.deploymentId,
      restored,
    ))).resolves.toMatchObject({
      status: "maintenancePaused",
      continuation: { phase: "indexHistory" },
    });
  });

  it("rejects invalid configuration and copied or foreign continuations", async () => {
    const invalid = createRetainedHistoryMaintenancePort({
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("unused");
          },
        },
        scopeClockTargets: {
          resolve: async () => {
            throw new Error("unused");
          },
        },
      },
      policy: { maximumPages: 0, maximumElapsedMilliseconds: 1 },
    });
    expect(Result.isFailure(invalid)).toBe(true);

    const context = await provision("continuation_auth");
    const issuer = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    const first = await runEffect(runRetainedHistoryMaintenanceEffect(
      issuer, context.deploymentId, null,
    ));
    const continuation = first.continuation;
    if (continuation === null) throw new Error("Missing continuation.");
    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      { ...issuer }, context.deploymentId, null,
    ))).resolves.toMatchObject({ reason: "invalidPort" });
    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      issuer,
      context.deploymentId,
      { ...continuation },
    ))).resolves.toMatchObject({ reason: "invalidContinuation" });
    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      maintenance(), context.deploymentId, continuation,
    ))).resolves.toMatchObject({ reason: "continuationIssuerMismatch" });
    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      issuer, "deployment_foreign", continuation,
    ))).resolves.toMatchObject({ reason: "continuationDeploymentMismatch" });
  });

  it("drops a continuation when the scope authority fence changes", async () => {
    const context = await provision("authority_change");
    const cleanup = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    const first = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, null,
    ));
    const continuation = first.continuation;
    if (continuation === null) throw new Error("Missing continuation.");

    await persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = storage_generation_fence + 1
       where scope_id = $1`,
      [context.scopeId],
    );
    const reset = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ));
    expect(reset).toMatchObject({
      status: "maintenancePaused",
      stopReason: "authorityChanged",
      pagesExecuted: 0,
      continuation: null,
    });

    await expect(runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, null,
    ))).resolves.toMatchObject({
      status: "maintenancePaused",
      stopReason: "pageBudget",
      pagesExecuted: 1,
      continuation: { phase: "indexHistory" },
    });
  });

  it("drops page progress when authority changes after page settlement", async () => {
    const context = await provision("authority_change_after_page");
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    let changeFence = true;
    const changingRunner: RunLocatedReadCommittedTransactionV1 = async work => {
      const result = await base(work);
      if (changeFence) {
        changeFence = false;
        await persistence.query(
          `update fx_system_scope_clock
           set storage_generation_fence = storage_generation_fence + 1
           where scope_id = $1`,
          [context.scopeId],
        );
      }
      return result;
    };

    const reset = await runEffect(runRetainedHistoryMaintenanceEffect(
      maintenance({ runReadCommitted: changingRunner }),
      context.deploymentId,
      null,
    ));
    expect(reset).toMatchObject({
      status: "maintenancePaused",
      stopReason: "authorityChanged",
      pagesExecuted: 1,
      commitPagesExecuted: 1,
      continuation: null,
    });
  });

  it("rejects authority replacement under the next owner page lock", async () => {
    const context = await provision("authority_change_under_lock");
    const cleanup = maintenance({
      beforeResolve: async resolutionCount => {
        if (resolutionCount === 4) {
          await persistence.query(
            `update fx_system_scope_clock
             set storage_generation_fence = storage_generation_fence + 1
             where scope_id = $1`,
            [context.scopeId],
          );
        }
        if (resolutionCount === 5) {
          throw new Error("guarded authority restart must not resolve again");
        }
      },
    });

    const reset = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup,
      context.deploymentId,
      null,
    ));
    expect(reset).toMatchObject({
      status: "maintenancePaused",
      stopReason: "authorityChanged",
      pagesExecuted: 2,
      commitPagesExecuted: 1,
      indexPagesExecuted: 1,
      continuation: null,
    });
  });

  it("stops cooperatively on elapsed time after a settled page", async () => {
    const context = await provision("time_budget");
    await seedConnectedHistory(persistence, context.scopeId);
    const clock = steppingClock([0n, 2_000_000n]);
    const receipt = await runEffect(runRetainedHistoryMaintenanceEffect(
      maintenance({
        policy: { maximumPages: 32, maximumElapsedMilliseconds: 1 },
      }),
      context.deploymentId,
      null,
    ).pipe(Effect.provideService(Clock.Clock, clock)));
    expect(receipt).toMatchObject({
      status: "maintenancePaused",
      stopReason: "timeBudget",
      pagesExecuted: 1,
      commitPagesExecuted: 1,
      continuation: { phase: "commitHistory" },
    });
    expect(receipt.elapsedMilliseconds).toBeGreaterThanOrEqual(1);
  });

  it("resets to commit history when the retained floor advances", async () => {
    const context = await provision("floor_advance");
    await setClock(persistence, context.scopeId, 3n, 2n);
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    let transactionCount = 0;
    const advancingRunner: RunLocatedReadCommittedTransactionV1 = async work => {
      transactionCount += 1;
      if (transactionCount === 2) {
        await setClock(persistence, context.scopeId, 3n, 3n);
      }
      return base(work);
    };
    const cleanup = maintenance({ runReadCommitted: advancingRunner });

    const advanced = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, null,
    ));
    expect(advanced).toMatchObject({
      status: "maintenancePaused",
      stopReason: "floorAdvanced",
      retainedFloor: 3n,
      pagesExecuted: 2,
      continuation: { phase: "commitHistory", retainedFloor: 3n },
    });
    const continuation = advanced.continuation;
    if (continuation === null) throw new Error("Missing reset continuation.");
    await expect(runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, continuation,
    ))).resolves.toMatchObject({
      status: "maintenanceComplete",
      stopReason: "exhausted",
      retainedFloor: 3n,
      continuation: null,
    });
  });

  it("checks a resumed app-row floor before touching connected history", async () => {
    const context = await provision("connected_floor_advance");
    await seedConnectedHistory(persistence, context.scopeId);
    await setClock(persistence, context.scopeId, 3n, 2n);
    const cleanup = maintenance({
      policy: { maximumPages: 1, maximumElapsedMilliseconds: 30_000 },
    });
    let continuation: RetainedHistoryMaintenanceContinuation | null = null;
    for (let page = 0; page < 8; page += 1) {
      const receipt: RetainedHistoryMaintenanceReceipt = await runEffect(
        runRetainedHistoryMaintenanceEffect(
        cleanup,
        context.deploymentId,
        continuation,
        ),
      );
      continuation = receipt.continuation;
      if (continuation?.phase === "appRowHistory") break;
    }
    expect(continuation).toMatchObject({
      phase: "appRowHistory",
      retainedFloor: 2n,
    });
    if (continuation === null) throw new Error("Missing app-row continuation.");
    const beforeAdvance = await readConnectedHistory(
      persistence,
      context.scopeId,
    );
    expect(beforeAdvance).toEqual({
      commits: ["2", "3"],
      changes: ["2"],
      indexes: ["2", "3"],
      appRows: ["1", "2", "3"],
    });

    await setClock(persistence, context.scopeId, 3n, 3n);
    const reset = await runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup,
      context.deploymentId,
      continuation,
    ));
    expect(reset).toMatchObject({
      status: "maintenancePaused",
      stopReason: "floorAdvanced",
      retainedFloor: 3n,
      pagesExecuted: 1,
      appRowPagesExecuted: 1,
      deletedAppRowRevisionCount: 0,
      continuation: { phase: "commitHistory", retainedFloor: 3n },
    });
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual(beforeAdvance);

    continuation = reset.continuation;
    const resumedPhases: string[] = [];
    for (let page = 0; page < 8 && continuation !== null; page += 1) {
      const receipt: RetainedHistoryMaintenanceReceipt = await runEffect(
        runRetainedHistoryMaintenanceEffect(
        cleanup,
        context.deploymentId,
        continuation,
        ),
      );
      continuation = receipt.continuation;
      resumedPhases.push(continuation?.phase ?? "complete");
    }
    expect(resumedPhases).toEqual([
      "commitHistory",
      "indexHistory",
      "indexHistory",
      "appRowHistory",
      "appRowHistory",
      "complete",
    ]);
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual({
        commits: ["3"],
        changes: [],
        indexes: ["3"],
        appRows: ["1", "3"],
      });
  });

  it("fails closed when the retained floor regresses", async () => {
    const context = await provision("floor_regression");
    await setClock(persistence, context.scopeId, 3n, 2n);
    const base = createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    );
    let transactionCount = 0;
    const regressingRunner: RunLocatedReadCommittedTransactionV1 = async work => {
      transactionCount += 1;
      if (transactionCount === 2) {
        await setClock(persistence, context.scopeId, 3n, 1n);
      }
      return base(work);
    };

    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      maintenance({ runReadCommitted: regressingRunner }),
      context.deploymentId,
      null,
    ))).resolves.toMatchObject({
      reason: "retainedFloorRegressed",
      expectedRetainedFloor: 2n,
      actualRetainedFloor: 1n,
    });
  });

  it("restarts safely after a committed but uncertain owner page", async () => {
    const context = await provision("uncertain");
    await seedConnectedHistory(persistence, context.scopeId);
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
          settlementCause: new Error("lost maintenance page response"),
        }));
      }
      return result;
    };
    const cleanup = maintenance({ runReadCommitted: uncertainRunner });
    await expect(runEffectFailure(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, null,
    ))).resolves.toMatchObject({ issue: { kind: "decisionUncertain" } });
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toMatchObject({ commits: ["3"], changes: [] });

    await expect(runEffect(runRetainedHistoryMaintenanceEffect(
      cleanup, context.deploymentId, null,
    ))).resolves.toMatchObject({
      status: "maintenanceComplete",
      stopReason: "exhausted",
      continuation: null,
    });
    await expect(readConnectedHistory(persistence, context.scopeId)).resolves
      .toEqual({ commits: ["3"], changes: [], indexes: ["3"], appRows: ["1", "3"] });
  });

  it("completes an empty cycle in exact owner order", async () => {
    const context = await provision("empty");
    const receipt = await runEffect(runRetainedHistoryMaintenanceEffect(
      maintenance(), context.deploymentId, null,
    ));
    expect(receipt).toMatchObject({
      status: "maintenanceComplete",
      stopReason: "exhausted",
      pagesExecuted: 3,
      commitPagesExecuted: 1,
      indexPagesExecuted: 1,
      appRowPagesExecuted: 1,
      continuation: null,
    });
  });
});

async function seedConnectedHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<void> {
  const rowId = "11".repeat(16);
  for (const commitSeq of [1, 2, 3]) {
    await persistence.query(
      `insert into fx_app_row_rev
         (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
          write_epoch_uuid, schema_version_id, creation_time,
          value_codec_version, is_tombstone,
          value_json, value_bytes, value_sha256)
       select scope_uuid, 1, decode($2, 'hex'), $3::bigint,
              case when $3::bigint = 1 then null else $3::bigint - 1 end,
              epoch_uuid, 'schema_v1', 42, 1, true, null, null, null
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, rowId, commitSeq],
    );
    await persistence.query(
      `insert into fx_app_index_entry_rev
         (scope_uuid, index_definition_id, table_id, key_codec_version,
          physical_spec_sha256, encoded_key, key_sha256, row_id,
          commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
       select scope_uuid, 1, 1, 1, decode(repeat('22', 32), 'hex'),
              decode('33', 'hex'), decode(repeat('44', 32), 'hex'),
              decode($2, 'hex'), $3::bigint,
              case when $3::bigint = 1 then null else $3::bigint - 1 end,
              epoch_uuid, false
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, rowId, commitSeq],
    );
  }
  await persistence.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     select scope_uuid, 1, decode($2, 'hex'), 3
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, 1, decode('33', 'hex'), decode($2, 'hex'), 3
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  for (const commit of [
    { commitSeq: 2, changeCount: 1 },
    { commitSeq: 3, changeCount: 0 },
  ]) {
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, $2, $3, clock_timestamp()
       from fx_system_scope_clock where scope_id = $1`,
      [scopeId, commit.commitSeq, commit.changeCount],
    );
  }
  await persistence.query(
    `insert into fx_system_commit_app_row_change
       (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
     select scope_uuid, epoch_uuid, 2, 0, 1, decode($2, 'hex')
     from fx_system_scope_clock where scope_id = $1`,
    [scopeId, rowId],
  );
  await setClock(persistence, scopeId, 3n, 3n);
}

async function readConnectedHistory(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{
  readonly commits: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<string>;
  readonly indexes: ReadonlyArray<string>;
  readonly appRows: ReadonlyArray<string>;
}>> {
  const [commits, changes, indexes, appRows] = await Promise.all([
    persistence.query<{ value: string }>(
      `select commit_seq::text as value from fx_system_commit
       where scope_uuid = (select scope_uuid from fx_system_scope_clock where scope_id = $1)
       order by commit_seq`, [scopeId],
    ),
    persistence.query<{ value: string }>(
      `select commit_seq::text as value from fx_system_commit_app_row_change
       where scope_uuid = (select scope_uuid from fx_system_scope_clock where scope_id = $1)
       order by commit_seq`, [scopeId],
    ),
    persistence.query<{ value: string }>(
      `select commit_seq::text as value from fx_app_index_entry_rev
       where scope_uuid = (select scope_uuid from fx_system_scope_clock where scope_id = $1)
       order by commit_seq`, [scopeId],
    ),
    persistence.query<{ value: string }>(
      `select commit_seq::text as value from fx_app_row_rev
       where scope_uuid = (select scope_uuid from fx_system_scope_clock where scope_id = $1)
       order by commit_seq`, [scopeId],
    ),
  ]);
  return Object.freeze({
    commits: Object.freeze(commits.rows.map(row => row.value)),
    changes: Object.freeze(changes.rows.map(row => row.value)),
    indexes: Object.freeze(indexes.rows.map(row => row.value)),
    appRows: Object.freeze(appRows.rows.map(row => row.value)),
  });
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

function steppingClock(timestamps: ReadonlyArray<bigint>): Clock.Clock {
  let index = 0;
  let current = timestamps[0] ?? 0n;
  const next = (): bigint => {
    current = timestamps[index] ?? current;
    index += 1;
    return current;
  };
  return Object.freeze({
    currentTimeMillisUnsafe: () => Number(current / 1_000_000n),
    currentTimeMillis: Effect.sync(() => Number(next() / 1_000_000n)),
    currentTimeNanosUnsafe: () => current,
    currentTimeNanos: Effect.sync(next),
    sleep: () => Effect.void,
  });
}
