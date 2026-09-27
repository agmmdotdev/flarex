/** Framework-facing private contract; implementation and database owners stay in core. */
export { makePreparedHostRuntime, type PreparedHostRuntime, PreparedHostRuntimeError } from "./preparedHostRuntime";
import { getCommerceCommand } from "./commerceTransaction/commands";
import type { CommerceCommand, CommerceCommandContext } from "./commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "./commerceTransaction/model";
import { Effect } from "effect";
import type { Json } from "flarex-protocol/json";

/** Read-only identity for composing replay policy. Never exposes command code,
 * resources or admission authority. The core registry remains authoritative. */
export function commerceCommandIdentity(command: CommerceCommand) {
  const definition = getCommerceCommand(command);
  return definition === undefined ? undefined : Object.freeze({ name: definition.name, mode: definition.mode });
}

/** Invoke only an exact command capability with an owner-constructed context. */
export function runCommerceCommand(
  command: CommerceCommand,
  context: CommerceCommandContext,
  args: Json,
): Effect.Effect<Json, CommerceTransactionError> {
  const definition = getCommerceCommand(command);
  return definition === undefined
    ? Effect.fail(commerceError("invalidAuthority"))
    : definition.run(context, args);
}

export { defineCommerceCommand } from "./commerceTransaction/commands";
export { makeBorrowedLogicalAttempt } from "./commerceTransaction/borrowedLogicalAttempt";
export { projectLogicalDocumentJournalContribution } from "./logicalDocuments/journalContribution";
export type { LogicalDocumentChanges } from "./logicalDocuments/workingSet";
export { serializeLogicalParticipantDependencyEvidence, decodeLogicalParticipantDependencyEvidence } from "./logicalDocuments/journalEvidence";
export type { LogicalParticipantDependencyEvidence } from "./logicalDocuments/journalEvidence";
export type { BorrowedLogicalAttemptInput } from "./commerceTransaction/borrowedLogicalAttempt";
export type { CommerceCommand, CommerceCommandContext, CommerceHost } from "./commerceTransaction/commands";
export type { BoundedRequestContext } from "./boundedRequestLifetime";
export { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "./atomicCommerce/commands";
export type { AtomicCommerceCommand, AtomicCommerceContext, AtomicCommerceParticipant, AtomicCommerceHost } from "./atomicCommerce/commands";
export type { AtomicCommerceHostInput } from "./atomicCommerce/configuration";
export type { AtomicCommerceParticipantInput, LogicalCommerceCallObservation,
  LogicalCommerceEventValidation, LogicalCommerceCallValidation } from "./atomicCommerce/participants";
export type { LogicalCommerceMutation } from "./commerceTransaction/logicalParticipant";
export { defineCommerceEventContract, defineCommerceDerivedIdEventContract } from "./atomicCommerce/events";
export { captureAtomicCommerceEvents, prepareAtomicCommerceEvents,
  prepareAdmittedCommerceEventIntents, validateAdmittedCommerceEventIntents,
  admittedCommerceEventGroup } from "./atomicCommerce/events";
export type { CommerceEventContract, ParticipantEventSelection, AtomicCommerceEvents, AtomicCommerceCallObservation } from "./atomicCommerce/events";
export type { CommittedEvent, CommitEventSubscriber } from "./commitEvents/model";
