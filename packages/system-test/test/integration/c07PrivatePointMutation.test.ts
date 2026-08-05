import { eq } from "drizzle-orm";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { decodeCatalogIndexDefinitionId } from "flarex-protocol/catalog";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";

import * as persistenceRoot from "@flarex/persistence-postgres";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "@flarex/persistence-postgres/internal/system-test/appRows";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "@flarex/persistence-postgres/internal/intrinsic-creation-time-index-build-v1";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "@flarex/persistence-postgres/internal/index-build-reconciliation-v1";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "@flarex/persistence-postgres/internal/system-test/schema";
import {
  proveC07PrivatePointMutationCorrectnessV1,
  type C07SeedLiveRowV1,
} from "../../support/c07PrivatePointMutationHarness";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";
import { runSystemTestEffectV1 } from "../../support/systemTestEffectBoundaryV1";

const physicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "c07-private-pglite",
  schemaName: "public",
} as const);

describe("C07 private point-mutation correctness gate — PGlite", () => {
  it("assembles authenticated initial execution, OCC rerun, commit, and cold replay without a production export", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "proveC07PrivatePointMutationCorrectnessV1" |
        "C07PrivatePointMutationLaneV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect(
      "proveC07PrivatePointMutationCorrectnessV1" in persistenceRoot,
    ).toBe(false);

    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveC07PrivatePointMutationCorrectnessV1({
      name: "pglite",
      persistence,
      controlDb: persistence.drizzle,
      ensureScope: async (deploymentId, projectId, randomUuid) => {
        const provisioned =
          await createPGliteSharedScopeAuthorityProvisioner(
            persistence,
            { physicalLocator, randomUuid },
          ).ensure({ deploymentId, projectId });
        return Object.freeze({
          scopeId: decodeReplacementScopeIdV1(
            provisioned.scope.scopeId,
          ),
        });
      },
      locateTarget: () =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
      seedBaselineLiveRow: (input) =>
        seedBaselineLiveRow(persistence, input),
      afterBaselineSeed: async input => {
        const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
          persistence,
          physicalLocator,
        );
        const ports = {
          controlDb: persistence.drizzle,
          authority: {
            scopeMetadata: {
              getScopeMetadataByDeploymentId: (deploymentId: string) =>
                persistence.getScopeMetadataByDeploymentId(deploymentId),
            },
            provisioningReceipts: {
              getScopeAuthorityProvisioningReceipt: async () => null,
            },
            scopeClockTargets: { resolve: async () => target },
          },
        } as const;
        await runSystemTestEffectV1(reconcilePublishedIndexBuildsV1Effect(ports, {
          deploymentId: input.deploymentId,
          schemaVersionId: input.schemaVersionId,
        }));
        for (let step = 0; step < 8; step += 1) {
          const result = await runSystemTestEffectV1(
            buildIntrinsicCreationTimeIndexV1Effect(ports, {
              deploymentId: input.deploymentId,
              indexDefinitionId: decodeCatalogIndexDefinitionId(1),
              pageSize: 8,
            }),
          );
          if (result.lifecycle === "validating") break;
        }
        await persistence.query(
          `update fx_system_index_build_state
           set backfill_cursor_row_id = $1
           where scope_id = $2 and index_definition_id = 1`,
          [appRowIdHexV1ToBytes(input.rowId), input.scopeId],
        );
      },
    });

    expect(proof).toMatchObject({
      lane: "pglite",
      clonedActivationFailure:
        "InvalidActivatedPointMutationSessionV1Error",
      firstResultKind: "published",
      firstCommitSeq: "3",
      competingResultKind: "published",
      competingCommitSeq: "2",
      runtimeExecutions: 2,
      competingRuntimeExecutions: 1,
      disposedRuntimeResponses: 3,
      consumedActivationFailure: "InvalidPointMutationExecutionClaimV1Error",
      coldOutcomeKind: "available",
      coldOutcomeCommitSeq: "3",
      coldOutcomeValue: { ok: true },
      durable: {
        sessionCount: "2",
        lifecycle: "committed",
        revisions: "3",
        currentRows: "1",
        currentCommitSeq: "3",
        currentValue: { name: "c07-pglite-2" },
        commitSeqs: ["1", "2", "3"],
        changeCommitSeqs: ["1", "2", "3"],
        outcomeCommitSeqs: ["2", "3"],
        outboxSeqs: ["1", "2"],
        outboxCommitSeqs: ["2", "3"],
        lastCommitSeq: "3",
        lastOutboxSeq: "2",
      },
    });
    const intrinsic = await persistence.query<{
      revisions: string;
      current_commit_seq: string;
      tombstones: string;
      lifecycle: string;
      cursor_is_null: boolean;
    }>(
      `select
         (select count(*)::text from fx_app_index_entry_rev) as revisions,
         (select commit_seq::text from fx_app_index_entry_current limit 1)
           as current_commit_seq,
         (select count(*)::text from fx_app_index_entry_rev where is_tombstone)
           as tombstones,
         (select lifecycle from fx_system_index_build_state limit 1)
           as lifecycle,
         (select backfill_cursor_row_id is null
            from fx_system_index_build_state limit 1) as cursor_is_null`,
    );
    expect(intrinsic.rows).toEqual([{
      revisions: "3",
      current_commit_seq: "3",
      tombstones: "0",
      lifecycle: "validating",
      cursor_is_null: true,
    }]);
  }, 120_000);
});

async function seedBaselineLiveRow(
  persistence: PGliteFlarexPersistence,
  input: C07SeedLiveRowV1,
): Promise<void> {
  const clock = await persistence.getScopeClock(input.scopeId);
  if (clock === null) throw new Error("C07 PGlite scope clock is missing.");
  const scopeUuid = projectScopeIdUuidV1(input.scopeId).scopeUuid;
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    input.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: input.scopeId,
      tableId: input.tableId,
      rowId: input.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: input.schemaVersionId,
      creationTime: decodeAppCreationTimeV1(input.creationTime),
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: input.tableId,
      rowId: appRowIdHexV1ToBytes(input.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid));
  });
}
