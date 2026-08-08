import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodePointMutationExactRuntimeHostResponseV2Effect,
  MAX_POINT_MUTATION_APPLICATION_ERROR_TEXT_BYTES_V2,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
  PointMutationExactRuntimeHostResponseV2Error,
} from "../src/point-mutation-exact-runtime-host";
import {
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
} from "../src/point-mutation-exact-runtime";

describe("point mutation exact-runtime host response", () => {
  it("strictly decodes success, application-error, and bounded failure responses", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "success",
        result: {
          format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: 1,
          value: { ok: true },
        },
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
      version: 2,
      kind: "success",
      result: {
        format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: { ok: true },
      },
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: {
          code: "RECIPE_INVALID",
          message: "Recipe cannot be published",
          data: {
            violations: ["missing-photo"],
            attempt: 2n,
            evidence: new Uint8Array([1, 2, 3]).buffer,
          },
        },
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
      version: 2,
      kind: "applicationError",
      error: {
        code: "RECIPE_INVALID",
        message: "Recipe cannot be published",
        data: {
          violations: ["missing-photo"],
          attempt: 2n,
          evidence: new Uint8Array([1, 2, 3]).buffer,
        },
      },
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: {
          code: "NO_DATA",
          message: "No data",
        },
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
      version: 2,
      kind: "applicationError",
      error: {
        code: "NO_DATA",
        message: "No data",
      },
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "failure",
        reason: "sourcePackagePinMismatch",
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
      version: 2,
      kind: "failure",
      reason: "sourcePackagePinMismatch",
    });
  });

  it("rejects skew, excess fields, unknown reasons, and malformed application errors", async () => {
    for (const response of [
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 1,
        kind: "failure",
        reason: "invalidRequest",
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "failure",
        reason: "unknown",
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "failure",
        reason: "invalidRequest",
        extra: true,
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: { code: "", message: "invalid" },
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: {
          code: "x".repeat(
            MAX_POINT_MUTATION_APPLICATION_ERROR_TEXT_BYTES_V2 + 1,
          ),
          message: "invalid",
        },
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: { code: "INVALID", message: "invalid", extra: true },
      },
    ]) {
      await expect(Effect.runPromise(
        decodePointMutationExactRuntimeHostResponseV2Effect(response),
      )).rejects.toBeInstanceOf(PointMutationExactRuntimeHostResponseV2Error);
    }
  });

  it("rejects invalid result and application-error value domains", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "success",
        result: {
          format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: 1,
          value: undefined,
        },
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostResponseV2Error",
      reason: "invalidResult",
    });

    for (const data of [undefined, Symbol("invalid"), { cycle: null }] as unknown[]) {
      if (typeof data === "object" && data !== null) {
        Reflect.set(data, "cycle", data);
      }
      await expect(Effect.runPromise(
        decodePointMutationExactRuntimeHostResponseV2Effect({
          format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
          version: 2,
          kind: "applicationError",
          error: { code: "INVALID", message: "invalid", data },
        }),
      )).rejects.toMatchObject({
        _tag: "PointMutationExactRuntimeHostResponseV2Error",
        reason: "invalidApplicationError",
      });
    }
  });

  it("preserves unexpected application-error codec causes as defects", async () => {
    const defect = new Error("unexpected value codec defect");
    const data = new Proxy({}, {
      ownKeys: () => {
        throw defect;
      },
    });
    const exit = await Effect.runPromiseExit(
      decodePointMutationExactRuntimeHostResponseV2Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
        version: 2,
        kind: "applicationError",
        error: { code: "DEFECT", message: "defect", data },
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
    }
  });
});
