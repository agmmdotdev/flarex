import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import {
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";

import type { FlarexPersistence } from "../src";
import type { ResolveCommittedPointOutcomeInputV1 } from "../src/committedPointOutcome";

export const OUTCOME_SCOPE_A = "97000000-0000-0000-0000-000000000001";
export const OUTCOME_SCOPE_B = "97000000-0000-0000-0000-000000000002";
export const OUTCOME_EPOCH_A = "98000000-0000-0000-0000-000000000001";
export const OUTCOME_EPOCH_B = "98000000-0000-0000-0000-000000000002";
export const OUTCOME_IDENTITY_BYTE = 0x31;
export const OUTCOME_REQUEST_BYTE = 0x42;
export const OUTCOME_FUNCTION_PATH = "messages:create";

type SqlPersistence = Pick<FlarexPersistence, "query">;

export function outcomeLookup(
  requestKey: string,
  overrides: Partial<ResolveCommittedPointOutcomeInputV1> = {},
): ResolveCommittedPointOutcomeInputV1 {
  return Object.freeze({
    scopeUuid: decodeScopeUuidV1(OUTCOME_SCOPE_A),
    requestKey: TransactionRequestKeyV1Schema.make(requestKey),
    expectedIdentityAccessPolicySha256:
      TransactionIdentityAccessPolicySha256V1Schema.make(
        new Uint8Array(32).fill(OUTCOME_IDENTITY_BYTE),
      ),
    expectedFunctionPath:
      TransactionFunctionPathV1Schema.make(OUTCOME_FUNCTION_PATH),
    expectedRequestSha256: TransactionRequestSha256V1Schema.make(
      new Uint8Array(32).fill(OUTCOME_REQUEST_BYTE),
    ),
    ...overrides,
  });
}

export async function insertOutcomeScope(
  persistence: SqlPersistence,
  input: {
    readonly scopeUuid?: string;
    readonly epochUuid?: string;
    readonly lastCommitSeq?: bigint;
    readonly oldestAvailableCommitSeq?: bigint;
  } = {},
): Promise<void> {
  const scopeUuid = input.scopeUuid ?? OUTCOME_SCOPE_A;
  const epochUuid = input.epochUuid ?? OUTCOME_EPOCH_A;
  await persistence.query(
    `
      insert into fx_system_scope_clock
        (scope_id, storage_generation, last_commit_seq,
         oldest_available_commit_seq, epoch)
      values ($1, 'flarexdb_v1', $2, $3, $4)
    `,
    [
      `scope_${scopeUuid}`,
      (input.lastCommitSeq ?? 1n).toString(),
      (input.oldestAvailableCommitSeq ?? 0n).toString(),
      `epoch_${epochUuid}`,
    ],
  );
}

export async function insertOutcomeHeader(
  persistence: SqlPersistence,
  input: {
    readonly scopeUuid?: string;
    readonly epochUuid?: string;
    readonly commitSeq?: bigint;
  } = {},
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values ($1::uuid, $2::uuid, $3, 0)
    `,
    [
      input.scopeUuid ?? OUTCOME_SCOPE_A,
      input.epochUuid ?? OUTCOME_EPOCH_A,
      (input.commitSeq ?? 1n).toString(),
    ],
  );
}

export async function insertCanonicalAvailableOutcome(
  persistence: SqlPersistence,
  input: {
    readonly requestKey: string;
    readonly value?: unknown;
    readonly scopeUuid?: string;
    readonly epochUuid?: string;
    readonly commitSeq?: bigint;
    readonly identityByte?: number;
    readonly requestByte?: number;
    readonly functionPath?: string;
  },
): Promise<void> {
  const canonical = await canonicalizeFlarexValueV1(
    input.value ?? { ok: true, requestKey: input.requestKey },
  );
  await persistence.query(
    `
      insert into fx_system_idempotency
        (scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_value_codec_version, result_semantic_bytes,
         result_bytes, result_sha256)
      values ($1::uuid, $2, $3, $4, $5, $6::uuid, $7,
        'available', 1, $8, $9, $10)
    `,
    [
      input.scopeUuid ?? OUTCOME_SCOPE_A,
      input.requestKey,
      new Uint8Array(32).fill(
        input.identityByte ?? OUTCOME_IDENTITY_BYTE,
      ),
      input.functionPath ?? OUTCOME_FUNCTION_PATH,
      new Uint8Array(32).fill(input.requestByte ?? OUTCOME_REQUEST_BYTE),
      input.epochUuid ?? OUTCOME_EPOCH_A,
      (input.commitSeq ?? 1n).toString(),
      canonical.semanticSizeBytes,
      canonical.canonicalBytes,
      canonical.sha256,
    ],
  );
}

export async function insertCanonicalExpiredOutcome(
  persistence: SqlPersistence,
  input: {
    readonly requestKey: string;
    readonly scopeUuid?: string;
    readonly epochUuid?: string;
    readonly commitSeq?: bigint;
  },
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_idempotency
        (scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_expired_at)
      values ($1::uuid, $2, $3, $4, $5, $6::uuid, $7,
        'expired', now())
    `,
    [
      input.scopeUuid ?? OUTCOME_SCOPE_A,
      input.requestKey,
      new Uint8Array(32).fill(OUTCOME_IDENTITY_BYTE),
      OUTCOME_FUNCTION_PATH,
      new Uint8Array(32).fill(OUTCOME_REQUEST_BYTE),
      input.epochUuid ?? OUTCOME_EPOCH_A,
      (input.commitSeq ?? 1n).toString(),
    ],
  );
}
