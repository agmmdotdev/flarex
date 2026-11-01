import { Cause, Effect } from "effect";
import type { CoreApplicationOwner } from "../../core/applicationOwner";
import type { CoreError } from "../../core/api";
import { PreparedHostRuntimeError, retainPreparedHost, type PreparedHostRuntime } from "../../execution/preparation/preparedHostRuntime";
import type { CommerceHost } from "./commands";
import { commerceError, CommerceTransactionError } from "./model";

/** The outer app supplies its one supervisor. Selection is lazy and all returned
 * profile resources belong to that generation's Scope, never an invocation. */
export interface NativeOwnerHostInput<Prepared, BuildFailure, Host extends Pick<CommerceHost, "close"> = CommerceHost> {
  readonly owner: CoreApplicationOwner<Prepared, BuildFailure>;
  readonly hostRuntime: PreparedHostRuntime;
  readonly select: (prepared: Prepared) => Effect.Effect<Host, CommerceTransactionError>;
  readonly projectOwnerFailure: (failure: CoreError | BuildFailure | CommerceTransactionError) => CommerceTransactionError;
}
const projectRetention = (failure: CommerceTransactionError | PreparedHostRuntimeError) =>
  failure instanceof PreparedHostRuntimeError
    ? commerceError(failure.reason === "closed" ? "closed" : "resourceFailure", failure) : failure;

/** Stable framework facade; recovery is a readiness preflight, not body replay.
 * The existing retained lease drains only this facade's actual borrows. */
export const makeNativeOwnerProfile = Effect.fn("NativeOwnerProfile.make")(function* <Prepared, BuildFailure, Host extends Pick<CommerceHost, "close">>(
  input: NativeOwnerHostInput<Prepared, BuildFailure, Host>,
) {
  const { owner, hostRuntime, select, projectOwnerFailure } = input;
  let selectedHost: Host | undefined;
  const use = <A>(work: (host: Host) => Effect.Effect<A, CommerceTransactionError>) =>
    owner.recover.pipe(Effect.andThen(owner.use(prepared => select(prepared).pipe(
      Effect.tap(host => Effect.sync(() => { selectedHost = host; })), Effect.flatMap(work)))),
    Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectOwnerFailure))));
  const retained = yield* retainPreparedHost(hostRuntime, Effect.succeed({ use }))
    .pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention))));
  // A profile cleanup is one settled operation. Concurrent and later callers
  // observe the same full Exit, including a failure from the selected host.
  const close = yield* Effect.cached(Effect.uninterruptible(Effect.gen(function* () {
    yield* retained.close;
    if (selectedHost !== undefined) yield* selectedHost.close;
    selectedHost = undefined;
  })));
  return Object.freeze({ close, use: <A>(work: (host: Host) => Effect.Effect<A, CommerceTransactionError>) =>
    retained.use(profile => profile.use(work)).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectRetention)))) });
});

export const makeNativeOwnerHost = Effect.fn("CommerceNativeOwnerHost.make")(function* <Prepared, BuildFailure>(
  input: NativeOwnerHostInput<Prepared, BuildFailure>,
): Effect.fn.Return<CommerceHost, CommerceTransactionError> {
  const profile = yield* makeNativeOwnerProfile(input);
  return Object.freeze({ close: profile.close, newRequestKey: () => `commerce/${crypto.randomUUID()}`,
    run: (key, command, args) => profile.use(host => host.run(key, command, args)),
    read: (command, args) => profile.use(host => host.read(command, args)),
    initialize: rows => profile.use(host => host.initialize(rows)),
  } satisfies CommerceHost);
});
