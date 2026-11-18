import {
  useFileScopedPGliteScopeAuthorityPersistence,
} from "../../support/pgliteTestFixture";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { eq } from "drizzle-orm";
import { MetadataSequenceSchema } from "flarex-protocol/commit-protocol";
import { Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  createAppDataSnapshotResolver,
  type ResolvedAppDataSnapshot,
} from "../../../src/storage/documents/appDataSnapshot";
import {
  createPGliteSharedScopeAuthorityProvisioner,
} from "../../../src/database/pglite";
import { fxSystemScopeClocks } from "../../../src/database/schema";
import { insertInitialScopeClockInTransactionResult } from "../../../src/scope/scopeClockInitialization";
import {
  TrustedScopeAuthorityResolutionError,
  type LocatedScopeClockReader,
  type ExactTrustedScopeAuthorityResolutionPorts,
} from "../../../src/scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../../../src/scope/scopeClock";
import type { ScopeMetadataRecord } from "../../../src/scope/scopeMetadata";
import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
} from "../../../src/scope/scopeMetadataTypes";
import { runEffect } from "../../support/effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "shared-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const scopeId = ScopeIdSchema.make(
  "scope_30000000-0000-4000-8000-000000000001",
);
const initialEpoch = ScopeEpochSchema.make(
  "epoch_30000000-0000-4000-8000-000000000002",
);
const highCommitSeq = 9_007_199_254_740_993n;

describe("app-data snapshot resolution", () => {
  const withPersistence = useFileScopedPGliteScopeAuthorityPersistence();

  it("resolves a frozen exact sequence-zero snapshot from persisted authority", async () => {
    await withPersistence(async (persistence) => {
      const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
        persistence,
        {
          physicalLocator: sharedLocator,
          randomUuid: uuidSequence(
            "30000000-0000-4000-8000-000000000011",
            "30000000-0000-4000-8000-000000000012",
          ),
        },
      ).ensure({
        deploymentId: "deployment_snapshot_empty",
        projectId: "project_snapshot_empty",
      });
      const resolver = createAppDataSnapshotResolver(
        sharedResolutionPorts(persistence),
      );

      const resolved = await runEffect(resolver.resolveCurrent({
        deploymentId: "deployment_snapshot_empty", scopeId: provisioned.scope.scopeId,
      }));

      expect(resolved).toEqual({
        snapshotToken: {
          scopeId: provisioned.scope.scopeId,
          epoch: provisioned.clock.epoch,
          commitSeq: 0n,
        },
        storageGeneration: provisioned.clock.storageGeneration,
        storageGenerationFence: provisioned.clock.storageGenerationFence,
      });
      expect(Object.isFrozen(resolver)).toBe(true);
      expect(Object.isFrozen(resolved)).toBe(true);
      expect(Object.isFrozen(resolved.snapshotToken)).toBe(true);
    });
  });

  it("keeps independently provisioned scope snapshots independent", async () => {
    await withPersistence(async (persistence) => {
      const provisioner = createPGliteSharedScopeAuthorityProvisioner(
        persistence,
        {
          physicalLocator: sharedLocator,
          randomUuid: uuidSequence(
            "30000000-0000-4000-8000-000000000021",
            "30000000-0000-4000-8000-000000000022",
            "30000000-0000-4000-8000-000000000023",
            "30000000-0000-4000-8000-000000000024",
          ),
        },
      );
      const first = await provisioner.ensure({
        deploymentId: "deployment_snapshot_first",
        projectId: "project_snapshot_first",
      });
      const second = await provisioner.ensure({
        deploymentId: "deployment_snapshot_second",
        projectId: "project_snapshot_second",
      });
      await persistence.drizzle
        .update(fxSystemScopeClocks)
        .set({ lastCommitSeq: CommitSeqSchema.make(highCommitSeq) })
        .where(eq(fxSystemScopeClocks.scopeId, first.scope.scopeId));
      const resolver = createAppDataSnapshotResolver(
        sharedResolutionPorts(persistence),
      );

      const [firstSnapshot, secondSnapshot] = await Promise.all([
        runEffect(resolver.resolveCurrent({ deploymentId: first.scope.deploymentId, scopeId: first.scope.scopeId })),
        runEffect(resolver.resolveCurrent({ deploymentId: second.scope.deploymentId, scopeId: second.scope.scopeId })),
      ]);

      expect(firstSnapshot.snapshotToken).toMatchObject({
        scopeId: first.scope.scopeId,
        commitSeq: highCommitSeq,
      });
      expect(secondSnapshot.snapshotToken).toMatchObject({
        scopeId: second.scope.scopeId,
        commitSeq: 0n,
      });
      expect(firstSnapshot.snapshotToken.scopeId).not.toBe(
        secondSnapshot.snapshotToken.scopeId,
      );
    });
  });

  it("selects two scopes in one deployment and refuses a mismatched deployment", async () => {
    await withPersistence(async (persistence) => {
      const first = await createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "30000000-0000-4000-8000-000000000031",
          "30000000-0000-4000-8000-000000000032",
        ),
      }).ensure({ deploymentId: "deployment_snapshot_shops", projectId: "project_snapshot_shops" });
      const secondScopeId = ScopeIdSchema.make("scope_30000000-0000-4000-8000-000000000033");
      const secondEpoch = ScopeEpochSchema.make("epoch_30000000-0000-4000-8000-000000000034");
      await persistence.insertScopeMetadata({
        scopeId: secondScopeId, deploymentId: first.scope.deploymentId, physicalLocator: sharedLocator,
      });
      await persistence.drizzle.transaction(async tx => Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx,
        { scopeId: secondScopeId, initialEpoch: secondEpoch })));
      await persistence.drizzle.update(fxSystemScopeClocks)
        .set({ lastCommitSeq: CommitSeqSchema.make(37n) })
        .where(eq(fxSystemScopeClocks.scopeId, secondScopeId));

      const resolver = createAppDataSnapshotResolver(sharedResolutionPorts(persistence));
      const [firstSnapshot, secondSnapshot] = await Promise.all([
        runEffect(resolver.resolveCurrent({ deploymentId: first.scope.deploymentId, scopeId: first.scope.scopeId })),
        runEffect(resolver.resolveCurrent({ deploymentId: first.scope.deploymentId, scopeId: secondScopeId })),
      ]);
      expect(firstSnapshot.snapshotToken).toMatchObject({ scopeId: first.scope.scopeId, commitSeq: 0n });
      expect(secondSnapshot.snapshotToken).toMatchObject({ scopeId: secondScopeId, commitSeq: 37n });
      await expect(runEffect(resolver.resolveCurrent({ deploymentId: "wrong_deployment", scopeId: secondScopeId })))
        .rejects.toMatchObject({ failure: { reason: "scopeDeploymentMismatch", scopeId: secondScopeId } });
    });
  });

  it("projects one located data-plane clock without leaking resolver authority", async () => {
    const advancedClock = scopeClock({
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(9n),
      lastCommitSeq: CommitSeqSchema.make(41n),
      epoch: ScopeEpochSchema.make(
        "epoch_30000000-0000-4000-8000-000000000099",
      ),
    });
    const getCurrentClock = vi.fn(async (_scopeId: ScopeId) => advancedClock);
    const resolver = createAppDataSnapshotResolver(
      fixturePorts({ getCurrentClock }),
    );

    const resolved = await runEffect(
      resolver.resolveCurrent({ deploymentId: "deployment_snapshot", scopeId }),
    );

    expect(resolved).toEqual({
      snapshotToken: {
        scopeId,
        epoch: advancedClock.epoch,
        commitSeq: 41n,
      },
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9n,
    });
    expect(Object.keys(resolved).sort()).toEqual([
      "snapshotToken",
      "storageGeneration",
      "storageGenerationFence",
    ]);
    expect(getCurrentClock).toHaveBeenCalledExactlyOnceWith(scopeId);

    type ForbiddenAuthorityKeys = Extract<
      keyof ResolvedAppDataSnapshot,
      | "deploymentId"
      | "physicalLocator"
      | "lastOutboxSeq"
      | "packageId"
      | "schemaVersionId"
      | "policyFingerprint"
      | "beginTs"
      | "readTs"
    >;
    const exposesNoAuthorityKeys: [ForbiddenAuthorityKeys] extends [never]
      ? true
      : false = true;
    expect(exposesNoAuthorityKeys).toBe(true);
  });

  it("preserves typed fail-closed authority resolution", async () => {
    const resolver = createAppDataSnapshotResolver(
      fixturePorts({ scope: null }),
    );

    await expect(
      runEffect(resolver.resolveCurrent({ deploymentId: "deployment_missing", scopeId })),
    ).rejects.toMatchObject({
      name: "TrustedScopeAuthorityResolutionError",
      failure: {
        reason: "scopeMetadataMissing",
        deploymentId: "deployment_missing",
      },
    } satisfies Partial<TrustedScopeAuthorityResolutionError>);
  });
});

interface SharedResolutionPersistence {
  getScopeMetadata(scopeId: ScopeId): Promise<ScopeMetadataRecord | null>;
  getScopeClock(resolvedScopeId: ScopeId): Promise<ScopeClockRecord | null>;
}

function sharedResolutionPorts(
  persistence: SharedResolutionPersistence,
): ExactTrustedScopeAuthorityResolutionPorts {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async (_scopeId) => {
        throw new Error("Shared snapshot resolution must not read receipts.");
      },
    },
    scopeClockTargets: {
      resolve: async (_physicalLocator) => ({
        physicalLocator: sharedLocator,
        getCurrentClock: (resolvedScopeId) =>
          persistence.getScopeClock(resolvedScopeId),
      }),
    },
  } satisfies ExactTrustedScopeAuthorityResolutionPorts;
}

interface FixtureOptions {
  readonly scope?: ScopeMetadataRecord | null;
  readonly getCurrentClock?: (
    resolvedScopeId: ScopeId,
  ) => Promise<ScopeClockRecord | null>;
}

function fixturePorts(
  options: FixtureOptions = {},
): ExactTrustedScopeAuthorityResolutionPorts {
  const scope = "scope" in options ? options.scope : scopeMetadata();
  const getCurrentClock =
    options.getCurrentClock ??
    (async (_resolvedScopeId: ScopeId) => scopeClock());
  const target = {
    physicalLocator: sharedLocator,
    getCurrentClock,
  } satisfies LocatedScopeClockReader;

  return {
    scopeMetadata: {
      getScopeMetadata: async (_scopeId) => scope ?? null,
    },
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async (_scopeId) => null,
    },
    scopeClockTargets: {
      resolve: async (_physicalLocator: ScopePhysicalLocator) => target,
    },
  } satisfies ExactTrustedScopeAuthorityResolutionPorts;
}

function scopeMetadata(): ScopeMetadataRecord {
  return {
    scopeId,
    deploymentId: "deployment_snapshot",
    isolationKind: sharedLocator.kind,
    physicalLocator: sharedLocator,
    activeSchemaVersionId: null,
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
  } satisfies ScopeMetadataRecord;
}

function scopeClock(
  overrides: Partial<Omit<ScopeClockRecord, "scopeId">> = {},
): ScopeClockRecord {
  return {
    scopeId,
    storageGeneration:
      FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    lastCommitSeq: CommitSeqSchema.make(0n),
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
    oldestAvailableCommitSeq: CommitSeqSchema.make(0n),
    epoch: initialEpoch,
    updatedAt: new Date("2026-07-13T00:00:00.000Z"),
    ...overrides,
  } satisfies ScopeClockRecord;
}

function uuidSequence(...values: readonly string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("UUID sequence exhausted.");
    }
    return value;
  };
}
