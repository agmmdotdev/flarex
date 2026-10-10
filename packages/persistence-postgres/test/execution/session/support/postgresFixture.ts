import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { createPostgresLocatedPointMutationSessionActivationTargetV1, createPostgresSharedScopeAuthorityProvisioner, type PostgresFlarexPersistence } from "../../../../src/database/postgres";
import { createPostgresLocatedReadCommittedTransactionRunnerV1, type PostgresLocatedReadCommittedRunnerOptionsV1 } from "../../../../src/database/postgresLocatedReadCommitted";
import { type LocatedScopeClockReader } from "../../../../src/scope/scopeAuthorityResolution";
import { type SharedDatabaseScopePhysicalLocator } from "../../../../src/scope/scopeMetadataTypes";
import {
  createLocatedPointMutationSessionActivationTargetV1,
} from "../../../../src/execution/session/target";
import {
  createPointMutationExecutionClaimAcquisitionV1,
} from "../../../../src/execution/claims/acquisition";
import {
  createPointMutationSessionActivationPersistenceV1,
} from "../../../../src/execution/session/activation";
import {
  createPointMutationSessionAttemptLoadPersistenceV1,
} from "../../../../src/execution/session/attemptLoad";
import {
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
} from "../../../../src/execution/session/terminalization";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationSessionActivationResolutionPortsV1,
} from "../../../../src/execution/session/constructionContracts";
import type {
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptSelectorV1,
} from "../../../../src/execution/session/contracts";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
} from "../../../../src/database/locatedTransactionIdentity";
import { setFlarexActivationClock } from "./authorityClock";

export interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly physicalLocator: SharedDatabaseScopePhysicalLocator;
}

export async function provisionContext(
  persistence: PostgresFlarexPersistence,
  label: string,
  physicalLocator: SharedDatabaseScopePhysicalLocator,
  ids: () => string,
): Promise<ActivationContext> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_activation_postgres_${label}`,
  );
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator, randomUuid: ids },
  ).ensure({
    deploymentId,
    projectId: `project_activation_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  return { deploymentId, scopeId, physicalLocator };
}

export function createActivationPersistence(
  persistence: PostgresFlarexPersistence,
  ids: () => string,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionActivationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
    {
      leaseDurationMilliseconds: 60_000,
      randomUuid: ids,
    },
  );
}

export function createLoadPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptLoadPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

export function createTerminalizationPersistence(
  persistence: PostgresFlarexPersistence,
  targetOptions: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
) {
  return createPointMutationSessionAttemptTerminalizationPersistenceV1(
    resolutionPorts(persistence, targetOptions),
  );
}

export function createExecutionClaimAcquisition(
  persistence: PostgresFlarexPersistence,
  owner: string,
) {
  return createPointMutationExecutionClaimAcquisitionV1(
    resolutionPorts(persistence),
    {
      durationMilliseconds: 30_000,
      randomOwner: () => owner,
    },
  );
}

export function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

export async function finiteAttemptRowState(persistence: PostgresFlarexPersistence, scopeId: ActivationContext["scopeId"]) {
  const rows = await persistence.query(`select to_jsonb(s) as session from fx_system_tx_session s
    join fx_system_scope_clock c using(scope_uuid) where c.scope_id=$1`, [scopeId]);
  if (rows.rows.length !== 1 || rows.rows[0] === undefined) throw new Error("Missing finite anchor");
  return rows.rows[0];
}

export async function expireFiniteExecutionClaim(persistence: PostgresFlarexPersistence, sessionId: string) {
  await persistence.query(`update fx_system_tx_session set finite_claimed_at=clock_timestamp()-interval '2 minutes',
    finite_claim_expires_at=clock_timestamp()-interval '1 minute' where session_id=$1`, [sessionId]);
}

export async function finiteExecutionClaimRow(persistence: PostgresFlarexPersistence, sessionId: string) {
  const rows = await persistence.query(`select finite_claim_owner::text as claim_owner, finite_claim_fence::text as claim_fence
    from fx_system_tx_session where session_id=$1`, [sessionId]);
  if (rows.rows.length !== 1 || rows.rows[0] === undefined) throw new Error("Missing finite claim");
  return rows.rows[0];
}

export async function attemptRowState(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<Record<string, unknown>> {
  const result = await persistence.query<Record<string, unknown>>(
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
  if (row === undefined) throw new Error("Attempt reload row is missing.");
  return row;
}

export async function expireExecutionClaim(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<void> {
  await persistence.query(
    `update fx_system_tx_execution_claim
     set claimed_at = clock_timestamp() - interval '2 minutes',
         claim_expires_at = clock_timestamp() - interval '1 minute'
     where session_id = $1`,
    [sessionId],
  );
}

export async function executionClaimRow(
  persistence: PostgresFlarexPersistence,
  sessionId: string,
): Promise<Readonly<{ readonly claim_owner: string; readonly claim_fence: string }>> {
  const result = await persistence.query<{
    claim_owner: string;
    claim_fence: string;
  }>(
    `select claim_owner::text, claim_fence::text
     from fx_system_tx_execution_claim
     where session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one exact execution claim.");
  }
  return Object.freeze({ ...row });
}

export async function insertExpiredOutcome(
  persistence: PostgresFlarexPersistence,
  anchor: PointMutationSessionAnchorV1,
): Promise<void> {
  await persistence.query(
    `with clock as (
       update fx_system_scope_clock
       set last_commit_seq = 1
       where scope_id = $1
       returning scope_uuid, scope_id
     )
     insert into fx_system_commit (
       scope_uuid, epoch_uuid, commit_seq, change_count, committed_at
     )
     select c.scope_uuid, a.epoch_uuid, 1, 0, clock_timestamp() from clock c
       join fx_system_scope_execution_authority a on a.scope_id = c.scope_id`,
    [anchor.scopeId],
  );
  await persistence.query(
    `insert into fx_system_idempotency (
       scope_uuid, request_key, identity_access_policy_sha256,
       function_path, request_sha256, epoch_uuid, commit_seq,
       result_state, result_expired_at, created_at
     )
     select s.scope_uuid, s.request_key, s.identity_access_policy_sha256,
       s.function_path, s.request_sha256, a.epoch_uuid, 1,
       'expired', clock_timestamp(), clock_timestamp() - interval '1 second'
     from fx_system_tx_session s
     join fx_system_scope_clock c using (scope_uuid)
     join fx_system_scope_execution_authority a on a.scope_id = c.scope_id
     where s.session_id = $1`,
    [anchor.sessionId],
  );
}

export function resolutionPorts(
  persistence: PostgresFlarexPersistence,
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
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
          targetOptions,
        ),
    },
  };
}

export function resolutionPortsWithRunner(
  persistence: PostgresFlarexPersistence,
  runnerOptions: PostgresLocatedReadCommittedRunnerOptionsV1,
): PointMutationSessionActivationResolutionPortsV1 {
  const base = resolutionPorts(persistence);
  return {
    ...base,
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createLocatedPointMutationSessionActivationTargetV1(
          persistence.drizzle,
          physicalLocator,
          {
            [LOCATED_READ_COMMITTED_RUNNER_V1]:
              createPostgresLocatedReadCommittedTransactionRunnerV1(
                persistence.pool,
                runnerOptions,
              ),
          },
        ),
    },
  };
}

export async function rowCounts(
  persistence: PostgresFlarexPersistence,
  scopeId: ActivationContext["scopeId"],
): Promise<{
  readonly sessions: number;
  readonly leases: number;
  readonly journals: number;
  readonly executionClaims: number;
}> {
  const result = await persistence.query<{
    sessions: number;
    leases: number;
    journals: number;
    execution_claims: number;
  }>(
    `
      select
        (select count(*)::int from fx_system_tx_session
          where scope_uuid = c.scope_uuid) as sessions,
        (select count(*)::int from fx_system_snapshot_lease
          where scope_uuid = c.scope_uuid) as leases,
        (select count(*)::int from fx_system_tx_journal
          where scope_uuid = c.scope_uuid) as journals,
        (select count(*)::int from fx_system_tx_execution_claim
          where scope_uuid = c.scope_uuid) as execution_claims
      from fx_system_scope_clock c
      where c.scope_id = $1
    `,
    [scopeId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Activation scope clock is missing.");
  return Object.freeze({
    sessions: row.sessions,
    leases: row.leases,
    journals: row.journals,
    executionClaims: row.execution_claims,
  });
}

export function sharedLocator(databaseKey: string): SharedDatabaseScopePhysicalLocator {
  return Object.freeze({
    kind: "shared_database",
    databaseKey,
    schemaName: "public",
  });
}

export function uuidFactory(): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `52000000-0000-4000-8000-${suffix}`;
  };
}
