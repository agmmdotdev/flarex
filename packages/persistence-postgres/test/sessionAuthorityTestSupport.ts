import type { FlarexSqlClient } from "../src";

export const SESSION_TEST_SCOPE_UUID =
  "61000000-0000-0000-0000-000000000001";
export const SESSION_TEST_EPOCH_UUID =
  "61000000-0000-0000-0000-000000000002";
export const SESSION_TEST_HISTORICAL_EPOCH_UUID =
  "61000000-0000-0000-0000-000000000003";
export const POSTGRES_SIGNED_BIGINT_MAX_TEXT = "9223372036854775807";

export interface TransactionSessionSqlFixture {
  readonly scopeUuid: string;
  readonly sessionId: string;
  readonly storageGeneration: string;
  readonly storageGenerationFence: string;
  readonly packageId: string;
  readonly artifactRuntime: string;
  readonly artifactId: string;
  readonly sourcePackageHash: string;
  readonly executionModule: string;
  readonly functionPath: string;
  readonly functionKind: string;
  readonly schemaVersionId: string;
  readonly policyVersion: string;
  readonly identityAccessPolicySha256: Uint8Array;
  readonly validatedArgsJson: string;
  readonly validatedArgsValueCodecVersion: number;
  readonly validatedArgsCanonicalBytes: Uint8Array;
  readonly validatedArgsSha256: Uint8Array;
  readonly authorizationGrantId: string;
  readonly authorizationGrantJson: string;
  readonly authorizationGrantValueCodecVersion: number;
  readonly authorizationGrantCanonicalBytes: Uint8Array;
  readonly authorizationGrantSha256: Uint8Array;
  readonly authorizationRevocationEpoch: string;
  readonly authorizationGrantExpiresAt: string;
  readonly requestKey: string;
  readonly requestSha256: Uint8Array;
  readonly lifecycle: string;
  readonly attemptFence: string;
  readonly protocolVersion: number;
  readonly hardExpiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SnapshotLeaseSqlFixture {
  readonly scopeUuid: string;
  readonly sessionId: string;
  readonly attemptFence: string;
  readonly snapshotEpochUuid: string;
  readonly snapshotCommitSeq: string;
  readonly leaseExpiresAt: string;
}

export function transactionSessionIdAt(sequence: number): string {
  return `61000000-0000-0000-0000-${sequence.toString().padStart(12, "0")}`;
}

export function transactionSessionFixture(
  sessionId: string,
  overrides: Partial<TransactionSessionSqlFixture> = {},
): TransactionSessionSqlFixture {
  const sourcePackageHash = "a".repeat(64);
  return {
    scopeUuid: SESSION_TEST_SCOPE_UUID,
    sessionId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: "1",
    packageId: "package_session_v1",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${sourcePackageHash.slice(0, 32)}`,
    sourcePackageHash,
    executionModule: "flarex/_generated/execution.mjs",
    functionPath: "messages:create",
    functionKind: "mutation",
    schemaVersionId: "schema_session_v1",
    policyVersion: "policy_session_v1",
    identityAccessPolicySha256: filledBytes(0x11, 32),
    validatedArgsJson: JSON.stringify({ body: "hello" }),
    validatedArgsValueCodecVersion: 1,
    validatedArgsCanonicalBytes: filledBytes(0x21, 3),
    validatedArgsSha256: filledBytes(0x22, 32),
    authorizationGrantId: "grant_session_v1",
    authorizationGrantJson: JSON.stringify({ capabilities: ["db:write"] }),
    authorizationGrantValueCodecVersion: 1,
    authorizationGrantCanonicalBytes: filledBytes(0x31, 3),
    authorizationGrantSha256: filledBytes(0x32, 32),
    authorizationRevocationEpoch: "0",
    authorizationGrantExpiresAt: "2030-01-03T00:00:00.000Z",
    requestKey: `request:${sessionId}`,
    requestSha256: filledBytes(0x41, 32),
    lifecycle: "created",
    attemptFence: "1",
    protocolVersion: 1,
    hardExpiresAt: "2030-01-02T00:00:00.000Z",
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function snapshotLeaseFixture(
  sessionId: string,
  overrides: Partial<SnapshotLeaseSqlFixture> = {},
): SnapshotLeaseSqlFixture {
  return {
    scopeUuid: SESSION_TEST_SCOPE_UUID,
    sessionId,
    attemptFence: "1",
    snapshotEpochUuid: SESSION_TEST_HISTORICAL_EPOCH_UUID,
    snapshotCommitSeq: "0",
    leaseExpiresAt: "2030-01-01T12:00:00.000Z",
    ...overrides,
  };
}

export async function insertSessionTestScope(
  client: Pick<FlarexSqlClient, "query">,
): Promise<void> {
  await client.query(
    `
      insert into fx_system_scope_clock
        (scope_id, storage_generation, storage_generation_fence,
         last_commit_seq, last_outbox_seq, epoch)
      values ($1, 'flarexdb_v1', 1, 0, 0, $2)
    `,
    [
      `scope_${SESSION_TEST_SCOPE_UUID}`,
      `epoch_${SESSION_TEST_EPOCH_UUID}`,
    ],
  );
}

export async function insertTransactionSessionFixture(
  client: Pick<FlarexSqlClient, "query">,
  fixture: TransactionSessionSqlFixture,
): Promise<void> {
  await client.query(
    `
      insert into fx_system_tx_session (
        scope_uuid, session_id, storage_generation,
        storage_generation_fence, package_id, artifact_runtime, artifact_id,
        source_package_hash, execution_module, function_path, function_kind,
        schema_version_id, policy_version, identity_access_policy_sha256,
        validated_args_json, validated_args_value_codec_version,
        validated_args_canonical_bytes, validated_args_sha256,
        authorization_grant_id, authorization_grant_json,
        authorization_grant_value_codec_version,
        authorization_grant_canonical_bytes, authorization_grant_sha256,
        authorization_revocation_epoch, authorization_grant_expires_at,
        request_key, request_sha256, lifecycle, attempt_fence,
        protocol_version, hard_expires_at, created_at, updated_at
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15::jsonb, $16, $17, $18, $19, $20::jsonb, $21, $22, $23, $24,
        $25::timestamptz, $26, $27, $28, $29, $30, $31::timestamptz,
        $32::timestamptz, $33::timestamptz
      )
    `,
    [
      fixture.scopeUuid,
      fixture.sessionId,
      fixture.storageGeneration,
      fixture.storageGenerationFence,
      fixture.packageId,
      fixture.artifactRuntime,
      fixture.artifactId,
      fixture.sourcePackageHash,
      fixture.executionModule,
      fixture.functionPath,
      fixture.functionKind,
      fixture.schemaVersionId,
      fixture.policyVersion,
      fixture.identityAccessPolicySha256,
      fixture.validatedArgsJson,
      fixture.validatedArgsValueCodecVersion,
      fixture.validatedArgsCanonicalBytes,
      fixture.validatedArgsSha256,
      fixture.authorizationGrantId,
      fixture.authorizationGrantJson,
      fixture.authorizationGrantValueCodecVersion,
      fixture.authorizationGrantCanonicalBytes,
      fixture.authorizationGrantSha256,
      fixture.authorizationRevocationEpoch,
      fixture.authorizationGrantExpiresAt,
      fixture.requestKey,
      fixture.requestSha256,
      fixture.lifecycle,
      fixture.attemptFence,
      fixture.protocolVersion,
      fixture.hardExpiresAt,
      fixture.createdAt,
      fixture.updatedAt,
    ],
  );
}

export async function insertSnapshotLeaseFixture(
  client: Pick<FlarexSqlClient, "query">,
  fixture: SnapshotLeaseSqlFixture,
): Promise<void> {
  await client.query(
    `
      insert into fx_system_snapshot_lease
        (scope_uuid, session_id, attempt_fence, snapshot_epoch_uuid,
         snapshot_commit_seq, lease_expires_at)
      values ($1, $2, $3, $4, $5, $6::timestamptz)
    `,
    [
      fixture.scopeUuid,
      fixture.sessionId,
      fixture.attemptFence,
      fixture.snapshotEpochUuid,
      fixture.snapshotCommitSeq,
      fixture.leaseExpiresAt,
    ],
  );
}

export async function insertOpenTransactionJournalFixture(
  client: Pick<FlarexSqlClient, "query">,
  fixture: Readonly<{
    readonly scopeUuid: string;
    readonly sessionId: string;
    readonly attemptFence?: string;
    readonly createdAt?: string;
  }>,
): Promise<void> {
  const createdAt = fixture.createdAt ?? "2030-01-01T00:00:00.000Z";
  const creationTime = Date.parse(createdAt);
  if (!Number.isFinite(creationTime) || creationTime <= 0) {
    throw new Error("Journal fixture requires a finite positive creation time.");
  }
  await client.query(
    `
      insert into fx_system_tx_journal
        (scope_uuid, session_id, attempt_fence, state,
         creation_time_seed, next_creation_time, created_at, updated_at)
      values ($1::uuid, $2::uuid, $3, 'open', $4, $4,
              $5::timestamptz, $5::timestamptz)
    `,
    [
      fixture.scopeUuid,
      fixture.sessionId,
      fixture.attemptFence ?? "1",
      creationTime,
      createdAt,
    ],
  );
}

function filledBytes(value: number, length: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}
