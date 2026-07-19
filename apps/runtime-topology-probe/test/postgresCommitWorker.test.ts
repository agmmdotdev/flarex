import { describe, expect, it } from "vitest";

import { decodeProbeMockFinishRequestV1Effect } from "../src/commitProtocol";
import {
  commitOrFindExactOutcome,
  type PostgresCommitTransactionPort,
} from "../src/postgresCommitTransaction";
import { runEffectTestSync } from "./effectTest";

const decodedRequest = runEffectTestSync(decodeProbeMockFinishRequestV1Effect({
  protocolVersion: 1,
  runId: "p28_postgres_transaction",
  sampleId: "rtp-sample-p28_postgres_transaction-0",
  sampleOrdinal: 0,
  scopeId: "rtp-scope-p28_postgres_transaction",
  scenario: "facet_finalizer_postgres_warm_invoke",
  commitSeq: 1,
  sessionId: "rtp-session-p28_postgres_transaction-0",
  sessionMode: "reuse-session",
  attemptId: "rtp-attempt-p28_postgres_transaction-0-0",
  codeMode: "stable",
  codeId: "rtp-code-invoke-finalizer-postgres-warm-v2-stable",
  journalEntries: 2,
  sealDigest: "0".repeat(64),
  snapshotRevision: 0,
  resultDigest: "1".repeat(64),
  commitIntentDigest: "2".repeat(64),
}));
if (decodedRequest.scenario === "commit_wake") {
  throw new Error("test request must be a Postgres finalizer");
}
const request = decodedRequest;

class ScriptedTransaction implements PostgresCommitTransactionPort {
  readonly events: string[] = [];
  cursor: number | null = 0;
  existingRequestJson: string | null = null;
  failLock = false;
  advanceSucceeds = true;

  async begin(): Promise<void> {
    this.events.push("begin");
  }

  async lockCursor(scopeId: string): Promise<number | null> {
    this.events.push(`lock:${scopeId}`);
    if (this.failLock) throw new Error("injected pre-commit failure");
    return this.cursor;
  }

  async findOutcome(attemptId: string): Promise<string | null> {
    this.events.push(`find:${attemptId}`);
    return this.existingRequestJson;
  }

  async insertOutcome(
    insertedRequest: typeof request,
    requestJson: string,
  ): Promise<void> {
    this.events.push(`insert:${insertedRequest.attemptId}`);
    this.existingRequestJson = requestJson;
  }

  async advanceCursor(): Promise<boolean> {
    this.events.push("advance");
    return this.advanceSucceeds;
  }

  async commit(): Promise<void> {
    this.events.push("commit");
  }

  async rollback(): Promise<void> {
    this.events.push("rollback");
  }
}

describe("Postgres finalizer transaction", () => {
  it("serializes before the exact duplicate decision", async () => {
    const transaction = new ScriptedTransaction();
    transaction.cursor = 1;
    transaction.existingRequestJson = JSON.stringify(request);

    await expect(commitOrFindExactOutcome(transaction, request))
      .resolves.toBe("recovered");
    expect(transaction.events).toEqual([
      "begin",
      `lock:${request.scopeId}`,
      `find:${request.attemptId}`,
      "commit",
    ]);
  });

  it("commits an absent exact attempt and advances the cursor atomically", async () => {
    const transaction = new ScriptedTransaction();

    await expect(commitOrFindExactOutcome(transaction, request))
      .resolves.toBe("committed");
    expect(transaction.events).toEqual([
      "begin",
      `lock:${request.scopeId}`,
      `find:${request.attemptId}`,
      `insert:${request.attemptId}`,
      "advance",
      "commit",
    ]);
  });

  it("can retry the same fenced transaction after a pre-commit failure", async () => {
    const failed = new ScriptedTransaction();
    failed.failLock = true;
    await expect(commitOrFindExactOutcome(failed, request)).rejects.toThrow(
      "injected pre-commit failure",
    );
    expect(failed.events.at(-1)).toBe("rollback");

    const retry = new ScriptedTransaction();
    await expect(commitOrFindExactOutcome(retry, request))
      .resolves.toBe("committed");
  });

  it("rolls back conflicting evidence and failed cursor advancement", async () => {
    const conflict = new ScriptedTransaction();
    conflict.existingRequestJson = "{}";
    await expect(commitOrFindExactOutcome(conflict, request)).rejects.toThrow(
      "attempt fence conflict",
    );
    expect(conflict.events.at(-1)).toBe("rollback");

    const failedAdvance = new ScriptedTransaction();
    failedAdvance.advanceSucceeds = false;
    await expect(commitOrFindExactOutcome(failedAdvance, request))
      .rejects.toThrow("cursor fence update failed");
    expect(failedAdvance.events.at(-1)).toBe("rollback");
  });
});
