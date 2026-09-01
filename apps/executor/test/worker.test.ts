import { describe, expect, it } from "vitest";

import executorWorker, {
  createExecutorWorker,
  executorPostgresClientConfigForRequest,
} from "../src/worker";

describe("production executor Worker wrapper", () => {
  it("applies hard Postgres deadlines only to the query-sync source route", () => {
    const connectionString = "postgres://hyperdrive.invalid/flarex";
    expect(executorPostgresClientConfigForRequest(
      connectionString,
      new Request("https://flarex-executor.internal/invoke/start"),
    )).toEqual({ connectionString });
    expect(executorPostgresClientConfigForRequest(
      connectionString,
      new Request(
        "https://flarex-executor.internal/internal/v1/query-sync/source/read-after",
      ),
    )).toEqual({
      connectionString,
      connectionTimeoutMillis: 60_000,
      options: "-c statement_timeout=60000 -c transaction_timeout=60000",
      query_timeout: 60_000,
    });
  });

  it("exports the request-scoped Worker and fails closed before database allocation", async () => {
    expect(typeof executorWorker.fetch).toBe("function");
    expect("scheduled" in executorWorker).toBe(false);

    const response = await createExecutorWorker().fetch(
      new Request("https://flarex-executor.internal/invoke/start", {
        method: "POST",
      }),
      {
        HYPERDRIVE_CACHE_DISABLED: {
          connectionString: "postgres://unused.invalid/flarex",
        },
      },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "executor_misconfigured",
      message: "FLAREX_EXECUTOR_TOKEN is required for hosted executor requests.",
    });
  });

  it("rejects an unauthorized production request before opening Hyperdrive", async () => {
    const response = await createExecutorWorker().fetch(
      new Request("https://flarex-executor.internal/invoke/start", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
      }),
      {
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
        HYPERDRIVE_CACHE_DISABLED: {
          connectionString: "postgres://unused.invalid/flarex",
        },
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });
  });
});
