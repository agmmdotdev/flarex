import { Cause, Effect, Exit, Option } from "effect";
import { makeNativeOwnerProfile, type NativeOwnerHostInput } from "../commerceTransaction/nativeOwnerHost";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import type { AtomicCommerceHost } from "./commands";
import type { AtomicCommerceNativeHost } from "./nativeHost";
import { joinAtomicCommerceNativeRequest, type AtomicCommerceNativeRequest } from "./nativeRequest";

/** Atomic profiles borrow the same app-generation and facade-drain owner as
 * native services. This surface grants neither initialization nor Task entry. */
export const makeAtomicCommerceNativeOwnerHost = Effect.fn("AtomicCommerceNativeOwnerHost.make")(function* <Prepared, BuildFailure>(
  input: NativeOwnerHostInput<Prepared, BuildFailure, AtomicCommerceNativeHost>,
): Effect.fn.Return<AtomicCommerceHost, CommerceTransactionError> {
  const profile = yield* makeNativeOwnerProfile(input);
  return Object.freeze({ close: profile.close, newRequestKey: () => `commerce/atomic/${crypto.randomUUID()}`,
    run: (key, command, args) => Effect.gen(function* () {
      let request: AtomicCommerceNativeRequest | undefined;
      const attempted = yield* Effect.exit(profile.use(host => host.captureRequest(key, command, args).pipe(Effect.flatMap(captured => {
        request = captured;
        return host.prepareRequest(captured).pipe(Effect.flatMap(identity => joinAtomicCommerceNativeRequest(input.owner, identity, host.runCaptured(captured))));
      }))));
      if (Exit.isSuccess(attempted)) return attempted.value;
      const [reason] = attempted.cause.reasons;
      if (attempted.cause.reasons.length !== 1 || reason === undefined || !Cause.isFailReason(reason)
        || reason.error.reason !== "decisionUncertain") return yield* Effect.failCause(attempted.cause);
      // The first borrow has settled. Recovery may now drain/reconstruct its
      // generation. The second borrow performs historical lookup only.
      const captured = request;
      if (captured === undefined) return yield* Effect.failCause(Cause.combine(attempted.cause, Cause.fail(commerceError("invalidAuthority"))));
      const recovered = yield* Effect.exit(profile.use(host => host.recoverCaptured(captured)));
      if (Exit.isFailure(recovered)) return yield* Effect.failCause(Cause.combine(attempted.cause, recovered.cause));
      return Option.isSome(recovered.value) ? recovered.value.value : yield* Effect.failCause(attempted.cause);
    }),
  } satisfies AtomicCommerceHost);
});
