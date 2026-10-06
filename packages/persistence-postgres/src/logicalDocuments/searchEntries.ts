import { Data, Effect, Result, Schema } from "effect";
import { isJsonObject, type Json } from "flarex-protocol/json";
import { appRowIdHexV1ToBytes, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogIndexId, CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq, ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { requireAdmittedTargetInstallationSchema } from "../installationLifecycle";
import { applicationDomainFailureDetail, buildAppSearchBatchStatement } from "../applicationDocumentMaterialization/domainApplication";
import { rowsFromDriverExecuteResult } from "../driverExecuteResult";
import type { PointCommitPublicationObservation } from "../pointCommitPublicationObservation";
import { fxAppJsonEntryCurrent, fxAppSearchEntryCurrent } from "../schema";

export interface LogicalSearchDefinition {
  readonly kind: "text" | "jsonContainment";
  readonly tableId: CatalogTableId;
  readonly logicalIndexId: CatalogIndexId;
  readonly sourceSha256: string;
  readonly columns: readonly string[];
  readonly nullPredicateField: string | null;
}

/** Search maintenance needs the committed identity and current document only. */
export type LogicalSearchChange =
  | Readonly<{ kind: "live"; tableId: CatalogTableId; rowId: AppRowIdHexV1;
      document: Readonly<{ valueJson: Json }> }>
  | Readonly<{ kind: "deleted"; tableId: CatalogTableId; rowId: AppRowIdHexV1 }>;

/** Only a predicate guaranteed by the query may narrow a JSON candidate set. */
export function selectLogicalJsonSearchDefinition(definitions: readonly LogicalSearchDefinition[],
  tableId: CatalogTableId, column: string, requiredNulls: ReadonlySet<string>) {
  return definitions.find(definition => definition.tableId === tableId &&
    definition.kind === "jsonContainment" && definition.columns.length === 1 &&
    definition.columns[0] === column &&
    (definition.nullPredicateField === null || requiredNulls.has(definition.nullPredicateField)));
}

export class LogicalSearchMaintenanceError extends Data.TaggedError("LogicalSearchMaintenanceError")<{
  readonly reason: "invalidAuthority" | "storedCorruption" | "limitExceeded" | "statementFailure";
  readonly cause?: unknown;
}> {}

const failure = (reason: LogicalSearchMaintenanceError["reason"], cause?: unknown) =>
  new LogicalSearchMaintenanceError({ reason, ...(cause === undefined ? {} : { cause }) });
const foldAscii = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const searchWriteBudget = Object.freeze({ rows: 512, entries: 4096, textBytes: 4_194_304 });
const decodeSearchRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "storedCorruption", "invalidAuthority"]),
})), { onExcessProperty: "error" });
const decodeSearchSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), entries: Schema.Number, buildAdvanced: Schema.Boolean,
}), { onExcessProperty: "error" });
export function searchApplicationFailure(cause: unknown, capturedDetail?: string) {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_search_batch");
  if (detail === null) return failure("statementFailure", cause);
  return Result.match(decodeSearchRefusal(detail), {
    onFailure: () => failure("statementFailure", cause),
    onSuccess: verdict => failure(verdict.reason === "invalidBatch" ? "limitExceeded" : verdict.reason, cause),
  });
}

/** Retain each definition's pure verdict at its original write position. */
export function* prepareLogicalSearchApplications(definitions: readonly LogicalSearchDefinition[], changes: readonly LogicalSearchChange[],
  scopeUuid: ScopeUuidV1, commitSeq: CommitSeq): Generator<Result.Result<PreparedLogicalSearchApplication, LogicalSearchMaintenanceError>, void> {
  let entryCount = 0;
  let textBytes = 0;
  for (const definition of definitions) {
    const selected = changes.filter(change => change.tableId === definition.tableId);
    if (selected.length === 0) continue;
    const startEntries = entryCount;
    const startBytes = textBytes;
    const stage = Result.gen(function* () {
      if (selected.length > searchWriteBudget.rows) return yield* Result.fail(failure("limitExceeded"));
      const ids = selected.map(change => appRowIdHexV1ToBytes(change.rowId));
      const textPages: Array<Array<typeof fxAppSearchEntryCurrent.$inferInsert>> = [];
      const jsonPages: Array<Array<typeof fxAppJsonEntryCurrent.$inferInsert>> = [];
      for (const [changeOrdinal, change] of selected.entries()) {
        if (change.kind === "deleted") continue;
        const document = change.document.valueJson;
        if (!isJsonObject(document)) return yield* Result.fail(failure("storedCorruption"));
        if (definition.nullPredicateField !== null) {
          const predicateValue = document[definition.nullPredicateField];
          if (predicateValue === undefined) return yield* Result.fail(failure("storedCorruption"));
          if (predicateValue !== null) continue;
        }
        for (const fieldId of definition.columns) {
          const value = document[fieldId];
          if (value === undefined) return yield* Result.fail(failure("storedCorruption"));
          if (value === null) continue;
          entryCount++;
          if (definition.kind === "jsonContainment") {
            textBytes += new TextEncoder().encode(JSON.stringify(value)).byteLength;
            (jsonPages[Math.floor(changeOrdinal / 32)] ??= []).push({ scopeUuid, tableId: definition.tableId, logicalIndexId: definition.logicalIndexId,
              sourceSha256: definition.sourceSha256, fieldId, rowId: appRowIdHexV1ToBytes(change.rowId),
              commitSeq, valueJson: value });
          } else {
            if (typeof value !== "string") return yield* Result.fail(failure("storedCorruption"));
            const foldedText = foldAscii(value);
            textBytes += new TextEncoder().encode(foldedText).byteLength;
            (textPages[Math.floor(changeOrdinal / 32)] ??= []).push({ scopeUuid, tableId: definition.tableId, logicalIndexId: definition.logicalIndexId,
              sourceSha256: definition.sourceSha256, fieldId, rowId: appRowIdHexV1ToBytes(change.rowId),
              commitSeq, foldedText });
          }
          if (entryCount > searchWriteBudget.entries || textBytes > searchWriteBudget.textBytes)
            return yield* Result.fail(failure("limitExceeded"));
        }
      }
      return { scopeUuid, commitSeq, definition, ids, textPages, jsonPages,
        entryCount: entryCount - startEntries, textBytes: textBytes - startBytes } satisfies PreparedLogicalSearchApplication;
      });
    yield stage;
    if (Result.isFailure(stage)) break;
  }
}

export interface PreparedLogicalSearchApplication {
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
  readonly definition: LogicalSearchDefinition;
  readonly ids: readonly Uint8Array[];
  readonly textPages: readonly (readonly (typeof fxAppSearchEntryCurrent.$inferInsert)[])[];
  readonly jsonPages: readonly (readonly (typeof fxAppJsonEntryCurrent.$inferInsert)[])[];
  readonly entryCount: number;
  readonly textBytes: number;
}

/** Maintain only current search access, after the authoritative row revision
 * and pointer have been written by the same transaction. The caller owns
 * source admission, settlement and rollback. */
export const maintainLogicalSearchEntries = Effect.fn("LogicalSearchEntries.maintain")(function* (
  tx: FlarexMetadataTransaction, scopeUuid: ScopeUuidV1, commitSeq: CommitSeq,
  definitions: readonly LogicalSearchDefinition[], changes: readonly LogicalSearchChange[],
  publicationObservation?: PointCommitPublicationObservation,
) {
  let entryCount = 0;
  let textBytes = 0;
  for (const stage of prepareLogicalSearchApplications(definitions, changes, scopeUuid, commitSeq)) {
    const prepared = yield* Effect.fromResult(stage);
    const { definition, ids, textPages, jsonPages } = prepared;
    entryCount += prepared.entryCount;
    textBytes += prepared.textBytes;
    const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(
      Result.mapError(cause => failure("statementFailure", cause))));
    for (let offset = 0; offset < ids.length; offset += 32) {
      const batch = ids.slice(offset, offset + 32);
      const textBatch = textPages[offset / 32] ?? [];
      const jsonBatch = jsonPages[offset / 32] ?? [];
      const complete = offset + 32 >= ids.length;
      const verification = complete ? { ids: ids.slice(0, offset),
        entries: textPages.slice(0, offset / 32).flat(), jsonEntries: jsonPages.slice(0, offset / 32).flat() }
        : { ids: [], entries: [], jsonEntries: [] };
      const statement = buildAppSearchBatchStatement(scopeUuid, commitSeq, definition, batch,
        textBatch, jsonBatch, complete, schemaName, verification);
      const result = yield* Effect.uninterruptible(Effect.tryPromise({
        try: () => tx.execute(statement),
        catch: searchApplicationFailure,
      }));
      const rows = rowsFromDriverExecuteResult(result, () => { throw failure("storedCorruption"); });
      if (rows.length !== 1) return yield* Effect.fail(failure("storedCorruption"));
      const verdict = yield* Effect.fromResult(decodeSearchSuccess(rows[0]).pipe(
        Result.mapError(cause => failure("storedCorruption", cause))));
      if (verdict.entries !== textBatch.length + jsonBatch.length)
        return yield* Effect.fail(failure("storedCorruption"));
      if (publicationObservation?.detail) {
        publicationObservation.record({ kind: "batch", owner: "searchDeletes", counts: { rows: batch.length } });
        if (verdict.entries > 0) publicationObservation.record({ kind: "batch", owner: "searchInserts", counts: { entries: verdict.entries } });
        if (verdict.buildAdvanced) publicationObservation.record({ kind: "batch", owner: "searchBuilds", counts: { rows: 1 } });
      }
    }
  }
  if (publicationObservation?.detail) publicationObservation.record({ kind: "counts", owner: "searchInserts", counts: { entries: entryCount, textBytes } });
});
