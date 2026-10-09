import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MetadataSequence } from "flarex-protocol/commit-protocol";
import type { JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  CommitSeq,
  FlarexDbV1StorageGeneration,
  ScopeEpochUuidV1,
  ScopeUuidV1,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type {
  CanonicalTransactionArgumentsBytesV1,
  CanonicalTransactionAuthorizationGrantBytesV1,
  TransactionArgumentsSha256V1,
  TransactionArtifactIdV1,
  TransactionArtifactRuntimeV1,
  TransactionAttemptFence,
  TransactionAuthorizationGrantIdV1,
  TransactionAuthorizationGrantSha256V1,
  TransactionAuthorizationRevocationEpoch,
  TransactionExecutionModuleV1,
  TransactionFunctionKindV1,
  TransactionFunctionPathV1,
  TransactionIdentityAccessPolicySha256V1,
  TransactionPackageIdV1,
  TransactionPolicyVersionV1,
  TransactionRequestKeyV1,
  TransactionRequestSha256V1,
  TransactionSessionIdV1,
  TransactionSessionLifecycleV1,
  TransactionSessionProtocolVersionV1,
  TransactionSourcePackageSha256HexV1,
} from "flarex-protocol/transaction-session";
import type {
  ApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import { MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1 } from "flarex-protocol/transaction-session";
import type { FlarexValueCodecVersion } from "flarex-protocol/value";
import type {
  TransactionExecutionClaimFenceV1,
  TransactionExecutionClaimOwnerV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import { bytea, nonBlankText } from "./primitives";
import { fxSystemScopeClocks } from "./scope";

/**
 * Located request-level authority for one replacement point-mutation session.
 * O03-B, not this schema gate, owns creation and fenced lifecycle operations.
 */
export const fxSystemTransactionSessions = pgTable(
  "fx_system_tx_session",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    executionProfile: text("execution_profile").$type<"durableOperations" | "finiteRoot">().notNull().default("durableOperations"),
    finiteAttemptBytes: bytea("finite_attempt_bytes"),
    finiteAttemptSha256: bytea("finite_attempt_sha256"),
    finiteSnapshotEpochUuid: uuid("finite_snapshot_epoch_uuid").$type<ScopeEpochUuidV1>(),
    finiteSnapshotCommitSeq: bigint("finite_snapshot_commit_seq", { mode: "bigint" }).$type<CommitSeq>(),
    finiteMetadataWatermark: bigint("finite_metadata_watermark", { mode: "bigint" }).$type<MetadataSequence>(),
    finiteLeaseExpiresAt: timestamp("finite_lease_expires_at", { withTimezone: true }),
    finiteClaimOwner: uuid("finite_claim_owner").$type<TransactionExecutionClaimOwnerV1>(),
    finiteClaimFence: bigint("finite_claim_fence", { mode: "bigint" }).$type<TransactionExecutionClaimFenceV1>(),
    finiteClaimedAt: timestamp("finite_claimed_at", { withTimezone: true }),
    finiteClaimExpiresAt: timestamp("finite_claim_expires_at", { withTimezone: true }),
    storageGeneration: text("storage_generation")
      .$type<FlarexDbV1StorageGeneration>()
      .notNull(),
    storageGenerationFence: bigint("storage_generation_fence", {
      mode: "bigint",
    })
      .$type<StorageGenerationFence>()
      .notNull(),
    executionAuthorityGeneration: text("execution_authority_generation")
      .$type<"legacy_dynamic_worker_v1" | "application_v1">()
      .notNull()
      .default("legacy_dynamic_worker_v1"),
    applicationExecutionAuthorityJson: jsonb(
      "application_execution_authority_json",
    ).$type<ApplicationMutationExecutionAuthorityV1>(),
    applicationExecutionAuthorityCanonicalBytes: bytea(
      "application_execution_authority_canonical_bytes",
    ),
    applicationExecutionAuthoritySha256: bytea(
      "application_execution_authority_sha256",
    ),
    packageId: text("package_id").$type<TransactionPackageIdV1>(),
    artifactRuntime: text("artifact_runtime")
      .$type<TransactionArtifactRuntimeV1>(),
    artifactId: text("artifact_id")
      .$type<TransactionArtifactIdV1>(),
    sourcePackageHash: text("source_package_hash")
      .$type<TransactionSourcePackageSha256HexV1>(),
    executionModule: text("execution_module")
      .$type<TransactionExecutionModuleV1>(),
    functionPath: text("function_path")
      .$type<TransactionFunctionPathV1>()
      .notNull(),
    functionKind: text("function_kind")
      .$type<TransactionFunctionKindV1>()
      .notNull(),
    schemaVersionId: text("schema_version_id")
      .$type<CatalogSchemaVersionId>()
      .notNull(),
    policyVersion: text("policy_version")
      .$type<TransactionPolicyVersionV1>()
      .notNull(),
    identityAccessPolicySha256: bytea("identity_access_policy_sha256")
      .$type<TransactionIdentityAccessPolicySha256V1>()
      .notNull(),
    validatedArgsJson: jsonb("validated_args_json")
      .$type<JsonObject>(),
    validatedArgsValueCodecVersion: integer(
      "validated_args_value_codec_version",
    )
      .$type<FlarexValueCodecVersion>()
      .notNull(),
    validatedArgsCanonicalBytes: bytea("validated_args_canonical_bytes")
      .$type<CanonicalTransactionArgumentsBytesV1>(),
    validatedArgsSha256: bytea("validated_args_sha256")
      .$type<TransactionArgumentsSha256V1>()
      .notNull(),
    authorizationGrantId: text("authorization_grant_id")
      .$type<TransactionAuthorizationGrantIdV1>()
      .notNull(),
    authorizationGrantJson: jsonb("authorization_grant_json")
      .$type<JsonObject>(),
    authorizationGrantValueCodecVersion: integer(
      "authorization_grant_value_codec_version",
    )
      .$type<FlarexValueCodecVersion>()
      .notNull(),
    authorizationGrantCanonicalBytes: bytea(
      "authorization_grant_canonical_bytes",
    )
      .$type<CanonicalTransactionAuthorizationGrantBytesV1>(),
    authorizationGrantSha256: bytea("authorization_grant_sha256")
      .$type<TransactionAuthorizationGrantSha256V1>()
      .notNull(),
    authorizationRevocationEpoch: bigint("authorization_revocation_epoch", {
      mode: "bigint",
    })
      .$type<TransactionAuthorizationRevocationEpoch>()
      .notNull(),
    authorizationGrantExpiresAt: timestamp(
      "authorization_grant_expires_at",
      { withTimezone: true },
    ).notNull(),
    requestKey: text("request_key")
      .$type<TransactionRequestKeyV1>()
      .notNull(),
    requestSha256: bytea("request_sha256")
      .$type<TransactionRequestSha256V1>()
      .notNull(),
    lifecycle: text("lifecycle")
      .$type<TransactionSessionLifecycleV1>()
      .notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    protocolVersion: integer("protocol_version")
      .$type<TransactionSessionProtocolVersionV1>()
      .notNull(),
    hardExpiresAt: timestamp("hard_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeUuid, table.sessionId] }),
    uniqueIndex("fx_system_finite_attempt_request_identity_unique").on(table.scopeUuid, table.requestKey)
      .where(sql`${table.executionProfile} = 'finiteRoot'`),
    index("fx_system_finite_attempt_claim_discovery_idx")
      .on(table.scopeUuid, table.finiteClaimExpiresAt, table.sessionId, table.attemptFence)
      .where(sql`${table.executionProfile} = 'finiteRoot' and ${table.lifecycle} in ('running', 'retrying')`),
    check("fx_system_tx_session_execution_profile_check", sql`${table.executionProfile} in ('durableOperations', 'finiteRoot')`),
    check("fx_system_tx_session_finite_anchor_check", sql`(
      (${table.executionProfile} = 'durableOperations' and ${table.finiteAttemptBytes} is null and ${table.finiteAttemptSha256} is null
        and ${table.finiteSnapshotEpochUuid} is null and ${table.finiteSnapshotCommitSeq} is null and ${table.finiteMetadataWatermark} is null
        and ${table.finiteLeaseExpiresAt} is null and ${table.finiteClaimOwner} is null and ${table.finiteClaimFence} is null
        and ${table.finiteClaimedAt} is null and ${table.finiteClaimExpiresAt} is null)
      or (${table.executionProfile} = 'finiteRoot' and ${table.finiteAttemptBytes} is not null
        and octet_length(${table.finiteAttemptBytes}) between 1 and 131072
        and ${table.finiteAttemptSha256} is not null and octet_length(${table.finiteAttemptSha256}) = 32)
    )`),
    check("fx_system_tx_session_finite_ownership_check", sql`${table.executionProfile} <> 'finiteRoot' or
      (${table.finiteSnapshotEpochUuid} is not null and ${table.finiteSnapshotCommitSeq} is not null and ${table.finiteSnapshotCommitSeq} >= 0
        and (${table.finiteMetadataWatermark} is null or ${table.finiteMetadataWatermark} >= 0)
        and ${table.finiteLeaseExpiresAt} is not null and ${table.finiteClaimOwner} is not null
        and ${table.finiteClaimFence} is not null and ${table.finiteClaimFence} >= 1 and ${table.finiteClaimedAt} is not null
        and ${table.finiteClaimExpiresAt} is not null and ${table.finiteClaimExpiresAt} > ${table.finiteClaimedAt}
        and isfinite(${table.finiteClaimedAt}) and isfinite(${table.finiteClaimExpiresAt}) and isfinite(${table.finiteLeaseExpiresAt})
        and ${table.finiteClaimExpiresAt} <= ${table.finiteLeaseExpiresAt}
        and ${table.finiteLeaseExpiresAt} <= ${table.hardExpiresAt})`),
    unique("fx_system_tx_session_current_attempt_unique").on(
      table.scopeUuid,
      table.sessionId,
      table.attemptFence,
    ),
    foreignKey({
      name: "fx_system_tx_session_scope_clock_fk",
      columns: [table.scopeUuid],
      foreignColumns: [fxSystemScopeClocks.scopeUuid],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_tx_session_request_lookup_idx").on(
      table.scopeUuid,
      table.requestKey,
    ),
    index("fx_system_tx_session_expiry_idx").on(table.hardExpiresAt),
    index("fx_system_tx_session_finishing_discovery_idx")
      .on(
        table.scopeUuid,
        table.updatedAt,
        table.sessionId,
        table.attemptFence,
      )
      .where(sql`${table.lifecycle} = 'finishing'`),
    index("fx_system_tx_session_application_retirement_pin_idx")
      .on(table.scopeUuid, table.sessionId)
      .where(sql`${table.executionAuthorityGeneration} = 'application_v1'
        and ${table.lifecycle} in ('created', 'running', 'finishing', 'committing', 'retrying')`),
    check(
      "fx_system_tx_session_generation_check",
      sql`${table.storageGeneration} = 'flarexdb_v1'`,
    ),
    check(
      "fx_system_tx_session_generation_fence_check",
      sql`${table.storageGenerationFence} >= 1`,
    ),
    check(
      "fx_system_tx_session_execution_authority_check",
      sql`(
        (${table.executionAuthorityGeneration} = 'legacy_dynamic_worker_v1'
          and ${table.packageId} is not null
          and ${nonBlankText(table.packageId)}
          and ${table.artifactRuntime} is not null
          and ${table.artifactRuntime} = 'dynamic-worker'
          and ${table.artifactId} is not null
          and ${table.artifactId} ~ '^artifact_[0-9a-f]{32}$'
          and ${table.sourcePackageHash} is not null
          and ${table.sourcePackageHash} ~ '^[0-9a-f]{64}$'
          and ${table.artifactId} = 'artifact_' || left(${table.sourcePackageHash}, 32)
          and ${table.executionModule} is not null
          and ${nonBlankText(table.executionModule)}
          and ${table.applicationExecutionAuthorityJson} is null
          and ${table.applicationExecutionAuthorityCanonicalBytes} is null
          and ${table.applicationExecutionAuthoritySha256} is null)
        or
        (${table.executionAuthorityGeneration} = 'application_v1'
          and ${table.packageId} is null
          and ${table.artifactRuntime} is null
          and ${table.artifactId} is null
          and ${table.sourcePackageHash} is null
          and ${table.executionModule} is null
          and (
            (${table.lifecycle} in ('committed', 'aborted', 'expired')
              and ${table.applicationExecutionAuthorityJson} is null
              and ${table.applicationExecutionAuthorityCanonicalBytes} is null)
            or (${table.lifecycle} not in ('committed', 'aborted', 'expired')
              and ${table.applicationExecutionAuthorityJson} is not null
              and jsonb_typeof(${table.applicationExecutionAuthorityJson}) = 'object'
              and ${table.applicationExecutionAuthorityCanonicalBytes} is not null
              and octet_length(${table.applicationExecutionAuthorityCanonicalBytes}) between 1 and 131072)
          )
          and ${table.applicationExecutionAuthoritySha256} is not null
          and octet_length(${table.applicationExecutionAuthoritySha256}) = 32)
      ) is true`,
    ),
    check(
      "fx_system_tx_session_function_path_check",
      nonBlankText(table.functionPath),
    ),
    check(
      "fx_system_tx_session_function_kind_check",
      sql`${table.functionKind} = 'mutation'`,
    ),
    check(
      "fx_system_tx_session_schema_version_check",
      nonBlankText(table.schemaVersionId),
    ),
    check(
      "fx_system_tx_session_policy_version_check",
      nonBlankText(table.policyVersion),
    ),
    check(
      "fx_system_tx_session_identity_hash_check",
      sql`octet_length(${table.identityAccessPolicySha256}) = 32`,
    ),
    check(
      "fx_system_tx_session_args_evidence_check",
      sql`(
        ${table.validatedArgsValueCodecVersion} = 1
        and octet_length(${table.validatedArgsSha256}) = 32
        and (
          (${table.lifecycle} in ('committed', 'aborted', 'expired')
            and ${table.validatedArgsJson} is null
            and ${table.validatedArgsCanonicalBytes} is null)
          or (${table.lifecycle} not in ('committed', 'aborted', 'expired')
            and ${table.validatedArgsJson} is not null
            and jsonb_typeof(${table.validatedArgsJson}) = 'object'
            and ${table.validatedArgsCanonicalBytes} is not null
            and octet_length(${table.validatedArgsCanonicalBytes}) > 0)
        )
      ) is true`,
    ),
    check(
      "fx_system_tx_session_grant_id_check",
      nonBlankText(table.authorizationGrantId),
    ),
    check(
      "fx_system_tx_session_grant_evidence_check",
      sql`(
        ${table.authorizationGrantValueCodecVersion} = 1
        and octet_length(${table.authorizationGrantSha256}) = 32
        and (
          (${table.lifecycle} in ('committed', 'aborted', 'expired')
            and ${table.authorizationGrantJson} is null
            and ${table.authorizationGrantCanonicalBytes} is null)
          or (${table.lifecycle} not in ('committed', 'aborted', 'expired')
            and ${table.authorizationGrantJson} is not null
            and jsonb_typeof(${table.authorizationGrantJson}) = 'object'
            and ${table.authorizationGrantCanonicalBytes} is not null
            and octet_length(${table.authorizationGrantCanonicalBytes}) > 0)
        )
      ) is true`,
    ),
    check(
      "fx_system_tx_session_revocation_epoch_check",
      sql`${table.authorizationRevocationEpoch} >= 0`,
    ),
    check(
      "fx_system_tx_session_request_key_check",
      sql`
        ${nonBlankText(table.requestKey)}
        and octet_length(${table.requestKey}) <= ${sql.raw(
          String(MAX_TRANSACTION_REQUEST_KEY_UTF8_BYTES_V1),
        )}
      `,
    ),
    check(
      "fx_system_tx_session_request_hash_check",
      sql`octet_length(${table.requestSha256}) = 32`,
    ),
    check(
      "fx_system_tx_session_lifecycle_check",
      sql`${table.lifecycle} in ('created', 'running', 'finishing', 'committing', 'retrying', 'committed', 'aborted', 'expired')`,
    ),
    check(
      "fx_system_tx_session_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_tx_session_protocol_version_check",
      sql`${table.protocolVersion} = 1`,
    ),
    check(
      "fx_system_tx_session_expiry_check",
      sql`
        isfinite(${table.authorizationGrantExpiresAt})
        and isfinite(${table.hardExpiresAt})
        and ${table.authorizationGrantExpiresAt} > ${table.createdAt}
        and ${table.hardExpiresAt} > ${table.createdAt}
        and ${table.hardExpiresAt} <= ${table.authorizationGrantExpiresAt}
      `,
    ),
    check(
      "fx_system_tx_session_timestamp_order_check",
      sql`
        isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
      `,
    ),
  ],
);

/** One retention pin for the exact current attempt of one session. */
export const fxSystemSnapshotLeases = pgTable(
  "fx_system_snapshot_lease",
  {
    scopeUuid: uuid("scope_uuid").$type<ScopeUuidV1>().notNull(),
    sessionId: uuid("session_id").$type<TransactionSessionIdV1>().notNull(),
    attemptFence: bigint("attempt_fence", { mode: "bigint" })
      .$type<TransactionAttemptFence>()
      .notNull(),
    snapshotEpochUuid: uuid("snapshot_epoch_uuid")
      .$type<ScopeEpochUuidV1>()
      .notNull(),
    snapshotCommitSeq: bigint("snapshot_commit_seq", { mode: "bigint" })
      .$type<CommitSeq>()
      .notNull(),
    metadataWatermark: bigint("metadata_watermark", { mode: "bigint" }).$type<MetadataSequence>(),
    finiteMetadataReservationBytes: bytea("finite_metadata_reservation_bytes"),
    finiteMetadataReservationSha256: bytea("finite_metadata_reservation_sha256"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    check("fx_snapshot_lease_finite_metadata_reservation_check", sql`
      (${table.metadataWatermark} is null and ${table.finiteMetadataReservationBytes} is null and ${table.finiteMetadataReservationSha256} is null)
      or (${table.metadataWatermark} is not null and ${table.metadataWatermark} >= 0 and ${table.finiteMetadataReservationBytes} is not null
        and octet_length(${table.finiteMetadataReservationBytes}) between 1 and 65536
        and ${table.finiteMetadataReservationSha256} is not null and octet_length(${table.finiteMetadataReservationSha256}) = 32)`),
    primaryKey({ columns: [table.scopeUuid, table.sessionId] }),
    foreignKey({
      name: "fx_system_snapshot_lease_current_attempt_fk",
      columns: [table.scopeUuid, table.sessionId, table.attemptFence],
      foreignColumns: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
        fxSystemTransactionSessions.attemptFence,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    index("fx_system_snapshot_lease_floor_idx").on(
      table.scopeUuid,
      table.snapshotEpochUuid,
      table.snapshotCommitSeq,
      table.leaseExpiresAt,
    ),
    index("fx_system_snapshot_lease_expiry_idx").on(table.leaseExpiresAt),
    index("fx_system_snapshot_lease_retirement_pin_idx").on(
      table.scopeUuid,
      table.leaseExpiresAt,
      table.sessionId,
    ),
    check(
      "fx_system_snapshot_lease_attempt_fence_check",
      sql`${table.attemptFence} >= 1`,
    ),
    check(
      "fx_system_snapshot_lease_commit_seq_check",
      sql`${table.snapshotCommitSeq} >= 0`,
    ),
    check(
      "fx_system_snapshot_lease_expiry_check",
      sql`isfinite(${table.leaseExpiresAt})`,
    ),
  ],
);
