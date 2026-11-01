import { Deferred, Effect, Result } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreRequestIdentity } from "../../core/api";
import type { CoreApplicationOwner } from "../../core/applicationOwner";
import { captureCommerceJsonData } from "../commerceTransaction/json";
import { commerceError, type CommerceTransactionError } from "../commerceTransaction/model";
import type { AtomicCommerceCommand } from "./commands";

declare const requestBrand: unique symbol;
export interface AtomicCommerceNativeRequest { readonly [requestBrand]: true }
export type AtomicCommerceNativeCorrelation = Extract<CoreRequestIdentity, { kind: "nativeRoot" }>;
interface RequestData {
  readonly key: string;
  readonly command: AtomicCommerceCommand;
  readonly arguments: ReturnType<typeof captureCommerceJsonData>;
  prepared?: Readonly<{ identity: AtomicCommerceNativeCorrelation; bytes: number }>;
}
const requests = new WeakMap<object, RequestData>();

/** Inside admitted host use, argument ownership precedes hashing and native
 * awaits. Unstarted facade Effects retain no argument copy. This token carries no
 * binding, generation, callback or settlement grant. Only a host can bind its
 * captured correlation after checking its authentic prepared command/profile. */
export function captureAtomicCommerceNativeRequest(key: string, command: AtomicCommerceCommand, args: Json, maximumBytes: number): AtomicCommerceNativeRequest {
  // SAFETY: only this private registry authenticates owned request data.
  const token = Object.freeze({}) as AtomicCommerceNativeRequest;
  requests.set(token, { key, command, arguments: Object.freeze(captureCommerceJsonData(args, maximumBytes)) });
  return token;
}
export function readAtomicCommerceNativeRequest(token: AtomicCommerceNativeRequest) {
  const data = requests.get(token);
  return data === undefined ? undefined : Object.freeze({ ...data });
}
export function bindAtomicCommerceNativeRequest(token: AtomicCommerceNativeRequest, identity: AtomicCommerceNativeCorrelation, bytes: number) {
  const data = requests.get(token);
  if (data === undefined) return Result.fail(commerceError("invalidAuthority"));
  if (data.prepared !== undefined && !sameAtomicCommerceNativeCorrelation(data.prepared.identity, identity))
    return Result.fail(commerceError("requestConflict"));
  data.prepared ??= Object.freeze({ identity: Object.freeze({ ...identity, root: Object.freeze({ ...identity.root }) }), bytes });
  return Result.succeed(data.prepared);
}
export const sameAtomicCommerceNativeCorrelation = (left: AtomicCommerceNativeCorrelation, right: AtomicCommerceNativeCorrelation) =>
  left.key === right.key && left.root.definitionHash === right.root.definitionHash && left.requestHash === right.requestHash;

interface Slot { readonly identity: AtomicCommerceNativeCorrelation; readonly done: Deferred.Deferred<Json, CommerceTransactionError> }
const owners = new WeakMap<object, Map<string, Slot>>();
type AtomicCommerceNativeRequestOwner = Pick<CoreApplicationOwner<unknown>, "close">;

/** Called only inside the actual app-owner admission. Its existing invocation
 * bound covers every leader and follower; there is no completed receipt cache,
 * independent admission or timer. Core remains the durable request authority. */
export const joinAtomicCommerceNativeRequest: (owner: AtomicCommerceNativeRequestOwner, identity: AtomicCommerceNativeCorrelation,
  work: Effect.Effect<Json, CommerceTransactionError>) => Effect.Effect<Json, CommerceTransactionError> = Effect.fn("AtomicCommerceNative.joinRequest")(function* (
  owner: AtomicCommerceNativeRequestOwner, identity: AtomicCommerceNativeCorrelation, work: Effect.Effect<Json, CommerceTransactionError>,
) {
  return yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    let current = owners.get(owner);
    if (current === undefined) { current = new Map(); owners.set(owner, current); }
    const slots = current;
    const existing = slots.get(identity.key);
    if (existing !== undefined) {
      if (!sameAtomicCommerceNativeCorrelation(existing.identity, identity)) return yield* commerceError("requestConflict");
      // Interrupting this wait leaves the leader and every other borrow alone.
      return yield* restore(Deferred.await(existing.done));
    }
    const slot: Slot = { identity, done: Deferred.makeUnsafe<Json, CommerceTransactionError>() };
    slots.set(identity.key, slot);
    return yield* Effect.gen(function* () {
      // work owns the native callback and all of its cleanup. Publish its full
      // Exit only after drainage; no follower is promoted to execute a body.
      // The actual native host returns canonical immutable JSON, including cold
      // outcomes. Sharing that owner-issued value cannot transfer mutation.
      const result = yield* Effect.exit(restore(work));
      yield* Deferred.done(slot.done, result);
      return yield* result;
    }).pipe(Effect.ensuring(Effect.sync(() => { if (slots.get(identity.key) === slot) slots.delete(identity.key); })));
  }));
});
