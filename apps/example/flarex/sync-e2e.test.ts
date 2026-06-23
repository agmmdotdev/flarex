import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flarexTest, type FlarexTest } from "flarex-test";
import type { Id } from "flarex/values";
import { api } from "./_generated/api";

const userId = "2:u1" as Id<"users">;
const runtimes: FlarexTest[] = [];

let legacy: FlarexTest;
let postgres: FlarexTest;

beforeAll(async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  legacy = await flarexTest({
    root,
    deploymentId: "example-sync-e2e-legacy",
  });
  runtimes.push(legacy);
  postgres = await flarexTest({
    root,
    deploymentId: "example-sync-e2e-postgres",
    executorTransport: "postgres",
  });
  runtimes.push(postgres);
});

afterAll(async () => {
  await Promise.all(runtimes.map(runtime => runtime.dispose()));
});

describe("Flarex sync client", () => {
  it("receives live query updates from legacy backend sync mutations", async () => {
    await expectLiveLessonUpdate(legacy, "intro");
  });

  it("receives live query updates through Postgres executor delivery", async () => {
    await expectLiveLessonUpdate(postgres, "postgres-intro");
  });
});

async function expectLiveLessonUpdate(
  runtime: FlarexTest,
  lessonId: string,
): Promise<void> {
  const client = runtime.client();
  const updates: unknown[] = [];
  const errors: Error[] = [];

  const unsubscribe = client.onUpdate(
    api.lessons.list,
    { userId },
    value => updates.push(value),
    error => errors.push(error),
  );

  try {
    await waitFor(() => updates.length === 1);
    expect(errors).toEqual([]);
    expect(updates[0]).toEqual([]);

    await client.mutation(
      api.lessons.complete,
      { userId, lessonId },
    );

    await waitFor(() => updates.length === 2);
    expect(errors).toEqual([]);
    expect(updates[1]).toEqual([
      expect.objectContaining({
        userId: "2:u1",
        lessonId,
        completed: true,
      }),
    ]);
  } finally {
    unsubscribe();
    client.close();
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
