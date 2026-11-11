import { advanceCheckpointState, CheckpointError, CheckpointStateSchema,
  type CheckpointCertificate, type CheckpointState, type CheckpointStore } from "@flarex/query-sync/internal/checkpoint";
import { Effect, Result, Schema } from "effect";
import { CoreApplicationTimestampSchema, type CoreApplicationRouteIdentity } from "flarex-protocol/internal/core-application";
import { CoreQueryCheckpointSourceIdSchema } from "flarex-protocol/internal/core-query-checkpoint";

export interface DeploymentCheckpointStorage {
  readonly sql: Pick<SqlStorage, "exec">;
  readonly transactionSync: <A>(use: () => A) => A;
}

const TABLE = "flarex_query_checkpoint";
const DDL = `CREATE TABLE ${TABLE} (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL CHECK (format = 'flarex.query-checkpoint'),
  deployment_id TEXT NOT NULL,
  scope_uuid TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('initialized', 'ready')),
  source_id TEXT,
  position TEXT,
  CHECK ((state = 'initialized' AND source_id IS NULL AND position IS NULL)
    OR (state = 'ready' AND source_id IS NOT NULL AND position IS NOT NULL))
) STRICT`;
const strict = { parseOptions: { onExcessProperty: "error" as const } };
const Rows = Schema.Array(Schema.Struct({ singleton: Schema.Literal(1), format: Schema.Literal("flarex.query-checkpoint"),
  deployment_id: Schema.String, scope_uuid: Schema.String,
  state: Schema.Literals(["initialized", "ready"]), source_id: Schema.NullOr(CoreQueryCheckpointSourceIdSchema),
  position: Schema.NullOr(CoreApplicationTimestampSchema) }).annotate(strict));
const Objects = Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String, sql: Schema.NullOr(Schema.String) }));
const decodeRows = Schema.decodeUnknownResult(Rows);
const decodeObjects = Schema.decodeUnknownResult(Objects);
const decodeState = Schema.decodeUnknownResult(CheckpointStateSchema);
const failure = (reason: CheckpointError["reason"], cause?: unknown) => new CheckpointError({ reason, cause });
const normalizeDdl = (value: string) => value.trim().replace(/\s+/g, " ");

/** A derived checkpoint only. This storage never owns committed application data. */
export function makeDeploymentCheckpointStore(
  storage: DeploymentCheckpointStorage,
  suppliedRoute: CoreApplicationRouteIdentity,
): CheckpointStore {
  const route = Object.freeze({ ...suppliedRoute });
  function inspect(): Result.Result<CheckpointState | null, CheckpointError> {
    return Result.gen(function* () {
      const objects = yield* decodeObjects(storage.sql.exec(
        "SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV', '__cf_kv')",
      ).toArray()).pipe(Result.mapError(cause => failure("stateIncompatible", cause)));
      if (objects.length === 0) return null;
      const object = objects[0];
      if (objects.length !== 1 || object === undefined || object.type !== "table" || object.name !== TABLE
        || object.sql === null || normalizeDdl(object.sql) !== normalizeDdl(DDL))
        return yield* Result.fail(failure("stateIncompatible"));
      const rows = yield* decodeRows(storage.sql.exec(`SELECT * FROM ${TABLE}`).toArray())
        .pipe(Result.mapError(cause => failure("stateCorrupt", cause)));
      const row = rows[0];
      if (rows.length !== 1 || row === undefined) return yield* Result.fail(failure("stateCorrupt"));
      if (row.deployment_id !== route.deploymentId || row.scope_uuid !== route.scopeUuid)
        return yield* Result.fail(failure("stateIncompatible"));
      if (row.state === "initialized") {
        if (row.source_id !== null || row.position !== null) return yield* Result.fail(failure("stateCorrupt"));
        return Object.freeze({ kind: "initialized" as const });
      }
      if (row.source_id === null || row.position === null) return yield* Result.fail(failure("stateCorrupt"));
      return yield* decodeState({ kind: "ready", checkpoint: { sourceId: row.source_id, position: BigInt(row.position) } })
        .pipe(Result.mapError(cause => failure("stateCorrupt", cause)));
    });
  }
  const transaction = <A>(use: () => Result.Result<A, CheckpointError>): Effect.Effect<A, CheckpointError> =>
    Effect.try({ try: () => storage.transactionSync(use), catch: cause => failure("storageUnavailable", cause) })
      .pipe(Effect.flatMap(Effect.fromResult));
  return Object.freeze({
    inspect: Effect.suspend(() => transaction(inspect)),
    initialize: Effect.suspend(() => transaction(() => Result.gen(function* () {
      const current = yield* inspect();
      if (current !== null) return current;
      storage.sql.exec(DDL);
      storage.sql.exec(`INSERT INTO ${TABLE} (singleton, format, deployment_id, scope_uuid, state, source_id, position)
        VALUES (1, 'flarex.query-checkpoint', ?, ?, 'initialized', NULL, NULL)`, route.deploymentId, route.scopeUuid);
      return Object.freeze({ kind: "initialized" as const });
    }))),
    advance: Effect.fn("DeploymentCheckpointStore.advance")((expected: CheckpointState, certificate: CheckpointCertificate) => transaction(() => Result.gen(function* () {
      const current = yield* inspect();
      const next = yield* advanceCheckpointState(route.scopeUuid, current, expected, certificate);
      if (next.kind !== "ready") return yield* Result.fail(failure("stateConflict"));
      storage.sql.exec(`UPDATE ${TABLE} SET state = 'ready', source_id = ?, position = ? WHERE singleton = 1`,
        next.checkpoint.sourceId, next.checkpoint.position.toString());
      return next;
    }))),
  });
}
