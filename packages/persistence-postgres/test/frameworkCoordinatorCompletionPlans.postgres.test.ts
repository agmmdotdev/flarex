import { Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as statements from "../src/drizzleStatementEffect";
import { runFreshFrameworkMigrationCoordinatorEffect, executeNextFrameworkMigrationStepEffect } from "../src/migrationCoordination/freshCoordinator";
import { withNativeCoordinator } from "./frameworkCoordinatorPostgresFixture";
import { postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const Statement = Schema.Struct({ sql: Schema.String, params: Schema.Array(Schema.Unknown) });
const decodeStatement = Schema.decodeUnknownResult(Statement);
const native = postgresUrl === null ? describe.skip : describe;

native("protected completion query plans", () => {
  it("explains the actual direct-dependency and tail statements as the installer login", async () => {
    await withNativeCoordinator(async fixture => {
      const opened = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 14 }));
      if (opened.kind !== "pending") throw new Error("Expected partial installation");
      const selected = new Map<string, typeof Statement.Type>();
      const runStatement = statements.runDrizzleStatementEffect;
      const observer = vi.spyOn(statements, "runDrizzleStatementEffect").mockImplementation((statement, mapFailure) => {
        if ("toSQL" in statement && typeof statement.toSQL === "function") {
          const decoded = decodeStatement(statement.toSQL());
          if (Result.isSuccess(decoded) && decoded.success.sql.includes('from "fx_system_framework_migration_step_receipt"') &&
            !decoded.success.sql.includes('"canonical_bytes"')) {
            const query = decoded.success;
            const kind = query.sql.includes('"step_id" in (') ? "directDependencies" :
              query.sql.includes('where "fx_system_framework_migration_step_receipt"."receipt_storage_id" =') ? "tail" : undefined;
            if (kind !== undefined) selected.set(kind, query);
          }
        }
        return runStatement(statement, mapFailure);
      });
      try { expect(await runEffect(executeNextFrameworkMigrationStepEffect(opened.claim))).toMatchObject({ kind: "step", completedStepCount: 15 }); }
      finally { observer.mockRestore(); }
      expect([...selected.keys()].sort()).toEqual(["directDependencies", "tail"]);
      const client = await fixture.migrationPool.connect();
      try {
        const identity = await client.query<{ superuser: boolean; login: string }>(
          "select r.rolsuper as superuser, session_user as login from pg_roles r where r.rolname=session_user");
        expect(identity.rows[0]?.superuser).toBe(false);
        const plans: Record<string, unknown> = {};
        for (const [kind, query] of selected) {
          const natural = await client.query<{ "QUERY PLAN": unknown }>(`explain (analyze, buffers, format json) ${query.sql}`, [...query.params]);
          await client.query("begin");
          try {
            // Tiny fixture tables may favor a sequential scan. Separately prove
            // index eligibility without claiming this forced plan is natural.
            await client.query("set local enable_seqscan=off");
            const indexed = await client.query<{ "QUERY PLAN": unknown }>(`explain (format json) ${query.sql}`, [...query.params]);
            const encoded = JSON.stringify(indexed.rows);
            expect(encoded).toContain('"Index Cond"');
            expect(encoded).toContain(kind === "tail" ? "receipt_storage_id =" : "plan_storage_id =");
            if (kind === "directDependencies") expect(encoded).toContain("step_id = ANY");
            expect(encoded).not.toContain('"Node Type":"Seq Scan"');
            plans[kind] = { natural: natural.rows[0]?.["QUERY PLAN"], indexEligibility: indexed.rows[0]?.["QUERY PLAN"] };
          } finally { await client.query("rollback"); }
        }
        process.stdout.write(JSON.stringify({ completionQueryPlans: plans }) + "\n");
      } finally { client.release(); }
    }, {}, 4);
  }, 180_000);
});
