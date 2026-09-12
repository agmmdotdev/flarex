import { fxSystemCommitRelationalChanges } from "../commitPublication/relationalFactsSchema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../commitEvents/schema";
import { copyBytes } from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, eq, sql } from "drizzle-orm";
import { Result, Schema } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { MAX_PERSISTED_SIGNED_INT64_V1, CommitSeqSchema, type CommitSeq, type ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { type AppRowTransaction } from "../appRows";
import { observeDrizzleQuery as observeCompiledDrizzleQuery } from "../drizzleQueryObservation";
import { fxSystemCommitAppRowChanges, fxSystemCommitRelationAdjacencyChanges, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../schema";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure, type ScopePublicationClock, type ScopePublicationContribution, type ScopePublicationKernel, type ScopePublicationOptions, type ScopePublicationSqlOperation, type ScopePublicationStep } from "./scopePublicationModel";

export async function writeScopePublicationPrefix(
  tx: AppRowTransaction,
  command: ScopePublicationContribution,
  kernel: ScopePublicationKernel,
  options: ScopePublicationOptions,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const scopeUuid = kernel.clock.scopeUuid;
  const epochUuid = kernel.clock.epochUuid;
  const commitSeq = kernel.commitSeq;
  const changeCount = command.rowIntents.length;
  const relationAdjacencyChangeCount =
    kernel.relationAdjacencyChanges.length;

  const header = await sqlCall("writeCommitHeader", () =>
    tx.insert(fxSystemCommits).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeCount,
      relationAdjacencyChangeCount,
      payloadPreferenceDeletionCount: command.payloadPreferenceDeletionCount ?? 0,
      relationalChangeCount: command.relationalFacts?.length ?? 0,
      eventCount: command.events?.values.length ?? 0,
      eventSha256: command.events?.sha256 ?? null,
      committedAt: publicationTime,
    }).returning({ commitSeq: fxSystemCommits.commitSeq }));
  projectScopePublicationResult(
    requireSinglePublicationWriteResult(header, commitSeq, "commitSeq"),
  );
  await emitTransactionStep(options, command, "commitHeaderWritten");

  for (
    let firstOrdinal = 0;
    firstOrdinal < command.rowIntents.length;
    firstOrdinal += MAX_COMMIT_CHANGES_PER_STATEMENT
  ) {
    const batch = command.rowIntents.slice(
      firstOrdinal,
      firstOrdinal + MAX_COMMIT_CHANGES_PER_STATEMENT,
    );
    const query = tx.insert(fxSystemCommitAppRowChanges).values(
      batch.map((rowIntent, batchIndex) => ({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: firstOrdinal + batchIndex,
        tableId: rowIntent.tableId,
        rowId: appRowIdHexV1ToBytes(rowIntent.rowId),
      })),
    ).returning({
      commitSeq: fxSystemCommitAppRowChanges.commitSeq,
      changeOrdinal: fxSystemCommitAppRowChanges.changeOrdinal,
    });
    observeDrizzleQuery("writeCommitChange", query, options);
    const changes = await sqlCall("writeCommitChange", () => query);
    projectScopePublicationResult(
      requireCommitChangeBatchWriteResult(
        changes,
        commitSeq,
        firstOrdinal,
        batch.length,
      ),
    );
    await emitTransactionStep(options, command, "commitChangeWritten");
  }

  for (
    let firstOrdinal = 0;
    firstOrdinal < kernel.relationAdjacencyChanges.length;
    firstOrdinal += MAX_COMMIT_CHANGES_PER_STATEMENT
  ) {
    const batch = kernel.relationAdjacencyChanges.slice(
      firstOrdinal,
      firstOrdinal + MAX_COMMIT_CHANGES_PER_STATEMENT,
    );
    const query = tx.insert(fxSystemCommitRelationAdjacencyChanges).values(
      batch.map((relationChange, batchIndex) => ({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: firstOrdinal + batchIndex,
        edgeDefinitionId: relationChange.edgeDefinitionId,
        direction: relationChange.direction,
        endpointRowId: appRowIdHexV1ToBytes(
          relationChange.endpointRowId,
        ),
      })),
    ).returning({
      commitSeq: fxSystemCommitRelationAdjacencyChanges.commitSeq,
      changeOrdinal: fxSystemCommitRelationAdjacencyChanges.changeOrdinal,
    });
    observeDrizzleQuery(
      "writeCommitRelationAdjacencyChange",
      query,
      options,
    );
    const changes = await sqlCall(
      "writeCommitRelationAdjacencyChange",
      () => query,
    );
    projectScopePublicationResult(
      requireCommitChangeBatchWriteResult(
        changes,
        commitSeq,
        firstOrdinal,
        batch.length,
      ),
    );
    await emitTransactionStep(
      options,
      command,
      "commitRelationAdjacencyChangeWritten",
    );
  }

  signal?.throwIfAborted();
  if (command.relationalFacts !== undefined && command.relationalFacts.length > 0) {
    const facts = await tx.insert(fxSystemCommitRelationalChanges).values(command.relationalFacts.map((fact, changeOrdinal) => ({
      ...fact, scopeUuid, epochUuid, commitSeq, changeOrdinal,
    }))).returning({ ordinal: fxSystemCommitRelationalChanges.changeOrdinal });
    if (facts.length !== command.relationalFacts.length || new Set(facts.map(fact => fact.ordinal)).size !== facts.length ||
      facts.some(fact => fact.ordinal < 0 || fact.ordinal >= (command.relationalFacts?.length ?? 0))) throw corruption("publicationInvariantInvalid");
  }

  signal?.throwIfAborted();
  const events = command.events?.values ?? [];
  if (events.length > 0) {
    const written = await sqlCall("writeCommitChange", () => tx.insert(fxSystemCommitEvents).values(events.map((envelope, eventOrdinal) => ({
      scopeUuid, epochUuid, commitSeq, eventOrdinal, envelope,
    }))).returning({ ordinal: fxSystemCommitEvents.eventOrdinal }));
    if (written.length !== events.length || new Set(written.map(row => row.ordinal)).size !== events.length || written.some(row => row.ordinal < 0 || row.ordinal >= events.length)) throw corruption("publicationInvariantInvalid");
    const deliveries = events.flatMap((event, eventOrdinal) => event.subscribers.map(subscriber => ({
      scopeUuid, epochUuid, commitSeq, eventOrdinal, subscriberId: subscriber.id, handlerRevision: subscriber.revision,
      state: "pending" as const, nextAttemptAt: publicationTime,
    })));
    if (deliveries.length === 0) throw corruption("publicationInvariantInvalid");
    const delivered = await sqlCall("writeCommitChange", () => tx.insert(fxSystemCommitEventDeliveries).values(deliveries)
      .returning({ ordinal: fxSystemCommitEventDeliveries.eventOrdinal, subscriber: fxSystemCommitEventDeliveries.subscriberId }));
    const expected = new Set(deliveries.map(row => `${row.eventOrdinal}:${row.subscriberId}`));
    if (delivered.length !== deliveries.length || delivered.some(row => !expected.delete(`${row.ordinal}:${row.subscriber}`)) || expected.size !== 0) throw corruption("publicationInvariantInvalid");
  }
  signal?.throwIfAborted();
  const outcome = await sqlCall("writeOutcome", () =>
    tx.insert(fxSystemIdempotency).values({
      scopeUuid,
      requestKey: command.authorityPins.requestKey,
      identityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(copyBytes(
          command.identityAccessPolicySha256,
        )),
      functionPath: command.authorityPins.functionPath,
      requestSha256: TransactionRequestSha256V1Schema.make(copyBytes(
        command.requestSha256,
      )),
      epochUuid,
      commitSeq,
      resultState: "available",
      resultEncoding: command.successfulResult.encoding,
      resultValueCodecVersion: command.successfulResult.encoding === "application-value" ? FLAREX_VALUE_CODEC_VERSION_V1 : null,
      resultSemanticBytes: command.successfulResult.semanticSizeBytes,
      resultBytes: command.successfulResult.canonicalBytes,
      resultSha256: copyBytes(command.resultSha256),
      resultExpiredAt: null,
      createdAt: publicationTime,
    }).returning({ commitSeq: fxSystemIdempotency.commitSeq }));
  projectScopePublicationResult(
    requireSinglePublicationWriteResult(outcome, commitSeq, "commitSeq"),
  );
  await emitTransactionStep(options, command, "outcomeWritten");

  signal?.throwIfAborted();
  const wake = await sqlCall("writeWake", () =>
    tx.insert(fxSystemCommitWakes).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      deliveryState: "pending",
      createdAt: publicationTime,
      nextAttemptAt: publicationTime,
      claimFence: 0n,
      claimOwner: null,
      claimedAt: null,
      claimExpiresAt: null,
      lastFailureCode: null,
      lastFailureSummary: null,
      lastFailedAt: null,
      deliveredAt: null,
      deadLetteredAt: null,
    }).returning({ commitSeq: fxSystemCommitWakes.commitSeq }));
  projectScopePublicationResult(
    requireSinglePublicationWriteResult(wake, commitSeq, "commitSeq"),
  );
  await emitTransactionStep(options, command, "wakeWritten");

}

export async function advanceScopePublicationClock(
  tx: AppRowTransaction,
  command: ScopePublicationContribution,
  kernel: ScopePublicationKernel,
  options: ScopePublicationOptions,
): Promise<void> {
  const scopeUuid = kernel.clock.scopeUuid;
  const commitSeq = kernel.commitSeq;
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const clock = await sqlCall("advanceScopeClock", () =>
    tx.update(fxSystemScopeClocks).set({
      lastCommitSeq: commitSeq,
      updatedAt: publicationTime,
    }).where(and(
      eq(fxSystemScopeClocks.scopeUuid, scopeUuid),
      eq(
        fxSystemScopeClocks.lastCommitSeq,
        kernel.clock.record.lastCommitSeq,
      ),
    )).returning({
      lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
    }));
  projectScopePublicationResult(
    requirePointCommitClockPublicationResult(clock, commitSeq),
  );
  await emitTransactionStep(options, command, "clockAdvanced");
}

export function allocateScopePublicationResult(
  clock: Pick<ScopePublicationClock, "record">,
  publicationTimeMilliseconds: number,
): Result.Result<
  Readonly<{
    readonly commitSeq: CommitSeq;
    readonly publicationTimeMilliseconds: number;
  }>,
  ScopePublicationResourceError
> {
  if (clock.record.lastCommitSeq >= MAX_PERSISTED_SIGNED_INT64_V1) {
    return Result.fail(new ScopePublicationResourceError({
      dimension: "commitSequence",
      maximum: MAX_PERSISTED_SIGNED_INT64_V1,
    }));
  }
  return Result.succeed(Object.freeze({
    commitSeq: CommitSeqSchema.make(clock.record.lastCommitSeq + 1n),
    publicationTimeMilliseconds,
  }));
}

export async function readScopePublicationDatabaseTime(
  tx: AppRowTransaction,
  scopeId: ReplacementScopeIdV1,
  options: ScopePublicationOptions,
): Promise<number> {
  const query = tx
    .select({
      milliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  observeDrizzleQuery("readDatabaseTime", query, options);
  const rows = await sqlCall("readDatabaseTime", () => query);
  return projectScopePublicationResult(
    decodeScopePublicationDatabaseTimeResult(rows[0]?.milliseconds),
  );
}

function decodeScopePublicationDatabaseTimeResult(
  text: unknown,
): Result.Result<number, ScopePublicationCorruptionError> {
  if (typeof text !== "string" || !/^[1-9][0-9]*$/.test(text)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  const value = Number(text);
  if (!isPositiveSafeInteger(value)) {
    return Result.fail(corruption("scopeClockInvalid"));
  }
  return Result.succeed(value);
}

const decodeCommitChangeBatch = Schema.decodeUnknownResult(Schema.Array(
  Schema.Struct({ commitSeq: Schema.toType(CommitSeqSchema), changeOrdinal: Schema.Int }),
));

function requireCommitChangeBatchWriteResult(
  input: unknown,
  expectedCommitSeq: CommitSeq,
  firstOrdinal: number,
  expectedCount: number,
): Result.Result<void, ScopePublicationCorruptionError> {
  return Result.gen(function* () {
    const rows = yield* decodeCommitChangeBatch(input).pipe(
      Result.mapError(() => corruption("publicationInvariantInvalid")),
    );
    if (rows.length !== expectedCount) {
      return yield* Result.fail(corruption("publicationInvariantInvalid"));
    }
    const ordinals = new Set<number>();
    for (const row of rows) {
      if (
        row.commitSeq !== expectedCommitSeq ||
        row.changeOrdinal < firstOrdinal ||
        row.changeOrdinal >= firstOrdinal + expectedCount ||
        ordinals.has(row.changeOrdinal)
      ) {
        return yield* Result.fail(corruption("publicationInvariantInvalid"));
      }
      ordinals.add(row.changeOrdinal);
    }
  });
}

function requirePointCommitClockPublicationResult(
  rows: ReadonlyArray<Readonly<{
    readonly lastCommitSeq: CommitSeq;
  }>>,
  expectedCommitSeq: CommitSeq,
): Result.Result<void, ScopePublicationCorruptionError> {
  if (
    rows.length !== 1 ||
    rows[0]?.lastCommitSeq !== expectedCommitSeq
  ) {
    return Result.fail(corruption("publicationInvariantInvalid"));
  }
  return Result.succeed(undefined);
}

function requireSinglePublicationWriteResult<
  Key extends "commitSeq" | "sessionId",
  Value,
>(
  rows: ReadonlyArray<Readonly<Record<Key, Value>>>,
  expected: Value,
  key: Key,
): Result.Result<void, ScopePublicationCorruptionError> {
  return rows.length === 1 && rows[0]?.[key] === expected
    ? Result.succeed(undefined)
    : Result.fail(corruption("publicationInvariantInvalid"));
}

const MAX_COMMIT_CHANGES_PER_STATEMENT = 500;
const corruption = (reason: ScopePublicationCorruptionError["reason"]) => new ScopePublicationCorruptionError({ reason });

// This is the existing native Promise publication boundary. Effect participants
// join it through their owned bridge; it neither creates a runtime nor settles SQL.
async function sqlCall<Value>(operation: ScopePublicationSqlOperation, call: () => PromiseLike<Value>): Promise<Value> {
  try { return await call(); } catch (cause) { throw new ScopePublicationSqlFailure({ operation, cause }); }
}
async function emitTransactionStep(options: ScopePublicationOptions, command: ScopePublicationContribution, step: ScopePublicationStep): Promise<void> {
  await options.afterTransactionStep?.(Object.freeze({ scopeId: command.authorityPins.scopeId, step }));
}
function observeDrizzleQuery(name: ScopePublicationSqlOperation, query: { toSQL: () => { sql: string; params: unknown[] } }, options: ScopePublicationOptions): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

/** Throwing projection at the existing native/Drizzle Promise transaction boundary. */
function projectScopePublicationResult<Value, Failure>(result: Result.Result<Value, Failure>): Value {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: transaction - projects typed publication failures into the existing Drizzle Promise rollback boundary without creating a nested Effect runtime.
  return Result.getOrThrow(result);
}
