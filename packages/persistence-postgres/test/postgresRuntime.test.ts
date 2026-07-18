import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

import type { QueryResult } from "../src";
import {
  PostgresTransactionBeginError,
  PostgresTransactionCommitError,
  runPostgresTransaction,
  runPostgresTransactionEffect,
  type PostgresQueryClient,
} from "../src/postgresRuntime";
import { flarexSchema } from "../src/schema";

describe("runPostgresTransaction", () => {
  it("commits a successful Effect callback", async () => {
    const client = new ScriptedPostgresClient();

    const result = await Effect.runPromise(runPostgresTransactionEffect(
      client,
      testDatabase(),
      () => Effect.succeed("value"),
      testEffectTransactionOptions,
    ));

    expect(result).toBe("value");
    expect(client.statements).toEqual(["BEGIN", "COMMIT"]);
  });

  it("classifies BEGIN rejection without running the callback or rollback", async () => {
    const beginError = new Error("begin failed");
    const client = new ScriptedPostgresClient(
      new Map([["BEGIN", beginError]]),
    );
    let callbackRan = false;

    const failure = await Effect.runPromise(Effect.flip(
      runPostgresTransactionEffect(
        client,
        testDatabase(),
        () => Effect.sync(() => {
          callbackRan = true;
        }),
        testEffectTransactionOptions,
      ),
    ));

    expect(failure).toBeInstanceOf(PostgresTransactionBeginError);
    expect(failure).toMatchObject({ cause: beginError });
    expect(callbackRan).toBe(false);
    expect(client.statements).toEqual(["BEGIN"]);
  });

  it("preserves an Effect callback failure after rollback", async () => {
    const callbackFailure = new Error("typed callback failure");
    const client = new ScriptedPostgresClient();

    const failure = await Effect.runPromise(Effect.flip(
      runPostgresTransactionEffect(
        client,
        testDatabase(),
        () => Effect.fail(callbackFailure),
        testEffectTransactionOptions,
      ),
    ));

    expect(failure).toBe(callbackFailure);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("preserves an Effect callback defect after rollback", async () => {
    const defect = new Error("callback defect");
    const client = new ScriptedPostgresClient();

    const exit = await Effect.runPromiseExit(runPostgresTransactionEffect(
      client,
      testDatabase(),
      () => Effect.die(defect),
      testEffectTransactionOptions,
    ));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("classifies COMMIT rejection and then attempts rollback", async () => {
    const commitError = new Error("commit failed");
    const client = new ScriptedPostgresClient(
      new Map([["COMMIT", commitError]]),
    );

    const failure = await Effect.runPromise(Effect.flip(
      runPostgresTransactionEffect(
        client,
        testDatabase(),
        () => Effect.succeed("value"),
        testEffectTransactionOptions,
      ),
    ));

    expect(failure).toBeInstanceOf(PostgresTransactionCommitError);
    expect(failure).toMatchObject({ cause: commitError });
    expect(client.statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  it("waits for rollback settlement before interruption completes", async () => {
    const callbackEntered = deferredValue<void>();
    const rollbackEntered = deferredValue<void>();
    const releaseRollback = deferredValue<void>();
    const client = new ScriptedPostgresClient(new Map([
      ["ROLLBACK", async () => {
        rollbackEntered.resolve();
        await releaseRollback.promise;
      }],
    ]));
    const fiber = Effect.runFork(runPostgresTransactionEffect(
      client,
      testDatabase(),
      () => Effect.sync(() => callbackEntered.resolve()).pipe(
        Effect.andThen(Effect.never),
      ),
      testEffectTransactionOptions,
    ));

    await callbackEntered.promise;
    const completion = Effect.runPromise(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(
      () => {
        interruptionSettled = true;
      },
    );
    await rollbackEntered.promise;
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      releaseRollback.resolve();
    }

    await interruption;
    const exit = await completion;
    expect(interruptionSettled).toBe(true);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("settles a successful COMMIT before observing interruption", async () => {
    const commitEntered = deferredValue<void>();
    const releaseCommit = deferredValue<void>();
    const client = new ScriptedPostgresClient(new Map([
      ["COMMIT", async () => {
        commitEntered.resolve();
        await releaseCommit.promise;
      }],
    ]));
    const fiber = Effect.runFork(runPostgresTransactionEffect(
      client,
      testDatabase(),
      () => Effect.succeed("value"),
      testEffectTransactionOptions,
    ));

    await commitEntered.promise;
    const completion = Effect.runPromise(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      releaseCommit.resolve();
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(client.statements).toEqual(["BEGIN", "COMMIT"]);
  });

  it("requires the Effect owner to observe rollback failure", async () => {
    const callbackFailure = new Error("typed callback failure");
    const rollbackError = new Error("rollback failed");
    const client = new ScriptedPostgresClient(
      new Map([["ROLLBACK", rollbackError]]),
    );
    let observedRollbackError: unknown;

    const failure = await Effect.runPromise(Effect.flip(
      runPostgresTransactionEffect(
        client,
        testDatabase(),
        () => Effect.fail(callbackFailure),
        {
          onRollbackError: (error) => {
            observedRollbackError = error;
          },
        },
      ),
    ));

    expect(failure).toBe(callbackFailure);
    expect(observedRollbackError).toBe(rollbackError);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("preserves a callback failure when rollback also fails", async () => {
    const primaryError = new Error("callback failed");
    const rollbackError = new Error("rollback failed");
    const client = new ScriptedPostgresClient(
      new Map([["ROLLBACK", rollbackError]]),
    );
    let observedRollbackError: unknown;

    await expect(
      runPostgresTransaction(
        client,
        testDatabase(),
        async () => {
          throw primaryError;
        },
        {
          onRollbackError: (error) => {
            observedRollbackError = error;
          },
        },
      ),
    ).rejects.toBe(primaryError);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
    expect(observedRollbackError).toBe(rollbackError);
  });

  it("does not mistake a callback's tagged failure for driver infrastructure", async () => {
    const callbackFailure = new PostgresTransactionBeginError({
      cause: new Error("not an actual BEGIN failure"),
    });
    const client = new ScriptedPostgresClient();

    await expect(runPostgresTransaction(
      client,
      testDatabase(),
      async () => {
        throw callbackFailure;
      },
    )).rejects.toBe(callbackFailure);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("preserves a commit failure when rollback also fails", async () => {
    const commitError = new Error("commit failed");
    const rollbackError = new Error("rollback failed");
    const client = new ScriptedPostgresClient(
      new Map([
        ["COMMIT", commitError],
        ["ROLLBACK", rollbackError],
      ]),
    );
    let observedRollbackError: unknown;

    await expect(
      runPostgresTransaction(
        client,
        testDatabase(),
        async () => "value",
        {
          onRollbackError: (error) => {
            observedRollbackError = error;
          },
        },
      ),
    ).rejects.toBe(commitError);
    expect(client.statements).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(observedRollbackError).toBe(rollbackError);
  });

  it("suppresses a rollback observer defect at the Promise boundary", async () => {
    const callbackError = new Error("callback failed");
    const client = new ScriptedPostgresClient(
      new Map([["ROLLBACK", new Error("rollback failed")]]),
    );

    await expect(runPostgresTransaction(
      client,
      testDatabase(),
      async () => {
        throw callbackError;
      },
      {
        onRollbackError: () => {
          throw new Error("observer failed");
        },
      },
    )).rejects.toBe(callbackError);
    expect(client.statements).toEqual(["BEGIN", "ROLLBACK"]);
  });
});

type QueryBehavior = Error | (() => Promise<void>);

class ScriptedPostgresClient implements PostgresQueryClient {
  readonly statements: string[] = [];

  constructor(
    private readonly behaviors: ReadonlyMap<string, QueryBehavior> = new Map(),
  ) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    _params?: unknown[],
  ): Promise<QueryResult<Row>> {
    this.statements.push(sql);
    const behavior = this.behaviors.get(sql);
    if (behavior instanceof Error) throw behavior;
    await behavior?.();
    return { rows: [] };
  }
}

function testDatabase(): NodePgDatabase<typeof flarexSchema> {
  return drizzle.mock({ schema: flarexSchema });
}

function deferredValue<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const testEffectTransactionOptions = {
  onRollbackError: (_error: unknown): void => {},
};
