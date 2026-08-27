import type { CommitFeedCommitV1 } from
  "@flarex/persistence-postgres/internal/commit-feed";
import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Exit, Option, Result } from "effect";

import {
  SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  captureScopeSyncActiveHeadObservationV1,
} from "flarex-protocol/internal/scope-sync-v1";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";

import {
  initializeDeploymentSyncStorage,
  makeDeploymentSyncCursorStore,
  type DeploymentSyncCursorStore,
  type DeploymentSyncScopeState,
} from "../src/deploymentSync/Store";
import { deploymentSyncObjectName } from "../src/routing";

interface TestEnv {
  readonly DEPLOYMENT_SYNCS: DurableObjectNamespace<DeploymentSyncStoreTestDO>;
}

interface TestRequest {
  readonly actorScopeUuid?: unknown;
  readonly operationScopeUuid?: unknown;
  readonly operation?: unknown;
  readonly epochUuid?: unknown;
  readonly storageGenerationFence?: unknown;
  readonly commitSeq?: unknown;
}

export class DeploymentSyncStoreTestDO extends DurableObject<TestEnv> {
  private readonly cursorStore: DeploymentSyncCursorStore;

  constructor(ctx: DurableObjectState, env: TestEnv) {
    super(ctx, env);
    Result.getOrThrow(initializeDeploymentSyncStorage(this.ctx.storage.sql));
    this.cursorStore = makeDeploymentSyncCursorStore(
      this.ctx.storage,
      this.ctx.storage.sql,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as TestRequest;
    const operationScopeUuid = ScopeUuidV1Schema.make(
      String(input.operationScopeUuid ?? input.actorScopeUuid),
    );

    switch (input.operation) {
      case "initialize":
        return await storeResponse(this.cursorStore.initialize(
          makeObservation(input, operationScopeUuid),
        ), serializeState);
      case "read":
        return await storeResponse(
          this.cursorStore.read(operationScopeUuid),
          state => Option.match(state, {
            onNone: () => ({ kind: "uninitialized" as const }),
            onSome: current => ({
              kind: "initialized" as const,
              state: serializeState(current),
            }),
          }),
        );
      case "advance":
        return await storeResponse(
          this.cursorStore.advance(
            operationScopeUuid,
            makeCommit(input, operationScopeUuid),
          ),
          decision => decision.kind === "duplicate"
            ? {
              kind: decision.kind,
              observedCommitSeq: decision.observedCommitSeq.toString(),
            }
            : {
              kind: decision.kind,
              appliedThroughCommitSeq:
                decision.nextCursor.appliedThroughCommitSeq.toString(),
            },
        );
      case "advanceDefect": {
        const exit = await Effect.runPromiseExit(this.cursorStore.advance(
          operationScopeUuid,
          makeDefectingCommit(input),
        ));
        return Response.json({
          died: Exit.isFailure(exit) && Cause.hasDies(exit.cause),
          typedFailure: Exit.isFailure(exit) &&
            Option.isSome(Cause.findErrorOption(exit.cause)),
        });
      }
      case "reenterSchema":
        return Response.json({
          ok: Result.isSuccess(
            initializeDeploymentSyncStorage(this.ctx.storage.sql),
          ),
        });
      case "corruptInvalid":
        this.ctx.storage.sql.exec(`
          UPDATE deployment_sync_scope_state
          SET local_schema_revision = 2
          WHERE singleton = 1
        `);
        return Response.json({ ok: true });
      case "corruptDuplicate":
        recreateCorruptTable(this.ctx.storage.sql, operationScopeUuid, "duplicate");
        return Response.json({ ok: true });
      case "corruptPartial":
        recreateCorruptTable(this.ctx.storage.sql, operationScopeUuid, "partial");
        return Response.json({ ok: true });
      case "forceCasConflict":
        this.ctx.storage.sql.exec(`
          CREATE TRIGGER deployment_sync_force_cas_conflict
          BEFORE UPDATE OF applied_through_commit_seq
          ON deployment_sync_scope_state
          BEGIN
            SELECT RAISE(IGNORE);
          END
        `);
        return Response.json({ ok: true });
      case "forceRollback":
        this.ctx.storage.sql.exec(`
          CREATE TRIGGER deployment_sync_force_rollback
          BEFORE UPDATE OF applied_through_commit_seq
          ON deployment_sync_scope_state
          BEGIN
            UPDATE deployment_sync_scope_state
            SET applied_through_commit_seq = '999'
            WHERE singleton = 1;
            SELECT RAISE(FAIL, 'forced deployment sync rollback');
          END
        `);
        return Response.json({ ok: true });
      case "tableNames": {
        const tables = this.ctx.storage.sql.exec<{ readonly name: string }>(`
          SELECT name FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE '_cf_%'
          ORDER BY name
        `).toArray();
        return Response.json({ tables });
      }
      default:
        return new Response("not found", { status: 404 });
    }
  }
}

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    const input = await request.clone().json() as TestRequest;
    const actorScopeUuid = ScopeUuidV1Schema.make(String(input.actorScopeUuid));
    return await env.DEPLOYMENT_SYNCS
      .getByName(deploymentSyncObjectName(actorScopeUuid))
      .fetch(request);
  },
};

function makeObservation(
  input: TestRequest,
  scopeUuid: ScopeUuidV1,
) {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid,
    epochUuid: ScopeEpochUuidV1Schema.make(String(input.epochUuid)),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(
      BigInt(String(input.storageGenerationFence)),
    ),
    observedAtCommitSeq: CommitSeqSchema.make(BigInt(String(input.commitSeq))),
    activationSequence: ApplicationActivationSequenceV1Schema.make(1n),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      "ab".repeat(32),
    ),
  });
}

function makeCommit(
  input: TestRequest,
  scopeUuid: ScopeUuidV1,
): CommitFeedCommitV1 {
  return Object.freeze({
    scopeUuid,
    epochUuid: ScopeEpochUuidV1Schema.make(String(input.epochUuid)),
    commitSeq: CommitSeqSchema.make(BigInt(String(input.commitSeq))),
    committedAtMilliseconds: 1_000,
    appRowChanges: Object.freeze([]),
    relationAdjacencyChanges: Object.freeze([]),
  });
}

function makeDefectingCommit(input: TestRequest): CommitFeedCommitV1 {
  return Object.freeze({
    get scopeUuid(): ScopeUuidV1 {
      throw new Error("forced deployment sync callback defect");
    },
    epochUuid: ScopeEpochUuidV1Schema.make(String(input.epochUuid)),
    commitSeq: CommitSeqSchema.make(BigInt(String(input.commitSeq))),
    committedAtMilliseconds: 1_000,
    appRowChanges: Object.freeze([]),
    relationAdjacencyChanges: Object.freeze([]),
  });
}

async function storeResponse<A, E>(
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => unknown,
): Promise<Response> {
  const result = await Effect.runPromise(effect.pipe(
    Effect.match({
      onFailure: error => ({
        ok: false as const,
        error: serializeError(error),
      }),
      onSuccess: value => ({
        ok: true as const,
        value: onSuccess(value),
      }),
    }),
  ));
  return Response.json(result);
}

function serializeState(state: DeploymentSyncScopeState) {
  return {
    localSchemaRevision: state.localSchemaRevision,
    scopeUuid: state.scopeUuid,
    epochUuid: state.epochUuid,
    storageGeneration: state.storageGeneration,
    storageGenerationFence: state.storageGenerationFence.toString(),
    appliedThroughCommitSeq: state.appliedThroughCommitSeq.toString(),
  };
}

function serializeError(error: unknown): Readonly<Record<string, unknown>> {
  if (typeof error !== "object" || error === null || !("_tag" in error)) {
    return Object.freeze({ tag: "unknown" });
  }
  const tagged = error as Readonly<Record<string, unknown>>;
  const fields: Record<string, unknown> = { tag: tagged._tag };
  for (const key of [
    "operation",
    "field",
    "detail",
    "expected",
    "observed",
  ] as const) {
    const value = tagged[key];
    if (typeof value === "string" || typeof value === "number") fields[key] = value;
  }
  for (const key of [
    "expectedAppliedThroughCommitSeq",
    "candidateAppliedThroughCommitSeq",
    "nextRequiredCommitSeq",
    "observedCommitSeq",
  ] as const) {
    const value = tagged[key];
    if (typeof value === "bigint") fields[key] = value.toString();
  }
  return Object.freeze(fields);
}

function recreateCorruptTable(
  sql: SqlStorage,
  scopeUuid: ScopeUuidV1,
  kind: "duplicate" | "partial",
): void {
  sql.exec("DROP TABLE deployment_sync_scope_state");
  sql.exec(`CREATE TABLE deployment_sync_scope_state (
    singleton INTEGER,
    local_schema_revision INTEGER,
    scope_uuid TEXT,
    epoch_uuid TEXT,
    storage_generation TEXT,
    storage_generation_fence TEXT,
    applied_through_commit_seq TEXT
  )`);
  const values = [
    1,
    1,
    scopeUuid,
    "00000000-0000-4000-8000-000000000003",
    "flarexdb_v1",
    "1",
    kind === "partial" ? null : "5",
  ] as const;
  sql.exec(
    `INSERT INTO deployment_sync_scope_state VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ...values,
  );
  if (kind === "duplicate") {
    sql.exec(
      `INSERT INTO deployment_sync_scope_state VALUES (?, ?, ?, ?, ?, ?, ?)`,
      2,
      1,
      scopeUuid,
      "00000000-0000-4000-8000-000000000003",
      "flarexdb_v1",
      "1",
      "5",
    );
  }
}
