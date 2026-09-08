import type { CommerceResources } from "./resources";
import type { Effect } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CommerceStore } from "./storeModel";
import type { BoundedRequestContext } from "../boundedRequestLifetime";
import type { CommerceTransactionError } from "./model";

declare const commandBrand: unique symbol;
export interface CommerceCommand { readonly [commandBrand]: true }
export interface CommerceCommandContext {
  readonly resources: CommerceResources;
  readonly manager: BoundedRequestContext;
  readonly store: CommerceStore;
  readonly table: (tableId: string) => Effect.Effect<CommerceStore, CommerceTransactionError>;
  readonly captureLocalEvent: (event: unknown) => Effect.Effect<void, CommerceTransactionError>;
  readonly nested: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly rejectEvent: Effect.Effect<never, CommerceTransactionError>;
  readonly refuse: (error: CommerceTransactionError) => Effect.Effect<never, CommerceTransactionError>;
  readonly borrow: <Value>(work: (context: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>) => Effect.Effect<Value, CommerceTransactionError>;
}
interface CommandDefinition {
  readonly name: string;
  readonly mode: "read" | "write";
  readonly run: (context: CommerceCommandContext, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
}
const commands = new WeakMap<object, CommandDefinition>();
/** Private trusted composition; command data cannot supply callbacks or authority. */
export function defineCommerceCommand(name: string, mode: "read" | "write", run: CommandDefinition["run"]): CommerceCommand {
  // SAFETY: the WeakMap authenticates this exact callback and mode.
  const token = Object.freeze({}) as CommerceCommand;
  commands.set(token, Object.freeze({ name, mode, run }));
  return token;
}
export interface CommerceHost {
  readonly newRequestKey: () => string;
  readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly run: (key: string, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly initialize: (rows: Json) => Effect.Effect<Json, CommerceTransactionError>;
}

export const getCommerceCommand = (token: CommerceCommand): CommandDefinition | undefined => commands.get(token);
