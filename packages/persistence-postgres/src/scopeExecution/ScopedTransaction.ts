import { Effect } from "effect";

import type { AppRowTransaction } from "../appRows";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import { ScopedTransactionCapabilityError } from "./Errors";

declare const scopedTransactionBrand: unique symbol;
declare const scopedOperationBrand: unique symbol;

/** Opaque authority for one guarded database transaction. */
export interface ScopedTransaction {
  readonly [scopedTransactionBrand]: true;
}

export interface ScopedTransactionContext {
  readonly mode: "read" | "write";
  readonly authority: TrustedScopeAuthority;
  readonly clock: ScopeClockRecord;
}

interface ScopedTransactionOperation<
  Mode extends "read" | "write",
  Input,
  Value,
  Failure,
> {
  readonly [scopedOperationBrand]: {
    readonly mode: Mode;
    readonly input: Input;
    readonly value: Value;
    readonly failure: Failure;
  };
}

export type ScopedReadOperation<Input, Value, Failure> =
  ScopedTransactionOperation<"read", Input, Value, Failure>;

export type ScopedWriteOperation<Input, Value, Failure> =
  ScopedTransactionOperation<"write", Input, Value, Failure>;

interface ScopedTransactionState {
  open: boolean;
  readonly transaction: AppRowTransaction;
  readonly context: ScopedTransactionContext;
}

interface ScopedOperationState {
  readonly mode: "read" | "write";
  readonly run: (
    transaction: AppRowTransaction,
    context: ScopedTransactionContext,
    input: unknown,
    capability: ScopedTransaction,
  ) => Effect.Effect<unknown, unknown>;
}

const transactionStates = new WeakMap<
  ScopedTransaction,
  ScopedTransactionState
>();
const operationStates = new WeakMap<object, ScopedOperationState>();

export function defineScopedReadOperation<Input, Value, Failure>(
  run: (
    transaction: AppRowTransaction,
    context: ScopedTransactionContext,
    input: Input,
    capability: ScopedTransaction,
  ) => Effect.Effect<Value, Failure>,
): ScopedReadOperation<Input, Value, Failure> {
  return defineScopedOperation("read", run);
}

export function defineScopedWriteOperation<Input, Value, Failure>(
  run: (
    transaction: AppRowTransaction,
    context: ScopedTransactionContext,
    input: Input,
    capability: ScopedTransaction,
  ) => Effect.Effect<Value, Failure>,
): ScopedWriteOperation<Input, Value, Failure> {
  return defineScopedOperation("write", run);
}

export function issueScopedTransaction(
  transaction: AppRowTransaction,
  context: ScopedTransactionContext,
): ScopedTransaction {
  const capability = Object.freeze({}) as ScopedTransaction;
  transactionStates.set(capability, {
    open: true,
    transaction,
    context,
  });
  return capability;
}

export function closeScopedTransaction(capability: ScopedTransaction): void {
  const state = transactionStates.get(capability);
  if (state !== undefined) state.open = false;
}

/** Package-local diagnostic surface that never exposes executable SQL. */
export function inspectScopedTransactionContextEffect(
  capability: ScopedTransaction,
): Effect.Effect<ScopedTransactionContext> {
  return Effect.suspend(() => {
    const state = typeof capability === "object" && capability !== null
      ? transactionStates.get(capability)
      : undefined;
    if (state === undefined) {
      return Effect.die(new ScopedTransactionCapabilityError("invalid"));
    }
    return state.open
      ? Effect.succeed(state.context)
      : Effect.die(new ScopedTransactionCapabilityError("closed"));
  });
}

/**
 * Executes only a package-owned operation registered before request handling.
 * Dynamic callers never receive the underlying Drizzle transaction.
 */
export function runScopedTransactionOperationEffect<Input, Value, Failure>(
  capability: ScopedTransaction,
  operation:
    | ScopedReadOperation<Input, Value, Failure>
    | ScopedWriteOperation<Input, Value, Failure>,
  input: Input,
): Effect.Effect<Value, Failure> {
  return Effect.suspend(() => {
    const transactionState = typeof capability === "object" &&
        capability !== null
      ? transactionStates.get(capability)
      : undefined;
    if (transactionState === undefined) {
      return Effect.die(new ScopedTransactionCapabilityError("invalid"));
    }
    if (!transactionState.open) {
      return Effect.die(new ScopedTransactionCapabilityError("closed"));
    }
    const operationState = typeof operation === "object" && operation !== null
      ? operationStates.get(operation)
      : undefined;
    if (
      operationState === undefined ||
      operationState.mode !== transactionState.context.mode
    ) {
      return Effect.die(new ScopedTransactionCapabilityError("invalid"));
    }
    return operationState.run(
      transactionState.transaction,
      transactionState.context,
      input,
      capability,
    ).pipe(Effect.flatMap(value =>
      value === transactionState.transaction
        ? Effect.die(new ScopedTransactionCapabilityError("invalid"))
        : Effect.succeed(value)
    )) as Effect.Effect<Value, Failure>;
  });
}

function defineScopedOperation<
  Mode extends "read" | "write",
  Input,
  Value,
  Failure,
>(
  mode: Mode,
  run: (
    transaction: AppRowTransaction,
    context: ScopedTransactionContext,
    input: Input,
    capability: ScopedTransaction,
  ) => Effect.Effect<Value, Failure>,
): ScopedTransactionOperation<Mode, Input, Value, Failure> {
  const operation = Object.freeze({}) as ScopedTransactionOperation<
    Mode,
    Input,
    Value,
    Failure
  >;
  operationStates.set(operation, Object.freeze({
    mode,
    run: (
      transaction: AppRowTransaction,
      context: ScopedTransactionContext,
      input: unknown,
      capability: ScopedTransaction,
    ) =>
      run(transaction, context, input as Input, capability),
  }));
  return operation;
}
