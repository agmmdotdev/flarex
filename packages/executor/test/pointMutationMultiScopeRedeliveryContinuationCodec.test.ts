import { Cause, Effect, Exit } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import {
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error,
  decodePointMutationMultiScopeRedeliveryContinuationV1,
  encodePointMutationMultiScopeRedeliveryContinuationV1,
} from "../src/pointMutationMultiScopeRedeliveryContinuationCodec";
import type { PointMutationMultiScopeRedeliveryContinuationV1 } from
  "../src/pointMutationMultiScopeRedelivery";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const MAX_BYTES = 4_194_304;

describe("O08-B2b2b2b1b2b2b0 continuation codec", () => {
  it("stays off the executor root and round-trips owned canonical evidence", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "encodePointMutationMultiScopeRedeliveryContinuationV1"
      | "decodePointMutationMultiScopeRedeliveryContinuationV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();

    const source = continuation("scope_high_water", "scope_last");
    const encoded = await runEffect(
      encodePointMutationMultiScopeRedeliveryContinuationV1(source),
    );
    const firstBytes = encoded.canonicalBytes;
    const firstDigest = encoded.sha256;
    firstBytes.fill(0);
    firstDigest.fill(0);

    const decoded = await runEffect(
      decodePointMutationMultiScopeRedeliveryContinuationV1(encoded),
    );
    expect(decoded).toEqual(source);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.directory)).toBe(true);
    expect(Object.isFrozen(decoded.scopes)).toBe(true);
    expect(encoded.canonicalBytes).not.toEqual(firstBytes);
    expect(encoded.sha256).not.toEqual(firstDigest);
  });

  it("accepts exactly 4 MiB and rejects 4 MiB plus one", async () => {
    const base = await runEffect(
      encodePointMutationMultiScopeRedeliveryContinuationV1(
        continuation("x", "y"),
      ),
    );
    const fillerAtLimit = "x".repeat(
      MAX_BYTES - base.canonicalBytes.byteLength + 1,
    );
    const exact = await runEffect(
      encodePointMutationMultiScopeRedeliveryContinuationV1(
        continuation(fillerAtLimit, "y"),
      ),
    );
    expect(exact.canonicalBytes).toHaveLength(MAX_BYTES);

    const failure = await runEffectFailure(
      encodePointMutationMultiScopeRedeliveryContinuationV1(
        continuation(`${fillerAtLimit}x`, "y"),
      ),
    );
    expect(failure).toBeInstanceOf(
      PointMutationMultiScopeRedeliveryContinuationCodecV1Error,
    );
    expect(failure).toMatchObject({
      operation: "encode",
      reason: "sizeExceeded",
      observedBytes: MAX_BYTES + 1,
      maximumBytes: MAX_BYTES,
    });
  });

  it("rejects malformed, noncanonical, invalid UTF-8, and digest-mismatched evidence", async () => {
    const canonical = await runEffect(
      encodePointMutationMultiScopeRedeliveryContinuationV1(
        continuation("scope_high_water", "scope_last"),
      ),
    );
    const parsed = JSON.parse(new TextDecoder().decode(canonical.canonicalBytes));
    const nonCanonicalBytes = new TextEncoder().encode(
      JSON.stringify(parsed, null, 2),
    );

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
        canonicalBytes: canonical.canonicalBytes,
        sha256: new Uint8Array(32),
      }, "invalidDigest"],
    ] as const) {
      const failure = await runEffectFailure(
        decodePointMutationMultiScopeRedeliveryContinuationV1(input),
      );
      expect(failure).toBeInstanceOf(
        PointMutationMultiScopeRedeliveryContinuationCodecV1Error,
      );
      expect(failure).toMatchObject({ operation: "decode", reason });
    }
  });

  it("preserves interruption and defects outside the typed codec channel", async () => {
    const interrupted = await Effect.runPromiseExit(
      Effect.interrupt.pipe(
        Effect.andThen(
          encodePointMutationMultiScopeRedeliveryContinuationV1(
            continuation("scope_high_water", "scope_last"),
          ),
        ),
      ),
    );
    expect(Exit.isFailure(interrupted)).toBe(true);
    if (Exit.isFailure(interrupted)) {
      expect(Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
    }

    const defect = new Error("hostile continuation getter");
    const hostile = {
      ...continuation("scope_high_water", "scope_last"),
    } satisfies PointMutationMultiScopeRedeliveryContinuationV1;
    Object.defineProperty(hostile, "scopes", {
      configurable: true,
      enumerable: true,
      get() {
        throw defect;
      },
    });
    const defective = await Effect.runPromiseExit(
      encodePointMutationMultiScopeRedeliveryContinuationV1(hostile),
    );
    expect(Exit.isFailure(defective)).toBe(true);
    if (Exit.isFailure(defective)) {
      expect(Cause.hasDies(defective.cause)).toBe(true);
      expect(Cause.hasFails(defective.cause)).toBe(false);
      expect(defective.cause.toString()).toContain(defect.message);
    }
  });
});

function continuation(
  highWaterScopeId: string,
  lastScopeId: string,
): PointMutationMultiScopeRedeliveryContinuationV1 {
  return Object.freeze({
    codecVersion: 1,
    directory: Object.freeze({
      kind: "continuing",
      continuation: Object.freeze({
        codecVersion: 1,
        highWaterScopeId: ScopeIdSchema.make(highWaterScopeId),
        lastScopeId: ScopeIdSchema.make(lastScopeId),
      }),
    }),
    scopes: Object.freeze([]),
  });
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const input = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}
