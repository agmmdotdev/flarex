import type { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CommerceCommand } from "../commerceTransaction/commands";
import type { CommerceTransactionError } from "../commerceTransaction/model";
import type { CommerceEventContract } from "./events";

declare const participantBrand: unique symbol;
export interface AtomicCommerceParticipant { readonly [participantBrand]: true }
const participants = new WeakMap<object, string>();

/** A definition identity, granted installation authority only by the host. */
export function defineAtomicCommerceParticipant(name: string): AtomicCommerceParticipant {
  // SAFETY: only this private registry authenticates participant definitions.
  const token = Object.freeze({}) as AtomicCommerceParticipant;
  participants.set(token, name);
  return token;
}
export const getAtomicCommerceParticipant = (participant: AtomicCommerceParticipant) => participants.get(participant);

export interface AtomicCommerceContext {
  readonly eventGroupId: string;
  /** Charge a finite node even when it makes no module call. */
  readonly checkpoint: Effect.Effect<void, CommerceTransactionError>;
  readonly capture: (value: unknown) => Effect.Effect<Json, CommerceTransactionError>;
  readonly emit: (contract: CommerceEventContract, message: unknown) => Effect.Effect<void, CommerceTransactionError>;
  readonly call: (participant: AtomicCommerceParticipant, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly refuse: (error: CommerceTransactionError) => Effect.Effect<never, CommerceTransactionError>;
}
interface AtomicCommandDefinition {
  readonly name: string;
  readonly run: (context: AtomicCommerceContext, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
}
declare const commandBrand: unique symbol;
export interface AtomicCommerceCommand { readonly [commandBrand]: true }
const commands = new WeakMap<object, AtomicCommandDefinition>();

/** Trusted, bounded and atomic. No task, step retry or compensation semantics. */
export function defineAtomicCommerceCommand(name: string, run: AtomicCommandDefinition["run"]): AtomicCommerceCommand {
  // SAFETY: only this private registry authenticates command code and identity.
  const token = Object.freeze({}) as AtomicCommerceCommand;
  commands.set(token, Object.freeze({ name, run }));
  return token;
}
export const getAtomicCommerceCommand = (command: AtomicCommerceCommand) => commands.get(command);

export interface AtomicCommerceHost {
  readonly newRequestKey: () => string;
  readonly run: (requestKey: string, command: AtomicCommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
}
