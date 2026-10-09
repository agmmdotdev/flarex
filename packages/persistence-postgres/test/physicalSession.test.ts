import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, Option, Tracer } from "effect";
import { ExecutionDiagnostics, observeExecution } from "../src/executionDiagnostics/operation";
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { TestClock } from "effect/testing";
import { Client, Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { makePhysicalDeadlineOperations } from "../src/physicalSession/deadline";
import { makePhysicalSessionAccess } from "../src/physicalSession/drizzle";
import { makePhysicalConnectionIdentity } from "../src/physicalSession/model";
import {
  physicalSessionErrors,
  PhysicalSessionDeadlineIssue,
  PhysicalSessionInvariantDefect,
  PhysicalSessionResourceIssue,
  PhysicalSessionCleanupDefect,
} from "../src/physicalSession/errors";
import { makePostgresPhysicalSessionDriver, type PhysicalPostgresPool } from "../src/physicalSession/postgres";
import { flarexSchema } from "../src/schema";
import {
  catalogControlPhysicalErrors,
  CatalogControlSessionDeadlineIssue,
} from "../src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../src/postgresCatalogControlSession";
import { trimToNonBlankOrNull } from "@flarex/utils/strings";
import { runEffect } from "./effectTestRuntime";
import { createFileScopedPostgresFixture } from "./postgresHelpers";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { PhysicalSessionObservation, type PhysicalSessionObservationEvent } from "../src/physicalSession/observation";

const deadlines = makePhysicalDeadlineOperations(physicalSessionErrors);
const postgresUrl = trimToNonBlankOrNull(process.env.FLAREX_POSTGRES_DATABASE_URL);
const artifactDeadlines = makePhysicalDeadlineOperations(
  catalogControlPhysicalErrors,
);

class PhysicalCallbackBusiness extends Context.Service<PhysicalCallbackBusiness, object>()("test/PhysicalCallbackBusiness") {}

it("keeps physical operations quiet by default and carries opt-in diagnostics with their full callback context", async () => {
  const { pool, release } = physicalSessionWitnessPool();
  const physical = makePostgresPhysicalSessionDriver(pool, {
    access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
  });
  const business = Object.freeze({});
  const spans: Tracer.Span[] = [];
  const tracer = Tracer.make({ span(options) {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  const policy = { observe: <Value, Failure, Requirements>(name: string, work: Effect.Effect<Value, Failure, Requirements>) =>
    work.pipe(Effect.withSpan(name)) };
  const run = (observed: boolean) => {
    const work = Effect.gen(function* () {
      const originalClock = yield* Effect.clockWith(clock => Effect.succeed(clock));
      const deadline = yield* deadlines.start("read", 1000);
      return yield* physical.runReadEffect({ deadline }, () => Effect.withFiber(fiber => {
        const callbackBusiness = Context.getOption(fiber.context, PhysicalCallbackBusiness);
        expect(Option.isSome(callbackBusiness)).toBe(true);
        expect(Option.getOrUndefined(callbackBusiness)).toBe(business);
        expect(Option.getOrUndefined(Context.getOption(fiber.context, Clock.Clock))).toBe(originalClock);
        expect(Option.isSome(Context.getOption(fiber.context, ExecutionDiagnostics))).toBe(observed);
        return observeExecution("physical.callback", Effect.succeed("accepted"));
      }));
    }).pipe(Effect.provideService(PhysicalCallbackBusiness, business), Effect.withSpan("physical.parent"),
      Effect.provideService(Tracer.Tracer, tracer));
    return runEffect(observed ? work.pipe(Effect.provideService(ExecutionDiagnostics, policy)) : work);
  };
  expect(await run(false)).toBe("accepted");
  expect(spans.map(span => span.name)).toEqual(["physical.parent"]);
  spans.length = 0;
  expect(await run(true)).toBe("accepted");
  const physicalSpan = spans.find(span => span.name === "PostgresPhysicalSession.read");
  const callbackSpan = spans.find(span => span.name === "physical.callback");
  expect(physicalSpan).toBeDefined();
  expect(callbackSpan).toBeDefined();
  expect(callbackSpan !== undefined && Option.isSome(callbackSpan.parent) ? callbackSpan.parent.value.spanId : undefined)
    .toBe(physicalSpan?.spanId);
  expect(release).toHaveBeenCalledTimes(2);
});

it.each(["read", "initial", "recovery"] as const)(
  "resolves the current observation on a retained %s physical driver",
  async profile => {
    const { pool, release } = physicalSessionWitnessPool();
    let current: PhysicalSessionObservation | undefined;
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
    }, { observation: () => current });
    const run = () => runEffect(Effect.gen(function* () {
      const deadline = yield* deadlines.start(profile, 1000);
      const work = () => Effect.succeed("accepted");
      if (profile === "read") return yield* physical.runReadEffect({ deadline }, work);
      if (profile === "initial") return yield* physical.runInitialTransactionEffect({
        isolationLevel: "read committed", deadline, lockTimeoutMilliseconds: 500,
        recoveryTimeoutMilliseconds: 1000,
      }, effect => effect, work);
      return yield* physical.runRecoveryTransactionEffect({
        deadline, lockTimeoutMilliseconds: 500, excludedConnectionIdentity: makePhysicalConnectionIdentity(),
      }, work);
    }));
    const quiet = await run();
    const firstEvents: PhysicalSessionObservationEvent[] = [];
    current = new PhysicalSessionObservation({ record: event => { firstEvents.push(event); } });
    expect(await run()).toEqual(quiet);
    const secondEvents: PhysicalSessionObservationEvent[] = [];
    current = new PhysicalSessionObservation({ record: event => { secondEvents.push(event); } });
    expect(await run()).toEqual(quiet);
    expect(firstEvents).toEqual([
      { kind: "phase", phase: "drain", edge: "begin" },
      { kind: "phase", phase: "drain", edge: "end", outcome: "success" },
      { kind: "phase", phase: "release", edge: "begin" },
      { kind: "phase", phase: "release", edge: "end", outcome: "success" },
    ]);
    expect(secondEvents).toEqual(firstEvents);
    expect(release).toHaveBeenCalledTimes(3);
    expect(release.mock.calls.every(([destroy]) => destroy === false)).toBe(true);
    current.assertHealthy();
  },
);

it.each(["read", "initial", "recovery"] as const)(
  "constructs a %s deadline refusal only when its failure branch executes",
  async kind => {
    const deadlineError = vi.fn(physicalSessionErrors.deadline);
    const lazyDeadlines = makePhysicalDeadlineOperations({
      ...physicalSessionErrors,
      deadline: deadlineError,
    });
    const phase = kind === "read" ? "read" : "callback";
    const deadline = await runEffect(lazyDeadlines.start(kind, 1000));
    const failure = lazyDeadlines.fail(deadline, phase);
    expect(deadlineError).not.toHaveBeenCalled();

    const exit = await runEffect(Effect.exit(failure));
    expect(deadlineError).toHaveBeenCalledExactlyOnceWith({ deadlineKind: kind, phase });
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const reason = exit.cause.reasons[0];
      expect(reason && Cause.isFailReason(reason) ? reason.error : undefined)
        .toBe(deadlineError.mock.results[0]?.value);
    }
  },
);

it.each(["read", "initial", "recovery"] as const)(
  "finishes successful %s operations without constructing timeout errors",
  async profile => {
    const { pool, release, statements } = physicalSessionWitnessPool();
    const deadlineError = vi.fn(physicalSessionErrors.deadline);
    const resourceError = vi.fn(physicalSessionErrors.resource);
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema),
      errors: { ...physicalSessionErrors, deadline: deadlineError, resource: resourceError },
    });
    const result = await runEffect(Effect.gen(function* () {
      const deadline = yield* deadlines.start(profile, 1000);
      const work = () => Effect.succeed("accepted");
      if (profile === "read") return yield* physical.runReadEffect({ deadline }, work);
      if (profile === "initial") return yield* physical.runInitialTransactionEffect({
        isolationLevel: "read committed", deadline, lockTimeoutMilliseconds: 500,
        recoveryTimeoutMilliseconds: 1000,
      }, effect => effect, work);
      return yield* physical.runRecoveryTransactionEffect({
        deadline, lockTimeoutMilliseconds: 500,
        excludedConnectionIdentity: makePhysicalConnectionIdentity(),
      }, work);
    }));
    expect(result).toEqual(profile === "read" ? "accepted" : { kind: "committed", value: "accepted" });
    expect(deadlineError).not.toHaveBeenCalled();
    expect(resourceError).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledExactlyOnceWith(false);
    if (profile !== "read") expect(statements.at(-1)).toBe("commit");
  },
);

it.each(["read", "initial", "recovery"] as const)(
  "retains the first already-settled caught query rejection in %s",
  async profile => {
    const firstFailure = new Error("first caught query rejection");
    const secondFailure = new Error("second caught query rejection");
    const { pool, release, statements } = physicalSessionWitnessPool(new Map([
      ["select first_rejection", firstFailure], ["select second_rejection", secondFailure],
    ]));
    const events: PhysicalSessionObservationEvent[] = [];
    const observation = new PhysicalSessionObservation({ record: event => { events.push(event); } });
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
    }, { observation: () => observation });
    const cause = await runEffect(Effect.gen(function* () {
      const deadline = yield* deadlines.start(profile, 1000);
      const work = (database: FlarexMetadataDatabase) =>
        Effect.tryPromise({
          try: async () => {
            await Promise.resolve(database.execute(sql`select first_rejection`)).catch(error => {
              expect(error).toMatchObject({ cause: firstFailure });
            });
            await Promise.resolve(database.execute(sql`select second_rejection`)).catch(error => {
              expect(error).toMatchObject({ cause: secondFailure });
            });
            return "caught both";
          },
          catch: cause => new PhysicalSessionResourceIssue({ phase: "callback", cause }),
        });
      if (profile === "read") {
        const exit = yield* Effect.exit(physical.runReadEffect({ deadline }, work));
        if (Exit.isSuccess(exit)) throw new Error("Expected sticky read refusal");
        return exit.cause;
      }
      if (profile === "initial") {
        const settlement = yield* physical.runInitialTransactionEffect({
          isolationLevel: "read committed", deadline, lockTimeoutMilliseconds: 500,
          recoveryTimeoutMilliseconds: 1000,
        }, effect => effect, work);
        if (settlement.kind !== "notCommitted") throw new Error("Expected sticky initial refusal");
        return settlement.cause;
      }
      const settlement = yield* physical.runRecoveryTransactionEffect({
        deadline, lockTimeoutMilliseconds: 500,
        excludedConnectionIdentity: makePhysicalConnectionIdentity(),
      }, work);
      if (settlement.kind !== "unresolved" || settlement.resolution.kind !== "lifecycle")
        throw new Error("Expected sticky recovery refusal");
      return settlement.resolution.cause;
    }));
    expect(cause.reasons).toHaveLength(1);
    const reason = cause.reasons[0];
    const issue = reason && Cause.isFailReason(reason) ? reason.error : undefined;
    expect(issue).toBeInstanceOf(PhysicalSessionResourceIssue);
    if (issue instanceof PhysicalSessionResourceIssue) {
      expect(issue.phase).toBe(profile === "read" ? "read" : "callback");
      expect(issue.cause).toBe(firstFailure);
    }
    expect(statements).toContain("select first_rejection");
    expect(statements).toContain("select second_rejection");
    expect(statements).not.toContain("commit");
    if (profile !== "read") expect(statements.at(-1)).toBe("rollback");
    expect(release).toHaveBeenCalledExactlyOnceWith(profile === "read");
    expect(events.find(event => event.phase === "drain" && event.edge === "end")?.outcome).toBe("failure");
    if (profile === "read") expect(events.slice(2)).toEqual([
      { kind: "phase", phase: "quarantine", edge: "begin" },
      { kind: "phase", phase: "drain", edge: "begin" },
      { kind: "phase", phase: "drain", edge: "end", outcome: "success" },
      { kind: "phase", phase: "release", edge: "begin" },
      { kind: "phase", phase: "release", edge: "end", outcome: "success" },
      { kind: "phase", phase: "quarantine", edge: "end", outcome: "success" },
    ]);
    observation.assertHealthy();
  },
);

it.each(["read", "initial", "recovery"] as const)("destroys a checkout on %s view construction failure before BEGIN or callback", async profile => {
  const original = new Error("physical view construction fault");
  const release = vi.fn();
  const client: PoolClient = Object.assign(new Client(), { release });
  const query = vi.spyOn(client, "query");
  const access = makePhysicalSessionAccess(flarexSchema);
  let databaseRequests = 0;
  let transactionRequests = 0;
  let callbacks = 0;
  const physical = makePostgresPhysicalSessionDriver({
    connect: callback => callback(undefined, client, release),
  }, { access: checkedOut => {
    const views = access(checkedOut);
    return {
      get database() { databaseRequests++; if (profile === "read") throw original; return views.database; },
      get transaction() { transactionRequests++; if (profile !== "read") throw original; return views.transaction; },
    };
  }, errors: physicalSessionErrors });
  const cause = await runEffect(Effect.gen(function* () {
    const deadline = yield* deadlines.start(profile, 1000);
    const work = () => Effect.sync(() => { callbacks++; });
    if (profile === "read") {
      const exit = yield* Effect.exit(physical.runReadEffect({ deadline }, work));
      if (Exit.isSuccess(exit)) throw new Error("Expected failed physical read acquisition");
      return exit.cause;
    }
    if (profile === "initial") {
      const result = yield* physical.runInitialTransactionEffect({ isolationLevel: "read committed", deadline,
        lockTimeoutMilliseconds: 500, recoveryTimeoutMilliseconds: 1000 }, effect => effect, work);
      if (result.kind !== "notCommitted") throw new Error("Expected uncommitted acquisition failure");
      return result.cause;
    }
    const result = yield* physical.runRecoveryTransactionEffect({ deadline, lockTimeoutMilliseconds: 500,
      excludedConnectionIdentity: makePhysicalConnectionIdentity() }, work);
    if (result.kind !== "unresolved" || result.resolution.kind !== "lifecycle")
      throw new Error("Expected recovery lifecycle acquisition failure");
    return result.resolution.cause;
  }));
  expect(cause.reasons).toHaveLength(1);
  const reason = cause.reasons[0];
  const issue = reason && Cause.isFailReason(reason) ? reason.error : undefined;
  expect(issue).toBeInstanceOf(PhysicalSessionResourceIssue);
  if (issue instanceof PhysicalSessionResourceIssue) {
    expect(issue.phase).toBe("acquire");
    expect(issue.cause).toBe(original);
  }
  expect([databaseRequests, transactionRequests]).toEqual(profile === "read" ? [1, 0] : [0, 1]);
  expect(callbacks).toBe(0);
  expect(query).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});

function physicalSessionWitnessPool(failures: ReadonlyMap<string, Error> = new Map()) {
  const release = vi.fn();
  const statements: string[] = [];
  const client: PoolClient = Object.assign(new Client(), { release });
  Object.defineProperty(client, "query", {
    // The callback's tracked client Proxy substitutes its query method.
    configurable: true,
    value: (statement: string | Readonly<{ text: string }>) => {
      const text = typeof statement === "string" ? statement : statement.text;
      statements.push(text);
      const failure = failures.get(text);
      if (failure !== undefined) return Promise.reject(failure);
      const rows = text === "show statement_timeout" ? [{ statement_timeout: "0" }] : [];
      return Promise.resolve({
        command: text === "commit" ? "COMMIT" : text === "rollback" ? "ROLLBACK" : "SELECT",
        rows, rowCount: rows.length, fields: [], oid: 0,
      });
    },
  });
  const pool: PhysicalPostgresPool = {
    connect: callback => callback(undefined, client, release),
  };
  return { pool, release, statements };
}

it("shares deadline mechanics while preserving each owner's error projection", async () => {
  const [core, artifact] = await runEffect(
    Effect.gen(function* () {
      const deadline = yield* deadlines.start("initial", 10);
      yield* TestClock.adjust("10 millis");
      return [
        yield* Effect.exit(deadlines.remaining(deadline, "callback")),
        yield* Effect.exit(artifactDeadlines.remaining(deadline, "callback")),
      ] as const;
    }).pipe(Effect.provide(TestClock.layer())),
  );
  expect(Exit.isFailure(core)).toBe(true);
  expect(Exit.isFailure(artifact)).toBe(true);
  if (Exit.isFailure(core)) {
    const reason = core.cause.reasons[0];
    expect(
      reason && Cause.isFailReason(reason) ? reason.error : undefined,
    ).toBeInstanceOf(PhysicalSessionDeadlineIssue);
  }
  if (Exit.isFailure(artifact)) {
    const reason = artifact.cause.reasons[0];
    expect(
      reason && Cause.isFailReason(reason) ? reason.error : undefined,
    ).toBeInstanceOf(CatalogControlSessionDeadlineIssue);
  }
});

it("refuses invalid physical deadline durations as defects", async () => {
  const exit = await runEffect(Effect.exit(deadlines.start("initial", 0)));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const reason = exit.cause.reasons[0];
    expect(
      reason && Cause.isDieReason(reason) ? reason.defect : undefined,
    ).toBeInstanceOf(PhysicalSessionInvariantDefect);
  }
});

it.each([false, true])("refuses an unconnected implicit transport before callback or SQL while preserving cleanup failure %s", async rejectRelease => {
  const cleanupFailure = rejectRelease ? new Error("exact-client release fault") : undefined;
  const release = vi.fn(() => { if (cleanupFailure !== undefined) throw cleanupFailure; });
  const client = Object.assign(new Client({ ssl: false }), { release });
  const query = vi.spyOn(client, "query");
  const pool: PhysicalPostgresPool = {
    options: { ssl: false },
    connect: callback => callback(undefined, client, release),
  };
  let callbacks = 0;
  const physical = makePostgresPhysicalSessionDriver(pool, {
    access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
  });
  const exit = await runEffect(Effect.gen(function* () {
    const deadline = yield* deadlines.start("read", 1000);
    return yield* Effect.exit(physical.runImplicitReadEffect({ deadline }, () => {
      callbacks++;
      return Effect.succeed(undefined);
    }));
  }));
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const reason = exit.cause.reasons[0];
    expect(reason && Cause.isFailReason(reason) ? reason.error : undefined)
      .toBeInstanceOf(PhysicalSessionResourceIssue);
    if (cleanupFailure !== undefined) {
      const cleanup = exit.cause.reasons.find(Cause.isDieReason);
      expect(cleanup?.defect).toBeInstanceOf(PhysicalSessionCleanupDefect);
      if (cleanup?.defect instanceof PhysicalSessionCleanupDefect) {
        expect(cleanup.defect.phase).toBe("quarantine");
        expect(cleanup.defect.cause).toBe(cleanupFailure);
      }
    } else expect(exit.cause.reasons).toHaveLength(1);
  }
  expect(callbacks).toBe(0);
  expect(query).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledExactlyOnceWith(true);
});

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("physical session owner composition", () => {
  it("forwards lazy views through read, initial and recovery checkouts without constructing the unused view", async () => {
    const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1 });
    const access = makePhysicalSessionAccess(flarexSchema);
    const requests: { database: number; transaction: number }[] = [];
    const physical = makePostgresPhysicalSessionDriver(pool, { access: client => {
      const views = access(client);
      const requested = { database: 0, transaction: 0 };
      requests.push(requested);
      return {
        get database() { requested.database++; return views.database; },
        get transaction() { requested.transaction++; return views.transaction; },
      };
    }, errors: physicalSessionErrors });
    try {
      await runEffect(Effect.gen(function* () {
        const deadline = yield* deadlines.start("read", 10_000);
        const read = yield* physical.runReadEffect({ deadline }, database => Effect.tryPromise({
          try: async () => await database.execute(sql`select 42 as value`),
          catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }),
        }));
        expect(read).toMatchObject({ rows: [{ value: 42 }] });
        const initial = yield* physical.runInitialTransactionEffect({ deadline, isolationLevel: "read committed",
          lockTimeoutMilliseconds: 500, recoveryTimeoutMilliseconds: 1000 }, effect => effect,
          tx => Effect.tryPromise({ try: async () => await tx.execute(sql`select 42 as value`),
            catch: cause => new PhysicalSessionResourceIssue({ phase: "callback", cause }) }));
        expect(initial).toMatchObject({ kind: "committed", value: { rows: [{ value: 42 }] } });
        const recovery = yield* physical.runRecoveryTransactionEffect({ deadline, lockTimeoutMilliseconds: 500,
          excludedConnectionIdentity: makePhysicalConnectionIdentity() }, tx => Effect.tryPromise({
            try: async () => await tx.execute(sql`select 42 as value`),
            catch: cause => new PhysicalSessionResourceIssue({ phase: "callback", cause }),
          }));
        expect(recovery).toMatchObject({ kind: "committed", value: { rows: [{ value: 42 }] } });
      }));
      expect(requests).toEqual([{ database: 2, transaction: 0 },
        { database: 0, transaction: 2 }, { database: 0, transaction: 2 }]);
      expect(pool.totalCount - pool.idleCount).toBe(0);
    } finally { await pool.end(); }
  });

  it.each([[undefined, undefined], [0, undefined], [30_001, undefined], [1.5, undefined],
    [30_000, "-c statement_timeout=0"]] as const)(
    "refuses implicit startup statement_timeout %s with options %s before callback or SQL", async (timeout, startupOptions) => {
    const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1, ssl: false,
      ...(timeout === undefined ? {} : { statement_timeout: timeout }),
      ...(startupOptions === undefined ? {} : { options: startupOptions }) });
    let callbacks = 0;
    try {
      const client = await pool.connect();
      client.release();
      const query = vi.spyOn(client, "query");
      const physical = makePostgresPhysicalSessionDriver(pool, {
        access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
      });
      const exit = await runEffect(Effect.gen(function* () {
        const deadline = yield* deadlines.start("read", 1000);
        return yield* Effect.exit(physical.runImplicitReadEffect({ deadline }, () => {
          callbacks++;
          return Effect.succeed(undefined);
        }));
      }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const reason = exit.cause.reasons[0];
        const issue = reason && Cause.isFailReason(reason) ? reason.error : undefined;
        expect(issue).toBeInstanceOf(PhysicalSessionResourceIssue);
        if (issue instanceof PhysicalSessionResourceIssue) {
          expect(issue.cause).toMatchObject({ message: expect.stringContaining("startup statement_timeout") });
        }
      }
      expect(callbacks).toBe(0);
      expect(query).not.toHaveBeenCalled();
      expect(pool.totalCount).toBe(0);
    } finally { await pool.end(); }
  });

  for (const refusal of ["missingKey", "missingConfig", "tls"] as const) {
    it.skipIf(refusal === "tls" && process.env.FLAREX_POSTGRES_TLS_TEST !== "1")(
      `refuses unsupported implicit ${refusal} before callback or SQL on the exact acquired backend`, async () => {
        const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1,
          ssl: refusal === "tls" ? { rejectUnauthorized: false } : false, statement_timeout: 30_000 });
        let acquired: PoolClient | undefined;
        let callbacks = 0;
        const phases: string[] = [];
        const access = makePhysicalSessionAccess(flarexSchema);
        try {
          const client = await pool.connect();
          try {
            const preflight = await client.query<{ ssl: boolean; pid: number }>(
              "select ssl, pid from pg_stat_ssl where pid = pg_backend_pid()",
            );
            expect(preflight.rows[0]?.ssl).toBe(refusal === "tls");
            if (refusal === "missingKey") Reflect.deleteProperty(client, "secretKey");
          } finally { client.release(); }
          const query = vi.spyOn(client, "query");
          const withoutConfiguration: PhysicalPostgresPool = {
            connect: callback => pool.connect(callback),
          };
          const physical = makePostgresPhysicalSessionDriver(
            refusal === "missingConfig" ? withoutConfiguration : pool,
            { access: checkedOut => {
              acquired = checkedOut;
              return access(checkedOut);
            }, errors: physicalSessionErrors },
            { lifecycleFault: ({ phase, edge, client: released }) => {
              expect(released).toBe(client);
              phases.push(`${phase}:${edge}`);
            } },
          );
          const exit = await runEffect(Effect.gen(function* () {
            const deadline = yield* deadlines.start("read", 1000);
            return yield* Effect.exit(physical.runImplicitReadEffect({ deadline }, database => {
              callbacks++;
              return Effect.tryPromise({ try: () => database.execute(sql`select pg_sleep(30)`),
                catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) });
            }));
          }));
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const reason = exit.cause.reasons[0];
            const issue = reason && Cause.isFailReason(reason) ? reason.error : undefined;
            expect(issue).toBeInstanceOf(PhysicalSessionResourceIssue);
            if (issue instanceof PhysicalSessionResourceIssue) {
              expect(issue.phase).toBe("acquire");
              expect(issue.cause).toBeInstanceOf(Error);
              expect(issue.cause).toMatchObject({ message: expect.stringContaining(
                refusal === "tls" ? "TLS" : refusal === "missingConfig" ? "configuration" : "identity",
              ) });
            }
          }
          expect(acquired).toBeDefined();
          expect(callbacks).toBe(0);
          expect(query).not.toHaveBeenCalled();
          expect(phases).toEqual(["quarantine:before", "quarantine:after"]);
          expect(pool.totalCount).toBe(0);
        } finally { await pool.end(); }
      },
    );
  }

  it("settles a fixed implicit read without changing connection settings", async () => {
    const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1, statement_timeout: 30_000 });
    const phases: string[] = [];
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema), errors: physicalSessionErrors,
    }, { lifecycleFault: ({ phase, edge }) => phases.push(`${phase}:${edge}`) });
    try {
      const before = await pool.query<{ timeout: string; pid: number }>(
        "select current_setting('statement_timeout') as timeout, pg_backend_pid() as pid",
      );
      expect(before.rows[0]?.timeout).toBe("30s");
      const observed = await runEffect(Effect.gen(function* () {
        const deadline = yield* deadlines.start("read", 1000);
        return yield* physical.runImplicitReadEffect({ deadline }, database =>
          Effect.tryPromise({ try: () => database.execute(sql`select 41 + 1 as value`),
            catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) }));
      }));
      expect(observed).toMatchObject({ rows: [{ value: 42 }] });
      expect(phases.some(phase => /configure|reset|begin|commit|rollback/i.test(phase))).toBe(false);
      expect(phases).toContain("release:after");
      expect(pool.totalCount - pool.idleCount).toBe(0);
      const after = await pool.query<{ timeout: string; pid: number }>(
        "select current_setting('statement_timeout') as timeout, pg_backend_pid() as pid",
      );
      expect(after.rows).toEqual(before.rows);
    } finally { await pool.end(); }
  });

  it("drains an interrupted implicit query before releasing its exact connection", async () => {
    const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1, statement_timeout: 30_000 });
    const observer = new Pool({ connectionString: postgresUrl ?? undefined, max: 1 });
    const phases: string[] = [];
    const observationEvents: PhysicalSessionObservationEvent[] = [];
    const observation = new PhysicalSessionObservation({ record: event => { observationEvents.push(event); } });
    let ownerPid: number | undefined;
    const access = makePhysicalSessionAccess(flarexSchema);
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: client => {
        const pid: unknown = Reflect.get(client, "processID");
        if (typeof pid !== "number") throw new Error("Expected the acquired PostgreSQL backend identity.");
        ownerPid = pid;
        return access(client);
      }, errors: physicalSessionErrors,
    }, { lifecycleFault: ({ phase, edge }) => phases.push(`${phase}:${edge}`), observation: () => observation });
    try {
      const exit = await runEffect(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const deadline = yield* deadlines.start("read", 10000);
        const fiber = yield* physical.runImplicitReadEffect({ deadline }, database => Effect.gen(function* () {
          const pending = Promise.resolve(database.execute(sql`select pg_sleep(30)`));
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.tryPromise({ try: () => pending,
            catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) });
        })).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Effect.tryPromise({ try: async () => {
          for (let index = 0; index < 100; index++) {
            const active = await observer.query<{ active: boolean }>(
              "select exists(select 1 from pg_stat_activity where pid = $1 and state = 'active' and query like '%pg_sleep(30)%') as active",
              [ownerPid],
            );
            if (active.rows[0]?.active === true) return;
            await new Promise<void>(resolve => setTimeout(resolve, 10));
          }
          throw new Error("The actual implicit query never reached PostgreSQL.");
        }, catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) });
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.scoped));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
      expect(observationEvents).toEqual([
        { kind: "phase", phase: "quarantine", edge: "begin" },
        { kind: "phase", phase: "cancel", edge: "begin" },
        { kind: "phase", phase: "cancel", edge: "end", outcome: "success" },
        { kind: "phase", phase: "drain", edge: "begin" },
        { kind: "phase", phase: "drain", edge: "end", outcome: "success" },
        { kind: "phase", phase: "release", edge: "begin" },
        { kind: "phase", phase: "release", edge: "end", outcome: "success" },
        { kind: "phase", phase: "quarantine", edge: "end", outcome: "success" },
      ]);
      observation.assertHealthy();
      expect(phases).toContain("quarantine:after");
      expect(phases.at(-1)).toBe("quarantine:after");
      expect(pool.totalCount - pool.idleCount).toBe(0);
      const next = await pool.query<{ pid: number }>("select pg_backend_pid() as pid");
      expect(next.rows[0]?.pid).not.toBe(ownerPid);
      const active = await observer.query<{ active: boolean }>(
        "select exists(select 1 from pg_stat_activity where pid = $1 and state = 'active') as active", [ownerPid],
      );
      expect(active.rows[0]?.active).toBe(false);
    } finally { await observer.end(); await pool.end(); }
  });

  it("bounds actual shared locks after authenticated implicit cancellation transport fails", async () => {
    const pool = new Pool({ connectionString: postgresUrl ?? undefined, max: 1, ssl: false, statement_timeout: 1000 });
    const observer = new Pool({ connectionString: postgresUrl ?? undefined, max: 2 });
    const sharedKey = randomInt(1, 2_000_000_000);
    const blockingKey = sharedKey + 1;
    const blocker = await observer.connect();
    let ownerPid: number | undefined;
    const access = makePhysicalSessionAccess(flarexSchema);
    // The real acquisition remains the original pool. Only its cancellation
    // transport is directed at a refused endpoint to exercise network failure.
    const cancellationFault: PhysicalPostgresPool = {
      options: { ...pool.options, connectionString: undefined, host: "127.0.0.1", port: 1, ssl: false },
      connect: callback => pool.connect(callback),
    };
    const physical = makePostgresPhysicalSessionDriver(cancellationFault, {
      access: client => {
        const pid: unknown = Reflect.get(client, "processID");
        if (typeof pid !== "number") throw new Error("Expected actual acquired backend identity.");
        ownerPid = pid;
        return access(client);
      }, errors: physicalSessionErrors,
    });
    try {
      const preflight = await pool.query<{ statement_timeout: string }>("show statement_timeout");
      expect(preflight.rows[0]).toMatchObject({ statement_timeout: "1s" });
      await blocker.query("select pg_advisory_lock($1::bigint)", [blockingKey]);
      const startedAt = performance.now();
      const exit = await runEffect(Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const deadline = yield* deadlines.start("read", 10_000);
        const fiber = yield* physical.runImplicitReadEffect({ deadline }, database => Effect.gen(function* () {
          const pending = Promise.resolve(database.execute(sql`
            select pg_advisory_xact_lock_shared(${sharedKey}::bigint), pg_advisory_xact_lock(${blockingKey}::bigint)
          `));
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.tryPromise({ try: () => pending,
            catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) });
        })).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Effect.tryPromise({ try: async () => {
          for (let index = 0; index < 100; index++) {
            const locks = await observer.query<{ held: boolean; blocked: boolean }>(
              `select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and mode='ShareLock' and granted) as held,
                exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) as blocked`, [ownerPid]);
            if (locks.rows[0]?.held === true && locks.rows[0]?.blocked === true) return;
            await new Promise<void>(resolve => setTimeout(resolve, 5));
          }
          throw new Error("The actual implicit backend did not hold its shared lock while blocked.");
        }, catch: cause => new PhysicalSessionResourceIssue({ phase: "read", cause }) });
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.scoped));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
        const cleanup = exit.cause.reasons.find(Cause.isDieReason);
        expect(cleanup?.defect).toBeInstanceOf(PhysicalSessionCleanupDefect);
      }
      let locked = true;
      while (locked && performance.now() - startedAt < 2500) {
        const locks = await observer.query<{ locked: boolean }>(
          "select exists(select 1 from pg_locks where pid=$1 and locktype='advisory') as locked", [ownerPid]);
        locked = locks.rows[0]?.locked !== false;
        if (locked) await new Promise<void>(resolve => setTimeout(resolve, 10));
      }
      expect(locked).toBe(false);
      expect(performance.now() - startedAt).toBeLessThan(2500);
      expect(pool.totalCount).toBe(0);
    } finally {
      try { await blocker.query("select pg_advisory_unlock($1::bigint)", [blockingKey]); }
      finally { blocker.release(); await observer.end(); await pool.end(); }
    }
  });

  it("keeps the catalog session independent of framework query metadata", async () => {
    const fixture = await createFileScopedPostgresFixture();
    const pool = fixture.persistence.pool;
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema),
      errors: physicalSessionErrors,
    });
    const artifact =
      makePostgresCatalogControlSessionDriver(pool);
    try {
      const observations = await runEffect(
        Effect.gen(function* () {
          const coreDeadline = yield* deadlines.start("initial", 1000);
          const core = yield* physical.runInitialTransactionEffect(
            {
              isolationLevel: "read committed",
              deadline: coreDeadline,
              lockTimeoutMilliseconds: 500,
              recoveryTimeoutMilliseconds: 1000,
            },
            (e) => e,
            (tx) =>
              Effect.succeed("fxControlFrameworkSchemaArtifacts" in tx.query),
          );
          const artifactDeadline = yield* artifactDeadlines.start(
            "initial",
            1000,
          );
          const control = yield* artifact.runInitialTransactionEffect(
            {
              isolationLevel: "read committed",
              deadline: artifactDeadline,
              lockTimeoutMilliseconds: 500,
              recoveryTimeoutMilliseconds: 1000,
            },
            (e) => e,
            (tx) =>
              Effect.succeed("fxControlFrameworkSchemaArtifacts" in tx.query),
          );
          return { core, control };
        }),
      );
      expect(observations.core).toEqual({ kind: "committed", value: false });
      expect(observations.control).toEqual({ kind: "committed", value: false });
      expect(pool.totalCount - pool.idleCount).toBe(0);
    } finally {
      await fixture.dispose();
    }
  });

  it("emits neutral resource failure with the original cause and no callback execution", async () => {
    const pool = new Pool({
      connectionString: postgresUrl ?? undefined,
      max: 1,
    });
    const original = new Error("physical begin fault");
    let callbacks = 0;
    const physical = makePostgresPhysicalSessionDriver(
      pool,
      {
        access: makePhysicalSessionAccess(flarexSchema),
        errors: physicalSessionErrors,
      },
      {
        lifecycleFault: ({ phase, edge }) => {
          if (phase === "begin" && edge === "before") throw original;
        },
      },
    );
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const deadline = yield* deadlines.start("initial", 1000);
          return yield* physical.runInitialTransactionEffect(
            {
              isolationLevel: "read committed",
              deadline,
              lockTimeoutMilliseconds: 500,
              recoveryTimeoutMilliseconds: 1000,
            },
            (e) => e,
            () =>
              Effect.sync(() => {
                callbacks++;
              }),
          );
        }),
      );
      expect(result.kind).toBe("notCommitted");
      if (result.kind === "notCommitted") {
        const reason = result.cause.reasons[0];
        expect(
          reason && Cause.isFailReason(reason) ? reason.error : undefined,
        ).toBeInstanceOf(PhysicalSessionResourceIssue);
        if (reason && Cause.isFailReason(reason))
          expect(reason.error.cause).toBe(original);
      }
      expect(callbacks).toBe(0);
      expect(pool.totalCount - pool.idleCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
