import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";
import {
  CommitWakeClaimOwnerV1Schema,
  type CommitWakeClaimOwnerV1,
} from "../src/commitWakeOutbox";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  type CommitSeq,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

export const WAKE_SCOPE_A = ScopeUuidV1Schema.make(
  "87000000-0000-0000-0000-000000000001",
);
export const WAKE_SCOPE_B = ScopeUuidV1Schema.make(
  "88000000-0000-0000-0000-000000000001",
);
export const WAKE_EPOCH_A = ScopeEpochUuidV1Schema.make(
  "87000000-0000-0000-0000-000000000002",
);
export const WAKE_EPOCH_B = ScopeEpochUuidV1Schema.make(
  "87000000-0000-0000-0000-000000000003",
);
export const WAKE_EPOCH_C = ScopeEpochUuidV1Schema.make(
  "88000000-0000-0000-0000-000000000002",
);
export const WAKE_OWNER_A = CommitWakeClaimOwnerV1Schema.make(
  "87000000-0000-0000-0000-000000000010",
);
export const WAKE_OWNER_B = CommitWakeClaimOwnerV1Schema.make(
  "87000000-0000-0000-0000-000000000011",
);

export type WakeSqlPersistence = Pick<FlarexPersistence, "query">;

export interface InsertWakeScopeInput {
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly lastCommitSeq: bigint;
  readonly oldestAvailableCommitSeq?: bigint;
}

export async function insertWakeScope(
  persistence: WakeSqlPersistence & { readonly drizzle: FlarexMetadataDatabase },
  input: InsertWakeScopeInput,
): Promise<void> {
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId: `scope_${input.scopeUuid}`, epoch: `epoch_${input.epochUuid}`,
    lastCommitSeq: input.lastCommitSeq, oldestAvailableCommitSeq: input.oldestAvailableCommitSeq ?? 0n });
}

export async function insertWakeHeader(
  persistence: WakeSqlPersistence,
  scopeUuid: ScopeUuidV1,
  epochUuid: ScopeEpochUuidV1,
  commitSeq: bigint,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values ($1::uuid, $2::uuid, $3, 0)
    `,
    [scopeUuid, epochUuid, String(commitSeq)],
  );
}

export async function insertPendingWake(
  persistence: WakeSqlPersistence,
  input: Readonly<{
    scopeUuid: ScopeUuidV1;
    epochUuid: ScopeEpochUuidV1;
    commitSeq: bigint;
  }>,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit_wake
        (scope_uuid, epoch_uuid, commit_seq)
      values ($1::uuid, $2::uuid, $3)
    `,
    [
      input.scopeUuid,
      input.epochUuid,
      String(input.commitSeq),
    ],
  );
}

export function commitSeq(value: bigint): CommitSeq {
  return CommitSeqSchema.make(value);
}

export function claimOwner(value: string): CommitWakeClaimOwnerV1 {
  return CommitWakeClaimOwnerV1Schema.make(value);
}
