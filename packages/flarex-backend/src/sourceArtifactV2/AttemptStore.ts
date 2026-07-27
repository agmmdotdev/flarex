import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";
import type {
  DeploymentSqlStorage,
} from "../deployment/Store";

export interface SourceArtifactV2TransactionStorage {
  transaction<T>(closure: () => Promise<T>): Promise<T>;
}

export type SourceArtifactV2AttemptLifecycle =
  | "open"
  | "closing"
  | "finalized"
  | "abandoned";

export interface SourceArtifactV2TreeFrontierEntry {
  readonly firstOrdinal: number;
  readonly count: number;
  readonly digest: string;
}

export interface SourceArtifactV2StreamProgress {
  readonly blockCount: number;
  readonly byteLength: number;
  readonly frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>;
}

export interface SourceArtifactV2CurrentModule {
  readonly path: string;
  readonly roles: number;
  readonly source: SourceArtifactV2StreamProgress;
  readonly sourceMap: SourceArtifactV2StreamProgress;
  readonly sourceMapStarted: boolean;
}

export interface SourceArtifactV2Counters {
  readonly moduleCount: number;
  readonly functionModuleCount: number;
  readonly sourceByteLength: number;
  readonly sourceMapByteLength: number;
  readonly executionPath: string | null;
  readonly schemaPath: string | null;
  readonly authPath: string | null;
}

export interface SourceArtifactV2ResourceBudget {
  readonly calls: number;
  readonly blockBytes: number;
  readonly modules: number;
  readonly sourceMaps: number;
  readonly canonicalBytes: number;
  readonly frameBytes: number;
  readonly hashBytes: number;
  readonly timeMilliseconds: number;
}

export interface SourceArtifactV2Attempt {
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: SourceArtifactV2AttemptLifecycle;
  readonly nextModuleOrdinal: number;
  readonly lastModulePath: string | null;
  readonly currentModule: SourceArtifactV2CurrentModule | null;
  readonly moduleFrontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>;
  readonly counters: SourceArtifactV2Counters;
  readonly ceilings: SourceArtifactV2ResourceBudget;
  readonly usage: SourceArtifactV2ResourceBudget;
  readonly pendingCommand: SourceArtifactV2PendingCommand | null;
  readonly lastCommandId: string;
  readonly lastCommandDigest: string;
  readonly lastReceipt: Readonly<Record<string, unknown>>;
  readonly completedRootDigest: string | null;
  readonly completedSelectorDigest: string | null;
}

export interface SourceArtifactV2PendingCommand {
  readonly kind:
    | "beginUpload"
    | "beginModule"
    | "appendBlock"
    | "closeModule"
    | "finalize"
    | "reopen"
    | "abandon";
  readonly commandId: string;
  readonly commandDigest: string | null;
  readonly admission: SourceArtifactV2ResourceBudget;
}

export class SourceArtifactV2AttemptStoreConflictError extends Data.TaggedError(
  "SourceArtifactV2AttemptStoreConflictError",
)<{
  readonly uploadId: string;
  readonly reason:
    | "alreadyExists"
    | "notFound"
    | "staleFence"
    | "conflictingReplay";
}> {}

export class SourceArtifactV2AttemptStoreCorruptionError extends Data.TaggedError(
  "SourceArtifactV2AttemptStoreCorruptionError",
)<{
  readonly uploadId: string;
  readonly detail: string;
}> {}

export class SourceArtifactV2AttemptStoreResourceError extends Data.TaggedError(
  "SourceArtifactV2AttemptStoreResourceError",
)<{
  readonly operation: "read" | "write";
  readonly uploadId: string;
}> {}

export class SourceArtifactV2AttemptStoreSettlementUncertainError extends Data.TaggedError(
  "SourceArtifactV2AttemptStoreSettlementUncertainError",
)<{
  readonly uploadId: string;
  readonly commandId: string;
}> {}

export type SourceArtifactV2AttemptStoreError =
  | SourceArtifactV2AttemptStoreConflictError
  | SourceArtifactV2AttemptStoreCorruptionError
  | SourceArtifactV2AttemptStoreResourceError
  | SourceArtifactV2AttemptStoreSettlementUncertainError;

export type SourceArtifactV2AttemptReaderError =
  | SourceArtifactV2AttemptStoreCorruptionError
  | SourceArtifactV2AttemptStoreResourceError;

export interface SourceArtifactV2AttemptReadBudget {
  readonly maximumCalls: number;
  readonly maximumStoredBytes: number;
}

export class SourceArtifactV2AttemptStoreBudgetError extends Data.TaggedError(
  "SourceArtifactV2AttemptStoreBudgetError",
)<{
  readonly uploadId: string;
  readonly dimension: "calls" | "storedBytes";
  readonly observed: number;
  readonly maximum: number;
}> {}

export type SourceArtifactV2BoundedAttemptReaderError =
  | SourceArtifactV2AttemptStoreBudgetError
  | SourceArtifactV2AttemptReaderError;

export type SourceArtifactV2AttemptMutation = Readonly<{
  readonly uploadId: string;
  readonly commandId: string;
  readonly commandDigest: string;
  readonly expectedFence: number | null;
  readonly next: SourceArtifactV2Attempt;
}>;

export interface SourceArtifactV2AttemptStore {
  readonly read: (
    uploadId: string,
  ) => Effect.Effect<SourceArtifactV2Attempt | null, SourceArtifactV2AttemptReaderError>;
  readonly write: (
    mutation: SourceArtifactV2AttemptMutation,
  ) => Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError>;
}

export interface SourceArtifactV2AttemptReader {
  readonly read: (
    uploadId: string,
  ) => Effect.Effect<SourceArtifactV2Attempt | null, SourceArtifactV2AttemptReaderError>;
}

export interface SourceArtifactV2BoundedAttemptReader {
  readonly read: (
    uploadId: string,
    budget: SourceArtifactV2AttemptReadBudget,
  ) => Effect.Effect<
    SourceArtifactV2Attempt | null,
    SourceArtifactV2BoundedAttemptReaderError
  >;
}

export type SourceArtifactV2AttemptReadSql = Pick<DeploymentSqlStorage, "exec">;

type SourceArtifactV2AttemptRow = {
  readonly upload_id: string;
  readonly generation: number;
  readonly mutation_fence: number;
  readonly state: string;
  readonly next_module_ordinal: number;
  readonly last_module_path: string | null;
  readonly current_module_json: string | null;
  readonly module_frontier_json: string;
  readonly counters_json: string;
  readonly ceilings_json: string;
  readonly usage_json: string;
  readonly pending_command_json: string | null;
  readonly last_command_id: string;
  readonly last_command_digest: string;
  readonly last_receipt_json: string;
  readonly completed_root_digest: string | null;
  readonly completed_selector_digest: string | null;
};

type SourceArtifactV2AttemptMetadataRow = {
  readonly stored_byte_length: number;
};

class SourceArtifactV2AttemptStoreRollback extends Error {
  constructor(readonly failure: SourceArtifactV2AttemptStoreError) {
    super("Source-artifact upload attempt transaction rolled back.");
  }
}

const resourceCause = new WeakMap<SourceArtifactV2AttemptStoreResourceError, unknown>();
const uncertainCause = new WeakMap<SourceArtifactV2AttemptStoreSettlementUncertainError, unknown>();
const UNPREPARED_COMMAND_DIGEST = "0".repeat(64);

export function sourceArtifactV2AttemptStoreResourceCause(
  error: SourceArtifactV2AttemptStoreResourceError,
): unknown {
  return resourceCause.get(error);
}

export function sourceArtifactV2AttemptStoreUncertainCause(
  error: SourceArtifactV2AttemptStoreSettlementUncertainError,
): unknown {
  return uncertainCause.get(error);
}

export function makeSourceArtifactV2AttemptStore(
  storage: SourceArtifactV2TransactionStorage,
  sql: DeploymentSqlStorage,
): SourceArtifactV2AttemptStore {
  const { read } = makeSourceArtifactV2AttemptReader(sql);

  const write = Effect.fn("SourceArtifactV2AttemptStore.write")(
    function* (mutation: SourceArtifactV2AttemptMutation): Effect.fn.Return<
      SourceArtifactV2Attempt,
      SourceArtifactV2AttemptStoreError
    > {
      const first = yield* Effect.uninterruptible(executeWrite(storage, sql, mutation).pipe(
        Effect.catchTag("SourceArtifactV2AttemptStoreResourceError", error =>
          reconcileWrite(storage, sql, read, mutation, error, false)
        ),
      ));
      return first;
    },
  );

  return Object.freeze({ read, write });
}

export function makeSourceArtifactV2AttemptReader(
  sql: SourceArtifactV2AttemptReadSql,
): SourceArtifactV2AttemptReader {
  const read = Effect.fn("SourceArtifactV2AttemptStore.read")(
    function* (uploadId: string): Effect.fn.Return<
      SourceArtifactV2Attempt | null,
      SourceArtifactV2AttemptReaderError
    > {
      const row = yield* Effect.try({
        try: () => readRow(sql, uploadId),
        catch: cause => resourceFailure("read", uploadId, cause),
      });
      return row === undefined ? null : yield* decodeRow(row);
    },
  );
  return Object.freeze({ read });
}

export function makeSourceArtifactV2BoundedAttemptReader(
  sql: SourceArtifactV2AttemptReadSql,
): SourceArtifactV2BoundedAttemptReader {
  const read = Effect.fn("SourceArtifactV2AttemptStore.readBounded")(
    (
      uploadId: string,
      budget: SourceArtifactV2AttemptReadBudget,
    ): Effect.Effect<
      SourceArtifactV2Attempt | null,
      SourceArtifactV2BoundedAttemptReaderError
    > => Effect.try({
      try: () => readBoundedRowResult(sql, uploadId, budget),
      catch: cause =>
        resourceFailure("read", uploadId, cause),
    }).pipe(
      Effect.flatMap(Effect.fromResult),
      Effect.flatMap(row => row === null
        ? Effect.succeed(null)
        : decodeRow(row)),
    ),
  );
  return Object.freeze({ read });
}

function executeWrite(
  storage: SourceArtifactV2TransactionStorage,
  sql: DeploymentSqlStorage,
  mutation: SourceArtifactV2AttemptMutation,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError> {
  let callbackStarted = false;
  let callbackCompleted = false;
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => storage.transaction(async () => {
      callbackStarted = true;
      const currentRow = readRow(sql, mutation.uploadId);
      if (currentRow !== undefined) {
        const current = decodeRowSync(currentRow);
        if (
          current.lastCommandId === mutation.commandId &&
          current.lastCommandDigest === mutation.commandDigest
        ) {
          callbackCompleted = true;
          return current;
        }
        if (current.lastCommandId === mutation.commandId) {
          throw new SourceArtifactV2AttemptStoreRollback(
            new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "conflictingReplay",
            }),
          );
        }
      }
      if (mutation.expectedFence === null) {
        if (currentRow !== undefined) {
          throw new SourceArtifactV2AttemptStoreRollback(
            new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "alreadyExists",
            }),
          );
        }
        insertRow(sql, mutation.next);
      } else {
        if (currentRow === undefined) {
          throw new SourceArtifactV2AttemptStoreRollback(
            new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "notFound",
            }),
          );
        }
        const current = decodeRowSync(currentRow);
        if (current.mutationFence !== mutation.expectedFence) {
          throw new SourceArtifactV2AttemptStoreRollback(
            new SourceArtifactV2AttemptStoreConflictError({
              uploadId: mutation.uploadId,
              reason: "staleFence",
            }),
          );
        }
        updateRow(sql, mutation.next, mutation.expectedFence);
      }
      const stored = readRow(sql, mutation.uploadId);
      if (stored === undefined) {
        throw new SourceArtifactV2AttemptStoreCorruptionError({
          uploadId: mutation.uploadId,
          detail: "write did not leave an exact attempt row",
        });
      }
      const decoded = decodeRowSync(stored);
      if (
        decoded.lastCommandId !== mutation.commandId ||
        decoded.lastCommandDigest !== mutation.commandDigest
      ) {
        throw new SourceArtifactV2AttemptStoreCorruptionError({
          uploadId: mutation.uploadId,
          detail: "write did not preserve command evidence",
        });
      }
      callbackCompleted = true;
      return decoded;
    }),
    catch: cause => {
      if (cause instanceof SourceArtifactV2AttemptStoreRollback) return cause.failure;
      if (cause instanceof SourceArtifactV2AttemptStoreCorruptionError) return cause;
      return resourceFailure("write", mutation.uploadId, Object.freeze({
        callbackStarted,
        callbackCompleted,
        cause,
      }));
    },
  }));
}

function reconcileWrite(
  storage: SourceArtifactV2TransactionStorage,
  sql: DeploymentSqlStorage,
  read: SourceArtifactV2AttemptStore["read"],
  mutation: SourceArtifactV2AttemptMutation,
  primary: SourceArtifactV2AttemptStoreResourceError,
  repeated: boolean,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreError> {
  const observation = read(mutation.uploadId).pipe(
    Effect.map(observed => ({ kind: "observed" as const, observed })),
    Effect.catch(secondary => Effect.succeed({ kind: "failed" as const, secondary })),
  );
  return observation.pipe(
    Effect.flatMap(result => {
      if (result.kind === "failed") {
        const uncertain = new SourceArtifactV2AttemptStoreSettlementUncertainError({
          uploadId: mutation.uploadId,
          commandId: mutation.commandId,
        });
        uncertainCause.set(uncertain, Object.freeze({
          primary: sourceArtifactV2AttemptStoreResourceCause(primary),
          secondary: result.secondary,
        }));
        return Effect.fail(uncertain);
      }
      const observed = result.observed;
      if (
        observed !== null && observed.lastCommandId === mutation.commandId &&
        observed.lastCommandDigest === mutation.commandDigest
      ) return Effect.succeed(observed);
      const unchanged = mutation.expectedFence === null
        ? observed === null
        : observed !== null && observed.mutationFence === mutation.expectedFence;
      if (unchanged && !repeated) {
        return executeWrite(storage, sql, mutation).pipe(
          Effect.catchTag("SourceArtifactV2AttemptStoreResourceError", repeatedFailure =>
            reconcileWrite(storage, sql, read, mutation, repeatedFailure, true)
          ),
        );
      }
      const uncertain = new SourceArtifactV2AttemptStoreSettlementUncertainError({
        uploadId: mutation.uploadId,
        commandId: mutation.commandId,
      });
      uncertainCause.set(uncertain, sourceArtifactV2AttemptStoreResourceCause(primary));
      return Effect.fail(uncertain);
    }),
  );
}

function readBoundedRowResult(
  sql: SourceArtifactV2AttemptReadSql,
  uploadId: string,
  budget: SourceArtifactV2AttemptReadBudget,
): Result.Result<
  SourceArtifactV2AttemptRow | null,
  SourceArtifactV2AttemptStoreBudgetError |
    SourceArtifactV2AttemptStoreCorruptionError
> {
  return Result.gen(function* () {
    yield* admitReadBudget(uploadId, budget, 1);
    const metadata = readMetadataRow(sql, uploadId);
    if (metadata === undefined) return null;

    yield* admitReadBudget(uploadId, budget, 2);
    if (!nonNegativeSafe(metadata.stored_byte_length)) {
      return yield* Result.fail(
        corrupt(uploadId, "stored byte length metadata is invalid"),
      );
    }
    if (metadata.stored_byte_length > budget.maximumStoredBytes) {
      return yield* Result.fail(new SourceArtifactV2AttemptStoreBudgetError({
        uploadId,
        dimension: "storedBytes",
        observed: metadata.stored_byte_length,
        maximum: budget.maximumStoredBytes,
      }));
    }

    const row = readRow(sql, uploadId);
    return row === undefined
      ? yield* Result.fail(
          corrupt(uploadId, "stored attempt disappeared during bounded read"),
        )
      : row;
  });
}

function admitReadBudget(
  uploadId: string,
  budget: SourceArtifactV2AttemptReadBudget,
  observedCalls: number,
): Result.Result<void, SourceArtifactV2AttemptStoreBudgetError> {
  const maximumCalls = typeof budget === "object" &&
      budget !== null &&
      nonNegativeSafe(budget.maximumCalls)
    ? budget.maximumCalls
    : 0;
  if (maximumCalls < observedCalls) {
    return Result.fail(new SourceArtifactV2AttemptStoreBudgetError({
      uploadId,
      dimension: "calls",
      observed: observedCalls,
      maximum: maximumCalls,
    }));
  }
  if (
    typeof budget !== "object" ||
    budget === null ||
    !nonNegativeSafe(budget.maximumStoredBytes)
  ) {
    return Result.fail(new SourceArtifactV2AttemptStoreBudgetError({
      uploadId,
      dimension: "storedBytes",
      observed: 0,
      maximum: 0,
    }));
  }
  return Result.succeed(undefined);
}

function readMetadataRow(
  sql: SourceArtifactV2AttemptReadSql,
  uploadId: string,
): SourceArtifactV2AttemptMetadataRow | undefined {
  return sql.exec<SourceArtifactV2AttemptMetadataRow>(`
    SELECT
      length(CAST(upload_id AS BLOB)) +
      length(CAST(state AS BLOB)) +
      COALESCE(length(CAST(last_module_path AS BLOB)), 0) +
      COALESCE(length(CAST(current_module_json AS BLOB)), 0) +
      length(CAST(module_frontier_json AS BLOB)) +
      length(CAST(counters_json AS BLOB)) +
      length(CAST(ceilings_json AS BLOB)) +
      length(CAST(usage_json AS BLOB)) +
      COALESCE(length(CAST(pending_command_json AS BLOB)), 0) +
      length(CAST(last_command_id AS BLOB)) +
      length(CAST(last_command_digest AS BLOB)) +
      length(CAST(last_receipt_json AS BLOB)) +
      COALESCE(length(CAST(completed_root_digest AS BLOB)), 0) +
      COALESCE(length(CAST(completed_selector_digest AS BLOB)), 0)
        AS stored_byte_length
    FROM source_artifact_upload_attempts_v2
    WHERE upload_id = ?
  `, uploadId).toArray()[0];
}

function readRow(
  sql: SourceArtifactV2AttemptReadSql,
  uploadId: string,
): SourceArtifactV2AttemptRow | undefined {
  return sql.exec<SourceArtifactV2AttemptRow>(`
    SELECT
      upload_id, generation, mutation_fence, state, next_module_ordinal,
      last_module_path, current_module_json, module_frontier_json,
      counters_json, ceilings_json, usage_json, pending_command_json,
      last_command_id, last_command_digest, last_receipt_json, completed_root_digest,
      completed_selector_digest
    FROM source_artifact_upload_attempts_v2
    WHERE upload_id = ?
  `, uploadId).toArray()[0];
}

function insertRow(sql: DeploymentSqlStorage, attempt: SourceArtifactV2Attempt): void {
  const row = encodeRow(attempt);
  sql.exec(`
    INSERT INTO source_artifact_upload_attempts_v2 (
      upload_id, generation, mutation_fence, state, next_module_ordinal,
      last_module_path, current_module_json, module_frontier_json,
      counters_json, ceilings_json, usage_json, pending_command_json,
      last_command_id, last_command_digest, last_receipt_json, completed_root_digest,
      completed_selector_digest
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ...row);
}

function updateRow(
  sql: DeploymentSqlStorage,
  attempt: SourceArtifactV2Attempt,
  expectedFence: number,
): void {
  const row = encodeRow(attempt);
  sql.exec(`
    UPDATE source_artifact_upload_attempts_v2 SET
      generation = ?, mutation_fence = ?, state = ?, next_module_ordinal = ?,
      last_module_path = ?, current_module_json = ?, module_frontier_json = ?,
      counters_json = ?, ceilings_json = ?, usage_json = ?, pending_command_json = ?,
      last_command_id = ?, last_command_digest = ?, last_receipt_json = ?, completed_root_digest = ?,
      completed_selector_digest = ?
    WHERE upload_id = ? AND mutation_fence = ?
  `,
  row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9],
  row[10], row[11], row[12], row[13], row[14], row[15], row[16], row[0], expectedFence);
}

function encodeRow(attempt: SourceArtifactV2Attempt): readonly [
  string, number, number, string, number, string | null, string | null,
  string, string, string, string, string | null, string, string, string,
  string | null, string | null,
] {
  return [
    attempt.uploadId,
    attempt.generation,
    attempt.mutationFence,
    attempt.state,
    attempt.nextModuleOrdinal,
    attempt.lastModulePath,
    attempt.currentModule === null ? null : JSON.stringify(attempt.currentModule),
    JSON.stringify(attempt.moduleFrontier),
    JSON.stringify(attempt.counters),
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

function decodeRow(
  row: SourceArtifactV2AttemptRow,
): Effect.Effect<SourceArtifactV2Attempt, SourceArtifactV2AttemptStoreCorruptionError> {
  return Effect.try({
    try: () => decodeRowSync(row),
    catch: cause => cause instanceof SourceArtifactV2AttemptStoreCorruptionError
      ? cause
      : new SourceArtifactV2AttemptStoreCorruptionError({
        uploadId: row.upload_id,
        detail: "stored attempt row is malformed",
      }),
  });
}

function decodeRowSync(row: SourceArtifactV2AttemptRow): SourceArtifactV2Attempt {
  if (
    !nonEmpty(row.upload_id) || !positiveSafe(row.generation) ||
    !positiveSafe(row.mutation_fence) || !attemptState(row.state) ||
    !nonNegativeSafe(row.next_module_ordinal) ||
    !(row.last_module_path === null || nonEmpty(row.last_module_path)) ||
    !nonEmpty(row.last_command_id) ||
    !lowerHexDigest(row.last_command_digest) ||
    !(row.completed_root_digest === null || lowerHexDigest(row.completed_root_digest)) ||
    !(row.completed_selector_digest === null || lowerHexDigest(row.completed_selector_digest))
  ) throw corrupt(row.upload_id, "stored scalar evidence is invalid");
  const currentModule = row.current_module_json === null
    ? null
    : decodeCurrentModule(row.upload_id, parseJson(row.upload_id, row.current_module_json));
  const moduleFrontier = decodeFrontier(row.upload_id, parseJson(row.upload_id, row.module_frontier_json));
  const counters = decodeCounters(row.upload_id, parseJson(row.upload_id, row.counters_json));
  const ceilings = decodeResourceBudget(row.upload_id, parseJson(row.upload_id, row.ceilings_json));
  const usage = decodeResourceBudget(row.upload_id, parseJson(row.upload_id, row.usage_json));
  const pendingCommand = row.pending_command_json === null
    ? null
    : decodePendingCommand(row.upload_id, parseJson(row.upload_id, row.pending_command_json));
  const receipt = parseJson(row.upload_id, row.last_receipt_json);
  if (!isNonArrayRecord(receipt)) throw corrupt(row.upload_id, "stored receipt is invalid");
  const attempt: SourceArtifactV2Attempt = Object.freeze({
    uploadId: row.upload_id,
    generation: row.generation,
    mutationFence: row.mutation_fence,
    state: row.state,
    nextModuleOrdinal: row.next_module_ordinal,
    lastModulePath: row.last_module_path,
    currentModule,
    moduleFrontier,
    counters,
    ceilings,
    usage,
    pendingCommand,
    lastCommandId: row.last_command_id,
    lastCommandDigest: row.last_command_digest,
    lastReceipt: Object.freeze({ ...receipt }),
    completedRootDigest: row.completed_root_digest,
    completedSelectorDigest: row.completed_selector_digest,
  });
  validateAttemptInvariants(attempt);
  return attempt;
}

function validateAttemptInvariants(attempt: SourceArtifactV2Attempt): void {
  for (const resource of resourceNames()) {
    if (attempt.ceilings[resource] < 1 && resource !== "sourceMaps") {
      throw corrupt(attempt.uploadId, "stored ceiling is invalid");
    }
    if (attempt.usage[resource] > attempt.ceilings[resource]) {
      throw corrupt(attempt.uploadId, "stored usage exceeds its ceiling");
    }
  }
  if (
    attempt.nextModuleOrdinal !== attempt.counters.moduleCount ||
    attempt.counters.functionModuleCount > attempt.counters.moduleCount
  ) throw corrupt(attempt.uploadId, "stored module counters are inconsistent");
  validateFrontierCoverage(
    attempt.uploadId,
    attempt.moduleFrontier,
    attempt.counters.moduleCount,
    "module",
  );
  if ((attempt.counters.moduleCount === 0) !== (attempt.lastModulePath === null)) {
    throw corrupt(attempt.uploadId, "stored module path evidence is inconsistent");
  }
  if (attempt.currentModule !== null) {
    validateStreamProgress(attempt.uploadId, attempt.currentModule.source, "source");
    validateStreamProgress(attempt.uploadId, attempt.currentModule.sourceMap, "source map");
    if (attempt.currentModule.sourceMapStarted !== (attempt.currentModule.sourceMap.blockCount > 0)) {
      throw corrupt(attempt.uploadId, "stored source-map phase is inconsistent");
    }
    if (
      attempt.lastModulePath !== null &&
      attempt.currentModule.path <= attempt.lastModulePath
    ) throw corrupt(attempt.uploadId, "stored current-module ordering is inconsistent");
  }
  const pending = attempt.pendingCommand;
  if (pending !== null) {
    const suffix = pending.commandDigest === null ? ":reserved" : ":prepared";
    if (
      attempt.lastCommandId !== `${pending.commandId}${suffix}` ||
      attempt.lastCommandDigest !== (pending.commandDigest ?? UNPREPARED_COMMAND_DIGEST)
    ) throw corrupt(attempt.uploadId, "stored pending command evidence is inconsistent");
  }
  const hasRoot = attempt.completedRootDigest !== null;
  if (hasRoot !== (attempt.completedSelectorDigest !== null)) {
    throw corrupt(attempt.uploadId, "stored completed-root evidence is inconsistent");
  }
  if (attempt.state === "closing") {
    if (pending?.kind !== "finalize" || attempt.currentModule !== null || hasRoot) {
      throw corrupt(attempt.uploadId, "stored closing attempt is inconsistent");
    }
  } else if (attempt.state === "finalized") {
    if (
      pending !== null || attempt.currentModule !== null || !hasRoot ||
      attempt.counters.executionPath === null || attempt.counters.moduleCount === 0
    ) throw corrupt(attempt.uploadId, "stored finalized attempt is inconsistent");
  } else if (attempt.state === "abandoned") {
    if (pending !== null || hasRoot) {
      throw corrupt(attempt.uploadId, "stored abandoned attempt is inconsistent");
    }
  } else if (hasRoot) {
    throw corrupt(attempt.uploadId, "stored open attempt has completed-root evidence");
  }
}

function validateStreamProgress(
  uploadId: string,
  progress: SourceArtifactV2StreamProgress,
  label: string,
): void {
  if ((progress.blockCount === 0) !== (progress.byteLength === 0)) {
    throw corrupt(uploadId, `stored ${label} progress is inconsistent`);
  }
  validateFrontierCoverage(uploadId, progress.frontier, progress.blockCount, label);
}

function validateFrontierCoverage(
  uploadId: string,
  frontier: ReadonlyArray<SourceArtifactV2TreeFrontierEntry>,
  expectedCount: number,
  label: string,
): void {
  let nextFirst = 0;
  for (const entry of frontier) {
    if (entry.firstOrdinal !== nextFirst) {
      throw corrupt(uploadId, `stored ${label} frontier has a gap or overlap`);
    }
    nextFirst += entry.count;
    if (!Number.isSafeInteger(nextFirst)) {
      throw corrupt(uploadId, `stored ${label} frontier overflows`);
    }
  }
  if (nextFirst !== expectedCount || (expectedCount > 0 && frontier.length === 0)) {
    throw corrupt(uploadId, `stored ${label} frontier count is inconsistent`);
  }
}

function resourceNames(): ReadonlyArray<keyof SourceArtifactV2ResourceBudget> {
  return [
    "calls",
    "blockBytes",
    "modules",
    "sourceMaps",
    "canonicalBytes",
    "frameBytes",
    "hashBytes",
    "timeMilliseconds",
  ];
}

function decodePendingCommand(uploadId: string, value: unknown): SourceArtifactV2PendingCommand {
  if (
    !isNonArrayRecord(value) ||
    !pendingKind(value.kind) || !nonEmpty(value.commandId) ||
    !(value.commandDigest === null || lowerHexDigest(value.commandDigest))
  ) throw corrupt(uploadId, "stored pending command is invalid");
  return Object.freeze({
    kind: value.kind,
    commandId: value.commandId,
    commandDigest: value.commandDigest,
    admission: decodeResourceBudget(uploadId, value.admission),
  });
}

function pendingKind(value: unknown): value is SourceArtifactV2PendingCommand["kind"] {
  return value === "beginUpload" || value === "beginModule" || value === "appendBlock" ||
    value === "closeModule" || value === "finalize" || value === "reopen" ||
    value === "abandon";
}

function decodeCurrentModule(uploadId: string, value: unknown): SourceArtifactV2CurrentModule {
  if (
    !isNonArrayRecord(value) || !nonEmpty(value.path) ||
    typeof value.roles !== "number" || !positiveSafe(value.roles) || value.roles > 15 ||
    typeof value.sourceMapStarted !== "boolean"
  ) throw corrupt(uploadId, "stored current module is invalid");
  return Object.freeze({
    path: value.path,
    roles: value.roles,
    source: decodeStreamProgress(uploadId, value.source),
    sourceMap: decodeStreamProgress(uploadId, value.sourceMap),
    sourceMapStarted: value.sourceMapStarted,
  });
}

function decodeStreamProgress(uploadId: string, value: unknown): SourceArtifactV2StreamProgress {
  if (
    !isNonArrayRecord(value) || !nonNegativeSafe(value.blockCount) ||
    !nonNegativeSafe(value.byteLength)
  ) throw corrupt(uploadId, "stored stream progress is invalid");
  return Object.freeze({
    blockCount: value.blockCount,
    byteLength: value.byteLength,
    frontier: decodeFrontier(uploadId, value.frontier),
  });
}

function decodeFrontier(
  uploadId: string,
  value: unknown,
): ReadonlyArray<SourceArtifactV2TreeFrontierEntry> {
  if (!Array.isArray(value) || value.length > 53) {
    throw corrupt(uploadId, "stored tree frontier is invalid");
  }
  return Object.freeze(value.map(entry => {
    if (
      !isNonArrayRecord(entry) || !nonNegativeSafe(entry.firstOrdinal) ||
      !positiveSafe(entry.count) || !lowerHexDigest(entry.digest)
    ) throw corrupt(uploadId, "stored tree frontier entry is invalid");
    return Object.freeze({
      firstOrdinal: entry.firstOrdinal,
      count: entry.count,
      digest: entry.digest,
    });
  }));
}

function decodeCounters(uploadId: string, value: unknown): SourceArtifactV2Counters {
  if (
    !isNonArrayRecord(value) || !nonNegativeSafe(value.moduleCount) ||
    !nonNegativeSafe(value.functionModuleCount) ||
    !nonNegativeSafe(value.sourceByteLength) ||
    !nonNegativeSafe(value.sourceMapByteLength) ||
    !nullableNonEmpty(value.executionPath) || !nullableNonEmpty(value.schemaPath) ||
    !nullableNonEmpty(value.authPath)
  ) throw corrupt(uploadId, "stored counters are invalid");
  return Object.freeze({
    moduleCount: value.moduleCount,
    functionModuleCount: value.functionModuleCount,
    sourceByteLength: value.sourceByteLength,
    sourceMapByteLength: value.sourceMapByteLength,
    executionPath: value.executionPath,
    schemaPath: value.schemaPath,
    authPath: value.authPath,
  });
}

function decodeResourceBudget(uploadId: string, value: unknown): SourceArtifactV2ResourceBudget {
  if (!isNonArrayRecord(value)) throw corrupt(uploadId, "stored budget is invalid");
  if (
    !nonNegativeSafe(value.calls) || !nonNegativeSafe(value.blockBytes) ||
    !nonNegativeSafe(value.modules) || !nonNegativeSafe(value.sourceMaps) ||
    !nonNegativeSafe(value.canonicalBytes) || !nonNegativeSafe(value.frameBytes) ||
    !nonNegativeSafe(value.hashBytes) || !nonNegativeSafe(value.timeMilliseconds)
  ) throw corrupt(uploadId, "stored budget field is invalid");
  const calls = value.calls;
  const blockBytes = value.blockBytes;
  const modules = value.modules;
  const sourceMaps = value.sourceMaps;
  const canonicalBytes = value.canonicalBytes;
  const frameBytes = value.frameBytes;
  const hashBytes = value.hashBytes;
  const timeMilliseconds = value.timeMilliseconds;
  return Object.freeze({
    calls,
    blockBytes,
    modules,
    sourceMaps,
    canonicalBytes,
    frameBytes,
    hashBytes,
    timeMilliseconds,
  });
}

function parseJson(uploadId: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw corrupt(uploadId, "stored JSON is invalid");
  }
}

function resourceFailure(
  operation: SourceArtifactV2AttemptStoreResourceError["operation"],
  uploadId: string,
  cause: unknown,
): SourceArtifactV2AttemptStoreResourceError {
  const error = new SourceArtifactV2AttemptStoreResourceError({ operation, uploadId });
  resourceCause.set(error, cause);
  return error;
}

function corrupt(uploadId: string, detail: string): SourceArtifactV2AttemptStoreCorruptionError {
  return new SourceArtifactV2AttemptStoreCorruptionError({ uploadId, detail });
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function nullableNonEmpty(value: unknown): value is string | null {
  return value === null || nonEmpty(value);
}

function nonNegativeSafe(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafe(value: unknown): value is number {
  return nonNegativeSafe(value) && value > 0;
}

function lowerHexDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function attemptState(value: string): value is SourceArtifactV2AttemptLifecycle {
  return value === "open" || value === "closing" || value === "finalized" || value === "abandoned";
}
