import {
  captureAdmittedInvalidationBatch,
  captureCanonicalDependencyKey,
  captureNamespaceCursor,
  captureQueryDescriptor,
  captureQueryEvaluationEvidence,
  captureQueryOperationTarget,
  captureQueryPublicationArtifact,
} from "@flarex/query-sync/internal/kernel";
import type {
  BeginQueryEvaluationRequest,
  NamespaceCursor,
  QueryDescriptor,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";
import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Encoding, Exit, Option, Result } from "effect";

import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "flarex-protocol/commit-protocol";
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
} from "flarex-protocol/storage-authority";

import {
  captureDeploymentQuerySyncBinding,
  makeDeploymentQuerySyncFreshInitializationCapabilityForTest,
} from "../src/deploymentSync/Binding";
import {
  GENERATION_2_CONTRACT_TABLE_DDL,
  GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL,
  GENERATION_2_DEPENDENCY_TABLE_DDL,
  GENERATION_2_QUERY_TABLE_DDL,
  GENERATION_2_SCOPE_TABLE_DDL,
} from "../src/deploymentSync/StorageContractGeneration2";
import {
  makeDeploymentQuerySyncEvaluationState,
  type DeploymentQuerySyncEvaluationState,
} from "../src/deploymentSync/Store";
import { deploymentSyncObjectName } from "../src/routing";

interface TestEnv {
  readonly DEPLOYMENT_SYNCS: DurableObjectNamespace<DeploymentQuerySyncC2TestDO>;
}

interface TestRequest {
  readonly actorScopeUuid?: unknown;
  readonly observationScopeUuid?: unknown;
  readonly operation?: unknown;
  readonly authorizedFresh?: unknown;
  readonly epochUuid?: unknown;
  readonly storageGenerationFence?: unknown;
  readonly commitSeq?: unknown;
  readonly querySeed?: unknown;
}

export class DeploymentQuerySyncC2TestDO extends DurableObject<TestEnv> {
  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as TestRequest;
    switch (input.operation) {
      case "seedGeneration2Empty":
        seedGeneration2(this.ctx.storage.sql, false, input);
        return Response.json({ ok: true });
      case "seedGeneration2Orphan":
        seedGeneration2(this.ctx.storage.sql, true, input);
        return Response.json({ ok: true });
      case "initialize":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.initializeOrInspectNamespace(bootstrapCursor(input)),
        ));
      case "putKvThenInitialize":
        await this.ctx.storage.put("deployment-query-sync-c2-probe", "present");
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.initializeOrInspectNamespace(bootstrapCursor(input)),
        ));
      case "fullVertical":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => fullVertical(state, input),
        ));
      case "completionRollbackThenReplay":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => completionRollbackThenReplay(
            state,
            this.ctx.storage.sql,
            input,
          ),
        ));
      case "snapshot":
        return Response.json(serializeUnknown(snapshot(this.ctx.storage.sql)));
      case "catalog":
        return Response.json(serializeUnknown(catalog(this.ctx.storage.sql)));
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

function makeStateAndRun<A, E>(
  ctx: DurableObjectState,
  input: TestRequest,
  run: (state: DeploymentQuerySyncEvaluationState) => Effect.Effect<A, E>,
): Effect.Effect<A, E | unknown> {
  const observation = activeHeadObservation(input);
  const bindingInput = Object.freeze({ objectId: ctx.id, observation });
  const freshInitializationCapability = input.authorizedFresh === true
    ? makeDeploymentQuerySyncFreshInitializationCapabilityForTest(
      Result.getOrThrow(captureDeploymentQuerySyncBinding(bindingInput)),
    )
    : undefined;
  return makeDeploymentQuerySyncEvaluationState({
    binding: bindingInput,
    storage: ctx.storage,
    ...(freshInitializationCapability === undefined
      ? {}
      : { freshInitializationCapability }),
  }).pipe(Effect.flatMap(run));
}

function fullVertical(
  state: DeploymentQuerySyncEvaluationState,
  input: TestRequest,
) {
  return Effect.gen(function* () {
    const cursor = bootstrapCursor(input);
    const initialized = yield* state.initializeOrInspectNamespace(cursor);
    const descriptor = queryDescriptor(input);
    const begun = yield* state.beginQueryEvaluation(
      firstEvaluationRequest(cursor, descriptor),
    );
    const attempt = requireCreatedAttempt(begun);
    const material = completionMaterial(cursor, descriptor, attempt);
    const completed = yield* state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    );
    const applied = yield* state.applyAdmittedBatchAndAdvance(
      Result.getOrThrow(captureAdmittedInvalidationBatch({
        namespaceId: cursor.namespaceId,
        syncModelId: cursor.syncModelId,
        sourceEpoch: cursor.sourceEpoch,
        sourceSequence: 1n,
        dependencyKeys: [material.dependencyKey],
      })),
    );
    const claimed = yield* state.claimEvaluationWork({
      maximumQueryInspections: 16,
      continuation: null,
    });
    if (claimed._tag !== "claimed") {
      return yield* Effect.die(new Error(
        `Expected claimed work, observed ${claimed._tag}.`,
      ));
    }
    const blocked = yield* state.recordEvaluationAttemptOutcome(
      claimed.attempt,
      "terminalRefusal",
    );
    const replayedBlock = yield* state.recordEvaluationAttemptOutcome(
      claimed.attempt,
      "terminalRefusal",
    );
    return Object.freeze({
      initialized,
      begun,
      completed,
      applied,
      claimed,
      blocked,
      replayedBlock,
    });
  });
}

function completionRollbackThenReplay(
  state: DeploymentQuerySyncEvaluationState,
  sql: SqlStorage,
  input: TestRequest,
) {
  return Effect.gen(function* () {
    const cursor = bootstrapCursor(input);
    yield* state.initializeOrInspectNamespace(cursor);
    const descriptor = queryDescriptor(input);
    const begun = yield* state.beginQueryEvaluation(
      firstEvaluationRequest(cursor, descriptor),
    );
    const attempt = requireCreatedAttempt(begun);
    const material = completionMaterial(cursor, descriptor, attempt);
    sql.exec(`CREATE TRIGGER deployment_sync_test_fail_completion
      BEFORE INSERT ON deployment_sync_pending_publications
      BEGIN
        SELECT RAISE(FAIL, 'forced completion rollback');
      END`);
    const firstExit = yield* Effect.exit(state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    ));
    sql.exec("DROP TRIGGER deployment_sync_test_fail_completion");
    const completed = yield* state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    );
    const replayed = yield* state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    );
    return Object.freeze({
      firstDied: Exit.isFailure(firstExit) && Cause.hasDies(firstExit.cause),
      firstTypedFailure: Exit.isFailure(firstExit)
        && Option.isSome(Cause.findErrorOption(firstExit.cause)),
      completed,
      replayed,
    });
  });
}

function requireCreatedAttempt(
  receipt: Effect.Success<
    ReturnType<DeploymentQuerySyncEvaluationState["beginQueryEvaluation"]>
  >,
): QueryEvaluationAttempt {
  if (receipt._tag !== "created") {
    throw new Error(`Expected created evaluation, observed ${receipt._tag}.`);
  }
  return receipt.attempt;
}

function completionMaterial(
  cursor: NamespaceCursor,
  descriptor: QueryDescriptor,
  attempt: QueryEvaluationAttempt,
) {
  const dependencyKey = Result.getOrThrow(captureCanonicalDependencyKey(
    Encoding.encodeBase64Url("dependency"),
  ));
  const authorityWitness = encodedDigest(0x77);
  const evaluation = Result.getOrThrow(captureQueryEvaluationEvidence({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    descriptor,
    generation: attempt.generation,
    snapshotSequence: cursor.appliedThroughSequence,
    resultDigest: encodedDigest(0x88),
    authorityWitness,
    dependencyKeys: [dependencyKey],
  }));
  const refresh = Result.getOrThrow(deriveGenerationRefreshEvidence(
    evaluation,
    cursor,
    [],
    evaluation.authorityWitness,
  ));
  const publication = Result.getOrThrow(captureQueryPublicationArtifact({
    content: Encoding.encodeBase64Url("publication-content"),
  }));
  return Object.freeze({ dependencyKey, evaluation, refresh, publication });
}

function firstEvaluationRequest(
  cursor: NamespaceCursor,
  descriptor: QueryDescriptor,
): BeginQueryEvaluationRequest {
  return Object.freeze({
    target: Result.getOrThrow(captureQueryOperationTarget({
      namespaceId: cursor.namespaceId,
      syncModelId: cursor.syncModelId,
      sourceEpoch: cursor.sourceEpoch,
      descriptor,
    })),
    expectedActiveGeneration: null,
    requestedDirtyThroughSequence: null,
  });
}

function queryDescriptor(input: TestRequest): QueryDescriptor {
  const seed = Number(input.querySeed ?? 1);
  const key = new Uint8Array(32);
  new DataView(key.buffer).setUint32(0, seed);
  return Result.getOrThrow(captureQueryDescriptor({
    queryKey: Encoding.encodeBase64Url(key),
    queryIdentity: Encoding.encodeBase64Url(`query:${seed}`),
  }));
}

function encodedDigest(byte: number): string {
  return Encoding.encodeBase64Url(
    Uint8Array.from({ length: 32 }, () => byte),
  );
}

function activeHeadObservation(input: TestRequest) {
  return captureScopeSyncActiveHeadObservationV1({
    format: SCOPE_SYNC_ACTIVE_HEAD_OBSERVATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: ScopeUuidV1Schema.make(String(
      input.observationScopeUuid ?? input.actorScopeUuid,
    )),
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

function bootstrapCursor(input: TestRequest) {
  const binding = Result.getOrThrow(captureDeploymentQuerySyncBinding({
    objectId: Object.freeze({
      name: deploymentSyncObjectName(ScopeUuidV1Schema.make(
        String(input.actorScopeUuid),
      )),
    }),
    observation: activeHeadObservation(input),
  }));
  return Result.getOrThrow(captureNamespaceCursor({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    appliedThroughSequence: 0n,
  }));
}

function seedGeneration2(
  sql: SqlStorage,
  includeOrphan: boolean,
  input: TestRequest,
): void {
  sql.exec(GENERATION_2_CONTRACT_TABLE_DDL);
  sql.exec(GENERATION_2_SCOPE_TABLE_DDL);
  sql.exec(GENERATION_2_QUERY_TABLE_DDL);
  sql.exec(GENERATION_2_DEPENDENCY_TABLE_DDL);
  sql.exec(GENERATION_2_DEPENDENCY_REVERSE_INDEX_DDL);
  sql.exec(
    "INSERT INTO deployment_sync_contract_state VALUES (1, 2, 0)",
  );
  if (!includeOrphan) return;
  const descriptor = queryDescriptor(input);
  sql.exec(
    `INSERT INTO deployment_sync_queries VALUES (
      ?, ?, NULL, NULL, NULL, NULL, NULL, NULL,
      '1', NULL, '0', NULL, 'ready'
    )`,
    descriptor.queryKey,
    descriptor.queryIdentity,
  );
}

async function effectResponse<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Response> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return Response.json({ ok: true, value: serializeUnknown(exit.value) });
  }
  const typed = Cause.findErrorOption(exit.cause);
  return Response.json({
    ok: false,
    died: Cause.hasDies(exit.cause),
    typedFailure: Option.isSome(typed),
    error: Option.isSome(typed) ? serializeUnknown(typed.value) : null,
  });
}

function snapshot(sql: SqlStorage) {
  return Object.freeze({
    contract: selectIfPresent(sql, "deployment_sync_contract_state", "singleton"),
    scope: selectIfPresent(sql, "deployment_sync_scope_state", "singleton"),
    queries: selectIfPresent(sql, "deployment_sync_queries", "query_key"),
    dependencies: selectIfPresent(
      sql,
      "deployment_sync_query_dependencies",
      "query_key, role, generation, dependency_key",
    ),
    pending: selectIfPresent(
      sql,
      "deployment_sync_pending_publications",
      "query_key",
    ),
  });
}

function selectIfPresent(
  sql: SqlStorage,
  table: string,
  orderBy: string,
): readonly Readonly<Record<string, SqlStorageValue>>[] {
  const exists = sql.exec<{ readonly present: number }>(
    `SELECT 1 AS present FROM main.sqlite_schema
     WHERE type = 'table' AND name = ?`,
    table,
  ).toArray();
  return exists.length === 0
    ? []
    : sql.exec(`SELECT * FROM main.${table} ORDER BY ${orderBy}`).toArray();
}

function catalog(sql: SqlStorage) {
  return Object.freeze({
    tables: sql.exec("PRAGMA table_list").toArray(),
    schema: sql.exec(
      `SELECT type, name, tbl_name, sql
       FROM main.sqlite_schema
       ORDER BY type, name`,
    ).toArray(),
  });
}

function serializeUnknown(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializeUnknown);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    serializeUnknown(member),
  ]));
}
