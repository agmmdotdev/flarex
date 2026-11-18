import {
  makeGrantRetentionPolicyV1Result,
  type GrantRetentionPolicyV1,
} from "flarex-protocol/grant-retention-policy";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { Result } from "effect";

import type { FlarexSqlClient } from "@flarex/persistence-postgres";

export const C07_TEST_GRANT_RETENTION_POLICY_V1: GrantRetentionPolicyV1 =
  Result.getOrThrow(makeGrantRetentionPolicyV1Result({
    maximumGrantLifetimeMilliseconds: 253_402_300_799_999,
    maximumFutureIssuedAtSkewMilliseconds: 0,
    maximumLiveSnapshotRetentionMilliseconds: Number.MAX_SAFE_INTEGER,
  }));

export async function setC07ActivationClockV1(
  persistence: Pick<FlarexSqlClient, "query">,
  scopeId: ReplacementScopeIdV1,
  input: {
    readonly storageGenerationFence?: bigint;
    readonly lastCommitSeq?: bigint;
    readonly authorizationRevocationEpoch?: bigint;
  } = {},
): Promise<void> {
  await persistence.query(
    `
      with authority as materialized (
        select scope_id from fx_system_scope_execution_authority where scope_id = $1 for update
      ), sequencer as (
        update fx_system_scope_clock c set last_commit_seq = $3, updated_at = clock_timestamp()
        from authority a where c.scope_id = a.scope_id returning c.scope_id
      )
      update fx_system_scope_execution_authority a
      set storage_generation = 'flarexdb_v1',
          storage_generation_fence = $2,
          authorization_revocation_epoch = $4,
          updated_at = clock_timestamp()
      from sequencer c where a.scope_id = c.scope_id
    `,
    [
      scopeId,
      input.storageGenerationFence ?? 1n,
      input.lastCommitSeq ?? 0n,
      input.authorizationRevocationEpoch ?? 0n,
    ],
  );
}
