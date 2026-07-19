import { WorkerEntrypoint } from "cloudflare:workers";
import Client from "pg/lib/client.js";
import type { Client as PgClient, QueryResultRow } from "pg";
import { Data, Effect } from "effect";

import {
  decodeProbeMockFinishRequestV1OrNull,
  decodeProbeMockReadRequestV1OrNull,
  decodeProbeSyncWakeReceiptV1OrNull,
  ProbeMockFinishResponseV1Schema,
  ProbeMockReadResponseV1Schema,
  ProbeSyncWakeRequestV1Schema,
  ProbeSyntheticCursorSchema,
  type ProbeMockFinishResponseV1,
  type ProbeMockReadResponseV1,
} from "./commitProtocol";
import { copyCloudflareRpcRecord } from "./effectBoundary";
import { elapsedPerformanceDurationSince } from "./performanceDuration";
import { ProbeDurationMsSchema } from "./protocol";
import type { ProbeSyncDO } from "./probeSyncDO";
import {
  commitOrFindExactOutcome,
  type PostgresCommitTransactionPort,
  type PostgresFinishRequest,
} from "./postgresCommitTransaction";

const SCOPE_TABLE = "flarex_runtime_topology_probe_p28.scope_cursors";
const OUTCOME_TABLE = "flarex_runtime_topology_probe_p28.terminal_outcomes";

export interface ProbePostgresCommitEnv {
  readonly HYPERDRIVE_CACHE_DISABLED: Pick<Hyperdrive, "connectionString">;
  readonly PROBE_SYNC: DurableObjectNamespace<ProbeSyncDO>;
}

export class ProbePostgresOperationError extends Data.TaggedError(
  "ProbePostgresOperationError",
)<{
  readonly operation: "read" | "finish" | "resolve" | "close";
  readonly cause: unknown;
}> {}

interface CursorRow extends QueryResultRow {
  readonly cursor: number;
}

interface OutcomeRow extends QueryResultRow {
  readonly request_json: string;
}

export class PostgresReadEntrypoint extends WorkerEntrypoint<ProbePostgresCommitEnv> {
  async read(value: unknown): Promise<ProbeMockReadResponseV1> {
    return await readPostgresSnapshot(this.env, value);
  }
}

export const readPostgresSnapshotEffect = Effect.fn(
  "RuntimeTopologyProbe.readPostgresSnapshot",
)(function* (
  env: ProbePostgresCommitEnv,
  value: unknown,
): Effect.fn.Return<ProbeMockReadResponseV1, ProbePostgresOperationError> {
  const request = decodeProbeMockReadRequestV1OrNull(value);
  if (
    request === null ||
    (request.scenario !== "facet_finalizer_postgres_warm_invoke" &&
      request.scenario !== "session_postgres_warm_invoke")
  ) {
    return yield* Effect.fail(new ProbePostgresOperationError({
      operation: "read",
      cause: new Error("invalid postgres probe read"),
    }));
  }

  const cursor = yield* withClient(
    env,
    "read",
    async client => {
      await client.query("BEGIN");
      try {
        await client.query(
          `INSERT INTO ${SCOPE_TABLE} (scope_id, run_id, cursor) VALUES ($1, $2, 0) ON CONFLICT (scope_id) DO NOTHING`,
          [request.scopeId, request.runId],
        );
        const result = await client.query<CursorRow>(
          `SELECT cursor FROM ${SCOPE_TABLE} WHERE scope_id = $1`,
          [request.scopeId],
        );
        const row = result.rows[0];
        if (row === undefined || !Number.isSafeInteger(row.cursor)) {
          throw new Error("postgres probe cursor row is missing or invalid");
        }
        await client.query("COMMIT");
        return row.cursor;
      } catch (cause) {
        await rollbackQuietly(client);
        throw cause;
      }
    },
  );

  return ProbeMockReadResponseV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
      sessionId: request.sessionId,
      sessionMode: request.sessionMode,
      attemptId: request.attemptId,
      codeMode: request.codeMode,
      codeId: request.codeId,
    payloadBytes: request.payloadBytes,
    syntheticRevision: ProbeSyntheticCursorSchema.make(cursor),
  });
});

export async function readPostgresSnapshot(
  env: ProbePostgresCommitEnv,
  value: unknown,
): Promise<ProbeMockReadResponseV1> {
  return await Effect.runPromise(readPostgresSnapshotEffect(env, value));
}

export class PostgresFinishEntrypoint extends WorkerEntrypoint<ProbePostgresCommitEnv> {
  async finish(value: unknown): Promise<ProbeMockFinishResponseV1> {
    return await finishPostgresRequest(this.env, value, "finish");
  }

  async resolve(value: unknown): Promise<ProbeMockFinishResponseV1> {
    return await finishPostgresRequest(this.env, value, "resolve");
  }
}

export const finishPostgresRequestEffect = Effect.fn(
  "RuntimeTopologyProbe.finishPostgresRequest",
)(function* (
  env: ProbePostgresCommitEnv,
  value: unknown,
  operation: "finish" | "resolve",
): Effect.fn.Return<ProbeMockFinishResponseV1, ProbePostgresOperationError> {
  const request = decodeProbeMockFinishRequestV1OrNull(value);
  if (
    request === null ||
    (request.scenario !== "facet_finalizer_postgres_warm_invoke" &&
      request.scenario !== "session_postgres_warm_invoke")
  ) {
    return yield* Effect.fail(new ProbePostgresOperationError({
      operation,
      cause: new Error(`invalid postgres probe ${operation}`),
    }));
  }

  const transactionStartedAt = performance.now();
  const finishDisposition = yield* withClient(
    env,
    operation,
    client => commitOrFindExactOutcome(
      postgresCommitTransactionPort(client),
      request,
    ),
  );
  const databaseDurationMs = elapsedPerformanceDurationSince(
    transactionStartedAt,
  );
  return yield* Effect.tryPromise({
    try: () => wakeCommittedOutcome(
      env,
      request,
      finishDisposition,
      databaseDurationMs,
    ),
    catch: cause => new ProbePostgresOperationError({ operation, cause }),
  });
});

export async function finishPostgresRequest(
  env: ProbePostgresCommitEnv,
  value: unknown,
  operation: "finish" | "resolve",
): Promise<ProbeMockFinishResponseV1> {
  return await Effect.runPromise(
    finishPostgresRequestEffect(env, value, operation),
  );
}

function postgresCommitTransactionPort(
  client: PgClient,
): PostgresCommitTransactionPort {
  return {
    begin: async () => {
      await client.query("BEGIN");
    },
    lockCursor: async scopeId => {
      const result = await client.query<CursorRow>(
        `SELECT cursor FROM ${SCOPE_TABLE} WHERE scope_id = $1 FOR UPDATE`,
        [scopeId],
      );
      return result.rows[0]?.cursor ?? null;
    },
    findOutcome: async attemptId => {
      const result = await client.query<OutcomeRow>(
        `SELECT request_json FROM ${OUTCOME_TABLE} WHERE attempt_id = $1`,
        [attemptId],
      );
      return result.rows[0]?.request_json ?? null;
    },
    insertOutcome: async (request, requestJson) => {
      await client.query(
        `INSERT INTO ${OUTCOME_TABLE} (attempt_id, scope_id, commit_seq, request_json, seal_digest, result_digest, commit_intent_digest) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          request.attemptId,
          request.scopeId,
          request.commitSeq,
          requestJson,
          request.sealDigest,
          request.resultDigest,
          request.commitIntentDigest,
        ],
      );
    },
    advanceCursor: async request => {
      const update = await client.query(
        `UPDATE ${SCOPE_TABLE} SET cursor = $2, updated_at = clock_timestamp() WHERE scope_id = $1 AND cursor = $3`,
        [request.scopeId, request.commitSeq, request.snapshotRevision],
      );
      return update.rowCount === 1;
    },
    commit: async () => {
      await client.query("COMMIT");
    },
    rollback: () => rollbackQuietly(client),
  };
}

async function wakeCommittedOutcome(
  env: ProbePostgresCommitEnv,
  request: PostgresFinishRequest,
  finishDisposition: "committed" | "recovered",
  databaseDurationMs: number,
): Promise<ProbeMockFinishResponseV1> {
    const syncRequest = ProbeSyncWakeRequestV1Schema.make({
      protocolVersion: request.protocolVersion,
      runId: request.runId,
      sampleId: request.sampleId,
      sampleOrdinal: request.sampleOrdinal,
      scopeId: request.scopeId,
      scenario: request.scenario,
      commitSeq: request.commitSeq,
    });
    const syncStartedAt = performance.now();
    const rawSync = await env.PROBE_SYNC.getByName(request.scopeId)
      .wake(syncRequest);
    const sync = decodeProbeSyncWakeReceiptV1OrNull(
      copyCloudflareRpcRecord(rawSync),
    );
    if (sync === null) throw new Error("invalid postgres probe sync receipt");

    return ProbeMockFinishResponseV1Schema.make({
      request,
      commitAuthority: "postgres",
      finishDisposition,
      commitTransactionDurationMs: ProbeDurationMsSchema.make(
        finishDisposition === "committed" ? databaseDurationMs : 0,
      ),
      outcomeResolutionDurationMs: ProbeDurationMsSchema.make(
        finishDisposition === "recovered" ? databaseDurationMs : 0,
      ),
      syncWakeDurationMs: ProbeDurationMsSchema.make(
        elapsedPerformanceDurationSince(syncStartedAt),
      ),
      sync,
    });
}

function withClient<A>(
  env: ProbePostgresCommitEnv,
  operation: ProbePostgresOperationError["operation"],
  use: (client: PgClient) => Promise<A>,
): Effect.Effect<A, ProbePostgresOperationError> {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const client = new Client({
          connectionString: env.HYPERDRIVE_CACHE_DISABLED.connectionString,
        });
        await client.connect();
        return client;
      },
      catch: cause => new ProbePostgresOperationError({ operation, cause }),
    }),
    client => Effect.tryPromise({
      try: () => use(client),
      catch: cause => new ProbePostgresOperationError({ operation, cause }),
    }),
    client => Effect.tryPromise({
      try: () => client.end(),
      catch: cause => new ProbePostgresOperationError({
        operation: "close",
        cause,
      }),
    }),
  );
}

async function rollbackQuietly(client: PgClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original transaction failure remains authoritative.
  }
}

export default {
  fetch(): Response {
    return new Response("Not Found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  },
} satisfies ExportedHandler<ProbePostgresCommitEnv>;
