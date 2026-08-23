import {
  ApplicationAnalysisRejectionCodeV1,
  makeApplicationManifest,
  type ApplicationAnalysisRejectionCodeV1 as ApplicationAnalysisRejectionCode,
  type ApplicationManifestSourceArtifactV1Input,
} from "@flarex/analysis/application-analysis";
import {
  ApplicationRelationAnalysisError,
  analyzeLoadedApplicationSourcePackageEffect,
  type AnalyzerDiagnostic,
  type LoadedExecutionModules,
} from "@flarex/analysis";
import {
  ApplicationImportForbiddenEffectV1,
  installApplicationImportPolicyV1,
} from "@flarex/analysis/internal/application-import-policy-v1";
import { Cause, Effect, Exit, Result, Scheduler } from "effect";

export * from "flarex/server";
export * from "flarex/values";

const MAXIMUM_DIAGNOSTICS = 100;
const MAXIMUM_DIAGNOSTIC_BYTES = 65_536;
const MAXIMUM_DIAGNOSTIC_MESSAGE_BYTES = 2_048;
const UTF8 = new TextEncoder();
// Capture the host timer before a cold load installs the application import
// policy. Only analyzer-owned Effect scheduling receives this capability;
// application code continues to observe the policy-patched global timer.
const ANALYZER_SET_TIMEOUT = globalThis.setTimeout.bind(globalThis);
const ANALYZER_CLEAR_TIMEOUT = globalThis.clearTimeout.bind(globalThis);
const APPLICATION_ANALYSIS_SCHEDULER = new Scheduler.MixedScheduler(
  "async",
  task => {
    const handle = ANALYZER_SET_TIMEOUT(task, 0);
    return () => ANALYZER_CLEAR_TIMEOUT(handle);
  },
);

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

export async function runApplicationAnalysisColdLoad(
  input: ApplicationAnalysisColdLoadInput,
): Promise<ApplicationAnalysisColdLoadOutcome> {
  const diagnostics = makeDiagnosticCapture();
  const restoreConsole = installConsoleCapture(diagnostics);
  const importPolicy = installApplicationImportPolicyV1({
    onForbidden: operation => diagnostics.appendMessage(
      "error",
      `${operation} is forbidden during application import.`,
    ),
  });
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
        cause instanceof ApplicationImportForbiddenEffectV1 ||
            importPolicy.forbiddenAttempted()
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
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const analysis = yield* analyzeLoadedApplicationSourcePackageEffect({
          executionModules,
          schemaDefinition,
          sourceMaps: {},
          sourceMapFailure: "ignore",
        });
        return yield* makeApplicationManifest(analysis, input.sourceArtifact);
      }),
      { scheduler: APPLICATION_ANALYSIS_SCHEDULER },
    );
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
    return Result.match(failure, {
      onFailure: () => {
        throw new Error(
          "Application Analysis core encountered an unexpected defect.",
        );
      },
      onSuccess: value => rejected(classifyAnalysisFailure(value), diagnostics),
    });
  } catch (cause) {
    if (
      cause instanceof ApplicationImportForbiddenEffectV1 ||
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
  if (value instanceof ApplicationRelationAnalysisError) {
    return value.issue.reason === "relationLimitExceeded" ||
        value.issue.reason === "relationDeclarationBytesExceeded"
      ? ApplicationAnalysisRejectionCodeV1.limitExceeded
      : ApplicationAnalysisRejectionCodeV1.invalidSchema;
  }
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
