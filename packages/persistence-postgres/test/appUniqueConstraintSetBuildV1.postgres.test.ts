import { setTimeout as delay } from "node:timers/promises";

import type { PoolClient } from "pg";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from
  "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
} from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from
  "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  AppUniqueConstraintSetBuildReclamationError,
  AppUniqueConstraintSetBuildStaleAuthorityV1Error,
  MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  createAppUniqueConstraintSetEligibilityPortV1,
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  loadAppUniqueConstraintSetEligibilityV1Effect,
  reclaimSupersededAppUniqueConstraintSetBuildEffect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
  type ReclaimSupersededAppUniqueConstraintSetBuildResult,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import { appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult } from
  "../src/appRows";
import {
  createPostgresLocatedAppUniqueConstraintSetBuildTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { createPostgresLocatedReadCommittedTransactionRunnerV1 } from
  "../src/postgresLocatedReadCommitted";
import { LocatedReadCommittedTransactionFailureV1 } from
  "../src/transactionSessionAttemptKernel";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describePostgres("real PostgreSQL C08-B1 unique-set build foundation", () => {
  it("bounds inherited claim draining and recovers rollback plus a lost response", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
    const fixture = await fixtureFor(persistence);
    await closeFixtureSet(fixture);
    for (let n = 1; n <= 17; n += 1) await appendLiveRow(fixture, n.toString(16).padStart(32, "0"), `owner${n}@example.com`);
    await persistence.query("update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1", [fixture.scopeId]);
    await reconcile(fixture);
    await advanceUntilEnabled(fixture);
    const claims = await persistence.query(`select *, xmin::text tuple_version from fx_app_unique_key order by row_id`);
    expect(claims.rows).toHaveLength(17);
    // Models 0097 replacing progress while preserving inherited stable claims.
    await persistence.query("delete from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId]);
    await reconcile(fixture);
    await advanceBackfill(fixture, 16);
    const before = await persistence.query("select * from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId]);
    const buildPorts = fixture.ports;
    const buildInput = fixture.input;
    await expect(runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(buildPorts, { ...buildInput, pageSize: 1 }, {
      faultAfter: point => { if (point === "afterInitialClaimDrain") throw new Error("rollback initial drain"); },
    }))).rejects.toMatchObject({ _tag: "AppUniqueConstraintSetBuildIntegrationV1Error" });
    expect((await persistence.query("select * from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId])).rows).toEqual(before.rows);
    expect((await persistence.query(`select *, xmin::text tuple_version from fx_app_unique_key order by row_id`)).rows).toEqual(claims.rows);
    const baseRunner = createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool);
    let drained = false;
    const target = createLocatedAppUniqueConstraintSetBuildTargetV1(persistence.drizzle, LOCATOR, async work => {
      const value = await baseRunner(work);
      if (!drained) {
        drained = true;
        throw new LocatedReadCommittedTransactionFailureV1({ kind: "decisionUncertain", settlementCause: new Error("lost drain response") });
      }
      return value;
    });
    await expect(runEffect(advanceAppUniqueConstraintSetBackfillV1Effect({ ...buildPorts, authority: { ...buildPorts.authority, scopeClockTargets: { resolve: async () => target } } }, { ...buildInput, pageSize: 1 })))
      .rejects.toMatchObject({ _tag: "AppUniqueConstraintSetBuildDecisionUncertainV1Error" });
    expect((await persistence.query("select * from fx_app_unique_key")).rows).toHaveLength(1);
    expect((await persistence.query("select lifecycle, covered_through_commit_seq from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId])).rows)
      .toEqual([{ lifecycle: "building", covered_through_commit_seq: null }]);
    await expect(advanceBackfill(fixture, 16)).resolves.toMatchObject({ lifecycle: "backfilling" });
    expect((await persistence.query("select * from fx_app_unique_key")).rows).toHaveLength(0);
    await advanceUntilEnabled(fixture);
    const rebuilt = await persistence.query("select constraint_id, encoded_key, row_id from fx_app_unique_key order by row_id");
    expect(rebuilt.rows).toEqual(claims.rows.map(({ constraint_id, encoded_key, row_id }) => ({ constraint_id, encoded_key, row_id })));
    // Repeated reconciliation must not accumulate an unrelated feed backlog.
    for (const seq of [102, 203]) {
      await setClockCommit(fixture, BigInt(seq));
      await expect(advanceBackfill(fixture, 16)).resolves.toMatchObject({ lifecycle: "enabled", status: "replayed" });
      expect((await persistence.query<{ coverage: string }>("select covered_through_commit_seq::text coverage from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId])).rows).toEqual([{ coverage: String(seq) }]);
    }
    await appendLiveRow(fixture, "1".padStart(32, "0"), "changed@example.com", 204n, 1n);
    await setClockCommit(fixture, 204n);
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({ lifecycle: "enabled" });
    expect((await persistence.query("select encoded_key from fx_app_unique_key order by row_id")).rows[0]).not.toEqual({ encoded_key: rebuilt.rows[0]?.encoded_key });
    expect((await persistence.query("select covered_through_commit_seq::text coverage from fx_system_unique_constraint_build where scope_id = $1", [fixture.scopeId])).rows).toEqual([{ coverage: "204" }]);

    });
  }, 120_000);

  it("serializes closure/build replay and proves rollback plus stale redeclaration", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const version = await persistence.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
        persistence.drizzle,
        fixture.input,
      ));
      const closures = await Promise.all(Array.from({ length: 8 }, () =>
        persistence.drizzle.transaction((tx) => runEffect(
          closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
        ))
      ));
      expect(closures.filter((value) => value.status === "closed")).toHaveLength(1);
      expect(closures.filter((value) => value.status === "replayed")).toHaveLength(7);

      const builds = await Promise.all(Array.from(
        { length: 12 },
        () => reconcile(fixture),
      ));
      expect(builds.filter((value) =>
        value.status === "reconciled" && value.disposition === "created"
      )).toHaveLength(1);
      expect(builds.filter((value) =>
        value.status === "reconciled" && value.disposition === "replayed"
      )).toHaveLength(11);

      await persistence.query(
        "delete from fx_system_unique_constraint_build where scope_id = $1",
        [fixture.scopeId],
      );
      const failure = await runEffectFailure(
        reconcileAppUniqueConstraintSetBuildV1Effect(
          fixture.ports,
          fixture.input,
          { faultAfter: () => { throw new Error("postgres unique build rollback"); } },
        ),
      );
      expect(failure).toBeInstanceOf(
        AppUniqueConstraintSetBuildIntegrationV1Error,
      );
      expect(await buildCount(persistence, fixture.scopeId)).toBe(0);

      await expect(reconcile(fixture)).resolves.toMatchObject({
        disposition: "created",
        definitionBuilds: [{startCommitSeq: 0n,
        attemptFence: 1n}],
      });
      await persistence.query(
        `update fx_system_scope_clock
            set storage_generation_fence = 2, epoch = $2, last_commit_seq = 19
          where scope_id = $1`,
        [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_set_pg_2")],
      );
      await expect(reconcile(fixture)).resolves.toMatchObject({
        disposition: "redeclared",
        definitionBuilds: [{startCommitSeq: 19n,
        attemptFence: 2n}],
      });
    });
  }, 120_000);

  it("serializes concurrent bounded backfill pages and publishes exact current claims", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const eligibility = createAppUniqueConstraintSetEligibilityPortV1(
        fixture.ports,
        createAppUniqueConstraintDefinitionPortV1(persistence.drizzle),
      );
      await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
        eligibility,
        { ...fixture.input, scopeId: fixture.scopeId },
      ))).resolves.toMatchObject({
        status: "not_ready",
        reason: "setNotClosed",
        blocksAllTables: true,
        tableIds: [],
      });
      const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
        persistence.drizzle,
        fixture.input,
      ));
      await persistence.drizzle.transaction((tx) => runEffect(
        closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
      ));
      await appendLiveRow(fixture, "73000000000040008000000000000001", "a@example.com");
      await appendLiveRow(fixture, "73000000000040008000000000000002", "b@example.com");
      await persistence.query(
        "update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1",
        [fixture.scopeId],
      );
      await reconcile(fixture);
      await advanceBackfill(fixture, 1);
      await advanceBackfill(fixture, 1);
      const settlements = await Promise.all(Array.from(
        { length: 4 },
        () => advanceBackfill(fixture, 1),
      ));
      expect(settlements.some((value) => value.claimed === 1)).toBe(true);
      expect(settlements.filter((value) =>
        value.lifecycle === "validating"
      )).toHaveLength(2);
      expect(settlements.filter((value) =>
        value.lifecycle === "enabled"
      )).toHaveLength(1);
      const build = await persistence.query<{ lifecycle: string }>(
        `select lifecycle from fx_system_unique_constraint_build
          where scope_id = $1 and unique_constraint_definition_id in (select unique_constraint_definition_id from fx_control_schema_version_unique_constraint_binding where schema_version_id = $2)`,
        [fixture.scopeId, fixture.schemaVersionId],
      );
      expect(build.rows).toEqual([{ lifecycle: "enabled" }]);
      await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
        eligibility,
        { ...fixture.input, scopeId: fixture.scopeId },
      ))).resolves.toMatchObject({
        status: "eligible",
        evidence: {
          definitionCount: 1,
          tableIds: [fixture.tableId],
          storageGenerationFence: 1n,
        },
      });
      const claims = await persistence.query<{
        row_id_hex: string;
        encoded_key_hex: string;
      }>(
        `select encode(row_id, 'hex') row_id_hex, encode(encoded_key, 'hex') encoded_key_hex
           from fx_app_unique_key order by row_id asc`,
      );
      expect(claims.rows).toMatchObject([
        { row_id_hex: "73000000000040008000000000000001" },
        { row_id_hex: "73000000000040008000000000000002" },
      ]);
    });
  }, 120_000);

  it("serializes exact workspace reclamation, replay, and rollback", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const prepared = await runEffect(
        prepareAppUniqueConstraintSetClosureV1Effect(
          persistence.drizzle,
          fixture.input,
        ),
      );
      await persistence.drizzle.transaction(tx => runEffect(
        closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
      ));
      const port = createAppUniqueConstraintSetEligibilityPortV1(
        fixture.ports,
        createAppUniqueConstraintDefinitionPortV1(persistence.drizzle),
      );
      for (const lifecycle of [
        "declared",
        "building",
        "backfilling",
        "validating",
      ] as const) {
        await reconcile(fixture);
        await persistence.query(
          `update fx_system_unique_constraint_build
              set lifecycle = $3, cursor_row_id = null
            where scope_id = $1 and unique_constraint_definition_id in (select unique_constraint_definition_id from fx_control_schema_version_unique_constraint_binding where schema_version_id = $2)`,
          [fixture.scopeId, fixture.schemaVersionId, lifecycle],
        );
        await expect(runEffect(
          reclaimSupersededAppUniqueConstraintSetBuildEffect(
            port,
            fixture.input,
          ),
        )).resolves.toMatchObject({ disposition: "deleted", deletedDefinitionIds: [1] });
      }

      await reconcile(fixture);
      await persistence.query(
        `update fx_system_unique_constraint_build set lifecycle = 'enabled', covered_through_commit_seq = 0
          where scope_id = $1 and unique_constraint_definition_id in (select unique_constraint_definition_id from fx_control_schema_version_unique_constraint_binding where schema_version_id = $2)`,
        [fixture.scopeId, fixture.schemaVersionId],
      );
      await expect(runEffect(reclaimSupersededAppUniqueConstraintSetBuildEffect(port, fixture.input))).resolves.toMatchObject({disposition: "retained", retainedDefinitionIds: [1]});
      await persistence.query(
        "delete from fx_system_unique_constraint_build where scope_id = $1",
        [fixture.scopeId],
      );

      await reconcile(fixture);
      await persistence.query(
        `update fx_system_scope_clock
            set storage_generation_fence = 2, epoch = $2, last_commit_seq = 7
          where scope_id = $1`,
        [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_set_pg_stale")],
      );
      const staleFailure = await runEffectFailure(
        reclaimSupersededAppUniqueConstraintSetBuildEffect(
          port,
          fixture.input,
        ),
      );
      expect(staleFailure).toBeInstanceOf(
        AppUniqueConstraintSetBuildStaleAuthorityV1Error,
      );
      expect(await buildCount(persistence, fixture.scopeId)).toBe(1);
      await persistence.query(
        `update fx_system_scope_clock
            set storage_generation_fence = 1, epoch = $2, last_commit_seq = 0
          where scope_id = $1`,
        [fixture.scopeId, fixture.epoch],
      );
      await runEffect(reclaimSupersededAppUniqueConstraintSetBuildEffect(
        port,
        fixture.input,
      ));

      await reconcile(fixture);
      const reclaimed = await Promise.all(Array.from({ length: 8 }, () =>
        runEffect(reclaimSupersededAppUniqueConstraintSetBuildEffect(
          port,
          fixture.input,
        ))
      ));
      expect(reclaimed.filter(result => result.disposition === "deleted"))
        .toHaveLength(1);
      expect(reclaimed.filter(result => result.disposition === "already_absent"))
        .toHaveLength(7);
      expect(await buildCount(persistence, fixture.scopeId)).toBe(0);

      await reconcile(fixture);
      const held = await acquireScopeClockLock(persistence, fixture.scopeId);
      let concurrentReclamation:
        Promise<ReclaimSupersededAppUniqueConstraintSetBuildResult> | undefined;
      let concurrentReconciliation:
        ReturnType<typeof reconcile> | undefined;
      let released = false;
      try {
        concurrentReclamation = runEffect(
          reclaimSupersededAppUniqueConstraintSetBuildEffect(
            port,
            fixture.input,
          ),
        );
        concurrentReconciliation = reconcile(fixture);
        await waitForBlockedScopeClockOperations(
          persistence,
          held.blockerPid,
          2,
        );
        await held.client.query("commit");
        released = true;
        const [reclamation, reconciliation] = await Promise.all([
          concurrentReclamation,
          concurrentReconciliation,
        ]);
        expect(reclamation.disposition).toBe("deleted");
        expect(reconciliation).toMatchObject({
          status: "reconciled",
        });
        if (await buildCount(persistence, fixture.scopeId) === 0) {
          await reconcile(fixture);
        }
      } finally {
        if (!released) await held.client.query("rollback").catch(() => undefined);
        held.client.release();
        await Promise.allSettled([
          concurrentReclamation,
          concurrentReconciliation,
        ].filter(value => value !== undefined));
      }

      const failure = await runEffectFailure(
        reclaimSupersededAppUniqueConstraintSetBuildEffect(
          port,
          fixture.input,
          {
            faultAfter: (point) => {
              if (point === "afterWorkspaceDelete") {
                throw new Error("postgres workspace reclamation rollback");
              }
            },
          },
        ),
      );
      expect(failure).toBeInstanceOf(
        AppUniqueConstraintSetBuildIntegrationV1Error,
      );
      expect(await buildCount(persistence, fixture.scopeId)).toBe(1);
      await expect(runEffect(
        reclaimSupersededAppUniqueConstraintSetBuildEffect(
          port,
          fixture.input,
        ),
      )).resolves.toMatchObject({ disposition: "deleted" });
      expect(await buildCount(persistence, fixture.scopeId)).toBe(0);
    });
  }, 120_000);

  it("recovers uncertainty and reuses the exact physical-definition directory slot", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      await closeFixtureSet(fixture);
      await reconcile(fixture);
      const baseRunner = createPostgresLocatedReadCommittedTransactionRunnerV1(
        persistence.pool,
      );
      let injected = false;
      let transactionCount = 0;
      const uncertainTarget = createLocatedAppUniqueConstraintSetBuildTargetV1(
        persistence.drizzle,
        LOCATOR,
        async work => {
          const result = await baseRunner(work);
          transactionCount += 1;
          if (!injected && transactionCount === 2) {
            injected = true;
            throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
              kind: "decisionUncertain",
              settlementCause: new Error("lost PostgreSQL reclamation response"),
            }));
          }
          return result;
        },
      );
      const uncertainPort = createAppUniqueConstraintSetEligibilityPortV1({
        ...fixture.ports,
        authority: {
          ...fixture.ports.authority,
          scopeClockTargets: { resolve: async () => uncertainTarget },
        },
      }, createAppUniqueConstraintDefinitionPortV1(persistence.drizzle));
      await expect(runEffect(
        reclaimSupersededAppUniqueConstraintSetBuildEffect(
          uncertainPort,
          fixture.input,
        ),
      )).resolves.toMatchObject({
        disposition: "replayedAfterUncertainCompletion",
      });
      expect(injected).toBe(true);

      await reconcile(fixture);
      await persistence.query(`insert into fx_system_unique_constraint_build (scope_id, unique_constraint_definition_id, storage_generation, storage_generation_fence, epoch, start_commit_seq, lifecycle, covered_through_commit_seq, attempt_fence)
        select $1, id, 'flarexdb_v1', 1, $2, 0, 'enabled', 0, 1 from generate_series(2, $3::int) id`, [fixture.scopeId, fixture.epoch, MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE]);
      expect(await buildCount(persistence, fixture.scopeId)).toBe(
        MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE,
      );
      const port = createAppUniqueConstraintSetEligibilityPortV1(
        fixture.ports,
        createAppUniqueConstraintDefinitionPortV1(persistence.drizzle),
      );
      await runEffect(reclaimSupersededAppUniqueConstraintSetBuildEffect(
        port,
        fixture.input,
      ));
      expect(await buildCount(persistence, fixture.scopeId)).toBe(
        MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE - 1,
      );
      await expect(reconcile(fixture)).resolves.toMatchObject({
        disposition: "created",
      });
      expect(await buildCount(persistence, fixture.scopeId)).toBe(
        MAX_APP_UNIQUE_CONSTRAINT_BUILDS_PER_SCOPE,
      );
    });
  }, 120_000);

  it("rebuilds to enabled from retained claims without duplication", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      await closeFixtureSet(fixture);
      await appendLiveRow(
        fixture,
        "73000000000040008000000000000021",
        "retained@example.com",
      );
      await persistence.query(
        "update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1",
        [fixture.scopeId],
      );
      await reconcile(fixture);
      await advanceBackfill(fixture, 1);
      await advanceBackfill(fixture, 1);
      await advanceBackfill(fixture, 1);
      const claimsBefore = await uniqueClaims(persistence);
      expect(claimsBefore).toHaveLength(1);
      const port = createAppUniqueConstraintSetEligibilityPortV1(
        fixture.ports,
        createAppUniqueConstraintDefinitionPortV1(persistence.drizzle),
      );
      await runEffect(reclaimSupersededAppUniqueConstraintSetBuildEffect(
        port,
        fixture.input,
      ));
      expect(await uniqueClaims(persistence)).toEqual(claimsBefore);
      await reconcile(fixture);
      await advanceUntilEnabled(fixture);
      expect(await uniqueClaims(persistence)).toEqual(claimsBefore);
    });
  }, 120_000);
});

async function fixtureFor(persistence: PostgresFlarexPersistence) {
  const deploymentId = "deployment_unique_set_pg";
  const scopeId = ScopeIdSchema.make(
    "scope_74000000-0000-4000-8000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    "schema_unique_set_pg",
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_unique_set_pg",
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence, last_commit_seq, epoch)
      values ($1, 'flarexdb_v1', 1, 0, $2)`,
    [scopeId, ScopeEpochSchema.make(
      "epoch_75000000-0000-4000-8000-000000000001",
    )],
  );
  const published = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [{
      logicalName: "users",
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: {
          type: "object",
          value: {
            email: { fieldType: { type: "string" }, optional: false },
          },
        },
      },
    }],
    indexes: [],
  });
  const table = published.manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Missing unique-set PG test table.");
  const prepared = await runEffect(
    prepareAppUniqueConstraintDefinitionBindingV1Effect(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId,
        tableId: table.tableId,
        descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_email"),
        physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["email"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      },
    ),
  );
  await persistence.drizzle.transaction((tx) => runEffect(
    ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
  ));
  const target = createPostgresLocatedAppUniqueConstraintSetBuildTargetV1(
    persistence,
    LOCATOR,
  );
  const input = Object.freeze({ deploymentId, schemaVersionId });
  const ports = {
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (value: string) =>
          persistence.getScopeMetadataByDeploymentId(value),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  } as const;
  return Object.freeze({
    persistence,
    scopeId,
    epoch: ScopeEpochSchema.make(
      "epoch_75000000-0000-4000-8000-000000000001",
    ),
    schemaVersionId,
    tableId: table.tableId,
    input,
    ports,
  });
}

function reconcile(fixture: Awaited<ReturnType<typeof fixtureFor>>) {
  return runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
    fixture.ports,
    fixture.input,
  ));
}

async function closeFixtureSet(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
) {
  const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.persistence.drizzle,
    fixture.input,
  ));
  await fixture.persistence.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

function advanceBackfill(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  pageSize: number,
) {
  return runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(
    fixture.ports,
    { ...fixture.input, pageSize },
  ));
}

async function advanceUntilEnabled(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
) {
  for (let step = 0; step < 128; step += 1) {
    const result = await advanceBackfill(fixture, 1);
    if (result.lifecycle === "enabled") return result;
  }
  throw new Error("PostgreSQL unique-set build did not reach enabled.");
}

async function appendLiveRow(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  rowIdText: string,
  email: string,
  commitSeq = 1n,
  prevCommitSeq: bigint | null = null,
) {
  const rowId = decodeAppRowIdHexV1(rowIdText);
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const document = await canonicalizeAppDocumentV1({
    tableId: fixture.tableId,
    rowId,
    creationTime,
    fields: { email },
  });
  await fixture.persistence.drizzle.transaction(async (tx) => {
    Result.getOrThrow(
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId: fixture.scopeId,
          tableId: fixture.tableId,
          rowId,
          writeEpoch: fixture.epoch,
          commitSeq: CommitSeqSchema.make(commitSeq),
          prevCommitSeq: prevCommitSeq === null ? null : CommitSeqSchema.make(prevCommitSeq),
          schemaVersionId: fixture.schemaVersionId,
          creationTime,
          document,
        },
      ),
    );
  });
}

async function buildCount(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
) {
  const result = await persistence.query<{ count: number }>(
    "select count(*)::int count from fx_system_unique_constraint_build where scope_id = $1",
    [scopeId],
  );
  return result.rows[0]?.count ?? -1;
}

function uniqueClaims(persistence: PostgresFlarexPersistence) {
  return persistence.query<{ row_id_hex: string; encoded_key_hex: string }>(
    `select encode(row_id, 'hex') row_id_hex, encode(encoded_key, 'hex') encoded_key_hex
       from fx_app_unique_key order by row_id asc`,
  ).then(result => result.rows);
}

async function acquireScopeClockLock(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
): Promise<Readonly<{ client: PoolClient; blockerPid: number }>> {
  const client = await persistence.pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select 1 from fx_system_scope_clock where scope_id = $1 for update",
      [scopeId],
    );
    const pid = await client.query<{ pid: number }>(
      "select pg_backend_pid()::int pid",
    );
    const blockerPid = pid.rows[0]?.pid;
    if (blockerPid === undefined) throw new Error("Missing PostgreSQL backend PID.");
    return Object.freeze({ client, blockerPid });
  } catch (error: unknown) {
    await client.query("rollback").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function waitForBlockedScopeClockOperations(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const blocked = await persistence.query<{ count: number }>(
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
       select count(*)::int count
         from blocked
         join pg_stat_activity activity using (pid)
        where activity.datname = current_database()
          and activity.wait_event_type = 'Lock'
          and activity.query ilike '%fx_system_scope_clock%'
          and (activity.query ilike '%for update%' or activity.query ilike '%for share%')`,
      [blockerPid],
    );
    if ((blocked.rows[0]?.count ?? 0) >= expected) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${expected} scope-clock waiters.`);
}

// Fixture-only authoritative history setup for direct builder tests.
async function setClockCommit(fixture: Awaited<ReturnType<typeof fixtureFor>>, commitSeq: bigint) {
  await fixture.persistence.query(`insert into fx_system_commit (scope_uuid, epoch_uuid, commit_seq, change_count, relation_adjacency_change_count)
    select clock.scope_uuid, clock.epoch_uuid, seq, (select count(*)::int from fx_app_row_rev revision where revision.scope_uuid = clock.scope_uuid and revision.commit_seq = seq), 0
    from fx_system_scope_clock clock cross join lateral generate_series(clock.last_commit_seq + 1, $2::bigint) seq where clock.scope_id = $1`, [fixture.scopeId, commitSeq.toString()]);
  await fixture.persistence.query(`insert into fx_system_commit_app_row_change (scope_uuid, epoch_uuid, commit_seq, change_ordinal, table_id, row_id)
    select revision.scope_uuid, revision.write_epoch_uuid, revision.commit_seq, (row_number() over (partition by revision.commit_seq order by revision.table_id, revision.row_id) - 1)::int, revision.table_id, revision.row_id
    from fx_app_row_rev revision join fx_system_scope_clock clock on clock.scope_uuid = revision.scope_uuid
    where clock.scope_id = $1 and revision.commit_seq > clock.last_commit_seq and revision.commit_seq <= $2::bigint`, [fixture.scopeId, commitSeq.toString()]);
  await fixture.persistence.query(`update fx_system_scope_clock set last_commit_seq = $2 where scope_id = $1`, [fixture.scopeId, commitSeq.toString()]);
}
