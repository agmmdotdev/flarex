import { Effect } from "effect";
import { cmsError, getCmsCommand, makeBorrowedCmsAttempt, type CmsCommand,
  type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { LogicalParticipantInvocationError } from
  "@flarex/persistence-postgres/internal/logical-participant-admission";
import type { LogicalParticipantBorrow } from "@flarex/persistence-postgres/session-journal-store";
import type { Json } from "flarex-protocol/json";
import type { PayloadRuntime } from "../runtime";

export const projectPayloadParticipantFailure = (cause: CmsTransactionError): LogicalParticipantInvocationError =>
  new LogicalParticipantInvocationError({
    kind: cause.reason === "resourceFailure" || cause.reason === "storedCorruption" ||
      cause.reason === "statementFailure" || cause.reason === "decisionUncertain"
      ? "infrastructure" : "rejection",
    cause,
  });

/** Fixed admitted Local API methods borrow the Application root; they never settle it. */
export function bindPayloadParticipant(commands: PayloadRuntime["commands"], sourceKey: string): LogicalParticipantBorrow {
  const command = (method: string): CmsCommand | undefined => {
    switch (method) {
      case "payload-create": return commands.create;
      case "payload-update": return commands.update;
      case "payload-findByID": return commands.findByID;
      default: return undefined;
    }
  };
  return Effect.fn("PayloadParticipant.borrow")(function* (input: Parameters<LogicalParticipantBorrow>[0]) {
    const admission = input.admissions[0];
    if (admission === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
    const cms = yield* makeBorrowedCmsAttempt({ ...input, admission });
    return Object.freeze({
      abort: cms.abort,
      currentUsage: cms.currentUsage,
      invoke: Effect.fn("PayloadParticipant.invoke")(function* (method: string, args: Json) {
        const selected = command(method);
        if (selected === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
        const definition = getCmsCommand(selected);
        if (definition === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
        const result = yield* cms.withinDeadline(definition.run(cms.context, args));
        const closed = yield* cms.close;
        return Object.freeze({ result, changes: closed.changes,
          eventIntents: closed.events.map(intent => Object.freeze({ sourceKey, intent })),
          workBytes: closed.workBytes, workCalls: closed.workCalls });
      }, Effect.mapError(projectPayloadParticipantFailure)),
    });
  }, Effect.mapError(projectPayloadParticipantFailure));
}
