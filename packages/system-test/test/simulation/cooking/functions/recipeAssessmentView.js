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

export async function buildServingGuide(ctx, { recipeId }) {
  const recipeAssessment = await ctx.runQuery(
    "recipeViews:assessment",
    { id: recipeId },
  );
  if (recipeAssessment === null) {
    throw new Error("recipe missing");
  }
  return {
    recipeId,
    assessment: recipeAssessment,
  };
}

export async function publishServingGuide(ctx, { recipeId }) {
  const publication = await ctx.runMutation(
    "recipeWorkflows:publish",
    { id: recipeId },
  );
  if (publication === null) {
    throw new Error("recipe missing");
  }
  const recipeAssessment = await ctx.runQuery(
    "recipeViews:assessment",
    { id: recipeId },
  );
  if (recipeAssessment === null) {
    throw new Error("recipe missing after publication");
  }
  return {
    recipeId,
    publication,
    assessment: recipeAssessment,
  };
}
