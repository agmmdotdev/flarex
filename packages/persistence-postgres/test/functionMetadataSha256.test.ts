import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import * as persistenceRoot from "../src";
import {
  createFunctionMetadataSha256V1,
  FunctionMetadataSha256InputV1Error,
  FunctionMetadataSha256InvariantV1Defect,
  FunctionMetadataSha256ResourceV1Error,
  hashFunctionMetadataSha256V1,
  inspectFunctionMetadataSha256NativeCauseV1,
  type FunctionMetadataSha256V1Error,
} from "../src/functionMetadataSha256";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const BUDGET = { maximumInputBytes: 1_000_000 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PAM-A0b0-H Function Metadata V1 SHA-256 adapter", () => {
  it("keeps an exact private A/E/R surface and matches a known SHA-256 vector", async () => {
    type DigestEffect = ReturnType<typeof hashFunctionMetadataSha256V1>;
    type _Success = Assert<IsExact<Effect.Success<DigestEffect>, Uint8Array>>;
    type _Error = Assert<IsExact<
      Effect.Error<DigestEffect>,
      FunctionMetadataSha256V1Error
    >>;
    type _Services = Assert<IsExact<Effect.Services<DigestEffect>, never>>;
    expectTypeOf<_Success>().toEqualTypeOf<true>();
    expectTypeOf<_Error>().toEqualTypeOf<true>();
    expectTypeOf<_Services>().toEqualTypeOf<true>();

    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      | "createFunctionMetadataSha256V1"
      | "hashFunctionMetadataSha256V1"
      | "FunctionMetadataSha256InputV1Error"
      | "FunctionMetadataSha256ResourceV1Error"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();

    const digest = await runEffect(hashFunctionMetadataSha256V1(
      new TextEncoder().encode("abc"),
      { maximumInputBytes: 3 },
    ));
    expect(hex(digest)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(Object.getPrototypeOf(digest)).toBe(Uint8Array.prototype);
    expect(digest.byteLength).toBe(32);
  });

  it("validates the mandatory inclusive budget before allocation or digest invocation", async () => {
    let invocations = 0;
    const digest = createFunctionMetadataSha256V1(() => {
      invocations += 1;
      return Promise.resolve(new ArrayBuffer(32));
    });

    for (const budget of [
      undefined,
      null,
      {},
      { maximumInputBytes: -1 },
      { maximumInputBytes: 1.5 },
      { maximumInputBytes: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      const failure = await runEffectFailure(digest(new Uint8Array(), budget));
      expect(failure).toBeInstanceOf(FunctionMetadataSha256InputV1Error);
      expect(failure).toMatchObject({ reason: "invalidBudget" });
    }

    let budgetAccessorVisited = false;
    const accessorBudget: object = {};
    Object.defineProperty(accessorBudget, "maximumInputBytes", {
      get() {
        budgetAccessorVisited = true;
        throw new Error("budget accessor must not run");
      },
    });
    const accessorFailure = await runEffectFailure(
      digest(new Uint8Array(), accessorBudget),
    );
    expect(accessorFailure).toMatchObject({ reason: "invalidBudget" });
    expect(budgetAccessorVisited).toBe(false);

    const oversized = await runEffectFailure(
      digest(new Uint8Array([1, 2, 3]), { maximumInputBytes: 2 }),
    );
    expect(oversized).toBeInstanceOf(FunctionMetadataSha256InputV1Error);
    expect(oversized).toMatchObject({
      reason: "inputBytesExceeded",
      maximumInputBytes: 2,
    });
    expect(invocations).toBe(0);

    await runEffect(digest(new Uint8Array(), { maximumInputBytes: 0 }));
    await runEffect(digest(new Uint8Array([1]), { maximumInputBytes: 1 }));
    expect(invocations).toBe(2);
  });

  it("rejects detached, shared, proxy, and non-byte inputs before the port", async () => {
    let invocations = 0;
    const digest = createFunctionMetadataSha256V1(() => {
      invocations += 1;
      return Promise.resolve(new ArrayBuffer(32));
    });
    const detached = new Uint8Array([1]);
    structuredClone(detached, { transfer: [detached.buffer] });
    const shared = new Uint8Array(new SharedArrayBuffer(1));
    const proxied = new Proxy(new Uint8Array([1]), {});

    for (const input of [detached, shared, proxied, [1], new DataView(
      new ArrayBuffer(1),
    )]) {
      const failure = await runEffectFailure(digest(input, BUDGET));
      expect(failure).toBeInstanceOf(FunctionMetadataSha256InputV1Error);
      expect(failure).toMatchObject({ reason: "invalidBytes" });
    }
    expect(invocations).toBe(0);
  });

  it("ignores caller iterator, species, and spoofed length properties", async () => {
    let speciesVisited = false;
    class HostileBytes extends Uint8Array {
      static get [Symbol.species](): Uint8ArrayConstructor {
        speciesVisited = true;
        throw new Error("species must not run");
      }
    }
    const input = new HostileBytes([1, 2, 3]);
    Object.defineProperty(input, Symbol.iterator, {
      value() {
        throw new Error("iterator must not run");
      },
    });
    Object.defineProperty(input, "byteLength", { value: 500_000 });

    const digest = await runEffect(hashFunctionMetadataSha256V1(input, {
      maximumInputBytes: 3,
    }));
    expect(hex(digest)).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(speciesVisited).toBe(false);
  });

  it("is lazy before execution and isolates mutation after capture", async () => {
    const beforeRun = new Uint8Array([1, 1, 1]);
    const lazy = hashFunctionMetadataSha256V1(beforeRun, {
      maximumInputBytes: 3,
    });
    beforeRun.fill(2);
    expect(hex(await runEffect(lazy))).toBe(
      hex(await nativeSha256(new Uint8Array([2, 2, 2]))),
    );

    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => started = resolve);
    let settle!: (value: unknown) => void;
    let captured!: ArrayBuffer;
    const delayed = createFunctionMetadataSha256V1((input) => {
      captured = input;
      started();
      return new Promise<unknown>((resolve) => settle = resolve);
    });
    const afterStart = new Uint8Array([3, 4, 5]);
    const pending = runEffect(delayed(afterStart, {
      maximumInputBytes: afterStart.byteLength,
    }));
    await startedPromise;
    afterStart.fill(9);
    settle(await crypto.subtle.digest("SHA-256", captured));
    expect(hex(await pending)).toBe(
      hex(await nativeSha256(new Uint8Array([3, 4, 5]))),
    );
  });

  it("calls the live digest with its exact receiver and classifies unavailable crypto", async () => {
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    const subtle = {
      digest(this: unknown, algorithm: unknown, input: unknown) {
        expect(this).toBe(subtle);
        expect(algorithm).toBe("SHA-256");
        if (!(input instanceof ArrayBuffer)) {
          throw new Error("Expected owned ordinary ArrayBuffer input.");
        }
        return nativeDigest("SHA-256", input);
      },
    };
    vi.stubGlobal("crypto", { subtle });
    expect(hex(await runEffect(hashFunctionMetadataSha256V1(
      new Uint8Array([1]),
      { maximumInputBytes: 1 },
    )))).toBe("4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a");

    for (const unavailable of [undefined, {}, { subtle: {} }]) {
      vi.stubGlobal("crypto", unavailable);
      const failure = await runEffectFailure(hashFunctionMetadataSha256V1(
        new Uint8Array(),
        { maximumInputBytes: 0 },
      ));
      expect(failure).toBeInstanceOf(FunctionMetadataSha256ResourceV1Error);
      expect(failure).toMatchObject({ reason: "unavailable" });
      if (!(failure instanceof FunctionMetadataSha256ResourceV1Error)) {
        throw new Error("Expected SHA-256 resource failure.");
      }
      expect(inspectFunctionMetadataSha256NativeCauseV1(failure)).toBeUndefined();
    }
  });

  it("preserves direct native DOMException identity privately for throws and rejections", async () => {
    const thrown = new DOMException("sensitive thrown detail", "OperationError");
    const rejected = new DOMException(
      "sensitive rejected detail",
      "OperationError",
    );
    for (const [native, digest] of [
      [thrown, createFunctionMetadataSha256V1(() => {
        throw thrown;
      })],
      [rejected, createFunctionMetadataSha256V1(() => Promise.reject(rejected))],
    ] as const) {
      const failure = await runEffectFailure(digest(new Uint8Array(), {
        maximumInputBytes: 0,
      }));
      expect(failure).toBeInstanceOf(FunctionMetadataSha256ResourceV1Error);
      expect(failure).toMatchObject({ reason: "nativeRejected" });
      if (!(failure instanceof FunctionMetadataSha256ResourceV1Error)) {
        throw new Error("Expected SHA-256 resource failure.");
      }
      expect(Object.hasOwn(failure, "cause")).toBe(false);
      expect(inspectFunctionMetadataSha256NativeCauseV1(failure)).toBe(native);
    }
  });

  it("preserves unexpected synchronous and rejected values as defects", async () => {
    const thrown = new Error("unexpected synchronous defect");
    const rejected = Object.freeze({ kind: "unexpected rejection" });
    const primitive = "unexpected primitive rejection";
    for (const [defect, digest] of [
      [thrown, createFunctionMetadataSha256V1(() => {
        throw thrown;
      })],
      [rejected, createFunctionMetadataSha256V1(() => Promise.reject(rejected))],
      [primitive, createFunctionMetadataSha256V1(() => Promise.reject(primitive))],
    ] as const) {
      const exit = await runEffect(Effect.exit(digest(new Uint8Array(), {
        maximumInputBytes: 0,
      })));
      expectDefect(exit, defect);
    }

    const accessorDefect = new Error("crypto accessor defect");
    const cryptoValue: object = {};
    Object.defineProperty(cryptoValue, "subtle", {
      get() {
        throw accessorDefect;
      },
    });
    vi.stubGlobal("crypto", cryptoValue);
    expectDefect(await runEffect(Effect.exit(hashFunctionMetadataSha256V1(
      new Uint8Array(),
      { maximumInputBytes: 0 },
    ))), accessorDefect);
  });

  it("never classifies live-binding accessor DOMExceptions as digest failures", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto",
    );
    const failures = [
      new DOMException("global crypto accessor defect", "OperationError"),
      new DOMException("subtle accessor defect", "OperationError"),
      new DOMException("digest accessor defect", "OperationError"),
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
        expectDefect(await runEffect(Effect.exit(hashFunctionMetadataSha256V1(
          new Uint8Array(),
          { maximumInputBytes: 0 },
        ))), failures[index]);
      }
    } finally {
      if (originalDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, "crypto");
      } else {
        Object.defineProperty(globalThis, "crypto", originalDescriptor);
      }
    }
  });

  it("treats every malformed digest output as an invariant defect", async () => {
    const detached = new ArrayBuffer(32);
    structuredClone(detached, { transfer: [detached] });
    const outputs: ReadonlyArray<unknown> = [
      {},
      new SharedArrayBuffer(32),
      detached,
      new ArrayBuffer(31),
      new ArrayBuffer(33),
      new Proxy(new ArrayBuffer(32), {}),
    ];
    for (const output of outputs) {
      const exit = await runEffect(Effect.exit(
        createFunctionMetadataSha256V1(() => Promise.resolve(output))(
          new Uint8Array(),
          { maximumInputBytes: 0 },
        ),
      ));
      const defect = findDefect(exit);
      expect(defect).toBeInstanceOf(FunctionMetadataSha256InvariantV1Defect);
      expect(defect).toMatchObject({ reason: "invalidDigestOutput" });
    }
  });

  it("returns fresh ordinary output without aliasing the foreign buffer", async () => {
    const foreign = new ArrayBuffer(32);
    const foreignBytes = new Uint8Array(foreign);
    foreignBytes.fill(7);
    const digest = await runEffect(createFunctionMetadataSha256V1(
      () => Promise.resolve(foreign),
    )(new Uint8Array(), { maximumInputBytes: 0 }));
    expect(digest).toEqual(new Uint8Array(32).fill(7));
    expect(digest.buffer).not.toBe(foreign);

    foreignBytes.fill(9);
    expect(digest).toEqual(new Uint8Array(32).fill(7));
    digest.fill(5);
    expect(foreignBytes).toEqual(new Uint8Array(32).fill(9));
  });

  it("preserves interruption as Cause and never mints a late result", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => started = resolve);
    let settle!: (value: unknown) => void;
    let successes = 0;
    const digest = createFunctionMetadataSha256V1(() => {
      started();
      return new Promise<unknown>((resolve) => settle = resolve);
    });
    const interrupted = await runEffect(Effect.gen(function* () {
      const fiber = yield* digest(new Uint8Array([1]), {
        maximumInputBytes: 1,
      }).pipe(
        Effect.tap(() => Effect.sync(() => successes += 1)),
        Effect.forkChild,
      );
      yield* Effect.promise(() => startedPromise);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isFailure(interrupted)) {
      expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
    }
    settle(new ArrayBuffer(32));
    await Promise.resolve();
    expect(successes).toBe(0);
  });
});

async function nativeSha256(input: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(input);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned));
}

function hex(input: Uint8Array): string {
  return Buffer.from(input).toString("hex");
}

function expectDefect<E>(exit: Exit.Exit<unknown, E>, expected: unknown): void {
  expect(findDefect(exit)).toBe(expected);
}

function findDefect<E>(exit: Exit.Exit<unknown, E>): unknown {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected defect exit.");
  const defect = Cause.findDefect(exit.cause);
  expect(Result.isSuccess(defect)).toBe(true);
  if (Result.isFailure(defect)) throw new Error("Expected defect cause.");
  return defect.success;
}

type IsExact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type Assert<Value extends true> = Value;
