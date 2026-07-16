import {
  ReplacementScopeIdV1Schema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { Json, JsonObject } from "flarex-protocol/json";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionPackageIdV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemSnapshotLeases,
  fxSystemTransactionSessions,
} from "../src/schema";
import {
  PointMutationSessionActivationConfigurationV1Error,
  PointMutationSessionActivationV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  createPointMutationSessionActivationPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "activation-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const POSTGRES_SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n;

type RootActivationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionActivationPersistenceV1"
>;

interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

describe("O03-B1 point-mutation session activation", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `42000000-0000-4000-8000-${suffix}`;
  }

  async function provisionContext(label: string): Promise<ActivationContext> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_activation_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_activation_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return {
      deploymentId,
      scopeId,
    };
  }

  function activationPersistence(
    options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence, options),
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => nextUuid(),
      },
    );
  }

  it("keeps activation off the broad persistence facade", () => {
    expectTypeOf<RootActivationExport>().toEqualTypeOf<never>();
  });

  it("atomically creates one running anchor and exactly replays it unchanged", async () => {
    const context = await provisionContext("create_replay");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const activation = activationPersistence();

    const created = await activation.activate(input);

    expect(created.status).toBe("created");
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.anchor)).toBe(true);
    expect(Object.isFrozen(created.anchor.snapshotToken)).toBe(true);
    expect(created.anchor).toMatchObject({
      deploymentId: context.deploymentId,
      scopeId: context.scopeId,
      requestKey: input.evidence.requestKey,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 1n,
      attemptFence: 1n,
      snapshotToken: {
        scopeId: context.scopeId,
        commitSeq: 0n,
      },
      hardExpiresAt: input.evidence.authorizationGrantExpiresAt.toISOString(),
    });
    expect(created.anchor.createdAt).toBe(created.anchor.updatedAt);
    expect(
      Date.parse(created.anchor.leaseExpiresAt) -
        Date.parse(created.anchor.createdAt),
    ).toBe(60_000);

    const persisted = await persistence.query<{
      sessions: number;
      leases: number;
      timestamps_equal: boolean;
      hard_expiry_matches: boolean;
      lease_duration_matches: boolean;
      lifecycle: string;
      attempt_fence: string;
      snapshot_commit_seq: string;
    }>(
      `
        select
          (select count(*)::int from fx_system_tx_session
            where scope_uuid = c.scope_uuid) as sessions,
          (select count(*)::int from fx_system_snapshot_lease
            where scope_uuid = c.scope_uuid) as leases,
          s.created_at = s.updated_at as timestamps_equal,
          s.hard_expires_at = s.authorization_grant_expires_at
            as hard_expiry_matches,
          l.lease_expires_at = s.created_at + interval '60 seconds'
            as lease_duration_matches,
          s.lifecycle,
          s.attempt_fence::text,
          l.snapshot_commit_seq::text
        from fx_system_scope_clock c
        join fx_system_tx_session s using (scope_uuid)
        join fx_system_snapshot_lease l using (scope_uuid, session_id)
        where c.scope_id = $1
      `,
      [context.scopeId],
    );
    expect(persisted.rows).toEqual([
      {
        sessions: 1,
        leases: 1,
        timestamps_equal: true,
        hard_expiry_matches: true,
        lease_duration_matches: true,
        lifecycle: "running",
        attempt_fence: "1",
        snapshot_commit_seq: "0",
      },
    ]);

    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 7 where scope_id = $1`,
      [context.scopeId],
    );
    const replayed = await activation.activate(input);

    expect(replayed.status).toBe("replayed");
    expect(replayed.anchor).toEqual(created.anchor);
    await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
      sessions: 1,
      leases: 1,
    });
  });

  it("preserves __proto__ as validated argument data across persistence and replay", async () => {
    const context = await provisionContext("proto_argument");
    const validatedArgsJson = jsonObjectWithProtoData();
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { validatedArgsJson } },
    );
    const activation = activationPersistence();

    const created = await activation.activate(input);
    const persisted = await persistence.query<{
      validated_args_json: JsonObject;
    }>(
      `
        select s.validated_args_json
        from fx_system_tx_session s
        join fx_system_scope_clock c using (scope_uuid)
        where c.scope_id = $1
      `,
      [context.scopeId],
    );
    const persistedArgs = persisted.rows[0]?.validated_args_json;
    if (persistedArgs === undefined) {
      throw new Error("Activated session persisted no validated arguments.");
    }

    expect(Object.hasOwn(validatedArgsJson, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(validatedArgsJson)).toBe(Object.prototype);
    expect(Object.hasOwn(persistedArgs, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(persistedArgs)).toBe(Object.prototype);
    expect(persistedArgs["__proto__"]).toEqual({ polluted: true });

    const replayed = await activation.activate(input);
    expect(replayed.status).toBe("replayed");
    expect(replayed.anchor).toEqual(created.anchor);
  });

  it("replays negative-zero JSON after JSONB normalizes it to zero", async () => {
    const context = await provisionContext("negative_zero_argument");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { validatedArgsJson: { value: -0 } } },
    );
    const activation = activationPersistence();

    const created = await activation.activate(input);
    const persisted = await persistence.query<{
      validated_args_json: JsonObject;
    }>(
      `
        select s.validated_args_json
        from fx_system_tx_session s
        join fx_system_scope_clock c using (scope_uuid)
        where c.scope_id = $1
      `,
      [context.scopeId],
    );

    expect(Object.is(persisted.rows[0]?.validated_args_json.value, 0)).toBe(
      true,
    );
    const replayed = await activation.activate(input);
    expect(replayed.status).toBe("replayed");
    expect(replayed.anchor).toEqual(created.anchor);
  });

  it("caps the initial lease at the verified grant hard expiry", async () => {
    const context = await provisionContext("expiry_cap");
    const databaseTime = await persistence.query<{ now: string }>(
      "select clock_timestamp()::text as now",
    );
    const nowText = databaseTime.rows[0]?.now;
    const nowMilliseconds =
      typeof nowText === "string" ? Date.parse(nowText) : Number.NaN;
    if (!Number.isFinite(nowMilliseconds)) {
      throw new Error("PGlite returned no clock.");
    }
    const grantExpiry = new Date(nowMilliseconds + 300_000);
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      { evidence: { authorizationGrantExpiresAt: grantExpiry } },
    );
    const activation = createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence),
      {
        leaseDurationMilliseconds: 3_600_000,
        randomUuid: () => nextUuid(),
      },
    );

    const result = await activation.activate(input);

    expect(result.anchor.hardExpiresAt).toBe(grantExpiry.toISOString());
    expect(result.anchor.leaseExpiresAt).toBe(grantExpiry.toISOString());
    expect(Date.parse(result.anchor.leaseExpiresAt)).toBeGreaterThan(
      Date.parse(result.anchor.createdAt),
    );
  });

  it("fails closed on changed evidence, terminal reopen, and invalid lease state", async () => {
    const changedContext = await provisionContext("changed_evidence");
    const changedActivation = activationPersistence();
    const changedInput = pointMutationSessionActivationFixture(
      changedContext.deploymentId,
      changedContext.scopeId,
    );
    await changedActivation.activate(changedInput);
    const conflictingInput = pointMutationSessionActivationFixture(
      changedContext.deploymentId,
      changedContext.scopeId,
      {
        evidence: {
          packageId: TransactionPackageIdV1Schema.make(
            "package_activation_conflict",
          ),
        },
      },
    );
    await expect(changedActivation.activate(conflictingInput)).rejects.toMatchObject({
      issue: { reason: "requestKeyConflict" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const terminalContext = await provisionContext("terminal");
    const terminalActivation = activationPersistence();
    const terminalInput = pointMutationSessionActivationFixture(
      terminalContext.deploymentId,
      terminalContext.scopeId,
    );
    await terminalActivation.activate(terminalInput);
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = 'aborted'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [terminalContext.scopeId],
    );
    await expect(terminalActivation.activate(terminalInput)).rejects.toMatchObject({
      issue: { reason: "terminalRequest", lifecycle: "aborted" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const missingLeaseContext = await provisionContext("missing_lease");
    const missingLeaseActivation = activationPersistence();
    const missingLeaseInput = pointMutationSessionActivationFixture(
      missingLeaseContext.deploymentId,
      missingLeaseContext.scopeId,
    );
    await missingLeaseActivation.activate(missingLeaseInput);
    await persistence.query(
      `
        delete from fx_system_snapshot_lease
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [missingLeaseContext.scopeId],
    );
    await expect(
      missingLeaseActivation.activate(missingLeaseInput),
    ).rejects.toMatchObject({
      issue: "snapshotLeaseMissing",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const expiredLeaseContext = await provisionContext("expired_lease");
    const expiredLeaseActivation = activationPersistence();
    const expiredLeaseInput = pointMutationSessionActivationFixture(
      expiredLeaseContext.deploymentId,
      expiredLeaseContext.scopeId,
    );
    await expiredLeaseActivation.activate(expiredLeaseInput);
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [expiredLeaseContext.scopeId],
    );
    await expect(
      expiredLeaseActivation.activate(expiredLeaseInput),
    ).rejects.toMatchObject({
      issue: { reason: "activeAttemptExpired" },
    } satisfies Partial<PointMutationSessionActivationV1Error>);

    const mismatchedLeaseContext = await provisionContext("mismatched_lease");
    const mismatchedLeaseActivation = activationPersistence();
    const mismatchedLeaseInput = pointMutationSessionActivationFixture(
      mismatchedLeaseContext.deploymentId,
      mismatchedLeaseContext.scopeId,
    );
    await mismatchedLeaseActivation.activate(mismatchedLeaseInput);
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2099-01-02T00:00:00.000Z'
        where scope_uuid = (
          select scope_uuid from fx_system_scope_clock where scope_id = $1
        )
      `,
      [mismatchedLeaseContext.scopeId],
    );
    await expect(
      mismatchedLeaseActivation.activate(mismatchedLeaseInput),
    ).rejects.toMatchObject({
      issue: "snapshotLeaseInvalid",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });

  it("classifies multiple request anchors as authority corruption", async () => {
    const context = await provisionContext("duplicate");
    const activation = activationPersistence();
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );
    const created = await activation.activate(input);
    const sessions = await persistence.drizzle
      .select()
      .from(fxSystemTransactionSessions);
    const leases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases);
    const session = sessions.find(
      (row) => row.sessionId === created.anchor.sessionId,
    );
    const lease = leases.find((row) => row.sessionId === session?.sessionId);
    if (session === undefined || lease === undefined) {
      throw new Error("Expected the original activation rows.");
    }
    const duplicateSessionId = TransactionSessionIdV1Schema.make(nextUuid());
    await persistence.drizzle.insert(fxSystemTransactionSessions).values({
      ...session,
      sessionId: duplicateSessionId,
    });
    await persistence.drizzle.insert(fxSystemSnapshotLeases).values({
      ...lease,
      sessionId: duplicateSessionId,
    });

    await expect(activation.activate(input)).rejects.toMatchObject({
      issue: "duplicateRequestAnchors",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });

  it("rolls back both rows after each mutating statement", async () => {
    const context = await provisionContext("rollback");
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    );

    for (const failureStep of ["sessionInserted", "leaseInserted"] as const) {
      const activation = activationPersistence({
        afterWrite: (step) => {
          if (step === failureStep) throw new Error(`fail:${step}`);
        },
      });

      await expect(activation.activate(input)).rejects.toThrow(
        `fail:${failureStep}`,
      );
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 0,
        leases: 0,
      });
    }
  });

  it("rejects invalid generated identity before any authority or SQL read", async () => {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      "deployment_activation_invalid_uuid",
    );
    const scopeId = ReplacementScopeIdV1Schema.make(
      "scope_42000000-0000-4000-8000-000000009999",
    );
    let authorityReads = 0;
    const ports = {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          authorityReads += 1;
          return null;
        },
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          authorityReads += 1;
          return null;
        },
      },
      scopeSessionTargets: {
        resolve: async () => {
          authorityReads += 1;
          throw new Error("Target resolution must not run.");
        },
      },
    } satisfies PointMutationSessionActivationResolutionPortsV1;
    const activation = createPointMutationSessionActivationPersistenceV1(
      ports,
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => "not-a-uuid",
      },
    );

    await expect(
      activation.activate(
        pointMutationSessionActivationFixture(deploymentId, scopeId),
      ),
    ).rejects.toMatchObject({
      issue: { reason: "invalidGeneratedSessionId", value: "not-a-uuid" },
    } satisfies Partial<PointMutationSessionActivationConfigurationV1Error>);
    expect(authorityReads).toBe(0);
  });

  it("fails closed when located authority changes after the preliminary read", async () => {
    const races = [
      {
        label: "generation",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set storage_generation = 'legacy_v1' where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "generation_fence",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set storage_generation_fence = storage_generation_fence + 1
             where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "epoch",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock set epoch = $2 where scope_id = $1`,
            [scopeId, `epoch_${nextUuid()}`],
          ),
      },
      {
        label: "revocation",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set authorization_revocation_epoch = authorization_revocation_epoch + 1
             where scope_id = $1`,
            [scopeId],
          ),
      },
      {
        label: "snapshot",
        mutate: (scopeId: ActivationContext["scopeId"]) =>
          persistence.query(
            `update fx_system_scope_clock
             set last_commit_seq = last_commit_seq + 1 where scope_id = $1`,
            [scopeId],
          ),
      },
    ] as const;

    for (const race of races) {
      const context = await provisionContext(`race_${race.label}`);
      const baseTarget =
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          sharedLocator,
        );
      const ports = {
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async () => ({
            ...baseTarget,
            getCurrentClock: async (scopeId: typeof context.scopeId) => {
              const preliminary = await baseTarget.getCurrentClock(scopeId);
              await race.mutate(scopeId);
              return preliminary;
            },
          }),
        },
      } satisfies PointMutationSessionActivationResolutionPortsV1;
      const activation = createPointMutationSessionActivationPersistenceV1(
        ports,
        {
          leaseDurationMilliseconds: 60_000,
          randomUuid: () => nextUuid(),
        },
      );

      await expect(
        activation.activate(
          pointMutationSessionActivationFixture(
            context.deploymentId,
            context.scopeId,
          ),
        ),
      ).rejects.toBeInstanceOf(PointMutationSessionActivationV1Error);
      await expect(rowCounts(persistence, context.scopeId)).resolves.toEqual({
        sessions: 0,
        leases: 0,
      });
    }
  });

  it("preserves maximum signed-bigint authority without number coercion", async () => {
    const context = await provisionContext("bigint");
    await setFlarexActivationClock(persistence, context.scopeId, {
      storageGenerationFence: POSTGRES_SIGNED_BIGINT_MAX,
      lastCommitSeq: POSTGRES_SIGNED_BIGINT_MAX,
      authorizationRevocationEpoch: POSTGRES_SIGNED_BIGINT_MAX,
    });
    const input = pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
      {
        evidence: {
          authorizationRevocationEpoch:
            TransactionAuthorizationRevocationEpochSchema.make(
              POSTGRES_SIGNED_BIGINT_MAX,
            ),
        },
      },
    );

    const result = await activationPersistence().activate(input);

    expect(result.anchor.storageGenerationFence).toBe(
      POSTGRES_SIGNED_BIGINT_MAX,
    );
    expect(result.anchor.snapshotToken.commitSeq).toBe(
      POSTGRES_SIGNED_BIGINT_MAX,
    );
  });
});

function jsonObjectWithProtoData(): JsonObject {
  const value: Record<string, Json> = { body: "hello" };
  Object.defineProperty(value, "__proto__", {
    configurable: false,
    enumerable: true,
    value: Object.freeze({ polluted: true } satisfies JsonObject),
    writable: false,
  });
  return Object.freeze(value);
}

function resolutionPorts(
  persistence: PGliteFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared activation must not read provisioning receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

async function rowCounts(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
): Promise<{ readonly sessions: number; readonly leases: number }> {
  const result = await persistence.query<{
    sessions: number;
    leases: number;
  }>(
    `
      select
        (select count(*)::int from fx_system_tx_session
          where scope_uuid = c.scope_uuid) as sessions,
        (select count(*)::int from fx_system_snapshot_lease
          where scope_uuid = c.scope_uuid) as leases
      from fx_system_scope_clock c
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Activation scope clock is missing.");
  return row;
}
