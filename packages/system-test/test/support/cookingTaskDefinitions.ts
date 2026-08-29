import {
  type ApplicationModule,
  task,
  v,
} from "@flarex/application-definition";
import { Result } from "effect";

const ASSESSMENT_VIEW_FIELDS = {
  title: v.string(),
  servings: v.number(),
  published: v.boolean(),
  ingredientCount: v.number(),
  stepCount: v.number(),
  timedMinutes: v.number(),
  publishable: v.boolean(),
  headline: v.string(),
  effort: v.union(
    v.literal("short"),
    v.literal("long"),
  ),
} as const;

const PUBLISH_RECEIPT_FIELDS = {
  changed: v.boolean(),
  beforePublished: v.boolean(),
  afterPublished: v.boolean(),
  ingredientCount: v.number(),
  timedMinutes: v.number(),
} as const;

export function defineCookingTasks(module: ApplicationModule) {
  const servingGuide = Result.getOrThrow(task({
    id: "cooking.buildServingGuide",
    handler: { module, exportName: "buildServingGuide" },
    payload: v.object({ recipeId: v.id("recipes") }),
    returns: v.object({
      recipeId: v.id("recipes"),
      assessment: v.object(ASSESSMENT_VIEW_FIELDS),
    }),
    attempts: {
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
    compute: "standard-1x",
    queue: { kind: "default" },
  }));
  const publishServingGuide = Result.getOrThrow(task({
    id: "cooking.publishServingGuide",
    handler: { module, exportName: "publishServingGuide" },
    payload: v.object({ recipeId: v.id("recipes") }),
    returns: v.object({
      recipeId: v.id("recipes"),
      publication: v.object(PUBLISH_RECEIPT_FIELDS),
      assessment: v.object(ASSESSMENT_VIEW_FIELDS),
    }),
    attempts: {
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
    compute: "standard-1x",
    queue: { kind: "default" },
  }));

  return Object.freeze({ servingGuide, publishServingGuide });
}
