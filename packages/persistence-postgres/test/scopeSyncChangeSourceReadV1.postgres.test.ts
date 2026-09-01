import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";

import {
  createScopeSyncChangeSourceReaderV1,
} from "../src/scopeSyncChangeSourceReadV1";
import { fxSystemCommits, fxSystemScopeClocks } from "../src/schema";
import { runEffect } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPostgresFixture,
} from "./fixtures/applicationNativeMutationTestFixture";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("FX02-A correlated query-sync source read - PostgreSQL", {
  timeout: 300_000,
}, () => {
  it("proves bounded feed and terminal active authority in one real snapshot", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/query-sync-source-postgres",
        compatibilityDate: "2026-09-01",
      }, { control, target });
      await fixture.seedUserDocument("first");
      const scope = projectScopeIdUuidV1(
        fixture.active.basis.authority.scopeId,
      );
      const epoch = projectScopeEpochUuidV1(
        fixture.active.basis.authority.epoch,
      );
      await target.drizzle.transaction(async tx => {
        await tx.insert(fxSystemCommits).values({
          scopeUuid: scope.scopeUuid,
          epochUuid: epoch.epochUuid,
          commitSeq: CommitSeqSchema.make(2n),
          changeCount: 0,
        });
        await tx.update(fxSystemScopeClocks)
          .set({ lastCommitSeq: CommitSeqSchema.make(2n) })
          .where(eq(fxSystemScopeClocks.scopeUuid, scope.scopeUuid));
      });

      const reader = createScopeSyncChangeSourceReaderV1(target.drizzle);
      const first = await runEffect(reader.readAfter({
        scopeUuid: scope.scopeUuid,
        requestedSourceEpoch: epoch.epochUuid,
        requestedAfterCommitSeqExclusive: CommitSeqSchema.make(0n),
        maximumCommittedBatches: 1,
        maximumElapsedMilliseconds: 1_000,
      }));
      expect(first).toMatchObject({
        kind: "page",
        observedLatestCommitSeq: 2n,
        readThroughCommitSeq: 1n,
        hasMore: true,
        authorityObservation: null,
      });

      const terminal = await runEffect(reader.readAfter({
        scopeUuid: scope.scopeUuid,
        requestedSourceEpoch: epoch.epochUuid,
        requestedAfterCommitSeqExclusive: CommitSeqSchema.make(1n),
        maximumCommittedBatches: 10,
        maximumElapsedMilliseconds: 1_000,
      }));
      expect(terminal).toMatchObject({
        kind: "page",
        observedLatestCommitSeq: 2n,
        readThroughCommitSeq: 2n,
        hasMore: false,
        authorityObservation: {
          scopeUuid: scope.scopeUuid,
          epochUuid: epoch.epochUuid,
          observedAtCommitSeq: 2n,
          activationSequence: fixture.active.basis.activationSequence,
          activeHeadSha256Hex: encodeBytesToLowercaseHex(
            fixture.active.basis.headSha256,
          ),
        },
      });

      await target.drizzle.update(fxSystemScopeClocks)
        .set({ oldestAvailableCommitSeq: CommitSeqSchema.make(2n) })
        .where(eq(fxSystemScopeClocks.scopeUuid, scope.scopeUuid));
      const unavailable = await runEffect(reader.readAfter({
        scopeUuid: scope.scopeUuid,
        requestedSourceEpoch: epoch.epochUuid,
        requestedAfterCommitSeqExclusive: CommitSeqSchema.make(0n),
        maximumCommittedBatches: 10,
        maximumElapsedMilliseconds: 1_000,
      }));
      expect(unavailable).toMatchObject({
        kind: "historyUnavailable",
        replayableAfterCommitSeqExclusive: 1n,
        retainedFromCommitSeqInclusive: 2n,
      });
    });
  });
});
