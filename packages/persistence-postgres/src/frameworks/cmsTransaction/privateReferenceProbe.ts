import { Cause, Effect } from "effect";
import { LogicalParticipantInvocationError } from "../../storage/documents/logicalDocuments/participantErrors";
import { inspectLogicalParticipantAdmissionBundle } from "../../storage/documents/logicalDocuments/participantAdmission";
import { inspectPrivateReverseReadAccess, PRIVATE_REFERENCE_MEMBERSHIP_PROBE,
  type PrivateReverseReadAccess } from "../../execution/journal/privateReverseReadAccess";
import type { LogicalParticipantBorrow } from "../../execution/journal/contracts";
import { defineCmsCommand } from "./commands";
import { makeBorrowedCmsInvocation } from "./borrowedLogicalAttempt";
import { cmsError, type CmsTransactionError } from "./model";
import type { CmsReferenceProbeTestHooks } from "./testSupport";

const projectFailure = (cause: CmsTransactionError) => new LogicalParticipantInvocationError({
  kind: cause.reason === "resourceFailure" || cause.reason === "storedCorruption" || cause.reason === "statementFailure" ||
    cause.reason === "decisionUncertain" ? "infrastructure" : "rejection", cause });

/** Private RR1 shared-mechanics witness: no documents, counts, cursors or writes. */
export const makePrivateReferenceProbeBorrow = (access: PrivateReverseReadAccess, testHooks?: CmsReferenceProbeTestHooks): LogicalParticipantBorrow =>
  Effect.fn("PrivateReferenceProbe.borrow")(function* (input) {
    const selected = inspectPrivateReverseReadAccess(access, input.attempt);
    if (selected === undefined || input.bundle !== selected.admission || input.method !== PRIVATE_REFERENCE_MEMBERSHIP_PROBE)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const bundle = inspectLogicalParticipantAdmissionBundle(input.bundle, input.attempt, selected.participant,
      input.method, selected.profileRevision);
    if (bundle === null || bundle.admissions.length !== 1 || bundle.admissions.length !== input.admissions.length ||
      bundle.admissions.some((admission, index) => admission !== input.admissions[index]) || input.admissions[0] === undefined)
      return yield* Effect.fail(cmsError("invalidAuthority"));
    const command = defineCmsCommand({ name: PRIVATE_REFERENCE_MEMBERSHIP_PROBE, mode: "read",
      run: Effect.fn("PrivateReferenceProbe.run")(function* (context, args) {
        if (args !== null) return yield* Effect.fail(cmsError("invalidInput"));
        const membership = yield* context.documents.find(context.context, context.transactionId, selected.tableName,
          { where: { [selected.relation]: selected.productId }, offset: 0, limit: 1 });
        testHooks?.afterMembership?.(membership);
        return null;
      }) });
    const borrowed = yield* makeBorrowedCmsInvocation({ ...input, admission: input.admissions[0] });
    return { abort: borrowed.abort, currentUsage: borrowed.currentUsage,
      invoke: Effect.fn("PrivateReferenceProbe.invoke")(function* (method, args) {
        if (method !== PRIVATE_REFERENCE_MEMBERSHIP_PROBE || inspectPrivateReverseReadAccess(access, input.attempt) === undefined)
          return yield* Effect.fail(cmsError("invalidAuthority"));
        return yield* borrowed.invoke(command, args);
      }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure)))) };
  }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectFailure))));
