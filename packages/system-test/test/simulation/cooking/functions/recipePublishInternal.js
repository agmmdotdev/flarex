import { runQuery } from "flarex:platform";

export async function markPublished(ctx, { id }) {
  const before = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (before === null) return null;
  const { published: beforePublished } = before;

  await ctx.db.patch(id, { published: true });

  const after = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (after === null) return null;
  const {
    published: afterPublished,
    ingredientCount,
    timedMinutes,
  } = after;

  return {
    changed: !beforePublished && afterPublished,
    beforePublished,
    afterPublished,
    ingredientCount,
    timedMinutes,
  };
}
