import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { CompilerOptions } from "typescript";
import { errorMessageFromUnknown } from "./errorMessage.ts";
import type { FlarexGenerateOptions } from "./generate.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export type FlarexGeneratedOutputTypecheckOptions = FlarexGenerateOptions & {
  tsconfigPath?: string;
  typescriptCliPath?: string;
  cwd?: string;
  maxBufferBytes?: number;
  compilerOptions?: Pick<CompilerOptions, "types" | "typeRoots" | "paths">;
};

type ForbiddenGenerateOptionKeys = {
  [Key in keyof FlarexGenerateOptions]?: never;
};

export type FlarexGeneratedOutputTypecheckConfig =
  Omit<FlarexGeneratedOutputTypecheckOptions, keyof FlarexGenerateOptions> &
    ForbiddenGenerateOptionKeys;

export type FlarexGeneratedOutputTypecheckOption =
  false | FlarexGeneratedOutputTypecheckConfig;

export type FlarexGeneratedOutputTypecheckHostOptions = FlarexGenerateOptions & {
  typecheckGeneratedOutput?: FlarexGeneratedOutputTypecheckOption;
};

export function generatedOutputTypecheckOptions(
  options: FlarexGeneratedOutputTypecheckHostOptions,
): FlarexGeneratedOutputTypecheckOptions | undefined {
  if (options.typecheckGeneratedOutput === undefined || options.typecheckGeneratedOutput === false) {
    return undefined;
  }
  const { root: _root, appDir: _appDir, generatedDir: _generatedDir, ...typecheckConfig } =
    options.typecheckGeneratedOutput as Omit<
      FlarexGeneratedOutputTypecheckOptions,
      "root" | "appDir" | "generatedDir"
    > & {
      root?: unknown;
      appDir?: unknown;
      generatedDir?: unknown;
    };
  return {
    ...typecheckConfig,
    root: options.root,
    ...(options.appDir === undefined ? {} : { appDir: options.appDir }),
    ...(options.generatedDir === undefined ? {} : { generatedDir: options.generatedDir }),
  };
}

type GeneratedOutputTsconfig = {
  compilerOptions: {
    allowImportingTsExtensions: true;
    exactOptionalPropertyTypes: true;
    isolatedModules: true;
    lib: ["ES2022", "DOM"];
    module: "ESNext";
    moduleResolution: "Bundler";
    noEmit: true;
    skipLibCheck: true;
    strict: true;
    target: "ES2022";
    types: string[];
    typeRoots?: string[];
    paths?: Record<string, string[]>;
  };
  include: string[];
};

export async function typecheckGeneratedOutput(
  options: FlarexGeneratedOutputTypecheckOptions,
): Promise<void> {
  const { configPath, cleanupDir } = await generatedTypecheckConfigPath(options);
  try {
    await writeFile(
      configPath,
      `${JSON.stringify(generatedOutputTsconfig(options), null, 2)}\n`,
    );
    const typescriptCliPath = options.typescriptCliPath ?? resolveTypeScriptCliPath();
    await execFileAsync(process.execPath, [typescriptCliPath, "-p", configPath], {
      cwd: options.cwd ?? options.root,
      maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw new Error(
      [
        "Generated output typecheck failed.",
        errorMessageFromUnknown(error),
        childProcessOutput(error, "stdout"),
        childProcessOutput(error, "stderr"),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } finally {
    if (cleanupDir !== undefined) {
      await rm(cleanupDir, { recursive: true, force: true });
    }
  }
}

async function generatedTypecheckConfigPath(
  options: FlarexGeneratedOutputTypecheckOptions,
): Promise<{ configPath: string; cleanupDir?: string }> {
  if (options.tsconfigPath !== undefined) {
    return { configPath: path.resolve(options.root, options.tsconfigPath) };
  }
  const cleanupDir = await mkdtemp(path.join(tmpdir(), "flarex-generated-typecheck-"));
  return { configPath: path.join(cleanupDir, "tsconfig.json"), cleanupDir };
}

function generatedOutputTsconfig(
  options: FlarexGeneratedOutputTypecheckOptions,
): GeneratedOutputTsconfig {
  const appDir = path.resolve(options.root, options.appDir ?? "flarex");
  const generatedDir = path.resolve(appDir, options.generatedDir ?? "_generated");
  const pathBase = path.resolve(options.cwd ?? options.root);
  const typeRoots = options.compilerOptions?.typeRoots === undefined
    ? defaultTypeRoots(pathBase)
    : resolveCompilerPaths(pathBase, options.compilerOptions.typeRoots);
  const compilerPaths = options.compilerOptions?.paths === undefined
    ? undefined
    : resolveCompilerPathMap(pathBase, options.compilerOptions.paths);
  const compilerOptions: GeneratedOutputTsconfig["compilerOptions"] = {
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
    types: options.compilerOptions?.types ?? ["@cloudflare/workers-types"],
    typeRoots,
    ...(compilerPaths === undefined ? {} : { paths: compilerPaths }),
  };
  return {
    compilerOptions,
    include: [slashPath(path.join(generatedDir, "**/*.ts"))],
  };
}

function resolveTypeScriptCliPath(): string {
  return fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
}

function childProcessOutput(error: unknown, key: "stdout" | "stderr"): string | undefined {
  if (!hasChildProcessOutput(error, key)) {
    return undefined;
  }
  const value = error[key];
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString();
  return undefined;
}

function hasChildProcessOutput(
  error: unknown,
  key: "stdout" | "stderr",
): error is Partial<Record<"stdout" | "stderr", unknown>> {
  return error !== null && typeof error === "object" && key in error;
}

function defaultTypeRoots(pathBase: string): string[] {
  return resolveCompilerPaths(pathBase, ["node_modules/@types", "node_modules"]);
}

function resolveCompilerPaths(pathBase: string, paths: string[]): string[] {
  return paths.map(filePath => slashPath(resolveCompilerPath(pathBase, filePath)));
}

function resolveCompilerPath(pathBase: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(pathBase, filePath);
}

function resolveCompilerPathMap(
  pathBase: string,
  paths: NonNullable<CompilerOptions["paths"]>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(paths).map(([key, values]) => [key, resolveCompilerPaths(pathBase, values)]),
  );
}

function slashPath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/");
}
