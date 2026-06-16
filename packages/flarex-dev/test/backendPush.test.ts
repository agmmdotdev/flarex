import type { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import type { DeploymentAnalysis } from "../src/analyze";
import { LocalBackendPushCoordinator } from "../src/backendPush";
import type { ExecutionArtifactAdapter } from "../src/executionArtifact";
import type { SourcePackage } from "../src/sourcePackage";

describe("backend push coordinator", () => {
  it("owns execution artifact analysis before starting backend push", async () => {
    const sourcePackage = testSourcePackage();
    const analysis = testAnalysis();
    const analyzer: ExecutionArtifactAdapter = {
      analyze: async package_ => {
        expect(package_).toBe(sourcePackage);
        return analysis;
      },
    };
    const requests: Array<{ url: string; body: unknown }> = [];
    const backend = {
      dispatchFetch: async (url: string, init?: RequestInit) => {
        requests.push({
          url,
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return Response.json({
          pushId: "push1",
          state: "analyzed",
          sourcePackage,
          analysis: { schema: analysis.schema, functions: { functions: [] } },
          codegenAnalysis: analysis,
          createdAt: 1,
          updatedAt: 1,
        });
      },
    } as unknown as Miniflare;

    const coordinator = new LocalBackendPushCoordinator(backend, "deployment1", analyzer);
    const status = await coordinator.start(sourcePackage);

    expect(status.codegenAnalysis).toEqual(analysis);
    expect(requests).toEqual([
      {
        url: "http://flarex.backend/deployments/deployment1/push/start",
        body: {
          sourcePackage,
          analysis: {
            schema: analysis.schema,
            functions: {
              functions: [
                {
                  path: "lessons:list",
                  kind: "query",
                  visibility: "public",
                  args: { type: "object", value: {} },
                  returns: null,
                },
              ],
            },
          },
        },
      },
    ]);
  });
});

function testSourcePackage(): SourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        source: "export default {};",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
      {
        path: "lessons.js",
        source: "export const list = {};",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    functions: ["lessons.js"],
    execution: "_flarex/execution.js",
  };
}

function testAnalysis(): DeploymentAnalysis {
  return {
    schema: { version: 1, tables: [], indexes: [] },
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
          },
        ],
      },
    ],
  };
}
