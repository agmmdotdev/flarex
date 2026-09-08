import { Cause, Effect, Exit } from "effect";
import { TestClock } from "effect/testing";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { makePhysicalDeadlineOperations } from "../src/physicalSession/deadline";
import { makePhysicalSessionAccess } from "../src/physicalSession/drizzle";
import {
  physicalSessionErrors,
  PhysicalSessionDeadlineIssue,
  PhysicalSessionInvariantDefect,
  PhysicalSessionResourceIssue,
} from "../src/physicalSession/errors";
import { makePostgresPhysicalSessionDriver } from "../src/physicalSession/postgres";
import { flarexSchema } from "../src/schema";
import {
  artifactControlPhysicalErrors,
  FrameworkSchemaArtifactControlSessionDeadlineIssue,
} from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const deadlines = makePhysicalDeadlineOperations(physicalSessionErrors);
const artifactDeadlines = makePhysicalDeadlineOperations(
  artifactControlPhysicalErrors,
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
    ).toBeInstanceOf(FrameworkSchemaArtifactControlSessionDeadlineIssue);
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

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("physical session owner composition", () => {
  it("keeps artifact schema access with the artifact adapter", async () => {
    const pool = new Pool({
      connectionString: postgresUrl ?? undefined,
      max: 1,
    });
    const physical = makePostgresPhysicalSessionDriver(pool, {
      access: makePhysicalSessionAccess(flarexSchema),
      errors: physicalSessionErrors,
    });
    const artifact =
      makePostgresFrameworkSchemaArtifactControlSessionDriver(pool);
    try {
      const observations = await runEffect(
        Effect.gen(function* () {
          const coreDeadline = yield* deadlines.start("initial", 1000);
          const core = yield* physical.runInitialTransactionEffect(
            {
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
      expect(observations.control).toEqual({ kind: "committed", value: true });
      expect(pool.totalCount - pool.idleCount).toBe(0);
    } finally {
      await pool.end();
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
