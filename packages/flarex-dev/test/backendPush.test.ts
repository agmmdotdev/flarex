import type { Miniflare } from "miniflare";
import { describe, expect, it } from "vitest";
import type { DeploymentAnalysis } from "../src/analyze";
import {
  createLocalAnalyzerService,
  LocalBackendPushCoordinator,
  LocalExecutionArtifactBackendAnalyzer,
  type BackendSourceAnalyzer,
} from "../src/backendPush";
import {
  ExecutionArtifactAnalysisError,
  type ExecutionArtifactAdapter,
} from "../src/executionArtifact";
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
        return {
          analysis,
          diagnostics: [{ level: "log", message: "loaded lessons.js" }],
        };
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
              route: null,
              position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
            },
          ],
        },
      },
      diagnostics: [{ level: "log", message: "loaded lessons.js" }],
    });
  });

  it("serves analyzer failure diagnostics through the local analyzer service binding", async () => {
    const analyzer: BackendSourceAnalyzer = {
      analyze: async () => {
        throw new ExecutionArtifactAnalysisError("analysis failed", [
          { level: "error", message: "import failed" },
        ]);
      },
    };

    const response = await createLocalAnalyzerService(analyzer)(
      new Request("http://flarex-analyzer.internal/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId: "deployment1", sourcePackage: testSourcePackage() }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "import failed" }],
    });
  });

  it("runs local execution artifact analysis twice before returning metadata", async () => {
    const sourcePackage = testSourcePackage();
    const analysis = testAnalysis();
    const calls: SourcePackage[] = [];
    const executionArtifact: ExecutionArtifactAdapter = {
      analyze: async () => analysis,
      analyzeWithDiagnostics: async package_ => {
        calls.push(package_);
        return {
          analysis,
          diagnostics: [{ level: "log", message: `analysis run ${calls.length}` }],
        };
      },
    };

    const result = await new LocalExecutionArtifactBackendAnalyzer(executionArtifact)
      .analyze(sourcePackage);

    expect(calls).toEqual([sourcePackage, sourcePackage]);
    expect(result).toEqual({
      analysis,
      diagnostics: [
        { level: "log", message: "analysis run 1" },
        { level: "log", message: "analysis run 2" },
      ],
    });
  });

  it("rejects nondeterministic local execution artifact analysis", async () => {
    const sourcePackage = testSourcePackage();
    const analyses = [testAnalysis(), nondeterministicAnalysis()];
    const executionArtifact: ExecutionArtifactAdapter = {
      analyze: async () => analyses[0]!,
      analyzeWithDiagnostics: async () => ({
        analysis: analyses.shift()!,
        diagnostics: [{ level: "warn", message: `remaining analyses ${analyses.length}` }],
      }),
    };

    await expect(
      new LocalExecutionArtifactBackendAnalyzer(executionArtifact).analyze(sourcePackage),
    ).rejects.toMatchObject({
      message: "Flarex analysis is nondeterministic across cold isolates.",
      diagnostics: [
        { level: "warn", message: "remaining analyses 1" },
        { level: "warn", message: "remaining analyses 0" },
        {
          level: "error",
          message: "Flarex analysis is nondeterministic across cold isolates.",
        },
      ],
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
            position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
          },
        ],
      },
    ],
  };
}

function nondeterministicAnalysis(): DeploymentAnalysis {
  return {
    ...testAnalysis(),
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "internal",
            args: { type: "object", value: {} },
            returns: null,
            position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
          },
        ],
      },
    ],
  };
}
