import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flarexTest, type FlarexTest } from "flarex-test";
import type { Id } from "flarex/values";
import { api } from "./_generated/api";

let t: FlarexTest;

const deploymentId = "example-e2e";
const partitionKey = "user:2:u1";
const userId = "2:u1" as Id<"users">;

beforeAll(async () => {
  t = await flarexTest({
    root: fileURLToPath(new URL("..", import.meta.url)),
    deploymentId,
  });
});

afterAll(async () => {
  await t?.dispose();
});

describe("generated Worker invoke", () => {
  it("executes app functions through backend execution sessions", async () => {
    const complete = await t.invokeRaw(
      api.lessons.complete,
      {
        userId,
        lessonId: "intro",
      },
      { partitionKey },
    );
    expect(complete).toMatchObject({ committedTs: 1 });
    expect(complete.writes).toHaveLength(1);
    expect(complete.writes?.[0]).toMatchObject({
      tableId: 1,
      value: { userId: "2:u1", lessonId: "intro", completed: true },
    });

    const list = await t.invokeRaw(api.lessons.list, { userId }, { partitionKey });
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
  });

  it("rejects bad IDs before backend execution starts", async () => {
    const response = await t.fetch("/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: "lessons:list",
        partitionKey,
        args: { userId: "1:not-a-user" },
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "$args.userId: Expected an ID for table users, got an ID for table lessonProgress.",
    });
  });
});
