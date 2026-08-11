import {
  ApplicationAnalysisRejectionCodeV1,
  makeApplicationManifestV1,
  type ApplicationAnalysisRejectionCodeV1 as ApplicationAnalysisRejectionCode,
  type ApplicationManifestSourceArtifactV1Input,
} from "@flarex/analysis/application-analysis";
import {
  analyzeLoadedSourcePackageEffect,
  type AnalyzerDiagnostic,
  type LoadedExecutionModules,
} from "@flarex/analysis";
import { Cause, Effect, Exit, Result } from "effect";

export * from "flarex/server";
export * from "flarex/values";

const FIXED_UNIX_TIME_MILLISECONDS = 1_700_000_000_000;
const MAXIMUM_DIAGNOSTICS = 100;
const MAXIMUM_DIAGNOSTIC_BYTES = 65_536;
const MAXIMUM_DIAGNOSTIC_MESSAGE_BYTES = 2_048;
const UTF8 = new TextEncoder();

export interface ApplicationAnalysisColdLoadInput {
  readonly sourceArtifact: ApplicationManifestSourceArtifactV1Input;
  readonly loadExecution: () => Promise<unknown>;
  readonly loadSchema: null | (() => Promise<unknown>);
}

export type ApplicationAnalysisColdLoadOutcome =
  | Readonly<{
    readonly kind: "analyzed";
    readonly canonicalManifest: string;
    readonly diagnostics: readonly AnalyzerDiagnostic[];
  }>
  | Readonly<{
    readonly kind: "rejected";
    readonly failureCode: ApplicationAnalysisRejectionCode;
    readonly detail: string;
    readonly diagnostics: readonly AnalyzerDiagnostic[];
  }>;

class ForbiddenImportEffect extends Error {
  readonly _tag = "ForbiddenImportEffect";
}

export async function runApplicationAnalysisColdLoad(
  input: ApplicationAnalysisColdLoadInput,
): Promise<ApplicationAnalysisColdLoadOutcome> {
  const diagnostics = makeDiagnosticCapture();
  const restoreConsole = installConsoleCapture(diagnostics);
  const importPolicy = installImportPolicy(diagnostics);
  try {
    let executionModule: unknown;
    let schemaModule: unknown;
    try {
      executionModule = await input.loadExecution();
      schemaModule = input.loadSchema === null
        ? Object.freeze({ default: undefined })
        : await input.loadSchema();
    } catch (cause) {
      return rejected(
        cause instanceof ForbiddenImportEffect || importPolicy.forbiddenAttempted()
          ? ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect
          : ApplicationAnalysisRejectionCodeV1.moduleImportFailed,
        diagnostics,
      );
    }
    if (importPolicy.forbiddenAttempted()) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    const executionModules = isRecord(executionModule) &&
        "default" in executionModule &&
        isLoadedExecutionModules(executionModule.default)
      ? executionModule.default
      : undefined;
    if (importPolicy.forbiddenAttempted()) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    if (executionModules === undefined) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.invalidRegistration,
        diagnostics,
      );
    }
    const schemaRecord = isRecord(schemaModule) ? schemaModule : undefined;
    const hasSchemaDefault = schemaRecord !== undefined && "default" in schemaRecord;
    if (importPolicy.forbiddenAttempted()) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    if (schemaRecord === undefined || !hasSchemaDefault) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.invalidSchema,
        diagnostics,
      );
    }
    const schemaDefinition = schemaRecord.default;
    if (importPolicy.forbiddenAttempted()) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    const exit = await Effect.runPromiseExit(Effect.gen(function* () {
      const analysis = yield* analyzeLoadedSourcePackageEffect({
        executionModules,
        schemaDefinition,
        sourceMaps: {},
        sourceMapFailure: "ignore",
      });
      return yield* makeApplicationManifestV1(analysis, input.sourceArtifact);
    }));
    if (importPolicy.forbiddenAttempted()) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    if (Exit.isSuccess(exit)) {
      return Object.freeze({
        kind: "analyzed",
        canonicalManifest: exit.value.canonicalText,
        diagnostics: diagnostics.snapshot(),
      });
    }
    const failure = Cause.findError(exit.cause);
    if (Result.isFailure(failure)) {
      throw new Error("Application Analysis core encountered an unexpected defect.");
    }
    return rejected(classifyAnalysisFailure(failure.success), diagnostics);
  } catch (cause) {
    if (
      cause instanceof ForbiddenImportEffect ||
      importPolicy.forbiddenAttempted()
    ) {
      return rejected(
        ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect,
        diagnostics,
      );
    }
    throw cause;
  } finally {
    restoreConsole();
    importPolicy.restore();
  }
}

function classifyAnalysisFailure(value: unknown): ApplicationAnalysisRejectionCode {
  if (!isRecord(value) || typeof value._tag !== "string") {
    throw new Error("Application Analysis core received an unknown typed failure.");
  }
  switch (value._tag) {
    case "AnalyzerSchemaError":
    case "AnalyzerValidatorError":
      return ApplicationAnalysisRejectionCodeV1.invalidSchema;
    case "AnalyzerFunctionMetadataError":
    case "AnalyzerPartitionError":
      return ApplicationAnalysisRejectionCodeV1.invalidRegistration;
    case "ApplicationAnalysisContractError":
      return value.reason === "limitExceeded" ||
          value.reason === "sourceBytesExceeded" ||
          value.reason === "manifestBytesExceeded" ||
          value.reason === "validatorLimitExceeded"
        ? ApplicationAnalysisRejectionCodeV1.limitExceeded
        : value.reason === "duplicateModulePath" ||
            value.reason === "invalidSourceModulePath" ||
            value.reason === "missingExecutionModule" ||
            value.reason === "invalidExecutionModuleRole" ||
            value.reason === "missingSchemaModule" ||
            value.reason === "invalidSchemaModuleRole" ||
            value.reason === "unsupportedAuthModule"
        ? ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact
        : value.reason === "invalidSchemaRelationship"
        ? ApplicationAnalysisRejectionCodeV1.invalidSchema
        : ApplicationAnalysisRejectionCodeV1.invalidRegistration;
    default:
      throw new Error("Application Analysis core received an unsupported typed failure.");
  }
}

function rejected(
  failureCode: ApplicationAnalysisRejectionCode,
  diagnostics: DiagnosticCapture,
): ApplicationAnalysisColdLoadOutcome {
  return Object.freeze({
    kind: "rejected",
    failureCode,
    detail: failureDetail(failureCode),
    diagnostics: diagnostics.snapshot(),
  });
}

function failureDetail(code: ApplicationAnalysisRejectionCode): string {
  switch (code) {
    case ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact:
      return "The authenticated source artifact is invalid.";
    case ApplicationAnalysisRejectionCodeV1.moduleImportFailed:
      return "An application module could not be imported.";
    case ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect:
      return "Application import attempted a forbidden ambient effect.";
    case ApplicationAnalysisRejectionCodeV1.invalidRegistration:
      return "Application function registration is invalid.";
    case ApplicationAnalysisRejectionCodeV1.invalidSchema:
      return "Application schema registration is invalid.";
    case ApplicationAnalysisRejectionCodeV1.limitExceeded:
      return "Application Analysis admitted limits were exceeded.";
    case ApplicationAnalysisRejectionCodeV1.timeout:
      return "Application Analysis exceeded its deadline.";
    case ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration:
      return "Cold application registrations were not deterministic.";
  }
}

interface DiagnosticCapture {
  readonly append: (level: AnalyzerDiagnostic["level"], values: readonly unknown[]) => void;
  readonly appendMessage: (level: AnalyzerDiagnostic["level"], message: string) => void;
  readonly snapshot: () => readonly AnalyzerDiagnostic[];
}

function makeDiagnosticCapture(): DiagnosticCapture {
  const values: AnalyzerDiagnostic[] = [];
  let totalBytes = 0;
  const appendMessage = (
    level: AnalyzerDiagnostic["level"],
    rawMessage: string,
  ): void => {
    if (values.length >= MAXIMUM_DIAGNOSTICS || totalBytes >= MAXIMUM_DIAGNOSTIC_BYTES) {
      return;
    }
    const message = truncateUtf8(rawMessage, Math.min(
      MAXIMUM_DIAGNOSTIC_MESSAGE_BYTES,
      MAXIMUM_DIAGNOSTIC_BYTES - totalBytes,
    ));
    const bytes = UTF8.encode(message).byteLength;
    if (bytes === 0) return;
    values.push(Object.freeze({ level, message }));
    totalBytes += bytes;
  };
  return Object.freeze({
    append: (
      level: AnalyzerDiagnostic["level"],
      input: readonly unknown[],
    ) => appendMessage(
      level,
      input.map(safeDiagnosticValue).join(" "),
    ),
    appendMessage,
    snapshot: () => Object.freeze(values.map(value => Object.freeze({ ...value }))),
  });
}

function installConsoleCapture(diagnostics: DiagnosticCapture): () => void {
  const original = Object.freeze({
    log: console.log,
    warn: console.warn,
    error: console.error,
  });
  console.log = (...values: readonly unknown[]) => diagnostics.append("log", values);
  console.warn = (...values: readonly unknown[]) => diagnostics.append("warn", values);
  console.error = (...values: readonly unknown[]) => diagnostics.append("error", values);
  return once(() => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  });
}

interface InstalledImportPolicy {
  readonly forbiddenAttempted: () => boolean;
  readonly restore: () => void;
}

function installImportPolicy(
  diagnostics: DiagnosticCapture,
): InstalledImportPolicy {
  const restorers: Array<() => void> = [];
  let forbiddenAttempted = false;
  const markForbidden = (): void => {
    forbiddenAttempted = true;
  };
  try {
    const OriginalDate = Date;
    function ApplicationAnalysisDate(
      ...args: ReadonlyArray<unknown>
    ): string | Date {
      if (new.target === undefined) {
        return new OriginalDate(FIXED_UNIX_TIME_MILLISECONDS).toString();
      }
      return Reflect.construct(
        OriginalDate,
        args.length === 0 ? [FIXED_UNIX_TIME_MILLISECONDS] : Array.from(args),
        new.target,
      );
    }
    Object.setPrototypeOf(ApplicationAnalysisDate, OriginalDate);
    const applicationAnalysisDatePrototype = Object.create(
      OriginalDate.prototype,
    );
    Object.defineProperty(applicationAnalysisDatePrototype, "constructor", {
      configurable: true,
      writable: true,
      value: ApplicationAnalysisDate,
    });
    Object.defineProperty(ApplicationAnalysisDate, "prototype", {
      value: applicationAnalysisDatePrototype,
    });
    Object.defineProperty(ApplicationAnalysisDate, "now", {
      configurable: true,
      value: () => FIXED_UNIX_TIME_MILLISECONDS,
    });
    installValue(restorers, globalThis, "Date", ApplicationAnalysisDate);
    let seed = 0x5eed1234;
    installValue(restorers, Math, "random", () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    });
    installRejected(restorers, diagnostics, markForbidden, globalThis, "fetch", "fetch");
    installRejectedGlobalObject(restorers, diagnostics, markForbidden, "crypto");
    installDeterministicPerformance(
      restorers,
      diagnostics,
      markForbidden,
    );
    installRejected(restorers, diagnostics, markForbidden, globalThis, "setTimeout", "setTimeout");
    installRejected(restorers, diagnostics, markForbidden, globalThis, "setInterval", "setInterval");
    if ("scheduler" in globalThis) {
      installRejectedGlobalObject(restorers, diagnostics, markForbidden, "scheduler");
    }
  } catch (cause) {
    for (let index = restorers.length - 1; index >= 0; index -= 1) {
      restorers[index]?.();
    }
    throw cause;
  }
  return Object.freeze({
    forbiddenAttempted: () => forbiddenAttempted,
    restore: once(() => {
      for (let index = restorers.length - 1; index >= 0; index -= 1) {
        restorers[index]?.();
      }
    }),
  });
}

function installDeterministicPerformance(
  restorers: Array<() => void>,
  diagnostics: DiagnosticCapture,
  markForbidden: () => void,
): void {
  const deterministic = new Proxy(Object.freeze({
    now: () => 0,
    timeOrigin: FIXED_UNIX_TIME_MILLISECONDS,
  }), {
    get: (target, property, receiver) => {
      if (property === "now" || property === "timeOrigin") {
        return Reflect.get(target, property, receiver);
      }
      markForbidden();
      diagnostics.appendMessage(
        "error",
        `performance.${String(property)} is forbidden during application import.`,
      );
      throw new ForbiddenImportEffect();
    },
  });
  installValue(restorers, globalThis, "performance", deterministic);
}

function installRejectedGlobalObject(
  restorers: Array<() => void>,
  diagnostics: DiagnosticCapture,
  markForbidden: () => void,
  key: "crypto" | "performance" | "scheduler",
): void {
  const denied = new Proxy(Object.freeze({}), {
    get: (_target, property) => {
      markForbidden();
      const operation = `${key}.${String(property)}`;
      diagnostics.appendMessage(
        "error",
        `${operation} is forbidden during application import.`,
      );
      throw new ForbiddenImportEffect();
    },
  });
  installValue(restorers, globalThis, key, denied);
}

function installRejected(
  restorers: Array<() => void>,
  diagnostics: DiagnosticCapture,
  markForbidden: () => void,
  target: object,
  key: PropertyKey,
  operation: string,
): void {
  installValue(restorers, target, key, () => {
    markForbidden();
    diagnostics.appendMessage("error", `${operation} is forbidden during application import.`);
    throw new ForbiddenImportEffect();
  });
}

function installValue(
  restorers: Array<() => void>,
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restorers.push(() => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(target, key);
    } else {
      Object.defineProperty(target, key, descriptor);
    }
  });
}

function safeDiagnosticValue(value: unknown): string {
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return String(value);
    case "symbol":
      return "[symbol]";
    case "function":
      return "[function]";
    case "object":
      return value === null ? "null" : "[object]";
  }
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  if (UTF8.encode(value).byteLength <= maximumBytes) return value;
  let end = Math.min(value.length, maximumBytes);
  while (end > 0 && UTF8.encode(value.slice(0, end)).byteLength > maximumBytes) {
    end -= 1;
  }
  return value.slice(0, end);
}

function once(operation: () => void): () => void {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    operation();
  };
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isLoadedExecutionModules(value: unknown): value is LoadedExecutionModules {
  if (!isRecord(value)) return false;
  for (const module of Object.values(value)) {
    if (!isRecord(module)) return false;
  }
  return true;
}
