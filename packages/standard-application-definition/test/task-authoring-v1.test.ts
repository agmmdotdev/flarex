import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as PreparedDefinition from "../src/preparedDefinitionV1.js";
import {
  defineStandardApplicationTaskV1,
  type InferStandardApplicationTaskOutputV1,
  type InferStandardApplicationTaskPayloadV1,
} from "../src/taskAuthoringV1.js";
import { standardV1 } from "../src/authoringV1.js";

describe("Standard Application Task authoring V1", () => {
  it("keeps typed Task authoring outside the prepared-definition contract", () => {
    expect("defineStandardApplicationTaskV1" in PreparedDefinition).toBe(false);
  });

  it("lowers Standard validators through the canonical Task manifest owner", () => {
    const definition = Result.getOrThrow(defineStandardApplicationTaskV1({
      taskId: "cooking.prepareRecipe",
      handler: {
        logicalModulePath: "tasks/cooking",
        artifactModulePath: "tasks/cooking.js",
        exportName: "prepareRecipe",
      },
      payload: standardV1.object({
        recipeId: standardV1.string(),
        servings: standardV1.number(),
        note: standardV1.optional(standardV1.string()),
      }),
      output: standardV1.object({
        prepared: standardV1.boolean(),
      }),
      runAttemptPolicy: policy(),
      maximumDurationInSeconds: 300,
      computeProfile: "standard-1x",
      queue: { kind: "default" },
    }));

    type Payload = InferStandardApplicationTaskPayloadV1<
      typeof definition.reference
    >;
    type Output = InferStandardApplicationTaskOutputV1<
      typeof definition.reference
    >;
    expectTypeOf<Payload>().toEqualTypeOf<Readonly<{
      readonly recipeId: string;
      readonly servings: number;
      readonly note?: string;
    }>>();
    expectTypeOf<Output>().toEqualTypeOf<Readonly<{
      readonly prepared: boolean;
    }>>();
    expect(definition.manifest).toMatchObject({
      version: 1,
      taskId: "cooking.prepareRecipe",
      payloadValidator: {
        type: "object",
        value: {
          recipeId: { fieldType: { type: "string" }, optional: false },
          servings: { fieldType: { type: "number" }, optional: false },
          note: { fieldType: { type: "string" }, optional: true },
        },
      },
      outputValidator: {
        type: "object",
        value: {
          prepared: { fieldType: { type: "boolean" }, optional: false },
        },
      },
    });
    expect(definition.reference.taskId).toBe(definition.manifest.taskId);
    expect(Object.keys(definition.reference)).toEqual(["taskId"]);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.reference)).toBe(true);
  });

  it("retains null output as an unclaimed runtime output type", () => {
    const definition = Result.getOrThrow(defineStandardApplicationTaskV1({
      ...baseInput(),
      payload: standardV1.string(),
      output: null,
    }));

    type Output = InferStandardApplicationTaskOutputV1<
      typeof definition.reference
    >;
    expectTypeOf<Output>().toEqualTypeOf<unknown>();
    expect(definition.manifest.outputValidator).toBeNull();
  });

  it("preserves canonical validation failures and snapshots mutable inputs", () => {
    const handler = {
      logicalModulePath: "tasks/cooking",
      artifactModulePath: "tasks/cooking.js",
      exportName: "prepareRecipe",
    };
    const runAttemptPolicy = policy();
    const definition = Result.getOrThrow(defineStandardApplicationTaskV1({
      ...baseInput(),
      handler,
      runAttemptPolicy,
      payload: standardV1.string(),
      output: standardV1.boolean(),
    }));

    handler.exportName = "changed";
    runAttemptPolicy.retry.maxAttempts = 99;
    expect(definition.manifest.handler.exportName).toBe("prepareRecipe");
    expect(definition.manifest.runAttemptPolicy.retry.maxAttempts).toBe(3);

    const invalid = defineStandardApplicationTaskV1({
      ...baseInput(),
      taskId: " invalid",
      payload: standardV1.string(),
      output: standardV1.boolean(),
    });
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({
        _tag: "InvalidStandardApplicationTaskDefinitionV1Error",
        operation: "decode_manifest",
        reason: "invalid_task_id",
        path: "taskId",
      });
    }
  });
});

function baseInput() {
  return {
    taskId: "cooking.prepareRecipe",
    handler: {
      logicalModulePath: "tasks/cooking",
      artifactModulePath: "tasks/cooking.js",
      exportName: "prepareRecipe",
    },
    runAttemptPolicy: policy(),
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x" as const,
    queue: { kind: "default" as const },
  };
}

function policy() {
  return {
    version: 1 as const,
    retry: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      randomize: true,
    },
    outOfMemory: { kind: "disabled" as const },
  };
}
