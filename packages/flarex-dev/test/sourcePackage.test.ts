import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourcePackageLocally } from "../src/analyze";
import {
  bundleFlarexSourcePackage,
  finalCodegen,
  initialCodegen,
} from "../src/generate";

describe("Flarex source packages", () => {
  it("bundles deterministic isolate modules and analyzes the execution entry", async () => {
    const firstRoot = await createProject();
    const secondRoot = await createProject();
    const firstContext = await initialCodegen({ root: firstRoot });
    const secondContext = await initialCodegen({ root: secondRoot });

    const first = await bundleFlarexSourcePackage(firstContext);
    const second = await bundleFlarexSourcePackage(secondContext);

    expect(first).toEqual(second);
    expect(first.modules.map(module => module.path)).toEqual([
      "_flarex/execution.js",
      "_flarex/schema.js",
      "lessons.js",
      "users.js",
    ]);
    expect(first.functions).toEqual(["lessons.js", "users.js"]);
    expect(first.schema).toBe("_flarex/schema.js");
    expect(first.execution).toBe("_flarex/execution.js");
    for (const module of first.modules) {
      expect(module.environment).toBe("isolate");
      expect(module.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(module.sourceMap).toBeDefined();
      expect(module.sourceMap).not.toContain(firstRoot.replaceAll("\\", "/"));
      expect(module.sourceMap).not.toContain(secondRoot.replaceAll("\\", "/"));
    }

    const analysis = await analyzeSourcePackageLocally(first);
    expect(analysis.functions.map(module => module.moduleName)).toEqual(["lessons", "users"]);
    expect(analysis.functions[0]?.functions[0]).toMatchObject({
      exportName: "list",
      kind: "query",
      visibility: "public",
    });
    expect(analysis.schema).toEqual({
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          validator: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          placement: { kind: "partitionBy", field: "name" },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 1,
          name: "by_name",
          fields: ["name"],
        },
      ],
    });

    await finalCodegen(firstContext, analysis);
  });

  it("keeps final schema codegen independent from filesystem changes after analysis", async () => {
    const root = await createProject();
    const context = await initialCodegen({ root });
    const package_ = await bundleFlarexSourcePackage(context);
    const analysis = await analyzeSourcePackageLocally(package_);

    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({ spoofed: defineTable({ value: v.number() }).global() });
`,
    );
    await finalCodegen(context, analysis);

    const generated = await readFile(
      path.join(root, "flarex/_generated/deploymentSchema.ts"),
      "utf8",
    );
    const worker = await readFile(path.join(root, "flarex/_generated/worker.ts"), "utf8");
    expect(generated).toContain('"name": "users"');
    expect(generated).not.toContain("spoofed");
    expect(generated).not.toContain('from "../schema"');
    expect(worker).not.toContain('from "../schema"');
    expect(worker).toContain("deploymentSchema.tables");
  });

  it("ignores unrelated generated files but changes hashes when source changes", async () => {
    const root = await createProject();
    const context = await initialCodegen({ root });
    const first = await bundleFlarexSourcePackage(context);

    await writeFile(path.join(root, "flarex/_generated/unrelated.ts"), "export const ignored = true;\n");
    const unchanged = await bundleFlarexSourcePackage(context);
    expect(unchanged).toEqual(first);

    await writeFile(
      path.join(root, "flarex/functions/users.ts"),
      `import { query } from "../_generated/server";
export const get = query({ args: {}, handler: async () => "changed" });
`,
    );
    const changed = await bundleFlarexSourcePackage(context);
    expect(hashFor(changed, "users.js")).not.toBe(hashFor(first, "users.js"));
    expect(hashFor(changed, "_flarex/execution.js")).not.toBe(
      hashFor(first, "_flarex/execution.js"),
    );
    expect(hashFor(changed, "lessons.js")).toBe(hashFor(first, "lessons.js"));
    expect(hashFor(changed, "_flarex/schema.js")).toBe(hashFor(first, "_flarex/schema.js"));
  });
});

function hashFor(package_: Awaited<ReturnType<typeof bundleFlarexSourcePackage>>, modulePath: string) {
  return package_.modules.find(module => module.path === modulePath)?.sha256;
}

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-source-package-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: defineTable({ name: v.string() }).index("by_name", ["name"]).partitionBy("name"),
});
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/lessons.ts"),
    `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
  );
  await writeFile(
    path.join(root, "flarex/functions/users.ts"),
    `import { query } from "../_generated/server";
export const get = query({ args: {}, handler: async () => null });
`,
  );
  return root;
}
