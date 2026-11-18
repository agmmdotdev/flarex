import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Pool, type PoolClient } from "pg";
import { Cause, Data, Effect, Exit, Fiber, Schema, Scope } from "effect";
import type { PostgresFixtureEndpoints } from "../../../../../persistence-postgres/test/support/postgresHelpers";
import { openRetrievalServerObserver, readRetrievalRuntimeSettings, retrievalServerDifference,
  type RetrievalDatabaseIdentity, type RetrievalServerSnapshot } from
  "../../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";
import { describeFailure } from "../failure";
import { ServerActivitySchema, ServerLimitsSchema, safeServerStatements, serverLimits,
  type ServerLimits, type ServerMeasurementEvidence, type ServerPoll } from "../server";
import { createServerPlanCapture, type ServerPlanLogSource } from "./plans";

export class ServerMeasurementFailure extends Data.TaggedError("ServerMeasurementFailure")<{
  readonly stage: string; readonly cause?: unknown;
}> {}

// CREATE/DROP DATABASE can wait for checkpoint fsync outside timed requests.
export const serverProvisioningTimeoutMs = 30_000;

const decodeSample = Schema.decodeUnknownEffect(Schema.Struct({ serverAt: Schema.String,
  activities: Schema.Array(ServerActivitySchema) }));
const decodeLimits = Schema.decodeUnknownSync(ServerLimitsSchema);
const decodeCaptureOptions = Schema.decodeUnknownSync(Schema.Struct({ initialObservation: Schema.Literal("required") }),
  { onExcessProperty: "error" });
const ordinaryRole = Schema.decodeUnknownEffect(Schema.Struct({ superuser: Schema.Boolean,
  bypassRls: Schema.Boolean, createDb: Schema.Boolean, createRole: Schema.Boolean }));
const decodeProvisioningRole = Schema.decodeUnknownEffect(Schema.Struct({ role: Schema.String }));
const decodeIdentities = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ database: Schema.String, dbid: Schema.Natural })));
const decodePlanSettings = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String, setting: Schema.String })));
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hasPostgresCode = (cause: unknown, code: string): boolean =>
  cause instanceof Error && "code" in cause && cause.code === code;
const diagnostic = Effect.fn("serverDiagnostic")(<A>(stage: string, work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: cause => new ServerMeasurementFailure({ stage, cause }) }));
const exitFailures = <A, E>(exit: Exit.Exit<A, E>): unknown[] => {
  if (Exit.isSuccess(exit)) return [];
  const [reason] = exit.cause.reasons;
  if (exit.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
    return [reason.error instanceof ServerMeasurementFailure && Object.hasOwn(reason.error, "cause")
      ? reason.error.cause : reason.error];
  // Defects, interruption and combined causes retain their complete topology.
  return [exit.cause];
};
const runDiagnostic = async <A, E>(work: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(work);
  if (Exit.isSuccess(exit)) return exit.value;
  const failures = exitFailures(exit);
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "Server diagnostic operation failed");
};

const planSettings = new Map([["auto_explain.log_min_duration", "0"], ["auto_explain.log_nested_statements", "on"],
  ["auto_explain.log_analyze", "on"], ["auto_explain.log_timing", "off"], ["auto_explain.log_buffers", "on"],
  ["auto_explain.log_triggers", "on"], ["auto_explain.log_wal", "on"], ["auto_explain.log_verbose", "on"],
  ["auto_explain.log_format", "json"], ["auto_explain.log_parameter_max_length", "0"], ["auto_explain.sample_rate", "1"]]);

/** Retires only this supplied pool's old idle sessions, never another backend.
 * Borrow every old client before releasing any, avoiding LIFO re-borrow. */
export const retireIdleServerPool = Effect.fn("retireIdleServerPool")(function* (pool: Pool) {
  if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount)
    return yield* Effect.fail(new ServerMeasurementFailure({ stage: "busyRuntimePool" }));
  const initialCount = pool.totalCount;
  const clients: PoolClient[] = [];
  yield* Effect.acquireUseRelease(Effect.succeed(clients), held => Effect.gen(function* () {
    for (let index = 0; index < initialCount; index++) {
      if (pool.waitingCount !== 0 || pool.totalCount !== initialCount || pool.idleCount !== initialCount - held.length)
        return yield* Effect.fail(new ServerMeasurementFailure({ stage: "staleRuntimePool" }));
      held.push(yield* diagnostic("serverPoolBorrow", () => pool.connect()));
    }
    if (pool.totalCount !== initialCount || pool.waitingCount !== 0 || pool.idleCount !== 0)
      return yield* Effect.fail(new ServerMeasurementFailure({ stage: "staleRuntimePool" }));
  }), held => Effect.gen(function* () {
    const failures: unknown[] = [];
    for (const client of held) {
      const exit = yield* Effect.exit(Effect.try({ try: () => client.release(true),
        catch: cause => new ServerMeasurementFailure({ stage: "serverPoolRetire", cause }) }));
      failures.push(...exitFailures(exit));
    }
    if (failures.length > 0) yield* Effect.die(new AggregateError(failures, "Server pool retirement failed"));
  }));
});

/** Explicit setup profile; its work is diagnostic Effect, its public edge is
 * Promise, and a rejected arm can never accidentally authorize capture. */
export function createServerMeasurementArming<E>(work: (pools: readonly Pool[]) => Effect.Effect<void, E>, plansSelected: boolean) {
  let state: "unarmed" | "arming" | "armed" | "failed" | "closed" = "unarmed";
  let pending: Promise<void> | undefined;
  return {
    profile: () => ({ state, plansEnabled: state === "armed" && plansSelected }),
    arm(pools: readonly Pool[]): Promise<void> {
      if (state !== "unarmed") return Promise.reject(new ServerMeasurementFailure({ stage: "invalidArmingState" }));
      state = "arming";
      const request = runDiagnostic(Effect.suspend(() => work(pools)));
      pending = request;
      void request.then(() => { state = "armed"; }, () => { state = "failed"; });
      return request;
    },
    async close(): Promise<void> {
      if (pending !== undefined) await pending.then(() => undefined, () => undefined);
      state = "closed";
    },
  };
}

/** The Promise edge invokes business exactly once. The explicit diagnostic
 * Scope owns the sampler Fiber and drains every in-flight pg call on close. */
export function createServerMeasurementCapture(input: Readonly<{
  database: RetrievalDatabaseIdentity;
  snapshot: () => Promise<RetrievalServerSnapshot>;
  sample: () => Promise<unknown>;
  limits?: ServerLimits;
  plans?: ReturnType<typeof createServerPlanCapture>;
}>) {
  const limits = decodeLimits(input.limits ?? serverLimits);
  let running = false;
  let lastEvidence: ServerMeasurementEvidence | undefined;
  let originalFailures: readonly unknown[] = [];
  return {
    evidence: () => lastEvidence,
    failures: () => originalFailures,
    async capture<Value>(run: () => Promise<Value>, options?: Readonly<{ initialObservation: "required" }>): Promise<Value> {
      const initialObservation = options === undefined ? undefined : decodeCaptureOptions(options).initialObservation;
      if (running) throw new ServerMeasurementFailure({ stage: "concurrentCapture" });
      running = true;
      lastEvidence = undefined;
      originalFailures = [];
      const origin = performance.now();
      const now = () => performance.now() - origin;
      const failures: unknown[] = [];
      const failureEvidence: ServerMeasurementEvidence["failures"][number][] = [];
      const observers: ServerMeasurementEvidence["observers"][number][] = [];
      const polls: ServerPoll[] = [];
      let missedTicks = 0, droppedRows = 0;
      let before: RetrievalServerSnapshot | undefined, after: RetrievalServerSnapshot | undefined;
      const fail = (stage: string, cause: unknown) => { failures.push(cause); failureEvidence.push(describeFailure(stage, cause)); };
      const observed = Effect.fn("serverObserved")(<A, E>(name: string, work: Effect.Effect<A, E>) => Effect.gen(function* () {
        const startMs = now();
        const exit = yield* Effect.exit(work);
        observers.push({ name, startMs, endMs: now(), outcome: Exit.isSuccess(exit) ? "success" : "failure" });
        if (Exit.isSuccess(exit)) return exit.value;
        for (const cause of exitFailures(exit)) fail(name, cause);
        return undefined;
      }));
      const stop = new AbortController();
      const scope = Effect.runSync(Scope.make());
      let rootStart = 0, rootEnd = 0;
      let planBeginAttempted = false;
      let statements: ServerMeasurementEvidence["statements"] = [];
      const poll = Effect.fn("serverActivitySampler")(function* () {
          let next = rootStart;
          while (!stop.signal.aborted) {
            const current = now();
            if (current - rootStart >= limits.maxDurationMs || polls.length >= limits.maxPolls) {
              fail("serverCapacity", new ServerMeasurementFailure({ stage: "samplingLimit" })); break;
            }
            if (current > next + limits.intervalMs) {
              const skipped = Math.floor((current - next) / limits.intervalMs);
              missedTicks += skipped; next += skipped * limits.intervalMs;
            }
            if (next > current) {
              const slept = yield* Effect.exit(diagnostic("serverSamplerDelay", () => delay(next - current, undefined, { signal: stop.signal })));
              if (Exit.isFailure(slept)) {
                if (!stop.signal.aborted) for (const cause of exitFailures(slept)) fail("serverSamplerDelay", cause);
                break;
              }
            }
            if (stop.signal.aborted) break;
            if (now() - rootStart >= limits.maxDurationMs) {
              fail("serverCapacity", new ServerMeasurementFailure({ stage: "samplingLimit" })); break;
            }
            const startMs = now();
            const failureCount = failures.length;
            // Interruption cannot detach a submitted pg query from its drain.
            const raw = yield* observed("serverActivityPoll", Effect.uninterruptible(diagnostic("serverActivityPoll", input.sample)));
            if (raw === undefined) {
              if (failures.length === failureCount) fail("serverActivityMissingRow", new ServerMeasurementFailure({ stage: "missingSample" }));
              break;
            }
            const decoded = yield* Effect.exit(decodeSample(raw));
            if (Exit.isFailure(decoded)) {
              for (const cause of exitFailures(decoded)) fail("serverActivityDecode", cause);
              break;
            }
            const sample = decoded.value;
            if (sample.activities.some(activity => activity.dbid !== input.database.dbid)) {
              fail("serverActivityIdentity", new ServerMeasurementFailure({ stage: "foreignDatabase" })); break;
            }
            const retained = sample.activities.slice(0, limits.maxRows);
            droppedRows += sample.activities.length - retained.length;
            polls.push({ startMs, endMs: now(), serverAt: sample.serverAt, activities: retained });
            if (sample.activities.length > limits.maxRows) {
              fail("serverCapacity", new ServerMeasurementFailure({ stage: "rowLimit" })); break;
            }
            next += limits.intervalMs;
          }
      });
      const begin = Effect.fn("serverCaptureBegin")(function* () {
        yield* Scope.addFinalizer(scope, Effect.gen(function* () {
          stop.abort();
          after = yield* observed("serverSnapshotAfter", diagnostic("serverSnapshotAfter", input.snapshot));
          if (input.plans !== undefined && (initialObservation !== "required" || planBeginAttempted)) {
            yield* observed("serverPlanEnd", diagnostic("serverPlanEnd", input.plans.end));
            for (const cause of input.plans.failures()) if (!failures.includes(cause)) fail("serverPlanObservation", cause);
          }
        }));
        before = yield* observed("serverSnapshotBefore", diagnostic("serverSnapshotBefore", input.snapshot));
        if (initialObservation === "required" && before === undefined && failures.length === 0)
          fail("serverSnapshotBefore", new ServerMeasurementFailure({ stage: "missingInitialSnapshot" }));
        if (initialObservation === "required" && (before === undefined || failures.length > 0)) return;
        if (input.plans !== undefined) {
          planBeginAttempted = true;
          yield* observed("serverPlanBegin", diagnostic("serverPlanBegin", input.plans.begin));
        }
        if (initialObservation === "required" && failures.length > 0) return;
        rootStart = now();
        const loop = yield* Effect.forkIn(poll(), scope, { startImmediately: true });
        // Added after forkIn: cooperative stop/join runs before its automatic
        // interruption finalizer, and before snapshots or plan-window release.
        yield* Scope.addFinalizer(scope, Effect.gen(function* () {
          stop.abort();
          yield* observed("serverSamplerJoin", Fiber.join(loop));
        }));
      });
      try {
        const started = await Effect.runPromiseExit(begin());
        for (const cause of exitFailures(started)) fail("serverCaptureBegin", cause);
        // Read-only diagnostics require their initial evidence before spending
        // an execution. Business diagnostics retain the existing best-effort mode.
        if (initialObservation === "required" && (before === undefined || failures.length > 0)) {
          rootEnd = rootStart;
          throw new ServerMeasurementFailure({ stage: "initialObservationRequired" });
        }
        // Return/throw the original callback value unchanged. Diagnostics are
        // retained separately in finally and cannot replace the business Cause.
        try { return await run(); }
        finally { rootEnd = now(); }
      } finally {
        const closed = await Effect.runPromiseExit(Scope.close(scope, Exit.void));
        for (const cause of exitFailures(closed)) fail("serverCaptureClose", cause);
        if (before !== undefined && after !== undefined) {
          try { statements = safeServerStatements(retrievalServerDifference(before, after)); }
          catch (cause) { fail("serverStatisticsDifference", cause); }
        }
        lastEvidence = { originMonotonicMs: origin, database: input.database,
          root: { startMs: rootStart, endMs: rootEnd }, limits,
          status: failures.length === 0 && input.plans?.evidence().status !== "incomplete" ? "complete" : "incomplete",
          before: before?.info[0] ?? null, after: after?.info[0] ?? null,
          beforeStatements: safeServerStatements(before?.statements ?? []),
          afterStatements: safeServerStatements(after?.statements ?? []),
          statements, polls, missedTicks, droppedRows, observers, failures: failureEvidence,
          actualPlans: input.plans?.evidence() ?? { status: "unavailable", reason: "noValidatedBoundedLogSource" } };
        originalFailures = failures;
        running = false;
      }
    },
  };
}

/** Owns two generated databases and two ordinary roles. Administrative work is
 * finished before fixture construction and every timed diagnostic request.
 * The fixture remains the schema, installation and business resource owner. */
export async function acquireServerMeasurementResource(options?: Readonly<{
  provisioningConnectionString?: string; limits?: ServerLimits;
  planLog?: ServerPlanLogSource; planLogContinuity?: "required";
}>) {
  const limits = decodeLimits(options?.limits ?? serverLimits);
  const provisioningUrl = options?.provisioningConnectionString ?? process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL?.trim();
  if (provisioningUrl === undefined || provisioningUrl.length === 0)
    throw new ServerMeasurementFailure({ stage: "missingProvisioningEndpoint" });
  const endpoint = new URL(provisioningUrl);
  if (endpoint.protocol !== "postgres:" && endpoint.protocol !== "postgresql:")
    throw new ServerMeasurementFailure({ stage: "invalidProvisioningEndpoint" });
  const nonce = randomBytes(16).toString("hex");
  const owner = `fx_measure_server_${nonce}`, observerRole = `fx_measure_observer_${nonce}`;
  const database = `fx_measure_server_${nonce}`, observerDatabase = `fx_measure_observer_${nonce}`;
  const password = randomBytes(24).toString("base64url"), observerPassword = randomBytes(24).toString("base64url");
  const provisioning = new Pool({ connectionString: provisioningUrl, max: 1, connectionTimeoutMillis: 2000,
    statement_timeout: serverProvisioningTimeoutMs, query_timeout: serverProvisioningTimeoutMs + 500 });
  const ownedRoles = new Set<string>(), ownedDatabases = new Set<string>();
  let observerSetup: Client | undefined, sampler: Client | undefined;
  let observer: Awaited<ReturnType<typeof openRetrievalServerObserver>> | undefined;
  let capture: ReturnType<typeof createServerMeasurementCapture> | undefined;
  let closing: Promise<void> | undefined;
  let activeCapture: Promise<unknown> | undefined;
  const scope = Effect.runSync(Scope.make());
  const cleanupFailures: unknown[] = [];
  const url = (selected: string, login?: string, loginPassword?: string) => {
    const value = new URL(endpoint);
    value.pathname = `/${selected}`;
    value.searchParams.delete("options"); value.searchParams.delete("application_name");
    value.searchParams.delete("user"); value.searchParams.delete("password");
    if (login !== undefined) value.username = login;
    if (loginPassword !== undefined) value.password = loginPassword;
    return value.toString();
  };
  const release = Effect.fn("serverResourceRelease")(function* (stage: string, work: () => Promise<unknown>) {
    const exit = yield* Effect.exit(diagnostic(stage, work));
    cleanupFailures.push(...exitFailures(exit));
  });
  const cleanup = Effect.fn("serverResourceCleanup")(function* () {
    if (sampler !== undefined) yield* release("serverSamplerClose", () => sampler?.end() ?? Promise.resolve());
    if (observer !== undefined) yield* release("serverObserverClose", observer.close);
    if (observerSetup !== undefined) yield* release("serverObserverSetupClose", () => observerSetup?.end() ?? Promise.resolve());
    for (const selected of [...ownedDatabases].toReversed())
      yield* release("serverDatabaseDrop", () => provisioning.query(`drop database if exists ${quoteIdentifier(selected)}`));
    for (const login of [...ownedRoles].toReversed())
      yield* release("serverRoleDrop", () => provisioning.query(`drop role if exists ${quoteIdentifier(login)}`));
    yield* release("serverProvisioningClose", () => provisioning.end());
  });
  const acquire = Effect.fn("serverResourceAcquire")(function* () {
    yield* Scope.addFinalizer(scope, cleanup());
    const administrator = (yield* decodeProvisioningRole((yield* diagnostic("serverProvisioningIdentity",
      () => provisioning.query("select current_user as role"))).rows[0])).role;
    for (const [login, loginPassword, inherit] of [[owner, password, false], [observerRole, observerPassword, true]] as const) {
      ownedRoles.add(login);
      const created = yield* Effect.exit(diagnostic("serverRoleCreate", () => provisioning.query(
        `create role ${quoteIdentifier(login)} login password ${quoteLiteral(loginPassword)}
        nosuperuser nocreatedb nocreaterole ${inherit ? "inherit" : "noinherit"} noreplication nobypassrls`)));
      if (Exit.isFailure(created)) {
        if (exitFailures(created).some(cause => hasPostgresCode(cause, "42710"))) ownedRoles.delete(login);
        return yield* Effect.failCause(created.cause);
      }
    }
    for (const [selected, login] of [[database, owner], [observerDatabase, administrator]] as const) {
      ownedDatabases.add(selected);
      const created = yield* Effect.exit(diagnostic("serverDatabaseCreate", () => provisioning.query(
        `create database ${quoteIdentifier(selected)} owner ${quoteIdentifier(login)} template template0`)));
      if (Exit.isFailure(created)) {
        if (exitFailures(created).some(cause => hasPostgresCode(cause, "42P04"))) ownedDatabases.delete(selected);
        return yield* Effect.failCause(created.cause);
      }
    }
    for (const setting of ["pg_stat_statements.track = 'all'", "pg_stat_statements.track_planning = 'on'",
      "pg_stat_statements.track_utility = 'on'", "compute_query_id = 'on'", "track_activities = 'on'",
      "track_io_timing = 'on'", "auto_explain.log_min_duration = '-1'", "synchronous_commit = 'on'"]) {
      yield* diagnostic("serverDatabaseConfigure", () => provisioning.query(`alter database ${quoteIdentifier(database)} set ${setting}`));
    }
    yield* diagnostic("serverObserverGrants", () => provisioning.query(`grant pg_read_all_stats, pg_read_all_settings to ${quoteIdentifier(observerRole)}`));
    yield* diagnostic("serverObserverConnectGrant", () => provisioning.query(`grant connect on database ${quoteIdentifier(observerDatabase)} to ${quoteIdentifier(observerRole)}`));
    observerSetup = new Client({ connectionString: url(observerDatabase), connectionTimeoutMillis: 2000,
      statement_timeout: serverProvisioningTimeoutMs, query_timeout: serverProvisioningTimeoutMs + 500 });
    const setup = observerSetup;
    yield* diagnostic("serverObserverSetupConnect", () => setup.connect());
    yield* diagnostic("serverObserverSchemaPermissions", () => setup.query("revoke create on schema public from public"));
    yield* diagnostic("serverObserverExtension", () => setup.query("create extension pg_stat_statements"));
    const identityRows = yield* diagnostic("serverDatabaseIdentity", () => setup.query(
      "select datname as database, oid::int as dbid from pg_database where datname=$1", [database]));
    const identity = (yield* decodeIdentities(identityRows.rows))[0];
    if (identity === undefined || identity.database !== database)
      return yield* Effect.fail(new ServerMeasurementFailure({ stage: "targetCatalogIdentity" }));
    const observerUrl = new URL(url(observerDatabase, observerRole, observerPassword));
    observerUrl.searchParams.set("options", `-c statement_timeout=${limits.queryTimeoutMs}`);
    observer = yield* diagnostic("serverObserverAcquire", () => openRetrievalServerObserver(observerUrl.toString(), [identity],
      { includeQueryText: false, maxStatements: limits.maxStatements,
        connectionTimeoutMs: 2000, queryTimeoutMs: limits.queryTimeoutMs + 250 }));
    const preloaded = observer.observerIdentity.settings.shared_preload_libraries;
    if (preloaded?.status !== "observed" || !preloaded.value.split(",").map(value => value.trim()).includes("pg_stat_statements"))
      return yield* Effect.fail(new ServerMeasurementFailure({ stage: "statementModuleNotPreloaded" }));
    if (options?.planLog !== undefined && !preloaded.value.split(",").map(value => value.trim()).includes("auto_explain"))
      return yield* Effect.fail(new ServerMeasurementFailure({ stage: "planModuleNotPreloaded" }));
    if (options?.planLog !== undefined) {
      const prefix = observer.observerIdentity.settings.log_line_prefix;
      if (prefix?.status !== "observed" || prefix.value !== options.planLog.prefix)
        return yield* Effect.fail(new ServerMeasurementFailure({ stage: "planLogPrefixMismatch" }));
    }
    sampler = new Client({ connectionString: observerUrl.toString(), application_name: "flarex-measurement-observer",
      connectionTimeoutMillis: 2000, statement_timeout: limits.queryTimeoutMs, query_timeout: limits.queryTimeoutMs + 250 });
    const actualSampler = sampler;
    yield* diagnostic("serverSamplerConnect", () => actualSampler.connect());
    const activitySql = `select clock_timestamp()::text as "serverAt", coalesce((select json_agg(selected) from (
      select pid, backend_start::text as "backendStart", datid::int as dbid, usesysid::int as userid,
        state, query_id::text as queryid, query_start::text as "queryStart", wait_event_type as "waitType",
        wait_event as "waitEvent", case when wait_event_type='Lock' then pg_blocking_pids(pid)
          else array[]::int[] end as "blockerPids"
      from pg_stat_activity where datid=$1 and backend_type='client backend' order by pid limit ${limits.maxRows + 1}
    ) selected), '[]'::json) as activities`;
    const ownedObserver = observer;
    const plans = options?.planLog === undefined ? undefined : createServerPlanCapture({ database, source: options.planLog,
      ...(options.planLogContinuity === undefined ? {} : { continuity: options.planLogContinuity }) });
    capture = createServerMeasurementCapture({ database: identity, limits, ...(plans === undefined ? {} : { plans }), snapshot: () => ownedObserver.snapshot(),
      sample: async () => (await actualSampler.query(activitySql, [identity.dbid])).rows[0] });
    const endpoints: PostgresFixtureEndpoints = { connectionString: url(database, owner, password),
      provisioningConnectionString: url(database) };
    const verifyPool = Effect.fn("serverRuntimePoolVerify")(function* (pool: Pool, armed = true) {
      const flags = yield* ordinaryRole((yield* diagnostic("serverRuntimeRole", () => pool.query(
        `select rolsuper as superuser, rolbypassrls as "bypassRls",
        rolcreatedb as "createDb", rolcreaterole as "createRole" from pg_roles where rolname=current_user`))).rows[0]);
      if (flags.superuser || flags.bypassRls || flags.createDb || flags.createRole)
        return yield* Effect.fail(new ServerMeasurementFailure({ stage: "nonOrdinaryRuntimeRole" }));
      const runtime = yield* diagnostic("serverRuntimeSettings", () => readRetrievalRuntimeSettings(async sql => (await pool.query(sql)).rows));
      if (runtime.dbid !== identity.dbid || runtime.database !== database)
        return yield* Effect.fail(new ServerMeasurementFailure({ stage: "runtimeDatabaseMismatch" }));
      for (const [name, expected] of [["fsync", "on"], ["full_page_writes", "on"], ["synchronous_commit", "on"],
        ["compute_query_id", "on"], ["track_activities", "on"], ["track_io_timing", "on"],
        ["pg_stat_statements.track", "all"], ["pg_stat_statements.track_planning", "on"],
        ["pg_stat_statements.track_utility", "on"]]) {
        const setting = runtime.settings[name];
        if (setting?.status !== "observed" || setting.value !== expected)
          return yield* Effect.fail(new ServerMeasurementFailure({ stage: "runtimeSettingMismatch" }));
      }
      const minDuration = runtime.settings["auto_explain.log_min_duration"];
      if (minDuration?.status !== "observed" || minDuration.value !== (armed && options?.planLog !== undefined ? "0" : "-1"))
        return yield* Effect.fail(new ServerMeasurementFailure({ stage: "runtimePlanProfileMismatch" }));
      if (armed && options?.planLog !== undefined) {
        const settings = yield* decodePlanSettings(
          (yield* diagnostic("serverRuntimePlanSettings", () => pool.query(`select name, setting from pg_settings where name=any($1::text[])`,
            [[...planSettings.keys()]]))).rows);
        if (settings.length !== planSettings.size || settings.some(setting => planSettings.get(setting.name) !== setting.setting))
          return yield* Effect.fail(new ServerMeasurementFailure({ stage: "runtimePlanSettingMismatch" }));
        return { ...runtime, privileges: flags, planSettings: settings };
      }
      return { ...runtime, privileges: flags };
    });
    const arm = Effect.fn("serverRuntimeArm")(function* (runtimePools: readonly Pool[]) {
      const pools = [...new Set(runtimePools)];
      if (pools.length === 0) return yield* Effect.fail(new ServerMeasurementFailure({ stage: "missingRuntimePools" }));
      for (const pool of pools) {
        if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount)
          return yield* Effect.fail(new ServerMeasurementFailure({ stage: "busyRuntimePool" }));
        yield* verifyPool(pool, false);
        if (pool.waitingCount !== 0 || pool.idleCount !== pool.totalCount)
          return yield* Effect.fail(new ServerMeasurementFailure({ stage: "busyRuntimePool" }));
      }
      if (options?.planLog !== undefined) {
        for (const [name, value] of planSettings) yield* diagnostic("serverPlanArm", () => provisioning.query(
          `alter database ${quoteIdentifier(database)} set ${name} = ${quoteLiteral(value)}`));
        for (const pool of pools) yield* retireIdleServerPool(pool);
      }
      for (const pool of pools) yield* verifyPool(pool);
    });
    const arming = createServerMeasurementArming(arm, options?.planLog !== undefined);
    const resourceCapture = capture;
    return { endpoints, database: identity,
      ownedResources: { databases: [database, observerDatabase], roles: [owner, observerRole] },
      profile: arming.profile,
      arm(runtimePools: readonly Pool[]): Promise<void> {
        if (closing !== undefined)
          return Promise.reject(new ServerMeasurementFailure({ stage: "invalidArmingState" }));
        return arming.arm(runtimePools);
      },
      capture<Value>(run: () => Promise<Value>, captureOptions?: Readonly<{ initialObservation: "required" }>): Promise<Value> {
        if (closing !== undefined) return Promise.reject(new ServerMeasurementFailure({ stage: "closedResource" }));
        if (arming.profile().state !== "armed") return Promise.reject(new ServerMeasurementFailure({ stage: "unarmedResource" }));
        if (activeCapture !== undefined) return Promise.reject(new ServerMeasurementFailure({ stage: "concurrentCapture" }));
        const request = resourceCapture.capture(run, captureOptions);
        activeCapture = request;
        const settled = () => { if (activeCapture === request) activeCapture = undefined; };
        void request.then(settled, settled);
        return request;
      },
      evidence: resourceCapture.evidence, failures: resourceCapture.failures,
      async verifyRuntimePools(controlPool: Pool, targetPool: Pool) {
        if (arming.profile().state !== "armed") throw new ServerMeasurementFailure({ stage: "unarmedResource" });
        return runDiagnostic(Effect.gen(function* () {
          return { control: yield* verifyPool(controlPool), target: yield* verifyPool(targetPool) };
        }));
      },
      close(): Promise<void> {
        closing ??= (async () => {
          if (activeCapture !== undefined) await activeCapture.then(() => undefined, () => undefined);
          await arming.close();
          const closed = await Effect.runPromiseExit(Scope.close(scope, Exit.void));
          cleanupFailures.push(...exitFailures(closed));
          if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "Server measurement cleanup failed");
        })();
        return closing;
      } };
  });
  const acquired = await Effect.runPromiseExit(acquire());
  if (Exit.isSuccess(acquired)) return acquired.value;
  const closed = await Effect.runPromiseExit(Scope.close(scope, acquired));
  const failures = [...exitFailures(acquired), ...cleanupFailures, ...exitFailures(closed)];
  if (failures.length === 1) throw failures[0];
  throw new AggregateError(failures, "Server measurement acquisition and cleanup failed");
}
