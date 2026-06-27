import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectSuccessfulCommand,
  internalPackedPackageSpecifier,
  internalPackedPackages,
  runCommand,
  runPnpmPack,
  workspaceRoot,
} from "./packabilityHelpers.ts";

const flarexDevRoot = resolve(workspaceRoot, "packages/flarex-dev");
const persistencePostgresRoot = resolve(workspaceRoot, "packages/persistence-postgres");
const executorHttpRoot = resolve(workspaceRoot, "packages/executor-http");

const linkedExternalPackages = [
  { packageName: "@cloudflare/workers-types", packageRoot: flarexDevRoot },
  { packageName: "@electric-sql/pglite", packageRoot: persistencePostgresRoot },
  { packageName: "@types/pg", packageRoot: persistencePostgresRoot },
  { packageName: "drizzle-orm", packageRoot: persistencePostgresRoot },
  { packageName: "elysia", packageRoot: executorHttpRoot },
  { packageName: "miniflare", packageRoot: flarexDevRoot },
  { packageName: "pg", packageRoot: persistencePostgresRoot },
  { packageName: "tsx", packageRoot: flarexDevRoot },
  { packageName: "typescript", packageRoot: flarexDevRoot },
  { packageName: "vite", packageRoot: flarexDevRoot },
] as const;

const linkedExternalPackageRoots: ReadonlyMap<string, string> = new Map(
  linkedExternalPackages.map(link => [link.packageName, link.packageRoot]),
);

describe("fresh consumer packed install", () => {
  it("installs the packed internal graph and runs consumer smokes", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flarex-packed-consumer-"));
    try {
      const packDir = join(tempRoot, "packs");
      const consumerDir = join(tempRoot, "consumer");
      const storeDir = join(tempRoot, "store");
      await mkdir(packDir);
      await mkdir(consumerDir);
      await mkdir(storeDir);

      for (const packCase of internalPackedPackages) {
        const pack = runPnpmPack(packCase.packageRoot, packDir);
        expectSuccessfulCommand(pack);
        await expect(stat(join(packDir, packCase.tarballName))).resolves.toBeDefined();
      }

      await writeFile(
        join(consumerDir, "package.json"),
        JSON.stringify(freshConsumerManifest(), null, 2),
        "utf8",
      );
      await writeFile(
        join(consumerDir, "pnpm-workspace.yaml"),
        freshConsumerWorkspaceYaml(),
        "utf8",
      );
      await writeFile(
        join(consumerDir, ".npmrc"),
        "auto-install-peers=false\n",
        "utf8",
      );
      await writeMinimalFlarexProject(consumerDir);
      await writePackedConsumerSmoke(consumerDir);

      const install = runPnpm(consumerDir, [
        "install",
        "--config.auto-install-peers=false",
        "--offline",
        "--store-dir",
        storeDir,
        "--ignore-scripts",
      ], 240_000);
      expect(install.error).toBeUndefined();
      expect(install.status, commandOutput(install)).toBe(0);
      const help = runPnpm(consumerDir, ["exec", "flarex-dev", "--help"], 120_000);
      expect(help.error).toBeUndefined();
      expect(help.status, commandOutput(help)).toBe(0);
      expect(help.stdout).toContain("flarex-dev <command> [options]");

      const codegen = runPnpm(
        consumerDir,
        ["exec", "flarex-dev", "codegen", "--dry-run", "--typecheck", "disable"],
        120_000,
      );
      expect(codegen.error).toBeUndefined();
      expect(codegen.status, commandOutput(codegen)).toBe(0);
      expect(codegen.stdout).toContain("Command would write file:");
      expect(codegen.stdout.replaceAll("\\", "/")).toContain("flarex/_generated/server.ts");
      await expect(stat(join(consumerDir, "flarex/_generated/server.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      const generatedCodegen = runPnpm(
        consumerDir,
        ["exec", "flarex-dev", "codegen", "--typecheck", "enable"],
        120_000,
      );
      expect(generatedCodegen.error).toBeUndefined();
      expect(generatedCodegen.status, commandOutput(generatedCodegen)).toBe(0);
      await expect(stat(join(consumerDir, "flarex/_generated/server.ts"))).resolves.toBeDefined();

      const consumerTypecheck = runPnpm(
        consumerDir,
        ["exec", "tsc", "-p", "tsconfig.packed-smoke.json"],
        120_000,
      );
      expect(consumerTypecheck.error).toBeUndefined();
      expect(consumerTypecheck.status, commandOutput(consumerTypecheck)).toBe(0);

      const consumerRuntime = runPnpm(
        consumerDir,
        ["exec", "tsx", "packed-smoke.ts"],
        120_000,
      );
      expect(consumerRuntime.error).toBeUndefined();
      expect(consumerRuntime.status, commandOutput(consumerRuntime)).toBe(0);
      expect(consumerRuntime.stdout).toContain("packed-smoke ok");

      const testSdkInvocation = runPnpm(
        consumerDir,
        ["exec", "tsx", "packed-flarex-test.ts"],
        120_000,
      );
      expect(testSdkInvocation.error).toBeUndefined();
      expect(testSdkInvocation.status, commandOutput(testSdkInvocation)).toBe(0);
      expect(testSdkInvocation.stdout).toContain("packed-flarex-test ok");
    } finally {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

async function writeMinimalFlarexProject(root: string): Promise<void> {
  await mkdir(join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    join(root, "flarex/schema.ts"),
    `import { defineColocatedTable, definePartitionTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  users: definePartitionTable({ name: v.string() }),
  messages: defineColocatedTable("users", "userId", {
    userId: v.id("users"),
    body: v.string(),
  }).index("by_user", ["userId"]),
});
`,
    "utf8",
  );
  await writeFile(
    join(root, "flarex/functions/messages.ts"),
    `import { model, query } from "../_generated/server";
import { v } from "flarex/values";

export const list = query({
  partition: model.users,
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("messages")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();
  },
});
`,
    "utf8",
  );
}

async function writePackedConsumerSmoke(root: string): Promise<void> {
  await writeFile(
    join(root, "tsconfig.packed-smoke.json"),
    JSON.stringify(
      {
        compilerOptions: {
          allowImportingTsExtensions: true,
          exactOptionalPropertyTypes: true,
          isolatedModules: true,
          lib: ["ES2022", "DOM"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
          types: ["@cloudflare/workers-types"],
        },
        include: ["packed-smoke.ts", "packed-flarex-test.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(root, "packed-smoke.ts"),
    `import { createFlarexNitroHandler, type FlarexNitroEventLike } from "@flarex/executor-nitro";
import { FlarexTestInvocationError, flarexTest, type FlarexTest } from "flarex-test";

const handlerFactory: typeof createFlarexNitroHandler = createFlarexNitroHandler;
const testFactory: typeof flarexTest = flarexTest;
const eventLike: FlarexNitroEventLike = { request: new Request("http://local/health") };
let testHarness: FlarexTest | undefined;

if (typeof handlerFactory !== "function") {
  throw new Error("Nitro handler factory is not callable.");
}
if (typeof testFactory !== "function") {
  throw new Error("Flarex test factory is not callable.");
}
if (!(FlarexTestInvocationError.prototype instanceof Error)) {
  throw new Error("Flarex test invocation error does not extend Error.");
}
if (!(eventLike.request instanceof Request)) {
  throw new Error("Nitro event request is not a Request.");
}
testHarness = undefined;
void testHarness;

console.log("packed-smoke ok");
`,
    "utf8",
  );
  await writeFile(
    join(root, "packed-flarex-test.ts"),
    `import { flarexTest } from "flarex-test";
import { encodeFlarexId } from "flarex/server";
import { api } from "./flarex/_generated/api";
import { deploymentSchema } from "./flarex/_generated/deploymentSchema";
import type { TableNames } from "./flarex/_generated/dataModel";

const usersTable = "users" satisfies TableNames;
const userId = encodeFlarexId<typeof usersTable>(tableId(usersTable), "u1");
const t = await flarexTest();
try {
  const messages = await t.query(api.messages.list, { userId });
  if (!Array.isArray(messages) || messages.length !== 0) {
    throw new Error(\`Expected empty messages list, got \${JSON.stringify(messages)}\`);
  }
  console.log("packed-flarex-test ok");
} finally {
  await t.dispose();
}

function tableId(tableName: TableNames): number {
  const table = deploymentSchema.tables.find(candidate => candidate.name === tableName);
  if (table === undefined) {
    throw new Error(\`Missing generated table metadata for \${tableName}.\`);
  }
  return table.tableId;
}
`,
    "utf8",
  );
}

function freshConsumerManifest(): Record<string, unknown> {
  return {
    name: "flarex-packed-consumer",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {
      "@cloudflare/workers-types": workspacePackageLink("@cloudflare/workers-types"),
      "@flarex/executor-nitro": internalPackedPackageSpecifier("@flarex/executor-nitro"),
      flarex: internalPackedPackageSpecifier("flarex"),
      "flarex-dev": internalPackedPackageSpecifier("flarex-dev"),
      "flarex-test": internalPackedPackageSpecifier("flarex-test"),
      tsx: workspacePackageLink("tsx"),
      typescript: workspacePackageLink("typescript"),
      vite: workspacePackageLink("vite"),
    },
  };
}

function freshConsumerWorkspaceYaml(): string {
  return `packages:
  - .
overrides:
${[
  ...internalPackedPackages
    .map(packCase => ({
      packageName: packCase.packageName,
      specifier: internalPackedPackageSpecifier(packCase.packageName),
    })),
  ...linkedExternalPackages.map(link => ({
    packageName: link.packageName,
    specifier: workspacePackageLink(link.packageName),
  })),
]
  .map(
    override =>
      `  ${JSON.stringify(override.packageName)}: ${JSON.stringify(override.specifier)}`,
  )
  .join("\n")}
`;
}

function workspacePackageLink(packageName: string): string {
  const packageRoot = linkedExternalPackageRoots.get(packageName);
  if (packageRoot === undefined) {
    throw new Error(`No local package root configured for ${packageName}`);
  }
  return `link:${resolve(packageRoot, "node_modules", ...packageName.split("/")).replaceAll(
    "\\",
    "/",
  )}`;
}

function runPnpm(cwd: string, args: readonly string[], timeoutMs = 60_000) {
  if (process.platform === "win32") {
    return runCommand("cmd.exe", ["/d", "/c", "pnpm", ...args], cwd, timeoutMs);
  }
  return runCommand("pnpm", [...args], cwd, timeoutMs);
}

function commandOutput(result: { stdout: string; stderr: string }): string {
  return [`stdout:\n${result.stdout}`, `stderr:\n${result.stderr}`].join("\n");
}
