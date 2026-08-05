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
      update fx_system_scope_clock
      set storage_generation = 'flarexdb_v1',
          storage_generation_fence = $2,
          last_commit_seq = $3,
          authorization_revocation_epoch = $4,
          updated_at = clock_timestamp()
      where scope_id = $1
    `,
    [
      scopeId,
      input.storageGenerationFence ?? 1n,
      input.lastCommitSeq ?? 0n,
      input.authorizationRevocationEpoch ?? 0n,
    ],
  );
}
