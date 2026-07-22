import { Cause, Data, Effect, Exit, Fiber, Option, Result } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as AnalysisRoot from "../src/index";
import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
} from "@flarex/analysis/internal/private-sha256-v1";

class TestSha256InputError extends Data.TaggedError("TestSha256InputError")<{
  readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

class TestSha256ResourceError extends Data.TaggedError("TestSha256ResourceError")<{
  readonly reason: "unavailable" | "nativeRejected";
}> {}

class TestSha256InvariantDefect extends Data.TaggedError("TestSha256InvariantDefect")<{
  readonly observedByteLength?: number;
}> {}

type TestSha256Error = TestSha256InputError | TestSha256ResourceError;

const nativeCauses = new WeakMap<TestSha256ResourceError, DOMException>();
const policy: PrivateSha256V1ErrorPolicy<TestSha256Error> = {
  invalidBudget: () => new TestSha256InputError({ reason: "invalidBudget" }),
  invalidBytes: () => new TestSha256InputError({ reason: "invalidBytes" }),
  inputBytesExceeded: (observed, maximum) => new TestSha256InputError({
    reason: "inputBytesExceeded",
    observed,
    maximum,
  }),
  unavailable: () => new TestSha256ResourceError({ reason: "unavailable" }),
  nativeRejected: cause => {
    const error = new TestSha256ResourceError({ reason: "nativeRejected" });
    nativeCauses.set(error, cause);
    return error;
  },
  invalidDigestOutput: observedByteLength => new TestSha256InvariantDefect({
    ...(observedByteLength === undefined ? {} : { observedByteLength }),
  }),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private SHA-256 V1 mechanics", () => {
  it("is available only through its intentional internal subpath with exact A/E/R", () => {
    expect("makePrivateSha256V1" in AnalysisRoot).toBe(false);
    const digest = makePrivateSha256V1(
      async () => new ArrayBuffer(32),
      policy,
    );
    const effect: Effect.Effect<Uint8Array, TestSha256Error, never> = digest(
      new Uint8Array(),
      { maximumInputBytes: 0 },
    );
    expect(effect).toBeDefined();
  });

  it("copies the intrinsic visible range before foreign observation and returns an owned digest", async () => {
    let observed: Uint8Array | undefined;
    let release: (() => void) | undefined;
    const foreignOutput = new ArrayBuffer(32);
    const foreignOutputBytes = new Uint8Array(foreignOutput);
    foreignOutputBytes.fill(7);
    const digest = makePrivateSha256V1(input => {
      observed = new Uint8Array(input);
      return new Promise<ArrayBuffer>(resolve => {
        release = () => resolve(foreignOutput);
      });
    }, policy);
    const backing = Uint8Array.of(90, 1, 2, 3, 91);
    const visible = backing.subarray(1, 4);
    Object.defineProperties(visible, {
      byteLength: { get: () => { throw new Error("own byteLength must not run"); } },
      constructor: { value: { [Symbol.species]: () => { throw new Error("species must not run"); } } },
      [Symbol.iterator]: { value: () => { throw new Error("iterator must not run"); } },
    });
    const running = Effect.runPromise(digest(visible, { maximumInputBytes: 3 }));
    await Promise.resolve();
    backing.fill(0);
    release?.();
    const result = await running;

    expect(observed).toEqual(Uint8Array.of(1, 2, 3));
    expect(observed?.buffer).not.toBe(backing.buffer);
    expect(result).toEqual(new Uint8Array(32).fill(7));
    expect(result.buffer).not.toBe(foreignOutput);
    foreignOutputBytes.fill(9);
    expect(result).toEqual(new Uint8Array(32).fill(7));
    result.fill(5);
    expect(foreignOutputBytes).toEqual(new Uint8Array(32).fill(9));
  });

  it("validates mandatory budgets and bytes before allocation or foreign invocation", async () => {
    let calls = 0;
    const digest = makePrivateSha256V1(async () => {
      calls += 1;
      return new ArrayBuffer(32);
    }, policy);
    for (const [input, budget, reason] of [
      [new Uint8Array(), undefined, "invalidBudget"],
      [new Uint8Array(), { maximumInputBytes: -1 }, "invalidBudget"],
      [new Uint8Array(), { maximumInputBytes: Number.MAX_SAFE_INTEGER + 1 }, "invalidBudget"],
      [{}, { maximumInputBytes: 0 }, "invalidBytes"],
      [new Proxy(new Uint8Array(), {}), { maximumInputBytes: 0 }, "invalidBytes"],
      [Object.create(Uint8Array.prototype), { maximumInputBytes: 0 }, "invalidBytes"],
      [Uint8Array.of(1, 2), { maximumInputBytes: 1 }, "inputBytesExceeded"],
    ] as const) {
      const failure = await effectFailure(digest(input, budget));
      expect(failure).toBeInstanceOf(TestSha256InputError);
      expect(failure).toMatchObject({ reason });
    }
    expect(calls).toBe(0);

    await Effect.runPromise(digest(Uint8Array.of(1, 2), { maximumInputBytes: 2 }));
    expect(calls).toBe(1);
  });

  it("preserves detached input behavior and rejects shared-backed inputs", async () => {
    const digest = makePrivateSha256V1(async () => new ArrayBuffer(32), policy);
    const detached = Uint8Array.of(1);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    const detachedExit = await Effect.runPromiseExit(digest(detached, {
      maximumInputBytes: 1,
    }));
    expect(Exit.isFailure(detachedExit)).toBe(true);

    if (typeof SharedArrayBuffer !== "undefined") {
      const shared = new Uint8Array(new SharedArrayBuffer(1));
      const failure = await effectFailure(digest(shared, { maximumInputBytes: 1 }));
      expect(failure).toMatchObject({ reason: "invalidBytes" });
    }
  });

  it("uses the live Web Crypto receiver and reports unavailable bindings", async () => {
    let receiver: unknown;
    const subtle = {
      digest(this: unknown, algorithm: unknown, input: unknown): Promise<ArrayBuffer> {
        receiver = this;
        expect(algorithm).toBe("SHA-256");
        expect(input).toBeInstanceOf(ArrayBuffer);
        return Promise.resolve(new ArrayBuffer(32));
      },
    };
    vi.stubGlobal("crypto", { subtle });
    await Effect.runPromise(makeLivePrivateSha256V1(policy)(new Uint8Array(), {
      maximumInputBytes: 0,
    }));
    expect(receiver).toBe(subtle);

    vi.stubGlobal("crypto", {});
    const failure = await effectFailure(makeLivePrivateSha256V1(policy)(new Uint8Array(), {
      maximumInputBytes: 0,
    }));
    expect(failure).toMatchObject({ reason: "unavailable" });
  });

  it("maps direct DOMExceptions from every live binding access through policy", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const failures = [
      new DOMException("crypto accessor rejection", "OperationError"),
      new DOMException("subtle accessor rejection", "OperationError"),
      new DOMException("digest accessor rejection", "OperationError"),
    ] as const;
    const descriptors: ReadonlyArray<PropertyDescriptor> = [
      {
        configurable: true,
        get() {
          throw failures[0];
        },
      },
      {
        configurable: true,
        value: Object.defineProperty({}, "subtle", {
          get() {
            throw failures[1];
          },
        }),
      },
      {
        configurable: true,
        value: {
          subtle: Object.defineProperty({}, "digest", {
            get() {
              throw failures[2];
            },
          }),
        },
      },
    ];
    try {
      for (let index = 0; index < descriptors.length; index += 1) {
        Object.defineProperty(globalThis, "crypto", descriptors[index]);
        const failure = await effectFailure(makeLivePrivateSha256V1(policy)(
          new Uint8Array(),
          { maximumInputBytes: 0 },
        ));
        expect(failure).toMatchObject({ reason: "nativeRejected" });
        if (failure instanceof TestSha256ResourceError) {
          expect(nativeCauses.get(failure)).toBe(failures[index]);
        }
      }
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });

  it("keeps ordinary live binding access failures as exact defects", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const failures = [
      new Error("crypto accessor defect"),
      new Error("subtle accessor defect"),
      new Error("digest accessor defect"),
    ] as const;
    const descriptors: ReadonlyArray<PropertyDescriptor> = [
      {
        configurable: true,
        get() {
          throw failures[0];
        },
      },
      {
        configurable: true,
        value: Object.defineProperty({}, "subtle", {
          get() {
            throw failures[1];
          },
        }),
      },
      {
        configurable: true,
        value: {
          subtle: Object.defineProperty({}, "digest", {
            get() {
              throw failures[2];
            },
          }),
        },
      },
    ];
    try {
      for (let index = 0; index < descriptors.length; index += 1) {
        Object.defineProperty(globalThis, "crypto", descriptors[index]);
        const exit = await Effect.runPromiseExit(makeLivePrivateSha256V1(policy)(
          new Uint8Array(),
          { maximumInputBytes: 0 },
        ));
        expect(findDefect(exit)).toBe(failures[index]);
      }
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });

  it("preserves the two digest property reads and invokes only the second value", async () => {
    const events: string[] = [];
    let digestReads = 0;
    const first = () => {
      events.push("call:first");
      return Promise.resolve(new ArrayBuffer(32));
    };
    const second = () => {
      events.push("call:second");
      return Promise.resolve(new ArrayBuffer(32));
    };
    const subtle = Object.defineProperty({}, "digest", {
      configurable: true,
      get() {
        digestReads += 1;
        events.push(`read:${digestReads}`);
        return digestReads === 1 ? first : second;
      },
    });
    vi.stubGlobal("crypto", { subtle });

    await Effect.runPromise(makeLivePrivateSha256V1(policy)(new Uint8Array(), {
      maximumInputBytes: 0,
    }));
    expect(events).toEqual(["read:1", "read:2", "call:second"]);

    const secondReadFailure = new DOMException("second read", "OperationError");
    digestReads = 0;
    Object.defineProperty(subtle, "digest", {
      configurable: true,
      get() {
        digestReads += 1;
        if (digestReads === 2) throw secondReadFailure;
        return first;
      },
    });
    const failure = await effectFailure(makeLivePrivateSha256V1(policy)(new Uint8Array(), {
      maximumInputBytes: 0,
    }));
    expect(digestReads).toBe(2);
    expect(failure).toMatchObject({ reason: "nativeRejected" });
    if (failure instanceof TestSha256ResourceError) {
      expect(nativeCauses.get(failure)).toBe(secondReadFailure);
    }
  });

  it("maps only genuine direct DOMExceptions and retains their identity through policy", async () => {
    const thrown = new DOMException("private detail", "OperationError");
    const rejected = new DOMException("private rejection", "OperationError");
    for (const [native, digest] of [
      [thrown, makePrivateSha256V1(() => { throw thrown; }, policy)],
      [rejected, makePrivateSha256V1(() => Promise.reject(rejected), policy)],
    ] as const) {
      const failure = await effectFailure(digest(new Uint8Array(), {
        maximumInputBytes: 0,
      }));
      expect(failure).toMatchObject({ reason: "nativeRejected" });
      if (failure instanceof TestSha256ResourceError) {
        expect(nativeCauses.get(failure)).toBe(native);
      }
    }
  });

  it("preserves parent classifier outcomes for impostors and hostile values", async () => {
    const prototypeImpostor: unknown = Object.create(DOMException.prototype);
    const lookalike = Object.freeze({
      name: "OperationError",
      message: "lookalike",
      code: 0,
      [Symbol.toStringTag]: "DOMException",
    });
    const proxy = new Proxy(new DOMException("proxied", "OperationError"), {});
    const prototypeTrap = new Error("parent prototype trap outcome");
    const hostileProxy = new Proxy(new DOMException("hostile", "OperationError"), {
      getPrototypeOf() {
        throw prototypeTrap;
      },
    });
    const constructorTrap = new Error("parent constructor trap outcome");
    const hostileConstructor = new Proxy(new DOMException("hostile", "OperationError"), {
      get(target, property, receiver) {
        if (property === "constructor") throw constructorTrap;
        return Reflect.get(target, property, receiver);
      },
    });
    const ordinary = new Error("ordinary rejection");
    for (const defect of [
      prototypeImpostor,
      lookalike,
      proxy,
      ordinary,
      "primitive rejection",
    ]) {
      for (const digest of [
        makePrivateSha256V1(() => { throw defect; }, policy),
        makePrivateSha256V1(() => Promise.reject(defect), policy),
      ]) {
        expect(findDefect(await Effect.runPromiseExit(digest(new Uint8Array(), {
          maximumInputBytes: 0,
        })))).toBe(defect);
      }
    }
    for (const [foreign, expected] of [
      [hostileProxy, prototypeTrap],
      [hostileConstructor, constructorTrap],
    ] as const) {
      for (const digest of [
        makePrivateSha256V1(() => { throw foreign; }, policy),
        makePrivateSha256V1(() => Promise.reject(foreign), policy),
      ]) {
        expect(findDefect(await Effect.runPromiseExit(digest(new Uint8Array(), {
          maximumInputBytes: 0,
        })))).toBe(expected);
      }
    }
  });

  it("treats malformed digest outputs as policy-owned invariant defects", async () => {
    const detached = new ArrayBuffer(32);
    structuredClone(detached, { transfer: [detached] });
    const outputs: ReadonlyArray<unknown> = [
      {},
      new ArrayBuffer(31),
      new ArrayBuffer(33),
      detached,
      new Proxy(new ArrayBuffer(32), {}),
      ...(typeof SharedArrayBuffer === "undefined" ? [] : [new SharedArrayBuffer(32)]),
    ];
    for (const output of outputs) {
      const digest = makePrivateSha256V1(() => Promise.resolve(output), policy);
      const defect = findDefect(await Effect.runPromiseExit(digest(new Uint8Array(), {
        maximumInputBytes: 0,
      })));
      expect(defect).toBeInstanceOf(TestSha256InvariantDefect);
    }
  });

  it("preserves interruption and mints no late result", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>(resolve => started = resolve);
    let settle!: (value: unknown) => void;
    let successes = 0;
    const digest = makePrivateSha256V1(() => {
      started();
      return new Promise<unknown>(resolve => settle = resolve);
    }, policy);
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* digest(Uint8Array.of(1), { maximumInputBytes: 1 }).pipe(
        Effect.tap(() => Effect.sync(() => successes += 1)),
        Effect.forkChild,
      );
      yield* Effect.promise(() => startedPromise);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    settle(new ArrayBuffer(32));
    await Promise.resolve();
    expect(successes).toBe(0);
  });
});

async function effectFailure<E>(effect: Effect.Effect<unknown, E>): Promise<E> {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected failed Effect.");
  const failure = Cause.findErrorOption(exit.cause);
  expect(Option.isSome(failure)).toBe(true);
  if (Option.isNone(failure)) throw new Error("Expected typed failure.");
  return failure.value as E;
}

function findDefect<E>(exit: Exit.Exit<unknown, E>): unknown {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected defect exit.");
  const defect = Cause.findDefect(exit.cause);
  expect(Result.isSuccess(defect)).toBe(true);
  if (Result.isFailure(defect)) throw new Error("Expected defect cause.");
  return defect.success;
}
