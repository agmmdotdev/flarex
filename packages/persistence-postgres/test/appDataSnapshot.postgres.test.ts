import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  StorageGenerationFenceSchema,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createAppDataSnapshotResolver } from "../src/appDataSnapshot";
import {
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { fxSystemScopeClocks } from "../src/schema";
import type { TrustedScopeAuthorityResolutionPorts } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const describePostgres = postgresUrl === null ? describe.skip : describe;

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const firstCommitSeq = 9_007_199_254_740_993n;
const secondCommitSeq = firstCommitSeq + 1n;

describePostgres("real Postgres app-data snapshot resolution", () => {
  it("captures exact committed scope authority without pinning or mutation", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
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

      const first = await runEffect(resolver.resolveCurrent(
        provisioned.scope.deploymentId,
      ));

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
      const second = await runEffect(resolver.resolveCurrent(
        provisioned.scope.deploymentId,
      ));

      expect(first.snapshotToken.commitSeq).toBe(firstCommitSeq);
      expect(second.snapshotToken.commitSeq).toBe(secondCommitSeq);
    });
  });
});

function sharedResolutionPorts(
  persistence: PostgresFlarexPersistence,
): TrustedScopeAuthorityResolutionPorts {
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
  } satisfies TrustedScopeAuthorityResolutionPorts;
}

async function updateClock(
  persistence: PostgresFlarexPersistence,
  scopeId: ScopeId,
  commitSeq: bigint,
): Promise<void> {
  await persistence.drizzle
    .update(fxSystemScopeClocks)
    .set({
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(19n),
      lastCommitSeq: CommitSeqSchema.make(commitSeq),
      updatedAt: sql<Date>`now()`,
    })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
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
