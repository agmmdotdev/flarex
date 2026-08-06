export async function assessment(ctx, args) {
  const result = await ctx.runQuery(
    { _path: "recipeAssessment:assess" },
    args,
  );
  if (result === null) return null;
  const {
    title,
    servings,
    published,
    ingredientCount,
    stepCount,
    timedMinutes,
    publishable,
  } = result;

  return {
    title,
    servings,
    published,
    ingredientCount,
    stepCount,
    timedMinutes,
    publishable,
    headline: title + " serves " + servings,
    effort: timedMinutes >= 30 ? "long" : "short",
  };
}
