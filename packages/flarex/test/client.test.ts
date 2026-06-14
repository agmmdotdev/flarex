import { describe, expect, it, vi } from "vitest";
import { FlarexClient } from "../src/client";

describe("FlarexClient", () => {
  it("invokes a generated reference in an explicit partition", async () => {
    const fetch = vi.fn(async () => Response.json({ value: { completed: true } }));
    const client = new FlarexClient("https://example.test", { fetch });

    await expect(
      client.mutation(
        { _path: "lessons:complete", _kind: "mutation" },
        { lessonId: "intro" },
        { partitionKey: "user-1" },
      ),
    ).resolves.toEqual({ completed: true });

    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.test/invoke"),
      expect.objectContaining({
        body: JSON.stringify({
          path: "lessons:complete",
          args: { lessonId: "intro" },
          partitionKey: "user-1",
        }),
      }),
    );
  });
});
