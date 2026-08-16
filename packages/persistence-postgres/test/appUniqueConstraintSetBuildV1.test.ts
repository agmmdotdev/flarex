import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, type AppRowIdHexV1 } from
  "flarex-protocol/app-document-id";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from
  "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  AppSchemaVersionUniqueConstraintSetClosedError,
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  AppUniqueConstraintSetBuildReclamationError,
  AppUniqueConstraintSetBuildStaleAuthorityV1Error,
  AppUniqueConstraintSetBuildStateV1Error,
  AppUniqueConstraintSetBuildDirectoryV1Error,
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  createAppUniqueConstraintSetEligibilityPortV1,
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  hasAppUniqueConstraintSetEligibilityEvidenceV1,
  loadAppUniqueConstraintSetEligibilityForReadinessV1Effect,
  loadAppUniqueConstraintSetEligibilityV1Effect,
  reclaimSupersededAppUniqueConstraintSetBuildEffect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  AppUniqueConstraintSetChangedV1Error,
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
  readAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult,
  type AppRowTransaction,
} from "../src/appRows";
import { createPGlitePersistence } from "../src/pglite";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { createDefaultLocatedReadCommittedTransactionRunnerV1 } from
  "../src/transactionSessionActivation";
import { LocatedReadCommittedTransactionFailureV1 } from
  "../src/transactionSessionAttemptKernel";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);
let fixtureOrdinal = 0;

describe("C08-B1 closed unique-set build foundation", () => {
  it("uses a share lock for readiness while retaining the planner update lock", async () => {
    const fixture = await closedFixture("eligibility_lock_modes");
    await reconcile(fixture);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    const lockModes: string[] = [];
    const target = createLocatedAppUniqueConstraintSetBuildTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      work => fixture.persistence.drizzle.transaction(tx =>
        work(observeForLockModes(tx, lockModes))
      ),
    );
    const observedPorts = {
      ...ports(fixture),
      authority: {
        ...ports(fixture).authority,
        scopeClockTargets: { resolve: async () => target },
      },
    } as const;
    const definitions = createAppUniqueConstraintDefinitionPortV1(
      fixture.persistence.drizzle,
    );
    const port = createAppUniqueConstraintSetEligibilityPortV1(
      observedPorts,
      definitions,
    );

    await expect(runEffect(
      loadAppUniqueConstraintSetEligibilityForReadinessV1Effect(
        port,
        eligibilityInput(fixture),
      ),
    )).resolves.toMatchObject({ status: "eligible" });
    expect(lockModes).toContain("share");
    expect(lockModes).not.toContain("update");

    lockModes.length = 0;
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({ status: "eligible" });
    expect(lockModes).toContain("update");
  });

  it("mints exact eligibility only for the current enabled closed set", async () => {
    const absent = await fixtureFor("eligibility_absent");
    const absentDefinitions = createAppUniqueConstraintDefinitionPortV1(
      absent.persistence.drizzle,
    );
    const absentPort = createAppUniqueConstraintSetEligibilityPortV1(
      ports(absent),
      absentDefinitions,
    );
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      absentPort,
      eligibilityInput(absent),
    ))).resolves.toEqual({
      status: "not_ready",
      reason: "setNotClosed",
      blocksAllTables: true,
      tableIds: [],
    });
    await closeSet(absent);
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      absentPort,
      eligibilityInput(absent),
    ))).resolves.toEqual({ status: "not_required", tableIds: [] });

    const lateBinding = await fixtureFor("eligibility_late_binding");
    const lateDefinitions = createAppUniqueConstraintDefinitionPortV1(
      lateBinding.persistence.drizzle,
    );
    const latePort = createAppUniqueConstraintSetEligibilityPortV1(
      ports(lateBinding),
      lateDefinitions,
    );
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      latePort,
      eligibilityInput(lateBinding),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "setNotClosed",
      blocksAllTables: true,
    });
    await ensureBinding(
      lateBinding,
      await prepareBinding(lateBinding, "by_email", false),
    );
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      latePort,
      eligibilityInput(lateBinding),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "setNotClosed",
      blocksAllTables: true,
      tableIds: [],
    });

    const fixture = await fixtureFor("eligibility");
    await ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_email", false),
    );
    const definitions = createAppUniqueConstraintDefinitionPortV1(
      fixture.persistence.drizzle,
    );
    const port = createAppUniqueConstraintSetEligibilityPortV1(
      ports(fixture),
      definitions,
    );
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "setNotClosed",
      blocksAllTables: true,
      tableIds: [],
    });
    await closeSet(fixture);
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "buildMissing",
    });
    await reconcile(fixture);
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "buildNotEnabled",
      lifecycle: "declared",
    });
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    const eligible = await runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ));
    expect(eligible).toMatchObject({
      status: "eligible",
      evidence: {
        scopeId: fixture.scopeId,
        schemaVersionId: fixture.schemaVersionId,
        definitionCount: 1,
        tableIds: [fixture.tableId],
        storageGenerationFence: 1n,
        epoch: fixture.epoch,
      },
    });
    if (eligible.status !== "eligible") {
      throw new Error("Expected exact unique-set eligibility evidence.");
    }
    expect(hasAppUniqueConstraintSetEligibilityEvidenceV1(
      eligible.evidence,
    )).toBe(true);
    expect(eligible.evidence.definitionSetSha256Hex).toMatch(/^[0-9a-f]{64}$/u);
    expect("definitionSetSha256" in eligible.evidence).toBe(false);
    expect(hasAppUniqueConstraintSetEligibilityEvidenceV1({
      ...eligible.evidence,
    })).toBe(false);
    const exactPorts = ports(fixture);
    let controlDbReads = 0;
    let authorityReads = 0;
    const capturedPort = createAppUniqueConstraintSetEligibilityPortV1({
      get controlDb() {
        controlDbReads += 1;
        return controlDbReads === 1
          ? fixture.persistence.drizzle
          : absent.persistence.drizzle;
      },
      get authority() {
        authorityReads += 1;
        return exactPorts.authority;
      },
    }, definitions);
    expect(controlDbReads).toBe(1);
    expect(authorityReads).toBe(1);
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      capturedPort,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({ status: "eligible" });
    const mismatchedCatalogPort = createAppUniqueConstraintSetEligibilityPortV1(
      ports(fixture),
      absentDefinitions,
    );
    await expect(runEffectFailure(loadAppUniqueConstraintSetEligibilityV1Effect(
      mismatchedCatalogPort,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({ reason: "invalidPort", retryable: false });

    await fixture.persistence.query(
      `update fx_system_scope_clock
          set storage_generation_fence = 2, epoch = $2
        where scope_id = $1`,
      [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_eligibility_2")],
    );
    await expect(runEffect(loadAppUniqueConstraintSetEligibilityV1Effect(
      port,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({
      status: "not_ready",
      reason: "buildStale",
    });
    const copiedPort = Object.freeze({ ...port });
    await expect(runEffectFailure(loadAppUniqueConstraintSetEligibilityV1Effect(
      copiedPort,
      eligibilityInput(fixture),
    ))).resolves.toMatchObject({ reason: "invalidPort", retryable: false });
  });

  it("closes the exact set, replays it, and refuses late bindings", async () => {
    const fixture = await fixtureFor("closure");
    const first = await prepareBinding(fixture, "by_email", false);
    await ensureBinding(fixture, first);
    const late = await prepareBinding(fixture, "by_tenant_email", true);

    const preparedClosure = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    const closed = await fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(
        tx,
        preparedClosure,
      ))
    );
    expect(closed).toMatchObject({
      status: "closed",
      closure: { definitionCount: 1 },
      members: [{ uniqueConstraintDefinitionId: 1 }],
    });

    const replayPrepared = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    await expect(fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(
        tx,
        replayPrepared,
      ))
    )).resolves.toMatchObject({ status: "replayed" });

    await expect(ensureBinding(fixture, late)).rejects.toBeInstanceOf(
      AppSchemaVersionUniqueConstraintSetClosedError,
    );
    await expect(ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_email", false),
    )).resolves.toMatchObject({ bindingStatus: "existing" });
    expect(await bindingCount(fixture)).toBe(1);
  });

  it("rejects a set changed after preparation and rolls back closure", async () => {
    const fixture = await fixtureFor("changed");
    await ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_email", false),
    );
    const prepared = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        fixture.persistence.drizzle,
        input(fixture),
      ),
    );
    await ensureBinding(
      fixture,
      await prepareBinding(fixture, "by_tenant_email", true),
    );
    await expect(fixture.persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared))
    )).rejects.toBeInstanceOf(AppUniqueConstraintSetChangedV1Error);
    expect(await closureCount(fixture)).toBe(0);

    const exact = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
      fixture.persistence.drizzle,
      input(fixture),
    ));
    await expect(fixture.persistence.drizzle.transaction(async (tx) => {
      await runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, exact));
      tx.rollback();
    })).rejects.toBeDefined();
    expect(await closureCount(fixture)).toBe(0);
  });

  it("declares one fenced target build, replays, and redeclares stale authority", async () => {
    const fixture = await closedFixture("build");
    const created = await reconcile(fixture);
    expect(created).toMatchObject({
      status: "reconciled",
      disposition: "created",
      definitionCount: 1,
      startCommitSeq: 0n,
      attemptFence: 1n,
    });
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "replayed",
      attemptFence: 1n,
    });

    await fixture.persistence.query(
      `update fx_system_unique_constraint_set_build
          set lifecycle = 'backfilling', cursor_definition_id = 1,
              cursor_row_id = decode('00112233445566778899aabbccddeeff', 'hex')
        where scope_id = $1 and schema_version_id = $2`,
      [fixture.scopeId, fixture.schemaVersionId],
    );
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "replayed",
      attemptFence: 1n,
    });
    expect(await buildRows(fixture)).toMatchObject([{
      lifecycle: "backfilling",
      cursor_definition_id: 1,
      cursor_row_hex: "00112233445566778899aabbccddeeff",
    }]);

    await fixture.persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = 2, epoch = $2, last_commit_seq = 7
       where scope_id = $1`,
      [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_build_2")],
    );
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "redeclared",
      startCommitSeq: 7n,
      attemptFence: 2n,
    });
    expect(await buildRows(fixture)).toMatchObject([{
      storage_generation_fence: "2",
      epoch: "epoch_unique_build_2",
      lifecycle: "declared",
      attempt_fence: "2",
      cursor_definition_id: null,
      cursor_row_hex: null,
    }]);
  });

  it("rejects build row 33 before creation at the scope directory ceiling", async () => {
    const fixture = await closedFixture("build_directory_ceiling");
    for (
      let ordinal = 0;
      ordinal < MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1;
      ordinal += 1
    ) {
      await fixture.persistence.query(
        `insert into fx_system_unique_constraint_set_build
          (scope_id, schema_version_id, set_codec_version, definition_count,
           definition_set_sha256, storage_generation,
           storage_generation_fence, epoch, start_commit_seq, lifecycle,
           cursor_codec_version, cursor_definition_id, cursor_row_id,
           attempt_fence)
         values ($1, $2, 1, 0, decode(repeat('ab', 32), 'hex'),
                 'flarexdb_v1', 1, $3, 0, 'enabled', 1, null, null, 1)`,
        [fixture.scopeId, `schema_history_${ordinal}`, fixture.epoch],
      );
    }
    const failure = await runEffectFailure(
      reconcileAppUniqueConstraintSetBuildV1Effect(
        ports(fixture),
        input(fixture),
      ),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildDirectoryV1Error,
    );
    expect(failure).toMatchObject({
      _tag: "AppUniqueConstraintSetBuildDirectoryV1Error",
      reason: "tooManyBuildRows",
      maximumBuilds: MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    });
    expect(await buildRows(fixture)).toEqual([]);
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
  });

  it("rolls back an injected target fault and resumes deterministically", async () => {
    const fixture = await closedFixture("rollback");
    const failure = await runEffectFailure(
      reconcileAppUniqueConstraintSetBuildV1Effect(
        ports(fixture),
        input(fixture),
        { faultAfter: () => { throw new Error("injected unique build fault"); } },
      ),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await buildRows(fixture)).toEqual([]);
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "created",
    });
  });

  it("reclaims each non-enabled workspace lifecycle and rebuilds cleanly", async () => {
    const fixture = await closedFixture("workspace_lifecycles");
    const port = eligibilityPort(fixture);
    const lifecycles = [
      "declared",
      "building",
      "backfilling",
      "validating",
    ] as const;

    for (const lifecycle of lifecycles) {
      await reconcile(fixture);
      await fixture.persistence.query(
        `update fx_system_unique_constraint_set_build
            set lifecycle = $3, cursor_definition_id = null,
                cursor_row_id = null
          where scope_id = $1 and schema_version_id = $2`,
        [fixture.scopeId, fixture.schemaVersionId, lifecycle],
      );
      await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
        status: "reclaimed",
        disposition: "deleted",
        lifecycle,
      });
      expect(await buildRows(fixture)).toEqual([]);
      expect(await closureCount(fixture)).toBe(1);
      expect(await bindingCount(fixture)).toBe(1);
    }

    await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
      disposition: "already_absent",
    });
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "created",
    });
  });

  it("refuses enabled workspaces and structurally copied ports", async () => {
    const fixture = await closedFixture("workspace_refusal");
    await reconcile(fixture);
    await fixture.persistence.query(
      `update fx_system_unique_constraint_set_build
          set lifecycle = 'enabled'
        where scope_id = $1 and schema_version_id = $2`,
      [fixture.scopeId, fixture.schemaVersionId],
    );
    const port = eligibilityPort(fixture);
    const enabledFailure = await runEffectFailure(reclaim(fixture, port));
    expect(enabledFailure).toBeInstanceOf(
      AppUniqueConstraintSetBuildReclamationError,
    );
    expect(enabledFailure).toMatchObject({ reason: "buildEnabled" });
    expect(await buildRows(fixture)).toMatchObject([{ lifecycle: "enabled" }]);

    const copiedPort = Object.freeze({ ...port });
    const copiedFailure = await runEffectFailure(reclaim(fixture, copiedPort));
    expect(copiedFailure).toBeInstanceOf(
      AppUniqueConstraintSetBuildReclamationError,
    );
    expect(copiedFailure).toMatchObject({ reason: "invalidPort" });
  });

  it("rolls back reclamation faults without losing the workspace", async () => {
    const fixture = await closedFixture("workspace_rollback");
    await reconcile(fixture);
    const port = eligibilityPort(fixture);
    const failure = await runEffectFailure(
      reclaimSupersededAppUniqueConstraintSetBuildEffect(
        port,
        input(fixture),
        {
          faultAfter: (point) => {
            if (point === "afterWorkspaceDelete") {
              throw new Error("injected workspace reclamation rollback");
            }
          },
        },
      ),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await buildRows(fixture)).toMatchObject([{ lifecycle: "declared" }]);
    await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
      disposition: "deleted",
    });
  });

  it("observes committed reclamation after a lost transaction response", async () => {
    const fixture = await closedFixture("workspace_uncertain");
    await reconcile(fixture);
    const baseRunner = createDefaultLocatedReadCommittedTransactionRunnerV1(
      fixture.persistence.drizzle,
    );
    let injected = false;
    const target = createLocatedAppUniqueConstraintSetBuildTargetV1(
      fixture.persistence.drizzle,
      LOCATOR,
      async (work) => {
        const value = await baseRunner(work);
        if (!injected) {
          injected = true;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost reclamation response"),
          }));
        }
        return value;
      },
    );
    const port = eligibilityPort(fixture, target);
    await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
      disposition: "replayedAfterUncertainCompletion",
    });
    expect(injected).toBe(true);
    expect(await buildRows(fixture)).toEqual([]);
  });

  it("retains claims and immutable definition authority when reclaiming progress", async () => {
    const fixture = await closedFixture("workspace_authority_retention");
    await appendLiveRow(
      fixture,
      rowId(21),
      1n,
      null,
      { tenantId: "tenant-a", email: "retained@example.com" },
    );
    await setClockCommit(fixture, 1n);
    await reconcile(fixture);
    await advanceBackfill(fixture, 1);
    await advanceBackfill(fixture, 1);
    const backfilled = await advanceBackfill(fixture, 1);
    expect(backfilled.claimed).toBe(1);
    const claimsBefore = await uniqueClaims(fixture);
    const port = eligibilityPort(fixture);

    await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
      disposition: "deleted",
    });
    expect(await uniqueClaims(fixture)).toEqual(claimsBefore);
    expect(await closureCount(fixture)).toBe(1);
    expect(await bindingCount(fixture)).toBe(1);
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "created",
    });
    await advanceToEnabled(fixture, 1);
    expect(await uniqueClaims(fixture)).toEqual(claimsBefore);
  });

  it("refuses a stale build authority without deleting its workspace", async () => {
    const fixture = await closedFixture("workspace_stale_authority");
    await reconcile(fixture);
    await fixture.persistence.query(
      `update fx_system_scope_clock
          set storage_generation_fence = 2, epoch = $2, last_commit_seq = 7
        where scope_id = $1`,
      [fixture.scopeId, ScopeEpochSchema.make("epoch_workspace_stale_2")],
    );
    const failure = await runEffectFailure(
      reclaim(fixture, eligibilityPort(fixture)),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildStaleAuthorityV1Error,
    );
    expect(await buildRows(fixture)).toMatchObject([{ lifecycle: "declared" }]);
  });

  it("releases one exact directory slot without weakening the ceiling", async () => {
    const fixture = await closedFixture("workspace_capacity");
    await reconcile(fixture);
    for (
      let ordinal = 0;
      ordinal < MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 - 1;
      ordinal += 1
    ) {
      await fixture.persistence.query(
        `insert into fx_system_unique_constraint_set_build
          (scope_id, schema_version_id, set_codec_version, definition_count,
           definition_set_sha256, storage_generation,
           storage_generation_fence, epoch, start_commit_seq, lifecycle,
           cursor_codec_version, cursor_definition_id, cursor_row_id,
           attempt_fence)
         values ($1, $2, 1, 0, decode(repeat('cd', 32), 'hex'),
                 'flarexdb_v1', 1, $3, 0, 'enabled', 1, null, null, 1)`,
        [fixture.scopeId, `schema_capacity_${ordinal}`, fixture.epoch],
      );
    }
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
    const port = eligibilityPort(fixture);
    await expect(runEffect(reclaim(fixture, port))).resolves.toMatchObject({
      disposition: "deleted",
    });
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 - 1,
    );
    await expect(reconcile(fixture)).resolves.toMatchObject({
      disposition: "created",
    });
    expect(await buildDirectoryCount(fixture)).toBe(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
  });

  it("returns absent until the control set is closed", async () => {
    const fixture = await fixtureFor("absent");
    await expect(reconcile(fixture)).resolves.toEqual({
      status: "absent",
      reason: "setNotClosed",
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
    });
  });

  it("reads and verifies the durable closure against current bindings", async () => {
    const fixture = await closedFixture("read");
    const located = await runEffect(readAppUniqueConstraintSetClosureV1Effect(
      fixture.persistence.drizzle,
      fixture.deploymentId,
      fixture.schemaVersionId,
    ));
    expect(located).toMatchObject({
      closure: { definitionCount: 1 },
      members: [{ logicalUniqueConstraintId: 1 }],
    });
  });

  it("backfills bounded pages, follows current rows, and validates to enabled", async () => {
    const fixture = await closedFixture("backfill");
    const rowA = rowId(1);
    const rowB = rowId(2);
    await appendLiveRow(fixture, rowA, 1n, null, {
      tenantId: "tenant-a",
      email: "a@example.com",
    });
    await appendLiveRow(fixture, rowB, 1n, null, {
      tenantId: "tenant-a",
      email: "old@example.com",
    });
    await setClockCommit(fixture, 1n);
    await reconcile(fixture);
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "building",
      scanned: 0,
    });
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "backfilling",
      scanned: 0,
    });
    const first = await advanceBackfill(fixture, 1);
    expect(first).toMatchObject({
      lifecycle: "backfilling",
      scanned: 1,
      claimed: 1,
    });

    await appendLiveRow(fixture, rowB, 2n, 1n, {
      tenantId: "tenant-a",
      email: "new@example.com",
    });
    await setClockCommit(fixture, 2n);
    const second = await advanceBackfill(fixture, 1);
    expect(second).toMatchObject({
      lifecycle: "validating",
      scanned: 1,
      claimed: 1,
      cursorDefinitionId: null,
      cursorRowId: null,
    });
    expect(await uniqueClaims(fixture)).toMatchObject([
      { row_id_hex: rowA, commit_seq: "1" },
      { row_id_hex: rowB, commit_seq: "2" },
    ]);
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      status: "advanced",
      lifecycle: "validating",
      scanned: 1,
      cursorRowId: rowA,
    });
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      status: "advanced",
      lifecycle: "enabled",
      scanned: 1,
      cursorDefinitionId: null,
      cursorRowId: null,
    });
  });

  it("replays exact claims after a cold cursor restart", async () => {
    const fixture = await closedFixture("replay");
    const rowA = rowId(3);
    await appendLiveRow(fixture, rowA, 1n, null, {
      tenantId: "tenant-a",
      email: "replay@example.com",
    });
    await setClockCommit(fixture, 1n);
    await reconcile(fixture);
    await advanceBackfill(fixture, 1);
    await advanceBackfill(fixture, 1);
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "validating",
      claimed: 1,
    });
    await fixture.persistence.query(
      `update fx_system_unique_constraint_set_build
          set lifecycle = 'backfilling', cursor_definition_id = null,
              cursor_row_id = null
        where scope_id = $1 and schema_version_id = $2`,
      [fixture.scopeId, fixture.schemaVersionId],
    );
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "validating",
      claimed: 0,
      replayed: 1,
    });
    expect(await uniqueClaims(fixture)).toHaveLength(1);
  });

  it("rolls back the whole page on a duplicate key or injected post-claim fault", async () => {
    const fixture = await closedFixture("conflict");
    const rowA = rowId(4);
    const rowB = rowId(5);
    for (const row of [rowA, rowB]) {
      await appendLiveRow(fixture, row, 1n, null, {
        tenantId: "tenant-a",
        email: "duplicate@example.com",
      });
    }
    await setClockCommit(fixture, 1n);
    await reconcile(fixture);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await expect(advanceBackfill(fixture, 16)).rejects.toMatchObject({
      _tag: "AppUniqueKeyConflictError",
    });
    expect(await uniqueClaims(fixture)).toEqual([]);
    expect(await buildRows(fixture)).toMatchObject([{
      lifecycle: "backfilling",
      cursor_definition_id: null,
      cursor_row_hex: null,
    }]);

    await appendLiveRow(fixture, rowB, 2n, 1n, {
      tenantId: "tenant-a",
      email: "distinct@example.com",
    });
    await setClockCommit(fixture, 2n);
    const failure = await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(fixture),
        { ...input(fixture), pageSize: 16 },
        {
          faultAfter: (point) => {
            if (point === "afterBackfillClaim") throw new Error("fault");
          },
        },
      ),
    );
    expect(failure).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await uniqueClaims(fixture)).toEqual([]);
    await expect(advanceBackfill(fixture, 16)).resolves.toMatchObject({
      lifecycle: "validating",
      claimed: 2,
      omitted: 0,
    });
  });

  it("authenticates current scope authority while preserving a pre-rotation row epoch", async () => {
    const fixture = await closedFixture("epoch_rotation");
    const oldEpochRow = rowId(7);
    await appendLiveRow(fixture, oldEpochRow, 1n, null, {
      tenantId: "tenant-a",
      email: "old-epoch@example.com",
    });
    await fixture.persistence.query(
      `update fx_system_scope_clock
          set epoch = $2, last_commit_seq = 1
        where scope_id = $1`,
      [
        fixture.scopeId,
        ScopeEpochSchema.make(
          "epoch_76000000-0000-4000-8000-000000000001",
        ),
      ],
    );
    await reconcile(fixture);
    await advanceBackfill(fixture, 16);
    await advanceBackfill(fixture, 16);
    await expect(advanceBackfill(fixture, 16)).resolves.toMatchObject({
      lifecycle: "validating",
      claimed: 1,
    });
    const lineage = await fixture.persistence.query<{
      same_parent_epoch: boolean;
      differs_from_current_epoch: boolean;
    }>(
      `select
         claim.write_epoch_uuid = revision.write_epoch_uuid same_parent_epoch,
         claim.write_epoch_uuid <> clock.epoch_uuid differs_from_current_epoch
       from fx_app_unique_key claim
       inner join fx_app_row_rev revision
         on revision.scope_uuid = claim.scope_uuid
        and revision.table_id = claim.table_id
        and revision.row_id = claim.row_id
        and revision.commit_seq = claim.commit_seq
       inner join fx_system_scope_clock clock
         on clock.scope_uuid = claim.scope_uuid`,
    );
    expect(lineage.rows).toEqual([{
      same_parent_epoch: true,
      differs_from_current_epoch: true,
    }]);
  });

  it("fails closed on missing and claim-only S11 ownership", async () => {
    const missing = await closedFixture("validation_missing");
    const missingRow = rowId(8);
    await appendLiveRow(missing, missingRow, 1n, null, {
      tenantId: "tenant-a",
      email: "missing@example.com",
    });
    await setClockCommit(missing, 1n);
    await advanceToValidating(missing, 16);
    await missing.persistence.query(
      "delete from fx_app_unique_key where scope_uuid = $1::uuid",
      [missing.scopeId.slice("scope_".length)],
    );
    const missingFailure = await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(missing),
        { ...input(missing), pageSize: 16 },
      ),
    );
    expect(missingFailure).toBeInstanceOf(
      AppUniqueConstraintSetBuildStateV1Error,
    );
    expect(missingFailure).toMatchObject({
      reason: "validationMismatch",
      cause: { reason: "missingClaim" },
    });
    expect(await buildRows(missing)).toMatchObject([{
      lifecycle: "validating",
      cursor_definition_id: null,
      cursor_row_hex: null,
    }]);

    const claimOnly = await closedFixture("validation_claim_only");
    const claimOnlyRow = rowId(9);
    await appendLiveRow(claimOnly, claimOnlyRow, 1n, null, {
      tenantId: "tenant-a",
      email: "claim-only@example.com",
    });
    await setClockCommit(claimOnly, 1n);
    await advanceToValidating(claimOnly, 16);
    await claimOnly.persistence.query(
      "delete from fx_app_row_current where scope_uuid = $1::uuid",
      [claimOnly.scopeId.slice("scope_".length)],
    );
    const claimOnlyFailure = await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(claimOnly),
        { ...input(claimOnly), pageSize: 16 },
      ),
    );
    expect(claimOnlyFailure).toMatchObject({
      _tag: "AppUniqueConstraintSetBuildStateV1Error",
      reason: "validationMismatch",
      cause: { reason: "unexpectedClaim" },
    });
  });

  it("rejects claim-only rows outside the definition locale and table", async () => {
    const wrongLocale = await closedFixture("validation_wrong_locale");
    const localeRow = rowId(12);
    await appendLiveRow(wrongLocale, localeRow, 1n, null, {
      tenantId: "tenant-a",
      email: "wrong-locale@example.com",
    });
    await setClockCommit(wrongLocale, 1n);
    await advanceToValidating(wrongLocale, 16);
    await wrongLocale.persistence.query(
      "update fx_app_unique_key set locale_key = 'en'",
    );
    await wrongLocale.persistence.query(
      "delete from fx_app_row_current where scope_uuid = $1::uuid",
      [wrongLocale.scopeId.slice("scope_".length)],
    );
    expect(await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(wrongLocale),
        { ...input(wrongLocale), pageSize: 16 },
      ),
    )).toMatchObject({
      _tag: "AppUniqueConstraintSetBuildStateV1Error",
      reason: "validationMismatch",
      cause: { reason: "claimIdentityMismatch" },
    });

    const wrongTable = await closedFixture("validation_wrong_table");
    const tableRow = rowId(13);
    await appendLiveRow(wrongTable, tableRow, 1n, null, {
      tenantId: "tenant-a",
      email: "wrong-table@example.com",
    });
    await setClockCommit(wrongTable, 1n);
    await advanceToValidating(wrongTable, 16);
    const scopeUuid = wrongTable.scopeId.slice("scope_".length);
    await wrongTable.persistence.query(
      `insert into fx_app_row_rev
        (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
         write_epoch_uuid, schema_version_id, creation_time,
         value_codec_version, is_tombstone, value_json, value_bytes,
         value_sha256)
       select scope_uuid, table_id + 1, row_id, commit_seq, prev_commit_seq,
              write_epoch_uuid, schema_version_id, creation_time,
              value_codec_version, is_tombstone, value_json, value_bytes,
              value_sha256
         from fx_app_row_rev
        where scope_uuid = $1::uuid and row_id = decode($2, 'hex')`,
      [scopeUuid, tableRow],
    );
    await wrongTable.persistence.query(
      `update fx_app_unique_key set table_id = table_id + 1
        where scope_uuid = $1::uuid and row_id = decode($2, 'hex')`,
      [scopeUuid, tableRow],
    );
    await wrongTable.persistence.query(
      `delete from fx_app_row_current
        where scope_uuid = $1::uuid and row_id = decode($2, 'hex')`,
      [scopeUuid, tableRow],
    );
    expect(await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(wrongTable),
        { ...input(wrongTable), pageSize: 16 },
      ),
    )).toMatchObject({
      _tag: "AppUniqueConstraintSetBuildStateV1Error",
      reason: "validationMismatch",
      cause: { reason: "claimIdentityMismatch" },
    });
  });

  it("rolls back validation progress and enable faults before deterministic replay", async () => {
    const fixture = await closedFixture("validation_rollback");
    for (const [value, email] of [[10, "a@example.com"], [11, "b@example.com"]] as const) {
      await appendLiveRow(fixture, rowId(value), 1n, null, {
        tenantId: "tenant-a",
        email,
      });
    }
    await setClockCommit(fixture, 1n);
    await advanceToValidating(fixture, 16);
    const rowFault = await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(fixture),
        { ...input(fixture), pageSize: 1 },
        {
          faultAfter: (point) => {
            if (point === "afterValidationRow") throw new Error("row fault");
          },
        },
      ),
    );
    expect(rowFault).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await buildRows(fixture)).toMatchObject([{
      lifecycle: "validating",
      cursor_row_hex: null,
    }]);

    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "validating",
      cursorRowId: rowId(10),
    });
    const enableFault = await runEffectFailure(
      advanceAppUniqueConstraintSetBackfillV1Effect(
        ports(fixture),
        { ...input(fixture), pageSize: 1 },
        {
          faultAfter: (point) => {
            if (point === "beforeEnable") throw new Error("enable fault");
          },
        },
      ),
    );
    expect(enableFault).toBeInstanceOf(
      AppUniqueConstraintSetBuildIntegrationV1Error,
    );
    expect(await buildRows(fixture)).toMatchObject([{
      lifecycle: "validating",
      cursor_row_hex: rowId(10),
    }]);
    await expect(advanceBackfill(fixture, 1)).resolves.toMatchObject({
      lifecycle: "enabled",
      cursorRowId: null,
    });
  });

  it("settles empty and sparse-omitted sets without minting claims", async () => {
    const empty = await fixtureFor("empty_backfill");
    await closeSet(empty);
    await reconcile(empty);
    await advanceBackfill(empty, 16);
    await advanceBackfill(empty, 16);
    await expect(advanceBackfill(empty, 16)).resolves.toMatchObject({
      lifecycle: "validating",
      scanned: 0,
      claimed: 0,
    });
    await expect(advanceBackfill(empty, 16)).resolves.toMatchObject({
      lifecycle: "enabled",
      scanned: 0,
    });

    const sparse = await fixtureFor("sparse_backfill");
    await ensureBinding(
      sparse,
      await prepareBinding(sparse, "by_email", true),
    );
    await closeSet(sparse);
    const sparseRow = rowId(6);
    await appendDocument(sparse, sparseRow, 1n, null, {
      tenantId: "tenant-a",
    });
    await setClockCommit(sparse, 1n);
    await reconcile(sparse);
    await advanceBackfill(sparse, 16);
    await advanceBackfill(sparse, 16);
    await expect(advanceBackfill(sparse, 16)).resolves.toMatchObject({
      lifecycle: "validating",
      scanned: 1,
      omitted: 1,
      claimed: 0,
    });
    expect(await uniqueClaims(sparse)).toEqual([]);
    await expect(advanceBackfill(sparse, 16)).resolves.toMatchObject({
      lifecycle: "enabled",
      scanned: 1,
    });
  });
});

function observeForLockModes<T extends AppRowTransaction>(
  transaction: T,
  lockModes: string[],
): T {
  const proxies = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if ((typeof value !== "object" && typeof value !== "function") ||
      value === null) return value;
    const existing = proxies.get(value);
    if (existing !== undefined) return existing;
    const proxy = new Proxy(value, {
      get(target, property) {
        const member = Reflect.get(target, property, target);
        if (typeof member !== "function") return wrap(member);
        return (...args: ReadonlyArray<unknown>) => {
          if (property === "for" && typeof args[0] === "string") {
            lockModes.push(args[0]);
          }
          return wrap(Reflect.apply(member, target, args));
        };
      },
    });
    proxies.set(value, proxy);
    return proxy;
  };
  return wrap(transaction) as T;
}

type Persistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface Fixture {
  readonly persistence: Persistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly tableId: ReturnType<typeof CatalogTableIdSchema.make>;
  readonly target: ReturnType<
    typeof createLocatedAppUniqueConstraintSetBuildTargetV1
  >;
}

async function fixtureFor(suffix: string): Promise<Fixture> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  fixtureOrdinal += 1;
  const fixtureSuffix = fixtureOrdinal.toString(16).padStart(12, "0");
  const deploymentId = `deployment_unique_set_${suffix}`;
  const scopeId = ScopeIdSchema.make(
    `scope_71000000-0000-4000-8000-${fixtureSuffix}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_unique_set_${suffix}`,
  );
  const epoch = ScopeEpochSchema.make(
    `epoch_72000000-0000-4000-8000-${fixtureSuffix}`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_unique_set_${suffix}`,
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const published = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  const table = published.manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Missing unique-set test table.");
  return Object.freeze({
    persistence,
    deploymentId,
    scopeId,
    epoch,
    schemaVersionId,
    tableId: table.tableId,
    target: createLocatedAppUniqueConstraintSetBuildTargetV1(
      persistence.drizzle,
      LOCATOR,
    ),
  });
}

async function closedFixture(suffix: string): Promise<Fixture> {
  const fixture = await fixtureFor(suffix);
  await ensureBinding(
    fixture,
    await prepareBinding(fixture, "by_email", false),
  );
  await closeSet(fixture);
  return fixture;
}

async function closeSet(fixture: Fixture) {
  const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.persistence.drizzle,
    input(fixture),
  ));
  await fixture.persistence.drizzle.transaction((tx) =>
    runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared))
  );
}

function prepareBinding(
  fixture: Fixture,
  descriptor: string,
  sparse: boolean,
) {
  return runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(
    fixture.persistence.drizzle,
    {
      deploymentId: fixture.deploymentId,
      schemaVersionId: fixture.schemaVersionId,
      tableId: fixture.tableId,
      descriptor: SchemaManifestAppIndexDescriptorSchema.make(descriptor),
      physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
        kind: "appUniqueConstraint",
        specVersion: 1,
        orderedFields: descriptor === "by_email"
          ? ["email"]
          : ["tenantId", "email"],
        sparse,
        localePolicy: { kind: "none" },
        keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
        keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      }),
    },
  ));
}

function ensureBinding(
  fixture: Fixture,
  prepared: Awaited<ReturnType<typeof prepareBinding>>,
) {
  return fixture.persistence.drizzle.transaction((tx) =>
    runEffect(ensureAppUniqueConstraintDefinitionBindingV1InTransaction(
      tx,
      prepared,
    ))
  );
}

function ports(fixture: Fixture) {
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
        resolve: async () => fixture.target,
      },
    },
  } as const;
}

function eligibilityPort(
  fixture: Fixture,
  target: Fixture["target"] = fixture.target,
) {
  const buildPorts = ports(fixture);
  return createAppUniqueConstraintSetEligibilityPortV1(
    {
      ...buildPorts,
      authority: {
        ...buildPorts.authority,
        scopeClockTargets: { resolve: async () => target },
      },
    },
    createAppUniqueConstraintDefinitionPortV1(fixture.persistence.drizzle),
  );
}

function input(fixture: Fixture) {
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    schemaVersionId: fixture.schemaVersionId,
  });
}

function eligibilityInput(fixture: Fixture) {
  return Object.freeze({
    ...input(fixture),
    scopeId: fixture.scopeId,
  });
}

function reclaim(
  fixture: Fixture,
  port: ReturnType<typeof eligibilityPort>,
) {
  return reclaimSupersededAppUniqueConstraintSetBuildEffect(
    port,
    input(fixture),
  );
}

function reconcile(fixture: Fixture) {
  return runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
    ports(fixture),
    input(fixture),
  ));
}

function advanceBackfill(fixture: Fixture, pageSize: number) {
  return runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(
    ports(fixture),
    { ...input(fixture), pageSize },
  ));
}

async function advanceToValidating(fixture: Fixture, pageSize: number) {
  await reconcile(fixture);
  for (let step = 0; step < 128; step += 1) {
    const advanced = await advanceBackfill(fixture, pageSize);
    if (advanced.lifecycle === "validating") return advanced;
  }
  throw new Error("Unique-set fixture did not reach validating.");
}

async function advanceToEnabled(fixture: Fixture, pageSize: number) {
  for (let step = 0; step < 128; step += 1) {
    const advanced = await advanceBackfill(fixture, pageSize);
    if (advanced.lifecycle === "enabled") return advanced;
  }
  throw new Error("Unique-set fixture did not reach enabled.");
}

async function appendLiveRow(
  fixture: Fixture,
  rowId: AppRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  fields: Readonly<{ tenantId: string; email: string }>,
) {
  return appendDocument(
    fixture,
    rowId,
    commitSeq,
    prevCommitSeq,
    fields,
  );
}

async function appendDocument(
  fixture: Fixture,
  rowId: AppRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  fields: Readonly<Record<string, string>>,
) {
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const document = await canonicalizeAppDocumentV1({
    tableId: fixture.tableId,
    rowId,
    creationTime,
    fields,
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
          prevCommitSeq: prevCommitSeq === null
            ? null
            : CommitSeqSchema.make(prevCommitSeq),
          schemaVersionId: fixture.schemaVersionId,
          creationTime,
          document,
        },
      ),
    );
  });
}

async function setClockCommit(fixture: Fixture, commitSeq: bigint) {
  await fixture.persistence.query(
    `update fx_system_scope_clock set last_commit_seq = $2 where scope_id = $1`,
    [fixture.scopeId, commitSeq.toString()],
  );
}

function rowId(value: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(value.toString(16).padStart(32, "0"));
}

function uniqueClaims(fixture: Fixture) {
  return fixture.persistence.query<{
    row_id_hex: string;
    commit_seq: string;
  }>(
    `select encode(row_id, 'hex') row_id_hex, commit_seq::text
       from fx_app_unique_key
      order by row_id asc`,
  ).then((result) => result.rows);
}

function closureCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: number }>(
    "select count(*)::int count from fx_control_schema_unique_constraint_set",
  ).then((result) => result.rows[0]?.count ?? -1);
}

function bindingCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: number }>(
    "select count(*)::int count from fx_control_schema_version_unique_constraint_binding",
  ).then((result) => result.rows[0]?.count ?? -1);
}

function buildRows(fixture: Fixture) {
  return fixture.persistence.query<{
    storage_generation_fence: string;
    epoch: string;
    lifecycle: string;
    attempt_fence: string;
    cursor_definition_id: number | null;
    cursor_row_hex: string | null;
  }>(
    `select storage_generation_fence::text, epoch, lifecycle,
            attempt_fence::text, cursor_definition_id,
            encode(cursor_row_id, 'hex') cursor_row_hex
       from fx_system_unique_constraint_set_build
      where scope_id = $1 and schema_version_id = $2`,
    [fixture.scopeId, fixture.schemaVersionId],
  ).then((result) => result.rows);
}

function buildDirectoryCount(fixture: Fixture) {
  return fixture.persistence.query<{ count: number }>(
    `select count(*)::int count
       from fx_system_unique_constraint_set_build
      where scope_id = $1`,
    [fixture.scopeId],
  ).then((result) => result.rows[0]?.count ?? -1);
}

function appTable(logicalName: string): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          tenantId: {
            fieldType: { type: "string" },
            optional: false,
          },
          email: {
            fieldType: { type: "string" },
            optional: false,
          },
        },
      },
    },
  };
}
