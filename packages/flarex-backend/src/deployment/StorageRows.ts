import { Effect, Schema } from "effect";
import { validateExecutionArtifactRef } from "flarex/artifacts";
import type { ExecutionArtifactRef } from "../types";
import {
  DeploymentActiveDeploymentInvalidError,
  DeploymentValidationError,
} from "./Errors";

export type DeploymentStorageJsonField =
  | "active_execution_artifact_ref"
  | "source_package_json"
  | "schema_json"
  | "functions_json"
  | "codegen_analysis_json"
  | "diagnostics_json";

const ExecutionArtifactRefShape = Schema.Struct({
  runtime: Schema.String,
  artifactId: Schema.String,
  sourcePackageHash: Schema.String,
  executionModule: Schema.String,
});

const StoredCodegenAnalysisShape = Schema.Struct({
  schema: Schema.Unknown,
  functions: Schema.Array(Schema.Unknown),
});

const StoredDeploymentFunctionsShape = Schema.Struct({
  functions: Schema.Array(Schema.Unknown),
});

const StoredDeploymentSchemaShape = Schema.Struct({
  version: Schema.Number,
  tables: Schema.Array(Schema.Unknown),
  indexes: Schema.Array(Schema.Unknown),
});

const StoredPushSourcePackageShape = Schema.Struct({
  modules: Schema.Array(Schema.Unknown),
  functions: Schema.Array(Schema.Unknown),
  sourceModuleDigestFormat: Schema.optional(
    Schema.Literal("sha256-framed-v1"),
  ),
  schema: Schema.optional(Schema.String),
  authConfig: Schema.optional(Schema.Unknown),
  authConfigModule: Schema.optional(Schema.String),
  execution: Schema.String,
});

const decodeUnknownCodegenAnalysis = Schema.decodeUnknownEffect(StoredCodegenAnalysisShape);
const decodeUnknownDiagnostics = Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown));
const decodeUnknownExecutionArtifactRefShape = Schema.decodeUnknownEffect(ExecutionArtifactRefShape);
const decodeUnknownFunctions = Schema.decodeUnknownEffect(StoredDeploymentFunctionsShape);
const decodeUnknownSchema = Schema.decodeUnknownEffect(StoredDeploymentSchemaShape);
const decodeUnknownSourcePackage = Schema.decodeUnknownEffect(StoredPushSourcePackageShape);

export const decodeDeploymentStorageSourcePackageJson = Effect.fn(
  "DeploymentStorageRows.decodeSourcePackageJson",
)(function* (
  raw: string,
): Effect.fn.Return<typeof StoredPushSourcePackageShape.Type, DeploymentValidationError> {
  const parsed = yield* parseDeploymentStoredPushJson("source_package_json", raw);
  return yield* decodeUnknownSourcePackage(parsed).pipe(
    Effect.mapError(() => storedPushJsonSchemaError("source_package_json")),
  );
});

export const decodeDeploymentStorageSchemaJson = Effect.fn(
  "DeploymentStorageRows.decodeSchemaJson",
)(function* (
  raw: string,
): Effect.fn.Return<typeof StoredDeploymentSchemaShape.Type, DeploymentValidationError> {
  const parsed = yield* parseDeploymentStoredPushJson("schema_json", raw);
  return yield* decodeUnknownSchema(parsed).pipe(
    Effect.mapError(() => storedPushJsonSchemaError("schema_json")),
  );
});

export const decodeDeploymentStorageFunctionsJson = Effect.fn(
  "DeploymentStorageRows.decodeFunctionsJson",
)(function* (
  raw: string,
): Effect.fn.Return<typeof StoredDeploymentFunctionsShape.Type, DeploymentValidationError> {
  const parsed = yield* parseDeploymentStoredPushJson("functions_json", raw);
  return yield* decodeUnknownFunctions(parsed).pipe(
    Effect.mapError(() => storedPushJsonSchemaError("functions_json")),
  );
});

export const decodeDeploymentStorageCodegenAnalysisJson = Effect.fn(
  "DeploymentStorageRows.decodeCodegenAnalysisJson",
)(function* (
  raw: string,
): Effect.fn.Return<typeof StoredCodegenAnalysisShape.Type, DeploymentValidationError> {
  const parsed = yield* parseDeploymentStoredPushJson("codegen_analysis_json", raw);
  return yield* decodeUnknownCodegenAnalysis(parsed).pipe(
    Effect.mapError(() => storedPushJsonSchemaError("codegen_analysis_json")),
  );
});

export const decodeDeploymentStorageDiagnosticsJson = Effect.fn(
  "DeploymentStorageRows.decodeDiagnosticsJson",
)(function* (
  raw: string,
): Effect.fn.Return<ReadonlyArray<unknown>, DeploymentValidationError> {
  const parsed = yield* parseDeploymentStoredPushJson("diagnostics_json", raw);
  return yield* decodeUnknownDiagnostics(parsed).pipe(
    Effect.mapError(() => storedPushJsonSchemaError("diagnostics_json")),
  );
});

export const decodeDeploymentStorageExecutionArtifactRefJson = Effect.fn(
  "DeploymentStorageRows.decodeExecutionArtifactRefJson",
)(function* (
  activePushId: string,
  raw: string | null,
): Effect.fn.Return<ExecutionArtifactRef, DeploymentActiveDeploymentInvalidError> {
  if (raw === null) {
    return yield* Effect.fail(new DeploymentActiveDeploymentInvalidError({
      message: `Active push ${activePushId} has no execution artifact reference.`,
    }));
  }
  const parsed = yield* parseActiveDeploymentJson(raw);
  yield* decodeUnknownExecutionArtifactRefShape(parsed).pipe(
    Effect.mapError(() => new DeploymentActiveDeploymentInvalidError({
      message: "Stored execution artifact reference is invalid.",
    })),
  );
  return yield* Effect.try({
    try: () => validateExecutionArtifactRef(parsed),
    catch: cause => new DeploymentActiveDeploymentInvalidError({
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  });
});

function parseDeploymentStoredPushJson(
  field: DeploymentStorageJsonField,
  raw: string,
): Effect.Effect<unknown, DeploymentValidationError> {
  return Effect.try({
    // Deliberate JSON bridge: stored rows are decoded before schema validation.
    try: () => JSON.parse(raw) as unknown,
    catch: () => new DeploymentValidationError({
      message: `Stored push ${field} must be valid JSON.`,
    }),
  });
}

function parseActiveDeploymentJson(
  raw: string,
): Effect.Effect<unknown, DeploymentActiveDeploymentInvalidError> {
  return Effect.try({
    // Deliberate JSON bridge: active deployment rows are schema-decoded next.
    try: () => JSON.parse(raw) as unknown,
    catch: cause => new DeploymentActiveDeploymentInvalidError({
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  });
}

function storedPushJsonSchemaError(field: DeploymentStorageJsonField): DeploymentValidationError {
  return new DeploymentValidationError({
    message: `Stored push ${field} must match stored schema.`,
  });
}
