function incoming(ctx, table, field, target, limit) {
  return ctx.db.takeIncomingRelationSources({
    source: { table, field },
    target,
    limit,
  });
}

export async function projectDashboard(ctx, { owner, reviewer, watcher, project }) {
  const owned = await incoming(ctx, "projects", "owner", owner, 16);
  const reviewed = await incoming(ctx, "projects", "reviewer", reviewer, 16);
  const watched = await incoming(ctx, "projects", "watchers", watcher, 16);
  const tasks = await incoming(ctx, "tasks", "project", project, 16);
  const memberships = await incoming(
    ctx,
    "memberships",
    "project",
    project,
    16,
  );
  return {
    owned,
    reviewed,
    watched,
    tasks,
    memberships,
  };
}

export function labelTasks(ctx, { label }) {
  return incoming(ctx, "tasks", "labels", label, 16);
}

export function assignedTasks(ctx, { user }) {
  return incoming(ctx, "tasks", "assignee", user, 16);
}

export function userMemberships(ctx, { user }) {
  return incoming(ctx, "memberships", "user", user, 16);
}

export function probe(ctx, { table, field, target, limit }) {
  return incoming(ctx, table, field, target, limit);
}

export async function syscallBudget(ctx, { target, calls, limit }) {
  let last = null;
  for (let index = 0; index < calls; index += 1) {
    last = await incoming(ctx, "projects", "owner", target, limit);
  }
  return last;
}

export async function occurrenceBudget(ctx, { target, limits }) {
  let last = null;
  for (const limit of limits) {
    last = await incoming(ctx, "projects", "owner", target, limit);
  }
  return last;
}
