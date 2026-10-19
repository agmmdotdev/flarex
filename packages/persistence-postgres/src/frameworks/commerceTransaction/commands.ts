import type { CommerceResources } from "./resources";
import type { Effect, Result } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CommerceStore } from "./storeModel";
import type { BoundedRequestContext } from "../../execution/preparation/boundedRequestLifetime";
import type { CommerceTransactionError } from "./model";
import type { LogicalSetNullPolicy } from "../../storage/documents/logicalDocuments/model";
export interface CommerceDeletedReferenceSelection {
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly targetKey: string;
}
export interface CommerceSetNullSelection {
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly targetKey: string;
  readonly managedUpdate: LogicalSetNullPolicy["managedUpdate"];
}
export interface CommerceReferenceReplacement {
  readonly sourceTable: string;
  readonly sourceColumn: string;
  readonly targetTable: string;
  readonly targetColumn: string;
  readonly targetKey: string;
  readonly desiredKeys: readonly string[];
}

declare const commandBrand: unique symbol;
export interface CommerceCommand { readonly [commandBrand]: true }
export interface CommerceCommandContext {
  readonly resources: CommerceResources;
  readonly manager: BoundedRequestContext;
  readonly store: CommerceStore;
  readonly table: (tableId: string) => Effect.Effect<CommerceStore, CommerceTransactionError>;
  /** PostgreSQL transaction-start time, available to admitted logical rows. */
  readonly transactionTime?: Effect.Effect<string, CommerceTransactionError>;
  /** Available only to admitted logical relational participants. Physical
   * compatibility commands keep their existing bounded row operations. */
  readonly planSetNull?: (selection: CommerceSetNullSelection) => Effect.Effect<void, CommerceTransactionError>;
  /** Eager FK-only cleanup after an actual deletion in the same outer call.
   * Trusted logical participants only; managed timestamps are preserved. */
  readonly detachDeletedReference?: (selection: CommerceDeletedReferenceSelection) => Effect.Effect<void, CommerceTransactionError>;
  /** Seals one declared nullable-reference replacement for core settlement. */
  readonly planReferenceReplacement?: (selection: CommerceReferenceReplacement) => Effect.Effect<void, CommerceTransactionError>;
  readonly captureLocalEvent: (event: unknown) => Effect.Effect<void, CommerceTransactionError>;
  readonly nested: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly rejectEvent: Effect.Effect<never, CommerceTransactionError>;
  readonly refuse: (error: CommerceTransactionError) => Effect.Effect<never, CommerceTransactionError>;
  /** Trusted queued profile only. Capture and charge owned JSON before waiting;
   * the callback receives that snapshot and no settlement capability. */
  readonly enqueue?: <Value>(prepare: () => Result.Result<Json, CommerceTransactionError>,
    work: (captured: Json) => Effect.Effect<Value, CommerceTransactionError>) => Effect.Effect<Value, CommerceTransactionError>;
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
  readonly close: Effect.Effect<void>;
  readonly newRequestKey: () => string;
  readonly read: (command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly run: (key: string, command: CommerceCommand, args: Json) => Effect.Effect<Json, CommerceTransactionError>;
  readonly initialize: (rows: Json) => Effect.Effect<Json, CommerceTransactionError>;
}

export const getCommerceCommand = (token: CommerceCommand): CommandDefinition | undefined => commands.get(token);
