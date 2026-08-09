import { Client, type PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  classifyPostgresLocatedReadCommittedSettlementV1,
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  createPostgresClientLocatedReadCommittedTransactionRunnerV1,
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

describe("pooled located READ COMMITTED connection errors", () => {
  it("observes a checked-out fatal error, preserves it, and discards before returning", async () => {
    const events: string[] = [];
    const callbackCause = new Error("query rejected after termination");
    const connectionCause = Object.assign(
      new Error("terminating connection due to transaction timeout"),
      { code: "25P04" },
    );
    let discard: Error | boolean | undefined;
    const client = fakePoolClient(events, (cause) => {
      discard = cause;
      events.push("release");
    });
    const run = createPostgresLocatedReadCommittedTransactionRunnerV1({
      connect: (callback) => {
        callback(undefined, client);
        expect(client.listenerCount("error")).toBe(1);
      },
    });

    await expect(run(async () => {
      events.push("callback");
      expect(client.emit("error", connectionCause)).toBe(true);
      throw callbackCause;
    })).rejects.toMatchObject({
      issue: {
        kind: "callbackCleanupFailed",
        callbackCause,
        transactionCause: {
          connectionCause,
          settlementCause: callbackCause,
        },
      },
    });
    expect(discard).toMatchObject({
      connectionCause,
      settlementCause: callbackCause,
    });
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback",
      "rollback",
      "release",
    ]);
    expect(client.listenerCount("error")).toBe(0);
  });
});

describe("connected Client located READ COMMITTED runner", () => {
  it("uses the supplied Client without acquiring or ending it", async () => {
    const events: string[] = [];
    const client = fakeClient(events);
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      client,
      {
        quarantine: () => {
          events.push("quarantine");
        },
      },
    );

    await expect(run(async () => {
      events.push("callback");
      return "committed";
    })).resolves.toBe("committed");
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback",
      "commit",
    ]);
  });

  it("preserves an exact callback rollback without quarantining", async () => {
    const events: string[] = [];
    const callbackCause = new Error("callback rejected");
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      fakeClient(events),
      {
        quarantine: () => {
          events.push("quarantine");
        },
      },
    );

    await expect(run(async () => {
      events.push("callback");
      throw callbackCause;
    })).rejects.toMatchObject({
      issue: { kind: "callbackRolledBack", callbackCause },
    });
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback",
      "rollback",
    ]);
  });

  it("serializes complete transactions on the connected Client", async () => {
    const events: string[] = [];
    let enterFirst: (() => void) | undefined;
    const firstEntered = new Promise<void>((resolve) => {
      enterFirst = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const firstCanComplete = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      fakeClient(events),
      { quarantine: () => undefined },
    );

    const first = run(async () => {
      events.push("callback:first");
      enterFirst?.();
      await firstCanComplete;
      return "first";
    });
    await firstEntered;
    const second = run(async () => {
      events.push("callback:second");
      return "second";
    });
    await Promise.resolve();
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback:first",
    ]);

    releaseFirst?.();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback:first",
      "commit",
      "begin",
      "set transaction isolation level read committed",
      "callback:second",
      "commit",
    ]);
  });

  it("quarantines post-callback uncertainty and retains quarantine failure", async () => {
    const events: string[] = [];
    const commitCause = new Error("commit response lost");
    const quarantineCause = new Error("quarantine callback failed");
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      fakeClient(events, { commitCause }),
      {
        quarantine: (discard) => {
          expect(discard).toMatchObject({ cause: commitCause });
          events.push("quarantine");
          throw quarantineCause;
        },
      },
    );

    await expect(run(async () => {
      events.push("callback");
      return "possibly committed";
    })).rejects.toMatchObject({
      issue: {
        kind: "decisionUncertain",
        settlementCause: { cause: commitCause },
        releaseCause: { cause: commitCause },
        quarantineCause,
      },
    });
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback",
      "commit",
      "rollback",
      "quarantine",
    ]);
    await expect(run(async () => {
      events.push("callback:after-quarantine");
      return "forbidden";
    })).rejects.toMatchObject({
      issue: {
        kind: "infrastructureFailure",
        phase: "acquire",
        cause: { cause: commitCause },
      },
    });
    expect(events).not.toContain("callback:after-quarantine");
  });

  it("refuses queued work after an uncertain transaction", async () => {
    const events: string[] = [];
    const commitCause = new Error("commit response lost");
    let enterCommit: (() => void) | undefined;
    const commitEntered = new Promise<void>((resolve) => {
      enterCommit = resolve;
    });
    let releaseCommit: (() => void) | undefined;
    const commitCanFail = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      fakeClient(events, {
        beforeCommit: async () => {
          enterCommit?.();
          await commitCanFail;
        },
        commitCause,
      }),
      {
        quarantine: () => {
          events.push("quarantine");
        },
      },
    );

    const uncertain = run(async () => {
      events.push("callback:first");
      return "uncertain";
    });
    await commitEntered;
    const queued = run(async () => {
      events.push("callback:queued");
      return "forbidden";
    });
    releaseCommit?.();

    await expect(uncertain).rejects.toMatchObject({
      issue: { kind: "decisionUncertain" },
    });
    await expect(queued).rejects.toMatchObject({
      issue: {
        kind: "infrastructureFailure",
        phase: "acquire",
      },
    });
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback:first",
      "commit",
      "rollback",
      "quarantine",
    ]);
  });

  it("retains callback and rollback causes before quarantining", async () => {
    const events: string[] = [];
    const callbackCause = new Error("callback rejected");
    const rollbackCause = new Error("rollback response lost");
    const run = createPostgresClientLocatedReadCommittedTransactionRunnerV1(
      fakeClient(events, { rollbackCause }),
      {
        quarantine: (discard) => {
          expect(discard).toMatchObject({ cause: rollbackCause });
          events.push("quarantine");
        },
      },
    );

    await expect(run(async () => {
      events.push("callback");
      throw callbackCause;
    })).rejects.toMatchObject({
      issue: {
        kind: "callbackCleanupFailed",
        callbackCause,
        transactionCause: { cause: rollbackCause },
        releaseCause: { cause: rollbackCause },
      },
    });
    expect(events).toEqual([
      "begin",
      "set transaction isolation level read committed",
      "callback",
      "rollback",
      "quarantine",
    ]);
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

function fakeClient(
  events: string[],
  faults: Readonly<{
    readonly beforeCommit?: () => Promise<void>;
    readonly commitCause?: unknown;
    readonly rollbackCause?: unknown;
  }> = {},
): Client {
  const client = new Client();
  Object.defineProperties(client, {
    connect: {
      configurable: true,
      value: () => {
        throw new Error("The connected runner must not call Client.connect.");
      },
    },
    end: {
      configurable: true,
      value: () => {
        throw new Error("The connected runner must not call Client.end.");
      },
    },
    release: {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("The connected runner must not release its Client.");
      },
    },
    query: {
      configurable: true,
      value: async function (this: unknown, query: unknown) {
        expect(this).toBe(client);
        const text = queryText(query);
        events.push(text);
        if (text === "commit") await faults.beforeCommit?.();
        if (text === "commit" && faults.commitCause !== undefined) {
          throw faults.commitCause;
        }
        if (text === "rollback" && faults.rollbackCause !== undefined) {
          throw faults.rollbackCause;
        }
        return {
          command: text,
          fields: [],
          oid: 0,
          rowCount: 0,
          rows: [],
        };
      },
    },
  });
  return client;
}

function fakePoolClient(
  events: string[],
  release: (error?: Error | boolean) => void,
): PoolClient {
  return Object.assign(fakeClient(events), { release });
}

function queryText(query: unknown): string {
  if (typeof query === "string") return normalizeSql(query);
  if (typeof query !== "object" || query === null) {
    throw new Error("Expected a PostgreSQL query string or config.");
  }
  const descriptor = Object.getOwnPropertyDescriptor(query, "text");
  if (descriptor === undefined || !("value" in descriptor) ||
    typeof descriptor.value !== "string") {
    throw new Error("Expected PostgreSQL query config text.");
  }
  return normalizeSql(descriptor.value);
}

function normalizeSql(sql: string): string {
  return sql.trim().replaceAll(/\s+/g, " ").toLowerCase();
}
