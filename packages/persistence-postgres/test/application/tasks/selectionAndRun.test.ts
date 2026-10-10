import { webcrypto } from "node:crypto";
import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { makeTaskRunQueryLayer, TaskRunQuery } from "@flarex/durable-task/internal/run-projection";
import {
  makeTaskRunResultQueryLayer,
  TaskRunResultQuery,
} from "@flarex/durable-task/internal/run-result-query";
import {
  decideApplicationStartAttemptV1,
  decideApplicationRequestCancellationV1,
  decodeApplicationPersistedTaskRequestedEffectJsonV1,
  decodeTaskDurationMsV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  encodeApplicationPersistedTaskRequestedEffectJsonV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  validateTaskComputeDispatchAcceptanceV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskRunCreationAuthorityPreimageV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { Effect, Result } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  claimApplicationTaskSelection,
  selectApplicationTask,
  validateApplicationTaskSelection,
} from "../../../src/application/tasks/applicationTaskSelection";
import {
  makeApplicationTaskSystemRunCreationStore,
} from "../../../src/application/tasks/applicationTaskSystemRunCreation";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  makeTaskComputeDeliveryRepositoryV1,
} from "../../../src/tasks/taskComputeDeliveryRepositoryV1";
import { makeTaskComputeDeliveryCandidateDiscovery } from "../../../src/tasks/taskComputeDeliveryDiscovery";
import {
  decodeCurrentTaskComputePreparedExecutionV1,
} from "../../../src/tasks/taskComputeDeliveryEvidenceV1";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeApplicationTaskSystemRunAttemptStoreV1,
} from "../../../src/tasks/taskSystemRunAttemptStoreV1";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { RUNTIME_HOST_IDENTITY, COMPATIBILITY_DATE, taskSha256 } from "../support/readinessArtifacts";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities } from "../support/readinessPreparation";
import { createAdditionalApplicationRevision } from "../support/readinessPublication";
import {
  scalarCount,
  uuidSequence,
  sha256Bytes,
  canonicalJsonByteLength,
} from "../support/readinessEvidence";
import {
  APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY,
  replaceApplicationDispatchDigestInJson,
} from "./support/taskSelection";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application tasks/selectionAndRun", { timeout: 30_000 }, () => {
  it("selects one immutable Application task without creating a run and invalidates it on head movement", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const runCountBefore = await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    );
    const selected = await runEffect(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    ));

    expect(selected.metadata.target).toMatchObject({
      version: 1,
      revisionId: fixture.input.revisionId,
      taskId: "tasks.users.get",
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      handler: {
        logicalModulePath: "users",
        sourceModulePath: "users.js",
        exportName: "get",
      },
    });
    expect(Result.isSuccess(claimApplicationTaskSelection(
      selected.selection,
    ))).toBe(true);
    expect(Result.isFailure(claimApplicationTaskSelection(
      Object.freeze({ ...selected.selection }),
    ))).toBe(true);
    expect((await runEffect(validateApplicationTaskSelection(
      selected.selection,
    ))).target.taskId).toBe("tasks.users.get");
    selected.metadata.basis.taskCatalogBindingSha256.fill(0);
    selected.metadata.runtimeTargetSha256.fill(0);
    expect((await runEffect(validateApplicationTaskSelection(
      selected.selection,
    ))).target.taskId).toBe("tasks.users.get");
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(runCountBefore);

    const wrongHost = await runEffect(Effect.result(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: `${RUNTIME_HOST_IDENTITY}:wrong`,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    )));
    expect(Result.isFailure(wrongHost)).toBe(true);
    if (Result.isFailure(wrongHost)) {
      expect(wrongHost.failure).toMatchObject({ reason: "runtimeHostMismatch" });
    }

    const nextRevisionId = await createAdditionalApplicationRevision(fixture);
    expect(await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      revisionId: nextRevisionId,
    }))).toMatchObject({ status: "ready" });
    await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: first.expectedActiveHead,
    }));
    const stale = await runEffect(Effect.result(
      validateApplicationTaskSelection(selected.selection),
    ));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({ reason: "concurrentHead" });
    }
  })

  it("creates and replays one Application task run from the authentic selection", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const selected = await runEffect(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    ));
    const located = Object.freeze({
      authority: active.basis.authority,
      target: createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        active.basis.authority.physicalLocator,
      ),
    });
    const mutableCreationOptions = {
      sha256: taskSha256,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs: Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
      randomUuid: uuidSequence(90),
    };
    const store = makeApplicationTaskSystemRunCreationStore(
      located,
      mutableCreationOptions,
    );
    const request = Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: "application-task-run-1",
      applicationTaskRuntimeTargetSha256: selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(
        new Uint8Array(32).fill(0x71),
        19,
      )),
      principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
        new Uint8Array(32).fill(0x73),
        23,
      )),
    }));
    const foreignLocator = Object.freeze({
      ...active.basis.authority.physicalLocator,
      databaseKey: `${active.basis.authority.physicalLocator.databaseKey}:foreign`,
    });
    const foreignStore = makeApplicationTaskSystemRunCreationStore({
      authority: Object.freeze({
        ...active.basis.authority,
        physicalLocator: foreignLocator,
      }),
      target: createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        foreignLocator,
      ),
    }, {
      sha256: taskSha256,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs: Result.getOrThrow(
        decodeTaskDurationMsV1(5_000),
      ),
      randomUuid: uuidSequence(89),
    });
    const foreignResult = await runEffect(Effect.result(
      foreignStore.createRun(selected.selection, request),
    ));
    expect(Result.isFailure(foreignResult)).toBe(true);
    if (Result.isFailure(foreignResult)) {
      expect(foreignResult.failure).toMatchObject({
        operation: "create_run",
        reason: "request_authority_mismatch",
      });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(0);
    const created = await runEffect(store.createRun(selected.selection, request));
    const storedPrincipal = await fixture.target.query<{
      execution_principal_generation: string;
      execution_principal_kind: string | null;
      execution_principal_codec: string | null;
      execution_principal_store: string | null;
      execution_principal_value_codec: string | null;
      execution_principal_object_key: string | null;
      execution_principal_byte_length: bigint | null;
      execution_principal_sha256: Uint8Array | null;
      execution_principal_retention: string | null;
    }>(`
      select execution_principal_generation, execution_principal_kind,
             execution_principal_codec,
             execution_principal_store, execution_principal_value_codec,
             execution_principal_object_key, execution_principal_byte_length,
             execution_principal_sha256, execution_principal_retention
        from fx_system_durable_task_run_v1
       where scope_id = $1 and run_id = $2
    `, [fixture.authority.scopeId, created.runId]);
    expect(storedPrincipal.rows).toHaveLength(1);
    expect(storedPrincipal.rows[0]).toMatchObject({
      execution_principal_generation: "present_v1",
      execution_principal_kind: request.principal.principalKind,
      execution_principal_codec: request.principal.codec,
      execution_principal_store: request.principal.store,
      execution_principal_value_codec: request.principal.valueCodec,
      execution_principal_object_key: request.principal.objectKey,
      execution_principal_byte_length: request.principal.byteLength,
      execution_principal_retention: request.principal.retention.kind,
    });
    expect(Array.from(
      storedPrincipal.rows[0]?.execution_principal_sha256 ?? [],
    )).toEqual(Array.from(request.principal.sha256));
    mutableCreationOptions.sha256 = () => Effect.succeed(
      new Uint8Array(32).fill(0xdd),
    );
    expect(await runEffect(store.createRun(selected.selection, request)))
      .toEqual(created);
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(1);
    const foreignReplay = await runEffect(Effect.result(
      foreignStore.createRun(selected.selection, request),
    ));
    expect(Result.isFailure(foreignReplay)).toBe(true);
    if (Result.isFailure(foreignReplay)) {
      expect(foreignReplay.failure).toMatchObject({
        operation: "create_run",
        reason: "request_authority_mismatch",
      });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(1);
    const nextRevisionId = await createAdditionalApplicationRevision(fixture, true);
    expect(await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      revisionId: nextRevisionId,
    }))).toMatchObject({ status: "ready" });
    await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: active.expectedActiveHead,
    }));
    const replayRequest = Object.freeze({
      version: request.version,
      requestKey: request.requestKey,
      input: request.input,
      principal: request.principal,
    });
    expect(await runEffect(store.replayRun(
      "tasks.users.get",
      replayRequest,
    ))).toEqual(created);
    const missingRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        requestKey: "application-task-missing",
      }),
    );
    expect(await runEffect(store.replayRun(
      "tasks.users.get",
      Object.freeze({
        version: missingRequest.version,
        requestKey: missingRequest.requestKey,
        input: missingRequest.input,
        principal: missingRequest.principal,
      }),
    ))).toBeNull();
    const replayed = await runEffect(store.createRun(selected.selection, request));
    expect(replayed).toEqual(created);
    const staleNewRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        requestKey: "application-task-run-stale-new",
      }),
    );
    const staleResult = await runEffect(Effect.result(
      store.createRun(selected.selection, staleNewRequest),
    ));
    expect(Result.isFailure(staleResult)).toBe(true);
    if (Result.isFailure(staleResult)) {
      expect(staleResult.failure).toMatchObject({
        operation: "validateSelection",
        reason: "concurrentHead",
      });
    }
    const conflictingRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        input: Result.getOrThrow(makeTaskInputReferenceV1(
          new Uint8Array(32).fill(0x72),
          19,
        )),
      }),
    );
    const conflict = await runEffect(Effect.result(
      store.createRun(selected.selection, conflictingRequest),
    ));
    expect(Result.isFailure(conflict)).toBe(true);
    if (Result.isFailure(conflict)) {
      expect(conflict.failure).toMatchObject({
        _tag: "TaskRunCreationIdempotencyConflictError",
        reason: "request_digest_mismatch",
      });
    }
    const principalConflictRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
          new Uint8Array(32).fill(0x74),
          23,
        )),
      }),
    );
    const principalConflict = await runEffect(Effect.result(
      store.createRun(selected.selection, principalConflictRequest),
    ));
    expect(Result.isFailure(principalConflict)).toBe(true);
    if (Result.isFailure(principalConflict)) {
      expect(principalConflict.failure).toMatchObject({
        _tag: "TaskRunCreationIdempotencyConflictError",
        reason: "request_digest_mismatch",
      });
    }
    const lifecycleStore = makeApplicationTaskSystemRunAttemptStoreV1(located, {
      randomUuid: uuidSequence(91),
    });
    const projectedRun = await runEffect(Effect.gen(function* () {
      const query = yield* TaskRunQuery;
      return yield* query.inspect(created.runId);
    }).pipe(Effect.provide(makeTaskRunQueryLayer(lifecycleStore))));
    expect(projectedRun).toMatchObject({
      runId: created.runId,
      createdAtMs: created.createdAtMs,
      runVersion: 1n,
      state: {
        kind: "ready",
        eligibleAtMs: created.createdAtMs,
        cancellation: { kind: "not_requested" },
      },
    });
    expect(Object.isFrozen(projectedRun)).toBe(true);
    expect(Object.isFrozen(projectedRun.state)).toBe(true);
    const unavailableResult = await runEffect(Effect.result(
      Effect.gen(function* () {
        const resultQuery = yield* TaskRunResultQuery;
        return yield* resultQuery.authorizeRead(created.runId);
      }).pipe(Effect.provide(makeTaskRunResultQueryLayer(lifecycleStore))),
    ));
    expect(Result.isFailure(unavailableResult)).toBe(true);
    if (Result.isFailure(unavailableResult)) {
      expect(unavailableResult.failure).toMatchObject({
        _tag: "TaskRunResultUnavailableError",
        runId: created.runId,
        reason: "run_incomplete",
      });
    }
    const startCommand = Object.freeze({
      type: "start_attempt" as const,
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    });
    const started = await runEffect(lifecycleStore.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: input => decideApplicationStartAttemptV1(startCommand, input),
    }));
    const startReplay = await runEffect(lifecycleStore.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: input => decideApplicationStartAttemptV1(startCommand, input),
    }));
    expect(started).toMatchObject({
      disposition: "accepted",
      runVersion: 2n,
      outcome: { kind: "attempt_granted" },
    });
    expect(startReplay).toEqual({ ...started, disposition: "idempotent" });
    const computeTarget = createLocatedTaskComputeDeliveryTargetV1(
      fixture.target.drizzle,
      active.basis.authority.physicalLocator,
    );
    const applicationDiscovery = Result.getOrThrow(
      makeTaskComputeDeliveryCandidateDiscovery(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY,
        "legacy_and_application",
      ),
    );
    const legacyDiscovery = Result.getOrThrow(
      makeTaskComputeDeliveryCandidateDiscovery(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY,
        "legacy_only",
      ),
    );
    expect((await runEffect(
      applicationDiscovery.discoverDispatchCandidates({ limit: 10 }),
    )).candidates.map(candidate => candidate.runId)).toEqual([created.runId]);
    expect((await runEffect(
      legacyDiscovery.discoverDispatchCandidates({ limit: 10 }),
    )).candidates).toEqual([]);
    const computeRepository = Result.getOrThrow(
      makeTaskComputeDeliveryRepositoryV1(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        {
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
          maximumDeliveryAttempts: 3,
          randomUuid: uuidSequence(92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
            102, 103, 104, 105, 106, 107),
        },
      ),
    );
    const acquireRequest = {
      runId: created.runId,
      requestedEffectSequence: Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1("1"),
      ),
    } as const;
    const storedRunAuthority = await fixture.target.query<{
      creation_authority_byte_length: bigint;
      creation_authority_sha256: Uint8Array;
      creation_authority_bytes: Uint8Array;
    }>(`select creation_authority_byte_length, creation_authority_sha256,
               creation_authority_bytes
          from fx_system_durable_task_run_v1
         where scope_id = $1 and run_id = $2`, [
      fixture.authority.scopeId,
      created.runId,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_bytes = set_byte(creation_authority_bytes, 0,
        (get_byte(creation_authority_bytes, 0) + 1) % 256)
      where scope_id = $1 and run_id = $2
    `, [fixture.authority.scopeId, created.runId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "creation_authority_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_bytes = $3
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      storedRunAuthority.rows[0]!.creation_authority_bytes,
    ]);
    const storedCreationAuthority = Result.getOrThrow(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(
        storedRunAuthority.rows[0]!.creation_authority_bytes,
      ),
    );
    const mismatchedCreationAuthorityBytes = Result.getOrThrow(
      encodeApplicationTaskRunCreationAuthorityPreimageV1({
        ...storedCreationAuthority,
        runtimeTarget: {
          ...storedCreationAuthority.runtimeTarget,
          runtimeHostIdentity:
            `${storedCreationAuthority.runtimeTarget.runtimeHostIdentity}-mismatch`,
        },
      }),
    );
    const mismatchedCreationAuthoritySha256 = await sha256Bytes(
      mismatchedCreationAuthorityBytes,
    );
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_byte_length = $3,
          creation_authority_sha256 = $4,
          creation_authority_bytes = $5
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      BigInt(mismatchedCreationAuthorityBytes.byteLength),
      mismatchedCreationAuthoritySha256,
      mismatchedCreationAuthorityBytes,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "creation_authority_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_byte_length = $3,
          creation_authority_sha256 = $4,
          creation_authority_bytes = $5
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      storedRunAuthority.rows[0]!.creation_authority_byte_length,
      storedRunAuthority.rows[0]!.creation_authority_sha256,
      storedRunAuthority.rows[0]!.creation_authority_bytes,
    ]);
    const storedCatalogBinding = await fixture.target.query<{
      binding_bytes: Uint8Array;
    }>(`select binding_bytes from fx_system_application_task_catalog_v1
        where scope_id = $1 and revision_id = $2`, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
    ]);
    await fixture.target.query(`
      alter table fx_system_application_task_catalog_v1
      drop constraint fx_application_task_catalog_v1_identity_check
    `);
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = decode(repeat('00', 16777217), 'hex')
      where scope_id = $1 and revision_id = $2
    `, [fixture.authority.scopeId, fixture.input.revisionId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = $3
      where scope_id = $1 and revision_id = $2
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      storedCatalogBinding.rows[0]!.binding_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = set_byte(binding_bytes, 0,
        (get_byte(binding_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2
    `, [fixture.authority.scopeId, fixture.input.revisionId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = $3
      where scope_id = $1 and revision_id = $2
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      storedCatalogBinding.rows[0]!.binding_bytes,
    ]);
    const storedDefinition = await fixture.target.query<{
      canonical_task_manifest_sha256: Uint8Array;
      binding_bytes: Uint8Array;
      manifest_bytes: Uint8Array;
    }>(`select canonical_task_manifest_sha256, binding_bytes, manifest_bytes
          from fx_system_application_task_definition_v1
         where scope_id = $1 and revision_id = $2 and task_id = $3`, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set binding_bytes = set_byte(binding_bytes, 0,
        (get_byte(binding_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set binding_bytes = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.binding_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set manifest_bytes = set_byte(manifest_bytes, 0,
        (get_byte(manifest_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set manifest_bytes = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.manifest_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set canonical_task_manifest_sha256 = decode(repeat('ee', 32), 'hex')
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set canonical_task_manifest_sha256 = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.canonical_task_manifest_sha256,
    ]);
    const storedEffect = await fixture.target.query<{
      payload_byte_length: bigint;
      payload_json: unknown;
    }>(`select payload_byte_length, payload_json
          from fx_system_durable_task_requested_effect_v1
         where scope_id = $1 and run_id = $2 and sequence = 1`, [
      fixture.authority.scopeId,
      created.runId,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = jsonb_set(payload_json, '{kind}', '"continue_retry"')
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [fixture.authority.scopeId, created.runId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "effect_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(storedEffect.rows[0]!.payload_json),
    ]);
    const mismatchedEffectDigest = new Uint8Array(32).fill(0xcd);
    const mismatchedEffectPayload = replaceApplicationDispatchDigestInJson(
      storedEffect.rows[0]!.payload_json,
      mismatchedEffectDigest,
    );
    const canonicalMismatchedEffect = Result.getOrThrow(
      encodeApplicationPersistedTaskRequestedEffectJsonV1(Result.getOrThrow(
        decodeApplicationPersistedTaskRequestedEffectJsonV1(
          mismatchedEffectPayload,
        ),
      )),
    );
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb, payload_byte_length = $4
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(mismatchedEffectPayload),
      canonicalJsonByteLength(canonicalMismatchedEffect),
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb, payload_byte_length = $4
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(storedEffect.rows[0]!.payload_json),
      storedEffect.rows[0]!.payload_byte_length,
    ]);
    const prepared = await runEffect(computeRepository.acquireDispatch(
      acquireRequest,
    ));
    expect(prepared.kind).toBe("claimed");
    if (prepared.kind !== "claimed") {
      throw new Error("Application dispatch was not prepared.");
    }
    expect(prepared.prepared).toMatchObject({
      generation: "application_v1",
      runtimeTarget: selected.metadata.target,
      manifest: selected.metadata.manifest,
      creationAuthority: {
        applicationTaskRuntimeTargetSha256:
          selected.metadata.runtimeTargetSha256,
      },
      dispatchRequest: {
        applicationTaskRuntimeTargetSha256:
          selected.metadata.runtimeTargetSha256,
      },
    });
    expect(Result.getOrThrow(
      decodeCurrentTaskComputePreparedExecutionV1(prepared.prepared),
    )).toEqual(prepared.prepared);
    await runEffect(
      computeRepository.markDispatchDeliveryStarted(prepared.handle),
    );
    await fixture.target.query(`
      update fx_system_durable_task_compute_dispatch_v1
      set claimed_at = clock_timestamp() - interval '2 minutes',
          claim_expires_at = clock_timestamp() - interval '1 minute'
      where scope_id = $1 and run_id = $2
        and requested_effect_sequence = 1
    `, [fixture.authority.scopeId, created.runId]);
    const recovered = await runEffect(
      computeRepository.acquireDispatch(acquireRequest),
    );
    expect(recovered.kind).toBe("claimed");
    if (recovered.kind !== "claimed") {
      throw new Error("Application uncertain dispatch was not reclaimed.");
    }
    expect(recovered.deliveryMode).toBe("uncertain_replay");
    expect(await runEffect(
      computeRepository.verifyDispatchRecovery(recovered.handle),
    )).toEqual({ kind: "state_unchanged" });
    await runEffect(
      computeRepository.markDispatchDeliveryStarted(recovered.handle),
    );
    const acceptance = Result.getOrThrow(
      validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: recovered.prepared.dispatchRequest.identity,
        execution: {
          provider: "application-test-provider",
          providerVersion: "v1",
          executionId: "application-execution-1",
        },
      }),
    );
    expect(await runEffect(computeRepository.recordDispatchAcceptance(
      recovered.handle,
      acceptance,
    ))).toEqual({
      kind: "dispatch_accepted",
      acceptance,
      disposition: "current",
    });
    expect(await runEffect(computeRepository.acquireDispatch(acquireRequest)))
      .toEqual({
      kind: "accepted",
      acceptance,
      disposition: "current",
    });
    const cancellationDecision = await runEffect(
      lifecycleStore.transactRunAttempt({
        operation: "request_cancellation",
        runId: created.runId,
        decide: input => decideApplicationRequestCancellationV1({
          type: "request_cancellation",
          runId: created.runId,
          reason: { code: "requested", message: null },
        }, input),
      }),
    );
    const cancellationEffect = cancellationDecision.requestedEffects.find(
      item => item.effect.kind === "request_execution_cancellation",
    );
    if (cancellationEffect === undefined) {
      throw new Error("Application cancellation effect was not emitted.");
    }
    const cancellation = await runEffect(computeRepository.acquireCancellation({
      runId: created.runId,
      requestedEffectSequence: cancellationEffect.sequence,
    }));
    expect(cancellation.kind).toBe("claimed");
    if (cancellation.kind !== "claimed") {
      throw new Error("Application cancellation was not prepared.");
    }
    expect(cancellation.request.identity).toEqual(acceptance.identity);
    expect((await runEffect(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).current).toMatchObject({
      runVersion: 3n,
      phase: "attempt_granted",
      applicationTaskRuntimeTargetSha256:
        selected.metadata.runtimeTargetSha256,
    });
    const rows = await fixture.target.query<{
      definition_generation: string;
      task_definition_revision_id: string | null;
      application_task_runtime_target_sha256: Uint8Array;
    }>(`select definition_generation, task_definition_revision_id,
              application_task_runtime_target_sha256
         from fx_system_durable_task_run_v1
        where run_id = $1`, [created.runId]);
    expect(rows.rows[0]).toMatchObject({
      definition_generation: "application_v1",
      task_definition_revision_id: null,
    });
    expect(Array.from(rows.rows[0]!.application_task_runtime_target_sha256))
      .toEqual(Array.from(selected.metadata.runtimeTargetSha256));
    const postDispatchAggregate = await fixture.target.query<{
      aggregate_json: unknown;
      aggregate_byte_length: string;
    }>(`select aggregate_json, aggregate_byte_length::text
          from fx_system_durable_task_run_v1 where run_id = $1`, [created.runId]);
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set aggregate_json = '{}'::jsonb, aggregate_byte_length = 2
      where run_id = $1
    `, [created.runId]);
    await expect(runEffectFailure(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).resolves.toMatchObject({ reason: "aggregate_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set aggregate_json = $2::jsonb, aggregate_byte_length = $3
      where run_id = $1
    `, [
      created.runId,
      JSON.stringify(postDispatchAggregate.rows[0]!.aggregate_json),
      postDispatchAggregate.rows[0]!.aggregate_byte_length,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = '{}'::jsonb, payload_byte_length = 2
      where run_id = $1 and sequence = 1
    `, [created.runId]);
    await expect(runEffectFailure(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).resolves.toMatchObject({ reason: "acceptance_invalid" });
  })

  it("rejects a missing or corrupted stored Application task", async () => {
    const empty = await readinessFixture();
    await prepareReadinessAuthorities(empty);
    const emptyActivation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: empty.input.deploymentId,
      scopeId: empty.input.scopeId,
      readiness: empty.repository,
      authority: empty.authorityPorts,
    });
    await runEffect(emptyActivation.activate({
      revisionId: empty.input.revisionId,
      expectedActiveHead: null,
    }));
    const emptyActive = await runEffect(emptyActivation.readActive());
    const missing = await runEffect(Effect.result(selectApplicationTask(
      emptyActive.selection,
      "tasks.users.get",
      {
        deploymentId: empty.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: empty.authorityPorts,
      },
    )));
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure).toMatchObject({ reason: "taskMissing" });
    }

    const corrupt = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(corrupt);
    const corruptActivation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: corrupt.input.deploymentId,
      scopeId: corrupt.input.scopeId,
      readiness: corrupt.repository,
      authority: corrupt.authorityPorts,
    });
    await runEffect(corruptActivation.activate({
      revisionId: corrupt.input.revisionId,
      expectedActiveHead: null,
    }));
    const corruptActive = await runEffect(corruptActivation.readActive());
    const selectedBeforeCorruption = await runEffect(selectApplicationTask(
      corruptActive.selection,
      "tasks.users.get",
      {
        deploymentId: corrupt.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: corrupt.authorityPorts,
      },
    ));
    await corrupt.target.query(
      `update fx_system_application_task_definition_v1
          set binding_bytes = $1
        where scope_id = $2 and revision_id = $3 and task_id = $4`,
      [
        new Uint8Array([1]),
        corrupt.authority.scopeId,
        corrupt.input.revisionId,
        "tasks.users.get",
      ],
    );
    const invalidated = await runEffect(Effect.result(
      validateApplicationTaskSelection(selectedBeforeCorruption.selection),
    ));
    expect(Result.isFailure(invalidated)).toBe(true);
    if (Result.isFailure(invalidated)) {
      expect(invalidated.failure).toMatchObject({
        operation: "validate",
        reason: "storedTask",
      });
    }
    const corrupted = await runEffect(Effect.result(selectApplicationTask(
      corruptActive.selection,
      "tasks.users.get",
      {
        deploymentId: corrupt.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: corrupt.authorityPorts,
      },
    )));
    expect(Result.isFailure(corrupted)).toBe(true);
    if (Result.isFailure(corrupted)) {
      expect(corrupted.failure).toMatchObject({ reason: "storedTask" });
    }
  })
});
