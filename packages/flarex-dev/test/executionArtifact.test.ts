import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourcePackageLocally } from "../src/analyze";
import { LocalMiniflareExecutionArtifactAdapter } from "../src/executionArtifact";
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
    const artifact = await new LocalMiniflareExecutionArtifactAdapter().analyze(sourcePackage);

    expect(artifact).toEqual(direct);
    await finalCodegen(context, artifact);
  });
});

async function createProject(): Promise<string> {
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
