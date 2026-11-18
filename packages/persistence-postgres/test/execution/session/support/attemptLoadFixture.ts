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
  PointMutationSessionAttemptSelectorV1,
} from "../../../../src/execution/session/contracts";

export const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "attempt-load-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;

export interface AttemptLoadContext {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ReplacementScopeIdV1Schema.make>;
}

export interface AttemptRowState extends Record<string, unknown> {
  readonly lifecycle: string;
  readonly attempt_fence: string;
  readonly session_updated_at: string;
  readonly lease_attempt_fence: string | null;
  readonly snapshot_epoch_uuid: string | null;
  readonly snapshot_commit_seq: string | null;
  readonly lease_expires_at: string | null;
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

export function resolutionPorts(
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

export async function rowState(
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
