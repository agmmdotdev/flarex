import type { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import type { DeploymentAnalysis } from "../src/analyze";
import {
  createLocalAnalyzerService,
  LocalBackendPushCoordinator,
  type BackendSourceAnalyzer,
} from "../src/backendPush";
import type { SourcePackage } from "../src/sourcePackage";

describe("backend push coordinator", () => {
  it("starts public backend push with only the source package", async () => {
    const sourcePackage = testSourcePackage();
    const analysis = testAnalysis();
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

    const coordinator = new LocalBackendPushCoordinator(backend, "deployment1");
    const status = await coordinator.start(sourcePackage);

    expect(status.codegenAnalysis).toEqual(analysis);
    expect(requests).toEqual([
      {
        url: "http://flarex.backend/deployments/deployment1/push/start",
        body: { sourcePackage },
      },
    ]);
  });

  it("serves backend analysis through the local analyzer service binding", async () => {
    const sourcePackage = testSourcePackage();
    const analysis = testAnalysis();
    const analyzer: BackendSourceAnalyzer = {
      analyze: async package_ => {
        expect(package_).toEqual(sourcePackage);
        return analysis;
      },
    };

    const response = await createLocalAnalyzerService(analyzer)(
      new Request("http://flarex-analyzer.internal/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId: "deployment1", sourcePackage }),
      }),
    );

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
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
    });
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
