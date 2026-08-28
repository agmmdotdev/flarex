import {
  defineStandardApplicationTaskV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import { standardV1 } from "@flarex/standard-application-definition/v1";
import { Result } from "effect";

const ASSESSMENT_VIEW_FIELDS = {
  title: standardV1.string(),
  servings: standardV1.number(),
  published: standardV1.boolean(),
  ingredientCount: standardV1.number(),
  stepCount: standardV1.number(),
  timedMinutes: standardV1.number(),
  publishable: standardV1.boolean(),
  headline: standardV1.string(),
  effort: standardV1.union(
    standardV1.literal("short"),
    standardV1.literal("long"),
  ),
} as const;

const PUBLISH_RECEIPT_FIELDS = {
  changed: standardV1.boolean(),
  beforePublished: standardV1.boolean(),
  afterPublished: standardV1.boolean(),
  ingredientCount: standardV1.number(),
  timedMinutes: standardV1.number(),
} as const;

export const COOKING_SERVING_GUIDE_TASK = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "cooking.buildServingGuide",
    handler: {
      logicalModulePath: "recipeViews",
      artifactModulePath: "recipeAssessmentView",
      exportName: "buildServingGuide",
    },
    payload: standardV1.object({
      recipeId: standardV1.id("recipes"),
    }),
    output: standardV1.object({
      recipeId: standardV1.id("recipes"),
      assessment: standardV1.object(ASSESSMENT_VIEW_FIELDS),
    }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 1,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);

export const COOKING_PUBLISH_SERVING_GUIDE_TASK = Result.getOrThrow(
  defineStandardApplicationTaskV1({
    taskId: "cooking.publishServingGuide",
    handler: {
      logicalModulePath: "recipeViews",
      artifactModulePath: "recipeAssessmentView",
      exportName: "publishServingGuide",
    },
    payload: standardV1.object({
      recipeId: standardV1.id("recipes"),
    }),
    output: standardV1.object({
      recipeId: standardV1.id("recipes"),
      publication: standardV1.object(PUBLISH_RECEIPT_FIELDS),
      assessment: standardV1.object(ASSESSMENT_VIEW_FIELDS),
    }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 2,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  }),
);
