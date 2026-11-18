import type { ClientBase } from "pg";

import type { PostgresLocatedReadCommittedTransactionResultV1 } from "./postgresLocatedReadCommitted";

export class PostgresLocatedReadCommittedConnectionErrorV1 extends Error {
  readonly name = "PostgresLocatedReadCommittedConnectionErrorV1";

  constructor(
    readonly connectionCause: unknown,
    readonly settlementCause: unknown,
  ) {
    super("PostgreSQL connection failed during its owned client lifetime.", { cause: connectionCause });
  }
}

export interface PostgresClientErrorObservation {
  readonly failure: () => PostgresLocatedReadCommittedConnectionErrorV1 | undefined;
  readonly capture: (settlementCause: unknown) => unknown;
  readonly captureTransaction: <Value>(
    transaction: PostgresLocatedReadCommittedTransactionResultV1<Value>,
  ) => PostgresLocatedReadCommittedTransactionResultV1<Value>;
  readonly close: () => void;
}

/** The pooled and invocation-scoped drivers share this exact first-error latch. */
export function observePostgresClientErrors(
  client: Pick<ClientBase, "on" | "removeListener">,
): PostgresClientErrorObservation {
  let first: Readonly<{ readonly cause: unknown }> | undefined;
  const onError = (cause: Error): void => {
    first ??= Object.freeze({ cause });
  };
  client.on("error", onError);

  return Object.freeze({
    failure: () => first === undefined ? undefined : new PostgresLocatedReadCommittedConnectionErrorV1(first.cause, undefined),
    capture: (settlementCause: unknown): unknown => first === undefined ? settlementCause :
      new PostgresLocatedReadCommittedConnectionErrorV1(first.cause, settlementCause),
    captureTransaction: <Value>(
      transaction: PostgresLocatedReadCommittedTransactionResultV1<Value>,
    ): PostgresLocatedReadCommittedTransactionResultV1<Value> => first === undefined ? transaction : Object.freeze({
      kind: "failed" as const,
      cause: new PostgresLocatedReadCommittedConnectionErrorV1(first.cause, transaction.kind === "failed" ? transaction.cause : undefined),
    }),
    close: () => { client.removeListener("error", onError); },
  });
}

/** Observe before connect and through the host's one actual release. This owner
 * neither connects nor ends the client. A rejected end cannot prove shutdown:
 * retain its listener until the driver confirms a later terminal end event. */
export function observePostgresClientLifetime(client: Pick<ClientBase, "on" | "removeListener">) {
  const connectionErrors = observePostgresClientErrors(client);
  let ended = false;
  let releaseSettled = false;
  const closeAfterShutdown = (): void => {
    if (!ended || !releaseSettled) return;
    connectionErrors.close();
    client.removeListener("end", onEnd);
  };
  const onEnd = (): void => {
    ended = true;
    closeAfterShutdown();
  };
  client.on("end", onEnd);

  return Object.freeze({
    connectionErrors,
    check: (): void => {
      const failure = connectionErrors.failure();
      if (failure !== undefined) throw failure;
    },
    finish: async (release: () => Promise<void>): Promise<void> => {
      let settlement: PostgresLocatedReadCommittedTransactionResultV1<void>;
      try {
        await release();
        // node-postgres end() also fulfills without an event when never connected.
        ended = true;
        settlement = Object.freeze({ kind: "succeeded", value: undefined });
      } catch (cause) {
        settlement = Object.freeze({ kind: "failed", cause });
      }
      releaseSettled = true;
      const result = connectionErrors.captureTransaction(settlement);
      closeAfterShutdown();
      if (result.kind === "failed") throw result.cause;
    },
  });
}

export type PostgresClientLifetimeObservation = ReturnType<typeof observePostgresClientLifetime>;
