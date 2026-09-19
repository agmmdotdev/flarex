import { Socket } from "node:net";
import { performance } from "node:perf_hooks";
import { Client, type Pool, type PoolClient } from "pg";
import { Schema } from "effect";
import { getTableName } from "drizzle-orm";
import type { PointCommitTransactionProofStepV1 } from "../src/pointCommitTransaction";
import {
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "../src/schema";

const hasQueryText = Schema.is(Schema.Struct({ text: Schema.String }));
const observedPools = new WeakSet<Pool>();
const families = [
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
].map(getTableName);

type Phase = "resolveAndLock" | PointCommitTransactionProofStepV1;
interface Counters {
  queryCalls: number;
  sqlTextBytes: number;
  transmittedBytes: number;
}
interface BorrowedClient {
  readonly original: PoolClient["query"];
  readonly installed: PoolClient["query"];
  readonly socket: Socket;
  bytesWritten: number;
}

/** Test-only observer of an otherwise idle, exclusively owned pool. Native pg
 * overloads, return values, failures and release remain untouched. Socket byte
 * deltas include PostgreSQL protocol framing, not just encoded parameters.
 * No SQL text, parameter values or result bodies survive a query invocation. */
export async function withPostgresExecutionObservation<Value>(
  pool: Pool,
  run: (
    markStep: (step: PointCommitTransactionProofStepV1) => void,
  ) => Promise<Value>,
) {
  if (
    observedPools.has(pool) ||
    pool.waitingCount !== 0 ||
    pool.totalCount !== pool.idleCount
  ) {
    throw new Error(
      "CE0 observation requires an idle, exclusively owned pool.",
    );
  }
  const clients = new Map<PoolClient, BorrowedClient>();
  const phases = new Map<Phase, Counters>();
  const commands = new Map<string, number>();
  const familyQueries = new Map<string, number>();
  let phase: Phase = "resolveAndLock";
  let unsupported = false;
  let checkouts = 0;
  let releases = 0;
  const counters = () => {
    let value = phases.get(phase);
    if (value === undefined) {
      value = { queryCalls: 0, sqlTextBytes: 0, transmittedBytes: 0 };
      phases.set(phase, value);
    }
    return value;
  };
  const flushBytes = (borrowed: BorrowedClient) => {
    const current = borrowed.socket.bytesWritten;
    counters().transmittedBytes += current - borrowed.bytesWritten;
    borrowed.bytesWritten = current;
  };
  const acquire = (client: PoolClient) => {
    checkouts += 1;
    // Native instance checks guard the deliberately driver-specific telemetry.
    // Never throw from a pool event: an unsupported transport invalidates the
    // observation after the real operation has settled.
    if (
      !(client instanceof Client) ||
      !(client.connection.stream instanceof Socket) ||
      clients.has(client)
    ) {
      unsupported = true;
      return;
    }
    const original = client.query;
    const installed = new Proxy(original, {
      apply(target, receiver, args: unknown[]) {
        const input = args[0];
        const text =
          typeof input === "string"
            ? input
            : hasQueryText(input)
              ? input.text
              : undefined;
        if (text === undefined) {
          unsupported = true;
        } else {
          const count = counters();
          count.queryCalls += 1;
          count.sqlTextBytes += Buffer.byteLength(text, "utf8");
          const verb = text.trimStart().split(/\s/, 1)[0]?.toLowerCase();
          const command =
            verb !== undefined &&
            [
              "select",
              "with",
              "insert",
              "update",
              "delete",
              "begin",
              "commit",
              "rollback",
              "set",
            ].includes(verb)
              ? verb
              : "other";
          commands.set(command, (commands.get(command) ?? 0) + 1);
          for (const family of families) {
            if (text.includes(family))
              familyQueries.set(family, (familyQueries.get(family) ?? 0) + 1);
          }
        }
        return Reflect.apply(target, receiver, args);
      },
    });
    clients.set(client, {
      original,
      installed,
      socket: client.connection.stream,
      bytesWritten: client.connection.stream.bytesWritten,
    });
    client.query = installed;
  };
  const release = (_error: Error | undefined, client: PoolClient) => {
    releases += 1;
    const borrowed = clients.get(client);
    if (borrowed === undefined) {
      unsupported = true;
      return;
    }
    flushBytes(borrowed);
    if (client.query !== borrowed.installed) unsupported = true;
    else client.query = borrowed.original;
    clients.delete(client);
  };
  observedPools.add(pool);
  pool.on("acquire", acquire);
  pool.on("release", release);
  const started = performance.now();
  try {
    const value = await run((step) => {
      for (const borrowed of clients.values()) flushBytes(borrowed);
      phase = step;
    });
    const elapsedMilliseconds = performance.now() - started;
    if (unsupported || clients.size !== 0 || checkouts !== releases) {
      throw new Error(
        "CE0 observation is incomplete or uses an unsupported transport/query form.",
      );
    }
    return {
      value,
      observation: {
        elapsedMilliseconds,
        checkouts,
        releases,
        queryCalls: [...phases.values()].reduce(
          (sum, entry) => sum + entry.queryCalls,
          0,
        ),
        transmittedBytes: [...phases.values()].reduce(
          (sum, entry) => sum + entry.transmittedBytes,
          0,
        ),
        commands: Object.fromEntries(commands),
        familyQueries: Object.fromEntries(familyQueries),
        phases: Object.fromEntries(phases),
      },
    };
  } finally {
    pool.off("acquire", acquire);
    pool.off("release", release);
    for (const [client, borrowed] of clients) {
      if (client.query === borrowed.installed) client.query = borrowed.original;
    }
    observedPools.delete(pool);
  }
}
