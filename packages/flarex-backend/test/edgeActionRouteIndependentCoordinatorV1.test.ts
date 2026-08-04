import { Effect, Exit } from "effect";
import {
  EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
} from "flarex-protocol/edge-action-exact-runtime";
import { describe, expect, it, vi } from "vitest";

import {
  EdgeActionRouteIndependentCoordinatorV1Error,
  makeEdgeActionRouteIndependentCoordinatorV1,
} from "../src/artifactRuntime/EdgeActionRouteIndependentCoordinatorV1";

describe("edge action route-independent coordinator v1", () => {
  it("captures and validates the exact host result", async () => {
    const run = vi.fn((_input: unknown, options: { signal: AbortSignal }) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({
        kind: "success",
        result: {
          format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
          version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
          value: { sent: true },
        },
      });
    });
    const coordinator = makeEdgeActionRouteIndependentCoordinatorV1({ run });
    const result = await Effect.runPromise(coordinator.dispatch({ token: 1 }));
    expect(result).toEqual({
      kind: "success",
      result: {
        format: EDGE_ACTION_EXACT_RUNTIME_RESULT_FORMAT_V1,
        version: EDGE_ACTION_EXACT_RUNTIME_RESULT_VERSION_V1,
        value: { sent: true },
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects an invalid host envelope in the typed channel", async () => {
    const coordinator = makeEdgeActionRouteIndependentCoordinatorV1({
      run: () => Promise.resolve({ kind: "success", result: null }),
    });
    await expect(Effect.runPromise(coordinator.dispatch({}))).rejects
      .toBeInstanceOf(EdgeActionRouteIndependentCoordinatorV1Error);
  });

  it("rejects accessor-backed failure envelopes without invoking the accessor", async () => {
    const reason = vi.fn(() => "cancelled");
    const envelope = Object.defineProperties({}, {
      kind: { enumerable: true, value: "failure" },
      reason: { enumerable: true, get: reason },
    });
    const coordinator = makeEdgeActionRouteIndependentCoordinatorV1({
      run: () => Promise.resolve(envelope),
    });
    await expect(Effect.runPromise(coordinator.dispatch({}))).rejects
      .toBeInstanceOf(EdgeActionRouteIndependentCoordinatorV1Error);
    expect(reason).not.toHaveBeenCalled();
  });

  it("preserves a rejected host promise as a defect", async () => {
    const cause = new Error("host defect");
    const coordinator = makeEdgeActionRouteIndependentCoordinatorV1({
      run: () => Promise.reject(cause),
    });
    const exit = await Effect.runPromise(
      Effect.exit(coordinator.dispatch({})),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("host defect");
    }
  });
});
