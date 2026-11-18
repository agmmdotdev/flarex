import { Effect } from "effect";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Json } from "flarex-protocol/json";
import { appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1Result, type ScopeId } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../../database/drizzleStatementEffect";
import { fxAppJsonEntryCurrent } from "../../../database/schema";
import type { LogicalDocumentFailure } from "./model";
import type { LogicalSearchDefinition } from "./searchEntries";
import type { LogicalSearchMember } from "./searchReads";

export { jsonbContains } from "../../../values/jsonContains";

/** An extra row detects overflow; the page limit never changes the result set.
 * The physical GIN path is checked by serving readiness, not trusted here. */
export const readLogicalJsonContainsRange = Effect.fn("LogicalDocuments.readJsonContainsRange")(function* <Failure>(
  tx: FlarexMetadataTransaction, scopeId: ScopeId, definition: LogicalSearchDefinition,
  column: string, value: Json, maximumRows: number, error: LogicalDocumentFailure<Failure>,
) {
  if (definition.kind !== "jsonContainment" || definition.columns.length !== 1 ||
    definition.columns[0] !== column || maximumRows < 1 || maximumRows > 4096)
    return yield* Effect.fail(error("invalidInput"));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId))
    .pipe(Effect.mapError(cause => error("invalidAuthority", cause)));
  const raw = yield* runDrizzleStatementEffect(tx.select({ rowId: fxAppJsonEntryCurrent.rowId,
    fieldId: fxAppJsonEntryCurrent.fieldId, commitSeq: fxAppJsonEntryCurrent.commitSeq })
    .from(fxAppJsonEntryCurrent).where(and(
      eq(fxAppJsonEntryCurrent.scopeUuid, scope.scopeUuid),
      eq(fxAppJsonEntryCurrent.tableId, definition.tableId),
      eq(fxAppJsonEntryCurrent.logicalIndexId, definition.logicalIndexId),
      eq(fxAppJsonEntryCurrent.sourceSha256, definition.sourceSha256),
      eq(fxAppJsonEntryCurrent.fieldId, column),
      sql`${fxAppJsonEntryCurrent.valueJson} @> ${JSON.stringify(value)}::jsonb`,
    )).orderBy(asc(fxAppJsonEntryCurrent.rowId)).limit(maximumRows + 1),
    cause => error("statementFailure", cause));
  if (raw.length > maximumRows) return yield* Effect.fail(error("limitExceeded"));
  const entries: LogicalSearchMember[] = [];
  for (const row of raw) entries.push(Object.freeze({
    rowId: yield* Effect.fromResult(appRowIdHexV1FromBytesResult(row.rowId))
      .pipe(Effect.mapError(cause => error("storedCorruption", cause))),
    fieldId: row.fieldId, commitSeq: row.commitSeq,
  }));
  return Object.freeze(entries);
});
