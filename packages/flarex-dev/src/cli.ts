import { parseArgs } from "node:util";
import { isNonEmptyString } from "@flarex/utils/strings";
import {
  deployFlarex,
  dryRunFlarexCodegen,
  FlarexDeployFinishRejectedError,
  generateFlarex,
  type FlarexCodegenOptions,
  type FlarexCodegenDryRun,
  type FlarexDeployOptions,
  type FlarexDeployRejectedFinishResponse,
  type FlarexDeployResult,
  type FlarexGenerateOptions,
  type StaleGeneratedEntry,
} from "./generate.ts";
import {
  HttpBackendPushCoordinator,
  HttpBackendSourceAnalyzer,
  type DevPushStatus,
} from "./backendPush.ts";
import {
  typecheckGeneratedOutput,
  type FlarexGeneratedOutputTypecheckOptions,
} from "./generatedTypecheck.ts";
import { errorMessageFromUnknown } from "./errorMessage.ts";

type CliWriter = {
  write(chunk: string): unknown;
};

type CliDependencies = {
  deploy: (options: FlarexDeployOptions) => Promise<FlarexDeployResult>;
  generate: (options: FlarexCodegenOptions) => Promise<void>;
  dryRun: (options: FlarexCodegenOptions) => Promise<FlarexCodegenDryRun>;
  typecheckGenerated: (options: FlarexGeneratedOutputTypecheckOptions) => Promise<void>;
};

type CodegenTypecheckMode = "enable" | "try" | "disable";
type ParsedArgValues = ReturnType<typeof parseArgs>["values"];

export type FlarexDeployJsonSuccess = {
  command: "deploy";
  result: "activated";
  started: FlarexDeployJsonPush & { state: FlarexDeployResult["started"]["state"] };
  finished: FlarexDeployJsonPush & { state: FlarexDeployResult["finished"]["state"] };
};

export type FlarexDeployJsonPush = {
  pushId: string;
  state: DevPushStatus["state"];
  error?: string;
  diagnostics?: NonNullable<DevPushStatus["diagnostics"]>;
};

export type FlarexDeployJsonError = {
  command: "deploy";
  result: "error";
  error: {
    name: string;
    message: string;
    finishRejection?: {
      code: FlarexDeployRejectedFinishResponse["code"];
      remediation: string;
      push: FlarexDeployJsonPush;
      error: string;
      diagnostics?: NonNullable<FlarexDeployRejectedFinishResponse["diagnostics"]>;
    };
  };
};

export type FlarexDeployJsonOutput = FlarexDeployJsonSuccess | FlarexDeployJsonError;

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
    deploy: options.dependencies?.deploy ?? deployFlarex,
    generate: options.dependencies?.generate ?? generateFlarex,
    dryRun: options.dependencies?.dryRun ?? dryRunFlarexCodegen,
    typecheckGenerated: options.dependencies?.typecheckGenerated ?? typecheckGeneratedOutput,
  };
  const [command, ...commandArgs] = argv;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    stdout.write(helpText());
    return 0;
  }
  if (command === "deploy") {
    return await runDeployCommand(commandArgs, { projectRoot, stdout, stderr, dependencies });
  }
  if (command !== "codegen") {
    stderr.write(`Unknown flarex-dev command: ${command}\n\n${helpText()}`);
    return 1;
  }

  return await runCodegenCommand(commandArgs, { projectRoot, stdout, stderr, dependencies });
}

async function runDeployCommand(
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
        json: { type: "boolean" },
        "backend-header": { type: "string", multiple: true },
        "backend-url": { type: "string" },
        "deployment-id": { type: "string" },
        path: { type: "string", multiple: true },
        root: { type: "string" },
        "typescript-cli": { type: "string" },
        typecheck: { type: "string" },
      },
    });

    if (parsed.values.help === true) {
      options.stdout.write(deployHelpText());
      return 0;
    }

    const root = rootFromArgs(parsed.values.root, options.projectRoot);
    if (root === undefined) {
      if (parsed.values.json === true) {
        writeDeployJsonError(
          new Error("--root must be a non-empty path when provided."),
          options.stdout,
        );
        return 1;
      }
      options.stderr.write("--root must be a non-empty path when provided.\n\n");
      options.stderr.write(deployHelpText());
      return 1;
    }

    const commandConfig = deployCommandConfig(parsed.values, root);
    const deployOptions = commandConfig.typecheckOptions === undefined
      ? commandConfig.deployOptions
      : {
          ...commandConfig.deployOptions,
          beforeFinish: async () => {
            await maybeTypecheckGenerated(commandConfig, options);
          },
        };
    const result = await options.dependencies.deploy(deployOptions);
    if (commandConfig.json) {
      writeDeployJsonSuccess(result, options.stdout);
    }
    return 0;
  } catch (error) {
    if (rawJsonFlagRequested(argv)) {
      writeDeployJsonError(error, options.stdout);
      return 1;
    }
    options.stderr.write(errorMessageFromUnknown(error));
    options.stderr.write("\n");
    return 1;
  }
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
        "backend-header": { type: "string", multiple: true },
        "backend-url": { type: "string" },
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

    await maybeTypecheckGenerated(commandConfig, options);

    return 0;
  } catch (error) {
    options.stderr.write(errorMessageFromUnknown(error));
    options.stderr.write("\n");
    return 1;
  }
}

async function maybeTypecheckGenerated(
  commandConfig: GeneratedTypecheckCommandConfig,
  options: {
    stderr: CliWriter;
    dependencies: Pick<CliDependencies, "typecheckGenerated">;
  },
): Promise<void> {
  if (commandConfig.typecheckOptions === undefined) return;
  try {
    await options.dependencies.typecheckGenerated(commandConfig.typecheckOptions);
  } catch (error) {
    if (commandConfig.typecheckMode === "try") {
      options.stderr.write(
        `Generated output typecheck failed, continuing because --typecheck try was used.\n${errorMessageFromUnknown(error)}\n`,
      );
      return;
    }
    throw error;
  }
}

type GeneratedTypecheckCommandConfig = {
  typecheckMode: CodegenTypecheckMode;
  typecheckOptions?: FlarexGeneratedOutputTypecheckOptions;
};

type CodegenCommandConfig = {
  generateOptions: FlarexCodegenOptions;
  dryRun: boolean;
} & GeneratedTypecheckCommandConfig;

type DeployCommandConfig = {
  deployOptions: FlarexDeployOptions;
  json: boolean;
} & GeneratedTypecheckCommandConfig;

function codegenCommandConfig(
  values: ParsedArgValues,
  root: string,
): CodegenCommandConfig {
  const baseGenerateOptions = baseGenerateOptionsFromArgs(values, root);
  const generateOptions: FlarexCodegenOptions = {
    ...baseGenerateOptions,
    ...sourceAnalyzerOptions(values),
  };
  return {
    generateOptions,
    dryRun: values["dry-run"] === true,
    ...generatedTypecheckCommandConfig(values, baseGenerateOptions),
  };
}

function deployCommandConfig(
  values: ParsedArgValues,
  root: string,
): DeployCommandConfig {
  const baseGenerateOptions = baseGenerateOptionsFromArgs(values, root);
  const pushCoordinator = requiredPushCoordinator(values);
  return {
    deployOptions: {
      ...baseGenerateOptions,
      pushCoordinator,
    },
    json: values.json === true,
    ...generatedTypecheckCommandConfig(values, baseGenerateOptions),
  };
}

function baseGenerateOptionsFromArgs(
  values: ParsedArgValues,
  root: string,
): FlarexGenerateOptions {
  return {
    root,
    ...(typeof values["app-dir"] === "string" ? { appDir: values["app-dir"] } : {}),
    ...(typeof values["generated-dir"] === "string" ? { generatedDir: values["generated-dir"] } : {}),
  };
}

function generatedTypecheckCommandConfig(
  values: ParsedArgValues,
  baseGenerateOptions: FlarexGenerateOptions,
): GeneratedTypecheckCommandConfig {
  const typecheckMode = typecheckModeFromArgs(values.typecheck);
  const compilerPaths = values.path === undefined
    ? undefined
    : pathMappings(stringValues(values.path, "--path"));
  if (typecheckMode !== "enable" && typecheckMode !== "try") {
    return { typecheckMode };
  }
  return {
    typecheckMode,
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
  };
}

function requiredPushCoordinator(
  values: ParsedArgValues,
): HttpBackendPushCoordinator {
  return backendPushCoordinatorFromArgs(values, {
    missingBackendUrl: "--backend-url must be provided when deploying.",
    missingDeploymentId: "--deployment-id must be provided when deploying.",
  });
}

function backendPushCoordinatorFromArgs(
  values: ParsedArgValues,
  errors: {
    missingBackendUrl: string;
    missingDeploymentId: string;
  },
): HttpBackendPushCoordinator {
  const backendUrl = values["backend-url"];
  const deploymentId = values["deployment-id"];
  const backendHeaders = values["backend-header"];
  if (!isNonEmptyString(backendUrl)) {
    throw new Error(errors.missingBackendUrl);
  }
  if (!isNonEmptyString(deploymentId)) {
    throw new Error(errors.missingDeploymentId);
  }
  const parsedHeaders = parsedHeadersFlag(backendHeaders, "--backend-header");
  return new HttpBackendPushCoordinator({
    url: backendUrl,
    deploymentId,
    ...(parsedHeaders === undefined ? {} : { headers: parsedHeaders }),
  });
}

function sourceAnalyzerOptions(
  values: ParsedArgValues,
): Pick<FlarexCodegenOptions, "pushCoordinator" | "sourceAnalyzer"> {
  const analyzerUrl = values["analyzer-url"];
  const backendUrl = values["backend-url"];
  const deploymentId = values["deployment-id"];
  const headers = values["analyzer-header"];
  const backendHeaders = values["backend-header"];
  const analyzerOnlyFlagsPresent = analyzerUrl !== undefined || headers !== undefined;
  const backendFlagsPresent = backendUrl !== undefined || backendHeaders !== undefined;
  const analyzerFlagsPresent =
    analyzerUrl !== undefined || deploymentId !== undefined || headers !== undefined;
  if (backendFlagsPresent && analyzerOnlyFlagsPresent) {
    throw new Error("Backend push options cannot be used with analyzer-only options.");
  }
  if (backendFlagsPresent) {
    return {
      pushCoordinator: backendPushCoordinatorFromArgs(values, {
        missingBackendUrl: "--backend-url must be provided when using backend push options.",
        missingDeploymentId: "--deployment-id must be provided when using backend push options.",
      }),
    };
  }
  if (!analyzerFlagsPresent) return {};
  if (!isNonEmptyString(analyzerUrl)) {
    throw new Error("--analyzer-url must be provided when using backend analyzer options.");
  }
  if (!isNonEmptyString(deploymentId)) {
    throw new Error("--deployment-id must be provided when using backend analyzer options.");
  }
  const parsedHeaders = parsedHeadersFlag(headers, "--analyzer-header");
  return {
    sourceAnalyzer: new HttpBackendSourceAnalyzer({
      url: analyzerUrl,
      deploymentId,
      ...(parsedHeaders === undefined ? {} : { headers: parsedHeaders }),
    }),
  };
}

function parsedHeadersFlag(value: unknown, flagName: string): Headers | undefined {
  if (value === undefined) return undefined;
  const headers = new Headers();
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== "string") {
      throw new Error(`Invalid ${flagName} value.`);
    }
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error(`Invalid ${flagName} value "${entry}". Expected name=value.`);
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

function writeDeployJsonSuccess(result: FlarexDeployResult, stdout: CliWriter): void {
  const output = {
    command: "deploy",
    result: "activated",
    started: {
      ...deployJsonPushStatus(result.started),
      state: result.started.state,
    },
    finished: {
      ...deployJsonPushStatus(result.finished),
      state: result.finished.state,
    },
  } satisfies FlarexDeployJsonSuccess;
  stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function writeDeployJsonError(error: unknown, stdout: CliWriter): void {
  stdout.write(`${JSON.stringify(deployJsonError(error), null, 2)}\n`);
}

function deployJsonError(error: unknown): FlarexDeployJsonError {
  const message = errorMessageFromUnknown(error);
  if (error instanceof FlarexDeployFinishRejectedError) {
    const diagnostics = error.response.diagnostics ?? error.response.push.diagnostics;
    return {
      command: "deploy",
      result: "error",
      error: {
        name: error.name,
        message,
        finishRejection: {
          code: error.response.code,
          remediation: error.remediation,
          push: deployJsonPushStatus(error.response.push),
          error: error.response.error,
          ...(diagnostics === undefined ? {} : { diagnostics }),
        },
      },
    };
  }
  return {
    command: "deploy",
    result: "error",
    error: {
      name: error instanceof Error ? error.name : "Error",
      message,
    },
  };
}

function deployJsonPushStatus(push: DevPushStatus): FlarexDeployJsonPush {
  return {
    pushId: push.pushId,
    state: push.state,
    ...(push.error === undefined ? {} : { error: push.error }),
    ...(push.diagnostics === undefined ? {} : { diagnostics: push.diagnostics }),
  };
}

function rawJsonFlagRequested(argv: readonly string[]): boolean {
  return argv.includes("--json");
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
  if (isNonEmptyString(value)) {
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

function helpText(): string {
  return `Usage:
  flarex-dev <command> [options]

Commands:
  codegen   Generate Flarex _generated files.
  deploy    Push source, generate from backend analysis, typecheck, and activate.
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
  --backend-url <url>       Start a backend source-package push and use returned codegen analysis.
  --backend-header <n=v>    Header sent to the backend push endpoint. Can be repeated.
  --analyzer-url <url>      Use an HTTP backend analyzer for source-package analysis.
  --deployment-id <id>      Deployment ID sent to the HTTP backend or analyzer.
  --analyzer-header <n=v>   Header sent to the HTTP backend analyzer. Can be repeated.
  --typecheck <mode>        Typecheck generated output after codegen. One of enable, try, disable.
  --cwd <path>              Working directory for generated-output typecheck.
  --typescript-cli <path>   TypeScript CLI JS path for generated-output typecheck.
  --path <alias=target>     TypeScript path mapping for generated-output typecheck.
  -h, --help                Show this help.
`;
}

function deployHelpText(): string {
  return `Usage:
  flarex-dev deploy --backend-url <url> --deployment-id <id> [options]

Options:
  --root <path>             Application root. Defaults to the current directory.
  --app-dir <dir>           Flarex app directory. Defaults to "flarex".
  --generated-dir <dir>     Generated directory under app dir. Defaults to "_generated".
  --backend-url <url>       Backend base URL for source-package push.
  --backend-header <n=v>    Header sent to the backend push endpoint. Can be repeated.
  --deployment-id <id>      Deployment ID to push and activate.
  --json                    Print deploy result or error as JSON to stdout.
  --typecheck <mode>        Typecheck generated output before activation. One of enable, try, disable.
  --cwd <path>              Working directory for generated-output typecheck.
  --typescript-cli <path>   TypeScript CLI JS path for generated-output typecheck.
  --path <alias=target>     TypeScript path mapping for generated-output typecheck.
  -h, --help                Show this help.
`;
}
