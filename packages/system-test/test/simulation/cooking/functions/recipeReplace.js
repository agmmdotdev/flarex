export async function replace(ctx, { id, fields }) {
  await ctx.db.replace(id, fields);
  return null;
}
