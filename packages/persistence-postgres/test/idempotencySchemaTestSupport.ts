import { readFile, writeFile } from "node:fs/promises";

import type { FlarexPersistence } from "../src";

export const S09_SCOPE_A = "85000000-0000-0000-0000-000000000001";
export const S09_EPOCH_A = "85000000-0000-0000-0000-000000000002";
export const S09_EPOCH_B = "85000000-0000-0000-0000-000000000003";
export const S09_SCOPE_B = "86000000-0000-0000-0000-000000000001";
export const S09_EPOCH_C = "86000000-0000-0000-0000-000000000002";
export const POSTGRES_SIGNED_BIGINT_MAX = "9223372036854775807";
export const MAX_RESULT_SEMANTIC_BYTES = 16_777_216;
export const MAX_RESULT_CANONICAL_BYTES = 67_108_864;

export type SqlPersistence = Pick<FlarexPersistence, "query">;

export interface AvailableOutcomeFixture {
  readonly scopeUuid: string;
  readonly requestKey: string;
  readonly epochUuid: string;
  readonly commitSeq: string;
  readonly functionPath?: string;
  readonly identityHashByte?: string;
  readonly requestHashByte?: string;
  readonly resultHashByte?: string;
  readonly resultSemanticBytes?: number;
  readonly resultByteLength?: number;
}

export async function writeJournalThrough0029(
  currentJournal: string,
  targetJournal: string,
): Promise<void> {
  const parsed = JSON.parse(await readFile(currentJournal, "utf8")) as {
    entries?: Array<{ idx?: number }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  parsed.entries = parsed.entries.filter(
    (entry) => typeof entry.idx === "number" && entry.idx < 30,
  );
  await writeFile(targetJournal, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function writeJournalThrough0030(
  currentJournal: string,
  targetJournal: string,
): Promise<void> {
  const parsed = JSON.parse(await readFile(currentJournal, "utf8")) as {
    entries?: Array<{ idx?: number }>;
  };
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Current Drizzle journal is missing its entries array.");
  }
  parsed.entries = parsed.entries.filter(
    (entry) => typeof entry.idx === "number" && entry.idx <= 30,
  );
  await writeFile(targetJournal, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function insertS09Scope(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  lastCommitSeq: string,
  oldestAvailableCommitSeq = "0",
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock
        (scope_id, storage_generation, last_commit_seq,
         oldest_available_commit_seq, epoch)
      values ($1, 'flarexdb_v1', $2, $3, $4)
    `,
    [
      `scope_${scopeUuid}`,
      lastCommitSeq,
      oldestAvailableCommitSeq,
      `epoch_${epochUuid}`,
    ],
  );
}

export async function insertS09Header(
  persistence: SqlPersistence,
  scopeUuid: string,
  epochUuid: string,
  commitSeq: string,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_commit
        (scope_uuid, epoch_uuid, commit_seq, change_count)
      values ($1::uuid, $2::uuid, $3, 0)
    `,
    [scopeUuid, epochUuid, commitSeq],
  );
}

export async function insertAvailableOutcome(
  persistence: SqlPersistence,
  input: AvailableOutcomeFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_idempotency
        (scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_value_codec_version, result_semantic_bytes,
         result_bytes, result_sha256)
      values
        ($1::uuid, $2, decode(repeat($3, 32), 'hex'),
         $4, decode(repeat($5, 32), 'hex'), $6::uuid, $7,
         'available', 1, $8, convert_to(repeat('x', $9), 'UTF8'),
         decode(repeat($10, 32), 'hex'))
    `,
    [
      input.scopeUuid,
      input.requestKey,
      input.identityHashByte ?? "11",
      input.functionPath ?? "messages:create",
      input.requestHashByte ?? "22",
      input.epochUuid,
      input.commitSeq,
      input.resultSemanticBytes ?? 1,
      input.resultByteLength ?? 1,
      input.resultHashByte ?? "33",
    ],
  );
}

export async function insertExpiredOutcome(
  persistence: SqlPersistence,
  input: Pick<
    AvailableOutcomeFixture,
    "scopeUuid" | "requestKey" | "epochUuid" | "commitSeq"
  >,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_idempotency
        (scope_uuid, request_key, identity_access_policy_sha256,
         function_path, request_sha256, epoch_uuid, commit_seq,
         result_state, result_expired_at)
      values
        ($1::uuid, $2, decode(repeat('44', 32), 'hex'),
         'messages:create', decode(repeat('55', 32), 'hex'), $3::uuid, $4,
         'expired', now())
    `,
    [input.scopeUuid, input.requestKey, input.epochUuid, input.commitSeq],
  );
}

export type OutcomeIntegrityClassification =
  | "corruptFutureToken"
  | "corruptMissingRetainedHeader"
  | "corruptRetainedEpoch"
  | "validCompacted"
  | "validRetained";

export async function classifyOutcomeIntegrity(
  persistence: SqlPersistence,
  scopeUuid: string,
  requestKey: string,
): Promise<OutcomeIntegrityClassification> {
  const result = await persistence.query<{
    classification: OutcomeIntegrityClassification;
  }>(
    `
      select case
        when outcome.commit_seq > clock.last_commit_seq
          then 'corruptFutureToken'
        when header.commit_seq is null
          and (
            clock.oldest_available_commit_seq = 0
            or outcome.commit_seq >= clock.oldest_available_commit_seq
          )
          then 'corruptMissingRetainedHeader'
        when header.commit_seq is not null
          and header.epoch_uuid <> outcome.epoch_uuid
          then 'corruptRetainedEpoch'
        when header.commit_seq is null
          then 'validCompacted'
        else 'validRetained'
      end as classification
      from fx_system_idempotency as outcome
      join fx_system_scope_clock as clock
        on clock.scope_uuid = outcome.scope_uuid
      left join fx_system_commit as header
        on header.scope_uuid = outcome.scope_uuid
       and header.commit_seq = outcome.commit_seq
      where outcome.scope_uuid = $1::uuid and outcome.request_key = $2
    `,
    [scopeUuid, requestKey],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing committed outcome fixture.");
  return row.classification;
}
