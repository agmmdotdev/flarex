import { runQuery } from "flarex:platform";

export async function assessment(_, args) {
  const result = await runQuery(
    { _path: "recipeAssessment:assess" },
    args,
  );
  if (result === null) return null;

  return {
    title: result.title,
    servings: result.servings,
    published: result.published,
    ingredientCount: result.ingredientCount,
    stepCount: result.stepCount,
    timedMinutes: result.timedMinutes,
    publishable: result.publishable,
    headline: result.title + " serves " + result.servings,
    effort: result.timedMinutes >= 30 ? "long" : "short",
  };
}
