import { databasePatch, runQuery } from "flarex:platform";

export async function markPublished(_, { id }) {
  const before = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (before === null) return null;

  await databasePatch(id, { published: true });

  const after = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (after === null) return null;

  return {
    changed: !before.published && after.published,
    beforePublished: before.published,
    afterPublished: after.published,
    ingredientCount: after.ingredientCount,
    timedMinutes: after.timedMinutes,
  };
}
