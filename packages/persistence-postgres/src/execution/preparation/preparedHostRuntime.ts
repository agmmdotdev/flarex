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
export interface PreparedHostGeneration<Value> {
  readonly use: <A, E, R>(work: (value: Value) => Effect.Effect<A, E, R>) => Effect.Effect<A, E | PreparedHostRuntimeError, R>;
  readonly retire: Effect.Effect<void>;
}
export interface PreparedHostPreparationLifetime {
  readonly charge: PreparedHostPreparationCharge;
  readonly checkOpen: () => Result.Result<void, PreparedHostRuntimeError>;
  /** Total issuer-owned cleanup, run exactly once after the last actual borrow. */
  readonly onDispose: (dispose: () => void) => Result.Result<void, PreparedHostRuntimeError>;
  readonly stage: <Value, E, R>(construction: Effect.Effect<Value, E, R>) =>
    Effect.Effect<PreparedHostGeneration<Value>, E | PreparedHostRuntimeError, R>;
}
class PreparationCharge extends Context.Service<
  PreparationCharge,
  {
    readonly charge: (
      value: unknown,
    ) => Effect.Effect<void, PreparedHostRuntimeError>;
    readonly chargeResult: PreparedHostPreparationCharge;
    readonly checkOpen: () => Result.Result<void, PreparedHostRuntimeError>;
    readonly onDispose: PreparedHostPreparationLifetime["onDispose"];
    readonly stage: PreparedHostPreparationLifetime["stage"];
  }
>()("Flarex/HostPreparationCharge") {}

/** Request evidence has its own bounded lifetime. Its authentic nested issuers
 * must not borrow a retained allocation from an ambient construction. All other
 * services, failures and resource scopes remain in the original Effect context. */
export function withoutRetainedHostPreparation<A, E, R>(
  preparation: Effect.Effect<A, E, Exclude<R, PreparationCharge>>,
): Effect.Effect<A, E, R> {
  return Effect.updateContext(preparation, (context: Context.Context<R>) =>
    Context.omit(PreparationCharge)(context));
}

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
    checkOpen: allocation.value.checkOpen, onDispose: allocation.value.onDispose, stage: allocation.value.stage }) : undefined;
});

/** Package-private issuer payload cleanup in the actual preparation allocation.
 * Request preparations outside a retained host have no disposal registration. */
export const registerHostPreparationDisposal = Effect.fn("PreparedHostRuntime.registerDisposal")(function* (dispose: () => void) {
  const allocation = yield* Effect.serviceOption(PreparationCharge);
  if (Option.isNone(allocation)) return;
  const registered = allocation.value.onDispose(dispose);
  if (Result.isFailure(registered)) dispose();
  yield* Effect.fromResult(registered);
});

/** Source-private resource owner. Public methods delegate through use; explicit
 * reconstruction stages a separate generation under this same bounded lease. */
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
        Effect.provideService(PreparationCharge, { charge: lease.charge, chargeResult: lease.chargeResult, checkOpen: lease.checkOpen, onDispose: lease.onDispose, stage: lease.stage }),
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
  let constructing = true;
  const releaseConstruction = () => { if (constructing) { constructing = false; active--; } };
  let closing = false;
  let bytes = 0;
  let rejected: PreparedHostRuntimeError | undefined;
  const generations = new Set<() => void>();
  const staticDisposals = new Set<() => void>();
  const finish = Effect.suspend(() => {
    if (!closing || active !== 0 || !owner.leases.delete(lease))
      return Effect.void;
    value = undefined;
    for (const dispose of generations) dispose();
    generations.clear();
    for (const dispose of staticDisposals) dispose();
    staticDisposals.clear();
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
  const onDispose: PreparedHostPreparationLifetime["onDispose"] = dispose => checkOpen().pipe(
    Result.map(() => { staticDisposals.add(dispose); }));
  /** Read the real lease accounting without charging or exposing its value. */
  const readUsage = (): Result.Result<Readonly<{ chargedBytes: number }>, PreparedHostRuntimeError> =>
    checkOpen().pipe(Result.map(() => Object.freeze({ chargedBytes: bytes })));
  const charge = (data: unknown) => Effect.suspend(() => Effect.fromResult(chargeResult(data)));
  const stage: PreparedHostPreparationLifetime["stage"] = construction => Effect.acquireUseRelease(
    Effect.suspend(() => {
      return Effect.fromResult(checkOpen()).pipe(Effect.map(() => { active++; return { abandon: (): void => undefined }; }));
    }),
    reservation => Effect.gen(function* () {
      let generationValue: { readonly value: Effect.Success<typeof construction> } | undefined;
      let charged = 0;
      let borrowing = 0;
      let retired = false;
      let stageRejected: PreparedHostRuntimeError | undefined;
      const disposals = new Set<() => void>();
      const dispose = () => {
        generationValue = undefined;
        for (const release of disposals) release();
        disposals.clear();
        owner.bytes -= charged;
        bytes -= charged;
        charged = 0;
        generations.delete(dispose);
      };
      const reclaim = () => { if (retired && borrowing === 0) dispose(); };
      reservation.abandon = () => { retired = true; reclaim(); };
      const generationCheck = (): Result.Result<void, PreparedHostRuntimeError> => checkOpen().pipe(
        Result.flatMap(() => stageRejected !== undefined ? Result.fail(stageRejected) :
          retired && borrowing === 0 ? Result.fail(error("closed")) : Result.succeed(undefined)));
      const generationCharge: PreparedHostPreparationCharge = data => generationCheck().pipe(
        Result.flatMap(() => measurePayload(data, owner.maximumPreparedBytes - owner.bytes)),
        Result.map(size => { owner.bytes += size; bytes += size; charged += size; }),
        Result.mapError(cause => { stageRejected ??= cause; return cause; }));
      const generationDisposal: PreparedHostPreparationLifetime["onDispose"] = release => generationCheck().pipe(
        Result.map(() => { disposals.add(release); }));
      generations.add(dispose);
      return yield* construction.pipe(
        Effect.provideService(PreparationCharge, { charge: data => Effect.suspend(() => Effect.fromResult(generationCharge(data))),
          chargeResult: generationCharge, checkOpen: generationCheck, onDispose: generationDisposal, stage }),
        Effect.tap(() => Effect.fromResult(generationCheck())),
        Effect.map(prepared => {
          generationValue = { value: prepared };
          const use: PreparedHostGeneration<Effect.Success<typeof construction>>["use"] = work => Effect.acquireUseRelease(
            Effect.suspend(() => {
              if (retired || generationValue === undefined) return Effect.fail(error("closed"));
              const current = generationValue.value;
              return Effect.fromResult(generationCheck()).pipe(Effect.map(() => { borrowing++; active++; return current; }));
            }),
            work,
            () => Effect.suspend(() => { borrowing--; active--; reclaim(); return finish; }),
          );
          return Object.freeze({ use, retire: Effect.sync(() => { retired = true; reclaim(); }) });
        }),
      );
    }),
    (reservation, outcome) => Effect.suspend(() => {
      if (Exit.isFailure(outcome)) reservation.abandon();
      active--;
      return finish;
    }),
  );
  const abandon = Effect.suspend(() => {
    releaseConstruction();
    closing = true;
    return finish.pipe(Effect.andThen(Deferred.await(done)));
  });
  const install = Effect.fn("PreparedHostRuntime.install")((host: Value) =>
    Effect.suspend(() => {
      releaseConstruction();
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
  ): Effect.Effect<PreparedHostGeneration<A>, E | PreparedHostRuntimeError, R> =>
    use(host => stage(Effect.suspend(() => work(host))));
  return { charge, chargeResult, checkOpen, onDispose, stage, abandon, install, access: Object.freeze({ use, reconstruct, close, readUsage }) };
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
