import { parseArgs } from "node:util";
import {
  dryRunFlarexCodegen,
  generateFlarex,
  type FlarexCodegenOptions,
  type FlarexCodegenDryRun,
  type StaleGeneratedEntry,
} from "./generate.ts";
import { HttpBackendSourceAnalyzer } from "./backendPush.ts";
import {
  typecheckGeneratedOutput,
  type FlarexGeneratedOutputTypecheckOptions,
} from "./generatedTypecheck.ts";

type CliWriter = {
  write(chunk: string): unknown;
};

type CliDependencies = {
  generate: (options: FlarexCodegenOptions) => Promise<void>;
  dryRun: (options: FlarexCodegenOptions) => Promise<FlarexCodegenDryRun>;
  typecheckGenerated: (options: FlarexGeneratedOutputTypecheckOptions) => Promise<void>;
};

type CodegenTypecheckMode = "enable" | "try" | "disable";

export type FlarexDevCliOptions = {
  argv?: string[];
  projectRoot?: string;
  stdout?: CliWriter;
  stderr?: CliWriter;
  dependencies?: Partial<CliDependencies>;
};

export async function runFlarexDevCli(options: FlarexDevCliOptions = {}): Promise<number> {
  const argv = commandArgv(options.argv ?? process.argv.slice(2));
  const projectRoot = options.projectRoot ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const dependencies: CliDependencies = {
    generate: options.dependencies?.generate ?? generateFlarex,
    dryRun: options.dependencies?.dryRun ?? dryRunFlarexCodegen,
    typecheckGenerated: options.dependencies?.typecheckGenerated ?? typecheckGeneratedOutput,
  };
  const [command, ...commandArgs] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return 0;
  }
  if (command !== "codegen") {
    stderr.write(`Unknown flarex-dev command: ${command}\n\n${helpText()}`);
    return 1;
  }

  return await runCodegenCommand(commandArgs, { projectRoot, stdout, stderr, dependencies });
}

function commandArgv(argv: string[]): string[] {
  const commandArgs = argv[0] === "--" ? argv.slice(1) : argv;
  return normalizeBooleanTypecheckFlag(commandArgs);
}

function normalizeBooleanTypecheckFlag(argv: string[]): string[] {
  return argv.map((arg, index) => {
    if (arg !== "--typecheck") {
      return arg;
    }
    const nextArg = argv[index + 1];
    return nextArg === undefined || nextArg.startsWith("-") ? "--typecheck=enable" : arg;
  });
}

async function runCodegenCommand(
  argv: string[],
  options: {
    projectRoot: string;
    stdout: CliWriter;
    stderr: CliWriter;
    dependencies: CliDependencies;
  },
): Promise<number> {
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      options: {
        "app-dir": { type: "string" },
        cwd: { type: "string" },
        "generated-dir": { type: "string" },
        help: { type: "boolean", short: "h" },
        "analyzer-header": { type: "string", multiple: true },
        "analyzer-url": { type: "string" },
        "deployment-id": { type: "string" },
        path: { type: "string", multiple: true },
        root: { type: "string" },
        "typescript-cli": { type: "string" },
        typecheck: { type: "string" },
        "dry-run": { type: "boolean" },
      },
    });

    if (parsed.values.help === true) {
      options.stdout.write(codegenHelpText());
      return 0;
    }

    const root = rootFromArgs(parsed.values.root, options.projectRoot);
    if (root === undefined) {
      options.stderr.write("--root must be a non-empty path when provided.\n\n");
      options.stderr.write(codegenHelpText());
      return 1;
    }

    const commandConfig = codegenCommandConfig(parsed.values, root);
    if (commandConfig.dryRun) {
      const report = await options.dependencies.dryRun(commandConfig.generateOptions);
      writeDryRunReport(report, options.stdout);
      return 0;
    }

    await options.dependencies.generate(commandConfig.generateOptions);

    if (commandConfig.typecheckOptions !== undefined) {
      try {
        await options.dependencies.typecheckGenerated(commandConfig.typecheckOptions);
      } catch (error) {
        if (commandConfig.typecheckMode === "try") {
          options.stderr.write(
            `Generated output typecheck failed, continuing because --typecheck try was used.\n${cliErrorMessage(error)}\n`,
          );
        } else {
          throw error;
        }
      }
    }

    return 0;
  } catch (error) {
    options.stderr.write(cliErrorMessage(error));
    options.stderr.write("\n");
    return 1;
  }
}

type CodegenCommandConfig = {
  generateOptions: FlarexCodegenOptions;
  dryRun: boolean;
  typecheckMode: CodegenTypecheckMode;
  typecheckOptions?: FlarexGeneratedOutputTypecheckOptions;
};

function codegenCommandConfig(
  values: ReturnType<typeof parseArgs>["values"],
  root: string,
): CodegenCommandConfig {
  const typecheckMode = typecheckModeFromArgs(values.typecheck);
  const compilerPaths = values.path === undefined
    ? undefined
    : pathMappings(stringValues(values.path, "--path"));
  const baseGenerateOptions = {
    root,
    ...(typeof values["app-dir"] === "string" ? { appDir: values["app-dir"] } : {}),
    ...(typeof values["generated-dir"] === "string" ? { generatedDir: values["generated-dir"] } : {}),
  };
  const generateOptions: FlarexCodegenOptions = {
    ...baseGenerateOptions,
    ...sourceAnalyzerOptions(values),
  };
  return {
    generateOptions,
    dryRun: values["dry-run"] === true,
    typecheckMode,
    ...(typecheckMode === "enable" || typecheckMode === "try"
        ? {
          typecheckOptions: {
            ...baseGenerateOptions,
            ...(typeof values.cwd === "string" ? { cwd: values.cwd } : {}),
            ...(typeof values["typescript-cli"] === "string"
              ? { typescriptCliPath: values["typescript-cli"] }
              : {}),
            ...(compilerPaths === undefined
              ? {}
              : { compilerOptions: { paths: compilerPaths } }),
          },
        }
      : {}),
  };
}

function sourceAnalyzerOptions(
  values: ReturnType<typeof parseArgs>["values"],
): Pick<FlarexCodegenOptions, "sourceAnalyzer"> {
  const analyzerUrl = values["analyzer-url"];
  const deploymentId = values["deployment-id"];
  const headers = values["analyzer-header"];
  const analyzerFlagsPresent =
    analyzerUrl !== undefined || deploymentId !== undefined || headers !== undefined;
  if (!analyzerFlagsPresent) return {};
  if (typeof analyzerUrl !== "string" || analyzerUrl.length === 0) {
    throw new Error("--analyzer-url must be provided when using backend analyzer options.");
  }
  if (typeof deploymentId !== "string" || deploymentId.length === 0) {
    throw new Error("--deployment-id must be provided when using backend analyzer options.");
  }
  const parsedHeaders = analyzerHeaders(headers);
  return {
    sourceAnalyzer: new HttpBackendSourceAnalyzer({
      url: analyzerUrl,
      deploymentId,
      ...(parsedHeaders === undefined ? {} : { headers: parsedHeaders }),
    }),
  };
}

function analyzerHeaders(value: unknown): Headers | undefined {
  if (value === undefined) return undefined;
  const headers = new Headers();
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== "string") {
      throw new Error("Invalid --analyzer-header value.");
    }
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid --analyzer-header value "${entry}". Expected name=value.`);
    }
    headers.append(entry.slice(0, separatorIndex), entry.slice(separatorIndex + 1));
  }
  return headers;
}

function writeDryRunReport(report: FlarexCodegenDryRun, stdout: CliWriter): void {
  for (const write of report.writes) {
    stdout.write(`Command would write file: ${write.path}\n`);
  }
  for (const deleteEntry of report.deletes) {
    stdout.write(`${dryRunDeleteMessage(deleteEntry)}\n`);
  }
}

function dryRunDeleteMessage(entry: StaleGeneratedEntry): string {
  if (entry.kind === "directory") {
    return `Command would delete directory: ${entry.path}`;
  }
  if (entry.kind === "file") {
    return `Command would delete file: ${entry.path}`;
  }
  return `Command would delete entry: ${entry.path}`;
}

function typecheckModeFromArgs(value: unknown): CodegenTypecheckMode {
  if (value === undefined) {
    return "disable";
  }
  if (value === "enable" || value === "try" || value === "disable") {
    return value;
  }
  throw new Error(
    `Invalid --typecheck value "${String(value)}". Expected enable, try, or disable.`,
  );
}

function rootFromArgs(value: unknown, projectRoot: string): string | undefined {
  if (value === undefined) {
    return projectRoot;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function pathMappings(values: string | string[]): Record<string, string[]> {
  const entries = Array.isArray(values) ? values : [values];
  const paths: Record<string, string[]> = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid --path value "${entry}". Expected alias=target.`);
    }
    const alias = entry.slice(0, separatorIndex);
    const target = entry.slice(separatorIndex + 1);
    paths[alias] = [...(paths[alias] ?? []), target];
  }
  return paths;
}

function stringValues(value: unknown, flagName: string): string | string[] {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every(item => typeof item === "string")) {
    return value;
  }
  throw new Error(`Invalid ${flagName} value.`);
}

function cliErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function helpText(): string {
  return `Usage:
  flarex-dev codegen [--root <path>] [--typecheck <mode>]

Commands:
  codegen   Generate Flarex _generated files.
  help      Show this help.
`;
}

function codegenHelpText(): string {
  return `Usage:
  flarex-dev codegen [--root <path>] [options]

Options:
  --root <path>             Application root. Defaults to the current directory.
  --app-dir <dir>           Flarex app directory. Defaults to "flarex".
  --generated-dir <dir>     Generated directory under app dir. Defaults to "_generated".
  --dry-run                 Print generated writes/deletes without writing final generated files.
  --analyzer-url <url>      Use an HTTP backend analyzer for source-package analysis.
  --deployment-id <id>      Deployment ID sent to the HTTP backend analyzer.
  --analyzer-header <n=v>   Header sent to the HTTP backend analyzer. Can be repeated.
  --typecheck <mode>        Typecheck generated output after codegen. One of enable, try, disable.
  --cwd <path>              Working directory for generated-output typecheck.
  --typescript-cli <path>   TypeScript CLI JS path for generated-output typecheck.
  --path <alias=target>     TypeScript path mapping for generated-output typecheck.
  -h, --help                Show this help.
`;
}
