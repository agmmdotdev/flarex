import { Result } from "effect";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  ReplacementScopeIdV1Schema,
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  type CommitSeq,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteLocatedRetainedHistoryFloorTarget,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  MAX_RETAINED_FLOOR_COMMIT_ROWS,
  createRetainedHistoryFloorObservationPort,
  createRetainedHistoryFloorPinFacet,
  observeRetainedHistoryFloorCandidateEffect,
} from "../src/retainedHistoryFloorObservation";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
} from
  "../src/scopeMetadataTypes";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../src/transactionSessionActivation";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "retained-floor-observation-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

const retentionPolicy = Result.getOrThrow(makeGrantRetentionPolicyV1Result({
  maximumGrantLifetimeMilliseconds: 1_000,
  maximumFutureIssuedAtSkewMilliseconds: 0,
  maximumLiveSnapshotRetentionMilliseconds: 10_000,
}));

describe("O11-B retained-history candidate observation", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `97000000-0000-4000-8000-${suffix}`;
  }

  async function provision(label: string) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_retained_floor_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      { physicalLocator: sharedLocator, randomUuid: () => nextUuid() },
    ).ensure({
      deploymentId,
      projectId: `project_retained_floor_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    return { deploymentId, scopeId };
  }

  function authorityPorts(targetCopy = false) {
    return {
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared scope must not read split receipts.");
        },
      },
      scopeClockTargets: {
        resolve: async (physicalLocator: ScopePhysicalLocator) => {
          const target = createPGliteLocatedRetainedHistoryFloorTarget(
            persistence,
            physicalLocator,
          );
          return targetCopy ? { ...target } : target;
        },
      },
    };
  }

  function observationPort(
    pin = createRetainedHistoryFloorPinFacet("test", { kind: "absent" }),
    targetCopy = false,
  ) {
    return createRetainedHistoryFloorObservationPort({
      authority: authorityPorts(targetCopy),
      grantRetentionPolicy: retentionPolicy,
      pinFacets: [pin],
    });
  }

  async function seedCommits(
    scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
  ): Promise<void> {
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, values.commit_seq, 0,
              clock_timestamp() - values.age
       from fx_system_scope_clock,
            (values
              (1::bigint, interval '30 seconds'),
              (2::bigint, interval '20 seconds'),
              (3::bigint, interval '1 second')
            ) as values(commit_seq, age)
       where scope_id = $1`,
      [scopeId],
    );
    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 3 where scope_id = $1`,
      [scopeId],
    );
  }

  it("takes the minimum of the time window and an authenticated pin", async () => {
    const context = await provision("minimum");
    await seedCommits(context.scopeId);
    await persistence.query(
      `update fx_system_commit
       set epoch_uuid = '97000000-0000-4000-8000-888888888888'
       where scope_uuid = (
         select scope_uuid from fx_system_scope_clock where scope_id = $1
       ) and commit_seq = 2`,
      [context.scopeId],
    );
    const mutablePin: {
      kind: "pinned";
      minimumCommitSeq: CommitSeq;
    } = {
      kind: "pinned",
      minimumCommitSeq: CommitSeqSchema.make(1n),
    };
    const pin = createRetainedHistoryFloorPinFacet("test", mutablePin);
    mutablePin.minimumCommitSeq = CommitSeqSchema.make(3n);

    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(pin),
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "advanceable",
      currentFloor: 0n,
      lastCommitSeq: 3n,
      candidateFloor: 1n,
      leaseCeiling: 3n,
      timeWindowCeiling: 2n,
      additionalPinCeiling: 1n,
      holdReasons: [],
    });
  });

  it("keeps a live lease pinned and releases it after database-time expiry", async () => {
    const context = await provision("lease");
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, 1, 0, clock_timestamp() - interval '30 seconds'
       from fx_system_scope_clock where scope_id = $1`,
      [context.scopeId],
    );
    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1`,
      [context.scopeId],
    );
    const activation = createPointMutationSessionActivationPersistenceV1({
      scopeMetadata: persistence,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared scope must not read split receipts.");
        },
      },
      scopeSessionTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            persistence,
            physicalLocator,
          ),
      },
    }, {
      leaseDurationMilliseconds: 60_000,
      randomUuid: () => nextUuid(),
    });
    const activated = await activatePointMutationSession(
      activation,
      pointMutationSessionActivationFixture(
        context.deploymentId,
        context.scopeId,
      ),
    );
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, values.commit_seq, 0,
              clock_timestamp() - values.age
       from fx_system_scope_clock,
            (values
              (2::bigint, interval '20 seconds'),
              (3::bigint, interval '1 second')
            ) as values(commit_seq, age)
       where scope_id = $1`,
      [context.scopeId],
    );
    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 3 where scope_id = $1`,
      [context.scopeId],
    );

    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(),
      context.deploymentId,
    ))).resolves.toMatchObject({
      candidateFloor: 1n,
      leaseCeiling: 1n,
      timeWindowCeiling: 2n,
    });

    await persistence.query(
      `update fx_system_snapshot_lease
       set snapshot_epoch_uuid = '97000000-0000-4000-8000-999999999999'
       where session_id = $1`,
      [activated.anchor.sessionId],
    );
    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(),
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "held",
      candidateFloor: 0n,
      holdReasons: ["liveLeaseAuthorityUnavailable"],
    });

    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = '2000-01-01T00:00:00.000Z',
           snapshot_epoch_uuid = '97000000-0000-4000-8000-999999999999',
           snapshot_commit_seq = 999
       where session_id = $1`,
      [activated.anchor.sessionId],
    );
    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(),
      context.deploymentId,
    ))).resolves.toMatchObject({
      candidateFloor: 2n,
      leaseCeiling: 3n,
      timeWindowCeiling: 2n,
    });
  });

  it("holds for unavailable pins and rejects copied ports or targets", async () => {
    const context = await provision("composition");
    await seedCommits(context.scopeId);
    const unavailable = createRetainedHistoryFloorPinFacet("reconnect", {
      kind: "unavailable",
    });
    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(unavailable),
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "held",
      candidateFloor: 0n,
      holdReasons: ["requiredPinUnavailable"],
    });

    const port = observationPort();
    await expect(runEffectFailure(observeRetainedHistoryFloorCandidateEffect(
      { ...port },
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidPort" });
    await expect(runEffectFailure(observeRetainedHistoryFloorCandidateEffect(
      observationPort(undefined, true),
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidTarget" });
    const missingPinPort = createRetainedHistoryFloorObservationPort({
      authority: authorityPorts(),
      grantRetentionPolicy: retentionPolicy,
      pinFacets: [],
    });
    await expect(runEffectFailure(observeRetainedHistoryFloorCandidateEffect(
      missingPinPort,
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidPort" });
    const authenticPin = createRetainedHistoryFloorPinFacet("test", {
      kind: "absent",
    });
    const copiedPinPort = createRetainedHistoryFloorObservationPort({
      authority: authorityPorts(),
      grantRetentionPolicy: retentionPolicy,
      pinFacets: [{ ...authenticPin }],
    });
    await expect(runEffectFailure(observeRetainedHistoryFloorCandidateEffect(
      copiedPinPort,
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "invalidPort" });
  });

  it("holds instead of scanning beyond the bounded commit directory", async () => {
    const context = await provision("commit_limit");
    const count = MAX_RETAINED_FLOOR_COMMIT_ROWS + 1;
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, series.commit_seq, 0,
              clock_timestamp() - interval '1 second'
       from fx_system_scope_clock,
            generate_series(1, $2::bigint) as series(commit_seq)
       where scope_id = $1`,
      [context.scopeId, count],
    );
    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = $2 where scope_id = $1`,
      [context.scopeId, count],
    );

    await expect(runEffect(observeRetainedHistoryFloorCandidateEffect(
      observationPort(),
      context.deploymentId,
    ))).resolves.toMatchObject({
      disposition: "held",
      candidateFloor: 0n,
      holdReasons: ["commitDirectoryLimit"],
    });
  });

  it("rejects a commit timestamp later than authoritative database time", async () => {
    const context = await provision("future_commit");
    await persistence.query(
      `insert into fx_system_commit
         (scope_uuid, epoch_uuid, commit_seq, change_count, committed_at)
       select scope_uuid, epoch_uuid, 1, 0,
              clock_timestamp() + interval '1 minute'
       from fx_system_scope_clock where scope_id = $1`,
      [context.scopeId],
    );
    await persistence.query(
      `update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1`,
      [context.scopeId],
    );

    await expect(runEffectFailure(observeRetainedHistoryFloorCandidateEffect(
      observationPort(),
      context.deploymentId,
    ))).resolves.toMatchObject({ reason: "storedEvidenceInvalid" });
  });
});
