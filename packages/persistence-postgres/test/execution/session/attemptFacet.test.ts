import { describe, expect, it } from "vitest";
import { Result } from "effect";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
  type FreshTransactionAttemptFacetInputV1,
} from "../../../src/execution/transactionSessionAttemptFacet";
import { fxSystemTransactionJournals } from "../../../src/database/schema";

const VALID_INPUT = Object.freeze({
  scopeUuid: ScopeUuidV1Schema.make(
    "89000000-0000-0000-0000-000000000001",
  ),
  sessionId: TransactionSessionIdV1Schema.make(
    "89000000-0000-4000-8000-000000000002",
  ),
  attemptFence: TransactionAttemptFenceSchema.make(2n),
  executionProfile: "durableOperations",
  snapshotEpochUuid: ScopeEpochUuidV1Schema.make(
    "89000000-0000-0000-0000-000000000003",
  ),
  snapshotCommitSeq: CommitSeqSchema.make(11n),
  databaseNowMilliseconds: 1_725_000_000_000,
  authorizationGrantExpiresAtMilliseconds: 1_725_000_120_000,
  hardExpiresAtMilliseconds: 1_725_000_180_000,
  leaseDurationMilliseconds: 60_000,
} satisfies FreshTransactionAttemptFacetInputV1);

describe("fresh transaction-attempt facet", () => {
  it("constructs the pristine facet from validated database time", () => {
    const facet = Result.getOrThrow(
      buildFreshTransactionAttemptFacetV1(VALID_INPUT),
    );

    expect(facet.sessionUpdatedAt.getTime()).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.leaseExpiresAt.getTime()).toBe(
      VALID_INPUT.databaseNowMilliseconds + VALID_INPUT.leaseDurationMilliseconds,
    );
    expect(facet.journalRoot.creationTimeSeed).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.journalRoot.nextCreationTime).toBe(
      VALID_INPUT.databaseNowMilliseconds,
    );
    expect(facet.journalRoot.state).toBe("open");
    expect(facet.journalRoot.participantWorkBytes).toBe(0);
    expect(facet.journalRoot.participantWorkCalls).toBe(0);
  });

  it("retains the explicitly selected finite execution profile", () => {
    const facet = Result.getOrThrow(buildFreshTransactionAttemptFacetV1({
      ...VALID_INPUT,
      executionProfile: "finiteRoot",
    }));
    expect(facet.journalRoot.executionProfile).toBe("finiteRoot");
  });

  it("refuses a fresh root with native work counters already charged", () => {
    const expected = Result.getOrThrow(buildFreshTransactionAttemptFacetV1(VALID_INPUT)).journalRoot;
    const pristine = {
      ...expected,
      lastSyscallSequence: expected.lastSyscallSequence ?? CommitFinalSyscallSequenceV1Schema.make(0n),
      receiptEvidenceBytes: expected.receiptEvidenceBytes ?? 0,
      participantWorkBytes: expected.participantWorkBytes ?? 0,
      participantWorkCalls: expected.participantWorkCalls ?? 0,
      readDocuments: expected.readDocuments ?? 0,
      readSemanticBytes: expected.readSemanticBytes ?? 0,
      pointDependencyCount: expected.pointDependencyCount ?? 0,
      indexedQuerySyscalls: expected.indexedQuerySyscalls ?? 0,
      indexRangeDependencyCount: expected.indexRangeDependencyCount ?? 0,
      indexRangeDependencyEvidenceBytes: expected.indexRangeDependencyEvidenceBytes ?? 0,
      relationReadSyscalls: expected.relationReadSyscalls ?? 0,
      relationDependencyCount: expected.relationDependencyCount ?? 0,
      relationBaseOccurrences: expected.relationBaseOccurrences ?? 0,
      writeOperations: expected.writeOperations ?? 0,
      writeSemanticBytes: expected.writeSemanticBytes ?? 0,
      materialWriteEventEvidenceBytes: expected.materialWriteEventEvidenceBytes ??
        CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
      failureDimension: null,
      sealedJournalBytes: null,
      sealedJournalSha256: null,
      sealedResultValueCodecVersion: null,
      sealedResultSemanticBytes: null,
      sealedResultBytes: null,
      sealedResultSha256: null,
      sealedAt: null,
    } satisfies typeof fxSystemTransactionJournals.$inferSelect;
    expect(isPristineFreshTransactionAttemptJournalRootV1(pristine, expected)).toBe(true);
    expect(isPristineFreshTransactionAttemptJournalRootV1({ ...pristine, participantWorkBytes: 1 }, expected))
      .toBe(false);
    expect(isPristineFreshTransactionAttemptJournalRootV1({ ...pristine, participantWorkCalls: 1 }, expected))
      .toBe(false);
  });

  it.each([
    [
      "databaseTimeInvalid",
      { databaseNowMilliseconds: 0 },
    ],
    [
      "leaseDurationInvalid",
      { leaseDurationMilliseconds: 0 },
    ],
    [
      "authorityExpired",
      {
        authorizationGrantExpiresAtMilliseconds:
          VALID_INPUT.databaseNowMilliseconds,
      },
    ],
  ] as const)("returns %s through Result", (expected, override) => {
    const result = buildFreshTransactionAttemptFacetV1({
      ...VALID_INPUT,
      ...override,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(expected);
  });

  it("does not reclassify caller accessor defects as invalid time", () => {
    const defect = new Error("database time accessor defect");
    const input = { ...VALID_INPUT };
    Object.defineProperty(input, "databaseNowMilliseconds", {
      enumerable: true,
      get: () => {
        throw defect;
      },
    });

    expect(() => buildFreshTransactionAttemptFacetV1(input)).toThrow(defect);
  });
});
