import { Miniflare } from "miniflare";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("backend to executor project-scope lookup service binding", () => {
  let runtime: Miniflare;

  beforeAll(async () => {
    runtime = new Miniflare({
      workers: [
        {
          name: "scope-lookup-caller",
          compatibilityDate: "2026-06-14",
          routes: ["scope-lookup.test/*"],
          modules: [{
            type: "ESModule",
            path: "caller.js",
            contents: await bundleCaller(),
          }],
          bindings: { FLAREX_EXECUTOR_TOKEN: "executor-secret" },
          serviceBindings: { FLAREX_EXECUTOR: "private-executor" },
        },
        {
          name: "private-executor",
          compatibilityDate: "2026-06-14",
          routes: [],
          modules: [{
            type: "ESModule",
            path: "executor.js",
            contents: executorWorkerSource,
          }],
        },
      ],
    });
  });

  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose();
  });

  it("uses the private binding and token without exposing relationship evidence", async () => {
    const matched = await runtime.dispatchFetch("https://scope-lookup.test/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deploymentId: "deployment-a", projectId: "project-a" }),
    });
    expect(matched.status).toBe(200);
    await expect(matched.json()).resolves.toEqual({
      kind: "matched",
      deploymentId: "deployment-a",
      projectId: "project-a",
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
    });

    await expect(runtime.unsafeGetDirectURL("private-executor")).rejects.toThrow(
      'Direct access disabled in "private-executor" worker',
    );
  });

  it("redacts executor rejection details at the private adapter boundary", async () => {
    const response = await runtime.dispatchFetch("https://scope-lookup.test/lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deploymentId: "force-resource", projectId: "project-a" }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("DeploymentProjectScopeLookupResourceV1Error");
    expect(text).not.toContain("private executor failure detail");
  });
});

async function bundleCaller(): Promise<string> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(directory, "deploymentProjectScopeLookup.workerd.worker.ts"),
        formats: ["es"],
        fileName: "caller",
      },
    },
  });
  const results = Array.isArray(output) ? output : [output];
  for (const result of results) {
    if (!("output" in result)) continue;
    const chunk = result.output.find((candidate) =>
      candidate.type === "chunk" && candidate.fileName === "caller.js"
    );
    if (chunk?.type === "chunk") return chunk.code;
  }
  throw new Error("Scope lookup caller bundle was not emitted.");
}

const executorWorkerSource = `
export default {
  async fetch(request) {
    if (request.headers.get("authorization") !== "Bearer executor-secret") {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const input = JSON.parse(await request.text());
    if (input.deploymentId === "force-resource") {
      return Response.json(
        { error: "private executor failure detail" },
        { status: 503 },
      );
    }
    const body = JSON.stringify({
      codecVersion: 1,
      deploymentCreatedAt: "2026-07-22T00:00:00.000Z",
      deploymentId: input.deploymentId,
      kind: "matched",
      projectId: input.projectId,
    });
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/vnd.flarex.deployment-project-scope-lookup-v1+json",
      },
    });
  },
};
`;
