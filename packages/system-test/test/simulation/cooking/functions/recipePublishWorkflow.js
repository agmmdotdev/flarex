import { FlarexError } from "flarex/values";

export async function publish(ctx, { id }) {
  const assessment = await ctx.runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (assessment === null) return null;
  const { ingredientCount, publishable, stepCount, title } = assessment;
  if (!publishable) {
    const violation = title === ""
      ? "title-required"
      : ingredientCount === 0
      ? "ingredients-required"
      : "steps-required";
    throw new FlarexError(
      "RECIPE_NOT_PUBLISHABLE",
      "Recipe cannot be published.",
      { recipeId: id, violations: [violation] },
    );
  }

  return await ctx.runMutation(
    { _path: "recipeMaintenance:markPublished" },
    { id },
  );
}
