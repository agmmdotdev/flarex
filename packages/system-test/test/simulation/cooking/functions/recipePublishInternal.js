import { databasePatch, runQuery } from "flarex:platform";

export async function markPublished(_, { id }) {
  const before = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (before === null) return null;
  const { published: beforePublished } = before;

  await databasePatch(id, { published: true });

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
