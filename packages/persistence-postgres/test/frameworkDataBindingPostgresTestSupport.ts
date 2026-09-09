import { setTimeout as delay } from "node:timers/promises";
import { Deferred, Effect, Result } from "effect";
import { eq, sql } from "drizzle-orm";
import {
  ScopeIdSchema,
  ScopeEpochSchema,
} from "flarex-protocol/storage-authority";
import { insertInitialScopeClockInTransactionResult } from "../src/scopeClockInitialization";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { expect } from "vitest";
import type { PoolClient } from "pg";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { ApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";
import { composeApplicationNativeMutationReadiness } from "./fixtures/applicationNativeMutationTestFixture";
import { getScopeAuthorityProvisioningReceipt } from "../src/scopeAuthorityProvisioningReceipt";
import type { TrustedScopeAuthorityResolutionPorts } from "../src/scopeAuthorityResolution";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import { createLocatedPointMutationSessionActivationTargetV1 } from "../src/transactionSessionActivation";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "../src/postgresLocatedReadCommitted";
import { makeApplicationActivationRepository } from "../src/applicationActivation";
import { makePostgresFrameworkMigrationTargetEffect } from "../src/migrationCoordination/postgresTarget";
import {
  makeDataBindingHost,
  dataBindingActivationRequest,
} from "../src/frameworkSchema/binding/host";
import { makeDataBindingTestProfiles } from "../src/frameworkSchema/binding/profiles";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import type { DataBindingSetFrame } from "../src/frameworkSchema/binding/model";
import { fxSystemScopeClocks } from "../src/schema";
import {
  changeBindingAvailability,
  type exercisePhysicalBindings,
} from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** Actual owner factories over already persisted data; no fixture bootstrap or copied issuer state. */
export async function reopenBindingHost(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
  frame: DataBindingSetFrame,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1 = {},
  afterAcceptance?: () => Effect.Effect<void>,
) {
  const authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1> =
    {
      scopeMetadata: control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: (scopeId) =>
          getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
      },
      scopeClockTargets: {
        resolve: async (locator) => {
          const located = createLocatedPointMutationSessionActivationTargetV1(
            target.drizzle,
            locator,
            {
              [LOCATED_READ_COMMITTED_RUNNER_V1]:
                createPostgresLocatedReadCommittedTransactionRunnerV1(
                  target.pool,
                  runnerOptions,
                ),
            },
          );
          if (!isLocatedReadCommittedAttemptTargetV1(located))
            throw new Error("Missing located binding runner");
          return located;
        },
      },
    };
  const { readiness } = composeApplicationNativeMutationReadiness(
    {
      runtimeHostIdentity: "flarex.test/binding-host",
      compatibilityDate: "2026-09-05",
    },
    control,
    authority,
    {
      scopeMetadata: control,
      provisioningReceipts: authority.provisioningReceipts,
      scopeSessionTargets: authority.scopeClockTargets,
      applicationControlDb: control.drizzle,
    },
  );
  const application = makeApplicationActivationRepository({
    deploymentId: frame.application.deploymentId,
    readiness,
    authority,
  });
  const migrationTarget = await runEffect(
    makePostgresFrameworkMigrationTargetEffect({
      persistence: target,
      deploymentId: frame.application.deploymentId,
      canonicalPhysicalDatabaseIdentity: "native-binding-fixture",
      physicalLocator: frame.application.physicalLocator,
    }),
  );
  const profiles = await runEffect(
    makeDataBindingTestProfiles(
      target.drizzle,
      migrationTarget,
      commerceBindings(frame).flatMap(binding => binding.profiles),
    ),
  );
  return runEffect(
    makeDataBindingHost({
      database: target.drizzle,
      deploymentId: frame.application.deploymentId,
      target: migrationTarget,
      authority,
      application,
      testOnly: {
        profiles,
        ...(afterAcceptance === undefined ? {} : { afterAcceptance }),
      },
    }),
  );
}

/** Decorates the actual acquired pg client, forwarding real COMMIT before losing its acknowledgement. */
export function loseBindingCommitResponse(
  client: PoolClient,
  armed: () => boolean,
  lose: () => never,
): void {
  const original = client.query;
  if (
    !Reflect.set(client, "query", (...args: readonly unknown[]): unknown => {
      const statement = args[0];
      const text =
        typeof statement === "string"
          ? statement
          : typeof statement === "object" &&
              statement !== null &&
              "text" in statement &&
              typeof statement.text === "string"
            ? statement.text
            : "";
      const result: unknown = Reflect.apply(original, client, args);
      return text.trim().toLowerCase() === "commit" && armed()
        ? Promise.resolve(result).then(lose)
        : result;
    })
  )
    throw new Error("Could not install binding COMMIT acknowledgement fault");
}

async function waitForBlockedStatement(
  target: PostgresFlarexPersistence,
  table: string,
): Promise<void> {
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    // Intentional PostgreSQL lock introspection: a native barrier, not fixture DML.
    const rows = await target.query<{ blocked: boolean }>(
      `select exists(select 1 from pg_stat_activity
      where application_name = current_setting('application_name') and pid <> pg_backend_pid()
        and wait_event_type = 'Lock' and cardinality(pg_blocking_pids(pid)) > 0 and query ilike $1) as blocked`,
      [`%${table}%`],
    );
    if (rows.rows[0]?.blocked === true) return;
    await delay(20);
  }
  throw new Error(`No observed binding waiter for ${table}`);
}

type PhysicalScenario = Awaited<
  ReturnType<typeof exercisePhysicalBindings<PostgresFlarexPersistence>>
>;

export async function exerciseBindingNativeRaces(
  fixture: ApplicationNativeMutationPostgresFixture,
  physical: PhysicalScenario,
) {
  const { host, input, frame } = physical;
  const originalQueries = new WeakMap<PoolClient, PoolClient["query"]>();
  let statementCount = 0;
  const measured = await reopenBindingHost(
    fixture.control,
    fixture.target,
    frame,
    {
      afterAcquire: (client) => {
        const original = client.query;
        originalQueries.set(client, original);
        if (
          !Reflect.set(
            client,
            "query",
            (...args: readonly unknown[]): unknown => {
              statementCount += 1;
              return Reflect.apply(original, client, args);
            },
          )
        )
          throw new Error("Could not observe binding statements");
      },
      release: (client, discardError) => {
        const original = originalQueries.get(client);
        if (original === undefined || !Reflect.set(client, "query", original))
          throw new Error("Binding query observer was not restored");
        originalQueries.delete(client);
        client.release(discardError);
      },
    },
  );
  const startedAt = performance.now();
  const measuredCurrent = await runEffect(
    measured.withCurrent(readAdmittedDataBinding),
  );
  const baselineStatements = statementCount;
  const baselineMilliseconds = performance.now() - startedAt;
  await runEffect(
    host.activate({
      ...physical.request,
      requestId: "history-cost-extension",
      expectedHead: measuredCurrent.head,
    }),
  );
  statementCount = 0;
  await runEffect(measured.withCurrent(readAdmittedDataBinding));
  expect(baselineStatements).toBeGreaterThan(0);
  expect(statementCount).toBe(baselineStatements);
  console.info(
    `Binding admission: ${baselineStatements} target SQL statements, ${Math.round(baselineMilliseconds)} ms; unchanged statement count after history growth.`,
  );
  const current = await runEffect(host.withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(host.prepare(frame));
  const request = dataBindingActivationRequest(
    frame.application.scopeId,
    frame.application.storageGeneration,
    "competing-replacement-a",
    candidate.sha256,
    current.head,
  );
  const outcomes = await Promise.all(
    [request, { ...request, requestId: "competing-replacement-b" }].map(
      (value) => runEffect(host.activate(value).pipe(Effect.result)),
    ),
  );
  expect(outcomes.filter(Result.isSuccess)).toHaveLength(1);
  expect(outcomes.find(Result.isFailure)).toMatchObject({
    _tag: "Failure",
    failure: { reason: "concurrentHead" },
  });

  let armed = false;
  const uncertain = await reopenBindingHost(
    fixture.control,
    fixture.target,
    frame,
    {
      afterAcquire: (client) =>
        loseBindingCommitResponse(
          client,
          () => armed,
          () => {
            armed = false;
            throw new Error("Binding COMMIT response lost");
          },
        ),
    },
    () =>
      Effect.sync(() => {
        armed = true;
      }),
  );
  const beforeLoss = await runEffect(host.withCurrent(readAdmittedDataBinding));
  const lossRequest = {
    ...request,
    requestId: "lost-commit",
    expectedHead: beforeLoss.head,
  };
  expect(await runEffectFailure(uncertain.activate(lossRequest))).toMatchObject(
    { reason: "decisionUncertain" },
  );
  const recovered = await runEffect(host.recover(lossRequest));
  expect(Result.getOrThrow(recovered.current).selected).toBe(true);
  expect((await runEffect(host.recover(lossRequest))).receipt).toEqual(
    recovered.receipt,
  );

  const scopeId = fixture.authority.scopeId;
  const [clock] = await fixture.target.drizzle
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  if (clock === undefined) throw new Error("Binding scope clock missing");
  await fixture.target.drizzle
    .update(fxSystemScopeClocks)
    .set({
      authorizationRevocationEpoch: sql`${fxSystemScopeClocks.authorizationRevocationEpoch} + 1`,
    })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "staleApplication" });
  await fixture.target.drizzle
    .update(fxSystemScopeClocks)
    .set({ authorizationRevocationEpoch: clock.authorizationRevocationEpoch })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));

  const hold = async () => {
    const entered = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    const pending = runEffect(
      host.withCurrent((selection) =>
        Effect.gen(function* () {
          yield* readAdmittedDataBinding(selection);
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(release);
        }),
      ),
    );
    await runEffect(Deferred.await(entered));
    return {
      pending,
      release: () => runEffect(Deferred.succeed(release, undefined)),
    };
  };
  const heldFence = await hold();
  try {
    const independentScope = ScopeIdSchema.make(
      "scope_34000000-0000-4000-8000-000000009999",
    );
    await fixture.target.drizzle.transaction(async (tx) => {
      // Native session policy and an owned clock operation prove admission holds no database-global lock.
      await tx.execute(sql`set local lock_timeout = '2s'`);
      Result.getOrThrow(
        await insertInitialScopeClockInTransactionResult(tx, {
          scopeId: independentScope,
          initialEpoch: ScopeEpochSchema.make(
            "epoch_34000000-0000-4000-8000-000000009999",
          ),
        }),
      );
      expect(
        (
          await runEffect(
            lockScopeClockForUpdateInTransactionEffect(tx, independentScope),
          )
        ).scopeId,
      ).toBe(independentScope);
    });
  } catch (cause) {
    await heldFence.release();
    await heldFence.pending;
    throw cause;
  }
  const fence = fixture.target.drizzle
    .update(fxSystemScopeClocks)
    .set({
      storageGenerationFence: sql`${fxSystemScopeClocks.storageGenerationFence} + 1`,
    })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .execute();
  try {
    await waitForBlockedStatement(fixture.target, "fx_system_scope_clock");
  } finally {
    await heldFence.release();
    await heldFence.pending;
  }
  await fence;
  expect(
    await runEffect(
      host.withCurrent(readAdmittedDataBinding).pipe(Effect.result),
    ),
  ).toMatchObject({ _tag: "Failure" });
  await fixture.target.drizzle
    .update(fxSystemScopeClocks)
    .set({ storageGenerationFence: clock.storageGenerationFence })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));

  const heldApplication = await hold();
  const moving = fixture.moveHead();
  try {
    await waitForBlockedStatement(fixture.target, "fx_system_scope_clock");
  } finally {
    await heldApplication.release();
    await heldApplication.pending;
  }
  await moving;
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "staleApplication" });
  const nextFrame = {
    ...frame,
    application: await runEffect(host.readApplicationReference()),
  };
  const nextCandidate = await runEffect(host.prepare(nextFrame));
  const rebound = await runEffect(
    host.activate({
      ...request,
      requestId: "race-application-rebind",
      candidateSha256: nextCandidate.sha256,
      expectedHead: Result.getOrThrow(recovered.current).head,
    }),
  );
  expect(Result.getOrThrow(rebound.current).selected).toBe(true);

  const heldAvailability = await hold();
  const withdrawing = changeBindingAvailability(
    fixture,
    physical.availability,
    "withdrawn",
  );
  try {
    await waitForBlockedStatement(
      fixture.target,
      "fx_system_framework_schema_availability_head",
    );
  } finally {
    await heldAvailability.release();
    await heldAvailability.pending;
  }
  const withdrawn = await withdrawing;
  expect(
    await runEffectFailure(host.withCurrent(readAdmittedDataBinding)),
  ).toMatchObject({ reason: "unavailableInstallation" });
  const restored = await changeBindingAvailability(fixture, withdrawn, "ready");
  return {
    input,
    host,
    frame: nextFrame,
    restored,
    head: Result.getOrThrow(rebound.current).head,
  };
}
import { commerceBindings } from "../src/frameworkSchema/binding/model";
