import { Cause, Effect, Scope } from "effect";
import {
  cmsError,
  type CmsCommand,
  type CmsTransactionError,
} from "@flarex/persistence-postgres/internal/cms-adapter";
import { makeBorrowedCmsInvocation } from "@flarex/persistence-postgres/internal/cms-execution";
import {
  LogicalParticipantInvocationError,
} from "@flarex/persistence-postgres/internal/logical-participant-errors";
import type {
  LogicalParticipantBorrow,
  SessionJournalAttempt,
} from "@flarex/persistence-postgres/internal/session-journal";
import type { Json } from "flarex-protocol/json";
import type { PayloadNative } from "../runtime/native";

export const projectPayloadParticipantFailure = (cause: CmsTransactionError): LogicalParticipantInvocationError =>
  new LogicalParticipantInvocationError({
    kind: cause.reason === "resourceFailure" || cause.reason === "storedCorruption" ||
      cause.reason === "statementFailure" || cause.reason === "decisionUncertain" ? "infrastructure" : "rejection",
    cause,
  });

/** The adapter selects native methods; CMS owns borrowed execution and completion. */
export const bindPayloadParticipant: (
  commands: PayloadNative["commands"], attempt: SessionJournalAttempt, isNativeLive: () => boolean,
) => Effect.Effect<LogicalParticipantBorrow, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadParticipant.bind")(function* (
  commands: PayloadNative["commands"], attempt: SessionJournalAttempt, isNativeLive: () => boolean,
) {
  if (!isNativeLive()) return yield* Effect.fail(cmsError("closed"));
  const scope = yield* Effect.scope;
  let live = true;
  yield* Scope.addFinalizer(scope, Effect.sync(() => { live = false; }));
  if (!live || !isNativeLive()) return yield* Effect.fail(cmsError("closed"));
  const command = (method: string): CmsCommand | undefined => {
    switch (method) {
      case "payload-create": return commands.create;
      case "payload-update": return commands.update;
      case "payload-findByID": return commands.findByID;
      default: return undefined;
    }
  };
  return Effect.fn("PayloadParticipant.borrow")(function* (input: Parameters<LogicalParticipantBorrow>[0]) {
    if (!live || !isNativeLive()) return yield* Effect.fail(cmsError("closed"));
    if (input.attempt !== attempt) return yield* Effect.fail(cmsError("invalidAuthority"));
    const admission = input.admissions[0];
    if (admission === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
    const cms = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const borrowed = yield* restore(makeBorrowedCmsInvocation({ ...input, admission }));
      yield* Scope.addFinalizer(scope, Effect.sync(() => { live = false; }).pipe(Effect.andThen(borrowed.abort)));
      return borrowed;
    }));
    if (!live || !isNativeLive()) {
      yield* cms.abort;
      return yield* Effect.fail(cmsError("closed"));
    }
    return Object.freeze({ abort: cms.abort, currentUsage: cms.currentUsage,
      invoke: Effect.fn("PayloadParticipant.invoke")(function* (method: string, args: Json) {
        if (!live || !isNativeLive()) return yield* Effect.fail(cmsError("closed"));
        const selected = command(method);
        if (selected === undefined) return yield* Effect.fail(cmsError("unsupportedProfile"));
        return yield* cms.invoke(selected, args);
      }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPayloadParticipantFailure)))),
    });
  }, Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPayloadParticipantFailure))));
});
