import { describe, expect, it } from "vitest";

import {
  classifyPostgresLocatedReadCommittedSettlementV1,
} from "../src/postgresLocatedReadCommitted";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../src/transactionSessionAttemptKernel";

describe("Postgres located READ COMMITTED settlement provenance", () => {
  it("returns only a fully settled success", () => {
    expect(classifyPostgresLocatedReadCommittedSettlementV1(
      "callbackCompleted",
      undefined,
      Object.freeze({ kind: "succeeded", value: "committed" }),
      Object.freeze({ kind: "released" }),
    )).toBe("committed");
  });

  it("proves rollback only when the exact callback cause survives cleanup", () => {
    const callbackCause = Object.assign(new Error("serialization failure"), {
      code: "40001",
    });
    const failure = captureFailure(() =>
      classifyPostgresLocatedReadCommittedSettlementV1(
        "callbackRejected",
        callbackCause,
        Object.freeze({ kind: "failed", cause: callbackCause }),
        Object.freeze({ kind: "released" }),
      )
    );
    expect(failure).toBeInstanceOf(
      LocatedReadCommittedTransactionFailureV1,
    );
    expect(failure).toMatchObject({
      issue: { kind: "callbackRolledBack", callbackCause },
    });
  });

  it("retains callback, transaction, and release cleanup causes", () => {
    const callbackCause = new Error("callback failed");
    const transactionCause = new Error("rollback failed");
    const releaseCause = new Error("release failed");
    const failure = captureFailure(() =>
      classifyPostgresLocatedReadCommittedSettlementV1(
        "callbackRejected",
        callbackCause,
        Object.freeze({ kind: "failed", cause: transactionCause }),
        Object.freeze({ kind: "failed", cause: releaseCause }),
      )
    );
    expect(failure).toMatchObject({
      issue: {
        kind: "callbackCleanupFailed",
        callbackCause,
        transactionCause,
        releaseCause,
      },
    });
  });

  it("keeps post-callback transaction and release failures uncertain", () => {
    const commitCause = new Error("commit response lost");
    const quarantineCause = new Error("discard failed");
    expect(captureFailure(() =>
      classifyPostgresLocatedReadCommittedSettlementV1(
        "callbackCompleted",
        undefined,
        Object.freeze({ kind: "failed", cause: commitCause }),
        Object.freeze({ kind: "failed", cause: quarantineCause }),
      )
    )).toMatchObject({
      issue: {
        kind: "decisionUncertain",
        settlementCause: commitCause,
        releaseCause: quarantineCause,
      },
    });

    const releaseCause = new Error("release response lost");
    expect(captureFailure(() =>
      classifyPostgresLocatedReadCommittedSettlementV1(
        "callbackCompleted",
        undefined,
        Object.freeze({ kind: "succeeded", value: "committed" }),
        Object.freeze({ kind: "failed", cause: releaseCause }),
      )
    )).toMatchObject({
      issue: {
        kind: "decisionUncertain",
        settlementCause: releaseCause,
      },
    });
  });

  it("keeps begin and configuration failures ordinary", () => {
    const configurationCause = Object.assign(
      new Error("transaction configuration failed"),
      { code: "40P01" },
    );
    expect(captureFailure(() =>
      classifyPostgresLocatedReadCommittedSettlementV1(
        "configuring",
        undefined,
        Object.freeze({ kind: "failed", cause: configurationCause }),
        Object.freeze({ kind: "released" }),
      )
    )).toMatchObject({
      issue: {
        kind: "infrastructureFailure",
        phase: "beginOrConfigure",
        cause: configurationCause,
      },
    });
  });
});

function captureFailure(run: () => unknown): unknown {
  try {
    run();
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected the settlement classifier to fail.");
}
