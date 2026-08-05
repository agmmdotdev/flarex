import { runMutation, runQuery } from "flarex:platform";

export async function publish(_, { id }) {
  const assessment = await runQuery(
    { _path: "recipeAssessment:assess" },
    { id },
  );
  if (assessment === null) return null;
  if (!assessment.publishable) return null;

  return await runMutation(
    { _path: "recipeMaintenance:markPublished" },
    { id },
  );
}
