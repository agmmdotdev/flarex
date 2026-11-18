import { Data, Effect, Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { decodeAppDocumentIdentityV1Result } from "flarex-protocol/app-document-id";
import type { LogicalDocumentChanges } from "./workingSet";

export class LogicalJournalContributionError extends Data.TaggedError("LogicalJournalContributionError")<{
  readonly reason: "invalidEvidence";
  readonly cause?: unknown;
}> {}
const invalid = (cause?: unknown) => new LogicalJournalContributionError({ reason: "invalidEvidence",
  ...(cause === undefined ? {} : { cause }) });

/** The working set alone projects its closed observations onto the canonical
 * journal point owner. A read-only observation retains any prior overlay. */
export const projectLogicalDocumentJournalContribution = Effect.fn("LogicalDocuments.journalContribution")(
  function* (closed: LogicalDocumentChanges) {
    // This complete projection is synchronous. Keep its ordered checks inside
    // one Result pass; the named operation owns laziness, defects and tracing.
    return yield* Effect.fromResult(Result.gen(function* () {
      for (const row of [...closed.dependencies, ...closed.changes]) {
        const identity = yield* decodeAppDocumentIdentityV1Result(row.documentId).pipe(Result.mapError(invalid));
        if (identity.tableId !== row.tableId || identity.rowId !== row.rowId)
          return yield* Result.fail(invalid());
      }
      for (const attempt of closed.attempts) {
        const identity = yield* decodeAppDocumentIdentityV1Result(attempt.documentId).pipe(Result.mapError(invalid));
        if (identity.tableId !== attempt.tableId) return yield* Result.fail(invalid());
      }
      const observations = new Map(closed.dependencies.map(row => [row.documentId, row] as const));
      const changes = new Map(closed.changes.map(row => [row.documentId, row] as const));
      const noFinal = new Set(closed.noFinalRows);
      if (observations.size !== closed.dependencies.length || changes.size !== closed.changes.length ||
        noFinal.size !== closed.noFinalRows.length ||
        [...changes.keys()].some(id => !observations.has(id) || noFinal.has(id)) ||
        [...noFinal].some(id => !observations.has(id)) ||
        closed.attempts.some((attempt, ordinal) => (ordinal === 0 ? attempt.ordinal < 0 :
          attempt.ordinal <= closed.attempts[ordinal - 1]!.ordinal) || !observations.has(attempt.documentId)))
        return yield* Result.fail(invalid());
      const points = closed.dependencies.map(observation => {
        const changed = changes.get(observation.documentId);
        return Object.freeze({ observation,
          overlay: changed === undefined ? noFinal.has(observation.documentId)
            ? Object.freeze({ kind: "deleted" as const }) : Object.freeze({ kind: "retain" as const })
            : changed.kind === "live"
              ? Object.freeze({ kind: "live" as const, creationTime: changed.creationTime, document: changed.document })
              : Object.freeze({ kind: "deleted" as const }),
        });
      });
      const effects = [];
      for (const attempt of closed.attempts) {
        const before = attempt.before?.valueJson ?? null;
        const after = attempt.after?.valueJson ?? null;
        if (before !== null && !isJsonObject(before) || after !== null && !isJsonObject(after))
          return yield* Result.fail(invalid());
        effects.push(Object.freeze({ effectOrdinal: attempt.ordinal, tableId: attempt.tableId,
          documentId: attempt.documentId, operation: attempt.operation, before, after }));
      }
      return Object.freeze({ points: Object.freeze(points), effects: Object.freeze(effects),
        scans: closed.scans, uniqueReads: closed.uniqueReads, indexReads: closed.indexReads,
        pageReads: closed.pageReads, searchReads: closed.searchReads,
        setNull: closed.setNull, referenceReplacements: closed.referenceReplacements,
        lifecycle: closed.lifecycle });
    }));
  });
