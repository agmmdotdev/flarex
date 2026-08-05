import { databaseGet } from "flarex:platform";

export async function assess(_, { id }) {
  const recipe = await databaseGet(id);
  if (recipe === null) return null;

  const ingredientCount = recipe.ingredients.length;
  const stepCount = recipe.steps.length;
  let timedMinutes = 0;
  for (const step of recipe.steps) {
    if (step.durationMinutes !== undefined) {
      timedMinutes += step.durationMinutes;
    }
  }

  return {
    title: recipe.title,
    servings: recipe.servings,
    published: recipe.published,
    ingredientCount,
    stepCount,
    timedMinutes,
    publishable:
      recipe.title.length > 0 &&
      ingredientCount > 0 &&
      stepCount > 0,
  };
}
