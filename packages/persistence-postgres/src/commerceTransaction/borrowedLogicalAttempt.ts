import { Clock, Effect } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { SessionJournalAttempt } from "../sessionJournalStore";
import { makeBoundedRequestLifetime } from "../boundedRequestLifetime";
import { makeLogicalDocumentWorkingSet } from "../logicalDocuments/workingSet";
import type { LogicalPendingDocumentSeed } from "../logicalDocuments/model";
import { withLogicalRelationalAttemptAdmissionEffect } from "../logicalDocuments/relationalAdmission";
import type { LogicalParticipantAttemptAdmission } from "../logicalDocuments/participantAdmission";
import { prepareLogicalRelationalRows } from "../logicalDocuments/relationalRows";
import { makeCommerceCommandContext } from "./context";
import { commerceError, commerceLimits, logicalCommerceError } from "./model";
import { defaultCommerceResources, logicalCommerceWorkingSetLimits, type CommerceResources } from "./resources";
import { captureCommerceJsonData, projectCommerceRequestFailure } from "./request";
import { projectLogicalCommerceActivity } from "./logicalParticipant";
import type { CommerceCommandContext } from "./commands";

const refuseNested: Parameters<typeof makeCommerceCommandContext>[4] = () =>
  Effect.fail(commerceError("invalidAuthority"));

export interface BorrowedLogicalAttemptInput {
  readonly admission: LogicalParticipantAttemptAdmission;
  readonly attempt: SessionJournalAttempt;
  readonly method: string;
  /** Decoded from the canonical journal point table by the journal owner. */
  readonly pendingRows: readonly LogicalPendingDocumentSeed[];
  readonly resources?: CommerceResources;
}

/** A disposable evaluator for one admitted framework invocation. The root
 * journal owns its sequence, durable overlay, budgets and final settlement. */
export const makeBorrowedLogicalAttempt = Effect.fn("LogicalCommerce.borrowAttempt")(function* (
  input: BorrowedLogicalAttemptInput,
) {
  return yield* withLogicalRelationalAttemptAdmissionEffect(input.admission, input.attempt, input.method,
    (state, checkedRead) => Effect.gen(function* () {
      const resources = input.resources ?? defaultCommerceResources;
      const lifetime = yield* makeBoundedRequestLifetime(commerceError,
        { calls: resources.calls, commandBytes: resources.commandBytes, commandMs: commerceLimits.commandMs },
        input.attempt, Object.freeze({}), crypto.randomUUID(), "write");
      return yield* Effect.gen(function* () {
      const id = yield* lifetime.begin(lifetime.context);
      for (const table of state.tables)
        yield* Effect.fromResult(prepareLogicalRelationalRows(table.definition, state.schema.capabilities, logicalCommerceError));
      const requireAdmission = checkedRead(() => Effect.void).pipe(Effect.mapError(projectCommerceRequestFailure));
      const working = yield* makeLogicalDocumentWorkingSet({
        readTransaction: work => checkedRead(work).pipe(Effect.mapError(projectCommerceRequestFailure)),
        scopeId: state.root.scopeId, clock: state.clock, snapshotCommitSeq: state.root.snapshotCommitSeq,
        pendingRows: input.pendingRows,
        lifetime, requireAdmission,
        tables: state.tables.map(table => ({ tableId: table.tableId, logicalName: table.localName, relational: table.definition })),
        relationalCapabilities: state.schema.capabilities, searchDefinitions: state.search,
        validateDocument: write => Effect.fromResult(state.values.validate(write.tableId, write.document))
          .pipe(Effect.mapError(cause => commerceError("invalidInput", cause))),
        error: logicalCommerceError, uniqueConflict: () => commerceError("invalidInput"),
        limits: { ...logicalCommerceWorkingSetLimits, pageRows: resources.queryRows,
          identities: resources.catalogRows },
      }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), state.unique,
        state.indexes.filter(index => index.access.kind === "developer"));
      const first = state.tables[0];
      if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const store = yield* working.relationalTable(lifetime.context, id, first.localName);
      const events: Json[] = [];
      const captureEvent = (manager: typeof lifetime.context, event: unknown) =>
        lifetime.operation(manager, id, "write", Effect.gen(function* () {
          if (events.length >= resources.eventMessages) return yield* Effect.fail(commerceError("limitExceeded"));
          const captured = yield* Effect.fromResult(captureCommerceJsonData(event, lifetime.remainingBytes()));
          yield* Effect.fromResult(lifetime.charge(captured.bytes));
          events.push(captured.value);
        }));
      const context = makeCommerceCommandContext(lifetime, {
        store, resources,
        table: (manager, table) => working.relationalTable(manager, id, table),
        transactionTime: manager => working.readTransactionTime(manager, id),
        planSetNull: (manager, selection) => Effect.gen(function* () {
          const source = state.tables.find(table => table.localName === selection.sourceTable);
          const target = state.tables.find(table => table.localName === selection.targetTable);
          if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          yield* working.planSetNull(manager, id, { sourceTableId: source.tableId, sourceColumn: selection.sourceColumn,
            targetTableId: target.tableId, targetColumn: selection.targetColumn, targetKey: selection.targetKey });
        }),
        planReferenceReplacement: (manager, selection) => Effect.gen(function* () {
          const source = state.tables.find(table => table.localName === selection.sourceTable);
          const target = state.tables.find(table => table.localName === selection.targetTable);
          if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          yield* working.planReferenceReplacement(manager, id, { sourceTableId: source.tableId,
            sourceColumn: selection.sourceColumn, targetTableId: target.tableId,
            targetColumn: selection.targetColumn, targetKey: selection.targetKey, desiredKeys: selection.desiredKeys });
        }),
      }, id, lifetime.context, refuseNested, captureEvent);
      const names = new Map(state.tables.map(table => [table.tableId, table.localName]));
      let consumed = false;
      const close = Effect.gen(function* () {
        if (consumed) return yield* Effect.fail(commerceError("closed"));
        yield* lifetime.seal;
        const changes = yield* working.close();
        consumed = true;
        return Object.freeze({ changes, events: Object.freeze([...events]),
          workBytes: resources.commandBytes - lifetime.remainingBytes(),
          workCalls: lifetime.usedCalls() });
      }).pipe(Effect.ensuring(lifetime.close));
      const rootIdentity = Object.freeze({ scopeUuid: projectScopeIdUuidV1(state.root.scopeId).scopeUuid,
        sessionId: state.root.sessionId, attemptFence: state.root.attemptFence });
      return Object.freeze({ context: context satisfies CommerceCommandContext, rootIdentity, close, abort: lifetime.close,
        withinDeadline: lifetime.withinDeadline,
        currentUsage: () => Object.freeze({ workBytes: resources.commandBytes - lifetime.remainingBytes(),
          workCalls: lifetime.usedCalls() }),
        activityCursor: working.activityCursor,
        callActivity: (cursor: ReturnType<typeof working.activityCursor>) =>
          working.activitySnapshot().pipe(Effect.flatMap(snapshot => projectLogicalCommerceActivity(names, {
            ...snapshot,
            attempts: snapshot.attempts.slice(cursor.attempts).map(attempt =>
              Object.freeze({ ...attempt, ordinal: attempt.ordinal - cursor.attempts })),
            lifecycle: snapshot.lifecycle.slice(cursor.lifecycle).map(observation => Object.freeze({ ...observation,
              attemptOrdinal: observation.attemptOrdinal === null ? null : observation.attemptOrdinal - cursor.attempts })),
            setNull: snapshot.setNull.slice(cursor.setNull),
            referenceReplacements: snapshot.referenceReplacements.slice(cursor.referenceReplacements),
          }))),
      });
      }).pipe(Effect.onError(() => lifetime.close));
    }).pipe(Effect.mapError(projectCommerceRequestFailure)));
});
