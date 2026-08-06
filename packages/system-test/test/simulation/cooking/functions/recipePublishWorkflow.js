export async function publish(ctx, { id }) {
  const assessment = await ctx.runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (assessment === null) return null;
  const { publishable } = assessment;
  if (!publishable) return null;

  return await ctx.runMutation(
    { _path: "recipeMaintenance:markPublished" },
    { id },
  );
}
