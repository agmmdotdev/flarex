import { getTableColumns, sql } from "drizzle-orm";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { isJson, type Json, type JsonObject } from "flarex-protocol/json";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import { TransactionIdentityAccessPolicySha256V1Schema, TransactionRequestSha256V1Schema } from "flarex-protocol/transaction-session";
import { fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemCommitRelationAdjacencyChanges,
  fxSystemIdempotency, fxSystemCommitWakes, fxSystemTransactionSessions } from "../../database/schema";
import { fxSystemCommitRelationalChanges } from "./relationalFactsSchema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../events/schema";
import { commitEventLimits } from "../events/model";
import type { ScopePublicationContribution, ScopePublicationKernel } from "./scopePublicationModel";
import { ScopePublicationCorruptionError } from "./scopePublicationModel";
import type { AppRowTransaction } from "../../storage/documents/appRows";

const invalid = () => new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid" });
type ScopePublicationTupleTable = typeof fxSystemCommits | typeof fxSystemCommitAppRowChanges |
  typeof fxSystemCommitRelationAdjacencyChanges | typeof fxSystemCommitRelationalChanges |
  typeof fxSystemCommitEvents | typeof fxSystemCommitEventDeliveries | typeof fxSystemIdempotency |
  typeof fxSystemCommitWakes | typeof fxSystemTransactionSessions;
function tuple<Table extends ScopePublicationTupleTable>(table: Table, row: Table["$inferSelect"]): JsonObject {
  const result: Record<string, Json> = {};
  for (const [key, column] of Object.entries(getTableColumns(table))) {
    const value: unknown = Reflect.get(row, key);
    if (value instanceof Uint8Array) result[column.name] = `\\x${encodeBytesToLowercaseHex(value)}`;
    else if (value instanceof Date && Number.isSafeInteger(value.getTime())) result[column.name] = value.toISOString();
    else if (typeof value === "bigint") result[column.name] = value.toString();
    else if (isJson(value)) result[column.name] = value;
    else throw invalid();
  }
  return result;
}

export function projectScopePublicationRows(kernel: ScopePublicationKernel,
  rows: ScopePublicationContribution["rowIntents"], firstOrdinal: number): JsonObject[] {
  if (!Number.isSafeInteger(firstOrdinal) || firstOrdinal < 0 || firstOrdinal + rows.length > 16000) throw invalid();
  return rows.map((row, ordinal) => tuple(fxSystemCommitAppRowChanges, {
    scopeUuid: kernel.clock.scopeUuid, epochUuid: kernel.clock.epochUuid, commitSeq: kernel.commitSeq,
    changeOrdinal: firstOrdinal + ordinal, tableId: row.tableId, rowId: appRowIdHexV1ToBytes(row.rowId),
  } satisfies typeof fxSystemCommitAppRowChanges.$inferSelect));
}

export function projectScopePublicationContribution(command: ScopePublicationContribution, kernel: ScopePublicationKernel,
  changeCount: number, completeRows: boolean, finiteSession?: Readonly<typeof fxSystemTransactionSessions.$inferSelect>) {
  if (!Number.isSafeInteger(changeCount) || changeCount < 0 || changeCount > 16000 || kernel.relationAdjacencyChanges.length > 16000 ||
    (command.relationalFacts?.length ?? 0) > 16000 || (command.events?.values.length ?? 0) > commitEventLimits.messages) throw invalid();
  const publicationTime = new Date(kernel.publicationTimeMilliseconds);
  const common = { scopeUuid: kernel.clock.scopeUuid, epochUuid: kernel.clock.epochUuid, commitSeq: kernel.commitSeq };
  const events = command.events?.values ?? [];
  const header = tuple(fxSystemCommits, { ...common, changeCount, relationAdjacencyChangeCount: kernel.relationAdjacencyChanges.length,
    payloadPreferenceDeletionCount: command.payloadPreferenceDeletionCount ?? 0, relationalChangeCount: command.relationalFacts?.length ?? 0,
    eventCount: events.length, eventSha256: command.events?.sha256 ?? null, committedAt: publicationTime,
  } satisfies typeof fxSystemCommits.$inferSelect);
  const relationRows = kernel.relationAdjacencyChanges.map((relation, changeOrdinal) => tuple(fxSystemCommitRelationAdjacencyChanges,
    { ...common, changeOrdinal, edgeDefinitionId: relation.edgeDefinitionId, direction: relation.direction,
      endpointRowId: appRowIdHexV1ToBytes(relation.endpointRowId) } satisfies typeof fxSystemCommitRelationAdjacencyChanges.$inferSelect));
  const relational = (command.relationalFacts ?? []).map((fact, changeOrdinal) => tuple(fxSystemCommitRelationalChanges,
    { ...fact, ...common, changeOrdinal } satisfies typeof fxSystemCommitRelationalChanges.$inferSelect));
  const eventRows = events.map((envelope, eventOrdinal) => tuple(fxSystemCommitEvents,
    { ...common, eventOrdinal, envelope } satisfies typeof fxSystemCommitEvents.$inferSelect));
  const deliveries = events.flatMap((envelope, eventOrdinal) => {
    if (envelope.subscribers.length === 0 || envelope.subscribers.length > commitEventLimits.subscribers) throw invalid();
    return envelope.subscribers.map(subscriber => tuple(fxSystemCommitEventDeliveries,
      { ...common, eventOrdinal, subscriberId: subscriber.id, handlerRevision: subscriber.revision, state: "pending", attempts: 0, fence: 0n,
        owner: null, leaseExpiresAt: null, nextAttemptAt: publicationTime, failureCode: null, settledAt: null } satisfies typeof fxSystemCommitEventDeliveries.$inferSelect));
  });
  const outcome = tuple(fxSystemIdempotency, { ...common, requestKey: command.authorityPins.requestKey,
    identityAccessPolicySha256: TransactionIdentityAccessPolicySha256V1Schema.make(command.identityAccessPolicySha256),
    functionPath: command.authorityPins.functionPath, requestSha256: TransactionRequestSha256V1Schema.make(command.requestSha256),
    resultState: "available", resultEncoding: command.successfulResult.encoding,
    resultValueCodecVersion: command.successfulResult.encoding === "application-value" ? FLAREX_VALUE_CODEC_VERSION_V1 : null,
    resultSemanticBytes: command.successfulResult.semanticSizeBytes, resultBytes: command.successfulResult.canonicalBytes,
    resultSha256: command.resultSha256, resultExpiredAt: null, createdAt: publicationTime } satisfies typeof fxSystemIdempotency.$inferSelect);
  const wake = tuple(fxSystemCommitWakes, { ...common, deliveryState: "pending", createdAt: publicationTime, nextAttemptAt: publicationTime,
    claimFence: 0n, claimOwner: null, claimedAt: null, claimExpiresAt: null, lastFailureCode: null, lastFailureSummary: null,
    lastFailedAt: null, deliveredAt: null, deadLetteredAt: null } satisfies typeof fxSystemCommitWakes.$inferSelect);
  return { header: [header], ...(completeRows ? { rows: projectScopePublicationRows(kernel, command.rowIntents, 0) } : {}),
    relations: relationRows, relational, events: eventRows, deliveries, outcome: [outcome], wake: [wake],
    session: finiteSession === undefined ? null : tuple(fxSystemTransactionSessions, finiteSession) };
}

const decodeFailure = Schema.decodeUnknownResult(Schema.Struct({ code: Schema.Literal("FX001"), detail: Schema.Literals([
  "publicationStoredCorruption", "publicationSessionChanged", "publicationClockChanged", "publicationClockStoredCorruption",
  "publicationMetadataChanged",
]) }));
export function scopePublicationProcedureFailure(cause: unknown): ScopePublicationCorruptionError | null {
  return Result.match(decodeFailure(cause instanceof DrizzleQueryError ? cause.cause : cause), { onFailure: () => null,
    onSuccess: failure => failure.detail === "publicationMetadataChanged" ? null : new ScopePublicationCorruptionError({ reason: failure.detail.startsWith("publicationClock")
      ? "scopeClockInvalid" : "publicationInvariantInvalid", cause }) });
}
export function scopePublicationMetadataChanged(cause: unknown): boolean {
  return Result.match(decodeFailure(cause instanceof DrizzleQueryError ? cause.cause : cause), {
    onFailure: () => false, onSuccess: failure => failure.detail === "publicationMetadataChanged",
  });
}

export function scopePublicationPrimitiveQuery(tx: AppRowTransaction, schemaName: string, name: string, input: Json | string,
  verification?: Json) {
  return tx.select({ accepted: sql<number | boolean>`${sql.identifier(schemaName)}.${sql.identifier(name)}(${typeof input === "string" ? input : JSON.stringify(input)}::jsonb
    ${verification === undefined ? sql`` : sql`, ${JSON.stringify(verification)}::jsonb`})` })
    .from(sql`(values(1)) as publication_input`);
}
