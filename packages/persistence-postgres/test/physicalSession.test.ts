import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { TestClock } from "effect/testing";
import { Client, Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { makePhysicalDeadlineOperations } from "../src/physicalSession/deadline";
import { makePhysicalSessionAccess } from "../src/physicalSession/drizzle";
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

const deadlines = makePhysicalDeadlineOperations(physicalSessionErrors);
const postgresUrl = trimToNonBlankOrNull(process.env.FLAREX_POSTGRES_DATABASE_URL);
const artifactDeadlines = makePhysicalDeadlineOperations(
  catalogControlPhysicalErrors,
);

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
    let ownerPid: number | undefined;
    const access = makePhysicalSessionAccess(flarexSchema);
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: client => {
        const pid: unknown = Reflect.get(client, "processID");
        if (typeof pid !== "number") throw new Error("Expected the acquired PostgreSQL backend identity.");
        ownerPid = pid;
        return access(client);
      }, errors: physicalSessionErrors,
    }, { lifecycleFault: ({ phase, edge }) => phases.push(`${phase}:${edge}`) });
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
