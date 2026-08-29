import { inspectTaskDefinition, inspectTaskReference } from
  "@flarex/application-definition/internal/task-definition";
import { Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  defineModule,
  sourceModule,
  task,
  type TaskDefinition,
  v,
} from "../src/index.js";

const tasksModule = defineModule({
  path: "tasks/cooking",
  source: sourceModule({
    path: "functions/tasks/cooking.js",
    bytes: new TextEncoder().encode("export const prepare = 1;\n"),
  }),
  functions: {},
});

describe("clean Task definition primitive", () => {
  it("derives canonical handler paths and keeps Task metadata opaque", () => {
    const attempts = Object.assign({
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" as const },
    }, { version: 2 });
    const definition = Result.getOrThrow(task({
      id: "cooking.prepare",
      handler: { module: tasksModule, exportName: "prepare" },
      payload: v.object({ recipeId: v.string(), servings: v.number() }),
      returns: v.object({ prepared: v.boolean() }),
      attempts,
      maximumDurationInSeconds: 30,
      compute: "standard-1x",
      queue: { kind: "default" },
    }));

    expect(Object.keys(definition)).toEqual(["reference"]);
    expect(Object.keys(definition.reference)).toEqual([]);
    expect(Object.isFrozen(definition)).toBe(true);
    expect(Object.isFrozen(definition.reference)).toBe(true);
    const reference = inspectTaskReference(definition.reference);
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference.returnsValidator)).toBe(true);
    expect(reference.returnsValidator).toEqual({
      type: "object",
      value: {
        prepared: {
          fieldType: { type: "boolean" },
          optional: false,
        },
      },
    });
    expect(inspectTaskDefinition(definition).standard.manifest).toMatchObject({
      version: 1,
      taskId: "cooking.prepare",
      handler: {
        logicalModulePath: "tasks/cooking",
        artifactModulePath: "functions/tasks/cooking.js",
        exportName: "prepare",
      },
      runAttemptPolicy: { version: 1 },
    });
    expectTypeOf(definition).toEqualTypeOf<TaskDefinition<
      Readonly<{ readonly recipeId: string; readonly servings: number }>,
      Readonly<{ readonly prepared: boolean }>
    >>();
  });

  it("preserves the canonical Task definition failure", () => {
    const result = task({
      id: "",
      handler: { module: tasksModule, exportName: "prepare" },
      payload: v.object({}),
      returns: v.null(),
      attempts: {
        retry: {
          maxAttempts: 1,
          factor: 2,
          minTimeoutInMs: 1_000,
          maxTimeoutInMs: 60_000,
          randomize: false,
        },
        outOfMemory: { kind: "disabled" },
      },
      maximumDurationInSeconds: 30,
      compute: "standard-1x",
      queue: { kind: "default" },
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe(
        "InvalidStandardApplicationTaskDefinitionV1Error",
      );
    }
  });

  it("projects authored ID hints to runtime strings in Task outputs", () => {
    const definition = Result.getOrThrow(task({
      id: "cooking.assign",
      handler: { module: tasksModule, exportName: "prepare" },
      payload: v.object({ recipeId: v.string() }),
      returns: v.object({
        ownerId: v.id("users"),
        previousOwnerIds: v.array(v.id("users")),
      }),
      attempts: {
        retry: {
          maxAttempts: 1,
          factor: 2,
          minTimeoutInMs: 1_000,
          maxTimeoutInMs: 60_000,
          randomize: false,
        },
        outOfMemory: { kind: "disabled" },
      },
      maximumDurationInSeconds: 30,
      compute: "standard-1x",
      queue: { kind: "default" },
    }));

    expectTypeOf(definition).toEqualTypeOf<TaskDefinition<
      Readonly<{ readonly recipeId: string }>,
      Readonly<{
        readonly ownerId: string;
        readonly previousOwnerIds: ReadonlyArray<string>;
      }>
    >>();
  });
});
