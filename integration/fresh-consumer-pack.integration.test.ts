import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectSuccessfulCommand,
  runCommand,
  runPnpmPack,
  workspaceRoot,
} from "./packabilityHelpers.ts";

type PackedPackage = {
  readonly packageName: string;
  readonly packageRoot: string;
  readonly tarballName: string;
};

const packedPackages = [
  {
    packageName: "flarex",
    packageRoot: resolve(workspaceRoot, "packages/flarex"),
    tarballName: "flarex-0.0.1.tgz",
  },
  {
    packageName: "flarex-backend",
    packageRoot: resolve(workspaceRoot, "packages/flarex-backend"),
    tarballName: "flarex-backend-0.0.1.tgz",
  },
  {
    packageName: "@flarex/persistence-postgres",
    packageRoot: resolve(workspaceRoot, "packages/persistence-postgres"),
    tarballName: "flarex-persistence-postgres-0.0.1.tgz",
  },
  {
    packageName: "@flarex/freshness",
    packageRoot: resolve(workspaceRoot, "packages/freshness"),
    tarballName: "flarex-freshness-0.0.1.tgz",
  },
  {
    packageName: "@flarex/executor",
    packageRoot: resolve(workspaceRoot, "packages/executor"),
    tarballName: "flarex-executor-0.0.1.tgz",
  },
  {
    packageName: "@flarex/executor-http",
    packageRoot: resolve(workspaceRoot, "packages/executor-http"),
    tarballName: "flarex-executor-http-0.0.1.tgz",
  },
  {
    packageName: "flarex-dev",
    packageRoot: resolve(workspaceRoot, "packages/flarex-dev"),
    tarballName: "flarex-dev-0.0.1.tgz",
  },
] satisfies readonly PackedPackage[];

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
  it("installs flarex-dev from local package tarballs and runs the CLI", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "flarex-packed-consumer-"));
    try {
      const packDir = join(tempRoot, "packs");
      const consumerDir = join(tempRoot, "consumer");
      const storeDir = join(tempRoot, "store");
      await mkdir(packDir);
      await mkdir(consumerDir);
      await mkdir(storeDir);

      for (const packCase of packedPackages) {
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
    } finally {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

async function writeMinimalFlarexProject(root: string): Promise<void> {
  await mkdir(join(root, "flarex/functions"), { recursive: true });
  await writeFile(
    join(root, "flarex/schema.ts"),
    `import { defineGlobalTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({ messages: defineGlobalTable({ body: v.string() }) });
`,
    "utf8",
  );
  await writeFile(
    join(root, "flarex/functions/messages.ts"),
    `import { query } from "../_generated/server";
export const list = query({ args: {}, handler: async () => [] });
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
      flarex: "file:../packs/flarex-0.0.1.tgz",
      "flarex-dev": "file:../packs/flarex-dev-0.0.1.tgz",
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
  ...packedPackages
    .filter(packCase => packCase.packageName !== "flarex-dev")
    .map(packCase => ({
      packageName: packCase.packageName,
      specifier: `file:../packs/${packCase.tarballName}`,
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
