import { Clock, Effect, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import type { Json } from "flarex-protocol/json";
import type { SessionJournalAttemptV1 } from "../sessionJournalStore";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { makeBoundedRequestLifetime } from "../boundedRequestLifetime";
import { LogicalDocumentSourceAdmissionError, withLogicalDocumentAttemptAdmissionEffect } from
  "../logicalDocuments/documentAdmission";
import { LogicalParticipantAdmissionError, type LogicalParticipantAttemptAdmission } from
  "../logicalDocuments/participantAdmission";
import type { LogicalDocumentReadTransaction, LogicalPendingDocumentSeed } from "../logicalDocuments/model";
import { makeLogicalDocumentWorkingSet } from "../logicalDocuments/workingSet";
import { makeCmsCommandContext } from "./context";
import type { CmsCommandContext } from "./host";
import { cmsError, cmsLimits, CmsTransactionError,
  type CmsRequestContext, type CmsPresentedTransactionId } from "./model";

const projectSourceFailure = (cause: LogicalDocumentSourceAdmissionError | LogicalParticipantAdmissionError): CmsTransactionError =>
  cmsError(cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
    ? "bindingChanged" : cause.reason, cause);
const projectCheckedReadFailure = (cause: unknown): CmsTransactionError =>
  cause instanceof CmsTransactionError ? cause :
    cause instanceof LogicalParticipantAdmissionError || cause instanceof LogicalDocumentSourceAdmissionError
      ? projectSourceFailure(cause) : cmsError("resourceFailure", cause);

export interface BorrowedCmsAttemptInput {
  readonly admission: LogicalParticipantAttemptAdmission;
  readonly attempt: SessionJournalAttemptV1;
  readonly method: string;
  /** The journal owns this pending point overlay and all durable receipts. */
  readonly pendingRows: readonly LogicalPendingDocumentSeed[];
}

/** One Payload Local API invocation borrows the root's historical view. All
 * checked reads use short transactions; Payload callbacks see no open SQL
 * transaction and cannot settle or publish the root. */
export const makeBorrowedCmsAttempt = Effect.fn("LogicalCms.borrowAttempt")(function* (
  input: BorrowedCmsAttemptInput,
) {
  return yield* withLogicalDocumentAttemptAdmissionEffect(input.admission, input.attempt, input.method,
    (state, checkedRead) => Effect.gen(function* () {
      if (state.configuration.profile !== "payload.scalar" || state.tables.length !== 1 ||
        state.tables[0]?.localName !== "posts") return yield* Effect.fail(cmsError("unsupportedProfile"));
      const lifetime = yield* makeBoundedRequestLifetime(cmsError,
        { calls: cmsLimits.calls, commandBytes: cmsLimits.commandBytes, commandMs: cmsLimits.commandMs },
        input.attempt, Object.freeze({}), crypto.randomUUID(), "write", "require");
      return yield* Effect.gen(function* () {
        const id = yield* lifetime.begin(lifetime.context);
        const readTransaction: LogicalDocumentReadTransaction<CmsTransactionError> =
          <A, E>(work: (tx: FlarexMetadataTransaction) => Effect.Effect<A, E>) =>
            checkedRead(work).pipe(Effect.mapError(projectCheckedReadFailure));
        const requireAdmission = checkedRead(() => Effect.void).pipe(Effect.mapError(projectSourceFailure));
        const working = yield* makeLogicalDocumentWorkingSet({
          readTransaction,
          scopeId: state.root.scopeId, clock: state.clock, snapshotCommitSeq: state.root.snapshotCommitSeq,
          pendingRows: input.pendingRows, lifetime, requireAdmission,
          tables: state.tables.map(table => ({ tableId: table.tableId, logicalName: table.localName })),
          limits: { pageRows: cmsLimits.pageRows, identities: cmsLimits.identities,
            documentBytes: cmsLimits.documentBytes },
          error: cmsError,
          uniqueConflict: uniqueConstraint => new CmsTransactionError({ reason: "uniqueConflict", uniqueConstraint }),
          validateDocument: write => Effect.fromResult(state.validate(write).pipe(Result.mapError(cause =>
            cmsError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)))),
        }, AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis), state.unique,
          state.indexes.filter(index => index.access.kind === "developer"));
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
        return Object.freeze({ context, close, abort: lifetime.close, withinDeadline: lifetime.withinDeadline,
          currentUsage: () => Object.freeze({ workBytes: cmsLimits.commandBytes - lifetime.remainingBytes(),
            workCalls: lifetime.usedCalls() }) });
      }).pipe(Effect.onError(() => lifetime.close));
    })).pipe(Effect.mapError(cause => cause instanceof CmsTransactionError ? cause : projectSourceFailure(cause)));
});
