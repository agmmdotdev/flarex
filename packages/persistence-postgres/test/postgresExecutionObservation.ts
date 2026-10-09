import { Socket } from "node:net";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Client, type Pool, type PoolClient } from "pg";
import { Schema } from "effect";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "../src/drizzleSchema";
import type { PointCommitTransactionProofStepV1 } from "../src/pointCommitTransaction";
import {
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppIndexEntryRevisions,
  fxAppIndexEntryCurrent,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
  fxSystemUniqueConstraintBuilds,
  fxAppUniqueKeys,
} from "../src/schema";

const hasQueryText = Schema.is(Schema.Struct({ text: Schema.String }));
const hasReturnedCommand = Schema.is(Schema.Struct({ command: Schema.String }));
const observedPools = new WeakSet<Pool>();
const families = [
  ...[
    fxAppRowRevisions,
    fxAppRowCurrent,
    fxAppIndexEntryRevisions,
    fxAppIndexEntryCurrent,
    fxSystemIndexBuildStates,
    fxSystemScopeClocks,
    fxSystemUniqueConstraintBuilds,
    fxAppUniqueKeys,
  ].map(getTableName),
  "fx_apply_app_row_batch", "fx_apply_app_index_batch", "fx_apply_app_unique_batch",
  "fx_accept_app_publication", "fx_apply_app_publication",
];

export type PostgresExecutionPhase =
  | "resolveAndLock"
  | "acceptPublication"
  | "applyPublication"
  | PointCommitTransactionProofStepV1
  | "sessionActivation"
  | "journalOpen"
  | "tableResolution"
  | "pointOperations"
  | "sealPreparation"
  | "sealCanonicalization"
  | "sealPersistence"
  | "runningEvidenceCapture"
  | "enterFinishing"
  | "finishingEvidenceCapture"
  | "commandProjection"
  | "publication"
  | "cmsRequest"
  | "nativeAdmission"
  | "nativeExecution"
  | "nativeFinalization"
  | "replay";
interface Counters {
  queryCalls: number;
  sqlTextBytes: number;
  transmittedBytes: number;
  elapsedMilliseconds: number;
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
  run: (markStep: (step: PostgresExecutionPhase) => void) => Promise<Value>,
  options?: { readonly attributeStatements?: boolean; readonly returnedCommands?: boolean },
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
  const phases = new Map<PostgresExecutionPhase, Counters>();
  const commands = new Map<string, number>();
  const returnedCommands: { readonly checkout: number; readonly submittedCommand: string; readonly returnedCommand: string }[] = [];
  const commandObservations: Promise<void>[] = [];
  const familyQueries = new Map<string, number>();
  const familyCommands = new Map<string, Map<string, number>>();
  const knownFamilies =
    options?.attributeStatements === true
      ? new Set<string>(
          Object.values(schema).flatMap((value) =>
            isTable(value) ? [getTableName(value)] : [],
          ),
        )
      : null;
  const statementShapes = new Map<
    string,
    {
      readonly sha256: string;
      readonly command: string;
      readonly families: readonly string[];
      readonly sqlTextBytes: number;
      readonly ordinals: number[];
    }
  >();
  let queryOrdinal = 0;
  let phase: PostgresExecutionPhase = "resolveAndLock";
  let unsupported = false;
  let checkouts = 0;
  let releases = 0;
  const counters = () => {
    let value = phases.get(phase);
    if (value === undefined) {
      value = {
        queryCalls: 0,
        sqlTextBytes: 0,
        transmittedBytes: 0,
        elapsedMilliseconds: 0,
      };
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
    const checkout = checkouts;
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
          if (knownFamilies !== null) {
            const sha256 = createHash("sha256").update(text).digest("hex");
            let shape = statementShapes.get(sha256);
            if (shape === undefined) {
              shape = {
                sha256,
                command,
                families: [...new Set(text.match(/\bfx_[a-z0-9_]+\b/g) ?? [])]
                  .filter((name) => knownFamilies.has(name))
                  .toSorted(),
                sqlTextBytes: Buffer.byteLength(text, "utf8"),
                ordinals: [],
              };
              statementShapes.set(sha256, shape);
            }
            shape.ordinals.push(queryOrdinal++);
          }
          for (const family of families) {
            if (text.includes(family)) {
              familyQueries.set(family, (familyQueries.get(family) ?? 0) + 1);
              let counts = familyCommands.get(family);
              if (counts === undefined) {
                counts = new Map();
                familyCommands.set(family, counts);
              }
              counts.set(command, (counts.get(command) ?? 0) + 1);
            }
          }
        }
        const result: unknown = Reflect.apply(target, receiver, args);
        if (options?.returnedCommands === true) {
          if (!(result instanceof Promise) || args.some(arg => typeof arg === "function") || text === undefined) unsupported = true;
          else {
            const submittedCommand = text.trimStart().split(/\s/, 1)[0]?.toLowerCase() ?? "";
            // Preserve the native query Promise. This observer retains only its
            // command tag; the original rejection remains the caller's outcome.
            commandObservations.push(result.then(value => {
              if (hasReturnedCommand(value)) returnedCommands.push({ checkout, submittedCommand, returnedCommand: value.command });
              else unsupported = true;
            }, () => undefined));
          }
        }
        return result;
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
  let phaseStarted = started;
  const finishPhase = () => {
    const now = performance.now();
    counters().elapsedMilliseconds += now - phaseStarted;
    phaseStarted = now;
    return now;
  };
  try {
    const value = await run((step) => {
      for (const borrowed of clients.values()) flushBytes(borrowed);
      finishPhase();
      phase = step;
    });
    await Promise.all(commandObservations);
    const elapsedMilliseconds = finishPhase() - started;
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
        returnedCommands,
        statementShapes:
          knownFamilies === null ? null : [...statementShapes.values()],
        familyQueries: Object.fromEntries(familyQueries),
        // Top-level verb of statements mentioning a family, not a SQL parser or
        // affected-row count. WITH is deliberately separate from direct DML.
        familyCommands: Object.fromEntries(
          [...familyCommands].map(([family, counts]) => [
            family,
            Object.fromEntries(counts),
          ]),
        ),
        phases: Object.fromEntries(phases),
      },
    };
  } finally {
    await Promise.all(commandObservations);
    pool.off("acquire", acquire);
    pool.off("release", release);
    for (const [client, borrowed] of clients) {
      if (client.query === borrowed.installed) client.query = borrowed.original;
    }
    observedPools.delete(pool);
  }
}
