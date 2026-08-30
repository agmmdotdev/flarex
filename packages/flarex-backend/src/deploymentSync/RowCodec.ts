import {
  MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_QUERY_GENERATION,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
  blockedQueryEvaluationDisposition,
  captureCanonicalDependencyKey,
  captureCanonicalQueryKey,
  captureNamespaceCursor,
  captureQueryAuthorityWitness,
  captureQueryDescriptor,
  captureQueryGeneration,
  captureQueryResultDigest,
  captureQuerySnapshot,
  captureQuerySyncWorkRevision,
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
  captureSyncSequence,
  readyQueryEvaluationDisposition,
  type CanonicalDependencyKey,
  type QueryGeneration,
  type QuerySyncCanonicalValueError,
  type SyncModelId,
} from "@flarex/query-sync/internal/kernel";
import type {
  ActiveQueryScalarFacts,
  AffectedActiveQueryFacts,
  AffectedActiveQueryTarget,
  BeginQueryFacts,
  QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result, Schema } from "effect";

import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpochUuidV1,
  type ScopeUuidV1,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

const LOCAL_CONTRACT_GENERATION = 2 as const;
const LEGACY_LOCAL_SCHEMA_REVISION = 1 as const;
const MAX_IN_FLIGHT_PUBLICATION_COUNT = 1;

type DeploymentQuerySyncRowKind =
  | "generation1Scope"
  | "contract"
  | "scope"
  | "query"
  | "affectedTarget"
  | "affectedActive"
  | "dependency";

type DeploymentQuerySyncRowField =
  | "singleton"
  | "local_schema_revision"
  | "local_contract_generation"
  | "durable_initialized_history"
  | "scope_uuid"
  | "epoch_uuid"
  | "storage_generation"
  | "storage_generation_fence"
  | "sync_model_id"
  | "applied_through_commit_seq"
  | "applied_through_sequence"
  | "evaluation_work_revision"
  | "fairness_anchor"
  | "query_count"
  | "retained_identity_bytes"
  | "dependency_memberships"
  | "pending_publication_count"
  | "in_flight_publication_count"
  | "retained_publication_content_bytes"
  | "settlement_envelope_bytes"
  | "counted_canonical_bytes"
  | "query_key"
  | "query_identity"
  | "active_generation"
  | "active_evaluation_snapshot_sequence"
  | "active_fresh_through_sequence"
  | "active_dirty_through_sequence"
  | "active_result_digest"
  | "active_authority_witness"
  | "provisional_generation"
  | "provisional_expected_active_generation"
  | "provisional_registration_sequence"
  | "provisional_requested_dirty_through_sequence"
  | "provisional_disposition"
  | "role"
  | "generation"
  | "dependency_key";

type DeploymentQuerySyncRowCodecCause =
  | Schema.SchemaError
  | QuerySyncCanonicalValueError
  | null;

export class DeploymentQuerySyncRowCodecError extends Data.TaggedError(
  "DeploymentQuerySyncRowCodecError",
)<{
  readonly rowKind: DeploymentQuerySyncRowKind;
  readonly reason:
    | "shapeInvalid"
    | "valueInvalid"
    | "limitExceeded"
    | "activeGroupInvalid"
    | "provisionalGroupInvalid"
    | "queryFactsInvalid"
    | "unsupportedContractGeneration"
    | "unsupportedLegacyRevision";
  readonly field: DeploymentQuerySyncRowField | null;
  readonly cause: DeploymentQuerySyncRowCodecCause;
}> {}

export interface DeploymentSyncGeneration1ScopeState {
  readonly localSchemaRevision: typeof LEGACY_LOCAL_SCHEMA_REVISION;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly appliedThroughCommitSeq: CommitSeq;
}

export interface DeploymentQuerySyncContractState {
  readonly localContractGeneration: typeof LOCAL_CONTRACT_GENERATION;
  readonly durableInitializedHistory: boolean;
}

export interface DeploymentQuerySyncStoredScopeState {
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly syncModelId: SyncModelId;
  readonly facts: QuerySyncScopeFacts;
}

export interface DeploymentQuerySyncActiveDependency {
  readonly role: "active";
  readonly queryKey: AffectedActiveQueryTarget["queryKey"];
  readonly generation: QueryGeneration;
  readonly dependencyKey: CanonicalDependencyKey;
}

export interface EncodedDeploymentQuerySyncScopeRow {
  readonly singleton: 1;
  readonly scope_uuid: string;
  readonly epoch_uuid: string;
  readonly storage_generation: string;
  readonly storage_generation_fence: string;
  readonly sync_model_id: string;
  readonly applied_through_sequence: string;
  readonly evaluation_work_revision: string;
  readonly fairness_anchor: string | null;
  readonly query_count: number;
  readonly retained_identity_bytes: number;
  readonly dependency_memberships: number;
  readonly pending_publication_count: number;
  readonly in_flight_publication_count: number;
  readonly retained_publication_content_bytes: number;
  readonly settlement_envelope_bytes: number;
  readonly counted_canonical_bytes: number;
}

export interface EncodedDeploymentQuerySyncQueryRow {
  readonly query_key: string;
  readonly query_identity: string;
  readonly active_generation: string | null;
  readonly active_evaluation_snapshot_sequence: string | null;
  readonly active_fresh_through_sequence: string | null;
  readonly active_dirty_through_sequence: string | null;
  readonly active_result_digest: string | null;
  readonly active_authority_witness: string | null;
  readonly provisional_generation: string | null;
  readonly provisional_expected_active_generation: string | null;
  readonly provisional_registration_sequence: string | null;
  readonly provisional_requested_dirty_through_sequence: string | null;
  readonly provisional_disposition: "ready" | "blocked" | null;
}

export interface EncodedDeploymentQuerySyncAffectedActiveRow {
  readonly query_key: string;
  readonly active_generation: string;
  readonly active_evaluation_snapshot_sequence: string;
  readonly active_fresh_through_sequence: string;
  readonly active_dirty_through_sequence: string | null;
  readonly active_result_digest: string;
  readonly active_authority_witness: string;
}

export interface EncodedDeploymentQuerySyncDependencyRow {
  readonly role: "active";
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}

const RawGeneration1ScopeRowSchema = Schema.Struct({
  singleton: Schema.Number,
  local_schema_revision: Schema.Number,
  scope_uuid: Schema.String,
  epoch_uuid: Schema.String,
  storage_generation: Schema.String,
  storage_generation_fence: Schema.String,
  applied_through_commit_seq: Schema.String,
});

const RawContractRowSchema = Schema.Struct({
  singleton: Schema.Number,
  local_contract_generation: Schema.Number,
  durable_initialized_history: Schema.Number,
});

const RawScopeRowSchema = Schema.Struct({
  singleton: Schema.Number,
  scope_uuid: Schema.String,
  epoch_uuid: Schema.String,
  storage_generation: Schema.String,
  storage_generation_fence: Schema.String,
  sync_model_id: Schema.String,
  applied_through_sequence: Schema.String,
  evaluation_work_revision: Schema.String,
  fairness_anchor: Schema.NullOr(Schema.String),
  query_count: Schema.Number,
  retained_identity_bytes: Schema.Number,
  dependency_memberships: Schema.Number,
  pending_publication_count: Schema.Number,
  in_flight_publication_count: Schema.Number,
  retained_publication_content_bytes: Schema.Number,
  settlement_envelope_bytes: Schema.Number,
  counted_canonical_bytes: Schema.Number,
});

const RawQueryRowSchema = Schema.Struct({
  query_key: Schema.String,
  query_identity: Schema.String,
  active_generation: Schema.NullOr(Schema.String),
  active_evaluation_snapshot_sequence: Schema.NullOr(Schema.String),
  active_fresh_through_sequence: Schema.NullOr(Schema.String),
  active_dirty_through_sequence: Schema.NullOr(Schema.String),
  active_result_digest: Schema.NullOr(Schema.String),
  active_authority_witness: Schema.NullOr(Schema.String),
  provisional_generation: Schema.NullOr(Schema.String),
  provisional_expected_active_generation: Schema.NullOr(Schema.String),
  provisional_registration_sequence: Schema.NullOr(Schema.String),
  provisional_requested_dirty_through_sequence: Schema.NullOr(Schema.String),
  provisional_disposition: Schema.NullOr(Schema.String),
});

const RawAffectedTargetRowSchema = Schema.Struct({
  query_key: Schema.String,
  active_generation: Schema.String,
});

const RawAffectedActiveRowSchema = Schema.Struct({
  query_key: Schema.String,
  active_generation: Schema.String,
  active_evaluation_snapshot_sequence: Schema.String,
  active_fresh_through_sequence: Schema.String,
  active_dirty_through_sequence: Schema.NullOr(Schema.String),
  active_result_digest: Schema.String,
  active_authority_witness: Schema.String,
});

const RawDependencyRowSchema = Schema.Struct({
  role: Schema.String,
  query_key: Schema.String,
  generation: Schema.String,
  dependency_key: Schema.String,
});

const strictRowOptions = { onExcessProperty: "error" } as const;
const decodeRawGeneration1ScopeRow = Schema.decodeUnknownResult(
  RawGeneration1ScopeRowSchema,
  strictRowOptions,
);
const decodeRawContractRow = Schema.decodeUnknownResult(
  RawContractRowSchema,
  strictRowOptions,
);
const decodeRawScopeRow = Schema.decodeUnknownResult(
  RawScopeRowSchema,
  strictRowOptions,
);
const decodeRawQueryRow = Schema.decodeUnknownResult(
  RawQueryRowSchema,
  strictRowOptions,
);
const decodeRawAffectedTargetRow = Schema.decodeUnknownResult(
  RawAffectedTargetRowSchema,
  strictRowOptions,
);
const decodeRawAffectedActiveRow = Schema.decodeUnknownResult(
  RawAffectedActiveRowSchema,
  strictRowOptions,
);
const decodeRawDependencyRow = Schema.decodeUnknownResult(
  RawDependencyRowSchema,
  strictRowOptions,
);

const decodeScopeUuid = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeEpochUuid = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochUuidV1Schema),
);
const decodeStorageGeneration = Schema.decodeUnknownResult(
  Schema.toType(FlarexDbV1StorageGenerationSchema),
);
const decodeStorageGenerationFence = Schema.decodeUnknownResult(
  StorageGenerationFenceSchema,
);
const decodeCommitSeq = Schema.decodeUnknownResult(CommitSeqSchema);

function rowCodecError(
  rowKind: DeploymentQuerySyncRowKind,
  reason: DeploymentQuerySyncRowCodecError["reason"],
  field: DeploymentQuerySyncRowField | null,
  cause: DeploymentQuerySyncRowCodecCause = null,
): DeploymentQuerySyncRowCodecError {
  return new DeploymentQuerySyncRowCodecError({
    rowKind,
    reason,
    field,
    cause,
  });
}

function decodeShape<Value>(
  rowKind: DeploymentQuerySyncRowKind,
  result: Result.Result<Value, Schema.SchemaError>,
): Result.Result<Value, DeploymentQuerySyncRowCodecError> {
  return result.pipe(Result.mapError((cause) => rowCodecError(
    rowKind,
    "shapeInvalid",
    null,
    cause,
  )));
}

function decodeSchemaValue<Value>(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  result: Result.Result<Value, Schema.SchemaError>,
): Result.Result<Value, DeploymentQuerySyncRowCodecError> {
  return result.pipe(Result.mapError((cause) => rowCodecError(
    rowKind,
    "valueInvalid",
    field,
    cause,
  )));
}

function captureCanonicalValue<Value>(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  result: Result.Result<Value, QuerySyncCanonicalValueError>,
): Result.Result<Value, DeploymentQuerySyncRowCodecError> {
  return result.pipe(Result.mapError((cause) => rowCodecError(
    rowKind,
    "valueInvalid",
    field,
    cause,
  )));
}

function captureStoredQueryDescriptor(
  queryKey: string,
  queryIdentity: string,
) {
  return captureQueryDescriptor({ queryKey, queryIdentity }).pipe(
    Result.mapError((cause) => rowCodecError(
      "query",
      "valueInvalid",
      cause.field === "queryIdentity" ? "query_identity" : "query_key",
      cause,
    )),
  );
}

function decodeCanonicalCommitSeq(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string,
): Result.Result<CommitSeq, DeploymentQuerySyncRowCodecError> {
  return decodeSchemaValue(rowKind, field, decodeCommitSeq(value));
}

function decodeSyncSequence(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string,
) {
  return decodeCanonicalCommitSeq(rowKind, field, value).pipe(
    Result.flatMap((decoded) => captureCanonicalValue(
      rowKind,
      field,
      captureSyncSequence(decoded),
    )),
  );
}

function decodeQueryGeneration(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string,
) {
  return decodeCanonicalCommitSeq(rowKind, field, value).pipe(
    Result.flatMap((decoded) => captureCanonicalValue(
      rowKind,
      field,
      captureQueryGeneration(decoded),
    )),
  );
}

function decodeQuerySnapshot(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string,
) {
  return decodeCanonicalCommitSeq(rowKind, field, value).pipe(
    Result.flatMap((decoded) => captureCanonicalValue(
      rowKind,
      field,
      captureQuerySnapshot(decoded),
    )),
  );
}

function decodeWorkRevision(
  value: string,
) {
  return decodeCanonicalCommitSeq(
    "scope",
    "evaluation_work_revision",
    value,
  ).pipe(Result.flatMap((decoded) => captureCanonicalValue(
    "scope",
    "evaluation_work_revision",
    captureQuerySyncWorkRevision(decoded),
  )));
}

function decodeNullableSyncSequence(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string | null,
) {
  return value === null
    ? Result.succeed(null)
    : decodeSyncSequence(rowKind, field, value);
}

function decodeNullableQueryGeneration(
  rowKind: DeploymentQuerySyncRowKind,
  field: DeploymentQuerySyncRowField,
  value: string | null,
) {
  return value === null
    ? Result.succeed(null)
    : decodeQueryGeneration(rowKind, field, value);
}

function decodeBoundedCounter(
  field: DeploymentQuerySyncRowField,
  value: number,
  maximum: number,
): Result.Result<number, DeploymentQuerySyncRowCodecError> {
  return isNonNegativeSafeInteger(value) && value <= maximum
    ? Result.succeed(value)
    : Result.fail(rowCodecError(
      "scope",
      "limitExceeded",
      field,
    ));
}

function activeFactsValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts,
): boolean {
  return active.evaluationSnapshotSequence <= active.freshThroughSequence
    && active.freshThroughSequence <= scope.cursor.appliedThroughSequence
    && (
      active.dirtyThroughSequence === null
      || (
        active.dirtyThroughSequence > active.freshThroughSequence
        && active.dirtyThroughSequence
          <= scope.cursor.appliedThroughSequence
      )
    );
}

function provisionalFactsValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts | null,
  provisional: NonNullable<BeginQueryFacts["provisional"]>,
): boolean {
  const registration = provisional.registrationCursor;
  if (
    registration.namespaceId !== scope.cursor.namespaceId
    || registration.syncModelId !== scope.cursor.syncModelId
    || registration.sourceEpoch !== scope.cursor.sourceEpoch
    || registration.appliedThroughSequence
      > scope.cursor.appliedThroughSequence
  ) {
    return false;
  }
  if (active === null) {
    return provisional.generation === 1n
      && provisional.expectedActiveGeneration === null
      && provisional.requestedDirtyThroughSequence === null;
  }
  return active.generation < MAX_QUERY_GENERATION
    && provisional.expectedActiveGeneration === active.generation
    && provisional.generation === active.generation + 1n
    && provisional.requestedDirtyThroughSequence !== null
    && provisional.requestedDirtyThroughSequence
      > active.freshThroughSequence
    && active.dirtyThroughSequence !== null
    && provisional.requestedDirtyThroughSequence
      <= active.dirtyThroughSequence;
}

function activeGroupIsAbsent(row: {
  readonly active_generation: string | null;
  readonly active_evaluation_snapshot_sequence: string | null;
  readonly active_fresh_through_sequence: string | null;
  readonly active_dirty_through_sequence: string | null;
  readonly active_result_digest: string | null;
  readonly active_authority_witness: string | null;
}): boolean {
  return row.active_generation === null
    && row.active_evaluation_snapshot_sequence === null
    && row.active_fresh_through_sequence === null
    && row.active_dirty_through_sequence === null
    && row.active_result_digest === null
    && row.active_authority_witness === null;
}

function decodeRequiredActiveFacts(
  rowKind: "query" | "affectedActive",
  row: {
    readonly active_generation: string;
    readonly active_evaluation_snapshot_sequence: string;
    readonly active_fresh_through_sequence: string;
    readonly active_dirty_through_sequence: string | null;
    readonly active_result_digest: string;
    readonly active_authority_witness: string;
  },
  scope: QuerySyncScopeFacts,
): Result.Result<ActiveQueryScalarFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const active = Object.freeze({
      generation: yield* decodeQueryGeneration(
        rowKind,
        "active_generation",
        row.active_generation,
      ),
      evaluationSnapshotSequence: yield* decodeQuerySnapshot(
        rowKind,
        "active_evaluation_snapshot_sequence",
        row.active_evaluation_snapshot_sequence,
      ),
      freshThroughSequence: yield* decodeSyncSequence(
        rowKind,
        "active_fresh_through_sequence",
        row.active_fresh_through_sequence,
      ),
      dirtyThroughSequence: yield* decodeNullableSyncSequence(
        rowKind,
        "active_dirty_through_sequence",
        row.active_dirty_through_sequence,
      ),
      resultDigest: yield* captureCanonicalValue(
        rowKind,
        "active_result_digest",
        captureQueryResultDigest(row.active_result_digest),
      ),
      authorityWitness: yield* captureCanonicalValue(
        rowKind,
        "active_authority_witness",
        captureQueryAuthorityWitness(row.active_authority_witness),
      ),
    } satisfies ActiveQueryScalarFacts);
    return activeFactsValid(scope, active)
      ? active
      : yield* Result.fail(rowCodecError(
        rowKind,
        "activeGroupInvalid",
        null,
      ));
  });
}

export function decodeDeploymentSyncGeneration1ScopeRowResult(
  input: unknown,
): Result.Result<
  DeploymentSyncGeneration1ScopeState,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape(
      "generation1Scope",
      decodeRawGeneration1ScopeRow(input),
    );
    if (row.singleton !== 1) {
      return yield* Result.fail(rowCodecError(
        "generation1Scope",
        "valueInvalid",
        "singleton",
      ));
    }
    if (row.local_schema_revision !== LEGACY_LOCAL_SCHEMA_REVISION) {
      return yield* Result.fail(rowCodecError(
        "generation1Scope",
        "unsupportedLegacyRevision",
        "local_schema_revision",
      ));
    }
    const scopeUuid = yield* decodeSchemaValue(
      "generation1Scope",
      "scope_uuid",
      decodeScopeUuid(row.scope_uuid),
    );
    const epochUuid = yield* decodeSchemaValue(
      "generation1Scope",
      "epoch_uuid",
      decodeEpochUuid(row.epoch_uuid),
    );
    const storageGeneration = yield* decodeSchemaValue(
      "generation1Scope",
      "storage_generation",
      decodeStorageGeneration(row.storage_generation),
    );
    const storageGenerationFence = yield* decodeSchemaValue(
      "generation1Scope",
      "storage_generation_fence",
      decodeStorageGenerationFence(row.storage_generation_fence),
    );
    const appliedThroughCommitSeq = yield* decodeCanonicalCommitSeq(
      "generation1Scope",
      "applied_through_commit_seq",
      row.applied_through_commit_seq,
    );
    return Object.freeze({
      localSchemaRevision: LEGACY_LOCAL_SCHEMA_REVISION,
      scopeUuid,
      epochUuid,
      storageGeneration,
      storageGenerationFence,
      appliedThroughCommitSeq,
    });
  });
}

export function decodeDeploymentQuerySyncContractRowResult(
  input: unknown,
): Result.Result<
  DeploymentQuerySyncContractState,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape(
      "contract",
      decodeRawContractRow(input),
    );
    if (row.singleton !== 1) {
      return yield* Result.fail(rowCodecError(
        "contract",
        "valueInvalid",
        "singleton",
      ));
    }
    if (row.local_contract_generation !== LOCAL_CONTRACT_GENERATION) {
      return yield* Result.fail(rowCodecError(
        "contract",
        "unsupportedContractGeneration",
        "local_contract_generation",
      ));
    }
    if (
      row.durable_initialized_history !== 0
      && row.durable_initialized_history !== 1
    ) {
      return yield* Result.fail(rowCodecError(
        "contract",
        "valueInvalid",
        "durable_initialized_history",
      ));
    }
    return Object.freeze({
      localContractGeneration: LOCAL_CONTRACT_GENERATION,
      durableInitializedHistory: row.durable_initialized_history === 1,
    });
  });
}

export function decodeDeploymentQuerySyncScopeRowResult(
  input: unknown,
): Result.Result<
  DeploymentQuerySyncStoredScopeState,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape("scope", decodeRawScopeRow(input));
    if (row.singleton !== 1) {
      return yield* Result.fail(rowCodecError(
        "scope",
        "valueInvalid",
        "singleton",
      ));
    }
    const scopeUuid = yield* decodeSchemaValue(
      "scope",
      "scope_uuid",
      decodeScopeUuid(row.scope_uuid),
    );
    const epochUuid = yield* decodeSchemaValue(
      "scope",
      "epoch_uuid",
      decodeEpochUuid(row.epoch_uuid),
    );
    const storageGeneration = yield* decodeSchemaValue(
      "scope",
      "storage_generation",
      decodeStorageGeneration(row.storage_generation),
    );
    const storageGenerationFence = yield* decodeSchemaValue(
      "scope",
      "storage_generation_fence",
      decodeStorageGenerationFence(row.storage_generation_fence),
    );
    const namespaceId = yield* captureCanonicalValue(
      "scope",
      "scope_uuid",
      captureSyncNamespaceId(scopeUuid),
    );
    const sourceEpoch = yield* captureCanonicalValue(
      "scope",
      "epoch_uuid",
      captureSyncEpoch(epochUuid),
    );
    const syncModelId = yield* captureCanonicalValue(
      "scope",
      "sync_model_id",
      captureSyncModelId(row.sync_model_id),
    );
    const appliedThroughSequence = yield* decodeSyncSequence(
      "scope",
      "applied_through_sequence",
      row.applied_through_sequence,
    );
    const cursor = yield* captureCanonicalValue(
      "scope",
      "applied_through_sequence",
      captureNamespaceCursor({
        namespaceId,
        syncModelId,
        sourceEpoch,
        appliedThroughSequence,
      }),
    );
    const revision = yield* decodeWorkRevision(row.evaluation_work_revision);
    const fairnessAnchor = row.fairness_anchor === null
      ? null
      : yield* captureCanonicalValue(
        "scope",
        "fairness_anchor",
        captureCanonicalQueryKey(row.fairness_anchor),
      );
    const metrics = Object.freeze({
      queryCount: yield* decodeBoundedCounter(
        "query_count",
        row.query_count,
        MAX_REFERENCE_QUERIES,
      ),
      retainedIdentityBytes: yield* decodeBoundedCounter(
        "retained_identity_bytes",
        row.retained_identity_bytes,
        MAX_RETAINED_QUERY_IDENTITY_BYTES,
      ),
      dependencyMemberships: yield* decodeBoundedCounter(
        "dependency_memberships",
        row.dependency_memberships,
        MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
      ),
      pendingPublicationCount: yield* decodeBoundedCounter(
        "pending_publication_count",
        row.pending_publication_count,
        MAX_PENDING_PUBLICATIONS,
      ),
      inFlightPublicationCount: yield* decodeBoundedCounter(
        "in_flight_publication_count",
        row.in_flight_publication_count,
        MAX_IN_FLIGHT_PUBLICATION_COUNT,
      ),
      retainedPublicationContentBytes: yield* decodeBoundedCounter(
        "retained_publication_content_bytes",
        row.retained_publication_content_bytes,
        MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
      ),
      settlementEnvelopeBytes: yield* decodeBoundedCounter(
        "settlement_envelope_bytes",
        row.settlement_envelope_bytes,
        PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
      ),
      countedCanonicalBytes: yield* decodeBoundedCounter(
        "counted_canonical_bytes",
        row.counted_canonical_bytes,
        MAX_COUNTED_CANONICAL_BYTES,
      ),
    });
    const facts: QuerySyncScopeFacts = Object.freeze({
      cursor,
      evaluationWork: Object.freeze({ revision, fairnessAnchor }),
      metrics,
    });
    return Object.freeze({
      scopeUuid,
      epochUuid,
      storageGeneration,
      storageGenerationFence,
      syncModelId,
      facts,
    });
  });
}

export function decodeDeploymentQuerySyncQueryRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<BeginQueryFacts, DeploymentQuerySyncRowCodecError> {
  return Result.gen(function* () {
    const row = yield* decodeShape("query", decodeRawQueryRow(input));
    const descriptor = yield* captureStoredQueryDescriptor(
      row.query_key,
      row.query_identity,
    );

    let active: ActiveQueryScalarFacts | null;
    if (row.active_generation === null) {
      if (!activeGroupIsAbsent(row)) {
        return yield* Result.fail(rowCodecError(
          "query",
          "activeGroupInvalid",
          null,
        ));
      }
      active = null;
    } else {
      if (
        row.active_evaluation_snapshot_sequence === null
        || row.active_fresh_through_sequence === null
        || row.active_result_digest === null
        || row.active_authority_witness === null
      ) {
        return yield* Result.fail(rowCodecError(
          "query",
          "activeGroupInvalid",
          null,
        ));
      }
      active = yield* decodeRequiredActiveFacts("query", {
        active_generation: row.active_generation,
        active_evaluation_snapshot_sequence:
          row.active_evaluation_snapshot_sequence,
        active_fresh_through_sequence: row.active_fresh_through_sequence,
        active_dirty_through_sequence: row.active_dirty_through_sequence,
        active_result_digest: row.active_result_digest,
        active_authority_witness: row.active_authority_witness,
      }, scope);
    }

    const provisionalAbsent = row.provisional_generation === null;
    if (
      provisionalAbsent
      && (
        row.provisional_expected_active_generation !== null
        || row.provisional_registration_sequence !== null
        || row.provisional_requested_dirty_through_sequence !== null
        || row.provisional_disposition !== null
      )
    ) {
      return yield* Result.fail(rowCodecError(
        "query",
        "provisionalGroupInvalid",
        null,
      ));
    }
    let provisional: BeginQueryFacts["provisional"] = null;
    if (!provisionalAbsent) {
      if (
        row.provisional_generation === null
        || row.provisional_registration_sequence === null
        || (
          row.provisional_disposition !== "ready"
          && row.provisional_disposition !== "blocked"
        )
      ) {
        return yield* Result.fail(rowCodecError(
          "query",
          "provisionalGroupInvalid",
          null,
        ));
      }
      const registrationSequence = yield* decodeSyncSequence(
        "query",
        "provisional_registration_sequence",
        row.provisional_registration_sequence,
      );
      const registrationCursor = yield* captureCanonicalValue(
        "query",
        "provisional_registration_sequence",
        captureNamespaceCursor({
          namespaceId: scope.cursor.namespaceId,
          syncModelId: scope.cursor.syncModelId,
          sourceEpoch: scope.cursor.sourceEpoch,
          appliedThroughSequence: registrationSequence,
        }),
      );
      provisional = Object.freeze({
        generation: yield* decodeQueryGeneration(
          "query",
          "provisional_generation",
          row.provisional_generation,
        ),
        expectedActiveGeneration: yield* decodeNullableQueryGeneration(
          "query",
          "provisional_expected_active_generation",
          row.provisional_expected_active_generation,
        ),
        registrationCursor,
        requestedDirtyThroughSequence: yield* decodeNullableSyncSequence(
          "query",
          "provisional_requested_dirty_through_sequence",
          row.provisional_requested_dirty_through_sequence,
        ),
        evaluationDisposition: row.provisional_disposition === "ready"
          ? readyQueryEvaluationDisposition()
          : blockedQueryEvaluationDisposition(),
      });
      if (!provisionalFactsValid(scope, active, provisional)) {
        return yield* Result.fail(rowCodecError(
          "query",
          "provisionalGroupInvalid",
          null,
        ));
      }
    }
    if (active === null && provisional === null) {
      return yield* Result.fail(rowCodecError(
        "query",
        "queryFactsInvalid",
        null,
      ));
    }
    return Object.freeze({ descriptor, active, provisional });
  });
}

export function decodeDeploymentQuerySyncAffectedTargetRowResult(
  input: unknown,
): Result.Result<
  AffectedActiveQueryTarget,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape(
      "affectedTarget",
      decodeRawAffectedTargetRow(input),
    );
    return Object.freeze({
      queryKey: yield* captureCanonicalValue(
        "affectedTarget",
        "query_key",
        captureCanonicalQueryKey(row.query_key),
      ),
      activeGeneration: yield* decodeQueryGeneration(
        "affectedTarget",
        "active_generation",
        row.active_generation,
      ),
    });
  });
}

export function decodeDeploymentQuerySyncAffectedActiveRowResult(
  input: unknown,
  scope: QuerySyncScopeFacts,
): Result.Result<
  AffectedActiveQueryFacts,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape(
      "affectedActive",
      decodeRawAffectedActiveRow(input),
    );
    const active = yield* decodeRequiredActiveFacts(
      "affectedActive",
      row,
      scope,
    );
    return Object.freeze({
      queryKey: yield* captureCanonicalValue(
        "affectedActive",
        "query_key",
        captureCanonicalQueryKey(row.query_key),
      ),
      ...active,
    });
  });
}

export function decodeDeploymentQuerySyncDependencyRowResult(
  input: unknown,
): Result.Result<
  DeploymentQuerySyncActiveDependency,
  DeploymentQuerySyncRowCodecError
> {
  return Result.gen(function* () {
    const row = yield* decodeShape(
      "dependency",
      decodeRawDependencyRow(input),
    );
    if (row.role !== "active") {
      return yield* Result.fail(rowCodecError(
        "dependency",
        "valueInvalid",
        "role",
      ));
    }
    return Object.freeze({
      role: "active" as const,
      queryKey: yield* captureCanonicalValue(
        "dependency",
        "query_key",
        captureCanonicalQueryKey(row.query_key),
      ),
      generation: yield* decodeQueryGeneration(
        "dependency",
        "generation",
        row.generation,
      ),
      dependencyKey: yield* captureCanonicalValue(
        "dependency",
        "dependency_key",
        captureCanonicalDependencyKey(row.dependency_key),
      ),
    });
  });
}

export function encodeDeploymentQuerySyncScopeRow(
  state: DeploymentQuerySyncStoredScopeState,
): EncodedDeploymentQuerySyncScopeRow {
  const facts = state.facts;
  return Object.freeze({
    singleton: 1,
    scope_uuid: state.scopeUuid,
    epoch_uuid: state.epochUuid,
    storage_generation: state.storageGeneration,
    storage_generation_fence: state.storageGenerationFence.toString(),
    sync_model_id: state.syncModelId,
    applied_through_sequence:
      facts.cursor.appliedThroughSequence.toString(),
    evaluation_work_revision: facts.evaluationWork.revision.toString(),
    fairness_anchor: facts.evaluationWork.fairnessAnchor,
    query_count: facts.metrics.queryCount,
    retained_identity_bytes: facts.metrics.retainedIdentityBytes,
    dependency_memberships: facts.metrics.dependencyMemberships,
    pending_publication_count: facts.metrics.pendingPublicationCount,
    in_flight_publication_count: facts.metrics.inFlightPublicationCount,
    retained_publication_content_bytes:
      facts.metrics.retainedPublicationContentBytes,
    settlement_envelope_bytes: facts.metrics.settlementEnvelopeBytes,
    counted_canonical_bytes: facts.metrics.countedCanonicalBytes,
  });
}

export function encodeDeploymentQuerySyncQueryRow(
  facts: BeginQueryFacts,
): EncodedDeploymentQuerySyncQueryRow {
  const active = facts.active;
  const provisional = facts.provisional;
  return Object.freeze({
    query_key: facts.descriptor.queryKey,
    query_identity: facts.descriptor.queryIdentity,
    active_generation: active?.generation.toString() ?? null,
    active_evaluation_snapshot_sequence:
      active?.evaluationSnapshotSequence.toString() ?? null,
    active_fresh_through_sequence:
      active?.freshThroughSequence.toString() ?? null,
    active_dirty_through_sequence:
      active?.dirtyThroughSequence?.toString() ?? null,
    active_result_digest: active?.resultDigest ?? null,
    active_authority_witness: active?.authorityWitness ?? null,
    provisional_generation: provisional?.generation.toString() ?? null,
    provisional_expected_active_generation:
      provisional?.expectedActiveGeneration?.toString() ?? null,
    provisional_registration_sequence:
      provisional?.registrationCursor.appliedThroughSequence.toString()
        ?? null,
    provisional_requested_dirty_through_sequence:
      provisional?.requestedDirtyThroughSequence?.toString() ?? null,
    provisional_disposition: provisional?.evaluationDisposition._tag ?? null,
  });
}

export function encodeDeploymentQuerySyncAffectedActiveRow(
  facts: AffectedActiveQueryFacts,
): EncodedDeploymentQuerySyncAffectedActiveRow {
  return Object.freeze({
    query_key: facts.queryKey,
    active_generation: facts.generation.toString(),
    active_evaluation_snapshot_sequence:
      facts.evaluationSnapshotSequence.toString(),
    active_fresh_through_sequence: facts.freshThroughSequence.toString(),
    active_dirty_through_sequence:
      facts.dirtyThroughSequence?.toString() ?? null,
    active_result_digest: facts.resultDigest,
    active_authority_witness: facts.authorityWitness,
  });
}

export function encodeDeploymentQuerySyncDependencyRow(
  dependency: DeploymentQuerySyncActiveDependency,
): EncodedDeploymentQuerySyncDependencyRow {
  return Object.freeze({
    role: "active",
    query_key: dependency.queryKey,
    generation: dependency.generation.toString(),
    dependency_key: dependency.dependencyKey,
  });
}
