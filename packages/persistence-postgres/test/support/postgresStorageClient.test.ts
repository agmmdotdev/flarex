import { Effect } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import { postgresStorageRequest } from "./postgresStorageClient";

const endpoint = { url: "http://127.0.0.1:1/", token: "test", connectionKey: "test" };
const run = (fetch: typeof globalThis.fetch) => Effect.runPromise(
  postgresStorageRequest(endpoint, { operation: "acquire", key: "test" }).pipe(
    Effect.provide(FetchHttpClient.layer), Effect.provideService(FetchHttpClient.Fetch, fetch),
  ));

describe("private storage session HTTP boundary", () => {
  it("decodes a successful lease through the injected client", async () => {
    const lease = { schemaName: "test", migrationsSchema: "journal", leaseId: "lease", seal: null, fresh: true };
    expect(await run(async () => Response.json({ ok: true, lease }))).toEqual({ ok: true, lease });
  });

  it("retains protocol refusal separately from malformed response data", async () => {
    await expect(run(async () => Response.json({ ok: false, error: "lease refused" }, { status: 500 })))
      .rejects.toMatchObject({ _tag: "PostgresStorageSessionError", reason: "refused", status: 500, detail: "lease refused" });
    await expect(run(async () => Response.json({}))).rejects.toMatchObject({ _tag: "SchemaError" });
  });

  it("refuses an oversized chunk before decoding and cancels its response stream", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(9000)); },
      cancel() { cancelled = true; },
    });
    await expect(run(async () => new Response(body))).rejects.toMatchObject({
      _tag: "PostgresStorageSessionError", reason: "responseTooLarge",
    });
    expect(cancelled).toBe(true);
  });
});
