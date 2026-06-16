import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourcePackageLocally } from "../src/analyze";
import {
  ExecutionArtifactAnalysisError,
  LocalMiniflareExecutionArtifactAdapter,
} from "../src/executionArtifact";
import {
  bundleFlarexSourcePackage,
  finalCodegen,
  initialCodegen,
} from "../src/generate";

describe("execution artifact analysis", () => {
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
    await finalCodegen(context, artifact.analysis);
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
    `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: defineTable({
    name: v.string(),
    score: v.optional(v.number()),
  }).index("by_name", ["name"]).partitionBy("name"),
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
