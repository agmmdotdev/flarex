import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { captureRelationalData } from "./data";
import type { PublicationTestHooks } from "../commitPublication/model";
import type { FlarexMetadataDatabase } from "../deployments";
import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
} from "../scopeAuthorityResolution";
import type { TrustedScopeAuthorityResolutionPorts } from "../scopeAuthorityResolution";
import {
  hasFrameworkMigrationTargetDatabase,
  frameworkMigrationTargetSnapshot,
} from "../migrationCoordination/targetSession";
import type { FrameworkMigrationTarget } from "../migrationCoordination/targetSession";
import { hasLocatedReadCommittedTargetDatabaseV1 } from "../transactionSessionAttemptKernel";
import type { LocatedReadCommittedAttemptTargetV1 } from "../transactionSessionAttemptKernel";
import { scopePhysicalLocatorsEqual } from "../scopePhysicalLocator";
import {
  admitSyntheticBindingInTransaction,
  captureSyntheticBindingReference,
} from "../frameworkSchema/binding/syntheticAdmission";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { hasRelationalSessionDatabase, runRelationalSession } from "./session";
import type { RelationalSession } from "./session";
import { requireRelationalLifetime, withRelationalLifetime } from "./lifetime";
import { bindRelationalStore } from "./store";
import {
  relationalError,
  relationalLimits,
  RelationalTransactionError,
} from "./model";
import type {
  RelationalStore,
  RelationalTransaction,
  RelationalSessionError,
} from "./model";

declare const commandBrand: unique symbol;
export interface RelationalCommand<Input, Value, Failure> {
  readonly [commandBrand]: Readonly<{
    input: (value: Input) => Input;
    value: Value;
    failure: Failure;
  }>;
}
export interface RelationalCommandContext {
  readonly transaction: RelationalTransaction;
  readonly store: RelationalStore;
  readonly nested: <Input, Value, Failure>(
    borrowed: RelationalTransaction,
    command: RelationalCommand<Input, Value, Failure>,
    input: Input,
  ) => Effect.Effect<Value, Failure | RelationalTransactionError>;
}
type StoredCommand = (
  context: RelationalCommandContext,
  input: unknown,
) => Effect.Effect<unknown, unknown>;
const commands = new WeakMap<object, StoredCommand>();
/** Trusted composition only. Not exported through a package entry point. */
export function defineRelationalCommand<Input, Value, Failure>(
  run: (
    context: RelationalCommandContext,
    input: Input,
  ) => Effect.Effect<Value, Failure>,
): RelationalCommand<Input, Value, Failure> {
  // SAFETY: the inert token carries its own callback's input/output contract.
  const token = Object.freeze({}) as RelationalCommand<Input, Value, Failure>;
  commands.set(token, (context, input) => {
    // SAFETY: registration retains the input contract of this exact command token.
    return run(context, input as Input);
  });
  return token;
}
export interface RelationalHostInput {
  readonly database: FlarexMetadataDatabase;
  readonly session: RelationalSession;
  readonly target: FrameworkMigrationTarget;
  readonly deploymentId: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  readonly commands: readonly object[];
}
type AdmissionFailure =
  | Effect.Error<ReturnType<typeof admitSyntheticBindingInTransaction>>
  | Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityEffect>>
  | Effect.Error<ReturnType<typeof captureSyntheticBindingReference>>
  | RelationalSessionError;
export interface RelationalHost {
  readonly run: <Input, Value, Failure>(
    reference: unknown,
    command: RelationalCommand<Input, Value, Failure>,
    input: Input,
  ) => Effect.Effect<
    Value,
    Failure | RelationalTransactionError | AdmissionFailure
  >;
}
const invoke = Effect.fn("RelationalHost.invoke")(function* <
  Input,
  Value,
  Failure,
>(
  allowed: ReadonlySet<object>,
  token: RelationalTransaction,
  command: RelationalCommand<Input, Value, Failure>,
  input: Input,
  depth: number,
): Effect.fn.Return<Value, Failure | RelationalTransactionError> {
  const state = yield* requireRelationalLifetime(token);
  state.activeCommands += 1;
  return yield* Effect.gen(function* () {
    const run = commands.get(command);
    state.calls += 1;
    if (state.calls > relationalLimits.calls)
      return yield* Effect.fail(relationalError("limitExceeded"));
    if (run === undefined || !allowed.has(command))
      return yield* Effect.fail(relationalError("invalidAuthority"));
    if (depth > 8) return yield* Effect.fail(relationalError("limitExceeded"));
    const captured = yield* captureCommandInput(input);
    state.bytes += captured.bytes;
    if (state.bytes > relationalLimits.commandBytes)
      return yield* Effect.fail(relationalError("limitExceeded"));
    let nestedActive = false;
    const context: RelationalCommandContext = Object.freeze({
      transaction: token,
      store: bindRelationalStore(token),
      nested: Effect.fn("RelationalHost.borrow")(
        <NestedInput, NestedValue, NestedFailure>(
          borrowed: RelationalTransaction,
          child: RelationalCommand<NestedInput, NestedValue, NestedFailure>,
          childInput: NestedInput,
        ): Effect.Effect<
          NestedValue,
          NestedFailure | RelationalTransactionError
        > =>
          Effect.gen(function* () {
            if (borrowed !== token) {
              if (state.status === "open") state.status = "rollbackOnly";
              return yield* Effect.fail(relationalError("invalidAuthority"));
            }
            if (nestedActive || state.busy) {
              if (state.status === "open") state.status = "rollbackOnly";
              return yield* Effect.fail(
                relationalError("overlappingOperation"),
              );
            }
            nestedActive = true;
            return yield* invoke(
              allowed,
              borrowed,
              child,
              childInput,
              depth + 1,
            ).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  nestedActive = false;
                }),
              ),
            );
          }),
      ),
    });
    // SAFETY: only the callback stored for this exact typed command is invoked.
    const work = Effect.suspend(() =>
      run(context, captured.value),
    ) as Effect.Effect<Value, Failure>;
    const value = yield* work;
    if (value !== undefined) {
      const output = yield* Effect.fromResult(
        captureRelationalData(
          value,
          relationalLimits.commandBytes - state.bytes,
        ),
      );
      state.bytes += output.bytes;
      // SAFETY: only detached JSON data is admitted as command output; no live capability is returned.
      return output.value as Value;
    }
    return value;
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        state.activeCommands -= 1;
      }),
    ),
    Effect.tapCause(() =>
      Effect.sync(() => {
        if (state.status === "open") state.status = "rollbackOnly";
      }),
    ),
  );
});

export const makeRelationalHost = Effect.fn("RelationalHost.make")(function* (
  input: RelationalHostInput,
  testHooks?: PublicationTestHooks,
): Effect.fn.Return<RelationalHost, RelationalTransactionError> {
  const { database, session, target, deploymentId } = input;
  const hooks =
    testHooks === undefined ? undefined : Object.freeze({ ...testHooks });
  const snapshot = frameworkMigrationTargetSnapshot(target);
  if (
    !hasRelationalSessionDatabase(session, database) ||
    !hasFrameworkMigrationTargetDatabase(target, database) ||
    snapshot === undefined ||
    snapshot.namespace.frame.deploymentId !== deploymentId ||
    input.commands.length === 0 ||
    input.commands.length > 64 ||
    input.commands.some((command) => !commands.has(command))
  )
    return yield* Effect.fail(relationalError("invalidAuthority"));
  const allowed = new Set(input.commands);
  const authority = captureTrustedScopeAuthorityResolutionPorts(
    input.authority,
  );
  const run: RelationalHost["run"] = Effect.fn("RelationalHost.run")(
    function* (referenceInput, command, commandInput) {
      if (!allowed.has(command))
        return yield* Effect.fail(relationalError("invalidAuthority"));
      const capturedInput = yield* captureCommandInput(commandInput);
      const reference = yield* captureSyntheticBindingReference(referenceInput);
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        deploymentId,
        authority,
      );
      if (
        !hasLocatedReadCommittedTargetDatabaseV1(located.target, database) ||
        !scopePhysicalLocatorsEqual(
          located.authority.physicalLocator,
          snapshot.physicalLocator,
        )
      )
        return yield* Effect.fail(relationalError("invalidAuthority"));
      return yield* runRelationalSession(session, (tx) =>
        Effect.gen(function* () {
          yield* runDrizzleStatementEffect(
            tx.execute(
              sql`select set_config('statement_timeout', '1000ms', true), set_config('lock_timeout', '500ms', true)`,
            ),
            (cause) => relationalError("statementFailure", cause),
          );
          const admitted = yield* admitSyntheticBindingInTransaction(
            tx,
            located.authority,
            snapshot,
            reference,
          );
          return yield* withRelationalLifetime(
            tx,
            located.authority,
            admitted,
            (token) => invoke(allowed, token, command, capturedInput.value, 0),
            hooks,
          );
        }).pipe(
          Effect.timeoutOrElse({
            duration: relationalLimits.commandMs,
            orElse: () => Effect.fail(relationalError("deadlineExceeded")),
          }),
        ),
      );
    },
  );
  return Object.freeze({ run });
});

const captureCommandInput = Effect.fn("RelationalHost.captureInput")(
  <Input>(input: Input) =>
    Effect.fromResult(
      captureRelationalData(input, relationalLimits.commandBytes),
    ).pipe(
      Effect.map((captured) => {
        // SAFETY: descriptor capture detaches JSON data without changing the registered command's data shape.
        return { value: captured.value as Input, bytes: captured.bytes };
      }),
    ),
);
