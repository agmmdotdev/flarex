import { Effect, Exit, Scope } from "effect";
import type { SessionJournalAttempt } from "@flarex/persistence-postgres/session-journal-store";
import type { CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { bindPayloadParticipant } from "../participant/binding";
import type { PayloadOperationInstrumentation } from "../operations";
import type { PayloadNative } from "./native";
import type { PayloadAttemptRuntime } from "../runtime";

/** Source-private construction seam; ordinary runtime arguments expose no instrumentation. */
export const makePayloadAttempt: (
  native: PayloadNative, sourceKey: string, attempt: SessionJournalAttempt,
  instrumentation?: PayloadOperationInstrumentation,
) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadAdapter.makeAttempt")(function* (
  native: PayloadNative, sourceKey: string, attempt: SessionJournalAttempt,
  instrumentation?: PayloadOperationInstrumentation,
) {
  const ownership = yield* native.makeAttemptOwnership();
  const borrowParticipant = yield* Scope.provide(ownership.scope)(
    bindPayloadParticipant(native.makeCommands(instrumentation), sourceKey, attempt, native.isLive)).pipe(
      Effect.onExit(exit => Exit.isFailure(exit) ? ownership.close : Effect.void));
  return Object.freeze({ borrowParticipant });
});
