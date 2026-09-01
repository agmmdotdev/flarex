import {
  decodeQuerySyncSourceReadResponseV1,
  encodeQuerySyncSourceReadRequestV1,
  querySyncSourceReadFailureHeaderV1,
  querySyncSourceReadMediaTypeV1,
  querySyncSourceReadRequiredAtLeastHeaderV1,
  type QuerySyncSourceReadBudgetV1,
} from "@flarex/executor-http/internal-query-sync-source-read-v1";
import {
  CommitFeedScopeNotFoundErrorV1,
} from "@flarex/persistence-postgres/internal/commit-feed";
import {
  ScopeSyncChangeSourceAuthorityV1Error,
  ScopeSyncChangeSourceSqlV1Error,
  ScopeSyncChangeSourceTimeoutV1Error,
  type ScopeSyncChangeSourceReaderV1,
} from "@flarex/persistence-postgres/internal/scope-sync-change-source-read-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Effect, Result } from "effect";
import {
  CommitSeqSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import { makeQuerySyncSourceReadHostV1 } from "../src/querySyncSourceRead";

const SCOPE = decodeScopeUuidV1(
  "91000000-0000-0000-0000-000000000001",
);
const EPOCH = decodeScopeEpochUuidV1(
  "92000000-0000-0000-0000-000000000001",
);
const MODEL = "flarexdb.application-query.v1" as const;
const ZERO = CommitSeqSchema.make(0n);
const ONE = CommitSeqSchema.make(1n);
const TWO = CommitSeqSchema.make(2n);

const generousBudget = Object.freeze({
  maximumCommittedBatches: 10,
  maximumResponseBytes: 8_192,
  maximumModelSemanticWorkUnits: 1_000,
  maximumModelSemanticBytes: 8_192,
  maximumDependencyKeyExaminations: 1_000,
  maximumCanonicalDependencyBytes: 8_192,
  maximumElapsedMilliseconds: 1_000,
}) satisfies QuerySyncSourceReadBudgetV1;

describe("executor query-sync source read host", () => {
  it("returns a measured complete commit prefix when the full page is too large", async () => {
    const host = makeQuerySyncSourceReadHostV1(pageReader());
    const full = await host(sourceRequest(generousBudget));
    expect(full.status).toBe(200);
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    const fullPage = unwrap(decodeQuerySyncSourceReadResponseV1(
      fullBytes,
      generousBudget.maximumResponseBytes,
    ));
    expect(fullPage.value.kind).toBe("page");
    if (fullPage.value.kind !== "page") throw new Error("Expected a page.");
    expect(fullPage.value.commits).toHaveLength(2);
    expect(full.headers.get("content-length")).toBe(String(fullBytes.byteLength));

    const constrainedBudget = Object.freeze({
      ...generousBudget,
      maximumResponseBytes: fullBytes.byteLength - 1,
    });
    const constrained = await host(sourceRequest(constrainedBudget));
    expect(constrained.status).toBe(200);
    const constrainedBytes = new Uint8Array(await constrained.arrayBuffer());
    const prefix = unwrap(decodeQuerySyncSourceReadResponseV1(
      constrainedBytes,
      constrainedBudget.maximumResponseBytes,
    ));
    expect(prefix.value).toMatchObject({
      kind: "page",
      hasMore: true,
      readThroughCommitSeq: ONE,
    });
    if (prefix.value.kind !== "page") throw new Error("Expected a page.");
    expect(prefix.value.commits).toHaveLength(1);
    expect(prefix.value.authorityObservation).toBeNull();
  });

  it("reports the first indivisible response size at the byte boundary", async () => {
    const response = await makeQuerySyncSourceReadHostV1(pageReader())(
      sourceRequest({ ...generousBudget, maximumResponseBytes: 1 }),
    );
    expect(response.status).toBe(422);
    expect(response.headers.get(querySyncSourceReadFailureHeaderV1)).toBe(
      "sourceTransportBytes",
    );
    expect(Number(response.headers.get(
      querySyncSourceReadRequiredAtLeastHeaderV1,
    ))).toBeGreaterThan(1);
  });

  it("rejects invalid requests before reading and redacts resource failures", async () => {
    let reads = 0;
    const invalid = await makeQuerySyncSourceReadHostV1({
      readAfter: () => {
        reads += 1;
        return Effect.die("must not run");
      },
    })(new Request("https://executor.test/internal/v1/query-sync/source/read-after", {
      method: "GET",
    }));
    expect(invalid.status).toBe(405);
    expect(reads).toBe(0);

    const secret = new Error("secret postgres location");
    const reports: unknown[] = [];
    const failingReader: ScopeSyncChangeSourceReaderV1 = Object.freeze({
      readAfter: () => Effect.fail(new ScopeSyncChangeSourceSqlV1Error({
        operation: "readAfter",
        cause: secret,
      })),
    });
    const failed = await makeQuerySyncSourceReadHostV1(failingReader, {
      reportResourceFailure: failure => Effect.sync(() => {
        reports.push(failure);
      }),
    })(sourceRequest(generousBudget));
    expect(failed.status).toBe(503);
    expect(failed.headers.get(querySyncSourceReadFailureHeaderV1)).toBe(
      "resource",
    );
    expect(await failed.text()).not.toContain("secret postgres location");
    expect(reports).toEqual([{ operation: "source", cause: secret }]);
  });

  it("maps scope, authority, corruption, and timeout faults exactly", async () => {
    const faults = [
      {
        error: new CommitFeedScopeNotFoundErrorV1({ scopeUuid: SCOPE }),
        status: 404,
        failure: null,
      },
      {
        error: new ScopeSyncChangeSourceAuthorityV1Error({
          reason: "activeHeadMissing",
          scopeUuid: SCOPE,
        }),
        status: 409,
        failure: "authority",
      },
      {
        error: new ScopeSyncChangeSourceAuthorityV1Error({
          reason: "scopeClockInvalid",
          scopeUuid: SCOPE,
        }),
        status: 500,
        failure: "corruption",
      },
      {
        error: new ScopeSyncChangeSourceTimeoutV1Error({
          operation: "readAfter",
        }),
        status: 504,
        failure: "timeout",
      },
    ] as const;
    for (const fault of faults) {
      const reader: ScopeSyncChangeSourceReaderV1 = Object.freeze({
        readAfter: () => Effect.fail(fault.error),
      });
      const response = await makeQuerySyncSourceReadHostV1(reader)(
        sourceRequest(generousBudget),
      );
      expect(response.status).toBe(fault.status);
      expect(response.headers.get(querySyncSourceReadFailureHeaderV1)).toBe(
        fault.failure,
      );
    }
  });
});

function pageReader(): ScopeSyncChangeSourceReaderV1 {
  return Object.freeze({
    readAfter: () => Effect.succeed(Object.freeze({
      kind: "page" as const,
      scopeUuid: SCOPE,
      requestedSourceEpoch: EPOCH,
      requestedAfterCommitSeqExclusive: ZERO,
      currentSourceEpoch: EPOCH,
      observedLatestCommitSeq: TWO,
      replayableAfterCommitSeqExclusive: ZERO,
      retainedFromCommitSeqInclusive: ONE,
      commits: Object.freeze([ONE, TWO].map(commitSeq => Object.freeze({
        scopeUuid: SCOPE,
        epochUuid: EPOCH,
        commitSeq,
        committedAtMilliseconds: 1_788_134_400_000,
        appRowChanges: Object.freeze([]),
        relationAdjacencyChanges: Object.freeze([]),
      }))),
      readThroughCommitSeq: TWO,
      hasMore: true,
      authorityObservation: null,
    })),
  });
}

function sourceRequest(budget: QuerySyncSourceReadBudgetV1): Request {
  const encoded = unwrap(encodeQuerySyncSourceReadRequestV1({
    codecVersion: 1,
    scopeUuid: SCOPE,
    syncModelId: MODEL,
    requestedSourceEpoch: EPOCH,
    requestedAfterCommitSeqExclusive: ZERO,
    budget,
  }));
  return new Request(
    "https://executor.test/internal/v1/query-sync/source/read-after",
    {
      method: "POST",
      headers: { "content-type": querySyncSourceReadMediaTypeV1 },
      body: copyBytesToArrayBuffer(encoded.bytes),
    },
  );
}

function unwrap<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
