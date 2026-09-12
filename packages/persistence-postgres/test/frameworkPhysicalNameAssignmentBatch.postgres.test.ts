import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { Deferred } from "effect";
import { describe, expect, it } from "vitest";
import { ensureRelationalPhysicalNameAssignmentsInTransactionEffect as ensureAssignments } from "../src/migrationCoordination/physicalNameAssignmentRepository";
import { fxSystemRelationalPhysicalNameAssignments } from "../src/migrationCoordination/schema";
import { runEffect } from "./effectTestRuntime";
import { assignmentBatchParents, assignmentBatchSuite, assignmentBatchValues } from "./frameworkPhysicalNameAssignmentBatchSuite";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";

describe.skipIf(postgresUrl === null)("bounded physical-name assignment batches (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  assignmentBatchSuite(withPersistence);

  it("converges opposite-order overlapping inventories after an observed unique-index lock wait", async () => {
    await withPersistence(async persistence => {
      const values = await assignmentBatchValues();
      const collision = await persistence.drizzle.transaction(transaction => assignmentBatchParents(transaction, values));
      const held = await runEffect(Deferred.make<number, unknown>());
      const release = await runEffect(Deferred.make<void>());
      const first = persistence.drizzle.transaction(async transaction => {
        const rows = await runEffect(ensureAssignments(transaction, collision, values.inventory));
        const [backend] = await transaction.select({ pid: sql<number>`pg_backend_pid()` })
          .from(fxSystemRelationalPhysicalNameAssignments).limit(1);
        if (backend === undefined) throw new Error("Missing transaction backend PID");
        await runEffect(Deferred.succeed(held, backend.pid));
        await runEffect(Deferred.await(release));
        return rows;
      });
      // Observe rejection immediately so fixture failures never orphan a waiter.
      void first.catch(error => runEffect(Deferred.fail(held, error)));
      const blockerPid = await runEffect(Deferred.await(held));
      const second = persistence.drizzle.transaction(transaction => runEffect(ensureAssignments(transaction, collision,
        [...values.inventory].reverse())));
      const settled = Promise.all([first, second]);
      void settled.catch(() => undefined);
      try {
        let blocked = false;
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const result = await persistence.query<{ blocked: boolean }>(`select exists (
            select 1 from pg_stat_activity where datname = current_database()
              and usename = current_user and wait_event_type = 'Lock'
              and $1::int = any(pg_blocking_pids(pid))
              and query ilike '%insert into%fx_system_relational_physical_name_assignment%'
          ) as blocked`, [blockerPid]);
          if (result.rows[0]?.blocked === true) { blocked = true; break; }
          await delay(10);
        }
        expect(blocked).toBe(true);
      } finally {
        await runEffect(Deferred.succeed(release, undefined));
        await settled;
      }
      const [left, right] = await settled;
      expect(right.map(row => row.storageId)).toEqual(left.map(row => row.storageId).reverse());
    });
  });
});
