import {
  TaskComputeProvider,
  decodeTaskComputeProviderDescriptorV1,
  type TaskComputeProviderShape,
} from "../../../durable-task/src/computeProvider/v1.js";
import {
  RunAttemptLifecycle,
  RunAttemptLifecycleLive,
  TaskSystemRunAttemptStore,
  decodeTaskRunVersionV1,
} from "../../../durable-task/src/runAttempt/v1.js";
import {
  makeInMemoryTaskComputeProviderV1,
} from "../../../durable-task/src/computeProvider/testing-v1.js";
import {
  createPGliteLocatedTaskSystemRunAttemptTargetV1,
  createPGliteTaskComputeDeliveryControlDirectoryTarget,
  makeTaskSystemRunAttemptStoreV1,
} from "@flarex/persistence-postgres/pglite";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  type LocatedTaskComputeDeliveryTargetV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
  type ScopePhysicalLocator,
  type TrustedScopeAuthorityResolutionPorts,
} from "@flarex/persistence-postgres";
import {
  TaskComputeDeliveryCandidateRunnerLive,
  TaskComputeDeliveryCandidateRunner,
  TaskComputeDeliveryConnectedRunner,
  makeTaskComputeDeliveryConnectedRunnerLayer,
  makeTaskComputeDeliveryTrustedDirectoryLayer,
  type EncodedTaskComputeDeliveryConnectedContinuationV1,
  type TaskComputeDeliveryCandidateRunnerShape,
  type TaskComputeDeliveryConnectedRunnerOptions,
} from "flarex-backend/internal/task-compute-delivery";
import { Effect, Fiber, Layer, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  ACCEPTED_ATTEMPT_UUID,
  TASK_LOCATOR,
  seedTaskSystemRunAttemptStoreV1,
} from "../../../persistence-postgres/test/taskSystemRunAttemptStoreTestSupport.js";
import {
  TASK_SYSTEM_CREATION_RUN_UUID_A,
  TASK_SYSTEM_CREATION_RUN_UUID_B,
  installTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationAuthorityV1,
  makeTaskSystemCreationRequestV1,
  makeTaskSystemCreationRuntimeBindingV1,
  makeTaskSystemCreationStoreForTestV1,
  taskSystemCreationRetryJitterV1,
} from "../../../persistence-postgres/test/taskSystemRunCreationTestSupport.js";
import { createMigratedPGlitePersistence } from "../support/databaseFixturesV1";

const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 100,
  lockTimeoutMilliseconds: 100,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 2_000,
});
const PROVIDER_DESCRIPTOR = Result.getOrThrow(
  decodeTaskComputeProviderDescriptorV1({
    provider: "memory",
    providerVersion: "connected-pglite-v1",
  }),
);
const PRIMARY_FIXTURE = Object.freeze({
  scopeId: ScopeIdSchema.make(
    "scope_72000000-0000-4000-8000-000000000001",
  ),
  deploymentId: "deployment_task_store_v1",
  applicationRevisionId: "apprev_task_store_v1",
  candidateSha256Hex: "31".repeat(32),
  locator: TASK_LOCATOR,
  projectId: "project_dte06_c3_connected_primary",
  runUuid: TASK_SYSTEM_CREATION_RUN_UUID_A,
});
const SECONDARY_FIXTURE = Object.freeze({
  scopeId: ScopeIdSchema.make(
    "scope_72000000-0000-4000-8000-000000000011",
  ),
  deploymentId: "deployment_task_store_v1_secondary",
  applicationRevisionId: "apprev_task_store_v1",
  candidateSha256Hex: "31".repeat(32),
  locator: Object.freeze({
    kind: "shared_database",
    databaseKey: "dte06-c3-secondary",
    schemaName: "public",
  } satisfies ScopePhysicalLocator),
  projectId: "project_dte06_c3_connected_secondary",
  runUuid: TASK_SYSTEM_CREATION_RUN_UUID_B,
});
type DeliveryFixtureIdentity = typeof PRIMARY_FIXTURE | typeof SECONDARY_FIXTURE;

describe("DTE06-C3 connected delivery - PGlite", () => {
  it("fences two hosts, resumes the exact scope, and settles cancellation", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const fixture = await createDeliveryFixture(
      persistence,
      persistence,
      PRIMARY_FIXTURE,
    );

    const entered = latch<void>();
    const release = latch<void>();
    const provider = Result.getOrThrow(makeInMemoryTaskComputeProviderV1(
      PROVIDER_DESCRIPTOR,
      {
        beforeDispatch: () => Effect.promise(() => {
          entered.resolve();
          return release.promise;
        }),
      },
    ));
    const controlTarget = Result.getOrThrow(
      createPGliteTaskComputeDeliveryControlDirectoryTarget(
        persistence,
        DEADLINE_POLICY,
      ),
    );
    const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
      persistence.drizzle,
      TASK_LOCATOR,
    );

    const firstHost = connectedLayer(
      controlTarget,
      authorityPorts(persistence, async () => deliveryTarget),
      provider,
      "a3000000-0000-4000-8000-000000000001",
      oneCandidatePolicy(),
    );
    const secondHost = connectedLayer(
      controlTarget,
      authorityPorts(persistence, async () => deliveryTarget),
      provider,
      "a3000000-0000-4000-8000-000000000002",
      oneCandidatePolicy(),
    );

    const firstRunFiber = Effect.runFork(connected(firstHost, null));
    const firstRunPromise = Effect.runPromise(Fiber.join(firstRunFiber));
    try {
      const firstProgress = await withTimeout(Promise.race([
        entered.promise.then(() => Object.freeze({ kind: "entered" as const })),
        firstRunPromise.then((receipt) => Object.freeze({
          kind: "completed" as const,
          receipt,
        })),
      ]), 5_000, "dispatch provider was not entered");
      if (firstProgress.kind === "completed") {
        throw new Error(
          `first connected run completed before provider entry: ${firstProgress.receipt.stopReason}`,
        );
      }
      const secondReceipt = await runConnected(secondHost, null);
      expect(secondReceipt).toMatchObject({
        stopReason: "cycle_exhausted",
        confirmedDispatchCandidatesHandled: 0,
        confirmedDispatchProviderCalls: 0,
      });
      expect(provider.dispatchRequests()).toHaveLength(1);
      release.resolve();

      const firstReceipt = await firstRunPromise;
      expect(firstReceipt).toMatchObject({
        stopReason: "total_operation_budget",
        confirmedDispatchCandidatesHandled: 1,
        confirmedDispatchProviderCalls: 1,
      });
      expect(firstReceipt.continuation).not.toBeNull();
      expect(provider.acceptedDispatches()).toHaveLength(1);
      await requestCancellation(fixture.lifecycleLayer, fixture.runId);

      const resumedHost = connectedLayer(
        controlTarget,
        authorityPorts(persistence, async () => deliveryTarget),
        provider,
        "a3000000-0000-4000-8000-000000000003",
        fullCyclePolicy(),
      );
      const resumed = await runConnected(
        resumedHost,
        firstReceipt.continuation,
      );
      expect(resumed).toMatchObject({
        stopReason: "cycle_exhausted",
        directoryPagesCharged: 0,
        scopeVisits: 1,
        confirmedCancellationCandidatesHandled: 1,
        confirmedCancellationProviderCalls: 1,
        continuation: null,
      });
      expect(provider.acceptedCancellations()).toHaveLength(1);

      const rows = await persistence.query<{
        dispatch_state: string;
        cancellation_state: string;
      }>(`
        select d.delivery_state as dispatch_state,
               c.delivery_state as cancellation_state
        from fx_system_durable_task_compute_dispatch_v1 d
        join fx_system_durable_task_compute_cancellation_v1 c
          on c.scope_id = d.scope_id
         and c.run_id = d.run_id
         and c.dispatch_requested_effect_sequence = d.requested_effect_sequence
        where d.scope_id = $1 and d.run_id = $2
      `, [fixture.scopeId, fixture.runId]);
      expect(rows.rows).toEqual([{
        dispatch_state: "accepted",
        cancellation_state: "delivered",
      }]);
    } finally {
      release.resolve();
      await Effect.runPromise(Fiber.interrupt(firstRunFiber));
    }
  });

  it("advances fairly across two real scopes and resumes the exact later scope", async () => {
    const controlPersistence = await createMigratedPGlitePersistence();
    const secondaryPersistence = await createMigratedPGlitePersistence();
    const primary = await createDeliveryFixture(
      controlPersistence,
      controlPersistence,
      PRIMARY_FIXTURE,
    );
    const secondary = await createDeliveryFixture(
      secondaryPersistence,
      controlPersistence,
      SECONDARY_FIXTURE,
    );
    await requestCancellation(primary.lifecycleLayer, primary.runId);
    await requestCancellation(secondary.lifecycleLayer, secondary.runId);

    const provider = Result.getOrThrow(
      makeInMemoryTaskComputeProviderV1(PROVIDER_DESCRIPTOR),
    );
    const controlTarget = Result.getOrThrow(
      createPGliteTaskComputeDeliveryControlDirectoryTarget(
        controlPersistence,
        DEADLINE_POLICY,
      ),
    );
    const deliveryTargets = new Map<
      string,
      LocatedTaskComputeDeliveryTargetV1
    >([
      [PRIMARY_FIXTURE.locator.databaseKey, primary.deliveryTarget],
      [SECONDARY_FIXTURE.locator.databaseKey, secondary.deliveryTarget],
    ]);
    const authority = authorityPorts(
      controlPersistence,
      async (locator) => {
        const target = deliveryTargets.get(locator.databaseKey);
        if (target === undefined) {
          throw new Error(`unexpected scope target: ${locator.databaseKey}`);
        }
        return target;
      },
    );
    const firstHost = connectedLayer(
      controlTarget,
      authority,
      provider,
      "a3000000-0000-4000-8000-000000000011",
      policy({ maximumTotalOperations: 2 }),
    );

    const first = await runConnected(firstHost, null);
    expect(first).toMatchObject({
      stopReason: "total_operation_budget",
      confirmedDispatchCandidatesHandled: 1,
      confirmedDispatchProviderCalls: 1,
      confirmedCancellationCandidatesHandled: 1,
      confirmedCancellationProviderCalls: 1,
    });
    expect(first.continuation).not.toBeNull();
    expect(provider.acceptedDispatches()).toHaveLength(1);
    expect(provider.acceptedCancellations()).toHaveLength(1);
    expect(await readDeliveryState(controlPersistence, primary)).toEqual({
      dispatch_state: "accepted",
      cancellation_state: "delivered",
    });
    expect(await readDeliveryState(secondaryPersistence, secondary)).toBeNull();

    const resumedHost = connectedLayer(
      controlTarget,
      authority,
      provider,
      "a3000000-0000-4000-8000-000000000012",
      fullCyclePolicy(),
    );
    const resumed = await runConnected(resumedHost, first.continuation);
    expect(resumed).toMatchObject({
      stopReason: "cycle_exhausted",
      directoryPagesCharged: 0,
      scopeVisits: 1,
      confirmedDispatchCandidatesHandled: 1,
      confirmedDispatchProviderCalls: 1,
      confirmedCancellationCandidatesHandled: 1,
      confirmedCancellationProviderCalls: 1,
      continuation: null,
    });
    expect(provider.acceptedDispatches()).toHaveLength(2);
    expect(provider.acceptedCancellations()).toHaveLength(2);

    await expectSettledDelivery(controlPersistence, primary);
    await expectSettledDelivery(secondaryPersistence, secondary);
  });

  it("charges unknown progress when persistence commits before the receipt is lost", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const fixture = await createDeliveryFixture(
      persistence,
      persistence,
      PRIMARY_FIXTURE,
    );
    const provider = Result.getOrThrow(
      makeInMemoryTaskComputeProviderV1(PROVIDER_DESCRIPTOR),
    );
    const controlTarget = Result.getOrThrow(
      createPGliteTaskComputeDeliveryControlDirectoryTarget(
        persistence,
        DEADLINE_POLICY,
      ),
    );
    const authority = authorityPorts(
      persistence,
      async () => fixture.deliveryTarget,
    );
    const layer = connectedLayerWithCandidateRunner(
      controlTarget,
      authority,
      missingReceiptCandidateRunnerLayer(provider),
      "a3000000-0000-4000-8000-000000000021",
      fullCyclePolicy(),
    );

    const receipt = await runConnected(layer, null);
    expect(receipt).toMatchObject({
      stopReason: "cycle_exhausted",
      candidateFailures: 1,
      dispatchPagesCharged: 1,
      dispatchCandidatesCharged: 1,
      dispatchProviderCallsCharged: 1,
      confirmedDispatchPagesRead: 1,
      confirmedDispatchCandidatesHandled: 0,
      confirmedDispatchProviderCalls: 0,
    });
    expect(provider.dispatchRequests()).toHaveLength(1);
    expect(provider.acceptedDispatches()).toHaveLength(1);
    const rows = await persistence.query<{
      delivery_state: string;
      claim_owner: string | null;
    }>(`
      select delivery_state, claim_owner
      from fx_system_durable_task_compute_dispatch_v1
      where scope_id = $1 and run_id = $2
    `, [fixture.scopeId, fixture.runId]);
    expect(rows.rows).toEqual([{
      delivery_state: "accepted",
      claim_owner: null,
    }]);
  });
});

async function createDeliveryFixture(
  scopePersistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  controlPersistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  identity: DeliveryFixtureIdentity,
) {
  if (identity !== PRIMARY_FIXTURE) {
    await seedTaskParentAuthorityFixture(scopePersistence, identity);
  }
  const seeded = await seedTaskSystemRunAttemptStoreV1(
    scopePersistence,
    identity === PRIMARY_FIXTURE
      ? undefined
      : { parent: identity },
  );
  await scopePersistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = $1
  `, [seeded.scopeId]);
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1();
  const creationAuthority = makeTaskSystemCreationAuthorityV1();
  await installTaskSystemCreationRuntimeBindingV1(
    scopePersistence.drizzle,
    runtimeBinding,
    creationAuthority,
  );
  const lifecycleTarget = createPGliteLocatedTaskSystemRunAttemptTargetV1(
    scopePersistence,
    identity.locator,
  );
  const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
    scopePersistence.drizzle,
    identity.locator,
  );
  await controlPersistence.insertDeploymentMetadata({
    deploymentId: identity.deploymentId,
    projectId: identity.projectId,
  });
  await controlPersistence.insertScopeMetadata({
    scopeId: identity.scopeId,
    deploymentId: identity.deploymentId,
    physicalLocator: identity.locator,
  });
  const located = await Effect.runPromise(
    resolveLocatedTrustedScopeAuthorityEffect(
      identity.deploymentId,
      authorityPorts(controlPersistence, async () => lifecycleTarget),
    ),
  );
  const creationStore = makeTaskSystemCreationStoreForTestV1({
    located,
    runtimeBinding,
    creationAuthority,
  }, {
    randomUuid: () => identity.runUuid,
  });
  const created = await Effect.runPromise(creationStore.createRun(
    makeTaskSystemCreationRequestV1("connected-delivery", 0x73),
  ));
  const lifecycleStore = makeTaskSystemRunAttemptStoreV1(located, {
    randomUuid: () => ACCEPTED_ATTEMPT_UUID,
  });
  const lifecycleLayer = RunAttemptLifecycleLive.pipe(
    Layer.provide(Layer.succeed(TaskSystemRunAttemptStore, lifecycleStore)),
  );
  const started = await Effect.runPromise(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.startAttempt({
      type: "start_attempt",
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: taskSystemCreationRetryJitterV1,
    });
  }).pipe(Effect.provide(lifecycleLayer)));
  if (
    started.outcome.kind !== "attempt_granted"
    || !started.requestedEffects.some(
      ({ effect }) => effect.kind === "dispatch_attempt",
    )
  ) {
    throw new Error("connected delivery fixture did not start an attempt");
  }
  return Object.freeze({
    scopeId: located.authority.scopeId,
    deploymentId: located.authority.deploymentId,
    runId: created.runId,
    lifecycleLayer,
    deliveryTarget,
  });
}

async function seedTaskParentAuthorityFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  parent: DeliveryFixtureIdentity,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_scope_clock
      (scope_id, storage_generation, epoch)
    values ($1, 'flarexdb_v1',
      'epoch_72000000-0000-4000-8000-000000000016')
  `, [parent.scopeId]);
  await persistence.query("set session_replication_role = replica");
  try {
    await persistence.query(`
      insert into fx_system_application_revision_v1 (
        scope_id, candidate_sha256, revision_id, deployment_id,
        attempt_sha256, registration_input_sha256,
        semantic_attempt_identity_sha256, source_codec_identity,
        package_sha256, artifact_runtime_identity, artifact_sha256,
        schema_version_id, schema_version, manifest_codec_version,
        manifest_byte_length, schema_artifact_sha256, schema_binding_sha256,
        function_metadata_codec_version, function_metadata_byte_length,
        function_metadata_sha256, function_metadata_bytes,
        validator_root_sha256, declared_handler_set_sha256,
        registration_root_sha256, registration_frame_count,
        registration_frames_byte_length, registration_frames_bytes,
        output_manifest_sha256, output_manifest_bytes, next_progress_sha256,
        next_progress_bytes, receipt_sha256, receipt_bytes, status
      ) values (
        $1, decode($2, 'hex'), $3, $4,
        decode(repeat('32', 32), 'hex'), decode(repeat('33', 32), 'hex'),
        decode(repeat('34', 32), 'hex'),
        'flarex.source-artifact-v2/codec-v1',
        decode(repeat('35', 32), 'hex'), 'dynamic-worker',
        decode(repeat('36', 32), 'hex'), 'schema_task_store_v1_secondary',
        1, 1, 1, decode(repeat('37', 32), 'hex'),
        decode(repeat('38', 32), 'hex'), 1, 1,
        decode(repeat('39', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3a', 32), 'hex'), decode(repeat('3b', 32), 'hex'),
        decode(repeat('3c', 32), 'hex'), 0, 0, decode('', 'hex'),
        decode(repeat('3d', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3e', 32), 'hex'), decode('01', 'hex'),
        decode(repeat('3f', 32), 'hex'), decode('01', 'hex'), 'inactive'
      )
    `, [
      parent.scopeId,
      parent.candidateSha256Hex,
      parent.applicationRevisionId,
      parent.deploymentId,
    ]);
  } finally {
    await persistence.query("set session_replication_role = origin");
  }
}

async function expectSettledDelivery(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  fixture: Awaited<ReturnType<typeof createDeliveryFixture>>,
): Promise<void> {
  expect(await readDeliveryState(persistence, fixture)).toEqual({
    dispatch_state: "accepted",
    cancellation_state: "delivered",
  });
}

async function readDeliveryState(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  fixture: Awaited<ReturnType<typeof createDeliveryFixture>>,
): Promise<Readonly<{
  readonly dispatch_state: string;
  readonly cancellation_state: string;
}> | null> {
  const rows = await persistence.query<{
    dispatch_state: string;
    cancellation_state: string;
  }>(`
    select d.delivery_state as dispatch_state,
           c.delivery_state as cancellation_state
    from fx_system_durable_task_compute_dispatch_v1 d
    join fx_system_durable_task_compute_cancellation_v1 c
      on c.scope_id = d.scope_id
     and c.run_id = d.run_id
     and c.dispatch_requested_effect_sequence = d.requested_effect_sequence
    where d.scope_id = $1 and d.run_id = $2
  `, [fixture.scopeId, fixture.runId]);
  if (rows.rows.length === 0) return null;
  if (rows.rows.length !== 1 || rows.rows[0] === undefined) {
    throw new Error("connected delivery fixture had multiple state rows");
  }
  return Object.freeze({ ...rows.rows[0] });
}

async function requestCancellation(
  lifecycleLayer: Awaited<
    ReturnType<typeof createDeliveryFixture>
  >["lifecycleLayer"],
  runId: Awaited<ReturnType<typeof createDeliveryFixture>>["runId"],
) {
  const result = await Effect.runPromise(Effect.gen(function* () {
    const lifecycle = yield* RunAttemptLifecycle;
    return yield* lifecycle.requestCancellation({
      type: "request_cancellation",
      runId,
      reason: { code: "requested", message: null },
    });
  }).pipe(Effect.provide(lifecycleLayer)));
  if (!result.requestedEffects.some(
    ({ effect }) => effect.kind === "request_execution_cancellation",
  )) {
    throw new Error("connected delivery cancellation was not requested");
  }
}

function connectedLayer(
  controlTarget: Parameters<
    typeof makeTaskComputeDeliveryTrustedDirectoryLayer
  >[0],
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskComputeDeliveryTargetV1
  >,
  provider: Parameters<typeof providerLayer>[0],
  claimOwner: string,
  policy: TaskComputeDeliveryConnectedRunnerOptions,
) {
  return connectedLayerWithCandidateRunner(
    controlTarget,
    authority,
    providerLayer(provider),
    claimOwner,
    policy,
  );
}

function connectedLayerWithCandidateRunner(
  controlTarget: Parameters<
    typeof makeTaskComputeDeliveryTrustedDirectoryLayer
  >[0],
  authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskComputeDeliveryTargetV1
  >,
  candidateRunnerLayer: Layer.Layer<TaskComputeDeliveryCandidateRunner>,
  claimOwner: string,
  policy: TaskComputeDeliveryConnectedRunnerOptions,
) {
  const directory = makeTaskComputeDeliveryTrustedDirectoryLayer(
    controlTarget,
    {
      authority,
      repository: {
        claimDurationMilliseconds: 30_000,
        retryDelayMilliseconds: [1_000, 2_000],
        maximumDeliveryAttempts: 3,
        randomUuid: () => claimOwner,
      },
      discoveryDeadline: DEADLINE_POLICY,
      resolutionTimeoutMilliseconds: 100,
    },
  );
  return makeTaskComputeDeliveryConnectedRunnerLayer(policy).pipe(
    Layer.provide(Layer.merge(directory, candidateRunnerLayer)),
  );
}

function authorityPorts<Target extends LocatedScopeClockReader>(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  resolveTarget: (physicalLocator: ScopePhysicalLocator) => Promise<Target>,
): TrustedScopeAuthorityResolutionPorts<Target> {
  return Object.freeze({
    scopeMetadata: Object.freeze({
      getScopeMetadataByDeploymentId: (deploymentId: string) =>
        persistence.getScopeMetadataByDeploymentId(deploymentId),
    }),
    provisioningReceipts: Object.freeze({
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("shared scope must not read split provisioning");
      },
    }),
    scopeClockTargets: Object.freeze({
      resolve: resolveTarget,
    }),
  });
}

function providerLayer(
  provider: TaskComputeProviderShape,
) {
  return TaskComputeDeliveryCandidateRunnerLive.pipe(
    Layer.provide(Layer.succeed(TaskComputeProvider, provider)),
  );
}

function missingReceiptCandidateRunnerLayer(
  provider: TaskComputeProviderShape,
): Layer.Layer<TaskComputeDeliveryCandidateRunner> {
  return Layer.effect(
    TaskComputeDeliveryCandidateRunner,
    Effect.gen(function* () {
      const live = yield* TaskComputeDeliveryCandidateRunner;
      const liveOwner = live;
      const runDispatch = live.runDispatch;
      const runCancellation = live.runCancellation;
      const wrappedRunDispatch:
        TaskComputeDeliveryCandidateRunnerShape["runDispatch"] =
          (repository, candidate) =>
            runDispatch.call(liveOwner, repository, candidate).pipe(
              Effect.andThen(Effect.never),
            );
      const wrappedRunCancellation:
        TaskComputeDeliveryCandidateRunnerShape["runCancellation"] =
          (repository, candidate) =>
            runCancellation.call(liveOwner, repository, candidate);
      const wrapped: TaskComputeDeliveryCandidateRunnerShape = Object.freeze({
        runDispatch: wrappedRunDispatch,
        runCancellation: wrappedRunCancellation,
      });
      return TaskComputeDeliveryCandidateRunner.of(wrapped);
    }),
  ).pipe(Layer.provide(providerLayer(provider)));
}

function oneCandidatePolicy(): TaskComputeDeliveryConnectedRunnerOptions {
  return policy({ maximumTotalOperations: 1 });
}

function fullCyclePolicy(): TaskComputeDeliveryConnectedRunnerOptions {
  return policy({ maximumTotalOperations: 4 });
}

function policy(
  overrides: Partial<TaskComputeDeliveryConnectedRunnerOptions>,
): TaskComputeDeliveryConnectedRunnerOptions {
  return Object.freeze({
    maximumDirectoryPages: 4,
    maximumScopeVisits: 4,
    maximumDispatchPages: 4,
    maximumCancellationPages: 4,
    maximumDispatchCandidates: 4,
    maximumCancellationCandidates: 4,
    maximumDispatchProviderCalls: 4,
    maximumCancellationProviderCalls: 4,
    maximumTotalOperations: 4,
    maximumDispatchPagesPerScope: 1,
    maximumCancellationPagesPerScope: 1,
    candidatesPerPage: 1,
    maximumRunMilliseconds: 10_000,
    maximumOperationMilliseconds: 3_000,
    settlementReserveMilliseconds: 2_000,
    ...overrides,
  });
}

function runConnected(
  layer: ReturnType<typeof connectedLayerWithCandidateRunner>,
  continuation: EncodedTaskComputeDeliveryConnectedContinuationV1 | null,
) {
  return Effect.runPromise(connected(layer, continuation));
}

function connected(
  layer: ReturnType<typeof connectedLayerWithCandidateRunner>,
  continuation: EncodedTaskComputeDeliveryConnectedContinuationV1 | null,
) {
  return Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    return yield* runner.run(continuation);
  }).pipe(Effect.provide(layer));
}

function latch<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return Object.freeze({ promise, resolve });
}

function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  message: string,
): Promise<Value> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}
