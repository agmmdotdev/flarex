import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";

import {
  ScopeSyncChangeSourceInputV1Error,
  createScopeSyncChangeSourceReaderV1,
  scopeSyncChangeSourceTimeoutErrorFromCauseV1,
} from "../src/scopeSyncChangeSourceReadV1";
import { fxSystemCommits, fxSystemScopeClocks } from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";

describe("FX02-A correlated query-sync source read - PGlite", {
  timeout: 240_000,
}, () => {
  it("classifies direct and Drizzle-wrapped database timeout SQLSTATEs", () => {
    for (const cause of [
      Object.freeze({ code: "57014" }),
      Object.freeze({ cause: Object.freeze({ code: "25P04" }) }),
    ]) {
      expect(scopeSyncChangeSourceTimeoutErrorFromCauseV1(cause)).toMatchObject({
        _tag: "ScopeSyncChangeSourceTimeoutV1Error",
        operation: "readAfter",
      });
    }
    expect(scopeSyncChangeSourceTimeoutErrorFromCauseV1(
      Object.freeze({ cause: Object.freeze({ code: "08006" }) }),
    )).toBeNull();
  });

  it("correlates clock, bounded feed pages, and terminal active authority", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/query-sync-source-pglite",
      compatibilityDate: "2026-09-01",
    });
    await fixture.seedUserDocument("first");

    const scope = projectScopeIdUuidV1(
      fixture.active.basis.authority.scopeId,
    );
    const epoch = projectScopeEpochUuidV1(
      fixture.active.basis.authority.epoch,
    );
    await fixture.target.drizzle.transaction(async tx => {
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
    const reader = createScopeSyncChangeSourceReaderV1(fixture.target.drizzle);

    const first = await runEffect(reader.readAfter({
      scopeUuid: scope.scopeUuid,
      requestedSourceEpoch: epoch.epochUuid,
      requestedAfterCommitSeqExclusive: CommitSeqSchema.make(0n),
      maximumCommittedBatches: 1,
      maximumElapsedMilliseconds: 1_000,
    }));
    expect(first).toMatchObject({
      kind: "page",
      currentSourceEpoch: epoch.epochUuid,
      observedLatestCommitSeq: 2n,
      readThroughCommitSeq: 1n,
      hasMore: true,
      authorityObservation: null,
    });
    if (first.kind !== "page") throw new Error("Expected the first page.");
    expect(first.commits.map(commit => commit.commitSeq)).toEqual([1n]);
    expect(first.commits[0]?.appRowChanges).toHaveLength(1);

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
    if (terminal.kind !== "page") throw new Error("Expected a terminal page.");
    expect(terminal.commits.map(commit => commit.commitSeq)).toEqual([2n]);

    const ahead = await runEffect(reader.readAfter({
      scopeUuid: scope.scopeUuid,
      requestedSourceEpoch: epoch.epochUuid,
      requestedAfterCommitSeqExclusive: CommitSeqSchema.make(3n),
      maximumCommittedBatches: 10,
      maximumElapsedMilliseconds: 1_000,
    }));
    expect(ahead).toMatchObject({
      kind: "cursorAhead",
      observedLatestCommitSeq: 2n,
      requestedAfterCommitSeqExclusive: 3n,
    });

    const replaced = await runEffect(reader.readAfter({
      scopeUuid: scope.scopeUuid,
      requestedSourceEpoch: decodeScopeEpochUuidV1(
        "92000000-0000-0000-0000-000000000099",
      ),
      requestedAfterCommitSeqExclusive: CommitSeqSchema.make(0n),
      maximumCommittedBatches: 10,
      maximumElapsedMilliseconds: 1_000,
    }));
    expect(replaced).toMatchObject({
      kind: "epochReplaced",
      currentSourceEpoch: epoch.epochUuid,
      observedLatestCommitSeq: 2n,
    });

    await fixture.target.drizzle.update(fxSystemScopeClocks)
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
      observedLatestCommitSeq: 2n,
    });

    for (const invalidInput of [{
      maximumCommittedBatches: 0,
      maximumElapsedMilliseconds: 1_000,
      reason: "maximumCommittedBatchesInvalid" as const,
    }, {
      maximumCommittedBatches: 10,
      maximumElapsedMilliseconds: 60_001,
      reason: "maximumElapsedMillisecondsInvalid" as const,
    }]) {
      const failure = await runEffectFailure(reader.readAfter({
        scopeUuid: scope.scopeUuid,
        requestedSourceEpoch: decodeScopeEpochUuidV1(
          "92000000-0000-0000-0000-000000000099",
        ),
        requestedAfterCommitSeqExclusive: CommitSeqSchema.make(0n),
        maximumCommittedBatches: invalidInput.maximumCommittedBatches,
        maximumElapsedMilliseconds: invalidInput.maximumElapsedMilliseconds,
      }));
      expect(failure).toBeInstanceOf(ScopeSyncChangeSourceInputV1Error);
      expect(failure).toMatchObject({ reason: invalidInput.reason });
    }
  });
});
