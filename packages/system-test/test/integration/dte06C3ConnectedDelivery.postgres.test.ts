import {
  TaskComputeCancellationUncertainError,
  TaskComputeDispatchUncertainError,
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
  resolveLocatedTrustedScopeAuthorityEffect,
  type LocatedScopeClockReader,
  type ScopePhysicalLocator,
  type TrustedScopeAuthorityResolutionPorts,
} from "@flarex/persistence-postgres";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  type LocatedTaskComputeDeliveryTargetV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  createPostgresTaskComputeDeliveryControlDirectoryResource,
} from "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
import {
  createPostgresLocatedTaskSystemRunAttemptTargetV1,
  createPostgresPersistence,
  makeTaskSystemRunAttemptStoreV1,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import {
  TaskComputeDeliveryCandidateRunnerLive,
  TaskComputeDeliveryConnectedRunner,
  makeTaskComputeDeliveryConnectedRunnerLayer,
  makeTaskComputeDeliveryTrustedDirectoryLayer,
  type EncodedTaskComputeDeliveryConnectedContinuationV1,
  type TaskComputeDeliveryConnectedRunnerOptions,
} from "flarex-backend/internal/task-compute-delivery";
import { Effect, Layer, Result } from "effect";
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
import {
  expectOrdinaryPostgres18,
  postgresUrl,
  withTemporaryPostgresSchema,
} from "../support/databaseFixturesV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 250,
  lockTimeoutMilliseconds: 150,
  statementTimeoutMilliseconds: 500,
  transactionTimeoutMilliseconds: 1_000,
  settlementReserveMilliseconds: 1_500,
});
const PROVIDER_DESCRIPTOR = Result.getOrThrow(
  decodeTaskComputeProviderDescriptorV1({
    provider: "memory",
    providerVersion: "connected-postgres-v1",
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
  projectId: "project_dte06_c3_connected_postgres_primary",
  runUuid: TASK_SYSTEM_CREATION_RUN_UUID_A,
});
const SECONDARY_FIXTURE = Object.freeze({
  scopeId: ScopeIdSchema.make(
    "scope_72000000-0000-4000-8000-000000000011",
  ),
  deploymentId: "deployment_task_store_v1_secondary",
  applicationRevisionId: "apprev_task_store_v1_secondary",
  candidateSha256Hex: "51".repeat(32),
  locator: Object.freeze({
    kind: "shared_database",
    databaseKey: "dte06-c3-postgres-secondary",
    schemaName: "public",
  } satisfies ScopePhysicalLocator),
  projectId: "project_dte06_c3_connected_postgres_secondary",
  runUuid: TASK_SYSTEM_CREATION_RUN_UUID_B,
});
type DeliveryFixtureIdentity = typeof PRIMARY_FIXTURE | typeof SECONDARY_FIXTURE;

describe("DTE06-C3 PostgreSQL connected delivery acceptance environment", () => {
  it("requires an authenticated ordinary-role PostgreSQL 18 URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-C3.",
    ).not.toBeNull();
  });
});

describePostgres("DTE06-C3 connected delivery - PostgreSQL", () => {
  it("advances fairly across two scopes and resumes the exact later scope", async () => {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const persistence = await createPostgresPersistence({
        migrationsSchema: databaseOptions.migrationsSchema,
        poolConfig: {
          ...databaseOptions.poolConfig,
          connectionString: databaseOptions.connectionString,
        },
      });
      try {
        await persistence.migrate();
        const controlResource = Result.getOrThrow(
          createPostgresTaskComputeDeliveryControlDirectoryResource({
            ...databaseOptions.poolConfig,
            connectionString: databaseOptions.connectionString,
            max: 1,
          }, DEADLINE_POLICY),
        );
        try {
          await expectOrdinaryPostgres18(persistence);
          const primary = await createDeliveryFixture(
            persistence,
            PRIMARY_FIXTURE,
          );
          const secondary = await createDeliveryFixture(
            persistence,
            SECONDARY_FIXTURE,
          );
          await requestCancellation(primary.lifecycleLayer, primary.runId);
          await requestCancellation(secondary.lifecycleLayer, secondary.runId);

          const provider = Result.getOrThrow(
            makeInMemoryTaskComputeProviderV1(PROVIDER_DESCRIPTOR),
          );
          const deliveryTargets = new Map<
            string,
            LocatedTaskComputeDeliveryTargetV1
          >([
            [PRIMARY_FIXTURE.locator.databaseKey, primary.deliveryTarget],
            [SECONDARY_FIXTURE.locator.databaseKey, secondary.deliveryTarget],
          ]);
          const authority = authorityPorts(
            persistence,
            async (locator) => {
              const target = deliveryTargets.get(locator.databaseKey);
              if (target === undefined) {
                throw new Error(`unexpected scope target: ${locator.databaseKey}`);
              }
              return target;
            },
          );
          const firstHost = connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000031",
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
          await expectSettledDelivery(persistence, primary);
          expect(await readDeliveryState(persistence, secondary)).toBeNull();

          const resumedHost = connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000032",
            policy({}),
          );
          const resumed = await runConnected(
            resumedHost,
            first.continuation,
          );
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
          await expectSettledDelivery(persistence, secondary);
        } finally {
          await controlResource.close();
        }
      } finally {
        await persistence.close();
      }
    });
  });

  it("replays exact dispatch and cancellation identities after post-start uncertainty", async () => {
    await withTemporaryPostgresSchema(async (databaseOptions) => {
      const persistence = await createPostgresPersistence({
        migrationsSchema: databaseOptions.migrationsSchema,
        poolConfig: {
          ...databaseOptions.poolConfig,
          connectionString: databaseOptions.connectionString,
        },
      });
      try {
        await persistence.migrate();
        const controlResource = Result.getOrThrow(
          createPostgresTaskComputeDeliveryControlDirectoryResource({
            ...databaseOptions.poolConfig,
            connectionString: databaseOptions.connectionString,
            max: 1,
          }, DEADLINE_POLICY),
        );
        try {
          await expectOrdinaryPostgres18(persistence);
          const fixture = await createDeliveryFixture(
            persistence,
            PRIMARY_FIXTURE,
          );
          const provider = Result.getOrThrow(makeInMemoryTaskComputeProviderV1(
            PROVIDER_DESCRIPTOR,
            {
              afterDispatchAccepted: (acceptance) => Effect.fail(
                new TaskComputeDispatchUncertainError({
                  operation: "dispatch",
                  identity: acceptance.identity,
                  cause: "dispatch_response_lost",
                }),
              ),
              afterCancellationAccepted: (receipt) => Effect.fail(
                new TaskComputeCancellationUncertainError({
                  operation: "request_cancellation",
                  identity: receipt.identity,
                  cause: "cancellation_response_lost",
                }),
              ),
            },
          ));
          const authority = authorityPorts(
            persistence,
            async () => fixture.deliveryTarget,
          );

          const uncertainDispatch = await runConnected(connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000041",
            policy({}),
          ), null);
          expect(uncertainDispatch).toMatchObject({
            stopReason: "cycle_exhausted",
            candidateFailures: 1,
            confirmedDispatchProviderCalls: 0,
          });
          await expireDeliveryClaim(
            persistence,
            "fx_system_durable_task_compute_dispatch_v1",
            fixture,
          );

          const recoveredDispatch = await runConnected(connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000042",
            policy({}),
          ), null);
          expect(recoveredDispatch).toMatchObject({
            stopReason: "cycle_exhausted",
            candidateFailures: 0,
            confirmedDispatchProviderCalls: 1,
          });
          expect(provider.dispatchRequests()).toHaveLength(2);
          expect(provider.dispatchRequests()[1]).toEqual(
            provider.dispatchRequests()[0],
          );
          expect(provider.acceptedDispatches()).toHaveLength(1);

          await requestCancellation(fixture.lifecycleLayer, fixture.runId);
          const uncertainCancellation = await runConnected(connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000043",
            policy({}),
          ), null);
          expect(uncertainCancellation).toMatchObject({
            stopReason: "cycle_exhausted",
            candidateFailures: 1,
            confirmedCancellationProviderCalls: 0,
          });
          await expireDeliveryClaim(
            persistence,
            "fx_system_durable_task_compute_cancellation_v1",
            fixture,
          );

          const recoveredCancellation = await runConnected(connectedLayer(
            controlResource.target,
            authority,
            provider,
            "a3000000-0000-4000-8000-000000000044",
            policy({}),
          ), null);
          expect(recoveredCancellation).toMatchObject({
            stopReason: "cycle_exhausted",
            candidateFailures: 0,
            confirmedCancellationProviderCalls: 1,
          });
          expect(provider.cancellationRequests()).toHaveLength(2);
          expect(provider.cancellationRequests()[1]).toEqual(
            provider.cancellationRequests()[0],
          );
          expect(provider.acceptedCancellations()).toHaveLength(1);

          const rows = await persistence.query<{
            dispatch_state: string;
            dispatch_attempts: string;
            cancellation_state: string;
            cancellation_attempts: string;
          }>(`
            select d.delivery_state as dispatch_state,
                   d.delivery_attempt_count::text as dispatch_attempts,
                   c.delivery_state as cancellation_state,
                   c.delivery_attempt_count::text as cancellation_attempts
            from fx_system_durable_task_compute_dispatch_v1 d
            join fx_system_durable_task_compute_cancellation_v1 c
              on c.scope_id = d.scope_id
             and c.run_id = d.run_id
             and c.dispatch_requested_effect_sequence = d.requested_effect_sequence
            where d.scope_id = $1 and d.run_id = $2
          `, [fixture.scopeId, fixture.runId]);
          expect(rows.rows).toEqual([{
            dispatch_state: "accepted",
            dispatch_attempts: "2",
            cancellation_state: "delivered",
            cancellation_attempts: "2",
          }]);
        } finally {
          await controlResource.close();
        }
      } finally {
        await persistence.close();
      }
    });
  });
});

async function createDeliveryFixture(
  persistence: PostgresFlarexPersistence,
  identity: DeliveryFixtureIdentity,
) {
  await persistence.insertDeploymentMetadata({
    deploymentId: identity.deploymentId,
    projectId: identity.projectId,
  });
  await seedTaskParentAuthorityFixture(persistence, identity);
  const seeded = await seedTaskSystemRunAttemptStoreV1(
    persistence,
    { parent: identity },
  );
  await persistence.query(`
    delete from fx_system_durable_task_run_v1
    where scope_id = $1
  `, [seeded.scopeId]);
  const candidateSha256 = Uint8Array.from(
    Buffer.from(identity.candidateSha256Hex, "hex"),
  );
  const runtimeBinding = await makeTaskSystemCreationRuntimeBindingV1({
    applicationRevisionId: identity.applicationRevisionId,
    candidateSha256,
  });
  const creationAuthority = makeTaskSystemCreationAuthorityV1({
    applicationRevisionId: identity.applicationRevisionId,
    candidateSha256,
  });
  await installTaskSystemCreationRuntimeBindingV1(
    persistence.drizzle,
    runtimeBinding,
    creationAuthority,
    identity.scopeId,
  );
  const lifecycleTarget = createPostgresLocatedTaskSystemRunAttemptTargetV1(
    persistence,
    identity.locator,
  );
  const deliveryTarget = createLocatedTaskComputeDeliveryTargetV1(
    persistence.drizzle,
    identity.locator,
  );
  await persistence.insertScopeMetadata({
    scopeId: identity.scopeId,
    deploymentId: identity.deploymentId,
    physicalLocator: identity.locator,
  });
  const located = await Effect.runPromise(
    resolveLocatedTrustedScopeAuthorityEffect(
      identity.deploymentId,
      authorityPorts(persistence, async () => lifecycleTarget),
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
    runId: created.runId,
    lifecycleLayer,
    deliveryTarget,
  });
}

async function seedTaskParentAuthorityFixture(
  persistence: PostgresFlarexPersistence,
  parent: DeliveryFixtureIdentity,
): Promise<void> {
  await persistence.query(`
    insert into fx_system_scope_clock
      (scope_id, storage_generation, epoch)
    values ($1, 'flarexdb_v1',
      'epoch_72000000-0000-4000-8000-000000000016')
  `, [parent.scopeId]);
}

async function requestCancellation(
  lifecycleLayer: Awaited<ReturnType<typeof createDeliveryFixture>>["lifecycleLayer"],
  runId: Awaited<ReturnType<typeof createDeliveryFixture>>["runId"],
): Promise<void> {
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
  provider: TaskComputeProviderShape,
  claimOwner: string,
  runnerPolicy: TaskComputeDeliveryConnectedRunnerOptions,
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
      definitionGenerationPolicy: "legacy_only",
      resolutionTimeoutMilliseconds: 100,
    },
  );
  const candidateRunner = TaskComputeDeliveryCandidateRunnerLive.pipe(
    Layer.provide(Layer.succeed(TaskComputeProvider, provider)),
  );
  return makeTaskComputeDeliveryConnectedRunnerLayer(runnerPolicy).pipe(
    Layer.provide(Layer.merge(directory, candidateRunner)),
  );
}

function authorityPorts<Target extends LocatedScopeClockReader>(
  persistence: PostgresFlarexPersistence,
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
    scopeClockTargets: Object.freeze({ resolve: resolveTarget }),
  });
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
  layer: ReturnType<typeof connectedLayer>,
  continuation: EncodedTaskComputeDeliveryConnectedContinuationV1 | null,
) {
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryConnectedRunner;
    return yield* runner.run(continuation);
  }).pipe(Effect.provide(layer)));
}

async function expectSettledDelivery(
  persistence: PostgresFlarexPersistence,
  fixture: Awaited<ReturnType<typeof createDeliveryFixture>>,
): Promise<void> {
  expect(await readDeliveryState(persistence, fixture)).toEqual({
    dispatch_state: "accepted",
    cancellation_state: "delivered",
  });
}

async function readDeliveryState(
  persistence: PostgresFlarexPersistence,
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

async function expireDeliveryClaim(
  persistence: PostgresFlarexPersistence,
  table:
    | "fx_system_durable_task_compute_dispatch_v1"
    | "fx_system_durable_task_compute_cancellation_v1",
  fixture: Awaited<ReturnType<typeof createDeliveryFixture>>,
): Promise<void> {
  await persistence.query(`
    update ${table}
    set claimed_at = date_trunc(
          'milliseconds',
          clock_timestamp() - interval '2 minutes'
        ),
        claim_expires_at = date_trunc(
          'milliseconds',
          clock_timestamp() - interval '1 minute'
        )
    where scope_id = $1 and run_id = $2
  `, [fixture.scopeId, fixture.runId]);
}
import { Buffer } from "node:buffer";
