import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateFlarex } from "../src/generate";

describe("generateFlarex", () => {
  it("analyzes actual registered exports and generates shared runtime metadata", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, mutation, query } from "../_generated/server";
import { v } from "flarex/values";
const listImpl = query({
  args: { topic: v.string() },
  returns: v.array(v.string()),
  handler: async () => [],
});
Object.assign(listImpl, {
  kind: "mutation",
  visibility: "internal",
  args: { spoofed: v.number() },
  returns: v.number(),
});
export { listImpl as list };
export const send = mutation({ args: {}, handler: async () => null });
export const hidden = internalQuery({ args: {}, handler: async () => null });
export const helper = "not a function";
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/reexports.ts"),
      `export { send as aliasedSend } from "./messages";\n`,
    );
    await writeFile(
      path.join(root, "flarex/functions/messages.test.ts"),
      `export { send as shouldNotDeploy } from "./messages";\n`,
    );
    await writeFile(path.join(root, "flarex/functions/empty.ts"), "const empty = true;\n");
    await mkdir(path.join(root, "flarex/functions/_generated"), { recursive: true });
    await writeFile(
      path.join(root, "flarex/functions/_generated/ignored.ts"),
      `export { send as shouldNotDeploy } from "../messages";\n`,
    );

    await generateFlarex({ root });

    const api = await readGenerated(root, "api.ts");
    const dataModel = await readGenerated(root, "dataModel.ts");
    const server = await readGenerated(root, "server.ts");
    const registry = await readGenerated(root, "functionRegistry.ts");
    const functionMetadata = await readGenerated(root, "functionMetadata.ts");
    const deploymentSchema = await readGenerated(root, "deploymentSchema.ts");
    const worker = await readGenerated(root, "worker.ts");

    expect(api).toContain('import type * as module0 from "../functions/messages"');
    expect(api).toContain('import type * as module1 from "../functions/reexports"');
    expect(dataModel).toContain("DataModelFromSchemaDefinition<typeof schema>");
    expect(server).toContain('QueryBuilder<DataModel, "public">');
    expect(registry).toContain('"messages:list": module0.list');
    expect(registry).toContain('"messages:send": module0.send');
    expect(registry).toContain('"messages:hidden": module0.hidden');
    expect(registry).toContain('"reexports:aliasedSend": module1.aliasedSend');
    expect(registry).not.toContain("helper");
    expect(registry).not.toContain("shouldNotDeploy");
    expect(api).not.toContain("messages.test");
    expect(api).not.toContain("_generated/ignored");
    expect(api).not.toContain("empty");
    expect(functionMetadata).not.toContain("functionRegistry");
    expect(functionMetadata).toContain('"path": "messages:list"');
    expect(functionMetadata).toContain('"kind": "query"');
    expect(functionMetadata).toContain('"visibility": "public"');
    expect(functionMetadata).toContain('"topic"');
    expect(functionMetadata).toContain('"type": "array"');
    expect(functionMetadata).not.toContain("spoofed");
    expect(deploymentSchema).toContain("export const deploymentSchema");
    expect(worker).toContain('import { functions } from "./functionRegistry"');
    expect(worker).toContain("functionMetadataByPath");
    expect(worker).toContain("fn._handler");
    expect(worker).not.toContain("fn.handler");
    expect(worker).not.toContain("validateFunctionArgs(fn.args");
    expect(worker).toContain('url.pathname === "/invoke"');
    expect(worker).toContain('url.pathname === "/__flarex_internal/invoke"');
    await expect(fileExists(path.join(root, "wrangler.generated.jsonc"))).resolves.toBe(false);
  });

  it("removes stale generated files after final codegen", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export default query({ args: {}, handler: async () => null });
`,
    );
    const stale = path.join(root, "flarex/_generated/stale.ts");
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, "stale");

    await generateFlarex({ root });

    const registry = await readGenerated(root, "functionRegistry.ts");
    expect(registry).toContain('"messages": module0.default');
    await expect(fileExists(stale)).resolves.toBe(false);
  });
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "flarex-"));
  await mkdir(path.join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    path.join(root, "flarex/schema.ts"),
    `import { defineSchema } from "flarex/server";\nexport default defineSchema({});\n`,
  );
  return root;
}

function readGenerated(root: string, file: string): Promise<string> {
  return readFile(path.join(root, "flarex/_generated", file), "utf8");
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    },
  );
}
