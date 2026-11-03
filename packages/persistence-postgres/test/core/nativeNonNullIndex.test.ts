import { Effect } from "effect";
import { expect, it } from "vitest";
import { createCorePGliteFixture } from "./fixture";
import { compileNativeNonNullIndex, registerNativeNonNullIndexScenarios } from "./nativeNonNullIndexScenario";

it.each(["unique", "compound", "unrelatedKey"] as const)("refuses non-null %s outside the selected declaration shapes", async shape => {
  const result = await Effect.runPromise(Effect.result(compileNativeNonNullIndex(shape)));
  expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreSchemaError", reason: "unsupportedCapability" } });
});

registerNativeNonNullIndexScenarios("PGlite native non-null index", createCorePGliteFixture);
