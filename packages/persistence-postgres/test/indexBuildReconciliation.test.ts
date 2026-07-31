import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  createLocatedIndexBuildReconciliationTargetV1,
  IndexBuildReconciliationIntegrationV1Error,
  IndexBuildReconciliationStaleAuthorityV1Error,
  reconcilePublishedIndexBuildsV1Effect,
  type ReconcilePublishedIndexBuildsV1Error,
  type ReconcilePublishedIndexBuildsV1Result,
} from "../src/indexBuildReconciliation";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import { IndexBuildStateCorruptionError } from "../src/indexBuildStates";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "../src/transactionSessionActivation";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describe("S03-D3 durable index-build reconciliation", () => {
  it("keeps one precise private Effect contract and returns absent work", async () => {
    expectTypeOf<ReturnType<typeof reconcilePublishedIndexBuildsV1Effect>>()
      .toEqualTypeOf<Effect.Effect<
        ReconcilePublishedIndexBuildsV1Result,
        ReconcilePublishedIndexBuildsV1Error
      >>();
    const fixture = await baseFixture("absent");
    const result = await reconcile(fixture, "schema_absent");
    expect(result).toEqual({
      status: "absent",
      deploymentId: fixture.deploymentId,
      schemaVersionId: "schema_absent",
      reason: "schemaVersionNotPublished",
    });

    await fixture.persistence.publishAppSchemaV1({
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [],
      indexes: [],
    });
    await expect(reconcile(fixture, fixture.schemaVersionId)).resolves.toEqual({
      status: "absent",
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
      reason: "noPhysicalDefinitions",
    });
  });

  it("creates every exact requirement, replays, repairs partial state, and preserves progressed rows", async () => {
    const fixture = await publishedFixture("replay");
    const created = await reconcile(fixture, fixture.schemaVersionId);
    expect(created).toMatchObject({
      status: "reconciled",
      disposition: "created",
      createdCount: 2,
      replayedCount: 0,
      redeclaredCount: 0,
      definitionIds: [1, 2],
    });

    const replayed = await reconcile(fixture, fixture.schemaVersionId);
    expect(replayed).toMatchObject({
      disposition: "replayed",
      createdCount: 0,
      replayedCount: 2,
    });

    await fixture.persistence.query(
      `delete from fx_system_index_build_state
       where scope_id = $1 and index_definition_id = 2`,
      [fixture.scopeId],
    );
    const repaired = await reconcile(fixture, fixture.schemaVersionId);
    expect(repaired).toMatchObject({
      disposition: "completed_partial",
      createdCount: 1,
      replayedCount: 1,
    });

    await fixture.persistence.query(
      `update fx_system_index_build_state
       set lifecycle = 'building', attempt_fence = 7
       where scope_id = $1 and index_definition_id = 1`,
      [fixture.scopeId],
    );
    await reconcile(fixture, fixture.schemaVersionId);
    const rows = await buildRows(fixture.persistence, fixture.scopeId);
    expect(rows).toMatchObject([
      { index_definition_id: 1, lifecycle: "building", attempt_fence: "7" },
      { index_definition_id: 2, lifecycle: "declared", attempt_fence: "1" },
    ]);
  });

  it("re-declares stale rows at the current frontier and monotonically fences old attempts", async () => {
    const fixture = await publishedFixture("stale");
    await reconcile(fixture, fixture.schemaVersionId);
    await fixture.persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = 2, epoch = $2, last_commit_seq = 9
       where scope_id = $1`,
      [fixture.scopeId, "epoch_reconcile_stale_2"],
    );

    const result = await reconcile(fixture, fixture.schemaVersionId);
    expect(result).toMatchObject({
      disposition: "redeployed",
      redeclaredCount: 2,
      storageGenerationFence: 2n,
      epoch: "epoch_reconcile_stale_2",
    });
    const rows = await buildRows(fixture.persistence, fixture.scopeId);
    expect(rows).toMatchObject([
      {
        storage_generation_fence: "2",
        epoch: "epoch_reconcile_stale_2",
        start_commit_seq: "9",
        lifecycle: "declared",
        attempt_fence: "2",
      },
      {
        storage_generation_fence: "2",
        epoch: "epoch_reconcile_stale_2",
        start_commit_seq: "9",
        lifecycle: "declared",
        attempt_fence: "2",
      },
    ]);
  });

  it("rejects a build frontier ahead of the locked scope clock as corruption", async () => {
    const fixture = await publishedFixture("future_frontier");
    await reconcile(fixture, fixture.schemaVersionId);
    await fixture.persistence.query(
      `update fx_system_index_build_state
       set start_commit_seq = 1
       where scope_id = $1 and index_definition_id = 1`,
      [fixture.scopeId],
    );

    const failure = await runEffectFailure(
      reconcilePublishedIndexBuildsV1Effect(
        ports(fixture),
        input(fixture, fixture.schemaVersionId),
      ),
    );
    expect(failure).toBeInstanceOf(IndexBuildStateCorruptionError);
    expect(failure).toMatchObject({
      scopeId: fixture.scopeId,
      indexDefinitionId: 1,
    });
  });

  it("rolls back every S03-D3 write and then deterministically resumes", async () => {
    const fixture = await publishedFixture("rollback");
    const failure = await runEffectFailure(
      reconcilePublishedIndexBuildsV1Effect(
        ports(fixture),
        input(fixture, fixture.schemaVersionId),
        {
          faultAfter: () => {
            throw new Error("injected S03-D3 write fault");
          },
        },
      ),
    );
    expect(failure).toBeInstanceOf(IndexBuildReconciliationIntegrationV1Error);
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toEqual([]);

    const resumed = await reconcile(fixture, fixture.schemaVersionId);
    expect(resumed).toMatchObject({ disposition: "created", createdCount: 2 });
  });

  it("serializes concurrent reconcilers and keeps one row per required definition", async () => {
    const fixture = await publishedFixture("concurrent");
    const results = await Promise.all(Array.from(
      { length: 8 },
      () => reconcile(fixture, fixture.schemaVersionId),
    ));
    expect(results.filter((result) =>
      result.status === "reconciled" && result.disposition === "created"
    )).toHaveLength(1);
    expect(results.filter((result) =>
      result.status === "reconciled" && result.disposition === "replayed"
    )).toHaveLength(7);
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toHaveLength(2);
  });

  it("observes a committed-but-lost response without applying the build set twice", async () => {
    const fixture = await publishedFixture("uncertain");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let calls = 0;
    const target = createLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      async (work) => {
        const value = await baseRunner(work);
        calls += 1;
        if (calls === 1) {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost commit response"),
          }));
        }
        return value;
      },
    );
    const result = await runEffect(reconcilePublishedIndexBuildsV1Effect(
      ports(fixture, target),
      input(fixture, fixture.schemaVersionId),
    ));
    expect(result).toMatchObject({
      disposition: "replayed_after_uncertain_completion",
      createdCount: 0,
      replayedCount: 2,
    });
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toHaveLength(2);
  });

  it("fails stale when the located scope clock changes before the locked transaction", async () => {
    const fixture = await publishedFixture("clock_race");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let changed = false;
    const target = createLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      async (work) => {
        if (!changed) {
          changed = true;
          await fixture.persistence.query(
            `update fx_system_scope_clock
             set storage_generation_fence = 2
             where scope_id = $1`,
            [fixture.scopeId],
          );
        }
        return baseRunner(work);
      },
    );
    const failure = await runEffectFailure(
      reconcilePublishedIndexBuildsV1Effect(
        ports(fixture, target),
        input(fixture, fixture.schemaVersionId),
      ),
    );
    expect(failure).toEqual(new IndexBuildReconciliationStaleAuthorityV1Error({
      scopeId: fixture.scopeId,
      reason: "storageGenerationFence",
    }));
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toEqual([]);
  });

  it("rejects a legacy-generation clock instead of declaring replacement builds", async () => {
    const fixture = await publishedFixture("legacy_generation");
    await fixture.persistence.query(
      `update fx_system_scope_clock set storage_generation = 'legacy_v1'
       where scope_id = $1`,
      [fixture.scopeId],
    );
    const failure = await runEffectFailure(
      reconcilePublishedIndexBuildsV1Effect(
        ports(fixture),
        input(fixture, fixture.schemaVersionId),
      ),
    );
    expect(failure).toEqual(new IndexBuildReconciliationStaleAuthorityV1Error({
      scopeId: fixture.scopeId,
      reason: "storageGeneration",
    }));
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toEqual([]);
  });

  it("settles the short database transaction before exposing interruption", async () => {
    const fixture = await publishedFixture("interruption");
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let announceCompleted: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      announceCompleted = resolve;
    });
    let releaseCommit: (() => void) | undefined;
    const commitRelease = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const target = createLocatedIndexBuildReconciliationTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      (work) => baseRunner(async (tx) => {
        const value = await work(tx);
        announceCompleted?.();
        await commitRelease;
        return value;
      }),
    );
    const fiber = Effect.runFork(reconcilePublishedIndexBuildsV1Effect(
      ports(fixture, target),
      input(fixture, fixture.schemaVersionId),
    ));
    await completed;
    const interruption = Effect.runPromise(Fiber.interrupt(fiber));
    releaseCommit?.();
    await interruption;
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(await buildRows(fixture.persistence, fixture.scopeId)).toHaveLength(2);
    await expect(reconcile(fixture, fixture.schemaVersionId)).resolves
      .toMatchObject({ disposition: "replayed", replayedCount: 2 });
  });

  it.each(["schema_per_scope", "database_per_scope"] as const)(
    "uses the authenticated %s locator only as target identity",
    async (kind) => {
      const locator = Object.freeze({
        kind,
        databaseKey: `${kind}_logical_target`,
        schemaName: `${kind}_schema`,
      } as const satisfies ScopePhysicalLocator);
      const fixture = await baseFixture(`topology_${kind}`, locator);
      await fixture.persistence.publishAppSchemaV1({
        deploymentId: fixture.deploymentId,
        schemaVersionId: fixture.schemaVersionId,
        version: CatalogSchemaVersionSchema.make(1),
        tables: [appTable("users")],
        indexes: [],
      });
      const target = createLocatedIndexBuildReconciliationTargetV1(
        fixture.persistence.drizzle,
        locator,
      );
      let resolved: ScopePhysicalLocator | undefined;
      const result = await runEffect(reconcilePublishedIndexBuildsV1Effect({
        controlDb: fixture.persistence.drizzle,
        authority: {
          scopeMetadata: {
            getScopeMetadataByDeploymentId: (deploymentId) =>
              fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
          },
          provisioningReceipts: {
            getScopeAuthorityProvisioningReceipt: async () => ({
              scopeId: fixture.scopeId,
              protocolVersion: "split_scope_authority_v1",
              physicalLocator: locator,
              initialEpoch: ScopeEpochSchema.make(
                `epoch_reconcile_topology_${kind}`,
              ),
              state: "ready",
              reservedAt: new Date(0),
              readyAt: new Date(1),
            }),
          },
          scopeClockTargets: {
            resolve: async (physicalLocator) => {
              resolved = physicalLocator;
              return target;
            },
          },
        },
      }, input(fixture, fixture.schemaVersionId)));
      expect(result).toMatchObject({ disposition: "created", createdCount: 1 });
      expect(resolved).toEqual(locator);
    },
  );
});

interface Fixture {
  readonly persistence: PGliteFlarexPersistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly target: ReturnType<
    typeof createPGliteLocatedIndexBuildReconciliationTargetV1
  >;
}

async function baseFixture(
  suffix: string,
  locator: ScopePhysicalLocator = LOCATOR,
): Promise<Fixture> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  const deploymentId = `deployment_reconcile_${suffix}`;
  const scopeId = ScopeIdSchema.make(`scope_reconcile_${suffix}`);
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_reconcile_${suffix}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_reconcile_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: locator,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, ScopeEpochSchema.make(`epoch_reconcile_${suffix}`)],
  );
  return {
    persistence,
    deploymentId,
    scopeId,
    schemaVersionId,
    target: createPGliteLocatedIndexBuildReconciliationTargetV1(
      persistence,
      locator,
    ),
  };
}

async function publishedFixture(suffix: string): Promise<Fixture> {
  const fixture = await baseFixture(suffix);
  await fixture.persistence.publishAppSchemaV1({
    deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [appIndex("users", "byEmail", ["email"])],
  });
  return fixture;
}

function ports(
  fixture: Fixture,
  target = fixture.target,
) {
  return {
    controlDb: fixture.persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: {
        resolve: async () => target,
      },
    },
  } as const;
}

function input(fixture: Fixture, schemaVersionId: string) {
  return {
    deploymentId: fixture.deploymentId,
    schemaVersionId: CatalogSchemaVersionIdSchema.make(schemaVersionId),
  };
}

function reconcile(fixture: Fixture, schemaVersionId: string) {
  return runEffect(reconcilePublishedIndexBuildsV1Effect(
    ports(fixture),
    input(fixture, schemaVersionId),
  ));
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}

function appIndex(
  tableLogicalName: string,
  descriptor: string,
  fields: ReadonlyArray<string>,
): SchemaManifestAppIndexDeclarationInputV1 {
  return { tableLogicalName, descriptor, fields };
}

function buildRows(
  persistence: PGliteFlarexPersistence,
  scopeId: string,
) {
  return persistence.query<{
    index_definition_id: number;
    storage_generation_fence: string;
    epoch: string;
    start_commit_seq: string;
    lifecycle: string;
    attempt_fence: string;
  }>(
    `select index_definition_id, storage_generation_fence::text,
            epoch, start_commit_seq::text, lifecycle, attempt_fence::text
       from fx_system_index_build_state
      where scope_id = $1
      order by index_definition_id`,
    [scopeId],
  ).then((result) => result.rows);
}
