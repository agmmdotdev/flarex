/** Framework-facing private contract; implementation and database owners stay in core. */
export { inspectLogicalReferenceFailure, type LogicalReferenceFailureEvidence } from "../../storage/documents/logicalDocuments/referenceFailure";
export { makePreparedHostRuntime, type PreparedHostRuntime, PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import { getCommerceCommand } from "./commands";
import type { CommerceCommand, CommerceCommandContext } from "./commands";
import { commerceError, type CommerceTransactionError } from "./model";
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

export { defineCommerceCommand } from "./commands";
export { makeBorrowedLogicalAttempt } from "./borrowedLogicalAttempt";
export { makeBorrowedWorkflowAttempt } from "./borrowedWorkflowAttempt";
export type { BorrowedWorkflowAttemptInput } from "./borrowedWorkflowAttempt";
export type { LogicalDocumentChanges } from "../../storage/documents/logicalDocuments/workingSet";
export { serializeLogicalParticipantDependencyEvidence, decodeLogicalParticipantDependencyEvidence } from "../../storage/documents/logicalDocuments/journalEvidence";
export type { LogicalParticipantDependencyEvidence } from "../../storage/documents/logicalDocuments/journalEvidence";
export type { BorrowedLogicalAttemptInput } from "./borrowedLogicalAttempt";
export type { CommerceCommand, CommerceCommandContext, CommerceHost } from "./commands";
export type { BoundedRequestContext } from "../../execution/preparation/boundedRequestLifetime";
export { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../atomicCommerce/commands";
export { requireAtomicCommerceScopeExclusion } from "../atomicCommerce/execution";
export type { AtomicCommerceCommand, AtomicCommerceContext, AtomicCommerceParticipant, AtomicCommerceHost, TaskAtomicCommerceHost } from "../atomicCommerce/commands";
export type { AtomicCommerceHostInput } from "../atomicCommerce/configuration";
export type { AtomicCommerceParticipantInput, LogicalCommerceCallObservation,
  LogicalCommerceEventValidation, LogicalCommerceCallValidation, PreparedAtomicCommerceLogicalParticipant } from "../atomicCommerce/participants";
export { captureAtomicCommerceParticipants, prepareAtomicCommerceParticipants,
  requirePreparedAtomicCommerceLogicalParticipant } from "../atomicCommerce/participants";
export type { LogicalCommerceMutation } from "./logicalParticipant";
export { defineCommerceEventContract, defineCommerceDerivedIdEventContract } from "../atomicCommerce/events";
export { captureAtomicCommerceEvents, prepareAtomicCommerceEvents,
  prepareAdmittedCommerceEventIntents, validateAdmittedCommerceEventIntents,
  admittedCommerceEventGroup } from "../atomicCommerce/events";
export type { CommerceEventContract, ParticipantEventSelection, AtomicCommerceEvents, AtomicCommerceCallObservation } from "../atomicCommerce/events";
export type { CommittedEvent, CommitEventSubscriber } from "../../commit/events/model";
