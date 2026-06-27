import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flarexTest, type FlarexTest, type FlarexTestInvocationError } from "flarex-test";
import type { Id } from "flarex/values";
import { api } from "./_generated/api";

let t: FlarexTest;

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const deploymentId = "example-e2e";
const userId = "2:u1" as Id<"users">;

beforeAll(async () => {
  t = await flarexTest({
    root: appRoot,
    deploymentId,
  });
});

afterAll(async () => {
  await t?.dispose();
});

describe("Flarex invoke", () => {
  it("executes app functions through backend execution sessions", async () => {
    const complete = await t.invokeRaw(
      api.lessons.complete,
      {
        userId,
        lessonId: "intro",
      },
    );
    expect(complete).toMatchObject({ committedTs: 1 });
    expect(complete.writes).toHaveLength(1);
    expect(complete.writes?.[0]).toMatchObject({
      tableId: 1,
      value: { userId: "2:u1", lessonId: "intro", completed: true },
    });

    const list = await t.invokeRaw(api.lessons.list, { userId });
    expect(list.value).toEqual([
      expect.objectContaining({
        userId: "2:u1",
        lessonId: "intro",
        completed: true,
      }),
    ]);
    expect(list.readSet).toEqual({
      indexes: [
        expect.objectContaining({
          indexId: 1,
        }),
      ],
    });

    await t.reset();
    await expect(t.query(api.lessons.list, { userId })).resolves.toEqual([]);

    await t.mutation(api.lessons.complete, { userId, lessonId: "after-reset" });
    await Promise.all([t.reset(), t.reset()]);
    await expect(t.query(api.lessons.list, { userId })).resolves.toEqual([]);
  });

  it("serializes disposal with lifecycle operations", async () => {
    const disposed = await flarexTest({
      root: appRoot,
      deploymentId: `${deploymentId}-disposed`,
    });
    const results = await Promise.allSettled([disposed.dispose(), disposed.reset()]);
    expect(results).toMatchObject([
      { status: "fulfilled" },
      {
        status: "rejected",
        reason: expect.objectContaining({
          message: "Flarex test runtime is disposed.",
        }),
      },
    ]);

    await expect(disposed.reset()).rejects.toThrow("Flarex test runtime is disposed.");
    await expect(disposed.reload()).rejects.toThrow("Flarex test runtime is disposed.");
    await expect(disposed.query(api.lessons.list, { userId })).rejects.toThrow(
      "Flarex test runtime is disposed.",
    );
    await expect(disposed.dispose()).resolves.toBeUndefined();
  });

  it("rejects bad IDs through backend argument validation", async () => {
    const response = await t.fetch("/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "lessons:list",
        partitionKey: userId,
        args: { userId: "1:not-a-user" },
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error:
        "ArgumentValidationError: $args.userId: Expected an ID for table users, got an ID for table lessonProgress.",
    });
  });

  it("rejects partition mismatches before execution", async () => {
    await expect(
      t.invokeRaw(api.lessons.list, { userId }, { partitionKey: "2:other-user" }),
    ).rejects.toMatchObject({
      status: 400,
      body: {
        error: "PartitionValidationError: partitionKey must match args.userId for lessons:list.",
      },
    } satisfies Partial<FlarexTestInvocationError>);
  });
});
