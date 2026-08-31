import {
  MAX_REFERENCE_QUERIES,
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
  makeAcceptedQueryPublicationEvidenceForTesting,
} from "@flarex/query-sync/testing/conformance";
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
  readDeploymentQuerySyncPublicationInstant,
} from "../src/deploymentSync/PublicationClock";
import type {
  DeploymentQuerySyncStorage,
} from "../src/deploymentSync/StorageContract";
import {
  makeDeploymentQuerySyncState,
  type DeploymentQuerySyncState,
} from "../src/deploymentSync/Store";
import { deploymentSyncObjectName } from "../src/routing";
import {
  createGeneration2Catalog,
  encodedDigest,
  exactBindingBudget,
  makeMaximumCompletionMaterial,
  maximumPopulationSummary,
  maximumQueryDescriptor,
  maximumRowSummary,
  seedGeneration2Maximum,
  storageWithBindingTrace,
} from "./deploymentQuerySyncC2MaximumWorkerdTestSupport";

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
      case "seedGeneration2Maximum":
        return Response.json({
          ok: true,
          value: serializeUnknown(seedGeneration2Maximum(
            this.ctx.storage,
            Result.getOrThrow(captureDeploymentQuerySyncBinding({
              objectId: this.ctx.id,
              observation: activeHeadObservation(input),
            })),
          )),
        });
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
      case "publicationClock":
        return Response.json({
          ok: true,
          value: String(readDeploymentQuerySyncPublicationInstant(
            this.ctx.storage.sql,
            "claimPublication",
          )),
        });
      case "preparePublicationForReopen":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => preparePublicationForReopen(
            state,
            this.ctx.storage.sql,
            input,
          ),
        ));
      case "completePublicationAfterReopen":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => completePublicationAfterReopen(
            state,
            this.ctx.storage.sql,
            input,
          ),
        ));
      case "migrateAndClaimMaximum":
        return await effectResponse(makeStateAndRun(
          this.ctx,
          input,
          state => migrateAndClaimMaximum(
            state,
            this.ctx.storage.sql,
            input,
          ),
        ));
      case "maximumRowVertical": {
        const bindingCounts: number[] = [];
        const storage = storageWithBindingTrace(
          this.ctx.storage,
          bindingCounts,
        );
        return await effectResponse(makeStateAndRun(
          this.ctx,
          { ...input, authorizedFresh: true },
          state => maximumRowVertical(
            state,
            this.ctx.storage.sql,
            bindingCounts,
            input,
          ),
          storage,
        ));
      }
      case "maximumPopulationSummary":
        return Response.json(serializeUnknown({
          ok: true,
          value: maximumPopulationSummary(this.ctx.storage.sql),
        }));
      case "maximumRowSummary":
        return Response.json(serializeUnknown({
          ok: true,
          value: maximumRowSummary(
            this.ctx.storage.sql,
            maximumQueryDescriptor(Number(input.querySeed ?? 1)),
          ),
        }));
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
  run: (state: DeploymentQuerySyncState) => Effect.Effect<A, E>,
  storage: DeploymentQuerySyncStorage = ctx.storage,
): Effect.Effect<
  A,
  E | Effect.Error<ReturnType<typeof makeDeploymentQuerySyncState>>
> {
  const observation = activeHeadObservation(input);
  const bindingInput = Object.freeze({ objectId: ctx.id, observation });
  const freshInitializationCapability = input.authorizedFresh === true
    ? makeDeploymentQuerySyncFreshInitializationCapabilityForTest(
      Result.getOrThrow(captureDeploymentQuerySyncBinding(bindingInput)),
    )
    : undefined;
  return makeDeploymentQuerySyncState({
    binding: bindingInput,
    storage,
    ...(freshInitializationCapability === undefined
      ? {}
      : { freshInitializationCapability }),
  }).pipe(Effect.flatMap(run));
}

function fullVertical(
  state: DeploymentQuerySyncState,
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
  state: DeploymentQuerySyncState,
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

function preparePublicationForReopen(
  state: DeploymentQuerySyncState,
  sql: SqlStorage,
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
    const claimed = yield* state.claimPublication();
    if (claimed._tag !== "claimed") {
      return yield* Effect.die(new Error(
        `Expected publication claim, observed ${claimed._tag}.`,
      ));
    }
    const recorded = yield* state.recordPublicationAttemptOutcome(
      claimed.attempt,
      "outcomeUnknown",
    );
    if (recorded._tag !== "recorded") {
      return yield* Effect.die(new Error(
        `Expected publication outcome record, observed ${recorded._tag}.`,
      ));
    }
    return Object.freeze({
      initialized,
      completed,
      claimed,
      recorded,
      stored: snapshot(sql),
    });
  });
}

function completePublicationAfterReopen(
  state: DeploymentQuerySyncState,
  sql: SqlStorage,
  input: TestRequest,
) {
  return Effect.gen(function* () {
    const initialized = yield* state.initializeOrInspectNamespace(
      bootstrapCursor(input),
    );
    const reopened = snapshot(sql);
    const replayedClaim = yield* state.claimPublication();
    if (replayedClaim._tag !== "replayed") {
      return yield* Effect.die(new Error(
        `Expected publication claim replay, observed ${replayedClaim._tag}.`,
      ));
    }
    const accepted = makeAcceptedQueryPublicationEvidenceForTesting({
      identity: replayedClaim.attempt.publication.identity,
      resultDigest: replayedClaim.attempt.publication.resultDigest,
    });
    const beforeFailure = snapshot(sql);
    sql.exec(`CREATE TRIGGER deployment_sync_test_fail_publication_completion
      BEFORE UPDATE OF in_flight_publication_count
      ON deployment_sync_scope_state
      WHEN OLD.in_flight_publication_count = 1
        AND NEW.in_flight_publication_count = 0
      BEGIN
        SELECT RAISE(FAIL, 'forced publication completion rollback');
      END`);
    const failedExit = yield* Effect.exit(
      state.completePublication(accepted),
    );
    sql.exec("DROP TRIGGER deployment_sync_test_fail_publication_completion");
    const afterFailure = snapshot(sql);
    const completed = yield* state.completePublication(accepted);
    const replayed = yield* state.completePublication(accepted);
    return Object.freeze({
      initialized,
      reopened,
      replayedClaim,
      firstDied: Exit.isFailure(failedExit)
        && Cause.hasDies(failedExit.cause),
      firstTypedFailure: Exit.isFailure(failedExit)
        && Option.isSome(Cause.findErrorOption(failedExit.cause)),
      beforeFailure,
      afterFailure,
      completed,
      replayed,
      stored: snapshot(sql),
    });
  });
}

function migrateAndClaimMaximum(
  state: DeploymentQuerySyncState,
  sql: SqlStorage,
  input: TestRequest,
) {
  return Effect.gen(function* () {
    const initialized = yield* state.initializeOrInspectNamespace(
      bootstrapCursor(input),
    );
    if (initialized._tag !== "existing") {
      return yield* Effect.die(new Error(
        `Expected migrated maximum generation-2 state, observed ${initialized._tag}.`,
      ));
    }
    const migratedPopulation = maximumPopulationSummary(sql);
    const claimed = yield* state.claimEvaluationWork({
      maximumQueryInspections: MAX_REFERENCE_QUERIES,
      continuation: null,
    });
    if (claimed._tag !== "claimed") {
      return yield* Effect.die(new Error(
        `Expected maximum-population claim, observed ${claimed._tag}.`,
      ));
    }
    return Object.freeze({
      initialized: Object.freeze({
        _tag: initialized._tag,
        queryCount: initialized.metrics.queryCount,
        retainedIdentityBytes: initialized.metrics.retainedIdentityBytes,
      }),
      claimed: Object.freeze({
        _tag: claimed._tag,
        generation: claimed.attempt.generation,
        queryKey: claimed.attempt.descriptor.queryKey,
        queryIdentityCharacters:
          claimed.attempt.descriptor.queryIdentity.length,
      }),
      migratedPopulation,
      claimedPopulation: maximumPopulationSummary(sql),
    });
  });
}

function maximumRowVertical(
  state: DeploymentQuerySyncState,
  sql: SqlStorage,
  bindingCounts: readonly number[],
  input: TestRequest,
) {
  return Effect.gen(function* () {
    const cursor = bootstrapCursor(input);
    const initialized = yield* state.initializeOrInspectNamespace(cursor);
    if (initialized._tag !== "initialized") {
      return yield* Effect.die(new Error(
        `Expected fresh maximum-row initialization, observed ${initialized._tag}.`,
      ));
    }
    const descriptor = maximumQueryDescriptor(Number(input.querySeed ?? 1));
    const begun = yield* state.beginQueryEvaluation(
      firstEvaluationRequest(cursor, descriptor),
    );
    const attempt = requireCreatedAttempt(begun);
    const material = makeMaximumCompletionMaterial(
      cursor,
      descriptor,
      attempt,
    );
    const completed = yield* state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    );
    if (completed._tag !== "completed") {
      return yield* Effect.die(new Error(
        `Expected maximum-row completion, observed ${completed._tag}.`,
      ));
    }
    const replayed = yield* state.completeQueryEvaluation(
      attempt,
      material.evaluation,
      material.refresh,
      material.publication,
    );
    if (replayed._tag !== "replayed") {
      return yield* Effect.die(new Error(
        `Expected maximum-row replay, observed ${replayed._tag}.`,
      ));
    }
    const applied = yield* state.applyAdmittedBatchAndAdvance(
      Result.getOrThrow(captureAdmittedInvalidationBatch({
        namespaceId: cursor.namespaceId,
        syncModelId: cursor.syncModelId,
        sourceEpoch: cursor.sourceEpoch,
        sourceSequence: 1n,
        dependencyKeys: material.dependencyKeys,
      })),
    );
    if (applied._tag !== "applied") {
      return yield* Effect.die(new Error(
        `Expected maximum-row invalidation, observed ${applied._tag}.`,
      ));
    }
    return Object.freeze({
      initialized: initialized._tag,
      begun: begun._tag,
      completed: Object.freeze({
        _tag: completed._tag,
        generation: completed.generation,
        publicationDisposition: completed.publicationDisposition._tag,
      }),
      replayed: Object.freeze({
        _tag: replayed._tag,
        generation: replayed.generation,
        publicationDisposition: replayed.publicationDisposition._tag,
      }),
      applied: Object.freeze({
        _tag: applied._tag,
        appliedSequence: applied.appliedSequence,
        affectedQueryCount: applied.affectedQueryKeys.length,
      }),
      dependencyLookupBindingCounts: Object.freeze([...bindingCounts]),
      bindingBudget: exactBindingBudget(sql),
      maximumRow: maximumRowSummary(sql, descriptor),
    });
  });
}

function requireCreatedAttempt(
  receipt: Effect.Success<
    ReturnType<DeploymentQuerySyncState["beginQueryEvaluation"]>
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
  createGeneration2Catalog(sql);
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
    inFlight: selectIfPresent(
      sql,
      "deployment_sync_in_flight_publication",
      "singleton",
    ),
    publicationState: selectIfPresent(
      sql,
      "deployment_sync_publication_state",
      "singleton",
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
