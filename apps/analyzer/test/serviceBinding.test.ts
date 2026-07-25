import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAnalyzerIdentity, type AnalyzerIdentityBuildReceipt } from "../scripts/buildIdentity";
import { canonicalPrivateAnalyzerHandshakeRequestV1 } from "../src/Handshake";
import { installedPrivateAnalyzerIdentityV1 } from "../src/Identity";

describe("private analyzer Miniflare service binding", () => {
  let receipt: AnalyzerIdentityBuildReceipt;
  let runtime: Miniflare;

  beforeAll(async () => {
    receipt = await checkAnalyzerIdentity();
    runtime = new Miniflare({
      workers: [
        {
          name: "private-analyzer-test-caller",
          compatibilityDate: "2026-06-14",
          routes: ["caller.test/*"],
          modules: [{
            type: "ESModule",
            path: "caller.js",
            contents: `export default {
              fetch(request, env) {
                const incoming = new URL(request.url);
                const target = incoming.pathname === "/call"
                  ? "/__flarex_private/source-analyzer-v2/identity"
                  : incoming.pathname === "/verify"
                  ? "/__flarex_private/source-analyzer-v2/verify"
                  : undefined;
                if (target === undefined) {
                  return new Response("caller-not-found", { status: 404 });
                }
                return env.ANALYZER.fetch(
                  "https://private-analyzer.internal" + target,
                  { method: request.method, headers: request.headers, body: request.body }
                );
              }
            };`,
          }],
          serviceBindings: { ANALYZER: "private-analyzer" },
        },
        {
          name: "private-analyzer",
          compatibilityDate: "2026-06-14",
          routes: [],
          modules: [{
            type: "ESModule",
            path: "worker.js",
            contents: receipt.finalBundle,
          }],
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose();
  });

  it("reaches the secondary Worker only through the primary service binding", async () => {
    const installed = installedPrivateAnalyzerIdentityV1();
    const response = await runtime.dispatchFetch("https://caller.test/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array(canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity)).buffer,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "compatible", ...installed.identity });

    const publicAttempt = await runtime.dispatchFetch(
      `https://unrouted.test${installed.configuration.handshake.path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array(canonicalPrivateAnalyzerHandshakeRequestV1(installed.identity)).buffer,
      },
    );
    expect(publicAttempt.status).toBe(404);
    expect(await publicAttempt.text()).toBe("caller-not-found");
  });

  it("streams verification requests through the same private binding", async () => {
    const response = await runtime.dispatchFetch("https://caller.test/verify", {
      method: "POST",
      headers: {
        "content-type":
          "application/x-flarex-declarative-v2-verification-v1",
      },
      body: new Uint8Array([1, 0, 0, 0, 1, 0]).buffer,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "identityMismatch" });
  });
});
