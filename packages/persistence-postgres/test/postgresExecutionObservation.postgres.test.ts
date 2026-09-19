import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { postgresUrl } from "./postgresHelpers";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("CE0 PostgreSQL observation", () => {
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
      );
      expect(measured.value).toBe("tenant-secret-🚀");
      expect(measured.observation).toMatchObject({
        checkouts: 1,
        releases: 1,
        queryCalls: 4,
        commands: { begin: 1, select: 2, rollback: 1 },
      });
      expect(measured.observation.transmittedBytes).toBeGreaterThan(0);
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
