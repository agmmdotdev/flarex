import { eq } from "drizzle-orm";
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
  fxSystemSnapshotLeases,
  fxSystemTransactionSessions,
} from "../src/schema";
import {
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAttemptTerminalizationV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
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

type RootAttemptTerminalizationExport = Extract<
  keyof typeof import("../src"),
  "createPointMutationSessionAttemptTerminalizationPersistenceV1"
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
  readonly lease_attempt_fence: string | null;
  readonly snapshot_epoch_uuid: string | null;
  readonly snapshot_commit_seq: string | null;
  readonly lease_expires_at: string | null;
}

describe("O03-B exact point-mutation attempt authority", () => {
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

  function terminalizationPersistence(
    options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
  ) {
    return createPointMutationSessionAttemptTerminalizationPersistenceV1(
      resolutionPorts(persistence, options),
    );
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

  it("atomically aborts an exact attempt and observes its first terminal state", async () => {
    expectTypeOf<RootAttemptTerminalizationExport>().toEqualTypeOf<never>();
    const context = await provisionContext("terminal_abort");
    const anchor = (await activate(context)).anchor;
    const selector = selectorFromAnchor(anchor);
    const events: string[] = [];
    const terminalization = terminalizationPersistence({
      afterTerminalizationEvent: (event) => {
        events.push(`${event.phase}:${event.step}`);
      },
    });

    const aborted = await terminalization.abort({
      selector,
      expectedSnapshotToken: anchor.snapshotToken,
    });
    const firstTerminalizedAt = aborted.terminal.terminalizedAt;

    expect(aborted).toMatchObject({
      status: "terminalized",
      terminal: {
        ...selector,
        lifecycle: "aborted",
      },
    });
    expect(Object.isFrozen(aborted)).toBe(true);
    expect(Object.isFrozen(aborted.terminal)).toBe(true);
    expect(events).toEqual([
      "lock:clockLocked",
      "lock:sessionLocked",
      "lock:leaseLocked",
      "write:leaseDeleted",
      "write:sessionTerminalized",
    ]);
    const stored = await rowState(persistence, context.scopeId);
    expect(stored).toMatchObject({
      lifecycle: "aborted",
      attempt_fence: "1",
      lease_attempt_fence: null,
      snapshot_epoch_uuid: null,
      snapshot_commit_seq: null,
      lease_expires_at: null,
    });
    expect(Date.parse(stored.session_updated_at)).toBe(
      Date.parse(firstTerminalizedAt),
    );

    events.length = 0;
    const repeatedAbort = await terminalization.abort({
      selector,
      expectedSnapshotToken: anchor.snapshotToken,
    });
    const repeatedExpiry = await terminalization.expire(selector);
    expect(repeatedAbort).toEqual({
      status: "observed",
      terminal: aborted.terminal,
    });
    expect(repeatedExpiry).toEqual(repeatedAbort);
    expect(events).toEqual([
      "lock:clockLocked",
      "lock:sessionLocked",
      "lock:clockLocked",
      "lock:sessionLocked",
    ]);
    expect(await rowState(persistence, context.scopeId)).toEqual(stored);

    const finishing = await provisionContext("terminal_finishing");
    const finishingAnchor = (await activate(finishing)).anchor;
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'finishing' where session_id = $1`,
      [finishingAnchor.sessionId],
    );
    await expect(terminalization.abort({
      selector: selectorFromAnchor(finishingAnchor),
      expectedSnapshotToken: finishingAnchor.snapshotToken,
    })).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "aborted" },
    });

    const committed = await provisionContext("terminal_committed");
    const committedAnchor = (await activate(committed)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [committedAnchor.sessionId],
    );
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'committed' where session_id = $1`,
      [committedAnchor.sessionId],
    );
    await expect(
      terminalization.expire(selectorFromAnchor(committedAnchor)),
    ).resolves.toMatchObject({
      status: "observed",
      terminal: { lifecycle: "committed" },
    });
  });

  it("uses post-lock database time to distinguish live abort from expiry", async () => {
    const live = await provisionContext("terminal_live_expiry");
    const liveAnchor = (await activate(live)).anchor;
    const liveSelector = selectorFromAnchor(liveAnchor);
    const terminalization = terminalizationPersistence();
    const before = await rowState(persistence, live.scopeId);

    await expect(terminalization.expire(liveSelector)).rejects.toMatchObject({
      issue: { reason: "attemptStillLive" },
    });
    expect(await rowState(persistence, live.scopeId)).toEqual(before);

    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = '2000-01-01T00:00:00.000Z'
       where session_id = $1`,
      [liveAnchor.sessionId],
    );
    await expect(terminalization.expire(liveSelector)).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "expired" },
    });

    const lateAbort = await provisionContext("terminal_late_abort");
    const lateAbortAnchor = (await activate(lateAbort)).anchor;
    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = '2000-01-01T00:00:00.000Z'
       where session_id = $1`,
      [lateAbortAnchor.sessionId],
    );
    await expect(terminalization.abort({
      selector: selectorFromAnchor(lateAbortAnchor),
      expectedSnapshotToken: lateAbortAnchor.snapshotToken,
    })).resolves.toMatchObject({
      status: "terminalized",
      terminal: { lifecycle: "expired" },
    });
  });

  it("fails closed on invalid lifecycle, active-child, snapshot, fence, and authority state", async () => {
    const terminalization = terminalizationPersistence();

    const missingLease = await provisionContext("terminal_missing_lease");
    const missingLeaseAnchor = (await activate(missingLease)).anchor;
    await persistence.query(
      `delete from fx_system_snapshot_lease where session_id = $1`,
      [missingLeaseAnchor.sessionId],
    );
    await expect(terminalization.expire(selectorFromAnchor(missingLeaseAnchor)))
      .rejects.toMatchObject({
        issue: "snapshotLeaseMissing",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const terminalLease = await provisionContext("terminal_lease_present");
    const terminalLeaseAnchor = (await activate(terminalLease)).anchor;
    await persistence.query(
      `update fx_system_tx_session set lifecycle = 'aborted' where session_id = $1`,
      [terminalLeaseAnchor.sessionId],
    );
    await expect(terminalization.expire(selectorFromAnchor(terminalLeaseAnchor)))
      .rejects.toMatchObject({
        issue: "terminalSnapshotLeasePresent",
      } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    for (const lifecycle of ["created", "committing", "retrying"] as const) {
      const transitional = await provisionContext(
        `terminal_transitional_${lifecycle}`,
      );
      const transitionalAnchor = (await activate(transitional)).anchor;
      await persistence.query(
        `update fx_system_tx_session set lifecycle = $2 where session_id = $1`,
        [transitionalAnchor.sessionId, lifecycle],
      );
      await expect(
        terminalization.expire(selectorFromAnchor(transitionalAnchor)),
      ).rejects.toMatchObject({
        issue: { reason: "attemptNotTerminalizable", lifecycle },
      } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    }

    const changedSnapshot = await provisionContext("terminal_snapshot_changed");
    const changedSnapshotAnchor = (await activate(changedSnapshot)).anchor;
    await persistence.query(
      `update fx_system_snapshot_lease set snapshot_commit_seq = 1
       where session_id = $1`,
      [changedSnapshotAnchor.sessionId],
    );
    await setFlarexActivationClock(persistence, changedSnapshot.scopeId, {
      lastCommitSeq: 1n,
    });
    await expect(terminalization.abort({
      selector: selectorFromAnchor(changedSnapshotAnchor),
      expectedSnapshotToken: changedSnapshotAnchor.snapshotToken,
    })).rejects.toMatchObject({
      issue: "attemptSnapshotChanged",
    } satisfies Partial<PointMutationSessionAuthorityCorruptionV1Error>);

    const stale = await provisionContext("terminal_stale_fence");
    const staleAnchor = (await activate(stale)).anchor;
    const staleLeases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases)
      .where(eq(fxSystemSnapshotLeases.sessionId, staleAnchor.sessionId));
    const staleLease = staleLeases[0];
    if (staleLease === undefined) {
      throw new Error("Stale-fence fixture is missing its active lease.");
    }
    const newerFence = TransactionAttemptFenceSchema.make(2n);
    await persistence.drizzle.transaction(async (tx) => {
      await tx
        .delete(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, staleAnchor.sessionId));
      await tx
        .update(fxSystemTransactionSessions)
        .set({ attemptFence: newerFence })
        .where(eq(fxSystemTransactionSessions.sessionId, staleAnchor.sessionId));
      await tx.insert(fxSystemSnapshotLeases).values({
        ...staleLease,
        attemptFence: newerFence,
      });
    });
    await expect(
      terminalization.expire(selectorFromAnchor(staleAnchor)),
    ).rejects.toMatchObject({
      issue: { reason: "staleAttemptFence" },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(await rowState(persistence, stale.scopeId)).toMatchObject({
      attempt_fence: "2",
      lease_attempt_fence: "2",
    });

    const drift = await provisionContext("terminal_authority_drift");
    const driftAnchor = (await activate(drift)).anchor;
    await persistence.query(
      `update fx_system_scope_clock
       set authorization_revocation_epoch = authorization_revocation_epoch + 1
       where scope_id = $1`,
      [drift.scopeId],
    );
    await expect(terminalization.expire(selectorFromAnchor(driftAnchor)))
      .rejects.toMatchObject({
        issue: { reason: "authorizationRevocationEpochChanged" },
      } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect((await rowState(persistence, drift.scopeId)).lease_attempt_fence)
      .toBe("1");

    const generationDrift = await provisionContext(
      "terminal_generation_fence_drift",
    );
    const generationDriftAnchor = (await activate(generationDrift)).anchor;
    await persistence.query(
      `update fx_system_scope_clock
       set storage_generation_fence = storage_generation_fence + 1
       where scope_id = $1`,
      [generationDrift.scopeId],
    );
    await expect(
      terminalization.expire(selectorFromAnchor(generationDriftAnchor)),
    ).rejects.toMatchObject({
      issue: { reason: "storageGenerationFenceChanged" },
    } satisfies Partial<PointMutationSessionAttemptTerminalizationV1Error>);
    expect(
      (await rowState(persistence, generationDrift.scopeId)).lease_attempt_fence,
    ).toBe("1");
  });

  it("preserves the maximum signed-int64 fence through exact terminalization", async () => {
    const context = await provisionContext("terminal_max_fence");
    const anchor = (await activate(context)).anchor;
    const sessions = await persistence.drizzle
      .select()
      .from(fxSystemTransactionSessions)
      .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
    const leases = await persistence.drizzle
      .select()
      .from(fxSystemSnapshotLeases)
      .where(eq(fxSystemSnapshotLeases.sessionId, anchor.sessionId));
    const session = sessions[0];
    const lease = leases[0];
    if (session === undefined || lease === undefined) {
      throw new Error("Maximum-fence fixture is missing its active attempt.");
    }
    const maximumFence = TransactionAttemptFenceSchema.make(
      9_223_372_036_854_775_807n,
    );
    await persistence.drizzle.transaction(async (tx) => {
      await tx
        .delete(fxSystemSnapshotLeases)
        .where(eq(fxSystemSnapshotLeases.sessionId, anchor.sessionId));
      await tx
        .update(fxSystemTransactionSessions)
        .set({ attemptFence: maximumFence })
        .where(eq(fxSystemTransactionSessions.sessionId, anchor.sessionId));
      await tx.insert(fxSystemSnapshotLeases).values({
        ...lease,
        attemptFence: maximumFence,
      });
    });
    const selector = Object.freeze({
      ...selectorFromAnchor(anchor),
      attemptFence: maximumFence,
    });

    const result = await terminalizationPersistence().abort({
      selector,
      expectedSnapshotToken: anchor.snapshotToken,
    });

    expect(result.terminal.attemptFence).toBe(maximumFence);
    expect(result.terminal.lifecycle).toBe("aborted");
    expect(await rowState(persistence, context.scopeId)).toMatchObject({
      lifecycle: "aborted",
      attempt_fence: maximumFence.toString(),
      lease_attempt_fence: null,
    });
  });

  it("rolls back the exact lease and terminal anchor after either write", async () => {
    for (const failureStep of [
      "leaseDeleted",
      "sessionTerminalized",
    ] as const) {
      const context = await provisionContext(`terminal_rollback_${failureStep}`);
      const anchor = (await activate(context)).anchor;
      const before = await rowState(persistence, context.scopeId);
      const terminalization = terminalizationPersistence({
        afterTerminalizationEvent: (event) => {
          if (event.phase === "write" && event.step === failureStep) {
            throw new Error(`fail:${failureStep}`);
          }
        },
      });

      await expect(terminalization.abort({
        selector: selectorFromAnchor(anchor),
        expectedSnapshotToken: anchor.snapshotToken,
      })).rejects.toThrow(`fail:${failureStep}`);
      expect(await rowState(persistence, context.scopeId)).toEqual(before);
    }
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
      left join fx_system_snapshot_lease l
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
