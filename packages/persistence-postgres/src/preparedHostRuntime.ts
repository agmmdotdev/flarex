import {
  Context,
  Data,
  Deferred,
  Effect,
  Exit,
  Option,
  Result,
  Schema,
} from "effect";
import { measureCanonicalJsonUtf8Bytes } from "flarex-protocol/json";

export class PreparedHostRuntimeError extends Data.TaggedError(
  "PreparedHostRuntimeError",
)<{
  readonly reason:
    | "invalidLimits"
    | "invalidRuntime"
    | "closed"
    | "capacityExceeded"
    | "invalidPayload";
}> {}
const error = (reason: PreparedHostRuntimeError["reason"]) =>
  new PreparedHostRuntimeError({ reason });
const positive = Schema.Number.check(
  Schema.makeFilter((value) =>
    Number.isSafeInteger(value) && value > 0
      ? undefined
      : "Expected positive safe integer",
  ),
);
const limitsSchema = Schema.Struct({
  maximumHosts: positive,
  maximumPreparedBytes: positive,
});
const decodeLimits = Schema.decodeUnknownEffect(limitsSchema);
declare const runtimeBrand: unique symbol;
export interface PreparedHostRuntime {
  readonly [runtimeBrand]: true;
}
interface Owner {
  readonly maximumHosts: number;
  readonly maximumPreparedBytes: number;
  readonly leases: Set<Readonly<{ close: Effect.Effect<void> }>>;
  closed: boolean;
  bytes: number;
}
const owners = new WeakMap<object, Owner>();
export type PreparedHostPreparationCharge = (value: unknown) => Result.Result<void, PreparedHostRuntimeError>;
class PreparationCharge extends Context.Service<
  PreparationCharge,
  {
    readonly charge: (
      value: unknown,
    ) => Effect.Effect<void, PreparedHostRuntimeError>;
    readonly chargeResult: PreparedHostPreparationCharge;
    readonly checkOpen: () => Result.Result<void, PreparedHostRuntimeError>;
  }
>()("Flarex/HostPreparationCharge") {}

/** A shared composition resource, not one implicit runtime per shop. */
export const makePreparedHostRuntime = Effect.fn("PreparedHostRuntime.make")(
  function* (input: {
    readonly maximumHosts: number;
    readonly maximumPreparedBytes: number;
  }) {
    const limits = yield* decodeLimits(input).pipe(
      Effect.mapError(() => error("invalidLimits")),
    );
    const owner: Owner = {
      ...limits,
      leases: new Set(),
      closed: false,
      bytes: 0,
    };
    yield* Effect.addFinalizer(() =>
      Effect.suspend(() => {
        owner.closed = true;
        return Effect.forEach([...owner.leases], (lease) => lease.close, {
          concurrency: "unbounded",
          discard: true,
        });
      }),
    );
    // SAFETY: only this private registry authenticates the inert runtime token.
    const runtime = Object.freeze({}) as PreparedHostRuntime;
    owners.set(runtime, owner);
    return runtime;
  },
);

/** Called only by preparation owners, never adapters. Request-owned preparation
 * outside host construction does not borrow the retained-host allocation. */
export const chargeHostPreparation = Effect.fn("PreparedHostRuntime.charge")(
  function* (value: unknown) {
    const allocation = yield* Effect.serviceOption(PreparationCharge);
    if (Option.isSome(allocation)) yield* allocation.value.charge(value);
  },
);

/** A lazy preparation owner may retain its actual host allocation. The lease
 * rejects charges after close and accounts retained bytes until disposal. */
export const captureHostPreparationCharge = Effect.fn("PreparedHostRuntime.captureCharge")(
  function* () {
    const allocation = yield* Effect.serviceOption(PreparationCharge);
    return Option.isSome(allocation) ? allocation.value.chargeResult : undefined;
  },
);

/** Observe the existing construction lease without charging retained payloads
 * again. Request-owned construction has no retained-host lease to borrow. */
export const captureHostPreparationLifetime = Effect.fn("PreparedHostRuntime.captureLifetime")(function* () {
  const allocation = yield* Effect.serviceOption(PreparationCharge);
  return Option.isSome(allocation) ? Object.freeze({ charge: allocation.value.chargeResult,
    checkOpen: allocation.value.checkOpen }) : undefined;
});

/** Source-private resource owner. Public methods delegate through use; explicit
 * metadata reconstruction borrows the same retained construction allocation. */
export const retainPreparedHost = Effect.fn("PreparedHostRuntime.retain")(
  function* <Value extends object, Failure, Requirements>(
    runtime: PreparedHostRuntime,
    construction: Effect.Effect<Value, Failure, Requirements>,
  ) {
    const owner = owners.get(runtime);
    if (owner === undefined)
      return yield* Effect.fail(error("invalidRuntime"));
    return yield* Effect.acquireUseRelease(
      makeLease<Value>(owner),
      lease => construction.pipe(
        Effect.provideService(PreparationCharge, { charge: lease.charge, chargeResult: lease.chargeResult, checkOpen: lease.checkOpen }),
        Effect.flatMap(host => lease.install(host)),
        Effect.as(lease.access),
      ),
      // Construction and installation share the interruptible use. Only a
      // successful handoff transfers the lease to the runtime's lifetime.
      (lease, exit) => Exit.isFailure(exit) ? lease.abandon : Effect.void,
    );
  },
);

/** A separate closure environment keeps escaped accessors independent of the
 * construction Effect, its captured inputs and its completed Exit value. */
const makeLease = Effect.fn("PreparedHostRuntime.reserve")(function* <
  Value extends object,
>(owner: Owner) {
  const done = yield* Deferred.make<void>();
  let value: Value | undefined;
  let active = 1; // Construction also owns its reservation until it settles.
  let closing = false;
  let bytes = 0;
  let rejected: PreparedHostRuntimeError | undefined;
  const finish = Effect.suspend(() => {
    if (!closing || active !== 0 || !owner.leases.delete(lease))
      return Effect.void;
    value = undefined;
    owner.bytes -= bytes;
    bytes = 0;
    return Deferred.succeed(done, undefined).pipe(Effect.asVoid);
  });
  const close = Effect.suspend(() => {
    closing = true;
    return finish.pipe(Effect.andThen(Deferred.await(done)));
  });
  const lease = { close };
  yield* Effect.suspend(() => {
    if (owner.closed) return Effect.fail(error("closed"));
    if (owner.leases.size >= owner.maximumHosts)
      return Effect.fail(error("capacityExceeded"));
    owner.leases.add(lease);
    return Effect.void;
  });
  const chargeResult: PreparedHostPreparationCharge = data => {
    if (owner.closed || closing) return Result.fail(error("closed"));
    if (rejected !== undefined) return Result.fail(rejected);
    return measurePayload(data, owner.maximumPreparedBytes - owner.bytes).pipe(
      Result.map(size => { owner.bytes += size; bytes += size; }),
      Result.mapError(cause => { rejected = cause; return cause; }));
  };
  const checkOpen = (): Result.Result<void, PreparedHostRuntimeError> => owner.closed || closing ? Result.fail(error("closed")) :
    rejected === undefined ? Result.succeed(undefined) : Result.fail(rejected);
  /** Read the real lease accounting without charging or exposing its value. */
  const readUsage = (): Result.Result<Readonly<{ chargedBytes: number }>, PreparedHostRuntimeError> =>
    checkOpen().pipe(Result.map(() => Object.freeze({ chargedBytes: bytes })));
  const charge = (data: unknown) => Effect.suspend(() => Effect.fromResult(chargeResult(data)));
  const abandon = Effect.suspend(() => {
    active = 0;
    closing = true;
    return finish;
  });
  const install = Effect.fn("PreparedHostRuntime.install")((host: Value) =>
    Effect.suspend(() => {
      active = 0;
      if (owner.closed || closing || rejected !== undefined) {
        closing = true;
        return finish.pipe(
          Effect.andThen(Effect.fail(rejected ?? error("closed"))),
        );
      }
      value = host;
      return Effect.void;
    }));
  const use = <A, E, R>(
    work: (host: Value) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PreparedHostRuntimeError, R> =>
    Effect.acquireUseRelease(
      Effect.suspend(() => {
        if (owner.closed || closing || value === undefined)
          return Effect.fail(error("closed"));
        if (rejected !== undefined) return Effect.fail(rejected);
        active++;
        return Effect.succeed(value);
      }),
      (host) => Effect.suspend(() => work(host)),
      () =>
        Effect.suspend(() => {
          active--;
          return finish;
        }),
    );
  const reconstruct = <A, E, R>(
    work: (host: Value) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | PreparedHostRuntimeError, R> =>
    use(host => Effect.suspend(() => work(host)).pipe(
      Effect.provideService(PreparationCharge, { charge, chargeResult, checkOpen }),
      // A callback may catch a charge refusal, or close may start during its
      // work. Neither permits a newly constructed capability to escape.
      Effect.tap(() => Effect.fromResult(checkOpen())),
    ));
  return { charge, chargeResult, checkOpen, abandon, install, access: Object.freeze({ use, reconstruct, close, readUsage }) };
});

/** Bounded structural payload accounting. Repeated references are deliberately
 * charged repeatedly; symbols are private brands, not payload. No authority
 * capability, accessor or arbitrary class instance is a supported data value. */
function measurePayload(
  value: unknown,
  maximum: number,
): Result.Result<number, PreparedHostRuntimeError> {
  if (maximum <= 0) return Result.fail(error("capacityExceeded"));
  let remaining = maximum;
  const spend = (bytes: number): boolean => {
    remaining -= bytes;
    return remaining >= 0;
  };
  const visit = (input: unknown, depth: number): boolean => {
    if (depth > 64) return false;
    if (input instanceof Uint8Array) return spend(16 + input.byteLength);
    if (typeof input === "bigint") return spend(16 + input.toString().length);
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "number" ||
      typeof input === "boolean"
    ) {
      const size = measureCanonicalJsonUtf8Bytes(input, remaining);
      if (size.kind === "exceeded") remaining = -1;
      return size.kind === "success" && spend(16 + size.bytes);
    }
    if (typeof input !== "object" || input === undefined) return false;
    if (!spend(32)) return false;
    if (input instanceof Map) {
      for (const [key, member] of input)
        if (!visit(key, depth + 1) || !visit(member, depth + 1)) return false;
      return true;
    }
    if (
      !Array.isArray(input) &&
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    )
      return false;
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(input),
    )) {
      if (Array.isArray(input) && key === "length") continue;
      if (
        !("value" in descriptor) ||
        !visit(key, depth + 1) ||
        !visit(descriptor.value, depth + 1)
      )
        return false;
    }
    return true;
  };
  const measured = Result.try({
    try: () => visit(value, 0),
    catch: () => error("invalidPayload"),
  });
  return Result.flatMap(measured, (valid) =>
    valid
      ? Result.succeed(maximum - remaining)
      : Result.fail(
          error(remaining < 0 ? "capacityExceeded" : "invalidPayload"),
        ),
  );
}
