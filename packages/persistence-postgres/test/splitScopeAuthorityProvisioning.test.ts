import { eq } from "drizzle-orm";
import { Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeEpoch,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  FlarexPersistence,
  SplitScopePhysicalLocator,
} from "../src";
import {
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
  ScopeAuthorityIdGenerationExhaustedError,
  SplitScopeAuthorityPlacementPlanningError,
  SplitScopeAuthorityTargetResolutionError,
  SplitScopeInitialClockConflictError,
  type EnsureSplitScopeAuthorityInput,
  type EnsureSplitScopeAuthorityResult,
  type LocatedSplitScopeClockTarget,
  type SplitScopeAuthorityPlacementPlanner,
  type SplitScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  getScopeAuthorityProvisioningReceipt,
} from "../src/scopeAuthorityProvisioningReceipt";
import {
  insertInitialScopeClockInTransactionResult,
} from "../src/scopeClockInitialization";
import {
  deployments,
  fxControlScopes,
  fxSystemScopeClocks,
} from "../src/schema";

const schemaLocator = Object.freeze({
  kind: "schema_per_scope",
  databaseKey: "primary",
  schemaName: "fx_split_schema",
}) satisfies SplitScopePhysicalLocator;

const databaseLocator = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "scope_database",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;

type ForbiddenEnsureInputField = Extract<
  keyof EnsureSplitScopeAuthorityInput,
  | "scopeId"
  | "physicalLocator"
  | "initialEpoch"
  | "storageGeneration"
  | "storageGenerationFence"
  | "lastCommitSeq"
  | "lastOutboxSeq"
  | "database"
  | "connectionString"
>;

type ForbiddenRootProvisioningMethod = Extract<
  keyof FlarexPersistence,
  | "ensureSplitScopeAuthority"
  | "resolveSplitScopeClockTarget"
  | "publishSplitScopeReady"
  | "insertScopeClock"
>;

describe("split scope authority provisioning", { timeout: 20_000 }, () => {
  it("keeps split placement and authority mutation behind server composition", () => {
    expectTypeOf<ForbiddenEnsureInputField>().toEqualTypeOf<never>();
    expectTypeOf<ForbiddenRootProvisioningMethod>().toEqualTypeOf<never>();
    expectTypeOf<ReturnType<SplitScopeAuthorityPlacementPlanner["plan"]>>()
      .toEqualTypeOf<SplitScopePhysicalLocator>();
    expectTypeOf<EnsureSplitScopeAuthorityResult["receipt"]["state"]>()
      .toEqualTypeOf<"ready">();
  });

  it("fails invalid trusted placement before creating control metadata", async () => {
    const { control, target } = await migratedPair();
    let resolverCalls = 0;
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: {
        plan: () => ({
          kind: "schema_per_scope",
          databaseKey: " ",
          schemaName: "public",
        }),
      },
      targetResolver: {
        async resolve(locator) {
          resolverCalls += 1;
          return createPGliteLocatedSplitScopeClockTarget(target, locator);
        },
      },
      randomUuid: throwingUuid("invalid placement must not allocate authority"),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_invalid_placement",
        projectId: "project_invalid_placement",
      }),
    ).rejects.toBeInstanceOf(SplitScopeAuthorityPlacementPlanningError);
    await expect(
      control.getDeploymentMetadata("deployment_invalid_placement"),
    ).resolves.toBeNull();
    expect(resolverCalls).toBe(0);
  });

  it("publishes exact authority across two stores for both split locators", async () => {
    for (const physicalLocator of [schemaLocator, databaseLocator] as const) {
      const { control, target } = await migratedPair();
      const locatedTarget = createPGliteLocatedSplitScopeClockTarget(
        target,
        physicalLocator,
      );
      let plannerCalls = 0;
      let resolverCalls = 0;
      const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
        placementPlanner: {
          plan(input) {
            plannerCalls += 1;
            expect(input).toEqual({
              deploymentId: `deployment_fresh_${physicalLocator.kind}`,
              projectId: `project_fresh_${physicalLocator.kind}`,
            });
            return physicalLocator;
          },
        },
        targetResolver: {
          async resolve(persistedLocator) {
            resolverCalls += 1;
            expect(persistedLocator).toEqual(physicalLocator);
            expect(Object.isFrozen(persistedLocator)).toBe(true);
            await expect(controlReceiptCount(control)).resolves.toBe("1");
            await expect(controlClockCount(control)).resolves.toBe("0");
            return locatedTarget;
          },
        },
        randomUuid: uuidSequence(1, 2),
      });

      const result = await provisioner.ensure({
        deploymentId: `deployment_fresh_${physicalLocator.kind}`,
        projectId: `project_fresh_${physicalLocator.kind}`,
      });

      expect(result).toMatchObject({
        status: "published_ready",
        createdDeployment: true,
        scope: {
          deploymentId: `deployment_fresh_${physicalLocator.kind}`,
          physicalLocator,
        },
        receipt: {
          state: "ready",
          physicalLocator,
          initialEpoch: `epoch_${testUuid(2)}`,
        },
      });
      expect(plannerCalls).toBe(1);
      expect(resolverCalls).toBe(1);
      await expect(control.getScopeClock(result.scope.scopeId)).resolves.toBeNull();
      await expect(target.getScopeClock(result.scope.scopeId)).resolves.toMatchObject({
        scopeId: result.scope.scopeId,
        storageGeneration: "legacy_v1",
        storageGenerationFence: 1n,
        lastCommitSeq: 0n,
        lastOutboxSeq: 0n,
        epoch: `epoch_${testUuid(2)}`,
      });
    }
  }, 20_000);

  it("replays ready authority against the current advanced target clock", async () => {
    const { control, target } = await migratedPair();
    const first = provisionerFor(
      control,
      target,
      schemaLocator,
      uuidSequence(3, 4),
    );
    const created = await first.ensure({
      deploymentId: "deployment_ready_replay",
      projectId: "project_ready_replay",
    });
    await target.drizzle
      .update(fxSystemScopeClocks)
      .set({
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(9n),
        lastCommitSeq: CommitSeqSchema.make(21n),
        lastOutboxSeq: OutboxSeqSchema.make(34n),
        epoch: ScopeEpochSchema.make("epoch_advanced_ready_replay"),
      })
      .where(eq(fxSystemScopeClocks.scopeId, created.scope.scopeId));
    let resolverCalls = 0;
    const replay = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("ready replay must use persisted intent"),
      targetResolver: {
        async resolve(locator) {
          resolverCalls += 1;
          return createPGliteLocatedSplitScopeClockTarget(target, locator);
        },
      },
      randomUuid: throwingUuid("ready replay must not generate authority"),
    });

    await expect(
      replay.ensure({
        deploymentId: "deployment_ready_replay",
        projectId: "project_ready_replay",
      }),
    ).resolves.toMatchObject({
      status: "already_ready",
      createdDeployment: false,
      receipt: { initialEpoch: created.receipt.initialEpoch },
    });
    expect(resolverCalls).toBe(1);
    await expect(target.getScopeClock(created.scope.scopeId)).resolves.toMatchObject({
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
      lastCommitSeq: 21n,
      lastOutboxSeq: 34n,
      epoch: "epoch_advanced_ready_replay",
    });
  });

  it("never recreates a missing target clock after ready publication", async () => {
    const { control, target } = await migratedPair();
    const provisioner = provisionerFor(
      control,
      target,
      databaseLocator,
      uuidSequence(5, 6),
    );
    const created = await provisioner.ensure({
      deploymentId: "deployment_ready_missing_clock",
      projectId: "project_ready_missing_clock",
    });
    await target.drizzle
      .delete(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, created.scope.scopeId));

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_ready_missing_clock",
        projectId: "project_ready_missing_clock",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityConflictError",
      conflict: {
        reason: "locatedClockMissingAfterReady",
        scopeId: created.scope.scopeId,
      },
    });
    await expect(target.getScopeClock(created.scope.scopeId)).resolves.toBeNull();
    await expect(receiptFor(control, created.scope.scopeId)).resolves.toMatchObject({
      state: "ready",
    });
  });

  it("commits a reservation before resolver failure and resumes persisted intent", async () => {
    const { control, target } = await migratedPair();
    let resolverCalls = 0;
    const failing = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: {
        async resolve() {
          resolverCalls += 1;
          throw new Error("resolver-unavailable");
        },
      },
      randomUuid: uuidSequence(7, 8),
    });

    await expect(
      failing.ensure({
        deploymentId: "deployment_resolver_failure",
        projectId: "project_resolver_failure",
      }),
    ).rejects.toBeInstanceOf(SplitScopeAuthorityTargetResolutionError);
    expect(resolverCalls).toBe(1);
    const scope = await control.getScopeMetadataByDeploymentId(
      "deployment_resolver_failure",
    );
    if (scope === null) throw new Error("Expected reserved split scope.");
    await expect(receiptFor(control, scope.scopeId)).resolves.toMatchObject({
      state: "reserved",
      initialEpoch: `epoch_${testUuid(8)}`,
    });
    await expect(target.getScopeClock(scope.scopeId)).resolves.toBeNull();

    const resumed = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("resume must skip placement planning"),
      targetResolver: resolverFor(target),
      randomUuid: throwingUuid("resume must reuse persisted IDs"),
    });
    await expect(
      resumed.ensure({
        deploymentId: "deployment_resolver_failure",
        projectId: "project_resolver_failure",
      }),
    ).resolves.toMatchObject({
      status: "published_ready",
      createdDeployment: false,
      scope: { scopeId: scope.scopeId },
      receipt: { initialEpoch: `epoch_${testUuid(8)}` },
    });
  });

  it("recovers target commit response loss without replacing the epoch", async () => {
    const { control, target } = await migratedPair();
    const locatedTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      databaseLocator,
    );
    const responseLossTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: locatedTarget.physicalLocator,
      async ensureInitialClock(input) {
        await locatedTarget.ensureInitialClock(input);
        throw new Error("target-commit-response-lost");
      },
      getCurrentClock: (scopeId) => locatedTarget.getCurrentClock(scopeId),
    };
    const failing = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(databaseLocator),
      targetResolver: fixedResolver(responseLossTarget),
      randomUuid: uuidSequence(9, 10),
    });

    await expect(
      failing.ensure({
        deploymentId: "deployment_target_response_loss",
        projectId: "project_target_response_loss",
      }),
    ).rejects.toThrow("target-commit-response-lost");
    const scope = await requireScopeForDeployment(
      control,
      "deployment_target_response_loss",
    );
    await expect(receiptFor(control, scope.scopeId)).resolves.toMatchObject({
      state: "reserved",
      initialEpoch: `epoch_${testUuid(10)}`,
    });
    await expect(target.getScopeClock(scope.scopeId)).resolves.toMatchObject({
      epoch: `epoch_${testUuid(10)}`,
    });

    const resumed = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("target replay must use the receipt"),
      targetResolver: fixedResolver(locatedTarget),
      randomUuid: throwingUuid("target replay must keep the winning epoch"),
    });
    await expect(
      resumed.ensure({
        deploymentId: "deployment_target_response_loss",
        projectId: "project_target_response_loss",
      }),
    ).resolves.toMatchObject({
      status: "published_ready",
      receipt: { initialEpoch: `epoch_${testUuid(10)}` },
    });
  });

  it("rolls back target-local initialization independently", async () => {
    const { control, target } = await migratedPair();
    const rollbackTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: schemaLocator,
      ensureInitialClock: (input) =>
        target.drizzle.transaction(async (tx) => {
          Result.getOrThrow(
            await insertInitialScopeClockInTransactionResult(tx, input),
          );
          throw new Error("target-transaction-rollback");
        }),
      getCurrentClock: (scopeId) => target.getScopeClock(scopeId),
    };
    const failing = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: fixedResolver(rollbackTarget),
      randomUuid: uuidSequence(11, 12),
    });

    await expect(
      failing.ensure({
        deploymentId: "deployment_target_rollback",
        projectId: "project_target_rollback",
      }),
    ).rejects.toThrow("target-transaction-rollback");
    const scope = await requireScopeForDeployment(
      control,
      "deployment_target_rollback",
    );
    await expect(target.getScopeClock(scope.scopeId)).resolves.toBeNull();
    await expect(receiptFor(control, scope.scopeId)).resolves.toMatchObject({
      state: "reserved",
    });
  });

  it("preserves a conflicting target clock while the receipt stays reserved", async () => {
    const { control, target } = await migratedPair();
    const scopeId = ScopeIdSchema.make(`scope_${testUuid(13)}`);
    await insertClock(target, scopeId, ScopeEpochSchema.make("epoch_conflicting_target"));
    const provisioner = provisionerFor(
      control,
      target,
      databaseLocator,
      uuidSequence(13, 14),
    );

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_target_conflict",
        projectId: "project_target_conflict",
      }),
    ).rejects.toBeInstanceOf(SplitScopeInitialClockConflictError);
    await expect(target.getScopeClock(scopeId)).resolves.toMatchObject({
      epoch: "epoch_conflicting_target",
    });
    await expect(receiptFor(control, scopeId)).resolves.toMatchObject({
      state: "reserved",
      initialEpoch: `epoch_${testUuid(14)}`,
    });
  });

  it("rejects wrong resolver placement before target writes", async () => {
    const { control, target } = await migratedPair();
    const wrongTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      databaseLocator,
    );
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: fixedResolver(wrongTarget),
      randomUuid: uuidSequence(15, 16),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_wrong_resolver",
        projectId: "project_wrong_resolver",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityTargetResolutionError",
      conflict: { reason: "resolvedLocatorMismatch" },
    });
    const scope = await requireScopeForDeployment(
      control,
      "deployment_wrong_resolver",
    );
    await expect(receiptFor(control, scope.scopeId)).resolves.toMatchObject({
      state: "reserved",
    });
    await expect(target.getScopeClock(scope.scopeId)).resolves.toBeNull();
  });

  it("rejects an inexact located-target result before publishing ready", async () => {
    const { control } = await migratedPair();
    const inexactTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: schemaLocator,
      async ensureInitialClock(input) {
        return {
          status: "created",
          clock: {
            scopeId: input.scopeId,
            storageGeneration:
              LegacyV1StorageGenerationSchema.make("legacy_v1"),
            storageGenerationFence: StorageGenerationFenceSchema.make(1n),
            lastCommitSeq: CommitSeqSchema.make(0n),
            lastOutboxSeq: OutboxSeqSchema.make(0n),
            epoch: ScopeEpochSchema.make("epoch_inexact_target_result"),
            updatedAt: new Date(),
          },
        };
      },
      async getCurrentClock() {
        return null;
      },
    };
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: fixedResolver(inexactTarget),
      randomUuid: uuidSequence(17, 18),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_inexact_target_result",
        projectId: "project_inexact_target_result",
      }),
    ).rejects.toBeInstanceOf(SplitScopeInitialClockConflictError);
    const scopeId = ScopeIdSchema.make(`scope_${testUuid(17)}`);
    await expect(receiptFor(control, scopeId)).resolves.toMatchObject({
      state: "reserved",
      initialEpoch: `epoch_${testUuid(18)}`,
    });
  });

  it("rejects ambiguous existing deployment and scope states", async () => {
    const { control, target } = await migratedPair();
    await control.insertDeploymentMetadata({
      deploymentId: "deployment_existing_bare",
      projectId: "project_existing_bare",
    });
    await control.insertDeploymentMetadata({
      deploymentId: "deployment_existing_shared",
      projectId: "project_existing_shared",
    });
    await control.insertScopeMetadata({
      scopeId: ScopeIdSchema.make("scope_existing_shared"),
      deploymentId: "deployment_existing_shared",
      physicalLocator: {
        kind: "shared_database",
        databaseKey: "primary",
        schemaName: "public",
      },
    });
    await control.insertDeploymentMetadata({
      deploymentId: "deployment_existing_no_receipt",
      projectId: "project_existing_no_receipt",
    });
    await control.insertScopeMetadata({
      scopeId: ScopeIdSchema.make("scope_existing_no_receipt"),
      deploymentId: "deployment_existing_no_receipt",
      physicalLocator: schemaLocator,
    });
    let resolverCalls = 0;
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("existing rows must skip planning"),
      targetResolver: {
        async resolve(locator) {
          resolverCalls += 1;
          return createPGliteLocatedSplitScopeClockTarget(target, locator);
        },
      },
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_existing_bare",
        projectId: "project_existing_bare",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityConflictError",
      conflict: { reason: "existingDeploymentMissingScope" },
    });
    await expect(
      provisioner.ensure({
        deploymentId: "deployment_existing_shared",
        projectId: "project_existing_shared",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityConflictError",
      conflict: { reason: "unsupportedExistingScopeTopology" },
    });
    await expect(
      provisioner.ensure({
        deploymentId: "deployment_existing_no_receipt",
        projectId: "project_existing_no_receipt",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityConflictError",
      conflict: { reason: "existingScopeMissingReceipt" },
    });
    expect(resolverCalls).toBe(0);
  });

  it("rolls back every candidate control transaction when IDs are exhausted", async () => {
    const { control, target } = await migratedPair();
    const uuidIndexes = Array.from({ length: 16 }, (_, index) => 20 + index);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const scopeIndex = uuidIndexes[attempt * 2];
      if (scopeIndex === undefined) throw new Error("Missing collision UUID.");
      await insertClock(
        control,
        ScopeIdSchema.make(`scope_${testUuid(scopeIndex)}`),
        ScopeEpochSchema.make(`epoch_control_collision_${attempt}`),
      );
    }
    let resolverCalls = 0;
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(databaseLocator),
      targetResolver: {
        async resolve(locator) {
          resolverCalls += 1;
          return createPGliteLocatedSplitScopeClockTarget(target, locator);
        },
      },
      randomUuid: uuidSequence(...uuidIndexes),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_control_rollback",
        projectId: "project_control_rollback",
      }),
    ).rejects.toBeInstanceOf(ScopeAuthorityIdGenerationExhaustedError);
    await expect(
      control.getDeploymentMetadata("deployment_control_rollback"),
    ).resolves.toBeNull();
    await expect(controlReceiptCount(control)).resolves.toBe("0");
    expect(resolverCalls).toBe(0);
  });

  it("refuses final publication after project drift and leaves target authority intact", async () => {
    const { control, target } = await migratedPair();
    const locatedTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      schemaLocator,
    );
    const driftingTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: locatedTarget.physicalLocator,
      async ensureInitialClock(input) {
        const result = await locatedTarget.ensureInitialClock(input);
        await control.drizzle
          .update(deployments)
          .set({ projectId: "project_drifted" })
          .where(eq(deployments.deploymentId, "deployment_project_drift"));
        return result;
      },
      getCurrentClock: (scopeId) => locatedTarget.getCurrentClock(scopeId),
    };
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: fixedResolver(driftingTarget),
      randomUuid: uuidSequence(40, 41),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_project_drift",
        projectId: "project_original",
      }),
    ).rejects.toMatchObject({
      name: "SplitScopeAuthorityConflictError",
      conflict: { reason: "projectMismatch" },
    });
    const scope = await requireScopeForDeployment(
      control,
      "deployment_project_drift",
    );
    await expect(receiptFor(control, scope.scopeId)).resolves.toMatchObject({
      state: "reserved",
    });
    await expect(target.getScopeClock(scope.scopeId)).resolves.toMatchObject({
      epoch: `epoch_${testUuid(41)}`,
    });
  });

  it("refuses final publication after scope locator drift", async () => {
    const { control, target } = await migratedPair();
    const locatedTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      schemaLocator,
    );
    const driftingTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: locatedTarget.physicalLocator,
      async ensureInitialClock(input) {
        const result = await locatedTarget.ensureInitialClock(input);
        await control.drizzle
          .update(fxControlScopes)
          .set({
            isolationKind: databaseLocator.kind,
            physicalLocator: databaseLocator,
          })
          .where(eq(fxControlScopes.scopeId, input.scopeId));
        return result;
      },
      getCurrentClock: (scopeId) => locatedTarget.getCurrentClock(scopeId),
    };
    const provisioner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(schemaLocator),
      targetResolver: fixedResolver(driftingTarget),
      randomUuid: uuidSequence(44, 45),
    });

    await expect(
      provisioner.ensure({
        deploymentId: "deployment_scope_drift",
        projectId: "project_scope_drift",
      }),
    ).rejects.toMatchObject({
      name: "ScopeAuthorityProvisioningReceiptConflictError",
      conflict: { reason: "scopePlacementMismatch" },
    });
    const scopeId = ScopeIdSchema.make(`scope_${testUuid(44)}`);
    await expect(receiptFor(control, scopeId)).resolves.toMatchObject({
      state: "reserved",
      physicalLocator: schemaLocator,
    });
    await expect(target.getScopeClock(scopeId)).resolves.toMatchObject({
      epoch: `epoch_${testUuid(45)}`,
    });
  });

  it("converges concurrent reconcilers on one ready receipt", async () => {
    const { control, target } = await migratedPair();
    const input = {
      deploymentId: "deployment_concurrent_reconcile",
      projectId: "project_concurrent_reconcile",
    } as const;
    const reserveOnly = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(databaseLocator),
      targetResolver: {
        async resolve() {
          throw new Error("reserve-only");
        },
      },
      randomUuid: uuidSequence(46, 47),
    });
    await expect(reserveOnly.ensure(input)).rejects.toBeInstanceOf(
      SplitScopeAuthorityTargetResolutionError,
    );
    const locatedTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      databaseLocator,
    );
    const first = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("reserved replay must skip planning"),
      targetResolver: fixedResolver(locatedTarget),
      randomUuid: throwingUuid("reserved replay must keep authority"),
    });
    const second = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("reserved replay must skip planning"),
      targetResolver: fixedResolver(locatedTarget),
      randomUuid: throwingUuid("reserved replay must keep authority"),
    });

    const results = await Promise.all([first.ensure(input), second.ensure(input)]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "already_ready",
      "published_ready",
    ]);
    expect(results[0]?.scope.scopeId).toBe(results[1]?.scope.scopeId);
    expect(results[0]?.receipt.initialEpoch).toBe(
      results[1]?.receipt.initialEpoch,
    );
    const scopeId = ScopeIdSchema.make(`scope_${testUuid(46)}`);
    await expect(target.getScopeClock(scopeId)).resolves.toMatchObject({
      epoch: `epoch_${testUuid(47)}`,
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
    });
    await expect(receiptFor(control, scopeId)).resolves.toMatchObject({
      state: "ready",
      initialEpoch: `epoch_${testUuid(47)}`,
    });
  });

  it("handles the stale-reserved race after another reconciler publishes and advances", async () => {
    const { control, target } = await migratedPair();
    const input = {
      deploymentId: "deployment_ready_race",
      projectId: "project_ready_race",
    } as const;
    const initialFailure = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: fixedPlanner(databaseLocator),
      targetResolver: {
        async resolve() {
          throw new Error("reserve-only-failure");
        },
      },
      randomUuid: uuidSequence(42, 43),
    });
    await expect(initialFailure.ensure(input)).rejects.toBeInstanceOf(
      SplitScopeAuthorityTargetResolutionError,
    );

    const realTarget = createPGliteLocatedSplitScopeClockTarget(
      target,
      databaseLocator,
    );
    const entered = new Deferred<void>();
    const release = new Deferred<void>();
    const delayedTarget: LocatedSplitScopeClockTarget = {
      physicalLocator: realTarget.physicalLocator,
      async ensureInitialClock(targetInput) {
        entered.resolve(undefined);
        await release.promise;
        return realTarget.ensureInitialClock(targetInput);
      },
      getCurrentClock: (scopeId) => realTarget.getCurrentClock(scopeId),
    };
    const delayed = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("reserved replay skips planning"),
      targetResolver: fixedResolver(delayedTarget),
      randomUuid: throwingUuid("reserved replay keeps authority"),
    });
    const delayedResult = delayed.ensure(input);
    await entered.promise;

    const winner = createPGliteSplitScopeAuthorityProvisioner(control, {
      placementPlanner: throwingPlanner("winner replay skips planning"),
      targetResolver: fixedResolver(realTarget),
      randomUuid: throwingUuid("winner replay keeps authority"),
    });
    const winnerResult = await winner.ensure(input);
    await target.drizzle
      .update(fxSystemScopeClocks)
      .set({
        storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(2n),
        lastCommitSeq: CommitSeqSchema.make(1n),
        lastOutboxSeq: OutboxSeqSchema.make(1n),
        epoch: ScopeEpochSchema.make("epoch_after_ready_race"),
      })
      .where(eq(fxSystemScopeClocks.scopeId, winnerResult.scope.scopeId));
    release.resolve(undefined);

    await expect(delayedResult).resolves.toMatchObject({
      status: "already_ready",
      receipt: { initialEpoch: winnerResult.receipt.initialEpoch },
    });
    await expect(target.getScopeClock(winnerResult.scope.scopeId)).resolves.toMatchObject({
      storageGeneration: "flarexdb_v1",
      epoch: "epoch_after_ready_race",
    });
  });
});

type TestPersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

async function migratedPair(): Promise<{
  readonly control: TestPersistence;
  readonly target: TestPersistence;
}> {
  const control = await createPGlitePersistence();
  const target = await createPGlitePersistence();
  await Promise.all([control.migrate(), target.migrate()]);
  return { control, target };
}

function provisionerFor(
  control: TestPersistence,
  target: TestPersistence,
  physicalLocator: SplitScopePhysicalLocator,
  randomUuid: () => string,
): SplitScopeAuthorityProvisioner {
  return createPGliteSplitScopeAuthorityProvisioner(control, {
    placementPlanner: fixedPlanner(physicalLocator),
    targetResolver: resolverFor(target),
    randomUuid,
  });
}

function fixedPlanner(
  physicalLocator: SplitScopePhysicalLocator,
): SplitScopeAuthorityPlacementPlanner {
  return {
    plan: () => physicalLocator,
  };
}

function throwingPlanner(message: string): SplitScopeAuthorityPlacementPlanner {
  return {
    plan() {
      throw new Error(message);
    },
  };
}

function resolverFor(
  target: TestPersistence,
): { resolve(locator: SplitScopePhysicalLocator): Promise<LocatedSplitScopeClockTarget> } {
  return {
    async resolve(locator) {
      return createPGliteLocatedSplitScopeClockTarget(target, locator);
    },
  };
}

function fixedResolver(
  target: LocatedSplitScopeClockTarget,
): { resolve(locator: SplitScopePhysicalLocator): Promise<LocatedSplitScopeClockTarget> } {
  return {
    async resolve() {
      return target;
    },
  };
}

async function receiptFor(
  persistence: TestPersistence,
  scopeId: ScopeId,
) {
  return getScopeAuthorityProvisioningReceipt(persistence.drizzle, scopeId);
}

async function requireScopeForDeployment(
  persistence: TestPersistence,
  deploymentId: string,
) {
  const scope = await persistence.getScopeMetadataByDeploymentId(deploymentId);
  if (scope === null) {
    throw new Error(`Expected scope for deployment ${deploymentId}.`);
  }
  return scope;
}

async function controlReceiptCount(
  persistence: TestPersistence,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(
    "select count(*)::text as count from fx_control_scope_provisioning",
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error("Receipt count query returned no row.");
  return count;
}

async function controlClockCount(
  persistence: TestPersistence,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(
    "select count(*)::text as count from fx_system_scope_clock",
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error("Clock count query returned no row.");
  return count;
}

async function insertClock(
  persistence: TestPersistence,
  scopeId: ScopeId,
  epoch: ScopeEpoch,
): Promise<void> {
  await persistence.drizzle.insert(fxSystemScopeClocks).values({
    scopeId,
    storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    lastCommitSeq: CommitSeqSchema.make(0n),
    lastOutboxSeq: OutboxSeqSchema.make(0n),
    epoch,
  });
}

function uuidSequence(...indexes: readonly number[]): () => string {
  let position = 0;
  return () => {
    const index = indexes[position];
    if (index === undefined) throw new Error("UUID test sequence was exhausted.");
    position += 1;
    return testUuid(index);
  };
}

function throwingUuid(message: string): () => string {
  return () => {
    throw new Error(message);
  };
}

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

class Deferred<Value> {
  readonly promise: Promise<Value>;
  private resolvePromise: ((value: Value) => void) | null = null;

  constructor() {
    this.promise = new Promise<Value>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: Value): void {
    const resolve = this.resolvePromise;
    if (resolve === null) return;
    this.resolvePromise = null;
    resolve(value);
  }
}
