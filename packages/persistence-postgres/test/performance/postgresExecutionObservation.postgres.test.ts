import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { postgresUrl } from "../support/postgresHelpers";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("CE0 PostgreSQL observation", () => {
  it("separates family statement verbs without treating WITH as a direct write", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL required.");
    const pool = new Pool({ connectionString: postgresUrl, max: 1 });
    try {
      await pool.query(
        "create temporary table fx_system_unique_constraint_build (value integer)",
      );
      const measured = await withPostgresExecutionObservation(
        pool,
        async () => {
          const client = await pool.connect();
          try {
            await client.query("begin");
            await client.query(
              "insert into fx_system_unique_constraint_build values ($1)",
              [1],
            );
            await client.query(
              "update fx_system_unique_constraint_build set value=$1",
              [2],
            );
            expect(
              (
                await client.query(
                  "select value from fx_system_unique_constraint_build",
                )
              ).rows,
            ).toEqual([{ value: 2 }]);
            await client.query(
              "with selected as (select * from fx_system_unique_constraint_build) select * from selected",
            );
          } finally {
            try {
              await client.query("rollback");
            } finally {
              client.release();
            }
          }
        },
      );
      expect(
        measured.observation.familyQueries.fx_system_unique_constraint_build,
      ).toBe(4);
      expect(
        measured.observation.familyCommands.fx_system_unique_constraint_build,
      ).toEqual({ insert: 1, update: 1, select: 1, with: 1 });
      expect(measured.observation.queryCalls).toBe(6);
      expect(JSON.stringify(measured.observation)).not.toContain("set value");
      expect(pool.listenerCount("acquire")).toBe(0);
      expect(pool.listenerCount("release")).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("preserves callback queries, rollback failures, release and query identity without retaining data", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL required.");
    const pool = new Pool({ connectionString: postgresUrl, max: 1 });
    try {
      const initial = await pool.connect();
      const original = initial.query;
      initial.release();
      const measured = await withPostgresExecutionObservation(
        pool,
        async (markStep) => {
          const client = await pool.connect();
          try {
            await client.query("begin");
            markStep("clockLocked");
            const value = await new Promise<string>((resolve, reject) => {
              client.query<{ value: string }>(
                "select $1::text as value",
                ["tenant-secret-🚀"],
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result.rows[0]?.value ?? "");
                },
              );
            });
            await expect(client.query("select 1 / 0")).rejects.toMatchObject({
              code: "22012",
            });
            await client.query("rollback");
            return value;
          } finally {
            client.release();
          }
        },
        { attributeStatements: true },
      );
      expect(measured.value).toBe("tenant-secret-🚀");
      expect(measured.observation).toMatchObject({
        checkouts: 1,
        releases: 1,
        queryCalls: 4,
        commands: { begin: 1, select: 2, rollback: 1 },
      });
      expect(measured.observation.transmittedBytes).toBeGreaterThan(0);
      expect(
        measured.observation.statementShapes
          ?.flatMap((shape) => shape.ordinals)
          .toSorted((a, b) => a - b),
      ).toEqual([0, 1, 2, 3]);
      expect(JSON.stringify(measured.observation)).not.toMatch(
        /tenant-secret|select \$1|22012/,
      );
      const reused = await pool.connect();
      try {
        expect(reused.query).toBe(original);
      } finally {
        reused.release();
      }

      const sentinel = new Error("original caller failure");
      await expect(
        withPostgresExecutionObservation(pool, async () => {
          await pool.query("select 1");
          throw sentinel;
        }),
      ).rejects.toBe(sentinel);
      expect(pool.listenerCount("acquire")).toBe(0);
      expect(pool.listenerCount("release")).toBe(0);
      const afterFailure = await pool.connect();
      try {
        expect(afterFailure.query).toBe(original);
      } finally {
        afterFailure.release();
      }
    } finally {
      await pool.end();
    }
  });

  it("groups exact SQL independently of parameters and recognizes complete family names", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL required.");
    const pool = new Pool({ connectionString: postgresUrl, max: 1 });
    try {
      await pool.query("create temporary table fx_app_row_rev (value text)");
      const measured = await withPostgresExecutionObservation(
        pool,
        async () => {
          await pool.query("insert into fx_app_row_rev values ($1)", [
            "private-one",
          ]);
          await pool.query("insert into fx_app_row_rev values ($1)", [
            "private-two",
          ]);
          await pool.query("select * from fx_app_row_rev");
        },
        { attributeStatements: true },
      );
      expect(measured.observation.statementShapes).toHaveLength(2);
      expect(
        measured.observation.statementShapes?.map(
          ({ command, families, ordinals }) => ({
            command,
            families,
            ordinals,
          }),
        ),
      ).toEqual([
        { command: "insert", families: ["fx_app_row_rev"], ordinals: [0, 1] },
        { command: "select", families: ["fx_app_row_rev"], ordinals: [2] },
      ]);
      expect(JSON.stringify(measured.observation)).not.toMatch(
        /private-one|private-two|insert into|select \*/,
      );
      const plain = await withPostgresExecutionObservation(pool, () =>
        pool.query("select 1"),
      );
      expect(plain.observation.statementShapes).toBeNull();
      expect(pool.listenerCount("acquire")).toBe(0);
      expect(pool.listenerCount("release")).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("refuses observation over an already borrowed connection", async () => {
    if (postgresUrl === null) throw new Error("PostgreSQL URL required.");
    const pool = new Pool({ connectionString: postgresUrl, max: 1 });
    try {
      const held = await pool.connect();
      try {
        await expect(
          withPostgresExecutionObservation(pool, async () => undefined),
        ).rejects.toThrow("idle, exclusively owned pool");
      } finally {
        held.release();
      }
    } finally {
      await pool.end();
    }
  });
});
