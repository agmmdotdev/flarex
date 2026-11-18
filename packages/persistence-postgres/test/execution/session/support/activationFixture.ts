import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from "flarex-protocol/transaction-grant";
import { createPGliteLocatedPointMutationSessionActivationTargetV1, type PGliteFlarexPersistence } from "../../../../src/database/pglite";
import { type LocatedScopeClockReader } from "../../../../src/scope/scopeAuthorityResolution";
import { type SharedDatabaseScopePhysicalLocator } from "../../../../src/scope/scopeMetadataTypes";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
  PointMutationSessionActivationResolutionPortsV1,
} from "../../../../src/execution/session/constructionContracts";
import type {
  PointMutationSessionAnchorV1,
} from "../../../../src/execution/session/contracts";

export const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "activation-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

export interface ActivationContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

export function selectorFromAnchor(anchor: PointMutationSessionAnchorV1) {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

export function resolutionPorts(
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

export async function attemptLivenessState(
  persistence: PGliteFlarexPersistence,
  sessionId: string,
): Promise<Readonly<{
  readonly lease_expires_at: Date;
  readonly claim_owner: string;
  readonly claim_fence: string;
  readonly claimed_at: Date;
  readonly claim_expires_at: Date;
}>> {
  const result = await persistence.query<{
    lease_expires_at: Date;
    claim_owner: string;
    claim_fence: string;
    claimed_at: Date;
    claim_expires_at: Date;
  }>(
    `select l.lease_expires_at,
            c.claim_owner,
            c.claim_fence::text,
            c.claimed_at,
            c.claim_expires_at
     from fx_system_snapshot_lease l
     join fx_system_tx_execution_claim c
       on c.scope_uuid = l.scope_uuid
      and c.session_id = l.session_id
      and c.attempt_fence = l.attempt_fence
     where l.session_id = $1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error("Expected one exact liveness row.");
  }
  return Object.freeze({ ...row });
}

export async function rowCounts(
  persistence: PGliteFlarexPersistence,
  scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>,
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

export function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}
