/** Framework-facing private contract; implementation and database owners stay in core. */
export { makePreparedHostRuntime, type PreparedHostRuntime, PreparedHostRuntimeError } from "./preparedHostRuntime";
import { getCommerceCommand } from "./commerceTransaction/commands";
import type { CommerceCommand } from "./commerceTransaction/commands";

/** Read-only identity for composing replay policy. Never exposes command code,
 * resources or admission authority. The core registry remains authoritative. */
export function commerceCommandIdentity(command: CommerceCommand) {
  const definition = getCommerceCommand(command);
  return definition === undefined ? undefined : Object.freeze({ name: definition.name, mode: definition.mode });
}

export { defineCommerceCommand } from "./commerceTransaction/commands";
export type { CommerceCommand, CommerceCommandContext, CommerceHost } from "./commerceTransaction/commands";
export type { BoundedRequestContext } from "./boundedRequestLifetime";
export { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "./atomicCommerce/commands";
export type { AtomicCommerceCommand, AtomicCommerceContext, AtomicCommerceParticipant, AtomicCommerceHost } from "./atomicCommerce/commands";
export type { AtomicCommerceHostInput } from "./atomicCommerce/configuration";
export type { AtomicCommerceParticipantInput, LogicalCommerceCallObservation,
  LogicalCommerceEventValidation, LogicalCommerceCallValidation } from "./atomicCommerce/participants";
export type { LogicalCommerceMutation } from "./commerceTransaction/logicalParticipant";
export { defineCommerceEventContract } from "./atomicCommerce/events";
export type { CommerceEventContract, ParticipantEventSelection, AtomicCommerceEvents, AtomicCommerceCallObservation } from "./atomicCommerce/events";
