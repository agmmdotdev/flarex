export async function assess(ctx, { id }) {
  const recipe = await ctx.db.get(id);
  if (recipe === null) return null;

  const {
    ingredients,
    steps,
    title,
    servings,
    published,
  } = recipe;
  const { length: ingredientCount } = ingredients;
  const { length: stepCount } = steps;
  let timedMinutes = 0;
  for (const { durationMinutes } of steps) {
    if (durationMinutes !== undefined) {
      timedMinutes += durationMinutes;
    }
  }

  return {
    title,
    servings,
    published,
    ingredientCount,
    stepCount,
    timedMinutes,
    publishable:
      title !== "" &&
      ingredientCount > 0 &&
      stepCount > 0,
  };
}
