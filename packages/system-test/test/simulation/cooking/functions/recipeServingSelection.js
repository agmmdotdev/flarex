export async function publishSmallestBatch(ctx) {
  const page = await ctx.db.queryIndexRange(
    "recipes",
    "by_servings",
    {},
    1,
  );
  const { documents, isDone } = page;
  for (const recipe of documents) {
    const { _id: recipeId, servings } = recipe;
    await ctx.db.patch(recipeId, { published: true });
    return {
      recipeId,
      servings,
      pageExhausted: isDone,
    };
  }
  return null;
}
