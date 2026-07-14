import {
  ReplacementScopeIdV1Schema,
  decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import {
  TransactionAttemptFenceSchema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import { beforeAll, describe, expect, expectTypeOf, it } from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
  type PointMutationSessionActivationResolutionPortsV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
} from "../src/transactionSessionActivation";
import {
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "attempt-load-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

type RootAttemptLoadExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptLoadPersistenceV1"
>;

interface AttemptLoadContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

interface AttemptRowState extends Record<string, unknown> {
  readonly lifecycle: string;
  readonly attempt_fence: string;
  readonly session_updated_at: string;
  readonly lease_attempt_fence: string;
  readonly snapshot_epoch_uuid: string;
  readonly snapshot_commit_seq: string;
  readonly lease_expires_at: string;
}

describe("O03-B2a exact point-mutation attempt load", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `72000000-0000-4000-8000-${suffix}`;
  }

  async function provisionContext(label: string): Promise<AttemptLoadContext> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_attempt_load_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: () => nextUuid(),
      },
    ).ensure({
      deploymentId,
      projectId: `project_attempt_load_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  async function activate(context: AttemptLoadContext) {
    return createPointMutationSessionActivationPersistenceV1(
      resolutionPorts(persistence),
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: () => nextUuid(),
      },
    ).activate(pointMutationSessionActivationFixture(
      context.deploymentId,
      context.scopeId,
    ));
  }

  it("keeps exact reload private, read-only, freshly resolved, and lock ordered", async () => {
    expectTypeOf<RootAttemptLoadExport>().toEqualTypeOf<never>();
    const context = await provisionContext("read_only");
    const activated = await activate(context);
    const selector = selectorFromAnchor(activated.anchor);
    const before = await rowState(persistence, context.scopeId);
    const lockSteps: string[] = [];
    let targetResolutions = 0;
    const ports = resolutionPorts(persistence, {
      afterLoadLock: (step) => {
        lockSteps.push(step);
      },
    }, () => {
      targetResolutions += 1;
    });
    const firstLoader = createPointMutationSessionAttemptLoadPersistenceV1(
      ports,
    );

    const first = await firstLoader.load(selector);
    const afterFirst = await rowState(persistence, context.scopeId);
    const restartedLoader = createPointMutationSessionAttemptLoadPersistenceV1(
      ports,
    );
    const second = await restartedLoader.load(Object.freeze({ ...selector }));

    expect(first).toEqual({ status: "loaded", anchor: activated.anchor });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.anchor)).toBe(true);
    expect(Object.isFrozen(first.anchor.snapshotToken)).toBe(true);
    expect(afterFirst).toEqual(before);
    expect(await rowState(persistence, context.scopeId)).toEqual(before);
    expect(targetResolutions).toBe(2);
    expect(lockSteps).toEqual([
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
      "clockLocked",
      "sessionLocked",
      "leaseLocked",
    ]);

    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 7 where scope_id = $1`,
      [context.scopeId],
    );
    const afterCommitAdvance = await restartedLoader.load(selector);
    expect(afterCommitAdvance.anchor.snapshotToken.commitSeq).toBe(0n);
  });

  it("rejects selector identity, lifecycle, expiry, and authority failures", async () => {
    const primary = await provisionContext("failures_primary");
    const other = await provisionContext("failures_other");
    const activated = await activate(primary);
    const selector = selectorFromAnchor(activated.anchor);
    const loader = createPointMutationSessionAttemptLoadPersistenceV1(
      resolutionPorts(persistence),
    );

    await expect(loader.load({
      ...selector,
      scopeId: other.scopeId,
    })).rejects.toMatchObject({
      issue: { reason: "selectorScopeMismatch" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    await expect(loader.load({
      ...selector,
      deploymentId: other.deploymentId,
    })).rejects.toMatchObject({
      issue: { reason: "selectorScopeMismatch" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    await expect(loader.load({
      ...selector,
      sessionId: TransactionSessionIdV1Schema.make(
        "72000000-0000-4000-8000-999999999999",
      ),
    })).rejects.toMatchObject({
      issue: { reason: "sessionMissing" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);
    await expect(loader.load({
      ...selector,
      attemptFence: TransactionAttemptFenceSchema.make(2n),
    })).rejects.toMatchObject({
      issue: { reason: "staleAttemptFence" },
    } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const terminal = await provisionContext("terminal");
    const terminalAnchor = (await activate(terminal)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [terminalAnchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'aborted' where session_id = $1`,
      [terminalAnchor.sessionId],
    );
    await expect(loader.load(selectorFromAnchor(terminalAnchor)))
      .rejects.toMatchObject({
        issue: { reason: "attemptNotRunning", lifecycle: "aborted" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const missingLease = await provisionContext("missing_lease");
    const missingLeaseAnchor = (await activate(missingLease)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [missingLeaseAnchor.sessionId],
    );
    await expect(loader.load(selectorFromAnchor(missingLeaseAnchor)))
      .rejects.toMatchObject({
        issue: "snapshotLeaseMissing",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const expired = await provisionContext("expired");
    const expiredAnchor = (await activate(expired)).anchor;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expiredAnchor.sessionId],
    );
    await expect(loader.load(selectorFromAnchor(expiredAnchor)))
      .rejects.toMatchObject({
        issue: { reason: "activeAttemptExpired" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const fenceDrift = await provisionContext("fence_drift");
    const fenceDriftAnchor = (await activate(fenceDrift)).anchor;
    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation_fence = 2
        where scope_id = $1
      `,
      [fenceDrift.scopeId],
    );
    await expect(loader.load(selectorFromAnchor(fenceDriftAnchor)))
      .rejects.toMatchObject({
        issue: { reason: "storageGenerationFenceChanged" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const revocationDrift = await provisionContext("revocation_drift");
    const revocationAnchor = (await activate(revocationDrift)).anchor;
    await persistence.query(
      `
        update fx_system_scope_clock
        set authorization_revocation_epoch = 1
        where scope_id = $1
      `,
      [revocationDrift.scopeId],
    );
    await expect(loader.load(selectorFromAnchor(revocationAnchor)))
      .rejects.toMatchObject({
        issue: { reason: "authorizationRevocationEpochChanged" },
      } satisfies Partial<PointMutationSessionAttemptLoadV1Error>);

    const snapshotAhead = await provisionContext("snapshot_ahead");
    const snapshotAheadAnchor = (await activate(snapshotAhead)).anchor;
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set snapshot_commit_seq = 1
        where session_id = $1
      `,
      [snapshotAheadAnchor.sessionId],
    );
    await expect(loader.load(selectorFromAnchor(snapshotAheadAnchor)))
      .rejects.toMatchObject({
        issue: "snapshotAheadOfScopeClock",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);
  });
});

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

function resolutionPorts(
  persistence: PGliteFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  afterResolve: () => void = () => undefined,
): PointMutationSessionActivationResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared attempt load must not read provisioning receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> => {
        afterResolve();
        return createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        );
      },
    },
  };
}

async function rowState(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
): Promise<AttemptRowState> {
  const result = await persistence.query<AttemptRowState>(
    `
      select s.lifecycle,
             s.attempt_fence::text as attempt_fence,
             s.updated_at::text as session_updated_at,
             l.attempt_fence::text as lease_attempt_fence,
             l.snapshot_epoch_uuid::text as snapshot_epoch_uuid,
             l.snapshot_commit_seq::text as snapshot_commit_seq,
             l.lease_expires_at::text as lease_expires_at
      from fx_system_tx_session s
      join fx_system_snapshot_lease l
        on l.scope_uuid = s.scope_uuid
       and l.session_id = s.session_id
      join fx_system_scope_clock c
        on c.scope_uuid = s.scope_uuid
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`Missing attempt row for ${scopeId}.`);
  return row;
}
