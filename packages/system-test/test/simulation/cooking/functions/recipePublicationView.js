import { FlarexError } from "flarex/values";

export async function requirePublished(ctx, { id }) {
  const recipe = await ctx.db.get(id);
  if (recipe === null) return null;
  if (!recipe.published) {
    throw new FlarexError(
      "RECIPE_NOT_PUBLISHED",
      "Recipe is not published.",
      { recipeId: id, published: false },
    );
  }
  return recipe;
}
