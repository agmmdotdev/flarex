import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodePointMutationExactRuntimeHostResponseV1Effect,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
  PointMutationExactRuntimeHostResponseV1Error,
} from "../src/point-mutation-exact-runtime-host";
import {
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
} from "../src/point-mutation-exact-runtime";

describe("point mutation exact-runtime host response", () => {
  it("strictly decodes success and bounded failure responses", async () => {
    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 1,
        kind: "success",
        result: {
          format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: 1,
          value: { ok: true },
        },
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
      version: 1,
      kind: "success",
      result: {
        format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: 1,
        value: { ok: true },
      },
    });

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 1,
        kind: "failure",
        reason: "sourcePackagePinMismatch",
      }),
    )).resolves.toEqual({
      format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
      version: 1,
      kind: "failure",
      reason: "sourcePackagePinMismatch",
    });
  });

  it("rejects version skew, excess fields, unknown reasons, and invalid results", async () => {
    for (const response of [
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 2,
        kind: "failure",
        reason: "invalidRequest",
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 1,
        kind: "failure",
        reason: "unknown",
      },
      {
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 1,
        kind: "failure",
        reason: "invalidRequest",
        extra: true,
      },
    ]) {
      await expect(Effect.runPromise(
        decodePointMutationExactRuntimeHostResponseV1Effect(response),
      )).rejects.toBeInstanceOf(PointMutationExactRuntimeHostResponseV1Error);
    }

    await expect(Effect.runPromise(
      decodePointMutationExactRuntimeHostResponseV1Effect({
        format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
        version: 1,
        kind: "success",
        result: {
          format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: 1,
          value: undefined,
        },
      }),
    )).rejects.toMatchObject({
      _tag: "PointMutationExactRuntimeHostResponseV1Error",
      reason: "invalidResult",
    });
  });
});
