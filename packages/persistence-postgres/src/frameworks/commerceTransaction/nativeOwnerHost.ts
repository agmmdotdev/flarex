import { Cause, Effect } from "effect";
import type { CoreApplicationOwner } from "../../core/applicationOwner";
import type { CoreError } from "../../core/api";
import { PreparedHostRuntimeError, retainPreparedHost, type PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import type { CommerceHost } from "./commands";
import { commerceError, CommerceTransactionError } from "./model";

/** The outer app supplies its one supervisor. Selection is lazy and all returned
 * profile resources belong to that generation's Scope, never an invocation. */
export interface NativeOwnerHostInput<Prepared, BuildFailure> {
  readonly owner: CoreApplicationOwner<Prepared, BuildFailure>;
  readonly hostRuntime: PreparedHostRuntime;
  readonly select: (prepared: Prepared) => Effect.Effect<CommerceHost, CommerceTransactionError>;
  readonly projectOwnerFailure: (failure: CoreError | BuildFailure | CommerceTransactionError) => CommerceTransactionError;
}
const projectRetention = (failure: CommerceTransactionError | PreparedHostRuntimeError) =>
  failure instanceof PreparedHostRuntimeError
    ? commerceError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Stable framework facade; recovery is a readiness preflight, not body replay.
 * The existing retained lease drains only this facade's actual borrows. */
export const makeNativeOwnerHost = Effect.fn("CommerceNativeOwnerHost.make")(function* <Prepared, BuildFailure>(
  input: NativeOwnerHostInput<Prepared, BuildFailure>,
): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const { owner, hostRuntime, select, projectOwnerFailure } = input;
  let selectedHost: CommerceHost | undefined;
  const use = <A>(work: (host: CommerceHost) => Effect.Effect<A, CommerceTransactionError>) =>
    owner.recover.pipe(Effect.andThen(owner.use(prepared => select(prepared).pipe(
      Effect.tap(host => Effect.sync(() => { selectedHost = host; })), Effect.flatMap(work)))),
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectOwnerFailure))));
  const retained = yield* retainPreparedHost(hostRuntime, Effect.succeed({
    run: (key: string, command: Parameters<CommerceHost["run"]>[1], args: Parameters<CommerceHost["run"]>[2]) =>
      use(host => host.run(key, command, args)),
    read: (command: Parameters<CommerceHost["read"]>[0], args: Parameters<CommerceHost["read"]>[1]) =>
      use(host => host.read(command, args)),
    initialize: (rows: Parameters<CommerceHost["initialize"]>[0]) => use(host => host.initialize(rows)),
  })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention))));
  // A profile cleanup is one settled operation. Concurrent and later callers
  // observe the same full Exit, including a failure from the selected host.
  const close = yield* Effect.cached(Effect.uninterruptible(Effect.gen(function* () {
    yield* retained.close;
    if (selectedHost !== undefined) yield* selectedHost.close;
    selectedHost = undefined;
  })));
  return Object.freeze({ close, newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    run: (key, command, args) => retained.use(host => host.run(key, command, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention)))),
    read: (command, args) => retained.use(host => host.read(command, args)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention)))),
    initialize: rows => retained.use(host => host.initialize(rows)).pipe(
      Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention)))),
  } satisfies CommerceHost);
});
