export async function remove(ctx, { id }) {
  await ctx.db.delete(id);
  return null;
}
