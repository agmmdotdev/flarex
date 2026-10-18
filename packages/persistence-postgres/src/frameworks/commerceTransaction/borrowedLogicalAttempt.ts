import { Clock, Effect } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type {
  SessionJournalAttempt,
} from "../../execution/journal/contracts";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { makeBoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { makeLogicalDocumentWorkingSet } from "../../storage/documents/logicalDocuments/workingSet";
import {
  requireLogicalDocumentRootEvaluatorOpen,
} from "../../storage/documents/logicalDocuments/rootEvaluator";
import type { LogicalDocumentBorrowView } from "../../storage/documents/logicalDocuments/model";
import {
  withLogicalRelationalAttemptAdmissionEffect,
} from "../../storage/documents/logicalDocuments/relationalAdmission";
import {
  projectFiniteStorageCaptureFailure,
  type LogicalParticipantAttemptAdmission,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import { makeCommerceCommandContext } from "./context";
import { commerceError, commerceLimits, logicalCommerceError } from "./model";
import { defaultCommerceResources, logicalCommerceWorkingSetLimits } from "./resources";
import { captureCommerceJsonData, projectCommerceRequestFailure } from "./request";
import { makeLogicalCommerceActivityProjection } from "./logicalParticipant";
import type { CommerceCommandContext } from "./commands";
import type { CommerceTransactionError } from "./model";

const refuseNested: Parameters<typeof makeCommerceCommandContext>[4] = () =>
  Effect.fail(commerceError("invalidAuthority"));

export type BorrowedLogicalAttemptInput = Readonly<{
  readonly admission: LogicalParticipantAttemptAdmission;
  readonly attempt: SessionJournalAttempt;
  readonly method: string;
}> & LogicalDocumentBorrowView;

/** A disposable evaluator for one admitted framework invocation. The root
 * journal owns its sequence, durable overlay, budgets and final settlement. */
export const makeBorrowedLogicalAttempt = Effect.fn("LogicalCommerce.borrowAttempt")(function* (
  input: BorrowedLogicalAttemptInput,
) {
  let closePreparedLifetime: Effect.Effect<void> = Effect.void;
  return yield* withLogicalRelationalAttemptAdmissionEffect(input.admission, input.attempt, input.method,
    (state, checkedRead, constructionTx: FlarexMetadataTransaction | undefined) => Effect.gen(function* () {
      if ((state.root.executionProfile === "finiteRoot") !== (input.rootEvaluator !== undefined))
        return yield* Effect.fail(commerceError("invalidAuthority"));
      const localRootGate = input.rootEvaluator === undefined ? Effect.void :
        requireLogicalDocumentRootEvaluatorOpen(input.rootEvaluator, {
          attempt: input.attempt, scopeId: state.root.scopeId,
          snapshotCommitSeq: state.root.snapshotCommitSeq, attemptFence: input.rootAttemptFence,
        }, () => commerceError("closed"));
      yield* localRootGate;
      // This profile uses the captured owner policy; request input cannot
      // select or inspect a resource object while the checked SQL lock is held.
      const resources = defaultCommerceResources;
      const lifetime = yield* makeBoundedRequestLifetime(commerceError,
        { calls: resources.calls, commandBytes: resources.commandBytes, commandMs: commerceLimits.commandMs },
        input.attempt, Object.freeze({}), crypto.randomUUID(), "write");
      closePreparedLifetime = lifetime.close;
      return yield* Effect.gen(function* () {
        const id = yield* lifetime.begin(lifetime.context);
        const requireAdmission = input.rootEvaluator === undefined
          ? checkedRead(() => Effect.void).pipe(Effect.mapError(projectCommerceRequestFailure))
          : localRootGate;
        const working = yield* makeLogicalDocumentWorkingSet({
          readTransaction: (work, demand) => checkedRead(work, demand).pipe(Effect.mapError(projectCommerceRequestFailure)),
          ...(input.rootEvaluator === undefined ? {} : { readReadiness: { kind: "finiteQueryRequired" as const,
            mechanics: state.writeMechanics,
            captureStorage: (operation, demand) => input.captureStorage(operation, demand).pipe(Effect.mapError(projectFiniteStorageCaptureFailure), Effect.mapError(projectCommerceRequestFailure)) } }),
          scopeId: state.root.scopeId, clock: state.clock, snapshotCommitSeq: state.root.snapshotCommitSeq,
          ...(input.rootEvaluator === undefined ? { pendingRows: input.pendingRows } :
            { rootEvaluator: input.rootEvaluator, rootAttempt: input.attempt,
              rootAttemptFence: input.rootAttemptFence }),
          lifetime, requireAdmission,
          writeMechanics: state.writeMechanics,
          tables: state.writeMechanics.tables,
          ...(state.writeMechanics.relationalCapabilities === undefined ? {} : { relationalCapabilities: state.writeMechanics.relationalCapabilities }), searchDefinitions: state.writeMechanics.searchDefinitions,
          validateDocument: write => Effect.fromResult(state.values.validate(write.tableId, write.document))
            .pipe(Effect.mapError(cause => commerceError("invalidInput", cause))),
          error: logicalCommerceError, uniqueConflict: () => commerceError("invalidInput"),
          limits: { ...logicalCommerceWorkingSetLimits, pageRows: resources.queryRows,
            identities: resources.catalogRows },
        }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), state.writeMechanics.unique,
          state.writeMechanics.indexes, undefined, constructionTx);
        return Object.freeze({ resources, lifetime, id, working, localRootGate });
      });
    }), (state, _checkedRead, { resources, lifetime, id, working, localRootGate }) => Effect.gen(function* () {
      const first = state.tables[0];
      if (first === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const store = yield* working.relationalTable(lifetime.context, id, first.localName);
      const events: Json[] = [];
      const captureEvent = (manager: typeof lifetime.context, event: unknown,
        decode?: (event: unknown) => Effect.Effect<Json, CommerceTransactionError>) =>
        lifetime.operation(manager, id, "write", Effect.gen(function* () {
          yield* localRootGate;
          if (events.length >= resources.eventMessages) return yield* Effect.fail(commerceError("limitExceeded"));
          if (lifetime.remainingBytes() === 0) return yield* Effect.fail(commerceError("limitExceeded"));
          const decoded = decode === undefined ? event : yield* decode(event);
          yield* lifetime.checkpoint(manager);
          yield* localRootGate;
          const captured = yield* Effect.fromResult(captureCommerceJsonData(decoded, lifetime.remainingBytes()));
          yield* Effect.fromResult(lifetime.charge(captured.bytes));
          events.push(captured.value);
        }));
      const context = makeCommerceCommandContext(lifetime, {
        store, resources,
        table: (manager, table) => working.relationalTable(manager, id, table),
        transactionTime: manager => working.readTransactionTime(manager, id),
        // Durable borrowed journals do not admit terminal reference maintenance.
        // Keep an explicit refusal so a module cannot choose a fallback loop.
        planSetNull: () => Effect.fail(commerceError("invalidAuthority")),
        planReferenceReplacement: (manager, selection) => Effect.gen(function* () {
          const source = state.writeMechanics.tableId(selection.sourceTable);
          const target = state.writeMechanics.tableId(selection.targetTable);
          if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
          yield* working.planReferenceReplacement(manager, id, { sourceTableId: source,
            sourceColumn: selection.sourceColumn, targetTableId: target,
            targetColumn: selection.targetColumn, targetKey: selection.targetKey, desiredKeys: selection.desiredKeys });
        }),
      }, id, lifetime.context, refuseNested, captureEvent);
      const names = state.tableNames;
      const projectActivity = makeLogicalCommerceActivityProjection(names);
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
        withinDeadline: <Value>(work: Effect.Effect<Value, CommerceTransactionError>) =>
          lifetime.withinDeadline(lifetime.checkpoint(lifetime.context).pipe(
            Effect.andThen(localRootGate), Effect.andThen(work))),
        captureLocalEvent: (event: unknown, decode: (event: unknown) => Effect.Effect<Json, CommerceTransactionError>) =>
          captureEvent(lifetime.context, event, decode),
        checkAfterNative: lifetime.withinDeadline(lifetime.checkpoint(lifetime.context).pipe(Effect.andThen(localRootGate))),
        currentUsage: () => Object.freeze({ workBytes: resources.commandBytes - lifetime.remainingBytes(),
          workCalls: lifetime.usedCalls() }),
        activityCursor: working.activityCursor,
        callActivity: (cursor: ReturnType<typeof working.activityCursor>) =>
          working.activityContribution.pipe(Effect.flatMap(contribution => working.readActivityContribution(contribution, cursor)),
            Effect.flatMap(projectActivity)),
      });
    })
  ).pipe(Effect.mapError(projectCommerceRequestFailure), Effect.onError(() => closePreparedLifetime));
});
