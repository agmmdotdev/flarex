import type { TaskRuntimeObjectReferenceV1 } from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeTaskRuntimeReadinessColdVerificationAuthority,
} from "../src/taskRuntimeReadiness/Authority.js";
import {
  TaskRuntimeObjectStoreCorruptionError,
  TaskRuntimeObjectStoreNotFoundError,
  TaskRuntimeObjectStoreResourceError,
  TaskRuntimeObjectStoreSettlementUncertainError,
  type TaskRuntimeObjectStore,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";
import { makeTaskRuntimeReadinessFixture } from
  "./taskRuntimeReadinessFixture.js";

describe("TaskRuntimeReadinessColdVerificationAuthority", () => {
  it("reads exact membership sequentially and issues copy-on-read evidence", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture();
    const expectedObjects = fixture.objects.map(object => Object.freeze({
      reference: object.readReference(),
      bytes: object.readCanonicalBytes(),
    }));
    const calls: string[] = [];
    const owner = {
      marker: "store",
      read(this: { marker: string }, reference: unknown) {
        expect(this.marker).toBe("store");
        const expected = expectedObjects[calls.length];
        if (expected === undefined) return Effect.die("unexpected read");
        const captured = reference as TaskRuntimeObjectReferenceV1;
        calls.push(captured.objectKey);
        return Effect.succeed(Object.freeze({
          reference: expected.reference,
          bytes: copyBytes(expected.bytes),
        }));
      },
    } satisfies Pick<TaskRuntimeObjectStore, "read"> & { marker: string };
    const authority = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority(
        owner,
        fixture.sha256,
        policyFor(fixture.objects),
      ),
    );

    const proof = await Effect.runPromise(authority.verify(
      fixture.preparationInput,
    ));
    expect(calls).toEqual(expectedObjects.map(item => item.reference.objectKey));
    const captured = Result.getOrThrow(authority.capture(proof));
    expect(captured.readBasis()).toMatchObject({
      kind: "populated",
      objectCount: BigInt(expectedObjects.length),
    });
    const firstBytes = captured.readCanonicalBytes();
    firstBytes.fill(0);
    expect(captured.readCanonicalBytes()).not.toEqual(firstBytes);
    const firstDigest = captured.readSha256();
    firstDigest.fill(0);
    expect(captured.readSha256()).not.toEqual(firstDigest);
    expect(Result.isFailure(authority.capture({
      kind: "task_runtime_readiness_cold_verification",
    }))).toBe(true);
  });

  it("supports the empty catalog without reading the store", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture(true);
    let calls = 0;
    const authority = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => {
          calls += 1;
          return Effect.die("empty readiness must not read");
        },
      }, fixture.sha256, {
        maximumObjectCount: 1,
        maximumObjectBytes: 1,
        maximumRetainedObjectBytes: 1,
      }),
    );
    const proof = await Effect.runPromise(authority.verify(
      fixture.preparationInput,
    ));
    expect(calls).toBe(0);
    expect(Result.getOrThrow(authority.capture(proof)).readBasis()).toMatchObject({
      kind: "empty",
      objectCount: 0n,
      canonicalObjectByteLength: 0n,
    });
  });

  it("admits count, per-object, and retained bytes before the first read", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture();
    const exact = policyFor(fixture.objects);
    const cases = [
      {
        policy: { ...exact, maximumObjectCount: fixture.objects.length - 1 },
        reason: "objectCountExceeded",
      },
      {
        policy: { ...exact, maximumObjectBytes: exact.maximumObjectBytes - 1 },
        reason: "objectBytesExceeded",
      },
      {
        policy: {
          ...exact,
          maximumRetainedObjectBytes: exact.maximumRetainedObjectBytes - 1,
        },
        reason: "retainedObjectBytesExceeded",
      },
    ] as const;
    for (const testCase of cases) {
      let calls = 0;
      const authority = Result.getOrThrow(
        makeTaskRuntimeReadinessColdVerificationAuthority({
          read: () => {
            calls += 1;
            return Effect.die("admission must precede reads");
          },
        }, fixture.sha256, testCase.policy),
      );
      await expect(Effect.runPromise(authority.verify(
        fixture.preparationInput,
      ))).rejects.toMatchObject({
        _tag: "TaskRuntimeReadinessColdVerificationAdmissionError",
        reason: testCase.reason,
      });
      expect(calls).toBe(0);
    }
  });

  it("preserves store failures and external interruption without a proof", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture();
    const reference = fixture.objects[0]!.readReference();
    const failures = [
      new TaskRuntimeObjectStoreNotFoundError({ reference }),
      new TaskRuntimeObjectStoreResourceError({
        operation: "get",
        reference,
      }),
      new TaskRuntimeObjectStoreCorruptionError({
        reference,
        reason: "digestMismatch",
      }),
      new TaskRuntimeObjectStoreSettlementUncertainError({
        reference,
        stage: "reconcileRead",
      }),
    ] as const;
    for (const failure of failures) {
      const failing = Result.getOrThrow(
        makeTaskRuntimeReadinessColdVerificationAuthority({
          read: () => Effect.fail(failure),
        }, fixture.sha256, policyFor(fixture.objects)),
      );
      await expect(Effect.runPromise(failing.verify(
        fixture.preparationInput,
      ))).rejects.toBe(failure);
    }

    let finalized = false;
    let signalEntered: (() => void) | undefined;
    const entered = new Promise<void>(resolve => {
      signalEntered = resolve;
    });
    const stalled = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => Effect.sync(() => signalEntered!()).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Effect.sync(() => {
            finalized = true;
          })),
        ),
      }, fixture.sha256, policyFor(fixture.objects)),
    );
    const fiber = Effect.runFork(stalled.verify(fixture.preparationInput));
    await entered;
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(finalized).toBe(true);
  });

  it("rejects malformed expected evidence before reads and returned-object drift after reads", async () => {
    const fixture = await makeTaskRuntimeReadinessFixture();
    let calls = 0;
    const objects = fixture.objects.map(object => ({
      reference: object.readReference(),
      bytes: object.readCanonicalBytes(),
    }));
    const authority = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => {
          const object = objects[calls++]!;
          return Effect.succeed(object);
        },
      }, fixture.sha256, policyFor(fixture.objects)),
    );
    await expect(Effect.runPromise(authority.verify({
      ...fixture.preparationInput,
      expected: {
        ...fixture.preparationInput.expected,
        scopeId: ` ${fixture.preparationInput.expected.scopeId}`,
      },
    }))).rejects.toMatchObject({
      _tag: "InvalidTaskRuntimeReadinessV1Error",
      reason: "invalid_input",
    });
    expect(calls).toBe(0);

    const drifted = Result.getOrThrow(
      makeTaskRuntimeReadinessColdVerificationAuthority({
        read: () => {
          calls += 1;
          return Effect.succeed(objects[1]!);
        },
      }, fixture.sha256, policyFor(fixture.objects)),
    );
    await expect(Effect.runPromise(drifted.verify(
      fixture.preparationInput,
    ))).rejects.toMatchObject({
      _tag: "InvalidTaskRuntimeReadinessV1Error",
      reason: "runtime_object_mismatch",
    });
  });

  it("rejects non-data and incompatible policy configurations", () => {
    const fixturePolicy = {
      maximumObjectCount: 1,
      maximumObjectBytes: 2,
      maximumRetainedObjectBytes: 1,
    };
    const incompatible = makeTaskRuntimeReadinessColdVerificationAuthority(
      { read: () => Effect.die("unused") },
      (() => Effect.die("unused")) as never,
      fixturePolicy,
    );
    expect(Result.isFailure(incompatible)).toBe(true);
    if (!Result.isFailure(incompatible)) throw new Error("Expected failure.");
    expect(incompatible.failure).toMatchObject({
      field: "maximumRetainedObjectBytes",
      reason: "incompatibleLimits",
    });
    const nonEnumerable = Object.defineProperty({}, "maximumObjectCount", {
      value: 1,
    });
    Object.defineProperties(nonEnumerable, {
      maximumObjectBytes: { value: 1 },
      maximumRetainedObjectBytes: { value: 1 },
    });
    expect(Result.isFailure(makeTaskRuntimeReadinessColdVerificationAuthority(
      { read: () => Effect.die("unused") },
      (() => Effect.die("unused")) as never,
      nonEnumerable as never,
    ))).toBe(true);
  });
});

function policyFor(
  objects: ReadonlyArray<{
    readonly readReference: () => TaskRuntimeObjectReferenceV1;
  }>,
) {
  const lengths = objects.map(object => Number(object.readReference().byteLength));
  return {
    maximumObjectCount: Math.max(1, objects.length),
    maximumObjectBytes: Math.max(1, ...lengths),
    maximumRetainedObjectBytes: Math.max(
      1,
      lengths.reduce((total, value) => total + value, 0),
    ),
  } satisfies {
    maximumObjectCount: number;
    maximumObjectBytes: number;
    maximumRetainedObjectBytes: number;
  };
}
