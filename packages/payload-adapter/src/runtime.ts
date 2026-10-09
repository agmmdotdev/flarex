import { Effect, type Scope } from "effect";
import type { CmsCommand, CmsHost, CmsHostInput, SourceCmsHostInput, CmsReadHost, CmsReadHostInput, CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { LogicalParticipantBorrow, SessionJournalAttempt } from "@flarex/persistence-postgres/session-journal-store";
import { makePayloadNative } from "./runtime/native";
import { bindPayloadDirect } from "./direct/binding";
import { makePayloadAttempt } from "./runtime/attempt";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "./collections";

export type PayloadHostInput<Failure> =
  | Omit<CmsHostInput<Failure>, "commands" | "expectedContentIdentity">
  | Omit<SourceCmsHostInput<Failure>, "commands" | "expectedContentIdentity">;

export type PayloadReadHostInput<Failure> = Omit<CmsReadHostInput<Failure>, "commands" | "expectedContentIdentity">;

export interface PayloadAttemptRuntime {
  readonly borrowParticipant: LogicalParticipantBorrow;
}

export interface PayloadRuntime {
  readonly commands: Readonly<{
    create: CmsCommand; update: CmsCommand; delete: CmsCommand;
    find: CmsCommand; findByID: CmsCommand; count: CmsCommand;
  }>;
  readonly bind: <Failure>(input: PayloadHostInput<Failure>) => Effect.Effect<CmsHost, CmsTransactionError>;
  readonly bindRead: <Failure>(input: PayloadReadHostInput<Failure>) => Effect.Effect<CmsReadHost, CmsTransactionError>;
  readonly makeAttempt: (attempt: SessionJournalAttempt) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope>;
}

/** Each checked configuration has its own scoped Payload instance and borrowed requests. */
export const makePayloadRuntime: (
  compiled: CompiledPayloadCollections,
) => Effect.Effect<PayloadRuntime, CmsTransactionError, Scope.Scope> =
  Effect.fn("PayloadAdapter.makeRuntime")(compiled => requireCompiledPayloadCollections(compiled).pipe(
    Effect.andThen(makePayloadNative(compiled)), Effect.map(native => ({
      commands: native.commands, ...bindPayloadDirect(native),
      makeAttempt: (attempt: SessionJournalAttempt) => makePayloadAttempt(native, compiled.sourceContract.sourceKey, attempt),
    }))));
