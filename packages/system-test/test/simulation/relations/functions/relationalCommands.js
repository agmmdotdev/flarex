export async function seed(ctx) {
  const owner = await ctx.db.insert("users", { name: "Owner" });
  const reviewer = await ctx.db.insert("users", { name: "Reviewer" });
  const watcherA = await ctx.db.insert("users", { name: "Watcher A" });
  const watcherB = await ctx.db.insert("users", { name: "Watcher B" });
  const labelA = await ctx.db.insert("labels", { name: "urgent" });
  const labelB = await ctx.db.insert("labels", { name: "backend" });
  const project = await ctx.db.insert("projects", {
    title: "Relational system test",
    owner,
    reviewer,
    watchers: [watcherB, watcherA],
  });
  const task = await ctx.db.insert("tasks", {
    title: "Exercise relation boundaries",
    project,
    assignee: reviewer,
    labels: [labelB, labelA],
  });
  const membership = await ctx.db.insert("memberships", {
    user: watcherA,
    project,
    role: "editor",
  });
  return {
    owner,
    reviewer,
    watcherA,
    watcherB,
    labelA,
    labelB,
    project,
    task,
    membership,
  };
}

export async function createProject(ctx, args) {
  return ctx.db.insert("projects", args);
}

export async function createProjects(ctx, { owner, count, prefix }) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await ctx.db.insert("projects", {
      title: `${prefix}-${index}`,
      owner,
      watchers: [],
    }));
  }
  return ids;
}

export async function createTask(ctx, args) {
  return ctx.db.insert("tasks", args);
}

export async function patchProject(ctx, { id, patch }) {
  await ctx.db.patch(id, patch);
  return null;
}

export async function clearProjectReviewerAndWatchers(ctx, { id }) {
  await ctx.db.patch(id, { reviewer: undefined, watchers: [] });
  return null;
}

export async function remove(ctx, { id }) {
  await ctx.db.delete(id);
  return null;
}
