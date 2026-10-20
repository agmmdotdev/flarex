import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { isNonBlankString } from "@flarex/utils/strings";
import { eq } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { Data, Effect, Result, Schema } from "effect";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeEpochUuidV1Schema,
  ScopeIdSchema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
  StorageGenerationSchema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type ScopeId,
} from "flarex-protocol/storage-authority";
import { TransactionAuthorizationRevocationEpochSchema } from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "../deployments";
import type { AppRowTransaction } from "../../storage/documents/appRows";
import {
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
} from "../../scope/scopeClockErrors";

// This retained owner reads the genuine pre-0064 inline clock. It neither
// constructs nor issues current installation/execution authority.
const legacyRegistrationClocks = pgTable("fx_system_scope_clock", {
  scopeId: text("scope_id").notNull(),
  scopeUuid: uuid("scope_uuid"),
  storageGeneration: text("storage_generation").notNull(),
  storageGenerationFence: bigint("storage_generation_fence", { mode: "bigint" }).notNull(),
  lastCommitSeq: bigint("last_commit_seq", { mode: "bigint" }).notNull(),
  oldestAvailableCommitSeq: bigint("oldest_available_commit_seq", { mode: "bigint" }).notNull(),
  authorizationRevocationEpoch: bigint("authorization_revocation_epoch", { mode: "bigint" }).notNull(),
  epoch: text("epoch").notNull(),
  epochUuid: uuid("epoch_uuid"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

const LegacyRegistrationClockSchema = Schema.Struct({
  scopeId: Schema.toType(ScopeIdSchema).check(Schema.makeFilter(value =>
    isNonBlankString(value) ? undefined : "Expected a nonblank historical scope ID")),
  scopeUuid: Schema.NullOr(ScopeUuidV1Schema),
  storageGeneration: StorageGenerationSchema,
  storageGenerationFence: Schema.toType(StorageGenerationFenceSchema),
  lastCommitSeq: Schema.toType(CommitSeqSchema),
  oldestAvailableCommitSeq: Schema.toType(CommitSeqSchema),
  authorizationRevocationEpoch: Schema.toType(TransactionAuthorizationRevocationEpochSchema),
  epoch: Schema.toType(ScopeEpochSchema).check(Schema.makeFilter(value =>
    isNonBlankString(value) ? undefined : "Expected a nonblank historical scope epoch")),
  epochUuid: Schema.NullOr(ScopeEpochUuidV1Schema),
  updatedAt: Schema.declare((value): value is Date => finiteDateMilliseconds(value) !== undefined),
}).check(Schema.makeFilter(clock => {
  if (clock.oldestAvailableCommitSeq > clock.lastCommitSeq)
    return "Historical retained floor exceeds its committed sequence";
  const scopeUuid = Result.match(projectScopeIdUuidV1Result(clock.scopeId), {
    onFailure: () => null,
    onSuccess: projected => projected.scopeUuid,
  });
  const epochUuid = Result.match(projectScopeEpochUuidV1Result(clock.epoch), {
    onFailure: () => null,
    onSuccess: projected => projected.epochUuid,
  });
  return clock.scopeUuid !== scopeUuid || clock.epochUuid !== epochUuid
    ? "Historical generated clock identities disagree"
    : undefined;
}));

type LegacyApplicationRevisionRegistrationClock = typeof LegacyRegistrationClockSchema.Type;
const decodeClock = Schema.decodeUnknownResult(LegacyRegistrationClockSchema);

export class LegacyApplicationRevisionRegistrationClockPersistenceError extends Data.TaggedError(
  "LegacyApplicationRevisionRegistrationClockPersistenceError",
)<{
  readonly operation: "read" | "lockForUpdate";
  readonly cause: unknown;
}> {}

export type LegacyApplicationRevisionRegistrationClockError =
  | ScopeClockNotFoundError
  | ScopeClockCorruptionError
  | LegacyApplicationRevisionRegistrationClockPersistenceError;

export function decodeLegacyApplicationRevisionRegistrationClockResult(
  row: unknown,
  scopeId: ScopeId,
): Result.Result<LegacyApplicationRevisionRegistrationClock, ScopeClockCorruptionError> {
  return decodeClock(row).pipe(
    Result.mapError(cause => new ScopeClockCorruptionError(scopeId, "historical registration clock is invalid", { cause })),
    Result.map(clock => ({ ...clock, updatedAt: new Date(Date.prototype.getTime.call(clock.updatedAt)) })),
  );
}

const queryClock = Effect.fn("LegacyApplicationRevisionRegistrationClock.query")(
  function* (db: FlarexMetadataDatabase, scopeId: ScopeId, operation: "read" | "lockForUpdate") {
    const selection = db.select().from(legacyRegistrationClocks)
      .where(eq(legacyRegistrationClocks.scopeId, scopeId)).limit(1);
    // A foreign query must settle before its transaction can be released.
    const rows = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => operation === "lockForUpdate" ? selection.for("update") : selection,
      catch: cause => new LegacyApplicationRevisionRegistrationClockPersistenceError({ operation, cause }),
    }));
    return rows[0];
  },
);

export const readLegacyApplicationRevisionRegistrationClock = Effect.fn(
  "LegacyApplicationRevisionRegistrationClock.read",
)(function* (db: FlarexMetadataDatabase, scopeId: ScopeId) {
  const row = yield* queryClock(db, scopeId, "read");
  return row === undefined ? null : yield* Effect.fromResult(
    decodeLegacyApplicationRevisionRegistrationClockResult(row, scopeId),
  );
});

export const lockLegacyApplicationRevisionRegistrationClock = Effect.fn(
  "LegacyApplicationRevisionRegistrationClock.lockForUpdate",
)(function* (tx: AppRowTransaction, scopeId: ScopeId) {
  const row = yield* queryClock(tx, scopeId, "lockForUpdate");
  if (row === undefined) return yield* Effect.fail(new ScopeClockNotFoundError(scopeId));
  return yield* Effect.fromResult(decodeLegacyApplicationRevisionRegistrationClockResult(row, scopeId));
});
