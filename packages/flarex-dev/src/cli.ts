import { parseArgs } from "node:util";
import { generateFlarex, type FlarexGenerateOptions } from "./generate.ts";
import {
  typecheckGeneratedOutput,
  type FlarexGeneratedOutputTypecheckOptions,
} from "./generatedTypecheck.ts";

type CliWriter = {
  write(chunk: string): unknown;
};

type CliDependencies = {
  generate: (options: FlarexGenerateOptions) => Promise<void>;
  typecheckGenerated: (options: FlarexGeneratedOutputTypecheckOptions) => Promise<void>;
};

export type FlarexDevCliOptions = {
  argv?: string[];
  stdout?: CliWriter;
  stderr?: CliWriter;
  dependencies?: Partial<CliDependencies>;
};

export async function runFlarexDevCli(options: FlarexDevCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const dependencies: CliDependencies = {
    generate: options.dependencies?.generate ?? generateFlarex,
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

  return await runCodegenCommand(commandArgs, { stdout, stderr, dependencies });
}

async function runCodegenCommand(
  argv: string[],
  options: {
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
        path: { type: "string", multiple: true },
        root: { type: "string" },
        "typescript-cli": { type: "string" },
        typecheck: { type: "boolean" },
      },
    });

    if (parsed.values.help === true) {
      options.stdout.write(codegenHelpText());
      return 0;
    }

    const root = parsed.values.root;
    if (typeof root !== "string" || root.length === 0) {
      options.stderr.write("flarex-dev codegen requires --root <path>.\n\n");
      options.stderr.write(codegenHelpText());
      return 1;
    }

    const commandConfig = codegenCommandConfig(parsed.values, root);
    await options.dependencies.generate(commandConfig.generateOptions);

    if (commandConfig.typecheckOptions !== undefined) {
      await options.dependencies.typecheckGenerated(commandConfig.typecheckOptions);
    }

    return 0;
  } catch (error) {
    options.stderr.write(cliErrorMessage(error));
    options.stderr.write("\n");
    return 1;
  }
}

type CodegenCommandConfig = {
  generateOptions: FlarexGenerateOptions;
  typecheckOptions?: FlarexGeneratedOutputTypecheckOptions;
};

function codegenCommandConfig(
  values: ReturnType<typeof parseArgs>["values"],
  root: string,
): CodegenCommandConfig {
  const generateOptions: FlarexGenerateOptions = {
    root,
    ...(typeof values["app-dir"] === "string" ? { appDir: values["app-dir"] } : {}),
    ...(typeof values["generated-dir"] === "string" ? { generatedDir: values["generated-dir"] } : {}),
  };
  return {
    generateOptions,
    ...(values.typecheck === true
      ? {
          typecheckOptions: {
            ...generateOptions,
            ...(typeof values.cwd === "string" ? { cwd: values.cwd } : {}),
            ...(typeof values["typescript-cli"] === "string"
              ? { typescriptCliPath: values["typescript-cli"] }
              : {}),
            ...(values.path === undefined
              ? {}
              : { compilerOptions: { paths: pathMappings(stringValues(values.path, "--path")) } }),
          },
        }
      : {}),
  };
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
  flarex-dev codegen --root <path> [--typecheck]

Commands:
  codegen   Generate Flarex _generated files.
  help      Show this help.
`;
}

function codegenHelpText(): string {
  return `Usage:
  flarex-dev codegen --root <path> [options]

Options:
  --root <path>             Application root.
  --app-dir <dir>           Flarex app directory. Defaults to "flarex".
  --generated-dir <dir>     Generated directory under app dir. Defaults to "_generated".
  --typecheck               Typecheck generated output after codegen.
  --cwd <path>              Working directory for generated-output typecheck.
  --typescript-cli <path>   TypeScript CLI JS path for generated-output typecheck.
  --path <alias=target>     TypeScript path mapping for generated-output typecheck.
  -h, --help                Show this help.
`;
}
