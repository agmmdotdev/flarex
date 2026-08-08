import { FlarexError } from "flarex/values";

export async function reserveAndPublish(ctx, { pantryId, recipeId }) {
  const pantry = await ctx.db.get(pantryId);
  const recipe = await ctx.db.get(recipeId);
  if (pantry === null || recipe === null) return null;

  const { available } = pantry;
  if (available < 1) {
    throw new FlarexError(
      "INSUFFICIENT_STOCK",
      "Pantry stock is insufficient.",
      { pantryId, requested: 1, available },
    );
  }

  const remainingStock = available - 1;
  await ctx.db.patch(pantryId, { available: remainingStock });
  await ctx.db.patch(recipeId, { published: true });
  return { pantryId, recipeId, remainingStock };
}
