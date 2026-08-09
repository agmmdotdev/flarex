import { Cause, Effect, Exit } from "effect";
import { replacementScopeIdV1FromUuid } from
  "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import {
  TaskRepairSweepContinuationCodecV1Error,
  decodeTaskRepairSweepContinuationV1,
  encodeTaskRepairSweepContinuationV1,
} from "../src/taskRepairSweepContinuationCodecV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const MAX_BYTES = 4_194_304;
const RUN_ID = "run_92000000-0000-4000-8000-000000000001";
const SCOPE_ONE = replacementScopeIdV1FromUuid(
  "92000000-0000-0000-0000-000000000001",
);
const SCOPE_TWO = replacementScopeIdV1FromUuid(
  "92000000-0000-0000-0000-000000000002",
);

describe("DTE05-E2A Task repair continuation codec", () => {
  it("stays private and round-trips owned canonical evidence", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "encodeTaskRepairSweepContinuationV1"
      | "decodeTaskRepairSweepContinuationV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();

    const source = continuation();
    const encoded = await runEffect(encodeTaskRepairSweepContinuationV1(source));
    const firstBytes = encoded.canonicalBytes;
    const firstDigest = encoded.sha256;
    firstBytes.fill(0);
    firstDigest.fill(0);

    const decoded = await runEffect(
      decodeTaskRepairSweepContinuationV1(encoded),
    );
    expect(decoded).toEqual(source);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.directory)).toBe(true);
    expect(Object.isFrozen(decoded.partition)).toBe(true);
    expect(Object.isFrozen(decoded.partition?.cursor)).toBe(true);
    expect(encoded.canonicalBytes).not.toEqual(firstBytes);
    expect(encoded.sha256).not.toEqual(firstDigest);
  });

  it("reuses directory and due-cursor invariants and rejects excess keys", async () => {
    for (const invalid of [
      { ...continuation(), excess: true },
      continuation({ expectedScopeId: "scope_not_replacement" }),
      continuation({ dueKind: "handle_lease_expiry" }),
      continuation({ cursor: { ...cursor(), dueAtMs: 21 } }),
      continuation({
        directory: {
          kind: "continuing",
          continuation: {
            codecVersion: 1,
            highWaterScopeId: SCOPE_ONE,
            lastScopeId: SCOPE_TWO,
          },
        },
      }),
    ]) {
      const failure = await runEffectFailure(
        encodeTaskRepairSweepContinuationV1(invalid),
      );
      expect(failure).toBeInstanceOf(TaskRepairSweepContinuationCodecV1Error);
      expect(failure).toMatchObject({
        operation: "encode",
        reason: "invalidInput",
      });
    }
  });

  it("accepts exactly 4 MiB and rejects 4 MiB plus one", async () => {
    const originalDeploymentId = "deployment_one";
    const base = await runEffect(
      encodeTaskRepairSweepContinuationV1(continuation({
        expectedDeploymentId: originalDeploymentId,
      })),
    );
    const fillerAtLimit = "x".repeat(
      MAX_BYTES - base.canonicalBytes.byteLength + originalDeploymentId.length,
    );
    const exact = await runEffect(
      encodeTaskRepairSweepContinuationV1(continuation({
        expectedDeploymentId: fillerAtLimit,
      })),
    );
    expect(exact.canonicalBytes).toHaveLength(MAX_BYTES);

    const failure = await runEffectFailure(
      encodeTaskRepairSweepContinuationV1(continuation({
        expectedDeploymentId: `${fillerAtLimit}x`,
      })),
    );
    expect(failure).toBeInstanceOf(TaskRepairSweepContinuationCodecV1Error);
    expect(failure).toMatchObject({
      operation: "encode",
      reason: "sizeExceeded",
      observedBytes: MAX_BYTES + 1,
      maximumBytes: MAX_BYTES,
    });
  });

  it("rejects malformed, noncanonical, invalid UTF-8, and digest-mismatched evidence", async () => {
    const canonical = await runEffect(
      encodeTaskRepairSweepContinuationV1(continuation()),
    );
    const parsed = JSON.parse(new TextDecoder().decode(canonical.canonicalBytes));
    const nonCanonicalBytes = new TextEncoder().encode(
      JSON.stringify(parsed, null, 2),
    );
    const malformedJsonBytes = new TextEncoder().encode("{");

    for (const [input, reason] of [
      [{
        codecVersion: 1,
        canonicalBytes: nonCanonicalBytes,
        sha256: await sha256(nonCanonicalBytes),
      }, "nonCanonical"],
      [{
        codecVersion: 1,
        canonicalBytes: new Uint8Array([0xff]),
        sha256: await sha256(new Uint8Array([0xff])),
      }, "invalidUtf8"],
      [{
        codecVersion: 1,
        canonicalBytes: malformedJsonBytes,
        sha256: await sha256(malformedJsonBytes),
      }, "invalidJson"],
      [{
        codecVersion: 1,
        canonicalBytes: canonical.canonicalBytes,
        sha256: new Uint8Array(32),
      }, "invalidDigest"],
    ] as const) {
      const failure = await runEffectFailure(
        decodeTaskRepairSweepContinuationV1(input),
      );
      expect(failure).toBeInstanceOf(TaskRepairSweepContinuationCodecV1Error);
      expect(failure).toMatchObject({ operation: "decode", reason });
    }
  });

  it("keeps interruption and hostile accessors outside the typed channel", async () => {
    const interrupted = await Effect.runPromiseExit(
      Effect.interrupt.pipe(
        Effect.andThen(encodeTaskRepairSweepContinuationV1(continuation())),
      ),
    );
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isFailure(interrupted)) {
      expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
    }

    const defect = new Error("hostile Task continuation getter");
    const hostile = { ...continuation() };
    Object.defineProperty(hostile, "partition", {
      enumerable: true,
      get() {
        throw defect;
      },
    });
    const defective = await Effect.runPromiseExit(
      encodeTaskRepairSweepContinuationV1(hostile),
    );
    expect(Exit.isFailure(defective)).toBe(true);
    if (Exit.isFailure(defective)) {
      expect(Cause.hasDies(defective.cause)).toBe(true);
      expect(Cause.hasFails(defective.cause)).toBe(false);
      expect(defective.cause.toString()).toContain(defect.message);
    }
  });
});

function continuation(overrides: Readonly<Record<string, unknown>> = {}) {
  const directory = overrides.directory ?? {
    kind: "continuing",
    continuation: {
      codecVersion: 1,
      highWaterScopeId: SCOPE_TWO,
      lastScopeId: SCOPE_ONE,
    },
  };
  const dueKind = overrides.dueKind ?? "start_attempt";
  const cursorValue = overrides.cursor ?? cursor();
  return {
    version: "flarex.task-repair-sweep-continuation.v1",
    directory,
    partition: {
      expectedDeploymentId: overrides.expectedDeploymentId ?? "deployment_one",
      expectedScopeId: overrides.expectedScopeId ?? SCOPE_ONE,
      dueKind,
      cursor: cursorValue,
    },
  };
}

function cursor() {
  return {
    version: 1,
    dueKind: "start_attempt",
    throughMs: 20,
    dueAtMs: 10,
    runId: RUN_ID,
  };
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}
