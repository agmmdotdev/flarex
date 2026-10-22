import type { TestProject } from "vitest/node";

/** One lease owner per Vitest runner, including its watch/rerun lifetime. */
export default async function setup(project: TestProject) {
  const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL?.trim();
  if (connectionString === undefined || connectionString.length === 0) return;
  const { startPostgresStorageSession } = await import("./postgresStorageSessionOwner");
  const session = await startPostgresStorageSession(connectionString, Math.max(2, project.config.maxWorkers * 2));
  project.provide("postgresStorageSession", session.endpoint);
  return async () => {
    const failures: unknown[] = [];
    try { await session.close(); } catch (cause: unknown) { failures.push(cause); }
    const path = process.env.FLAREX_POSTGRES_FIXTURE_METRICS;
    if (path !== undefined) {
      try { await (await import("node:fs/promises")).writeFile(path, JSON.stringify(session.statistics())); }
      catch (cause: unknown) { failures.push(cause); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Storage session cleanup or metrics failed");
  };
}
