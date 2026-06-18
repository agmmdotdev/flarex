import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flarexTest, type FlarexTest } from "flarex-test";
import type { Id } from "flarex/values";
import { api } from "./_generated/api";

let t: FlarexTest;

const deploymentId = "example-sync-e2e";
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

describe("Flarex sync client", () => {
  it("receives live query updates from real backend sync mutations", async () => {
    const client = t.client();
    const updates: unknown[] = [];
    const errors: Error[] = [];

    const unsubscribe = client.onUpdate(
      api.lessons.list,
      { userId },
      value => updates.push(value),
      error => errors.push(error),
    );

    await waitFor(() => updates.length === 1);
    expect(errors).toEqual([]);
    expect(updates[0]).toEqual([]);

    await client.mutation(
      api.lessons.complete,
      { userId, lessonId: "intro" },
    );

    await waitFor(() => updates.length === 2);
    expect(errors).toEqual([]);
    expect(updates[1]).toEqual([
      expect.objectContaining({
        userId: "2:u1",
        lessonId: "intro",
        completed: true,
      }),
    ]);

    unsubscribe();
    client.close();
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
