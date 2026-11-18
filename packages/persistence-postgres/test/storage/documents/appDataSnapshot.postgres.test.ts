import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { eq, sql } from "drizzle-orm";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { createAppDataSnapshotResolver } from "../../../src/storage/documents/appDataSnapshot";
import {
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../../src/database/postgres";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../../src/database/schema";
import { insertInitialScopeClockInTransactionResult } from "../../../src/scope/scopeClockInitialization";
import type { ExactTrustedScopeAuthorityResolutionPorts } from "../../../src/scope/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const firstCommitSeq = 9_007_199_254_740_993n;
const secondCommitSeq = firstCommitSeq + 1n;

describePostgres("real Postgres app-data snapshot resolution", { concurrent: false }, () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("captures exact committed scope authority without pinning or mutation", async () => {
    await withPersistence(async (persistence) => {
      const provisioned =
        await createPostgresSharedScopeAuthorityProvisioner(persistence, {
          physicalLocator: sharedLocator,
          randomUuid: uuidSequence(
            "31000000-0000-4000-8000-000000000001",
            "31000000-0000-4000-8000-000000000002",
          ),
        }).ensure({
          deploymentId: "deployment_snapshot_postgres",
          projectId: "project_snapshot_postgres",
        });
      await updateClock(persistence, provisioned.scope.scopeId, firstCommitSeq);
      const clockBeforeResolution = await persistence.getScopeClock(
        provisioned.scope.scopeId,
      );
      const resolver = createAppDataSnapshotResolver(
        sharedResolutionPorts(persistence),
      );

      const first = await runEffect(resolver.resolveCurrent({
        deploymentId: provisioned.scope.deploymentId, scopeId: provisioned.scope.scopeId,
      }));

      expect(first).toEqual({
        snapshotToken: {
          scopeId: provisioned.scope.scopeId,
          epoch: provisioned.clock.epoch,
          commitSeq: firstCommitSeq,
        },
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 19n,
      });
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.snapshotToken)).toBe(true);
      await expect(
        persistence.getScopeClock(provisioned.scope.scopeId),
      ).resolves.toEqual(clockBeforeResolution);

      await updateClock(
        persistence,
        provisioned.scope.scopeId,
        secondCommitSeq,
      );
      const second = await runEffect(resolver.resolveCurrent({
        deploymentId: provisioned.scope.deploymentId, scopeId: provisioned.scope.scopeId,
      }));

      expect(first.snapshotToken.commitSeq).toBe(firstCommitSeq);
      expect(second.snapshotToken.commitSeq).toBe(secondCommitSeq);
    });
  });

  it("resolves exact snapshots for two shops sharing one deployment", async () => {
    await withPersistence(async (persistence) => {
      const first = await createPostgresSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: sharedLocator,
        randomUuid: uuidSequence(
          "31000000-0000-4000-8000-000000000011",
          "31000000-0000-4000-8000-000000000012",
        ),
      }).ensure({ deploymentId: "deployment_snapshot_two_shops", projectId: "project_snapshot_two_shops" });
      const secondScopeId = ScopeIdSchema.make("scope_31000000-0000-4000-8000-000000000013");
      const secondEpoch = ScopeEpochSchema.make("epoch_31000000-0000-4000-8000-000000000014");
      await persistence.insertScopeMetadata({
        scopeId: secondScopeId, deploymentId: first.scope.deploymentId, physicalLocator: sharedLocator,
      });
      await persistence.drizzle.transaction(async tx => Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx,
        { scopeId: secondScopeId, initialEpoch: secondEpoch })));
      await updateClock(persistence, first.scope.scopeId, 7n);
      await updateClock(persistence, secondScopeId, 9n);
      const resolver = createAppDataSnapshotResolver(sharedResolutionPorts(persistence));
      const [one, two] = await Promise.all([
        runEffect(resolver.resolveCurrent({ deploymentId: first.scope.deploymentId, scopeId: first.scope.scopeId })),
        runEffect(resolver.resolveCurrent({ deploymentId: first.scope.deploymentId, scopeId: secondScopeId })),
      ]);
      expect(one.snapshotToken).toMatchObject({ scopeId: first.scope.scopeId, commitSeq: 7n });
      expect(two.snapshotToken).toMatchObject({ scopeId: secondScopeId, commitSeq: 9n });
      await expect(runEffect(resolver.resolveCurrent({ deploymentId: "wrong_deployment", scopeId: secondScopeId })))
        .rejects.toMatchObject({ failure: { reason: "scopeDeploymentMismatch", scopeId: secondScopeId } });
    });
  });
});

function sharedResolutionPorts(
  persistence: PostgresFlarexPersistence,
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
        getCurrentClock: (scopeId) => persistence.getScopeClock(scopeId),
      }),
    },
  } satisfies ExactTrustedScopeAuthorityResolutionPorts;
}

async function updateClock(
  persistence: PostgresFlarexPersistence,
  scopeId: ScopeId,
  commitSeq: bigint,
): Promise<void> {
  await persistence.drizzle.transaction(async tx => {
    await tx.update(fxSystemScopeExecutionAuthorities)
    .set({
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(19n),
      updatedAt: sql<Date>`now()`,
    })
    .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(commitSeq),
      updatedAt: sql<Date>`now()` }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
  });
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
