import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourcePackageLocally } from "../src/analyze";
import {
  ExecutionArtifactAnalysisError,
  ExecutionArtifactResponseError,
  LocalMiniflareExecutionArtifactAdapter,
  LocalMiniflareExecutionArtifactRuntime,
  executionArtifactAnalysisErrorFromResponse,
} from "../src/executionArtifact";
import {
  bundleFlarexSourcePackage,
  finalCodegen,
  initialCodegen,
} from "../src/generate";

describe("execution artifact analysis", () => {
  it("projects response failures through the analysis-error owner", () => {
    const diagnostics = [{
      level: "error" as const,
      message: "Analysis failed.",
    }];
    const responseError = new ExecutionArtifactResponseError({
      operation: "analysis",
      status: 400,
      message: "Execution artifact analysis failed.",
      diagnostics,
      body: { error: "Execution artifact analysis failed." },
    });

    const first = executionArtifactAnalysisErrorFromResponse(responseError);
    const second = executionArtifactAnalysisErrorFromResponse(responseError);

    expect(first).toBeInstanceOf(ExecutionArtifactAnalysisError);
    expect(first).toMatchObject({
      name: "ExecutionArtifactAnalysisError",
      message: "Execution artifact analysis failed.",
    });
    expect(first.diagnostics).toBe(diagnostics);
    expect(second).not.toBe(first);
  });

  it("invokes execution artifacts through the internal invoke route", async () => {
    const calls: Array<{
      url: string;
      artifactId: string | null;
      sourcePackageHash: string | null;
      body: unknown;
    }> = [];
    const runtime = new LocalMiniflareExecutionArtifactRuntime({
      fetch: async request => {
        calls.push({
          url: request.url,
          artifactId: request.headers.get("x-flarex-artifact-id"),
          sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
          body: await request.json(),
        });
        return Response.json({ value: { ok: true } });
      },
    });

    await expect(
      runtime.invoke(
        {
          runtime: "dynamic-worker",
          artifactId: "artifact_1234567890abcdef1234567890abcdef",
          sourcePackageHash: "a".repeat(64),
          executionModule: "_flarex/execution.js",
        },
        {
          deploymentId: "deployment1",
          path: "users:get",
          partitionKey: "user:1",
          args: { id: "1:user" },
        },
      ),
    ).resolves.toEqual({ value: { ok: true } });

    expect(calls).toEqual([
      {
        url: "https://flarex-artifact.internal/__flarex_internal/invoke",
        artifactId: "artifact_1234567890abcdef1234567890abcdef",
        sourcePackageHash: "a".repeat(64),
        body: {
          deploymentId: "deployment1",
          path: "users:get",
          partitionKey: "user:1",
          args: { id: "1:user" },
        },
      },
    ]);
  });

  it("falls back to status text for non-JSON execution artifact invoke failures", async () => {
    const runtime = new LocalMiniflareExecutionArtifactRuntime({
      fetch: async () => new Response("failed", { status: 500 }),
    });

    await expect(runtime.invoke(
      {
        runtime: "dynamic-worker",
        artifactId: "artifact_1234567890abcdef1234567890abcdef",
        sourcePackageHash: "a".repeat(64),
        executionModule: "_flarex/execution.js",
      },
      {
        deploymentId: "deployment1",
        path: "users:get",
        args: {},
      },
    )).rejects.toThrow("Execution artifact invoke failed with status 500");
  });

  it("analyzes a source package inside a Miniflare execution artifact", async () => {
    const root = await createProject();
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);

    const direct = await analyzeSourcePackageLocally(sourcePackage);
    const artifact = await new LocalMiniflareExecutionArtifactAdapter()
      .analyzeWithDiagnostics(sourcePackage);

    expect(artifact.analysis).toEqual(direct);
    expect(artifact.diagnostics).toContainEqual({
      level: "log",
      message: "loading users module {\"scope\":\"test\"}",
    });
    const usersModule = artifact.analysis.functions.find(module => module.moduleName === "users");
    expect(usersModule?.functions.find(fn => fn.exportName === "get")?.position).toEqual({
      path: "users.ts",
      startLine: 7,
      startColumn: 1,
    });
    await finalCodegen(context, artifact.analysis);
  });

  it("classifies create-root model table partitions and finalizes client metadata", async () => {
    const root = await createCreateRootProject();
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);

    const direct = await analyzeSourcePackageLocally(sourcePackage);
    const artifact = await new LocalMiniflareExecutionArtifactAdapter().analyze(sourcePackage);

    expect(artifact).toEqual(direct);
    expect(
      artifact.functions
        .find(module => module.moduleName === "users")
        ?.functions.find(fn => fn.exportName === "create")
        ?.partition,
    ).toEqual({
      type: "partitionCreateRoot",
      table: "users",
      partitionField: "_id",
    });
    await expect(finalCodegen(context, artifact)).resolves.toBeUndefined();
  });

  it("rejects schema files without a default schema export", async () => {
    const root = await createSchemaWithoutDefaultProject();
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);

    await expect(new LocalMiniflareExecutionArtifactAdapter().analyzeWithDiagnostics(sourcePackage))
      .rejects.toThrow("Schema default export must be a Flarex schema definition.");
  });

  it("uses deterministic import-time Date and Math.random during analysis", async () => {
    const root = await createProject({
      topLevelSource: `
console.log("analysis globals", Date.now(), new Date().toISOString(), Math.random(), Math.random());
`,
    });
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);
    const adapter = new LocalMiniflareExecutionArtifactAdapter();

    const first = await adapter.analyzeWithDiagnostics(sourcePackage);
    const second = await adapter.analyzeWithDiagnostics(sourcePackage);
    const firstGlobalLog = findDiagnostic(first.diagnostics, "analysis globals ");
    const secondGlobalLog = findDiagnostic(second.diagnostics, "analysis globals ");

    expect(firstGlobalLog).toBe(secondGlobalLog);
    expect(firstGlobalLog).toContain("1700000000000");
    expect(firstGlobalLog).toContain("2023-11-14T22:13:20.000Z");
  });

  it.each([
    {
      name: "fetch",
      topLevelSource: `fetch("https://example.com");`,
      message: "fetch is not supported during Flarex analysis import.",
    },
    {
      name: "crypto.randomUUID",
      topLevelSource: `crypto.randomUUID();`,
      message: "crypto.randomUUID is not supported during Flarex analysis import.",
    },
    {
      name: "crypto.getRandomValues",
      topLevelSource: `crypto.getRandomValues(new Uint8Array(1));`,
      message: "crypto.getRandomValues is not supported during Flarex analysis import.",
    },
    {
      name: "performance.now",
      topLevelSource: `performance.now();`,
      message: "performance.now is not supported during Flarex analysis import.",
    },
  ])("rejects import-time $name during analysis", async ({ topLevelSource, message }) => {
    const root = await createProject({ topLevelSource });
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);

    try {
      await new LocalMiniflareExecutionArtifactAdapter().analyzeWithDiagnostics(sourcePackage);
      throw new Error("Expected analysis to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionArtifactAnalysisError);
      expect((error as ExecutionArtifactAnalysisError).message).toBe(message);
      expect((error as ExecutionArtifactAnalysisError).diagnostics).toContainEqual({
        level: "error",
        message,
      });
    }
  });
});

function findDiagnostic(
  diagnostics: Array<{ level: string; message: string }>,
  prefix: string,
): string {
  const diagnostic = diagnostics.find(entry => entry.message.startsWith(prefix));
  if (diagnostic === undefined) {
    throw new Error(`Missing diagnostic with prefix ${prefix}.`);
  }
  return diagnostic.message;
}

async function createProject(options: { topLevelSource?: string } = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-execution-artifact-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: definePartitionTable({
    name: v.string(),
    score: v.optional(v.number()),
  }).index("by_name", ["name"]),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/users.ts"),
    `import { mutation, query } from "../_generated/server";
import { v } from "flarex/values";

console.log("loading users module", { scope: "test" });
${options.topLevelSource ?? ""}

export const get = query({
  args: { id: v.id("users") },
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async () => null,
});

export const updateScore = mutation({
  args: { id: v.id("users"), score: v.number() },
  returns: v.null(),
  handler: async () => null,
});
`,
  );
  return root;
}

async function createCreateRootProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-create-root-artifact-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: definePartitionTable({
    name: v.string(),
  }),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/users.ts"),
    `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  partition: model.users,
  args: { name: v.string() },
  handler: async () => null,
});
`,
  );
  return root;
}

async function createSchemaWithoutDefaultProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-missing-schema-default-artifact-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { definePartitionTable } from "flarex/server";
import { v } from "flarex/values";
export const users = definePartitionTable({
  name: v.string(),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/users.ts"),
    `import { query } from "../_generated/server";

export const get = query({
  handler: async () => null,
});
`,
  );
  return root;
}
