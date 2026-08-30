import {
  captureAdmittedInvalidationBatch,
  captureNamespaceCursor,
  captureQueryGeneration,
  captureQueryOperationTarget,
  captureSyncSequence,
} from "@flarex/query-sync/internal/kernel";
import type {
  BeginQueryEvaluationRequest,
} from "@flarex/query-sync/internal/kernel";
import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Exit, Option, Result } from "effect";

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
  makeDeploymentQuerySyncEvaluationState,
  type DeploymentQuerySyncEvaluationState,
} from "../src/deploymentSync/Store";
import { deploymentSyncObjectName } from "../src/routing";

interface TestEnv {
  readonly DEPLOYMENT_SYNCS: DurableObjectNamespace<DeploymentQuerySyncC1TestDO>;
}

interface TestRequest {
  readonly actorScopeUuid?: unknown;
  readonly observationScopeUuid?: unknown;
  readonly operation?: unknown;
  readonly authorizedFresh?: unknown;
  readonly epochUuid?: unknown;
  readonly storageGenerationFence?: unknown;
  readonly commitSeq?: unknown;
  readonly bootstrapCommitSeq?: unknown;
  readonly queryKey?: unknown;
  readonly queryIdentity?: unknown;
  readonly expectedActiveGeneration?: unknown;
  readonly requestedDirtyThroughSequence?: unknown;
  readonly sourceEpoch?: unknown;
  readonly sourceSequence?: unknown;
  readonly dependencyKeys?: unknown;
  readonly legacyRow?: unknown;
  readonly fixture?: unknown;
}

interface EncodedScopeFixtureRow {
  readonly singleton: number;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly sync_model_id: string;
  readonly applied_through_sequence: string;
  readonly evaluation_work_revision: string;
  readonly fairness_anchor: string | null;
  readonly query_count: number;
  readonly retained_identity_bytes: number;
  readonly dependency_memberships: number;
  readonly pending_publication_count: number;
  readonly in_flight_publication_count: number;
  readonly retained_publication_content_bytes: number;
  readonly settlement_envelope_bytes: number;
  readonly counted_canonical_bytes: number;
}

interface EncodedQueryFixtureRow {
  readonly query_key: string;
  readonly query_identity: string;
  readonly active_generation: string | null;
  readonly active_evaluation_snapshot_sequence: string | null;
  readonly active_fresh_through_sequence: string | null;
  readonly active_dirty_through_sequence: string | null;
  readonly active_result_digest: string | null;
  readonly active_authority_witness: string | null;
  readonly provisional_generation: string | null;
  readonly provisional_expected_active_generation: string | null;
  readonly provisional_registration_sequence: string | null;
  readonly provisional_requested_dirty_through_sequence: string | null;
  readonly provisional_disposition: string | null;
  readonly completion_generation: string | null;
  readonly completion_expected_active_generation: string | null;
  readonly completion_registration_sequence: string | null;
  readonly completion_requested_dirty_through_sequence: string | null;
  readonly completion_evaluation_snapshot_sequence: string | null;
  readonly completion_evaluation_authority_witness: string | null;
  readonly completion_refreshed_through_sequence: string | null;
  readonly completion_relevant_through_sequence: string | null;
  readonly completion_refresh_authority_witness: string | null;
  readonly completion_result_digest: string | null;
  readonly completion_publication_disposition: string | null;
  readonly preceding_completion_generation: string | null;
}

interface EncodedDependencyFixtureRow {
  readonly role: "active" | "completion";
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}

interface EncodedPendingPublicationFixtureRow {
  readonly query_key: string;
  readonly generation: string;
  readonly query_identity: string;
  readonly completed_through_sequence: string;
  readonly result_digest: string;
  readonly content: string;
}

interface NormalizedFixture {
  readonly scope: EncodedScopeFixtureRow;
  readonly queries: readonly EncodedQueryFixtureRow[];
  readonly dependencies: readonly EncodedDependencyFixtureRow[];
  readonly pending: readonly EncodedPendingPublicationFixtureRow[];
}

interface LegacyFixtureRow {
  readonly scopeUuid: string;
  readonly epochUuid: string;
  readonly storageGenerationFence: string;
  readonly appliedThroughCommitSeq: string;
}

export class DeploymentQuerySyncC1TestDO extends DurableObject<TestEnv> {
  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as TestRequest;
    switch (input.operation) {
      case "seedGeneration1":
        seedGeneration1(this.ctx.storage.sql, decodeLegacyRow(input.legacyRow));
        return Response.json({ ok: true });
      case "initialize":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.initializeOrInspectNamespace(bootstrapCursor(input)),
        ));
      case "putKvThenInitialize":
        await this.ctx.storage.put("deployment-query-sync-c1-probe", "present");
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.initializeOrInspectNamespace(bootstrapCursor(input)),
        ));
      case "initializeTwice":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => Effect.gen(function* () {
            const cursor = bootstrapCursor(input);
            const first = yield* state.initializeOrInspectNamespace(cursor);
            const second = yield* state.initializeOrInspectNamespace(cursor);
            return Object.freeze({ first, second });
          }),
        ));
      case "initializeRollbackThenRetry":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => {
            const storage = this.ctx.storage;
            return Effect.gen(function* () {
              storage.sql.exec(`CREATE TRIGGER
                deployment_sync_test_fail_initialization
                BEFORE INSERT ON deployment_sync_scope_state
                BEGIN
                  SELECT RAISE(FAIL, 'forced initialization rollback');
                END`);
              const firstExit = yield* Effect.exit(
                state.initializeOrInspectNamespace(bootstrapCursor(input)),
              );
              storage.sql.exec(
                "DROP TRIGGER deployment_sync_test_fail_initialization",
              );
              const second = yield*
                state.initializeOrInspectNamespace(bootstrapCursor(input));
              return Object.freeze({
                firstDied: Exit.isFailure(firstExit)
                  && Cause.hasDies(firstExit.cause),
                firstTypedFailure: Exit.isFailure(firstExit)
                  && Option.isSome(Cause.findErrorOption(firstExit.cause)),
                second,
              });
            });
          },
        ));
      case "begin":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.beginQueryEvaluation(beginRequest(input)),
        ));
      case "apply":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => state.applyAdmittedBatchAndAdvance(admittedBatch(input)),
        ));
      case "seedNormalizedFixture":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          () => Effect.sync(() => {
            seedNormalizedFixture(
              this.ctx.storage,
              decodeNormalizedFixture(input.fixture),
            );
            return Object.freeze({ seeded: true });
          }),
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
  const binding = bindingFromInput(input);
  if (input.bootstrapCommitSeq === undefined) return binding.bootstrapCursor;
  return Result.getOrThrow(captureNamespaceCursor({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    appliedThroughSequence: BigInt(String(input.bootstrapCommitSeq)),
  }));
}

function bindingFromInput(input: TestRequest) {
  return Result.getOrThrow(captureDeploymentQuerySyncBinding({
    objectId: Object.freeze({
      name: deploymentSyncObjectName(ScopeUuidV1Schema.make(
        String(input.actorScopeUuid),
      )),
    }),
    observation: activeHeadObservation(input),
  }));
}

function beginRequest(input: TestRequest): BeginQueryEvaluationRequest {
  const binding = bindingFromInput(input);
  const target = Result.getOrThrow(captureQueryOperationTarget({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    descriptor: {
      queryKey: input.queryKey,
      queryIdentity: input.queryIdentity,
    },
  }));
  return Object.freeze({
    target,
    expectedActiveGeneration: input.expectedActiveGeneration === null
      || input.expectedActiveGeneration === undefined
      ? null
      : Result.getOrThrow(captureQueryGeneration(
        BigInt(String(input.expectedActiveGeneration)),
      )),
    requestedDirtyThroughSequence:
      input.requestedDirtyThroughSequence === null
        || input.requestedDirtyThroughSequence === undefined
        ? null
        : Result.getOrThrow(captureSyncSequence(
          BigInt(String(input.requestedDirtyThroughSequence)),
        )),
  });
}

function admittedBatch(input: TestRequest) {
  const binding = bindingFromInput(input);
  return Result.getOrThrow(captureAdmittedInvalidationBatch({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: input.sourceEpoch ?? binding.sourceEpoch,
    sourceSequence: BigInt(String(input.sourceSequence)),
    dependencyKeys: input.dependencyKeys ?? [],
  }));
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

function seedGeneration1(
  sql: SqlStorage,
  row: LegacyFixtureRow | null,
): void {
  sql.exec(`CREATE TABLE deployment_sync_scope_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    local_schema_revision INTEGER NOT NULL,
    scope_uuid TEXT NOT NULL,
    epoch_uuid TEXT NOT NULL,
    storage_generation TEXT NOT NULL,
    storage_generation_fence TEXT NOT NULL,
    applied_through_commit_seq TEXT NOT NULL
  )`);
  if (row === null) return;
  sql.exec(
    `INSERT INTO deployment_sync_scope_state VALUES (1, 1, ?, ?, ?, ?, ?)`,
    row.scopeUuid,
    row.epochUuid,
    "flarexdb_v1",
    row.storageGenerationFence,
    row.appliedThroughCommitSeq,
  );
}

function seedNormalizedFixture(
  storage: DurableObjectStorage,
  fixture: NormalizedFixture,
): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE main.deployment_sync_contract_state
       SET durable_initialized_history = 1
       WHERE singleton = 1 AND durable_initialized_history = 0`,
    );
    const scope = fixture.scope;
    storage.sql.exec(
      `INSERT INTO main.deployment_sync_scope_state VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`,
      scope.singleton,
      scope.scope_uuid,
      scope.epoch_uuid,
      scope.storage_generation,
      scope.storage_generation_fence,
      scope.sync_model_id,
      scope.applied_through_sequence,
      scope.evaluation_work_revision,
      scope.fairness_anchor,
      scope.query_count,
      scope.retained_identity_bytes,
      scope.dependency_memberships,
      scope.pending_publication_count,
      scope.in_flight_publication_count,
      scope.retained_publication_content_bytes,
      scope.settlement_envelope_bytes,
      scope.counted_canonical_bytes,
    );
    for (const query of fixture.queries) {
      storage.sql.exec(
        `INSERT INTO main.deployment_sync_queries VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
        query.query_key,
        query.query_identity,
        query.active_generation,
        query.active_evaluation_snapshot_sequence,
        query.active_fresh_through_sequence,
        query.active_dirty_through_sequence,
        query.active_result_digest,
        query.active_authority_witness,
        query.provisional_generation,
        query.provisional_expected_active_generation,
        query.provisional_registration_sequence,
        query.provisional_requested_dirty_through_sequence,
        query.provisional_disposition,
        query.completion_generation,
        query.completion_expected_active_generation,
        query.completion_registration_sequence,
        query.completion_requested_dirty_through_sequence,
        query.completion_evaluation_snapshot_sequence,
        query.completion_evaluation_authority_witness,
        query.completion_refreshed_through_sequence,
        query.completion_relevant_through_sequence,
        query.completion_refresh_authority_witness,
        query.completion_result_digest,
        query.completion_publication_disposition,
        query.preceding_completion_generation,
      );
    }
    for (const dependency of fixture.dependencies) {
      storage.sql.exec(
        `INSERT INTO main.deployment_sync_query_dependencies VALUES (?, ?, ?, ?)`,
        dependency.role,
        dependency.query_key,
        dependency.generation,
        dependency.dependency_key,
      );
    }
    for (const pending of fixture.pending) {
      storage.sql.exec(
        `INSERT INTO main.deployment_sync_pending_publications
          VALUES (?, ?, ?, ?, ?, ?)`,
        pending.query_key,
        pending.generation,
        pending.query_identity,
        pending.completed_through_sequence,
        pending.result_digest,
        pending.content,
      );
    }
  });
}

function snapshot(sql: SqlStorage) {
  return Object.freeze({
    contract: sql.exec(
      "SELECT * FROM main.deployment_sync_contract_state ORDER BY singleton",
    ).toArray(),
    scope: sql.exec(
      "SELECT * FROM main.deployment_sync_scope_state ORDER BY singleton",
    ).toArray(),
    queries: sql.exec(
      "SELECT * FROM main.deployment_sync_queries ORDER BY query_key",
    ).toArray(),
    dependencies: sql.exec(
      `SELECT * FROM main.deployment_sync_query_dependencies
       ORDER BY query_key, role, generation, dependency_key`,
    ).toArray(),
    pending: sql.exec(
      `SELECT * FROM main.deployment_sync_pending_publications
       ORDER BY query_key`,
    ).toArray(),
  });
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

function decodeLegacyRow(input: unknown): LegacyFixtureRow | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "object") throw new Error("Invalid legacy fixture.");
  const row = input as Readonly<Record<string, unknown>>;
  return Object.freeze({
    scopeUuid: String(row.scopeUuid),
    epochUuid: String(row.epochUuid),
    storageGenerationFence: String(row.storageGenerationFence),
    appliedThroughCommitSeq: String(row.appliedThroughCommitSeq),
  });
}

function decodeNormalizedFixture(input: unknown): NormalizedFixture {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid normalized fixture.");
  }
  return input as NormalizedFixture;
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
