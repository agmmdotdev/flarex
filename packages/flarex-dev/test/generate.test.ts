import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { build, type Plugin } from "vite";
import { describe, expect, it } from "vitest";
import { generateFlarex } from "../src/generate";

describe("generateFlarex", () => {
  it("analyzes actual registered exports and generates shared runtime metadata", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { internalQuery, mutation, query, routeFromArgs } from "../_generated/server";
import { v } from "flarex/values";
const listImpl = query({
  args: { topic: v.string() },
  returns: v.array(v.string()),
  route: routeFromArgs("topic"),
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
    expect(api).toContain('createApi({');
    expect(api).toContain('"messages:list": {');
    expect(api).toContain('"route": {');
    expect(api).toContain('"field": "topic"');
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
    expect(functionMetadata).toContain('"route": {');
    expect(functionMetadata).toContain('"field": "topic"');
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

  it("generates model partition selectors from schema placement", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
  }).partitionBy("_id"),
  teams: defineTable({
    slug: v.string(),
    name: v.string(),
  }).partitionBy("slug"),
  teamMembers: defineTable({
    teamSlug: v.string(),
    userId: v.id("users"),
  }).colocateWith("teams", "teamSlug"),
  auditLog: defineTable({
    message: v.string(),
  }).global(),
});
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/teams.ts"),
      `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  args: { teamSlug: v.string(), name: v.string() },
  partition: model.teams.bySlug("teamSlug"),
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
    expect(server).toContain("teams: {");
    expect(server).toContain('table: "teams"');
    expect(server).toContain("bySlug: (argField: string) => ({");
    expect(server).toContain('selector: "bySlug"');
    expect(server).toContain('partitionField: "slug"');
    expect(server).toContain("export type PartitionScopes = {");
    expect(server).toContain('users: "users";');
    expect(server).toContain('teams: "teamMembers" | "teams";');
    expect(server).not.toContain('auditLog: "auditLog";');
    expect(server).toContain('MutationBuilder<DataModel, "public", "mutation", PartitionScopes>');
    expect(functionMetadata).toContain('"path": "teams:create"');
    expect(functionMetadata).toContain('"route": {');
    expect(functionMetadata).toContain('"field": "teamSlug"');
    expect(functionMetadata).toContain('"partition": {');
    expect(functionMetadata).toContain('"table": "teams"');
    expect(functionMetadata).toContain('"selector": "bySlug"');
    expect(functionMetadata).toContain('"partitionField": "slug"');
    expect(functionMetadata).toContain('"argField": "teamSlug"');
    expect(api).toContain('"teams:create": {');
    expect(api).toContain('"partition": {');
    expect(api).toContain('"table": "teams"');
    expect(api).toContain('"selector": "bySlug"');
    expect(api).toContain('"partitionField": "slug"');
    expect(api).toContain('"argField": "teamSlug"');
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
    expect(functionMetadata).toContain('"route": {');
    expect(functionMetadata).toContain('"field": "userId"');
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

  it("rejects create-root model table partitions until root preallocation exists", async () => {
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
  handler: async () => null,
});
`,
    );

    await expect(generateFlarex({ root })).rejects.toThrow(
      'users:create.partition: create-root mode for model.users is not implemented yet. Add exactly one required v.id("users") argument or use model.users.byId("argName").',
    );
  });

  it("rejects model partition selectors that do not match schema placement", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/schema.ts"),
      `import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";

export default defineSchema({
  teams: defineTable({
    slug: v.string(),
    name: v.string(),
  }).partitionBy("slug"),
});
`,
    );
    await writeFile(
      path.join(root, "flarex/functions/teams.ts"),
      `import { model, mutation } from "../_generated/server";
import { v } from "flarex/values";

export const create = mutation({
  args: { teamId: v.id("teams"), name: v.string() },
  partition: model.teams.byId("teamId"),
  handler: async () => null,
});
`,
    );

    await expect(generateFlarex({ root })).rejects.toThrow(
      "teams:create.partition: Selector byId targets _id, but teams is partitioned by slug.",
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
