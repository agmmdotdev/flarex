import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import {
  bundleFlarexSourcePackage,
  analyzeFlarexSourcePackage,
  type BackendPushCoordinator,
  type BackendSourceAnalyzer,
  type DeploymentAnalysis,
  deployFlarex,
  dryRunFlarexCodegen,
  finalCodegen,
  finalGeneratedFiles,
  generateFlarex,
  initialCodegen,
  LocalMiniflareExecutionArtifactAdapter,
  staleGeneratedEntries,
} from "../src/index";
import { typecheckGeneratedOutput } from "../src/generatedTypecheck";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("generateFlarex", () => {
  it("plans final generated output before writing final-only files", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );

    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);
    const analysis = await new LocalMiniflareExecutionArtifactAdapter().analyze(sourcePackage);
    const files = finalGeneratedFiles(analysis);

    expect(files.map(file => file.name).sort()).toEqual([
      "api.ts",
      "dataModel.ts",
      "deploymentSchema.ts",
      "functionMetadata.ts",
      "functionRegistry.ts",
      "server.ts",
      "worker.ts",
    ]);
    expect(files.find(file => file.name === "functionRegistry.ts")?.contents)
      .toContain('"messages:list"');
    await expect(fileExists(path.join(root, "flarex/_generated/functionRegistry.ts")))
      .resolves.toBe(false);

    await finalCodegen(context, analysis);
    await expect(readGenerated(root, "functionRegistry.ts"))
      .resolves.toContain('"messages:list"');
  });

  it("plans stale generated entries without deleting them", async () => {
    const root = await createProject();
    const generatedDir = path.join(root, "flarex/_generated");
    await mkdir(path.join(generatedDir, "ai"), { recursive: true });
    await mkdir(path.join(generatedDir, "staleDir"), { recursive: true });
    await writeFile(path.join(generatedDir, "ai/index.d.ts"), "preserve");
    await writeFile(path.join(generatedDir, "api.ts"), "keep");
    await writeFile(path.join(generatedDir, "stale.ts"), "remove");
    await writeFile(path.join(generatedDir, "staleDir/nested.ts"), "remove");

    const entries = await staleGeneratedEntries(generatedDir, ["api.ts"]);

    expect(
      entries
        .map(entry => ({ name: entry.name, kind: entry.kind }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    ).toEqual([
      { name: "stale.ts", kind: "file" },
      { name: "staleDir", kind: "directory" },
    ]);
    await expect(fileExists(path.join(generatedDir, "stale.ts"))).resolves.toBe(true);
    await expect(fileExists(path.join(generatedDir, "staleDir/nested.ts"))).resolves.toBe(true);
    await expect(fileExists(path.join(generatedDir, "ai/index.d.ts"))).resolves.toBe(true);

    await generateFlarex({ root });

    await expect(fileExists(path.join(generatedDir, "stale.ts"))).resolves.toBe(false);
    await expect(fileExists(path.join(generatedDir, "staleDir"))).resolves.toBe(false);
    await expect(fileExists(path.join(generatedDir, "ai/index.d.ts"))).resolves.toBe(true);
  });

  it("dry-runs final generated writes and stale deletes without mutating the project", async () => {
    const root = await createProject();
    const generatedDir = path.join(root, "flarex/_generated");
    await mkdir(path.join(generatedDir, "ai"), { recursive: true });
    await writeFile(path.join(generatedDir, "ai/index.d.ts"), "preserve");
    await writeFile(path.join(generatedDir, "stale.ts"), "remove");

    const report = await dryRunFlarexCodegen({ root });

    expect(report.writes.map(write => write.name).sort()).toEqual([
      "api.ts",
      "dataModel.ts",
      "deploymentSchema.ts",
      "functionMetadata.ts",
      "functionRegistry.ts",
      "server.ts",
      "worker.ts",
    ]);
    expect(report.deletes.map(entry => entry.name)).toEqual(["stale.ts"]);
    await expect(fileExists(path.join(generatedDir, "server.ts"))).resolves.toBe(false);
    await expect(fileExists(path.join(generatedDir, "stale.ts"))).resolves.toBe(true);
    await expect(fileExists(path.join(generatedDir, "ai/index.d.ts"))).resolves.toBe(true);
  });

  it("omits unchanged generated files from dry-run writes", async () => {
    const root = await createProject();
    await generateFlarex({ root });
    await writeFile(path.join(root, "flarex/_generated/stale.ts"), "remove");

    const report = await dryRunFlarexCodegen({ root });

    expect(report.writes).toEqual([]);
    expect(report.deletes.map(entry => entry.name)).toEqual(["stale.ts"]);
    await expect(fileExists(path.join(root, "flarex/_generated/stale.ts"))).resolves.toBe(true);
  });

  it("dry-runs codegen for a project without an app directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "flarex-dry-run-missing-app-"));
    try {
      const report = await dryRunFlarexCodegen({ root });

      expect(report.writes.map(write => write.name).sort()).toEqual([
        "api.ts",
        "dataModel.ts",
        "deploymentSchema.ts",
        "functionMetadata.ts",
        "functionRegistry.ts",
        "server.ts",
        "worker.ts",
      ]);
      expect(report.deletes).toEqual([]);
      await expect(fileExists(path.join(root, "flarex"))).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses injected backend source analysis for final codegen", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const calls: string[][] = [];
    const sourceAnalyzer: BackendSourceAnalyzer = {
      analyze: async sourcePackage => {
        calls.push(sourcePackage.functions);
        return { analysis: backendCodegenAnalysis("mutation") };
      },
    };

    await generateFlarex({ root, sourceAnalyzer });

    expect(calls).toEqual([["messages.js"]]);
    await expect(readGenerated(root, "functionMetadata.ts"))
      .resolves.toContain('"kind": "mutation"');
  });

  it("keeps explicit undefined source analyzer compatibility", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const context = await initialCodegen({ root });
    const sourcePackage = await bundleFlarexSourcePackage(context);

    const analysis = await analyzeFlarexSourcePackage(sourcePackage, undefined);

    expect(analysis.functions).toEqual([
      {
        moduleName: "messages",
        functions: [expect.objectContaining({
          moduleName: "messages",
          exportName: "list",
          kind: "query",
        })],
      },
    ]);
  });

  it("uses backend push codegen analysis for final codegen", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const pushedPackages: string[][] = [];
    const pushCoordinator: BackendPushCoordinator = {
      start: async sourcePackage => {
        pushedPackages.push(sourcePackage.functions);
        return {
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: backendCodegenAnalysis("workflowMutation"),
        };
      },
      finish: async () => {
        throw new Error("codegen should not activate pushes");
      },
    };

    await generateFlarex({ root, pushCoordinator });

    expect(pushedPackages).toEqual([["messages.js"]]);
    await expect(readGenerated(root, "functionMetadata.ts"))
      .resolves.toContain('"kind": "workflowMutation"');
  });

  it("deploys by generating from backend push analysis before finishing", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const events: string[] = [];
    const pushCoordinator: BackendPushCoordinator = {
      start: async sourcePackage => {
        events.push(`start:${sourcePackage.functions.join(",")}`);
        return {
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: backendCodegenAnalysis("workflowMutation"),
        };
      },
      finish: async pushId => {
        events.push(`finish:${pushId}`);
        return { pushId, state: "activated" };
      },
    };

    const result = await deployFlarex({
      root,
      pushCoordinator,
      beforeFinish: async started => {
        events.push(`beforeFinish:${started.pushId}`);
        await expect(readGenerated(root, "functionMetadata.ts"))
          .resolves.toContain('"kind": "workflowMutation"');
      },
    });

    expect(result).toEqual({
      started: {
        pushId: "push1",
        state: "analyzed",
        codegenAnalysis: backendCodegenAnalysis("workflowMutation"),
      },
      finished: { pushId: "push1", state: "activated" },
    });
    expect(events).toEqual([
      "start:messages.js",
      "beforeFinish:push1",
      "finish:push1",
    ]);
  });

  it("does not finish deploy pushes when validation fails after codegen", async () => {
    const root = await createProject();
    const events: string[] = [];
    const pushCoordinator: BackendPushCoordinator = {
      start: async () => {
        events.push("start");
        return {
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: backendCodegenAnalysis("query"),
        };
      },
      finish: async () => {
        events.push("finish");
        return { pushId: "push1", state: "activated" };
      },
      abandon: async (pushId, request) => {
        events.push(`abandon:${pushId}:${request?.reason ?? ""}`);
        return {
          pushId,
          state: "abandoned",
          ...(request?.reason === undefined ? {} : { error: request.reason }),
        };
      },
    };

    await expect(deployFlarex({
      root,
      pushCoordinator,
      beforeFinish: async () => {
        events.push("beforeFinish");
        throw new Error("validation failed");
      },
    })).rejects.toThrow("validation failed");

    expect(events).toEqual([
      "start",
      "beforeFinish",
      "abandon:push1:Generated output validation failed before activation: validation failed",
    ]);
    await expect(readGenerated(root, "functionMetadata.ts"))
      .resolves.toContain('"path": "messages:list"');
  });

  it("preserves deploy validation errors when abandon cleanup fails", async () => {
    const root = await createProject();
    const events: string[] = [];
    const pushCoordinator: BackendPushCoordinator = {
      start: async () => {
        events.push("start");
        return {
          pushId: "push1",
          state: "analyzed",
          codegenAnalysis: backendCodegenAnalysis("query"),
        };
      },
      finish: async () => {
        events.push("finish");
        return { pushId: "push1", state: "activated" };
      },
      abandon: async () => {
        events.push("abandon");
        throw new Error("abandon failed");
      },
    };

    await expect(deployFlarex({
      root,
      pushCoordinator,
      beforeFinish: async () => {
        events.push("beforeFinish");
        throw new Error("validation failed");
      },
    })).rejects.toThrow("validation failed");

    expect(events).toEqual(["start", "beforeFinish", "abandon"]);
  });

  it("rejects deploy pushes that fail to activate", async () => {
    const root = await createProject();
    const pushCoordinator: BackendPushCoordinator = {
      start: async () => ({
        pushId: "push1",
        state: "analyzed",
        codegenAnalysis: backendCodegenAnalysis("query"),
      }),
      finish: async () => ({ pushId: "push1", state: "failed", error: "activation failed" }),
    };

    await expect(deployFlarex({ root, pushCoordinator })).rejects.toThrow(
      "Flarex push push1 did not activate: failed.",
    );
  });

  it("requires backend push codegen analysis before writing final generated files", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const pushCoordinator: BackendPushCoordinator = {
      start: async () => ({ pushId: "push1", state: "analyzed" }),
      finish: async () => {
        throw new Error("codegen should not activate pushes");
      },
    };

    await expect(generateFlarex({ root, pushCoordinator })).rejects.toThrow(
      "Flarex push push1 did not return codegen analysis.",
    );
    await expect(fileExists(path.join(root, "flarex/_generated/functionMetadata.ts")))
      .resolves.toBe(false);
  });

  it("uses injected backend source analysis for dry-run codegen", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const sourceAnalyzer: BackendSourceAnalyzer = {
      analyze: async () => ({ analysis: backendCodegenAnalysis("action") }),
    };

    const report = await dryRunFlarexCodegen({ root, sourceAnalyzer });
    const metadataWrite = report.writes.find(write => write.name === "functionMetadata.ts");

    expect(metadataWrite?.contents).toContain('"kind": "action"');
    await expect(fileExists(path.join(root, "flarex/_generated/functionMetadata.ts")))
      .resolves.toBe(false);
  });

  it("uses backend push codegen analysis for dry-run codegen", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    const pushCoordinator: BackendPushCoordinator = {
      start: async () => ({
        pushId: "push1",
        state: "analyzed",
        codegenAnalysis: backendCodegenAnalysis("action"),
      }),
      finish: async () => {
        throw new Error("dry-run codegen should not activate pushes");
      },
    };

    const report = await dryRunFlarexCodegen({ root, pushCoordinator });
    const metadataWrite = report.writes.find(write => write.name === "functionMetadata.ts");

    expect(metadataWrite?.contents).toContain('"kind": "action"');
    await expect(fileExists(path.join(root, "flarex/_generated/functionMetadata.ts")))
      .resolves.toBe(false);
  });

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
    expect(api).toContain("const fullApi = createApi({");
    expect(api).toContain("export const api = justPublic(fullApi);");
    expect(api).toContain("export const internal = justInternal(fullApi);");
    expect(api).toContain('createApi({})');
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
    expect(worker).toContain("FLAREX_PROJECT_ID");
    expect(worker).toContain("FLAREX_EXECUTOR_TRANSPORT");
    expect(worker).toContain("FLAREX_EXECUTOR_TOKEN");
    expect(worker).toContain('"/invoke/start"');
    expect(worker).toContain('"/invoke/syscall"');
    expect(worker).toContain('"/invoke/finish"');
    expect(worker).toContain('"/invoke/abort"');
    expect(worker).toContain("x-flarex-project");
    await expect(fileExists(path.join(root, "wrangler.generated.jsonc"))).resolves.toBe(false);
  });

  it("typechecks generated output", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, query } from "../_generated/server";
import type { FunctionReference } from "flarex/server";

const helperRef: FunctionReference<"query", "internal", {}, string> = {
  _path: "messages:helper",
};

export const helper = internalQuery({
  args: {},
  handler: async () => "nested ok",
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(helperRef);
  },
});
`,
    );

    await generateFlarex({ root });

    await expect(typecheckGeneratedOutput({
      root,
      typescriptCliPath: "node_modules/typescript/bin/tsc",
      cwd: workspaceRoot,
      compilerOptions: {
        paths: {
          flarex: ["packages/flarex/src/index.ts"],
          "flarex/*": ["packages/flarex/src/*"],
        },
      },
    })).resolves.toBeUndefined();
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

  it("generates model partition selectors from schema placement", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineColocatedTable, defineGlobalTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  users: definePartitionTable({
    name: v.string(),
  }),
  teamMembers: defineColocatedTable("users", "userId", {
    userId: v.id("users"),
    role: v.string(),
  }),
  auditLog: defineGlobalTable({
    message: v.string(),
  }),
});
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/users.ts"),
      `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  args: { userId: v.id("users"), role: v.string() },
  partition: model.users,
  handler: async () => null,
});
`,
    );

    await generateFlarex({ root });

    const server = await readGenerated(root, "server.ts");
    const api = await readGenerated(root, "api.ts");
    const functionMetadata = await readGenerated(root, "functionMetadata.ts");

    expect(server).toContain("export const model = {");
    expect(server).toContain("users: {");
    expect(server).toContain('type: "partitionRoot"');
    expect(server).toContain('table: "users"');
    expect(server).toContain('selector: "byId"');
    expect(server).toContain('partitionField: "_id"');
    expect(server).not.toContain("bySlug");
    expect(server).toContain("export type PartitionScopes = {");
    expect(server).toContain('users: "teamMembers" | "users";');
    expect(server).not.toContain('auditLog: "auditLog";');
    expect(server).toContain('MutationBuilder<DataModel, "public", "mutation", PartitionScopes>');
    expect(functionMetadata).toContain('"path": "users:create"');
    expect(functionMetadata).toContain('"partition": {');
    expect(functionMetadata).toContain('"table": "users"');
    expect(functionMetadata).toContain('"selector": "byId"');
    expect(functionMetadata).toContain('"partitionField": "_id"');
    expect(functionMetadata).toContain('"argField": "userId"');
    expect(api).toContain('"users:create": {');
    expect(api).toContain('"partition": {');
    expect(api).toContain('"table": "users"');
    expect(api).toContain('"selector": "byId"');
    expect(api).toContain('"partitionField": "_id"');
    expect(api).toContain('"argField": "userId"');
  });

  it("lowers model table root partitions from exactly one root id argument", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  users: definePartitionTable({
    name: v.string(),
  }),
  lessonProgress: defineColocatedTable("users", "userId", {
    userId: v.id("users"),
    lessonId: v.string(),
  }),
});
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/users.ts"),
      `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const rename = mutation({
  args: { userId: v.id("users"), name: v.string() },
  partition: model.users,
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { name: args.name });
    await ctx.db.insert("lessonProgress", { userId: args.userId, lessonId: "intro" });
  },
});
`,
    );

    await generateFlarex({ root });

    const api = await readGenerated(root, "api.ts");
    const functionMetadata = await readGenerated(root, "functionMetadata.ts");

    expect(functionMetadata).toContain('"path": "users:rename"');
    expect(functionMetadata).toContain('"partition": {');
    expect(functionMetadata).toContain('"table": "users"');
    expect(functionMetadata).toContain('"selector": "byId"');
    expect(functionMetadata).toContain('"partitionField": "_id"');
    expect(functionMetadata).toContain('"argField": "userId"');
    expect(api).toContain('"users:rename": {');
    expect(api).toContain('"partition": {');
    expect(api).toContain('"selector": "byId"');
    expect(api).toContain('"argField": "userId"');
  });

  it("rejects model table root partitions when the root id is ambiguous", async () => {
    const root = await createProject();
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

export const merge = mutation({
  args: { fromUserId: v.id("users"), toUserId: v.id("users") },
  partition: model.users,
  handler: async () => null,
});
`,
    );

    await expect(generateFlarex({ root })).rejects.toThrow(
      "users:merge.partition: model.users is ambiguous. Found multiple required users IDs: fromUserId, toUserId.",
    );
  });

  it("generates create-root model table partitions for backend execution sessions", async () => {
    const root = await createProject();
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
  args: { name: v.string() },
  partition: model.users,
  handler: async (ctx, args) => {
    return await ctx.db.insert("users", { name: args.name });
  },
});
`,
    );

    await generateFlarex({ root });

    const api = await readGenerated(root, "api.ts");
    const functionMetadata = await readGenerated(root, "functionMetadata.ts");
    const worker = await readGenerated(root, "worker.ts");

    expect(functionMetadata).toContain('"path": "users:create"');
    expect(functionMetadata).toContain('"partition": {');
    expect(functionMetadata).toContain('"type": "partitionCreateRoot"');
    expect(functionMetadata).toContain('"table": "users"');
    expect(api).toContain('"users:create": {');
    expect(api).toContain('"type": "partitionCreateRoot"');
    expect(worker).toContain('...(input.partitionKey === undefined ? {} : { partitionKey: input.partitionKey })');
    expect(worker).toContain('await syscall({ op: "replace", id, value });');
    expect(worker).not.toContain("A partitionKey or x-flarex-partition header is required.");
  });

  it("rejects model partition selectors that do not match schema placement", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  teams: definePartitionTable({
    slug: v.string(),
    name: v.string(),
  }),
});
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/teams.ts"),
      `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  partition: {
    type: "partition",
    table: "teams",
    selector: "bySlug",
    partitionField: "slug",
    argField: "teamId",
  },
  handler: async () => null,
});
`,
    );

    await expect(generateFlarex({ root })).rejects.toThrow(
      "teams:create.partition: Selector bySlug targets slug, but teams is partitioned by _id.",
    );
  });

  it("guards generated internal routes when an internal token is configured", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
`,
    );
    await generateFlarex({ root });
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: { FLAREX_INTERNAL_TOKEN: "internal-secret" },
      serviceBindings: {
        FLAREX_BACKEND: async () => Response.json({}),
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const missing = await worker.dispatchFetch("http://flarex.test/__flarex_internal/metadata");
      expect(missing.status).toBe(401);
      await expect(missing.json()).resolves.toEqual({
        error: "Unauthorized internal Flarex request.",
      });

      const wrong = await worker.dispatchFetch("http://flarex.test/__flarex_internal/metadata", {
        headers: { authorization: "Bearer wrong" },
      });
      expect(wrong.status).toBe(401);

      const authorized = await worker.dispatchFetch("http://flarex.test/__flarex_internal/metadata", {
        headers: { authorization: "Bearer internal-secret" },
      });
      expect(authorized.ok).toBe(true);
      await expect(authorized.json()).resolves.toMatchObject({
        schema: { version: 1 },
        functions: [expect.objectContaining({ path: "messages:list" })],
      });
    } finally {
      await worker.dispose();
    }
  });

  it("derives Postgres invoke visibility from public and internal routes", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => "public" });
export const hidden = internalQuery({ args: {}, handler: async () => "secret" });
`,
    );
    await generateFlarex({ root });

    const backendCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: {
        FLAREX_DEPLOYMENT_ID: "deployment-generated-visibility",
        FLAREX_EXECUTOR_TRANSPORT: "postgres",
        FLAREX_PROJECT_ID: "project-generated-visibility",
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => {
          const url = new URL(request.url);
          const body = await request.json().catch(() => null);
          const record = jsonRecord(body, url.pathname);
          backendCalls.push({ path: url.pathname, body: record });
          if (url.pathname === "/invoke/start") {
            if (record.path === "messages:hidden" && record.visibility === "public") {
              return Response.json(
                {
                  error: "FunctionVisibilityMismatchError",
                  message: "Function visibility mismatch.",
                },
                { status: 400 },
              );
            }
            return Response.json({
              sessionId: `session-${backendCalls.length}`,
              function: { kind: "query" },
            });
          }
          if (url.pathname === "/invoke/finish") {
            return Response.json({ value: record.value });
          }
          return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
        },
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const publicResponse = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:list", args: {} }),
      });
      await expect(publicResponse.json()).resolves.toEqual({ value: "public" });

      const internalResponse = await worker.dispatchFetch(
        "http://flarex.test/__flarex_internal/invoke",
        {
          method: "POST",
          body: JSON.stringify({ path: "messages:hidden", args: {} }),
        },
      );
      await expect(internalResponse.json()).resolves.toEqual({ value: "secret" });

      const hiddenPublicResponse = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:hidden", args: {} }),
      });
      expect(hiddenPublicResponse.status).toBe(400);
      await expect(hiddenPublicResponse.json()).resolves.toEqual({
        error: "Function visibility mismatch.",
      });
    } finally {
      await worker.dispose();
    }

    expect(backendCalls.filter(call => call.path === "/invoke/start")).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-generated-visibility",
          projectId: "project-generated-visibility",
          path: "messages:list",
          args: {},
          kind: "query",
          visibility: "public",
        },
      },
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-generated-visibility",
          projectId: "project-generated-visibility",
          path: "messages:hidden",
          args: {},
          kind: "query",
          visibility: "internal",
        },
      },
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-generated-visibility",
          projectId: "project-generated-visibility",
          path: "messages:hidden",
          args: {},
          kind: "query",
          visibility: "public",
        },
      },
    ]);
  });

  it("executes generated nested server-side function calls in the active session", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, query } from "../_generated/server";
import type { FunctionReference } from "flarex/server";

const helperRef: FunctionReference<"query", "internal", {}, string> = {
  _path: "messages:helper",
};

export const helper = internalQuery({
  args: {},
  handler: async () => "nested ok",
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(helperRef);
  },
});
`,
    );
    await generateFlarex({ root });

    const backendCalls: string[] = [];
    const finishedValues: unknown[] = [];
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: {
        FLAREX_DEPLOYMENT_ID: "deployment-generated-nested",
        FLAREX_EXECUTOR_TRANSPORT: "postgres",
        FLAREX_PROJECT_ID: "project-generated-nested",
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => {
          const url = new URL(request.url);
          backendCalls.push(url.pathname);
          if (url.pathname === "/invoke/start") {
            return Response.json({
              sessionId: "session-generated-nested",
              function: { kind: "query" },
            });
          }
          if (url.pathname === "/invoke/finish") {
            const body = jsonRecord(await request.json(), "/invoke/finish");
            finishedValues.push(body.value);
            return Response.json({
              value: body.value,
              readSet: {},
              readTs: 1,
            });
          }
          return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
        },
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const response = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:list", args: {} }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        value: "nested ok",
        readSet: {},
        readTs: 1,
      });
    } finally {
      await worker.dispose();
    }

    expect(backendCalls).toEqual(["/invoke/start", "/invoke/finish"]);
    expect(finishedValues).toEqual(["nested ok"]);
  });

  it("executes generated nested server-side mutation calls in the active session", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalMutation, mutation } from "../_generated/server";
import type { FunctionReference } from "flarex/server";
import { v } from "flarex/values";

const createRef: FunctionReference<"mutation", "internal", { text: string }, string> = {
  _path: "messages:create",
};

export const create = internalMutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", { text: args.text });
  },
});

export const send = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.runMutation(createRef, { text: "nested" });
  },
});
`,
    );
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  messages: defineTable({ text: v.string() }),
});
`,
    );
    await generateFlarex({ root });

    const backendCalls: Array<{ path: string; body: unknown }> = [];
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: {
        FLAREX_DEPLOYMENT_ID: "deployment-generated-nested-mutation",
        FLAREX_EXECUTOR_TRANSPORT: "postgres",
        FLAREX_PROJECT_ID: "project-generated-nested-mutation",
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => {
          const url = new URL(request.url);
          const body: unknown = await request.json().catch(() => null);
          backendCalls.push({ path: url.pathname, body });
          if (url.pathname === "/invoke/start") {
            return Response.json({
              sessionId: "session-generated-nested-mutation",
              function: { kind: "mutation" },
            });
          }
          if (url.pathname === "/invoke/syscall") {
            return Response.json({ value: "1:created" });
          }
          if (url.pathname === "/invoke/finish") {
            const record = jsonRecord(body, "/invoke/finish");
            return Response.json({
              value: record.value,
              committedTs: 30,
              writes: [
                {
                  tableId: 1,
                  id: "1:created",
                  prevTs: null,
                  ts: 30,
                  value: { text: "nested" },
                },
              ],
            });
          }
          return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
        },
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const response = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:send", args: {} }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        value: "1:created",
        committedTs: 30,
        writes: [
          {
            tableId: 1,
            id: "1:created",
            prevTs: null,
            ts: 30,
            value: { text: "nested" },
          },
        ],
      });
    } finally {
      await worker.dispose();
    }

    expect(backendCalls).toEqual([
      {
        path: "/invoke/start",
        body: {
          deploymentId: "deployment-generated-nested-mutation",
          projectId: "project-generated-nested-mutation",
          path: "messages:send",
          args: {},
          kind: "mutation",
          visibility: "public",
        },
      },
      {
        path: "/invoke/syscall",
        body: {
          deploymentId: "deployment-generated-nested-mutation",
          projectId: "project-generated-nested-mutation",
          sessionId: "session-generated-nested-mutation",
          op: "insert",
          table: "messages",
          value: { text: "nested" },
        },
      },
      {
        path: "/invoke/finish",
        body: {
          deploymentId: "deployment-generated-nested-mutation",
          projectId: "project-generated-nested-mutation",
          sessionId: "session-generated-nested-mutation",
          value: "1:created",
        },
      },
    ]);
  });

  it("rejects generated recursive nested server-side calls before stack overflow", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, query } from "../_generated/server";
import type { FunctionReference } from "flarex/server";

const selfRef: FunctionReference<"query", "internal", {}, null> = {
  _path: "messages:self",
};

export const self = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(selfRef);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(selfRef);
  },
});
`,
    );
    await generateFlarex({ root });

    const backendCalls: string[] = [];
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: {
        FLAREX_DEPLOYMENT_ID: "deployment-generated-nested-recursive",
        FLAREX_EXECUTOR_TRANSPORT: "postgres",
        FLAREX_PROJECT_ID: "project-generated-nested-recursive",
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => {
          const url = new URL(request.url);
          backendCalls.push(url.pathname);
          if (url.pathname === "/invoke/start") {
            return Response.json({
              sessionId: "session-generated-nested-recursive",
              function: { kind: "query" },
            });
          }
          if (url.pathname === "/invoke/abort") {
            return Response.json({ aborted: true });
          }
          return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
        },
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const response = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:list", args: {} }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("Maximum nested function call depth exceeded."),
      });
    } finally {
      await worker.dispose();
    }

    expect(backendCalls).toEqual(["/invoke/start", "/invoke/abort"]);
  });

  it("rejects generated nested mutation calls from a query context", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalMutation, query } from "../_generated/server";
import type { FunctionReference } from "flarex/server";
import { v } from "flarex/values";

const createRef: FunctionReference<"mutation", "internal", { text: string }, string> = {
  _path: "messages:create",
};

export const create = internalMutation({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", { text: args.text });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runMutation(createRef, { text: "nested" });
  },
});
`,
    );
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  messages: defineTable({ text: v.string() }),
});
`,
    );
    await generateFlarex({ root });

    const backendCalls: string[] = [];
    const worker = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: await bundleGeneratedWorker(root),
        },
      ],
      compatibilityDate: "2026-06-14",
      bindings: {
        FLAREX_DEPLOYMENT_ID: "deployment-generated-query-nested-mutation",
        FLAREX_EXECUTOR_TRANSPORT: "postgres",
        FLAREX_PROJECT_ID: "project-generated-query-nested-mutation",
      },
      serviceBindings: {
        FLAREX_BACKEND: async (request: Request) => {
          const url = new URL(request.url);
          backendCalls.push(url.pathname);
          if (url.pathname === "/invoke/start") {
            return Response.json({
              sessionId: "session-generated-query-nested-mutation",
              function: { kind: "query" },
            });
          }
          if (url.pathname === "/invoke/abort") {
            return Response.json({ aborted: true });
          }
          return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
        },
      },
      durableObjects: {
        CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
        DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      },
    });
    try {
      const response = await worker.dispatchFetch("http://flarex.test/invoke", {
        method: "POST",
        body: JSON.stringify({ path: "messages:list", args: {} }),
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: expect.stringContaining("Cannot run mutation during a query."),
      });
    } finally {
      await worker.dispose();
    }

    expect(backendCalls).toEqual(["/invoke/start", "/invoke/abort"]);
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

function backendCodegenAnalysis(kind: DeploymentAnalysis["functions"][number]["functions"][number]["kind"]): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
    functions: [
      {
        moduleName: "messages",
        functions: [
          {
            moduleName: "messages",
            exportName: "list",
            kind,
            visibility: "public",
            args: { type: "object", value: {} },
            returns: null,
          },
        ],
      },
    ],
  };
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

function jsonRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} request body is not a JSON object.`);
  }
  return Object.fromEntries(Object.entries(value));
}

async function bundleGeneratedWorker(root: string): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: path.join(root, "flarex/_generated/worker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rollupOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (!worker || worker.type !== "chunk") {
    throw new Error("Generated Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-test-workspace-package-resolution",
    resolveId(id) {
      if (id === "flarex" || id.startsWith("flarex/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
