import {
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import type {
  SourceArtifactV2Attempt,
  SourceArtifactV2AttemptMutation,
  SourceArtifactV2AttemptStore,
} from "../src/sourceArtifactV2/AttemptStore";
import { SourceArtifactV2AttemptStoreSettlementUncertainError } from "../src/sourceArtifactV2/AttemptStore";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  sourceArtifactV2BlockFrame,
  sourceArtifactV2CompletedRootFrame,
  sourceArtifactV2ModuleFrame,
  sourceArtifactV2TreeNodeFrame,
  sourceArtifactV2UploadSelectorFrame,
} from "../src/sourceArtifactV2/Framing";
import {
  makeSourceArtifactV2R2Store,
  SourceArtifactV2R2CorruptionError,
  SourceArtifactV2R2SettlementUncertainError,
  type SourceArtifactV2R2Bucket,
} from "../src/sourceArtifactV2/R2Store";
import {
  makeLiveSourceArtifactV2Sha256,
  makeSourceArtifactV2Sha256,
  sourceArtifactV2Sha256NativeCause,
  SourceArtifactV2Sha256InputError,
  SourceArtifactV2Sha256InvariantDefect,
  SourceArtifactV2Sha256ResourceError,
} from "../src/sourceArtifactV2/Sha256";
import {
  SourceArtifactV2UploadStateError,
  makeSourceArtifactV2UploadCore,
} from "../src/sourceArtifactV2/UploadCore";

const DIGEST = new Uint8Array(32).fill(0x11);
const FRAME_BUDGET = { maximumFrameBytesMaterialized: 100_000 };

describe("source artifact v2 inert upload core", () => {
  it("frames every immutable object family deterministically with owned bytes", async () => {
    const source = success(sourceArtifactV2BlockFrame(
      "source",
      0n,
      Uint8Array.of(1, 2, 3),
      FRAME_BUDGET,
    ));
    const sourceMap = success(sourceArtifactV2BlockFrame(
      "sourceMap",
      0n,
      Uint8Array.of(4),
      FRAME_BUDGET,
    ));
    const tree = success(sourceArtifactV2TreeNodeFrame(
      "source",
      { firstOrdinal: 0n, count: 1n, digest: DIGEST },
      { firstOrdinal: 1n, count: 1n, digest: new Uint8Array(32).fill(0x22) },
      FRAME_BUDGET,
    ));
    const module = success(sourceArtifactV2ModuleFrame({
      ordinal: 0n,
      path: "mod\u0000\ud83d\ude00",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      sourceByteLength: 3n,
      sourceBlockCount: 1n,
      sourceTreeDigest: DIGEST,
      sourceMapByteLength: 1n,
      sourceMapBlockCount: 1n,
      sourceMapTreeDigest: DIGEST,
    }, FRAME_BUDGET));
    const root = success(sourceArtifactV2CompletedRootFrame({
      moduleCount: 1n,
      functionModuleCount: 1n,
      totalSourceBytes: 3n,
      totalSourceMapBytes: 1n,
      moduleTreeDigest: DIGEST,
      executionPath: "mod\u0000\ud83d\ude00",
      schemaPath: null,
      authPath: null,
    }, FRAME_BUDGET));
    const selector = success(sourceArtifactV2UploadSelectorFrame({
      deploymentId: "deployment-test",
      uploadId: "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      generation: 1n,
      rootDigest: DIGEST,
    }, FRAME_BUDGET));
    await expect(Promise.all(
      [source, sourceMap, tree, module, root, selector].map(async frame =>
        encodeBytesToLowercaseHex(new Uint8Array(await crypto.subtle.digest(
          "SHA-256",
          copyBytesToArrayBuffer(frame.bytes),
        )))
      ),
    )).resolves.toEqual([
      "09faf337038ded630571e760ae27b525e4fbd28246177976204dbbbaaa624dd5",
      "1d306f3b3f2de1857f47e86c9c68da65362bd4f59eecb3f38df9d4e3b76422a5",
      "4c3c2ae44897c15b6f65884ce777276b92ed3831f6b4d3f00e3eab7d497aaac3",
      "742bb2ea66f660a6c3bc77e5a8cf73647432b012f86d986daf75deb5421a690d",
      "b30b5f143314746c855133b401a7ee8db654d294f3061b84970b70f72f0c3b85",
      "7b15c65f3b2b4cf60e37214df013731c79d3c10cae49eb72f2e45aa3d0cb44a5",
    ]);

    const sourceDomain = "flarex.source-artifact-v2.source-block.v1\0";
    const sourceMapDomain = "flarex.source-artifact-v2.source-map-block.v1\0";
    expect(new TextDecoder().decode(source.bytes.slice(0, sourceDomain.length))).toBe(sourceDomain);
    expect(new TextDecoder().decode(sourceMap.bytes.slice(0, sourceMapDomain.length))).toBe(
      sourceMapDomain,
    );
    expect([tree, module, root, selector].every(frame => frame.bytes.byteLength > 32)).toBe(true);
    const caller = Uint8Array.of(9, 8, 7);
    const captured = success(sourceArtifactV2BlockFrame("source", 1n, caller, FRAME_BUDGET));
    caller.fill(0);
    expect([...captured.bytes.slice(-3)]).toEqual([9, 8, 7]);
    const exact = source.bytes.byteLength;
    expect(Result.isSuccess(sourceArtifactV2BlockFrame(
      "source", 0n, Uint8Array.of(1, 2, 3), { maximumFrameBytesMaterialized: exact },
    ))).toBe(true);
    const over = sourceArtifactV2BlockFrame(
      "source", 0n, Uint8Array.of(1, 2, 3), { maximumFrameBytesMaterialized: exact - 1 },
    );
    expect(Result.isFailure(over) && over.failure._tag).toBe("SourceArtifactV2FrameBudgetError");
  });

  it("preserves upload-selector validation and projection accessor order", () => {
    const accessOrder: Array<string> = [];
    const selector = Object.defineProperties({}, {
      deploymentId: {
        enumerable: true,
        get: () => {
          accessOrder.push("deploymentId");
          return "deployment-test";
        },
      },
      uploadId: {
        enumerable: true,
        get: () => {
          accessOrder.push("uploadId");
          return "upload-test";
        },
      },
      generation: {
        configurable: true,
        enumerable: true,
        get: () => {
          accessOrder.push("generation");
          return 1n;
        },
      },
      rootDigest: {
        enumerable: true,
        get: () => {
          accessOrder.push("rootDigest");
          return DIGEST;
        },
      },
    });

    expect(Result.isSuccess(sourceArtifactV2UploadSelectorFrame(selector, FRAME_BUDGET))).toBe(true);
    expect(accessOrder).toEqual([
      "deploymentId",
      "deploymentId",
      "uploadId",
      "uploadId",
      "generation",
      "rootDigest",
      "deploymentId",
      "uploadId",
    ]);

    accessOrder.length = 0;
    Object.defineProperty(selector, "generation", {
      enumerable: true,
      get: () => {
        accessOrder.push("generation");
        return 0n;
      },
    });
    expect(Result.isFailure(sourceArtifactV2UploadSelectorFrame(selector, FRAME_BUDGET))).toBe(true);
    expect(accessOrder).toEqual([
      "deploymentId",
      "deploymentId",
      "uploadId",
      "uploadId",
      "generation",
    ]);
  });

  it("hashes owned inputs and rejects a +1 operation budget before foreign invocation", async () => {
    let calls = 0;
    let observed: Uint8Array | undefined;
    let release: (() => void) | undefined;
    const sha = makeSourceArtifactV2Sha256(input => {
      calls += 1;
      observed = new Uint8Array(input);
      return new Promise<ArrayBuffer>(resolve => {
        release = () => void crypto.subtle.digest("SHA-256", input).then(resolve);
      });
    });
    const input = new Uint8Array([97, 98, 99]);
    const running = Effect.runPromise(sha(input, { maximumInputBytes: 3 }));
    await Promise.resolve();
    input.fill(0);
    release?.();
    const digest = await running;
    expect(observed).toEqual(Uint8Array.of(97, 98, 99));
    expect(encodeBytesToLowercaseHex(digest)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    const failure = await Effect.runPromiseExit(sha(Uint8Array.of(1, 2), {
      maximumInputBytes: 1,
    }));
    expect(Exit.isFailure(failure)).toBe(true);
    expect(calls).toBe(1);
  });

  it("retains the Source Artifact V2 SHA error policy around shared mechanics", async () => {
    const inputFailure = failureOf(await Effect.runPromiseExit(
      makeSourceArtifactV2Sha256(async () => new ArrayBuffer(32))(
        Uint8Array.of(1, 2),
        { maximumInputBytes: 1 },
      ),
    ));
    expect(inputFailure).toBeInstanceOf(SourceArtifactV2Sha256InputError);
    expect(inputFailure).toMatchObject({
      reason: "inputBytesExceeded",
      observed: 2,
      maximum: 1,
    });

    const native = new DOMException("private native detail", "OperationError");
    const resourceFailure = failureOf(await Effect.runPromiseExit(
      makeSourceArtifactV2Sha256(() => Promise.reject(native))(
        new Uint8Array(),
        { maximumInputBytes: 0 },
      ),
    ));
    expect(resourceFailure).toBeInstanceOf(SourceArtifactV2Sha256ResourceError);
    expect(resourceFailure).toMatchObject({ reason: "nativeRejected" });
    if (resourceFailure instanceof SourceArtifactV2Sha256ResourceError) {
      expect(sourceArtifactV2Sha256NativeCause(resourceFailure)).toBe(native);
    }

    const malformedExit = await Effect.runPromiseExit(
      makeSourceArtifactV2Sha256(async () => new ArrayBuffer(31))(
        new Uint8Array(),
        { maximumInputBytes: 0 },
      ),
    );
    const malformedDefect = defectOf(malformedExit);
    expect(malformedDefect).toBeInstanceOf(SourceArtifactV2Sha256InvariantDefect);
    expect(malformedDefect).toMatchObject({
      reason: "invalidDigestOutput",
      observedByteLength: 31,
    });

    const unexpected = new Error("unexpected foreign failure");
    expect(defectOf(await Effect.runPromiseExit(
      makeSourceArtifactV2Sha256(() => Promise.reject(unexpected))(
        new Uint8Array(),
        { maximumInputBytes: 0 },
      ),
    ))).toBe(unexpected);
  });

  it("preserves backend native rejection identity for every live binding access", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    const failures = [
      new DOMException("crypto binding rejection", "OperationError"),
      new DOMException("subtle binding rejection", "OperationError"),
      new DOMException("digest binding rejection", "OperationError"),
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
        const failure = failureOf(await Effect.runPromiseExit(
          makeLiveSourceArtifactV2Sha256()(new Uint8Array(), {
            maximumInputBytes: 0,
          }),
        ));
        expect(failure).toBeInstanceOf(SourceArtifactV2Sha256ResourceError);
        expect(failure).toMatchObject({ reason: "nativeRejected" });
        if (failure instanceof SourceArtifactV2Sha256ResourceError) {
          expect(sourceArtifactV2Sha256NativeCause(failure)).toBe(failures[index]);
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

  it("converges immutable R2 content and publishes the inert root last", async () => {
    const attempts = memoryAttemptStore();
    const bucket = new MemoryR2Bucket();
    const sha = liveTestSha();
    const objects = makeSourceArtifactV2R2Store(bucket, sha);
    const core = makeSourceArtifactV2UploadCore({
      deploymentId: "deployment-source-v2",
      attempts,
      objects,
      sha256: sha,
    });
    const uploadId = "018f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const ceilings = budget(20, 100_000);
    const admission = budget(1, 10_000);
    const begun = await Effect.runPromise(core.beginUpload({
      uploadId,
      commandId: "begin-1",
      ceilings,
      admission,
    }));
    expect(begun.mutationFence).toBe(2);
    const module = await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module-1",
      admission,
      path: "functions/main.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      environment: "isolate",
    }));
    expect(module.mutationFence).toBe(4);
    const bytes = new TextEncoder().encode("export default {};");
    const appended = await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block-1",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes,
    }));
    bytes.fill(0);
    expect(appended.mutationFence).toBe(7);
    const replay = await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block-1",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: new TextEncoder().encode("export default {};"),
    }));
    expect(replay).toEqual(appended);
    const conflict = await Effect.runPromiseExit(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block-1",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(1),
    }));
    expect(failureOf(conflict)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    const closed = await Effect.runPromise(core.closeModule({
      uploadId,
      generation: 1,
      expectedFence: 7,
      commandId: "close-1",
      admission,
    }));
    expect(closed.nextModuleOrdinal).toBe(1);
    const finalized = await Effect.runPromise(core.finalize({
      uploadId,
      generation: 1,
      expectedFence: 10,
      commandId: "finalize-1",
      admission,
    }));
    expect(finalized.state).toBe("finalized");
    expect(finalized.completedRootDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(finalized.completedSelectorDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(bucket.writeOrder.at(-1)).toContain("/completed-root/");
    expect(bucket.writeOrder.some(key => key.includes("/upload-selector/"))).toBe(false);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.state).toBe("finalized");
  });

  it("fails closed on immutable key collisions and repeated settlement ambiguity", async () => {
    const constantSha = makeSourceArtifactV2Sha256(async () => new Uint8Array(32).buffer);
    const bucket = new MemoryR2Bucket();
    const store = makeSourceArtifactV2R2Store(bucket, constantSha);
    const digest = new Uint8Array(32);
    await Effect.runPromise(store.putImmutable(
      "source-block", digest, Uint8Array.of(1), { maximumBodyBytes: 10, maximumHashBytes: 10 },
    ));
    const collision = await Effect.runPromiseExit(store.putImmutable(
      "source-block", digest, Uint8Array.of(2), { maximumBodyBytes: 10, maximumHashBytes: 10 },
    ));
    expect(failureOf(collision)).toBeInstanceOf(SourceArtifactV2R2CorruptionError);

    let puts = 0;
    const ambiguous = makeSourceArtifactV2R2Store({
      put: async () => {
        puts += 1;
        throw new DOMException("ambiguous", "NetworkError");
      },
      get: async () => null,
    }, constantSha);
    const uncertainty = await Effect.runPromiseExit(ambiguous.putImmutable(
      "source-block", digest, Uint8Array.of(3), { maximumBodyBytes: 10, maximumHashBytes: 10 },
    ));
    expect(failureOf(uncertainty)).toBeInstanceOf(SourceArtifactV2R2SettlementUncertainError);
    expect(puts).toBe(2);
  });

  it("finishes R2 settlement reconciliation before delivering interruption", async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let rejectPut: ((reason: unknown) => void) | undefined;
    let putStarted: (() => void) | undefined;
    let getCalls = 0;
    const started = new Promise<void>(resolve => {
      putStarted = resolve;
    });
    const store = makeSourceArtifactV2R2Store({
      put: () => new Promise((_resolve, reject) => {
        rejectPut = reject;
        putStarted?.();
      }),
      get: async () => {
        getCalls += 1;
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(copyBytes(bytes));
              controller.close();
            },
          }),
        };
      },
    }, liveTestSha());
    const fiber = Effect.runFork(store.putImmutable(
      "source-block",
      digest,
      bytes,
      { maximumBodyBytes: 3, maximumHashBytes: 3 },
    ));
    await started;
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
    await Promise.resolve();
    rejectPut?.(new DOMException("response lost", "NetworkError"));
    await interrupted;
    const exit = await Effect.runPromise(Fiber.await(fiber));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(getCalls).toBe(1);

    let bucketCalls = 0;
    const bounded = makeSourceArtifactV2R2Store({
      put: async () => {
        bucketCalls += 1;
        return {};
      },
      get: async () => ({ body: { getReader: () => ({}) } }),
    }, liveTestSha());
    expect(Exit.isFailure(await Effect.runPromiseExit(bounded.putImmutable(
      "source-block",
      digest,
      bytes,
      { maximumBodyBytes: 2, maximumHashBytes: 3 },
    )))).toBe(true);
    expect(bucketCalls).toBe(0);
    const malformed = await Effect.runPromiseExit(bounded.readImmutable(
      "source-block",
      digest,
      { maximumBodyBytes: 3, maximumHashBytes: 3 },
    ));
    expect(failureOf(malformed)).toBeInstanceOf(SourceArtifactV2R2CorruptionError);

    let cancels = 0;
    let releases = 0;
    const oversizedRead = makeSourceArtifactV2R2Store({
      put: async () => ({}),
      get: async () => ({
        body: {
          getReader: () => ({
            read: async () => ({ done: false, value: new Uint8Array(1_024) }),
            cancel: async () => {
              cancels += 1;
            },
            releaseLock: () => {
              releases += 1;
            },
          }),
        },
      }),
    }, liveTestSha());
    expect(Exit.isFailure(await Effect.runPromiseExit(oversizedRead.readImmutable(
      "source-block",
      new Uint8Array(32),
      { maximumBodyBytes: 1, maximumHashBytes: 1 },
    )))).toBe(true);
    expect({ cancels, releases }).toEqual({ cancels: 1, releases: 1 });
  });

  it("resumes the exact begin and reopen commands after their durable budget reservation", async () => {
    const attempts = memoryAttemptStore();
    const bucket = new MemoryR2Bucket();
    let hashCalls = 0;
    const sha = makeSourceArtifactV2Sha256(input => {
      hashCalls += 1;
      if (hashCalls === 1 || hashCalls === 4) {
        return Promise.reject(new DOMException("injected", "OperationError"));
      }
      return crypto.subtle.digest("SHA-256", input);
    });
    const core = makeSourceArtifactV2UploadCore({
      deploymentId: "deployment-source-v2",
      attempts,
      objects: makeSourceArtifactV2R2Store(bucket, sha),
      sha256: sha,
    });
    const uploadId = "618f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const ceilings = budget(20, 100_000);
    const admission = budget(1, 10_000);

    const interruptedBegin = await Effect.runPromiseExit(core.beginUpload({
      uploadId,
      commandId: "begin",
      ceilings,
      admission,
    }));
    expect(failureOf(interruptedBegin)).toBeInstanceOf(SourceArtifactV2Sha256ResourceError);
    const reservedBegin = await Effect.runPromise(attempts.read(uploadId));
    expect(reservedBegin?.pendingCommand?.kind).toBe("beginUpload");
    expect(reservedBegin?.usage).toEqual(admission);

    const changedCeilings = await Effect.runPromiseExit(core.beginUpload({
      uploadId,
      commandId: "begin",
      ceilings: { ...ceilings, calls: ceilings.calls + 1 },
      admission,
    }));
    expect(failureOf(changedCeilings)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    const begun = await Effect.runPromise(core.beginUpload({
      uploadId,
      commandId: "begin",
      ceilings,
      admission,
    }));
    expect(begun.mutationFence).toBe(2);

    const interruptedReopen = await Effect.runPromiseExit(core.reopen({
      uploadId,
      generation: 1,
      expectedFence: begun.mutationFence,
      commandId: "reopen",
      admission,
    }));
    expect(failureOf(interruptedReopen)).toBeInstanceOf(SourceArtifactV2Sha256ResourceError);
    const reservedReopen = await Effect.runPromise(attempts.read(uploadId));
    expect(reservedReopen?.pendingCommand?.kind).toBe("reopen");
    expect(reservedReopen?.usage.calls).toBe(2);
    const reopened = await Effect.runPromise(core.reopen({
      uploadId,
      generation: 1,
      expectedFence: begun.mutationFence,
      commandId: "reopen",
      admission,
    }));
    expect(reopened.mutationFence).toBe(4);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.usage.calls).toBe(2);
  });

  it("serializes concurrent conflicting commands before either can duplicate admitted work", async () => {
    const attempts = memoryAttemptStore();
    const bucket = new MemoryR2Bucket();
    let pauseNextHash = false;
    let hashCalls = 0;
    let entered: (() => void) | undefined;
    let release: (() => void) | undefined;
    const enteredPromise = new Promise<void>(resolve => {
      entered = resolve;
    });
    const sha = makeSourceArtifactV2Sha256(input => {
      hashCalls += 1;
      if (!pauseNextHash) return crypto.subtle.digest("SHA-256", input);
      pauseNextHash = false;
      entered?.();
      return new Promise<ArrayBuffer>(resolve => {
        release = () => void crypto.subtle.digest("SHA-256", input).then(resolve);
      });
    });
    const core = makeSourceArtifactV2UploadCore({
      deploymentId: "deployment-source-v2",
      attempts,
      objects: makeSourceArtifactV2R2Store(bucket, sha),
      sha256: sha,
    });
    const uploadId = "718f22e2-58cc-7b2a-91d8-f3f3401a0874";
    const ceilings = budget(20, 100_000);
    const admission = budget(1, 10_000);
    await Effect.runPromise(core.beginUpload({ uploadId, commandId: "begin", ceilings, admission }));
    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module",
      admission,
      path: "functions/main.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    }));

    pauseNextHash = true;
    const callerBytes = Uint8Array.of(1);
    const first = Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: callerBytes,
    }));
    await enteredPromise;
    callerBytes[0] = 9;
    const callsWhileFirstOwnsGate = hashCalls;
    const conflicting = Effect.runPromiseExit(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(2),
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(hashCalls).toBe(callsWhileFirstOwnsGate);
    release?.();
    await first;
    const storedBlock = [...bucket.objects.entries()].find(([key]) =>
      key.includes("/source-block/")
    )?.[1];
    expect(storedBlock?.at(-1)).toBe(1);
    expect(failureOf(await conflicting)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.usage.calls).toBe(3);
  });

  it("rejects deterministic under-admission before leaving a pending command", async () => {
    const fixture = makeCoreFixture("818f22e2-58cc-7b2a-91d8-f3f3401a0874");
    const { core, attempts, uploadId, ceilings, admission } = fixture;
    const lowCanonical = { ...admission, canonicalBytes: 1, hashBytes: 1 };
    const neverBegunId = "918f22e2-58cc-7b2a-91d8-f3f3401a0874";
    expect(Exit.isFailure(await Effect.runPromiseExit(core.beginUpload({
      uploadId: neverBegunId,
      commandId: "under-begin",
      ceilings,
      admission: lowCanonical,
    })))).toBe(true);
    expect(await Effect.runPromise(attempts.read(neverBegunId))).toBeNull();

    await Effect.runPromise(core.beginUpload({ uploadId, commandId: "begin", ceilings, admission }));
    expect(Exit.isFailure(await Effect.runPromiseExit(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "under-module",
      admission: lowCanonical,
      path: "functions/main.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    })))).toBe(true);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.pendingCommand).toBeNull();
    expect((await Effect.runPromise(attempts.read(uploadId)))?.mutationFence).toBe(2);

    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module",
      admission,
      path: "functions/main.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    }));
    expect(Exit.isFailure(await Effect.runPromiseExit(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "under-block",
      admission: { ...admission, blockBytes: 1 },
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(1, 2),
    })))).toBe(true);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.mutationFence).toBe(4);

    await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(1),
    }));
    expect(Exit.isFailure(await Effect.runPromiseExit(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "block",
      admission: { ...admission, blockBytes: ceilings.blockBytes + 1 },
      kind: "source",
      blockIndex: 0,
      bytes: new Uint8Array(ceilings.blockBytes + 1),
    })))).toBe(true);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.mutationFence).toBe(7);
    const lowFrame = { ...admission, frameBytes: 1, hashBytes: 1 };
    expect(Exit.isFailure(await Effect.runPromiseExit(core.closeModule({
      uploadId,
      generation: 1,
      expectedFence: 7,
      commandId: "under-close",
      admission: lowFrame,
    })))).toBe(true);
    expect((await Effect.runPromise(attempts.read(uploadId)))?.mutationFence).toBe(7);
    const closed = await Effect.runPromise(core.closeModule({
      uploadId,
      generation: 1,
      expectedFence: 7,
      commandId: "close",
      admission,
    }));
    expect(Exit.isFailure(await Effect.runPromiseExit(core.finalize({
      uploadId,
      generation: 1,
      expectedFence: closed.mutationFence,
      commandId: "under-finalize",
      admission: lowFrame,
    })))).toBe(true);
    const afterFinalizeRejection = await Effect.runPromise(attempts.read(uploadId));
    expect(afterFinalizeRejection?.state).toBe("open");
    expect(afterFinalizeRejection?.pendingCommand).toBeNull();
    expect(afterFinalizeRejection?.mutationFence).toBe(closed.mutationFence);
  });

  it("keeps large module assembly bounded in blocks and a logarithmic frontier", async () => {
    const fixture = makeCoreFixture("418f22e2-58cc-7b2a-91d8-f3f3401a0874");
    const { core, uploadId, ceilings, admission, bucket, attempts } = fixture;
    await Effect.runPromise(core.beginUpload({ uploadId, commandId: "begin", ceilings, admission }));
    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module",
      admission,
      path: "functions/large.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION | SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      environment: "isolate",
    }));
    let fence = 4;
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      const result = await Effect.runPromise(core.appendBlock({
        uploadId,
        generation: 1,
        expectedFence: fence,
        commandId: `source-${blockIndex}`,
        admission,
        kind: "source",
        blockIndex,
        bytes: new Uint8Array(1024).fill(blockIndex + 1),
      }));
      fence = result.mutationFence;
    }
    const mapped = await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: fence,
      commandId: "map-0",
      admission,
      kind: "sourceMap",
      blockIndex: 0,
      bytes: new TextEncoder().encode("{}"),
    }));
    const stored = await Effect.runPromise(attempts.read(uploadId));
    expect(stored?.currentModule?.source.frontier.length).toBe(1);
    const closed = await Effect.runPromise(core.closeModule({
      uploadId,
      generation: 1,
      expectedFence: mapped.mutationFence,
      commandId: "close",
      admission,
    }));
    await Effect.runPromise(core.finalize({
      uploadId,
      generation: 1,
      expectedFence: closed.mutationFence,
      commandId: "finalize",
      admission,
    }));
    expect([...bucket.objects.keys()].filter(key => key.includes("/tree-node/")).length).toBeGreaterThan(1);
  });

  it("leaves closing as restart truth when selector settlement is unresolved", async () => {
    let rejectFinalVerdict = true;
    const durableAttempts = memoryAttemptStore();
    const attempts: SourceArtifactV2AttemptStore = Object.freeze({
      read: durableAttempts.read,
      write: (mutation: SourceArtifactV2AttemptMutation) =>
        mutation.next.state === "finalized" && rejectFinalVerdict
        ? Effect.fail(new SourceArtifactV2AttemptStoreSettlementUncertainError({
          uploadId: mutation.uploadId,
          commandId: mutation.commandId,
        }))
        : durableAttempts.write(mutation),
    });
    const fixture = makeCoreFixture(
      "518f22e2-58cc-7b2a-91d8-f3f3401a0874",
      undefined,
      attempts,
    );
    const { core, uploadId, ceilings, admission, bucket } = fixture;
    await Effect.runPromise(core.beginUpload({ uploadId, commandId: "begin", ceilings, admission }));
    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module",
      admission,
      path: "functions/main.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    }));
    await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "source",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(1),
    }));
    const closed = await Effect.runPromise(core.closeModule({
      uploadId, generation: 1, expectedFence: 7, commandId: "close", admission,
    }));
    const uncertain = await Effect.runPromiseExit(core.finalize({
      uploadId,
      generation: 1,
      expectedFence: closed.mutationFence,
      commandId: "finalize",
      admission,
    }));
    expect(failureOf(uncertain)).toBeInstanceOf(
      SourceArtifactV2AttemptStoreSettlementUncertainError,
    );
    const closing = await Effect.runPromise(durableAttempts.read(uploadId));
    expect(closing?.state).toBe("closing");
    expect(closing?.completedRootDigest).toBeNull();
    expect([...bucket.objects.keys()].some(key => key.includes("/completed-root/"))).toBe(true);
    rejectFinalVerdict = false;
    const finalized = await Effect.runPromise(core.finalize({
      uploadId,
      generation: 1,
      expectedFence: closed.mutationFence,
      commandId: "finalize",
      admission,
    }));
    expect(finalized.state).toBe("finalized");
  });

  it("rejects gaps, path regressions, missing source, duplicate singular roles, and empty finalization", async () => {
    const setup = makeCoreFixture();
    const { core, uploadId, ceilings, admission } = setup;
    await Effect.runPromise(core.beginUpload({
      uploadId, commandId: "begin", ceilings, admission,
    }));
    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "module-a",
      admission,
      path: "b.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    }));
    const gap = await Effect.runPromiseExit(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "gap",
      admission,
      kind: "source",
      blockIndex: 1,
      bytes: Uint8Array.of(1),
    }));
    expect(failureOf(gap)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    const missing = await Effect.runPromiseExit(core.closeModule({
      uploadId, generation: 1, expectedFence: 4, commandId: "close-empty", admission,
    }));
    expect(failureOf(missing)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 4,
      commandId: "source",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(1),
    }));
    await Effect.runPromise(core.closeModule({
      uploadId, generation: 1, expectedFence: 7, commandId: "close-a", admission,
    }));
    const order = await Effect.runPromiseExit(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 10,
      commandId: "module-order",
      admission,
      path: "a.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      environment: "isolate",
    }));
    expect(failureOf(order)).toBeInstanceOf(SourceArtifactV2UploadStateError);
    await Effect.runPromise(core.beginModule({
      uploadId,
      generation: 1,
      expectedFence: 10,
      commandId: "module-c",
      admission,
      path: "c.js",
      roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      environment: "isolate",
    }));
    await Effect.runPromise(core.appendBlock({
      uploadId,
      generation: 1,
      expectedFence: 12,
      commandId: "source-c",
      admission,
      kind: "source",
      blockIndex: 0,
      bytes: Uint8Array.of(2),
    }));
    const duplicate = await Effect.runPromiseExit(core.closeModule({
      uploadId, generation: 1, expectedFence: 15, commandId: "close-c", admission,
    }));
    expect(failureOf(duplicate)).toBeInstanceOf(SourceArtifactV2UploadStateError);

    const empty = makeCoreFixture("218f22e2-58cc-7b2a-91d8-f3f3401a0874");
    await Effect.runPromise(empty.core.beginUpload({
      uploadId: empty.uploadId,
      commandId: "empty",
      ceilings: empty.ceilings,
      admission: empty.admission,
    }));
    const emptyFinalize = await Effect.runPromiseExit(empty.core.finalize({
      uploadId: empty.uploadId,
      generation: 1,
      expectedFence: 2,
      commandId: "finalize-empty",
      admission: empty.admission,
    }));
    expect(failureOf(emptyFinalize)).toBeInstanceOf(SourceArtifactV2UploadStateError);
  });
});

function budget(calls: number, amount: number) {
  return {
    calls,
    blockBytes: amount,
    modules: amount,
    sourceMaps: amount,
    canonicalBytes: amount,
    frameBytes: amount,
    hashBytes: amount,
    timeMilliseconds: amount,
  };
}

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failureOf<A, E>(exit: Exit.Exit<A, E>): E | undefined {
  if (Exit.isSuccess(exit)) return undefined;
  return Cause.findErrorOption(exit.cause).pipe(option => option._tag === "Some" ? option.value : undefined);
}

function defectOf<A, E>(exit: Exit.Exit<A, E>): unknown {
  if (Exit.isSuccess(exit)) throw new Error("Expected failed Effect.");
  const defect = Cause.findDefect(exit.cause);
  if (Result.isFailure(defect)) throw new Error("Expected defect Cause.");
  return defect.success;
}

function liveTestSha() {
  return makeSourceArtifactV2Sha256(input => crypto.subtle.digest("SHA-256", input));
}

function makeCoreFixture(
  uploadId = "318f22e2-58cc-7b2a-91d8-f3f3401a0874",
  bucketPort?: SourceArtifactV2R2Bucket,
  attemptPort?: SourceArtifactV2AttemptStore,
) {
  const attempts = memoryAttemptStore();
  const bucket = new MemoryR2Bucket();
  const sha = liveTestSha();
  const ceilings = budget(40, 100_000);
  const admission = budget(1, 10_000);
  return {
    uploadId,
    attempts,
    bucket,
    ceilings,
    admission,
    core: makeSourceArtifactV2UploadCore({
      deploymentId: "deployment-source-v2",
      attempts: attemptPort ?? attempts,
      objects: makeSourceArtifactV2R2Store(bucketPort ?? bucket, sha),
      sha256: sha,
    }),
  };
}

function memoryAttemptStore(): SourceArtifactV2AttemptStore {
  const rows = new Map<string, SourceArtifactV2Attempt>();
  return Object.freeze({
    read: (uploadId: string) => Effect.succeed(rows.get(uploadId) ?? null),
    write: (mutation: SourceArtifactV2AttemptMutation) => Effect.sync(() => {
      const current = rows.get(mutation.uploadId);
      if (
        current !== undefined && current.lastCommandId === mutation.commandId &&
        current.lastCommandDigest === mutation.commandDigest
      ) return current;
      if (mutation.expectedFence === null) {
        if (current !== undefined) throw new Error("duplicate test attempt");
      } else if (current?.mutationFence !== mutation.expectedFence) {
        throw new Error("stale test attempt");
      }
      rows.set(mutation.uploadId, mutation.next);
      return mutation.next;
    }),
  });
}

class MemoryR2Bucket implements SourceArtifactV2R2Bucket {
  readonly objects = new Map<string, Uint8Array>();
  readonly writeOrder: string[] = [];

  async put(
    key: string,
    value: ArrayBuffer,
    _options?: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): Promise<Readonly<Record<string, never>> | null> {
    if (this.objects.has(key)) return null;
    this.objects.set(key, copyBytes(new Uint8Array(value)));
    this.writeOrder.push(key);
    return Object.freeze({});
  }

  async get(key: string): Promise<Readonly<Record<string, unknown>> | null> {
    const bytes = this.objects.get(key);
    if (bytes === undefined) return null;
    return Object.freeze({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(copyBytes(bytes));
          controller.close();
        },
      }),
    });
  }
}
