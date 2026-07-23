import {
  decodeDeclarativeV2SemanticArtifactFrameV1,
  type DeclarativeV2SemanticArtifactAttemptFrameV1,
} from "flarex-protocol/internal/declarative-v2-semantic-artifact-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import type {
  DeploymentSqlStorage,
} from "../deployment/Store";
import { semanticArtifactV1Utf8ByteLength } from "./Bytes";

export type SemanticArtifactV1AttemptLifecycle =
  | "open"
  | "closing"
  | "finalized"
  | "abandoned";

export interface SemanticArtifactV1Budget {
  readonly calls: number;
  readonly blockBytes: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly timeMilliseconds: number;
}

export interface SemanticArtifactV1FrontierEntry {
  readonly firstBlockOrdinal: number;
  readonly blockCount: number;
  readonly firstByteOffset: number;
  readonly byteLength: number;
  readonly lineFeedCount: number;
  readonly digest: string;
}

export interface SemanticArtifactV1PendingCommand {
  readonly kind: "append" | "finalize" | "reopen" | "abandon";
  readonly commandId: string;
  readonly commandDigest: string;
  readonly admission: SemanticArtifactV1Budget;
}

export interface SemanticArtifactV1Attempt {
  readonly semanticUploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: SemanticArtifactV1AttemptLifecycle;
  readonly attemptFrameBytes: Uint8Array;
  readonly attemptCanonicalByteLength: number;
  readonly attemptSha256: string;
  readonly projectId: string;
  readonly deploymentId: string;
  readonly deploymentCreatedAt: string;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootSha256: string;
  readonly sourceSelectorSha256: string;
  readonly nextBlockOrdinal: number;
  readonly streamByteLength: number;
  readonly lineFeedCount: number;
  readonly lastBlockDigest: string | null;
  readonly lastBlockFrameByteLength: number | null;
  readonly frontier: readonly SemanticArtifactV1FrontierEntry[];
  readonly ceilings: SemanticArtifactV1Budget;
  readonly usage: SemanticArtifactV1Budget;
  readonly pendingCommand: SemanticArtifactV1PendingCommand | null;
  readonly lastCommandId: string;
  readonly lastCommandDigest: string;
  readonly lastReceipt: Readonly<Record<string, unknown>>;
  readonly completedRootDigest: string | null;
  readonly completedSelectorDigest: string | null;
}

export interface SemanticArtifactV1AttemptMutation {
  readonly semanticUploadId: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly expectedFence: number | null;
  readonly readBudget: SemanticArtifactV1AttemptReadBudget;
  readonly next: SemanticArtifactV1Attempt;
}

export interface SemanticArtifactV1AttemptReadBudget {
  readonly maximumCalls: number;
  readonly maximumStoredBytes: number;
}

export class SemanticArtifactV1AttemptStoreBudgetError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreBudgetError",
)<{
  readonly operation: "read" | "write";
  readonly semanticUploadId: string;
  readonly observed: number;
  readonly maximum: number;
}> {}

export class SemanticArtifactV1AttemptStoreConflictError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreConflictError",
)<{
  readonly semanticUploadId: string;
  readonly reason: "alreadyExists" | "notFound" | "staleFence" | "conflictingReplay";
}> {}

export class SemanticArtifactV1AttemptStoreCorruptionError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreCorruptionError",
)<{ readonly semanticUploadId: string; readonly detail: string }> {}

export class SemanticArtifactV1AttemptStoreResourceError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreResourceError",
)<{ readonly operation: "read" | "write"; readonly semanticUploadId: string }> {}

export class SemanticArtifactV1AttemptStoreSettlementUncertainError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreSettlementUncertainError",
)<{ readonly semanticUploadId: string; readonly commandId: string }> {}

export class SemanticArtifactV1AttemptStoreConfirmedRollbackError extends Data.TaggedError(
  "SemanticArtifactV1AttemptStoreConfirmedRollbackError",
)<{ readonly semanticUploadId: string; readonly commandId: string }> {}

export type SemanticArtifactV1AttemptStoreError =
  | SemanticArtifactV1AttemptStoreConflictError
  | SemanticArtifactV1AttemptStoreCorruptionError
  | SemanticArtifactV1AttemptStoreBudgetError
  | SemanticArtifactV1AttemptStoreResourceError
  | SemanticArtifactV1AttemptStoreConfirmedRollbackError
  | SemanticArtifactV1AttemptStoreSettlementUncertainError;

export interface SemanticArtifactV1TransactionStorage {
  transaction<T>(closure: () => Promise<T>): Promise<T>;
}

export interface SemanticArtifactV1AttemptStore {
  readonly read: (
    semanticUploadId: string,
    budget: SemanticArtifactV1AttemptReadBudget,
  ) => Effect.Effect<
    SemanticArtifactV1Attempt | null,
    SemanticArtifactV1AttemptStoreBudgetError |
      SemanticArtifactV1AttemptStoreCorruptionError |
      SemanticArtifactV1AttemptStoreResourceError
  >;
  readonly write: (
    mutation: SemanticArtifactV1AttemptMutation,
  ) => Effect.Effect<SemanticArtifactV1Attempt, SemanticArtifactV1AttemptStoreError>;
}

type AttemptRow = {
  semantic_upload_id: string;
  generation: number;
  mutation_fence: number;
  state: string;
  attempt_frame_hex: string;
  attempt_sha256: string;
  project_id: string;
  deployment_id: string;
  deployment_created_at: string;
  source_upload_id: string;
  source_generation: number;
  source_mutation_fence: number;
  source_root_sha256: string;
  source_selector_sha256: string;
  next_block_ordinal: number;
  stream_byte_length: number;
  line_feed_count: number;
  last_block_digest: string | null;
  last_block_frame_byte_length: number | null;
  tree_frontier_json: string;
  ceilings_json: string;
  usage_json: string;
  pending_command_json: string | null;
  last_command_id: string;
  last_command_digest: string;
  last_receipt_json: string;
  completed_root_digest: string | null;
  completed_selector_digest: string | null;
};

type AttemptMetadataRow = {
  stored_byte_length: number;
};

class StoreRollback extends Error {
  constructor(readonly failure: SemanticArtifactV1AttemptStoreError) {
    super("Semantic artifact attempt transaction rolled back.");
  }
}

const resourceCause = new WeakMap<SemanticArtifactV1AttemptStoreResourceError, unknown>();
const uncertainCause = new WeakMap<
  SemanticArtifactV1AttemptStoreSettlementUncertainError,
  unknown
>();
const rollbackCause = new WeakMap<
  SemanticArtifactV1AttemptStoreConfirmedRollbackError,
  unknown
>();

export function semanticArtifactV1AttemptStoreResourceCause(
  error: SemanticArtifactV1AttemptStoreResourceError,
): unknown {
  return resourceCause.get(error);
}

export function semanticArtifactV1AttemptStoreUncertainCause(
  error: SemanticArtifactV1AttemptStoreSettlementUncertainError,
): unknown {
  return uncertainCause.get(error);
}

export function semanticArtifactV1AttemptStoreRollbackCause(
  error: SemanticArtifactV1AttemptStoreConfirmedRollbackError,
): unknown {
  return rollbackCause.get(error);
}

export function makeSemanticArtifactV1AttemptStore(
  storage: SemanticArtifactV1TransactionStorage,
  sql: DeploymentSqlStorage,
): SemanticArtifactV1AttemptStore {
  const read = Effect.fn("SemanticArtifactV1AttemptStore.read")(
    function* (
      semanticUploadId: string,
      budget: SemanticArtifactV1AttemptReadBudget,
    ) {
      yield* validateReadBudget("read", semanticUploadId, budget, 1);
      const metadata = yield* Effect.try({
        try: () => readMetadata(sql, semanticUploadId),
        catch: cause => resourceFailure("read", semanticUploadId, cause),
      });
      if (metadata === undefined) return null;
      yield* validateReadBudget("read", semanticUploadId, budget, 2);
      yield* admitMetadata("read", semanticUploadId, metadata, budget);
      const row = yield* Effect.try({
        try: () => readRow(sql, semanticUploadId),
        catch: cause => resourceFailure("read", semanticUploadId, cause),
      });
      return row === undefined ? null : yield* decodeRow(row);
    },
  );

  const write = Effect.fn("SemanticArtifactV1AttemptStore.write")(
    (mutation: SemanticArtifactV1AttemptMutation) =>
      validateReadBudget(
        "write",
        mutation.semanticUploadId,
        mutation.readBudget,
        mutation.expectedFence === null ? 6 : 7,
      ).pipe(
        Effect.andThen(Effect.suspend(() => {
          const storedByteLength = measureAttemptStoredBytes(mutation.next);
          if (storedByteLength > mutation.readBudget.maximumStoredBytes) {
            return Effect.fail(new SemanticArtifactV1AttemptStoreBudgetError({
              operation: "write",
              semanticUploadId: mutation.semanticUploadId,
              observed: storedByteLength,
              maximum: mutation.readBudget.maximumStoredBytes,
            }));
          }
          const encodedNext = encodeRow(mutation.next);
          return Effect.uninterruptible(
            executeWrite(storage, sql, mutation, encodedNext).pipe(
              Effect.catchTag("SemanticArtifactV1AttemptStoreResourceError", primary =>
                read(mutation.semanticUploadId, {
                  maximumCalls: 2,
                  maximumStoredBytes: mutation.readBudget.maximumStoredBytes,
                }).pipe(
                  Effect.flatMap(observed => {
                    if (
                      observed !== null &&
                      observed.lastCommandId === mutation.commandId &&
                      observed.lastCommandDigest === mutation.commandDigest
                    ) return Effect.succeed(observed);
                    const uncertain =
                      new SemanticArtifactV1AttemptStoreSettlementUncertainError({
                        semanticUploadId: mutation.semanticUploadId,
                        commandId: mutation.commandId,
                      });
                    uncertainCause.set(
                      uncertain,
                      semanticArtifactV1AttemptStoreResourceCause(primary),
                    );
                    return Effect.fail(uncertain);
                  }),
                  Effect.catchTag(
                    "SemanticArtifactV1AttemptStoreResourceError",
                    secondary => {
                      return settlementUncertain(
                        mutation,
                        Object.freeze({
                          primary: semanticArtifactV1AttemptStoreResourceCause(primary),
                          secondary: semanticArtifactV1AttemptStoreResourceCause(secondary),
                        }),
                      );
                    },
                  ),
                  Effect.catchTag(
                    "SemanticArtifactV1AttemptStoreBudgetError",
                    secondary => settlementUncertain(
                      mutation,
                      Object.freeze({
                        primary: semanticArtifactV1AttemptStoreResourceCause(primary),
                        secondary,
                      }),
                    ),
                  ),
                  Effect.catchTag(
                    "SemanticArtifactV1AttemptStoreCorruptionError",
                    secondary => settlementUncertain(
                      mutation,
                      Object.freeze({
                        primary: semanticArtifactV1AttemptStoreResourceCause(primary),
                        secondary,
                      }),
                    ),
                  ),
                )
              ),
            ),
          );
        })),
      ),
  );

  return Object.freeze({ read, write });
}

function settlementUncertain(
  mutation: SemanticArtifactV1AttemptMutation,
  cause: unknown,
): Effect.Effect<never, SemanticArtifactV1AttemptStoreSettlementUncertainError> {
  const error = new SemanticArtifactV1AttemptStoreSettlementUncertainError({
    semanticUploadId: mutation.semanticUploadId,
    commandId: mutation.commandId,
  });
  uncertainCause.set(error, cause);
  return Effect.fail(error);
}

function executeWrite(
  storage: SemanticArtifactV1TransactionStorage,
  sql: DeploymentSqlStorage,
  mutation: SemanticArtifactV1AttemptMutation,
  encodedNext: readonly unknown[],
): Effect.Effect<SemanticArtifactV1Attempt, SemanticArtifactV1AttemptStoreError> {
  let callbackStarted = false;
  let callbackCompleted = false;
  return Effect.tryPromise({
    try: () => storage.transaction(async () => {
      callbackStarted = true;
      const metadata = readMetadata(sql, mutation.semanticUploadId);
      if (metadata !== undefined) {
        try {
          admitMetadataSync(
            "write",
            mutation.semanticUploadId,
            metadata,
            mutation.readBudget,
          );
        } catch (cause) {
          if (
            cause instanceof SemanticArtifactV1AttemptStoreBudgetError ||
            cause instanceof SemanticArtifactV1AttemptStoreCorruptionError
          ) {
            throw new StoreRollback(cause);
          }
          throw cause;
        }
      }
      const row = metadata === undefined
        ? undefined
        : readRow(sql, mutation.semanticUploadId);
      const current = row === undefined ? null : decodeRowSync(row);
      if (
        current !== null &&
        current.lastCommandId === mutation.commandId &&
        current.lastCommandDigest === mutation.commandDigest
      ) return current;
      if (mutation.expectedFence === null) {
        if (current !== null) {
          throw new StoreRollback(new SemanticArtifactV1AttemptStoreConflictError({
            semanticUploadId: mutation.semanticUploadId,
            reason: "alreadyExists",
          }));
        }
        insertRow(sql, encodedNext);
      } else {
        if (current === null) {
          throw new StoreRollback(new SemanticArtifactV1AttemptStoreConflictError({
            semanticUploadId: mutation.semanticUploadId,
            reason: "notFound",
          }));
        }
        if (current.mutationFence !== mutation.expectedFence) {
          throw new StoreRollback(new SemanticArtifactV1AttemptStoreConflictError({
            semanticUploadId: mutation.semanticUploadId,
            reason: "staleFence",
          }));
        }
        updateRow(sql, encodedNext, mutation.expectedFence);
      }
      const settledMetadata = readMetadata(sql, mutation.semanticUploadId);
      if (settledMetadata === undefined) {
        throw new Error("Semantic attempt write disappeared.");
      }
      try {
        admitMetadataSync(
          "write",
          mutation.semanticUploadId,
          settledMetadata,
          mutation.readBudget,
        );
      } catch (cause) {
        if (
          cause instanceof SemanticArtifactV1AttemptStoreBudgetError ||
          cause instanceof SemanticArtifactV1AttemptStoreCorruptionError
        ) {
          throw new StoreRollback(cause);
        }
        throw cause;
      }
      const settled = readRow(sql, mutation.semanticUploadId);
      if (settled === undefined) throw new Error("Semantic attempt write disappeared.");
      const decoded = decodeRowSync(settled);
      callbackCompleted = true;
      return decoded;
    }),
    catch: cause => {
      if (cause instanceof StoreRollback) return cause.failure;
      if (callbackStarted && !callbackCompleted) {
        const error = new SemanticArtifactV1AttemptStoreConfirmedRollbackError({
          semanticUploadId: mutation.semanticUploadId,
          commandId: mutation.commandId,
        });
        rollbackCause.set(error, cause);
        return error;
      }
      return resourceFailure("write", mutation.semanticUploadId, cause);
    },
  });
}

function readMetadata(
  sql: DeploymentSqlStorage,
  semanticUploadId: string,
): AttemptMetadataRow | undefined {
  return sql.exec<AttemptMetadataRow>(`
    SELECT
      length(CAST(semantic_upload_id AS BLOB)) +
      length(CAST(state AS BLOB)) +
      length(CAST(attempt_frame_hex AS BLOB)) +
      length(CAST(attempt_sha256 AS BLOB)) +
      length(CAST(project_id AS BLOB)) +
      length(CAST(deployment_id AS BLOB)) +
      length(CAST(deployment_created_at AS BLOB)) +
      length(CAST(source_upload_id AS BLOB)) +
      length(CAST(source_root_sha256 AS BLOB)) +
      length(CAST(source_selector_sha256 AS BLOB)) +
      length(CAST(tree_frontier_json AS BLOB)) +
      length(CAST(ceilings_json AS BLOB)) +
      length(CAST(usage_json AS BLOB)) +
      COALESCE(length(CAST(pending_command_json AS BLOB)), 0) +
      length(CAST(last_command_id AS BLOB)) +
      length(CAST(last_command_digest AS BLOB)) +
      length(CAST(last_receipt_json AS BLOB)) +
      COALESCE(length(CAST(last_block_digest AS BLOB)), 0) +
      COALESCE(length(CAST(completed_root_digest AS BLOB)), 0) +
      COALESCE(length(CAST(completed_selector_digest AS BLOB)), 0)
        AS stored_byte_length
    FROM semantic_artifact_upload_attempts_v1
    WHERE semantic_upload_id = ?
  `, semanticUploadId).toArray()[0];
}

function readRow(sql: DeploymentSqlStorage, semanticUploadId: string): AttemptRow | undefined {
  return sql.exec<AttemptRow>(`
    SELECT semantic_upload_id, generation, mutation_fence, state, attempt_frame_hex,
      attempt_sha256, project_id, deployment_id, deployment_created_at, source_upload_id,
      source_generation, source_mutation_fence, source_root_sha256, source_selector_sha256,
      next_block_ordinal, stream_byte_length, line_feed_count, tree_frontier_json,
      last_block_digest, last_block_frame_byte_length,
      ceilings_json, usage_json, pending_command_json, last_command_id, last_command_digest,
      last_receipt_json, completed_root_digest, completed_selector_digest
    FROM semantic_artifact_upload_attempts_v1
    WHERE semantic_upload_id = ?
  `, semanticUploadId).toArray()[0];
}

function insertRow(sql: DeploymentSqlStorage, row: readonly unknown[]): void {
  sql.exec(`
    INSERT INTO semantic_artifact_upload_attempts_v1 (
      semantic_upload_id, generation, mutation_fence, state, attempt_frame_hex,
      attempt_sha256, project_id, deployment_id, deployment_created_at, source_upload_id,
      source_generation, source_mutation_fence, source_root_sha256, source_selector_sha256,
      next_block_ordinal, stream_byte_length, line_feed_count, last_block_digest,
      last_block_frame_byte_length, tree_frontier_json, ceilings_json, usage_json,
      pending_command_json,
      last_command_id, last_command_digest,
      last_receipt_json, completed_root_digest, completed_selector_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ...row);
}

function updateRow(
  sql: DeploymentSqlStorage,
  row: readonly unknown[],
  expectedFence: number,
): void {
  sql.exec(`
    UPDATE semantic_artifact_upload_attempts_v1 SET
      generation = ?, mutation_fence = ?, state = ?, attempt_frame_hex = ?,
      attempt_sha256 = ?, project_id = ?, deployment_id = ?, deployment_created_at = ?,
      source_upload_id = ?, source_generation = ?, source_mutation_fence = ?,
      source_root_sha256 = ?, source_selector_sha256 = ?, next_block_ordinal = ?,
      stream_byte_length = ?, line_feed_count = ?, last_block_digest = ?,
      last_block_frame_byte_length = ?, tree_frontier_json = ?, ceilings_json = ?,
      usage_json = ?, pending_command_json = ?,
      last_command_id = ?,
      last_command_digest = ?, last_receipt_json = ?, completed_root_digest = ?,
      completed_selector_digest = ?
    WHERE semantic_upload_id = ? AND mutation_fence = ?
  `, ...row.slice(1), row[0], expectedFence);
}

function encodeRow(attempt: SemanticArtifactV1Attempt): readonly unknown[] {
  return [
    attempt.semanticUploadId,
    attempt.generation,
    attempt.mutationFence,
    attempt.state,
    encodeBytesToLowercaseHex(attempt.attemptFrameBytes),
    attempt.attemptSha256,
    attempt.projectId,
    attempt.deploymentId,
    attempt.deploymentCreatedAt,
    attempt.sourceUploadId,
    attempt.sourceGeneration,
    attempt.sourceMutationFence,
    attempt.sourceRootSha256,
    attempt.sourceSelectorSha256,
    attempt.nextBlockOrdinal,
    attempt.streamByteLength,
    attempt.lineFeedCount,
    attempt.lastBlockDigest,
    attempt.lastBlockFrameByteLength,
    JSON.stringify(attempt.frontier),
    JSON.stringify(attempt.ceilings),
    JSON.stringify(attempt.usage),
    attempt.pendingCommand === null ? null : JSON.stringify(attempt.pendingCommand),
    attempt.lastCommandId,
    attempt.lastCommandDigest,
    JSON.stringify(attempt.lastReceipt),
    attempt.completedRootDigest,
    attempt.completedSelectorDigest,
  ];
}

function measureAttemptStoredBytes(attempt: SemanticArtifactV1Attempt): number {
  const id = attempt.semanticUploadId;
  const textValues = [
    attempt.semanticUploadId,
    attempt.state,
    attempt.attemptSha256,
    attempt.projectId,
    attempt.deploymentId,
    attempt.deploymentCreatedAt,
    attempt.sourceUploadId,
    attempt.sourceRootSha256,
    attempt.sourceSelectorSha256,
    attempt.lastBlockDigest,
    attempt.lastCommandId,
    attempt.lastCommandDigest,
    attempt.completedRootDigest,
    attempt.completedSelectorDigest,
  ];
  let total = checkedStoredAdd(
    id,
    0,
    checkedStoredMultiply(id, attempt.attemptFrameBytes.byteLength, 2),
  );
  for (const value of textValues) {
    if (value === null) continue;
    total = checkedStoredAdd(
      id,
      total,
      semanticArtifactV1Utf8ByteLength(value),
    );
  }
  for (const value of [
    attempt.frontier,
    attempt.ceilings,
    attempt.usage,
    attempt.pendingCommand,
    attempt.lastReceipt,
  ]) {
    if (value === null) continue;
    total = checkedStoredAdd(id, total, jsonUtf8ByteLength(value, new Set()));
  }
  return total;
}

function decodeRow(
  row: AttemptRow,
): Effect.Effect<SemanticArtifactV1Attempt, SemanticArtifactV1AttemptStoreCorruptionError> {
  return Effect.try({
    try: () => decodeRowSync(row),
    catch: cause => cause instanceof SemanticArtifactV1AttemptStoreCorruptionError
      ? cause
      : corrupt(row.semantic_upload_id, "stored attempt row is malformed"),
  });
}

function decodeRowSync(row: AttemptRow): SemanticArtifactV1Attempt {
  if (
    !isNonEmptyString(row.semantic_upload_id) ||
    !isPositiveSafeInteger(row.generation) ||
    !isNonNegativeSafeInteger(row.mutation_fence) ||
    !lifecycle(row.state) ||
    !lowerHex(row.attempt_frame_hex) ||
    !digest(row.attempt_sha256) ||
    !isNonEmptyString(row.project_id) ||
    !isNonEmptyString(row.deployment_id) ||
    !isNonEmptyString(row.deployment_created_at) ||
    !isNonEmptyString(row.source_upload_id) ||
    !isPositiveSafeInteger(row.source_generation) ||
    !isNonNegativeSafeInteger(row.source_mutation_fence) ||
    !digest(row.source_root_sha256) ||
    !digest(row.source_selector_sha256) ||
    !isNonNegativeSafeInteger(row.next_block_ordinal) ||
    !isNonNegativeSafeInteger(row.stream_byte_length) ||
    !isNonNegativeSafeInteger(row.line_feed_count) ||
    !(row.last_block_digest === null || digest(row.last_block_digest)) ||
    !(row.last_block_frame_byte_length === null ||
      isPositiveSafeInteger(row.last_block_frame_byte_length)) ||
    !isNonEmptyString(row.last_command_id) ||
    !digest(row.last_command_digest) ||
    !(row.completed_root_digest === null || digest(row.completed_root_digest)) ||
    !(row.completed_selector_digest === null || digest(row.completed_selector_digest))
  ) throw corrupt(row.semantic_upload_id, "stored scalar evidence is invalid");
  const attemptFrameBytes = decodeHex(row.attempt_frame_hex);
  const decoded = decodeDeclarativeV2SemanticArtifactFrameV1(attemptFrameBytes, {
    maximumFrameBytes: attemptFrameBytes.byteLength,
    maximumCanonicalBytes: attemptFrameBytes.byteLength,
  });
  if (Result.isFailure(decoded) || decoded.success.value.kind !== "semantic_attempt") {
    throw corrupt(row.semantic_upload_id, "stored attempt frame is invalid");
  }
  const frame = decoded.success.value;
  verifyNormalized(row, frame);
  const frontier = decodeFrontier(row.semantic_upload_id, parseJson(row.tree_frontier_json));
  const ceilings = decodeBudget(row.semantic_upload_id, parseJson(row.ceilings_json));
  const usage = decodeBudget(row.semantic_upload_id, parseJson(row.usage_json));
  const pendingCommand = row.pending_command_json === null
    ? null
    : decodePending(row.semantic_upload_id, parseJson(row.pending_command_json));
  const lastReceipt = parseJson(row.last_receipt_json);
  if (!isNonArrayRecord(lastReceipt)) {
    throw corrupt(row.semantic_upload_id, "stored receipt is invalid");
  }
  if (
    row.state === "finalized"
      ? row.completed_root_digest === null || row.completed_selector_digest === null ||
        pendingCommand !== null
      : row.completed_root_digest !== null || row.completed_selector_digest !== null
  ) throw corrupt(row.semantic_upload_id, "stored lifecycle evidence is inconsistent");
  if (
    (row.state === "closing" &&
      (pendingCommand === null || pendingCommand.kind !== "finalize")) ||
    (row.state === "open" &&
      pendingCommand !== null && pendingCommand.kind !== "append") ||
    ((row.state === "finalized" || row.state === "abandoned") &&
      pendingCommand !== null)
  ) throw corrupt(row.semantic_upload_id, "stored pending command is inconsistent");
  if (
    row.next_block_ordinal === 0
      ? row.stream_byte_length !== 0 || row.line_feed_count !== 0 ||
        row.last_block_digest !== null || row.last_block_frame_byte_length !== null ||
        frontier.length !== 0
      : row.stream_byte_length === 0 || row.last_block_digest === null ||
        row.last_block_frame_byte_length === null || frontier.length === 0
  ) throw corrupt(row.semantic_upload_id, "stored stream progress is inconsistent");
  let frontierBlocks = 0;
  let frontierBytes = 0;
  let frontierLineFeeds = 0;
  for (const entry of frontier) {
    if (
      entry.firstBlockOrdinal !== frontierBlocks ||
      entry.firstByteOffset !== frontierBytes
    ) throw corrupt(row.semantic_upload_id, "stored frontier ranges are not contiguous");
    frontierBlocks = checkedStoredAdd(row.semantic_upload_id, frontierBlocks, entry.blockCount);
    frontierBytes = checkedStoredAdd(row.semantic_upload_id, frontierBytes, entry.byteLength);
    frontierLineFeeds = checkedStoredAdd(
      row.semantic_upload_id,
      frontierLineFeeds,
      entry.lineFeedCount,
    );
  }
  if (
    frontierBlocks !== row.next_block_ordinal ||
    frontierBytes !== row.stream_byte_length ||
    frontierLineFeeds !== row.line_feed_count
  ) throw corrupt(row.semantic_upload_id, "stored frontier totals are inconsistent");
  return Object.freeze({
    semanticUploadId: row.semantic_upload_id,
    generation: row.generation,
    mutationFence: row.mutation_fence,
    state: row.state,
    attemptFrameBytes,
    attemptCanonicalByteLength: decoded.success.usage.canonicalBytes,
    attemptSha256: row.attempt_sha256,
    projectId: row.project_id,
    deploymentId: row.deployment_id,
    deploymentCreatedAt: row.deployment_created_at,
    sourceUploadId: row.source_upload_id,
    sourceGeneration: row.source_generation,
    sourceMutationFence: row.source_mutation_fence,
    sourceRootSha256: row.source_root_sha256,
    sourceSelectorSha256: row.source_selector_sha256,
    nextBlockOrdinal: row.next_block_ordinal,
    streamByteLength: row.stream_byte_length,
    lineFeedCount: row.line_feed_count,
    lastBlockDigest: row.last_block_digest,
    lastBlockFrameByteLength: row.last_block_frame_byte_length,
    frontier,
    ceilings,
    usage,
    pendingCommand,
    lastCommandId: row.last_command_id,
    lastCommandDigest: row.last_command_digest,
    lastReceipt: Object.freeze({ ...lastReceipt }),
    completedRootDigest: row.completed_root_digest,
    completedSelectorDigest: row.completed_selector_digest,
  });
}

function verifyNormalized(row: AttemptRow, frame: DeclarativeV2SemanticArtifactAttemptFrameV1): void {
  if (
    frame.projectId !== row.project_id ||
    frame.deploymentId !== row.deployment_id ||
    frame.deploymentCreatedAt !== row.deployment_created_at ||
    frame.semanticUploadId !== row.semantic_upload_id ||
    frame.sourceUploadId !== row.source_upload_id ||
    frame.sourceGeneration !== BigInt(row.source_generation) ||
    frame.sourceMutationFence !== BigInt(row.source_mutation_fence) ||
    frame.semanticGeneration !== BigInt(row.generation) ||
    frame.semanticMutationFence !== BigInt(row.mutation_fence) ||
    encodeBytesToLowercaseHex(frame.sourceRootSha256) !== row.source_root_sha256 ||
    encodeBytesToLowercaseHex(frame.sourceSelectorSha256) !== row.source_selector_sha256
  ) throw corrupt(row.semantic_upload_id, "normalized columns disagree with canonical frame");
}

function decodeBudget(id: string, value: unknown): SemanticArtifactV1Budget {
  if (
    !isNonArrayRecord(value) ||
    !isNonNegativeSafeInteger(value.calls) ||
    !isNonNegativeSafeInteger(value.blockBytes) ||
    !isNonNegativeSafeInteger(value.canonicalBytes) ||
    !isNonNegativeSafeInteger(value.frameBytes) ||
    !isNonNegativeSafeInteger(value.hashBytes) ||
    !isNonNegativeSafeInteger(value.timeMilliseconds)
  ) throw corrupt(id, "stored budget is invalid");
  return Object.freeze({
    calls: value.calls,
    blockBytes: value.blockBytes,
    canonicalBytes: value.canonicalBytes,
    frameBytes: value.frameBytes,
    hashBytes: value.hashBytes,
    timeMilliseconds: value.timeMilliseconds,
  });
}

function decodeFrontier(id: string, value: unknown): readonly SemanticArtifactV1FrontierEntry[] {
  if (!Array.isArray(value)) throw corrupt(id, "stored frontier is invalid");
  return Object.freeze(value.map(item => {
    if (
      !isNonArrayRecord(item) ||
      !isNonNegativeSafeInteger(item.firstBlockOrdinal) ||
      !isPositiveSafeInteger(item.blockCount) ||
      !isNonNegativeSafeInteger(item.firstByteOffset) ||
      !isNonNegativeSafeInteger(item.byteLength) ||
      !isNonNegativeSafeInteger(item.lineFeedCount) ||
      !digest(item.digest)
    ) throw corrupt(id, "stored frontier entry is invalid");
    return Object.freeze({
      firstBlockOrdinal: item.firstBlockOrdinal,
      blockCount: item.blockCount,
      firstByteOffset: item.firstByteOffset,
      byteLength: item.byteLength,
      lineFeedCount: item.lineFeedCount,
      digest: item.digest,
    });
  }));
}

function decodePending(id: string, value: unknown): SemanticArtifactV1PendingCommand {
  if (
    !isNonArrayRecord(value) ||
    !(value.kind === "append" || value.kind === "finalize" ||
      value.kind === "reopen" || value.kind === "abandon") ||
    !isNonEmptyString(value.commandId) ||
    !digest(value.commandDigest)
  ) throw corrupt(id, "stored pending command is invalid");
  return Object.freeze({
    kind: value.kind,
    commandId: value.commandId,
    commandDigest: value.commandDigest,
    admission: decodeBudget(id, value.admission),
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function checkedStoredAdd(id: string, left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw corrupt(id, "stored counter overflow");
  return value;
}

function checkedStoredMultiply(id: string, value: number, multiplier: number): number {
  const multiplied = value * multiplier;
  if (!Number.isSafeInteger(multiplied)) throw corrupt(id, "stored counter overflow");
  return multiplied;
}

function jsonUtf8ByteLength(value: unknown, seen: Set<object>): number {
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 4;
    return semanticArtifactV1Utf8ByteLength(Object.is(value, -0) ? "0" : String(value));
  }
  if (typeof value === "string") return jsonStringUtf8ByteLength(value);
  if (typeof value !== "object") {
    throw new Error("Semantic artifact stored JSON contains an unsupported value.");
  }
  if (seen.has(value)) {
    throw new Error("Semantic artifact stored JSON contains a cycle.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let total = 2;
      for (let index = 0; index < value.length; index += 1) {
        if (index > 0) total = checkedJsonAdd(total, 1);
        const item = value[index];
        total = checkedJsonAdd(
          total,
          item === undefined || typeof item === "function" || typeof item === "symbol"
            ? 4
            : jsonUtf8ByteLength(item, seen),
        );
      }
      return total;
    }
    const keys = Object.keys(value);
    let total = 2;
    let emitted = 0;
    for (const key of keys) {
      const item = (value as Readonly<Record<string, unknown>>)[key];
      if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
      if (emitted > 0) total = checkedJsonAdd(total, 1);
      total = checkedJsonAdd(total, jsonStringUtf8ByteLength(key));
      total = checkedJsonAdd(total, 1);
      total = checkedJsonAdd(total, jsonUtf8ByteLength(item, seen));
      emitted += 1;
    }
    return total;
  } finally {
    seen.delete(value);
  }
}

function jsonStringUtf8ByteLength(value: string): number {
  let total = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      total = checkedJsonAdd(total, 2);
      continue;
    }
    if (code < 0x20) {
      total = checkedJsonAdd(total, 6);
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = index + 1 < value.length ? value.charCodeAt(index + 1) : -1;
      if (low >= 0xdc00 && low <= 0xdfff) {
        total = checkedJsonAdd(total, 4);
        index += 1;
      } else {
        total = checkedJsonAdd(total, 6);
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      total = checkedJsonAdd(total, 6);
      continue;
    }
    total = checkedJsonAdd(total, code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3);
  }
  return total;
}

function checkedJsonAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    throw new Error("Semantic artifact stored JSON byte accounting overflow.");
  }
  return total;
}

function decodeHex(value: string): Uint8Array {
  const output = new Uint8Array(value.length / 2);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

function lifecycle(value: unknown): value is SemanticArtifactV1AttemptLifecycle {
  return value === "open" || value === "closing" ||
    value === "finalized" || value === "abandoned";
}

function lowerHex(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length % 2 === 0 && /^[0-9a-f]+$/.test(value);
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validateReadBudget(
  operation: "read" | "write",
  semanticUploadId: string,
  budget: SemanticArtifactV1AttemptReadBudget,
  requiredCalls: number,
): Effect.Effect<void, SemanticArtifactV1AttemptStoreBudgetError> {
  if (
    !isNonArrayRecord(budget) ||
    !isNonNegativeSafeInteger(budget.maximumCalls) ||
    !isNonNegativeSafeInteger(budget.maximumStoredBytes)
  ) {
    return Effect.fail(new SemanticArtifactV1AttemptStoreBudgetError({
      operation,
      semanticUploadId,
      observed: 0,
      maximum: 0,
    }));
  }
  return requiredCalls <= budget.maximumCalls
    ? Effect.void
    : Effect.fail(new SemanticArtifactV1AttemptStoreBudgetError({
      operation,
      semanticUploadId,
      observed: requiredCalls,
      maximum: budget.maximumCalls,
    }));
}

function admitMetadata(
  operation: "read" | "write",
  semanticUploadId: string,
  metadata: AttemptMetadataRow,
  budget: SemanticArtifactV1AttemptReadBudget,
): Effect.Effect<
  void,
  SemanticArtifactV1AttemptStoreBudgetError | SemanticArtifactV1AttemptStoreCorruptionError
> {
  try {
    admitMetadataSync(operation, semanticUploadId, metadata, budget);
    return Effect.void;
  } catch (cause) {
    return cause instanceof SemanticArtifactV1AttemptStoreBudgetError ||
        cause instanceof SemanticArtifactV1AttemptStoreCorruptionError
      ? Effect.fail(cause)
      : Effect.die(cause);
  }
}

function admitMetadataSync(
  operation: "read" | "write",
  semanticUploadId: string,
  metadata: AttemptMetadataRow,
  budget: SemanticArtifactV1AttemptReadBudget,
): void {
  if (!isNonNegativeSafeInteger(metadata.stored_byte_length)) {
    throw corrupt(semanticUploadId, "stored byte length metadata is invalid");
  }
  if (metadata.stored_byte_length > budget.maximumStoredBytes) {
    throw new SemanticArtifactV1AttemptStoreBudgetError({
      operation,
      semanticUploadId,
      observed: metadata.stored_byte_length,
      maximum: budget.maximumStoredBytes,
    });
  }
}

function corrupt(
  semanticUploadId: string,
  detail: string,
): SemanticArtifactV1AttemptStoreCorruptionError {
  return new SemanticArtifactV1AttemptStoreCorruptionError({ semanticUploadId, detail });
}

function resourceFailure(
  operation: SemanticArtifactV1AttemptStoreResourceError["operation"],
  semanticUploadId: string,
  cause: unknown,
): SemanticArtifactV1AttemptStoreResourceError {
  const error = new SemanticArtifactV1AttemptStoreResourceError({
    operation,
    semanticUploadId,
  });
  resourceCause.set(error, cause);
  return error;
}
