export async function isPublished(ctx, { id }) {
  const recipe = await ctx.db.get(id);
  return recipe?.published === true;
}

export async function markPublished(ctx, { id }) {
  const recipe = await ctx.db.get(id);
  if (recipe === null) return false;
  await ctx.db.patch(id, { published: true });
  return true;
}

export async function markFailure(ctx, { id }) {
  const recipe = await ctx.db.get(id);
  if (recipe === null) return false;
  await ctx.db.patch(id, { description: "Child committed." });
  return true;
}
