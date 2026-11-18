import { Schema } from "effect";
import type { RetrievalServerSnapshot } from "../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";
import { FailureEvidenceSchema } from "./failure";
import { ServerPlanEvidenceSchema } from "./collectors/plans";

const Count = Schema.Natural;
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const QueryId = Schema.String.check(Schema.isPattern(/^-?\d+$/));
const Pid = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 2_147_483_647 }));
const OrderedInterval = Schema.makeFilter<{ startMs: number; endMs: number }>(value =>
  value.endMs >= value.startMs ? undefined : "Reversed server observation interval");

export const ServerActivitySchema = Schema.Struct({
  pid: Pid, backendStart: Schema.String, dbid: Count, userid: Count,
  state: Schema.NullOr(Schema.String), queryid: Schema.NullOr(QueryId),
  queryStart: Schema.NullOr(Schema.String), waitType: Schema.NullOr(Schema.String),
  waitEvent: Schema.NullOr(Schema.String), blockerPids: Schema.Array(Schema.Natural),
});
export type ServerActivity = typeof ServerActivitySchema.Type;
export const ServerPollSchema = Schema.Struct({
  startMs: Milliseconds, endMs: Milliseconds, serverAt: Schema.String,
  activities: Schema.Array(ServerActivitySchema),
}).check(OrderedInterval);
export type ServerPoll = typeof ServerPollSchema.Type;
export const ServerStatementSchema = Schema.Struct({
  userid: Count, dbid: Count, queryid: QueryId, toplevel: Schema.Boolean, stats_since: Schema.String,
  calls: Count, plans: Count, total_plan_time: Milliseconds, total_exec_time: Milliseconds,
  rows: Count, shared_blks_hit: Count, shared_blks_read: Count,
  shared_blks_dirtied: Count, shared_blks_written: Count, temp_blks_read: Count, temp_blks_written: Count,
});
const Epoch = Schema.Struct({ stats_reset: Schema.String, dealloc: Count });
export const ServerLimitsSchema = Schema.Struct({
  intervalMs: Schema.Int.check(Schema.isBetween({ minimum: 25, maximum: 1000 })),
  maxPolls: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 })),
  maxRows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1024 })),
  maxStatements: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50_000 })),
  maxDurationMs: Schema.Int.check(Schema.isBetween({ minimum: 25, maximum: 120_000 })),
  queryTimeoutMs: Schema.Int.check(Schema.isBetween({ minimum: 25, maximum: 5000 })),
});
export type ServerLimits = typeof ServerLimitsSchema.Type;
export const serverLimits: ServerLimits = Object.freeze({ intervalMs: 25, maxPolls: 1200,
  maxRows: 128, maxStatements: 20_000, maxDurationMs: 30_000, queryTimeoutMs: 1000 });
export const ServerMeasurementEvidenceSchema = Schema.Struct({
  originMonotonicMs: Milliseconds,
  database: Schema.Struct({ database: Schema.String, dbid: Count }),
  root: Schema.Struct({ startMs: Milliseconds, endMs: Milliseconds }).check(OrderedInterval),
  limits: ServerLimitsSchema,
  status: Schema.Literals(["complete", "incomplete"]),
  before: Schema.NullOr(Epoch), after: Schema.NullOr(Epoch),
  beforeStatements: Schema.Array(ServerStatementSchema), afterStatements: Schema.Array(ServerStatementSchema),
  statements: Schema.Array(ServerStatementSchema), polls: Schema.Array(ServerPollSchema),
  missedTicks: Count, droppedRows: Count,
  observers: Schema.Array(Schema.Struct({ name: Schema.String, startMs: Milliseconds,
    endMs: Milliseconds, outcome: Schema.Literals(["success", "failure"]) }).check(OrderedInterval)),
  failures: Schema.Array(FailureEvidenceSchema),
  actualPlans: Schema.Union([ServerPlanEvidenceSchema,
    Schema.Struct({ status: Schema.Literal("unavailable"), reason: Schema.Literal("noValidatedBoundedLogSource") })]),
}).check(Schema.makeFilter(value => value.polls.length > value.limits.maxPolls || value.polls.some(poll =>
  poll.activities.length > value.limits.maxRows) || value.statements.length > value.limits.maxStatements
    || value.beforeStatements.length > value.limits.maxStatements || value.afterStatements.length > value.limits.maxStatements
  ? "Server evidence exceeds configured retention bounds" : undefined));
export type ServerMeasurementEvidence = typeof ServerMeasurementEvidenceSchema.Type;

/** Never persist representative SQL. PostgreSQL normalization is not a privacy
 * contract and server IDs are not the driver's structural SQL fingerprints. */
export function safeServerStatements(statements: RetrievalServerSnapshot["statements"]):
  readonly (typeof ServerStatementSchema.Type)[] {
  return statements.map(entry => ({ userid: entry.userid, dbid: entry.dbid, queryid: entry.queryid,
    toplevel: entry.toplevel, stats_since: entry.stats_since, calls: entry.calls, plans: entry.plans,
    total_plan_time: entry.total_plan_time, total_exec_time: entry.total_exec_time, rows: entry.rows,
    shared_blks_hit: entry.shared_blks_hit, shared_blks_read: entry.shared_blks_read,
    shared_blks_dirtied: entry.shared_blks_dirtied, shared_blks_written: entry.shared_blks_written,
    temp_blks_read: entry.temp_blks_read, temp_blks_written: entry.temp_blks_written }));
}

export interface ServerDriverInterval {
  readonly id: string; readonly parentId: string | null; readonly backendPid: number | null;
  readonly startMs: number; readonly endMs: number | null;
}

/** PID/time intersections establish candidates only. Await intervals also
 * contain queued client work and samples cannot recover unsampled statements. */
export function analyzeServerEvidence(evidence: ServerMeasurementEvidence,
  drivers: readonly ServerDriverInterval[], driverOriginMonotonicMs = evidence.originMonotonicMs) {
  const starts = new Map<number, Set<string>>();
  for (const poll of evidence.polls) for (const activity of poll.activities) {
    const known = starts.get(activity.pid) ?? new Set<string>();
    known.add(activity.backendStart); starts.set(activity.pid, known);
  }
  const offset = driverOriginMonotonicMs - evidence.originMonotonicMs;
  const correlations = evidence.polls.flatMap((poll, pollIndex) => poll.activities.map(activity => {
    const reused = (starts.get(activity.pid)?.size ?? 0) > 1;
    const active = activity.state === "active" && activity.queryid !== null && activity.queryid !== "0";
    const candidates = !active || reused ? [] : drivers.filter(driver => driver.backendPid === activity.pid &&
      driver.endMs !== null && driver.startMs + offset <= poll.endMs && driver.endMs + offset >= poll.startMs);
    return { pollIndex, pid: activity.pid, backendStart: activity.backendStart, queryid: activity.queryid,
      status: reused ? "pidReuse" as const : !active ? "inactiveOrUnavailable" as const : candidates.length === 0
        ? "unmatched" as const : candidates.length === 1 ? "singleCandidate" as const : "ambiguous" as const,
      candidateDriverIds: candidates.map(candidate => candidate.id),
      candidateOperationParents: [...new Set(candidates.flatMap(candidate => candidate.parentId === null ? [] : [candidate.parentId]))] };
  }));
  const groups = new Map<string, { waitType: string; waitEvent: string; observations: number; pids: Set<number> }>();
  for (const poll of evidence.polls) for (const activity of poll.activities) {
    if (activity.waitType === null || activity.waitEvent === null) continue;
    const key = JSON.stringify([activity.waitType, activity.waitEvent]);
    const group = groups.get(key) ?? { waitType: activity.waitType, waitEvent: activity.waitEvent, observations: 0, pids: new Set<number>() };
    group.observations++; group.pids.add(activity.pid); groups.set(key, group);
  }
  const top = evidence.statements.filter(statement => statement.toplevel);
  const nested = evidence.statements.filter(statement => !statement.toplevel);
  const totals = (statements: typeof evidence.statements) => ({
    calls: statements.reduce((sum, statement) => sum + statement.calls, 0),
    plans: statements.reduce((sum, statement) => sum + statement.plans, 0),
    planningMs: statements.reduce((sum, statement) => sum + statement.total_plan_time, 0),
    executionMs: statements.reduce((sum, statement) => sum + statement.total_exec_time, 0),
  });
  return { status: evidence.status, topLevel: totals(top), nested: totals(nested), correlations,
    waits: [...groups.values()].map(group => ({ ...group, pids: [...group.pids] })),
    observerAwaitMsInclusiveSum: evidence.observers.reduce((sum, observer) => sum + observer.endMs - observer.startMs, 0),
    limitations: ["Top-level and nested server times are non-additive elapsed observations, not CPU or request wall",
      "Wait states are samples; no exact wait durations or zero-wait claim is available",
      "Driver correlation reports PID/time candidates; query queues and unsynchronized server fields prevent unique ownership proof",
      "Server timestamps have observer submit/receive brackets, not a synchronized Node clock",
      "Sampling and statement instrumentation can contend with business work; observer await does not measure that entire cost",
      "Short statements, failed execution, utility commands and observer gaps can leave query identity unavailable",
      evidence.actualPlans.status === "unavailable" ? "Actual plans are unavailable without a separately validated bounded log source"
        : "Actual plans cover only the bounded observed log window; asynchronous flush completeness is unproven"] };
}
