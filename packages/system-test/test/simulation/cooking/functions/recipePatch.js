export async function patch(ctx, { id, patch: values }) {
  await ctx.db.patch(id, values);
  return null;
}

export async function patchThenReturnInvalid(ctx, { id }) {
  await ctx.db.patch(id, { title: "This value must roll back." });
  return "not-null";
}

export async function patchThenThrow(ctx, { id }) {
  await ctx.db.patch(id, { title: "This throw must roll back." });
  throw "Injected cooking mutation failure.";
}

export function inspectionOnly() {
  return null;
}
