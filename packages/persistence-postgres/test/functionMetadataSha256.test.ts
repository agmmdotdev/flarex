import { Cause, Effect, Exit, Fiber, Result, Schema } from "effect";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionPackageIdV1Schema,
} from "flarex-protocol/transaction-session";
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
  frameFunctionMetadataChainStepSha256PreimageV1,
  frameFunctionMetadataCompletedPackageSha256PreimageV1,
  frameFunctionMetadataEmptyChainSha256PreimageV1,
  frameFunctionMetadataPathSha256PreimageV1,
  frameFunctionMetadataPublicationKeySha256PreimageV1,
  frameFunctionMetadataRowSha256PreimageV1,
  type FunctionMetadataFramingV1Error,
  type FunctionMetadataPublicationKeyPinsV1,
} from "../src/functionMetadataFraming";
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

  it("hashes every accepted metadata frame family to its golden digest", async () => {
    const framingBudget = { maximumFrameBytesMaterialized: 1_000_000 };
    const path = framingSuccess(frameFunctionMetadataPathSha256PreimageV1(
      "mod\0\ud800😀:run",
      framingBudget,
    ));
    const row = framingSuccess(frameFunctionMetadataRowSha256PreimageV1(
      new Uint8Array([0, 1, 255]),
      framingBudget,
    ));
    const empty = framingSuccess(
      frameFunctionMetadataEmptyChainSha256PreimageV1(framingBudget),
    );
    const pathDigest = await adapterSha256(path);
    const rowDigest = await adapterSha256(row);
    const emptyDigest = await adapterSha256(empty);
    const step = framingSuccess(frameFunctionMetadataChainStepSha256PreimageV1({
      previousChainSha256: emptyDigest,
      ordinal: 0n,
      canonicalRowBytesTotal: 0n,
      functionPathSha256: pathDigest,
      functionRowSha256: rowDigest,
      canonicalRowByteLength: 3n,
    }, framingBudget));
    const publicationPins = {
      packageId: Schema.decodeUnknownSync(TransactionPackageIdV1Schema)(
        "pkg-main",
      ),
      artifactRuntime: Schema.decodeUnknownSync(
        TransactionArtifactRuntimeV1Schema,
      )("dynamic-worker"),
      artifactId: Schema.decodeUnknownSync(TransactionArtifactIdV1Schema)(
        "artifact_0123456789abcdef0123456789abcdef",
      ),
      sourcePackageSha256: bytesFromRange(0, 32),
      schemaVersionId: decodeCatalogSchemaVersionId("schema-v1"),
      schemaManifestCodecVersion: 1,
      schemaManifestByteLength: 123n,
      schemaManifestSha256: bytesFromRange(32, 32),
      functionMetadataCodecVersion: 1,
    } satisfies FunctionMetadataPublicationKeyPinsV1;
    const publication = framingSuccess(
      frameFunctionMetadataPublicationKeySha256PreimageV1(
        publicationPins,
        framingBudget,
      ),
    );
    const publicationDigest = await adapterSha256(publication);
    const completed = framingSuccess(
      frameFunctionMetadataCompletedPackageSha256PreimageV1({
        publicationKeySha256: publicationDigest,
        functionCount: 2n,
        canonicalRowBytesTotal: 456n,
        finalRowChainSha256: emptyDigest,
      }, framingBudget),
    );

    for (const [frame, expected] of [
      [path, "35dbd3650bd271449e3632a30dc93f0a93ea732e8bef19b61ff8a41ae6c1e9be"],
      [row, "314a443ee2cabcfeecba032f6109ef177ee289f6c5dd397f6f9e9843bf164c74"],
      [empty, "285c6deca25c6de4b70c2215cd8df13680fb9a96ebf528157df4eec173a3089f"],
      [
        step.canonicalBytes,
        "973498b24c27b8ed11396fcddf2374befb2dbcc72a3924700db48c98c57cbeca",
      ],
      [
        publication,
        "f372c4f1b4dff258f477107199cc5ade7b054c49d5c8a283fca71bba4c012247",
      ],
      [
        completed,
        "5e0d1a4f9321f6db9708d449d69989e433ca7f581272243a9c883d096a2f8c1e",
      ],
    ] as const) {
      expect(hex(await adapterSha256(frame))).toBe(expected);
    }
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

  it("keeps DOMException impostors and lookalikes as exact defects", async () => {
    const prototypeImpostor: unknown = Object.create(DOMException.prototype);
    const proxy = new Proxy(
      new DOMException("proxied native", "OperationError"),
      {},
    );
    const hostileProxy = new Proxy(
      new DOMException("hostile native", "OperationError"),
      {
        getPrototypeOf() {
          throw new Error("hostile getPrototypeOf trap");
        },
      },
    );
    const structuralLookalike = Object.freeze({
      name: "OperationError",
      message: "structural DOMException lookalike",
      code: 0,
      [Symbol.toStringTag]: "DOMException",
    });
    for (const [label, defect] of [
      ["prototype impostor", prototypeImpostor],
      ["proxy", proxy],
      ["hostile proxy", hostileProxy],
      ["structural lookalike", structuralLookalike],
    ] as const) {
      for (const [mode, digest] of [
        ["throw", createFunctionMetadataSha256V1(() => {
          throw defect;
        })],
        ["reject", createFunctionMetadataSha256V1(() => Promise.reject(defect))],
      ] as const) {
        const exit = await runEffect(Effect.exit(digest(
          new Uint8Array(),
          { maximumInputBytes: 0 },
        )));
        expect(
          Object.is(findDefect(exit), defect),
          `${label} ${mode} must preserve exact identity`,
        ).toBe(true);
      }
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

async function adapterSha256(input: Uint8Array): Promise<Uint8Array> {
  return runEffect(hashFunctionMetadataSha256V1(input, {
    maximumInputBytes: input.byteLength,
  }));
}

function framingSuccess<A>(
  result: Result.Result<A, FunctionMetadataFramingV1Error>,
): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function hex(input: Uint8Array): string {
  return Buffer.from(input).toString("hex");
}

function bytesFromRange(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => start + index);
}

function expectDefect<E>(exit: Exit.Exit<unknown, E>, expected: unknown): void {
  expect(Object.is(findDefect(exit), expected)).toBe(true);
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
