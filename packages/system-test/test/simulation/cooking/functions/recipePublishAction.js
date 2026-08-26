export async function publishAndNotify(ctx, { id }) {
  const before = await ctx.runQuery(
    "recipeActionCallbacks:isPublished",
    { id },
  );
  if (before === null) throw new Error("recipe missing");

  const publication = await ctx.runMutation(
    "recipeActionCallbacks:markPublished",
    { id },
  );
  if (publication !== true) {
    throw new Error("recipe missing during publication");
  }

  const after = await ctx.runQuery(
    "recipeActionCallbacks:isPublished",
    { id },
  );
  if (after !== true) throw new Error("recipe missing after publication");

  const response = await fetch(
    "https://api.example.com/cooking-publication",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recipeId: id,
        published: after,
      }),
    },
  );
  const acknowledgement = await response.json();
  const identity = await ctx.auth.getUserIdentity();
  return {
    recipeId: id,
    beforePublished: before,
    publication,
    afterPublished: after,
    notificationStatus: response.status,
    notificationAccepted: acknowledgement.accepted === true,
    anonymous: identity === null,
  };
}
