import { eq } from "drizzle-orm";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  type FlarexPersistence,
  ScopeClockCorruptionError,
  type SharedDatabaseScopePhysicalLocator,
} from "../src";
import {
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityBootstrapper,
  createPGliteSharedScopeAuthorityProvisioner,
  InvalidGeneratedScopeAuthorityIdError,
  InvalidSharedScopeAuthorityBootstrapBatchLimitError,
  InvalidSharedScopeAuthorityBootstrapFrontierError,
  SharedScopeAuthorityBootstrapFrontierVersion,
  type PGliteFlarexPersistence,
  type RunSharedScopeAuthorityBootstrapBatchInput,
} from "../src/pglite";
import {
  bootstrapExistingSharedScopeAuthorityInTransaction,
} from "../src/scopeAuthorityProvisioning";
import { fxSystemScopeClocks } from "../src/schema";

const sharedLocator = {
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies SharedDatabaseScopePhysicalLocator;

const uuids = {
  scopeA: "20000000-0000-4000-8000-000000000001",
  epochA: "20000000-0000-4000-8000-000000000002",
  scopeB: "20000000-0000-4000-8000-000000000003",
  epochB: "20000000-0000-4000-8000-000000000004",
  scopeC: "20000000-0000-4000-8000-000000000005",
  epochC: "20000000-0000-4000-8000-000000000006",
  scopeD: "20000000-0000-4000-8000-000000000007",
  epochD: "20000000-0000-4000-8000-000000000008",
} as const;

type ForbiddenBatchAuthorityField = Extract<
  keyof RunSharedScopeAuthorityBootstrapBatchInput,
  | "scopeId"
  | "epoch"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "lastOutboxSeq"
  | "physicalLocator"
  | "databaseKey"
>;

type ForbiddenRootBootstrapMethod = Extract<
  keyof FlarexPersistence,
  | "bootstrapScopeAuthority"
  | "repairScopeClock"
  | "runScopeAuthorityBootstrap"
  | "verifyScopeAuthorityParity"
>;

type OrdinaryDrizzleCanRunBootstrapTransaction =
  PGliteFlarexPersistence["drizzle"] extends Parameters<
    typeof bootstrapExistingSharedScopeAuthorityInTransaction
  >[0]
    ? true
    : false;

describe("shared scope authority bootstrap", () => {
  it("keeps bootstrap repair authority out of per-call and root persistence APIs", () => {
    expectTypeOf<ForbiddenBatchAuthorityField>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenRootBootstrapMethod>().toEqualTypeOf<never>();
    expectTypeOf<OrdinaryDrizzleCanRunBootstrapTransaction>().toEqualTypeOf<false>();
  });

  it("captures and verifies an empty frontier without writes", async () => {
    const persistence = await migratedPersistence();
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      { physicalLocator: sharedLocator },
    );

    const frontier = await bootstrapper.captureFrontier();

    expect(frontier).toEqual({
      version: SharedScopeAuthorityBootstrapFrontierVersion,
      kind: "empty",
    });
    await expect(
      bootstrapper.runBatch({ frontier, limit: 1 }),
    ).resolves.toEqual({ status: "complete", frontier, items: [] });
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toEqual({
      status: "complete_through_frontier",
      frontier,
      counts: {
        deployments: 0n,
        completePairs: 0n,
        missingScopes: 0n,
        missingClocks: 0n,
        locatorConflicts: 0n,
        orphanClocks: 0n,
      },
    });
  });

  it("rejects limits that cannot produce a bounded advancing page", async () => {
    const persistence = await migratedPersistence();
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      { physicalLocator: sharedLocator },
    );
    const frontier = await bootstrapper.captureFrontier();

    for (const limit of [0, -1, 1.5, 1_001, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(
        bootstrapper.runBatch({ frontier, limit }),
      ).rejects.toBeInstanceOf(
        InvalidSharedScopeAuthorityBootstrapBatchLimitError,
      );
    }
  });

  it("rejects contradictory frontier cursors and permits terminal equality", async () => {
    const persistence = await migratedPersistence();
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      { physicalLocator: sharedLocator },
    );
    const emptyFrontier = await bootstrapper.captureFrontier();

    await expect(
      bootstrapper.runBatch({
        frontier: emptyFrontier,
        after: { deploymentId: "deployment_unexpected" },
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(
      InvalidSharedScopeAuthorityBootstrapFrontierError,
    );
    await insertDeployments(persistence, "deployment_a");
    const boundedFrontier = {
      version: SharedScopeAuthorityBootstrapFrontierVersion,
      kind: "bounded",
      through: { deploymentId: "deployment_a" },
    } as const;
    await expect(
      bootstrapper.runBatch({
        frontier: boundedFrontier,
        after: { deploymentId: "deployment_z" },
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(
      InvalidSharedScopeAuthorityBootstrapFrontierError,
    );
    await expect(
      bootstrapper.runBatch({
        frontier: boundedFrontier,
        after: boundedFrontier.through,
        limit: 1,
      }),
    ).resolves.toEqual({
      status: "complete",
      frontier: boundedFrontier,
      items: [],
    });
  });

  it("faithfully pages deployment IDs that the existing schema permits to be blank", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "", "deployment_after_blank");
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.scopeA,
          uuids.epochA,
          uuids.scopeB,
          uuids.epochB,
        ),
      },
    );
    const frontier = await bootstrapper.captureFrontier();

    const first = await bootstrapper.runBatch({ frontier, limit: 1 });
    expect(first).toMatchObject({
      status: "more",
      items: [{ deployment: { deploymentId: "" } }],
      nextAfter: { deploymentId: "" },
    });
    if (first.status !== "more") {
      throw new Error("Expected the blank deployment ID page to continue.");
    }
    await expect(
      bootstrapper.runBatch({
        frontier,
        after: first.nextAfter,
        limit: 1,
      }),
    ).resolves.toMatchObject({
      status: "complete",
      items: [
        { deployment: { deploymentId: "deployment_after_blank" } },
      ],
    });
  });

  it("uses a lexical frontier and advances only after a whole page succeeds", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "deployment_c", "deployment_a", "deployment_b");
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.scopeA,
          uuids.epochA,
          uuids.scopeB,
          uuids.epochB,
          uuids.scopeC,
          uuids.epochC,
        ),
      },
    );
    const frontier = await bootstrapper.captureFrontier();
    await insertDeployments(persistence, "deployment_z");

    const first = await bootstrapper.runBatch({ frontier, limit: 2 });
    expect(first).toMatchObject({
      status: "more",
      items: [
        {
          status: "created_scope_and_clock",
          deployment: { deploymentId: "deployment_a" },
        },
        {
          status: "created_scope_and_clock",
          deployment: { deploymentId: "deployment_b" },
        },
      ],
      nextAfter: { deploymentId: "deployment_b" },
    });
    if (first.status !== "more") {
      throw new Error("Expected the first bootstrap page to have more rows.");
    }
    const second = await bootstrapper.runBatch({
      frontier,
      after: first.nextAfter,
      limit: 2,
    });
    expect(second).toMatchObject({
      status: "complete",
      items: [
        {
          status: "created_scope_and_clock",
          deployment: { deploymentId: "deployment_c" },
        },
      ],
    });
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "complete_through_frontier",
      counts: { deployments: 3n, completePairs: 3n },
    });
    await expect(
      persistence.getScopeMetadataByDeploymentId("deployment_z"),
    ).resolves.toBeNull();
  });

  it("replays a lost-response page without consuming IDs or replacing authority", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "deployment_replay_a", "deployment_replay_b");
    const firstBootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.scopeA,
          uuids.epochA,
          uuids.scopeB,
          uuids.epochB,
        ),
      },
    );
    const frontier = await firstBootstrapper.captureFrontier();
    const first = await firstBootstrapper.runBatch({ frontier, limit: 2 });
    const authority = first.items.map((item) => ({
      scopeId: item.scope.scopeId,
      epoch: item.clock.epoch,
      scopeCreatedAt: item.scope.createdAt,
      clockUpdatedAt: item.clock.updatedAt,
    }));
    const replayBootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("A page replay must reuse persisted authority.");
        },
      },
    );

    const replay = await replayBootstrapper.runBatch({ frontier, limit: 2 });

    expect(replay.items.map((item) => item.status)).toEqual([
      "already_provisioned",
      "already_provisioned",
    ]);
    expect(
      replay.items.map((item) => ({
        scopeId: item.scope.scopeId,
        epoch: item.clock.epoch,
        scopeCreatedAt: item.scope.createdAt,
        clockUpdatedAt: item.clock.updatedAt,
      })),
    ).toEqual(authority);
  });

  it("repairs only an inventoried missing clock and preserves the winning epoch", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make(`scope_${uuids.scopeA}`);
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_repair_clock",
      projectId: "project_deployment_repair_clock",
    });
    const scope = await persistence.insertScopeMetadata({
      scopeId,
      deploymentId: "deployment_repair_clock",
      physicalLocator: sharedLocator,
    });
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.epochA),
      },
    );
    const frontier = await bootstrapper.captureFrontier();

    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "needs_bootstrap_pass",
      counts: { missingScopes: 0n, missingClocks: 1n },
    });

    const repaired = await bootstrapper.runBatch({ frontier, limit: 1 });

    expect(repaired.items[0]).toMatchObject({
      status: "repaired_missing_clock",
      scope: { scopeId, createdAt: scope.createdAt },
      clock: {
        scopeId,
        storageGeneration: "legacy_v1",
        storageGenerationFence: 1n,
        lastCommitSeq: 0n,
        lastOutboxSeq: 0n,
        epoch: `epoch_${uuids.epochA}`,
      },
    });
    const clock = repaired.items[0]?.clock;
    const replay = createPGliteSharedScopeAuthorityBootstrapper(persistence, {
      physicalLocator: sharedLocator,
      randomUuid: () => {
        throw new Error("A repaired clock must not be regenerated.");
      },
    });
    const replayed = await replay.runBatch({ frontier, limit: 1 });
    expect(replayed.items[0]).toMatchObject({ status: "already_provisioned" });
    expect(replayed.items[0]?.clock).toEqual(clock);
  });

  it("accepts an already advanced valid clock without resetting it", async () => {
    const persistence = await migratedPersistence();
    const provisioner = createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    );
    const created = await provisioner.ensure({
      deploymentId: "deployment_advanced_bootstrap",
      projectId: "project_advanced_bootstrap",
    });
    const advancedAt = new Date("2026-07-15T00:00:00.000Z");
    await persistence.drizzle
      .update(fxSystemScopeClocks)
      .set({
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(9n),
        lastCommitSeq: CommitSeqSchema.make(21n),
        lastOutboxSeq: OutboxSeqSchema.make(34n),
        epoch: ScopeEpochSchema.make("epoch_advanced_bootstrap"),
        updatedAt: advancedAt,
      })
      .where(eq(fxSystemScopeClocks.scopeId, created.scope.scopeId));
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("Existing authority must not generate an ID.");
        },
      },
    );
    const frontier = await bootstrapper.captureFrontier();

    const result = await bootstrapper.runBatch({ frontier, limit: 1 });

    expect(result.items[0]).toMatchObject({
      status: "already_provisioned",
      clock: {
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 9n,
        lastCommitSeq: 21n,
        lastOutboxSeq: 34n,
        epoch: "epoch_advanced_bootstrap",
        updatedAt: advancedAt,
      },
    });
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "complete_through_frontier",
      counts: { completePairs: 1n },
    });
  });

  it("projects typed stored-clock corruption at the bootstrap transaction owner", async () => {
    const persistence = await migratedPersistence();
    const created = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(uuids.scopeA, uuids.epochA),
      },
    ).ensure({
      deploymentId: "deployment_corrupt_bootstrap_clock",
      projectId: "project_corrupt_bootstrap_clock",
    });
    await persistence.exec(`
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_storage_generation_check
    `);
    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation = 'corrupt_generation'
        where scope_id = $1
      `,
      [created.scope.scopeId],
    );
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("Corrupt stored authority must not generate IDs.");
        },
      },
    );
    const frontier = await bootstrapper.captureFrontier();

    await expect(
      bootstrapper.runBatch({ frontier, limit: 1 }),
    ).rejects.toBeInstanceOf(ScopeClockCorruptionError);
  });

  it("leaves completed items committed but returns no cursor when a later item fails", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "deployment_page_a", "deployment_page_b");
    const failing = createPGliteSharedScopeAuthorityBootstrapper(persistence, {
      physicalLocator: sharedLocator,
      randomUuid: uuidSequence(
        uuids.scopeA,
        uuids.epochA,
        uuids.scopeB,
        "invalid-epoch",
      ),
    });
    const frontier = await failing.captureFrontier();

    await expect(
      failing.runBatch({ frontier, limit: 2 }),
    ).rejects.toBeInstanceOf(InvalidGeneratedScopeAuthorityIdError);
    await expect(
      persistence.getScopeMetadataByDeploymentId("deployment_page_a"),
    ).resolves.not.toBeNull();
    await expect(
      persistence.getScopeMetadataByDeploymentId("deployment_page_b"),
    ).resolves.toBeNull();

    const retry = createPGliteSharedScopeAuthorityBootstrapper(persistence, {
      physicalLocator: sharedLocator,
      randomUuid: uuidSequence(uuids.scopeC, uuids.epochC),
    });
    const retried = await retry.runBatch({ frontier, limit: 2 });
    expect(retried).toMatchObject({
      status: "complete",
      items: [
        { status: "already_provisioned" },
        { status: "created_scope_and_clock" },
      ],
    });
  });

  it("does not recreate a deployment that disappeared after inventory", async () => {
    const persistence = await migratedPersistence();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_disappeared",
      projectId: "project_disappeared",
    });
    const expected = await persistence.getDeploymentMetadata(
      "deployment_disappeared",
    );
    if (expected === null) throw new Error("Expected inventoried deployment.");
    await persistence.query(
      "delete from deployments where deployment_id = $1",
      [expected.deploymentId],
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        bootstrapExistingSharedScopeAuthorityInTransaction(
          tx,
          expected,
          sharedLocator,
          uuidSequence(uuids.scopeA, uuids.epochA),
        ),
      ),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "deploymentMissingForBootstrap" },
    });
    await expect(
      persistence.getDeploymentMetadata(expected.deploymentId),
    ).resolves.toBeNull();
  });

  it("rejects a deployment whose persisted creation identity changed", async () => {
    const persistence = await migratedPersistence();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_replaced",
      projectId: "project_replaced",
    });
    const expected = await persistence.getDeploymentMetadata(
      "deployment_replaced",
    );
    if (expected === null) throw new Error("Expected inventoried deployment.");
    await persistence.query(
      "delete from deployments where deployment_id = $1",
      [expected.deploymentId],
    );
    await persistence.query(
      `
        insert into deployments (deployment_id, project_id, created_at)
        values ($1, $2, $3::timestamptz)
      `,
      [
        expected.deploymentId,
        expected.projectId,
        "2030-01-01T00:00:00.000Z",
      ],
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        bootstrapExistingSharedScopeAuthorityInTransaction(
          tx,
          expected,
          sharedLocator,
          uuidSequence(uuids.scopeA, uuids.epochA),
        ),
      ),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "deploymentReplacedDuringBootstrap" },
    });
    await expect(
      persistence.getScopeMetadataByDeploymentId(expected.deploymentId),
    ).resolves.toBeNull();
  });

  it("rejects a project identity change without creating authority", async () => {
    const persistence = await migratedPersistence();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_project_changed",
      projectId: "project_original",
    });
    const expected = await persistence.getDeploymentMetadata(
      "deployment_project_changed",
    );
    if (expected === null) throw new Error("Expected inventoried deployment.");
    await persistence.query(
      "update deployments set project_id = $2 where deployment_id = $1",
      [expected.deploymentId, "project_replaced"],
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        bootstrapExistingSharedScopeAuthorityInTransaction(
          tx,
          expected,
          sharedLocator,
          uuidSequence(uuids.scopeA, uuids.epochA),
        ),
      ),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "projectMismatch" },
    });
    await expect(
      persistence.getScopeMetadataByDeploymentId(expected.deploymentId),
    ).resolves.toBeNull();
  });

  it("stops on a locator conflict without adding or repairing a clock", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make(`scope_${uuids.scopeA}`);
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_locator_conflict",
      projectId: "project_locator_conflict",
    });
    await persistence.insertScopeMetadata({
      scopeId,
      deploymentId: "deployment_locator_conflict",
      physicalLocator: { ...sharedLocator, databaseKey: "secondary" },
    });
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => {
          throw new Error("A locator conflict must not generate authority.");
        },
      },
    );
    const frontier = await bootstrapper.captureFrontier();

    await expect(
      bootstrapper.runBatch({ frontier, limit: 1 }),
    ).rejects.toMatchObject({
      name: "SharedScopeAuthorityConflictError",
      conflict: { reason: "physicalLocatorMismatch" },
    });
    await expect(persistence.getScopeClock(scopeId)).resolves.toBeNull();
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "blocked",
      counts: { locatorConflicts: 1n },
    });
  });

  it("reports missing and orphan authority independently even when totals cancel", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "deployment_missing_clock_parity");
    await persistence.insertScopeMetadata({
      scopeId: ScopeIdSchema.make(`scope_${uuids.scopeB}`),
      deploymentId: "deployment_missing_clock_parity",
      physicalLocator: sharedLocator,
    });
    await insertOrphanClock(
      persistence,
      ScopeIdSchema.make(`scope_${uuids.scopeA}`),
      ScopeEpochSchema.make(`epoch_${uuids.epochA}`),
    );
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      { physicalLocator: sharedLocator },
    );
    const frontier = await bootstrapper.captureFrontier();

    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toEqual({
      status: "blocked",
      frontier,
      counts: {
        deployments: 1n,
        completePairs: 0n,
        missingScopes: 0n,
        missingClocks: 1n,
        locatorConflicts: 0n,
        orphanClocks: 1n,
      },
    });
  });

  it("detects a deployment inserted behind an advanced cursor and repairs it on a replay", async () => {
    const persistence = await migratedPersistence();
    await insertDeployments(persistence, "deployment_frontier_b", "deployment_frontier_d");
    const bootstrapper = createPGliteSharedScopeAuthorityBootstrapper(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          uuids.scopeA,
          uuids.epochA,
          uuids.scopeB,
          uuids.epochB,
          uuids.scopeC,
          uuids.epochC,
        ),
      },
    );
    const frontier = await bootstrapper.captureFrontier();
    const first = await bootstrapper.runBatch({ frontier, limit: 1 });
    if (first.status !== "more") {
      throw new Error("Expected a continuation after the first frontier item.");
    }
    await insertDeployments(persistence, "deployment_frontier_a");
    const second = await bootstrapper.runBatch({
      frontier,
      after: first.nextAfter,
      limit: 1,
    });
    expect(second.status).toBe("complete");
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "needs_bootstrap_pass",
      counts: { deployments: 3n, completePairs: 2n, missingScopes: 1n },
    });

    const replay = await bootstrapper.runBatch({ frontier, limit: 3 });
    expect(replay.items.map((item) => item.status)).toEqual([
      "created_scope_and_clock",
      "already_provisioned",
      "already_provisioned",
    ]);
    await expect(bootstrapper.verifyFrontier(frontier)).resolves.toMatchObject({
      status: "complete_through_frontier",
      counts: { deployments: 3n, completePairs: 3n },
    });
  });
});

async function migratedPersistence(): Promise<PGliteFlarexPersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertDeployments(
  persistence: PGliteFlarexPersistence,
  ...deploymentIds: readonly string[]
): Promise<void> {
  for (const deploymentId of deploymentIds) {
    await persistence.insertDeploymentMetadata({
      deploymentId,
      projectId: `project_${deploymentId}`,
    });
  }
}

async function insertOrphanClock(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ScopeIdSchema.make>,
  epoch: ReturnType<typeof ScopeEpochSchema.make>,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        storage_generation_fence,
        last_commit_seq,
        last_outbox_seq,
        epoch
      ) values ($1, 'legacy_v1', 1, 0, 0, $2)
    `,
    [scopeId, epoch],
  );
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("UUID test sequence was exhausted.");
    }
    index += 1;
    return value;
  };
}
