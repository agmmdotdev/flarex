import { observeExecution } from "../../execution/diagnostics/operation";
import { Clock, Effect, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import type {
  AdmittedCompletion,
  LogicalBorrowedParticipantOperation,
  SessionJournalAttempt,
} from "../../execution/journal/contracts";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { makeBoundedRequestLifetime } from "../../execution/preparation/boundedRequestLifetime";
import { LogicalDocumentSourceAdmissionError, withLogicalDocumentAttemptAdmissionEffect } from
  "../../storage/documents/logicalDocuments/documentAdmission";
import {
  projectFiniteStorageCaptureFailure,
  type LogicalParticipantAttemptAdmission,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import type {
  LogicalDocumentBorrowView,
  LogicalDocumentReadTransaction,
  LogicalStorageReadDemand,
} from "../../storage/documents/logicalDocuments/model";
import { makeLogicalDocumentWorkingSet } from "../../storage/documents/logicalDocuments/workingSet";
import {
  requireLogicalDocumentRootEvaluatorOpen,
} from "../../storage/documents/logicalDocuments/rootEvaluator";
import { makeCmsCommandContext } from "./context";
import { getCmsCommand, type CmsCommand, type CmsCommandContext } from "./commands";
import { cmsError, cmsLimits, CmsTransactionError,
  type CmsRequestContext, type CmsPresentedTransactionId } from "./model";

const projectSourceFailure = (cause: LogicalDocumentSourceAdmissionError | LogicalParticipantAdmissionError): CmsTransactionError =>
  cmsError(cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
    ? "bindingChanged" : cause.reason, cause);
const projectCheckedReadFailure = (cause: unknown): CmsTransactionError =>
  cause instanceof CmsTransactionError ? cause :
    cause instanceof LogicalParticipantAdmissionError || cause instanceof LogicalDocumentSourceAdmissionError
      ? projectSourceFailure(cause) : cmsError("resourceFailure", cause);

export type BorrowedCmsAttemptInput = Readonly<{
  readonly admission: LogicalParticipantAttemptAdmission;
  readonly attempt: SessionJournalAttempt;
  readonly method: string;
}> & LogicalDocumentBorrowView;

/** One Payload Local API invocation borrows the root's historical view. All
 * checked reads use short transactions; Payload callbacks see no open SQL
 * transaction and cannot settle or publish the root. */
const makeBorrowedCmsAttempt = Effect.fnUntraced(function* (
  input: BorrowedCmsAttemptInput,
) {
  let closePreparedLifetime: Effect.Effect<void> = Effect.void;
  return yield* withLogicalDocumentAttemptAdmissionEffect(input.admission, input.attempt, input.method,
    (state, checkedRead, constructionTx) => Effect.gen(function* () {
      if ((state.root.executionProfile === "finiteRoot") !== (input.rootEvaluator !== undefined))
        return yield* Effect.fail(cmsError("invalidAuthority"));
      const localRootGate = input.rootEvaluator === undefined ? Effect.void :
        requireLogicalDocumentRootEvaluatorOpen(input.rootEvaluator, {
          attempt: input.attempt, scopeId: state.root.scopeId,
          snapshotCommitSeq: state.root.snapshotCommitSeq, attemptFence: input.rootAttemptFence,
        }, () => cmsError("closed"));
      yield* localRootGate;
      if (state.configuration.profile !== "payload.scalar")
        return yield* Effect.fail(cmsError("unsupportedProfile"));
      const lifetime = yield* makeBoundedRequestLifetime(cmsError,
        { calls: cmsLimits.calls, commandBytes: cmsLimits.commandBytes, commandMs: cmsLimits.commandMs },
        input.attempt, Object.freeze({}), crypto.randomUUID(), "write", "require");
      closePreparedLifetime = lifetime.close;
      return yield* Effect.gen(function* () {
        const id = yield* lifetime.begin(lifetime.context);
        const readTransaction: LogicalDocumentReadTransaction<CmsTransactionError> =
          <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>, demand?: LogicalStorageReadDemand) =>
            checkedRead(work, demand).pipe(Effect.mapError(projectCheckedReadFailure));
        const requireAdmission = input.rootEvaluator === undefined
          ? checkedRead(() => Effect.void).pipe(Effect.mapError(projectSourceFailure))
          : localRootGate;
        const working = yield* makeLogicalDocumentWorkingSet({
          readTransaction,
          ...(input.rootEvaluator === undefined ? {} : { readReadiness: { kind: "finiteQueryRequired" as const,
            mechanics: state.writeMechanics,
            captureStorage: (operation, demand) => input.captureStorage(operation, demand).pipe(Effect.mapError(projectFiniteStorageCaptureFailure), Effect.mapError(projectCheckedReadFailure)) } }),
          scopeId: state.root.scopeId, clock: state.clock, snapshotCommitSeq: state.root.snapshotCommitSeq,
          ...(input.rootEvaluator === undefined ? { pendingRows: input.pendingRows } :
            { rootEvaluator: input.rootEvaluator, rootAttempt: input.attempt,
              rootAttemptFence: input.rootAttemptFence }),
          lifetime, requireAdmission,
          writeMechanics: state.writeMechanics,
          tables: state.writeMechanics.tables, searchDefinitions: state.writeMechanics.searchDefinitions,
          limits: { pageRows: cmsLimits.pageRows, identities: cmsLimits.identities,
            documentBytes: cmsLimits.documentBytes },
          error: cmsError,
          uniqueConflict: uniqueConstraint => new CmsTransactionError({ reason: "uniqueConflict", uniqueConstraint }),
          validateDocument: write => Effect.fromResult(state.validate(write).pipe(Result.mapError(cause =>
            cmsError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)))),
        }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), state.writeMechanics.unique,
          state.writeMechanics.indexes, undefined, constructionTx);
        return Object.freeze({ lifetime, id, working });
      });
    }), (state, _checkedRead, { lifetime, id, working }) => Effect.sync(() => {
        const ports: Pick<CmsCommandContext, "documents" | "relations" | "preferences"> = {
          documents: working.documents,
          relations: Object.freeze({ incoming: (request: CmsRequestContext, presented: CmsPresentedTransactionId) => lifetime.operation(request, presented,
            "read", Effect.fail(cmsError("unsupportedProfile"))) }),
          preferences: Object.freeze({ deleteForPendingDocument: (request: CmsRequestContext, presented: CmsPresentedTransactionId) => lifetime.operation(request, presented,
            "write", Effect.fail(cmsError("unsupportedProfile"))) }),
        };
        const context = makeCmsCommandContext(lifetime, id, lifetime.context, ports,
          false, () => Effect.fail(cmsError("invalidAuthority")));
        let consumed = false;
        const close = Effect.gen(function* () {
          if (consumed) return yield* Effect.fail(cmsError("closed"));
          yield* lifetime.seal;
          const changes = yield* working.close();
          consumed = true;
          const events: readonly Json[] = Object.freeze([]);
          return Object.freeze({ changes, events,
            workBytes: cmsLimits.commandBytes - lifetime.remainingBytes(), workCalls: lifetime.usedCalls() });
        }).pipe(Effect.ensuring(lifetime.close));
        return Object.freeze({ context, close, sourceKey: state.sourceKey,
          abort: lifetime.close, withinDeadline: lifetime.withinDeadline,
          currentUsage: () => Object.freeze({ workBytes: cmsLimits.commandBytes - lifetime.remainingBytes(),
            workCalls: lifetime.usedCalls() }) });
    })
  ).pipe(Effect.mapError(cause => projectCheckedReadFailure(cause)),
    Effect.onError(() => closePreparedLifetime));
}, work => observeExecution("LogicalCms.borrowAttempt", work, "caller"));

export interface BorrowedCmsInvocation {
  readonly abort: Effect.Effect<void>;
  readonly currentUsage: LogicalBorrowedParticipantOperation["currentUsage"];
  readonly invoke: (command: CmsCommand, args: Json) => Effect.Effect<AdmittedCompletion, CmsTransactionError>;
}

/** The root admission selects the source and method. A native adapter selects
 * only its authentic command token; CMS owns execution and the single closure. */
export const makeBorrowedCmsInvocation = Effect.fnUntraced(function* (
  input: BorrowedCmsAttemptInput,
): Effect.fn.Return<BorrowedCmsInvocation, CmsTransactionError> {
  const method = input.method;
  const capturedInput = Object.freeze({ ...input, method });
  let open = true;
  const borrowed = yield* makeBorrowedCmsAttempt(capturedInput);
  const abort = Effect.sync(() => { open = false; }).pipe(Effect.andThen(borrowed.abort));
  const invoke = Effect.fnUntraced(function* (command: CmsCommand, args: Json) {
    if (!open) return yield* Effect.fail(cmsError("closed"));
    const definition = getCmsCommand(command);
    if (definition === undefined || definition.name !== method)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    // Claim the invocation before the first asynchronous callback. Concurrent
    // and repeated uses cannot execute native business logic a second time.
    open = false;
    const result = yield* borrowed.withinDeadline(definition.run(borrowed.context, args));
    const closed = yield* borrowed.close;
    return Object.freeze({ result, changes: closed.changes,
      eventIntents: Object.freeze(closed.events.map(intent => Object.freeze({ sourceKey: borrowed.sourceKey, intent }))),
      workBytes: closed.workBytes, workCalls: closed.workCalls });
  }, work => observeExecution("LogicalCms.invoke", work, "caller"));
  return Object.freeze({ abort, currentUsage: borrowed.currentUsage, invoke });
}, work => observeExecution("LogicalCms.makeInvocation", work, "caller"));
