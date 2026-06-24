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

  it("fails closed for generated nested server-side function calls", async () => {
    const root = await createProject();
    await writeFile(
      path.join(root, "flarex/functions/messages.ts"),
      `import { query } from "../_generated/server";
import type { FunctionReference } from "flarex/server";

const helper: FunctionReference<"query", "internal", {}, unknown> = {
  _path: "messages:helper",
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(helper);
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
        error: expect.stringContaining(
          "ctx.runQuery is not implemented in Flarex execution sessions yet.",
        ),
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
