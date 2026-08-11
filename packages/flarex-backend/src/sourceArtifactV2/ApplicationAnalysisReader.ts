import {
  SOURCE_ARTIFACT_V2_ROLE_AUTH,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
  type ApplicationManifestSourceArtifactV1Input,
} from "@flarex/analysis/application-analysis";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";

import { sourceArtifactV2DigestBytesFromLowerHex } from "./Digest";
import {
  makeDeclarativeV2ContentReadBudgetTracker,
  makeSourceArtifactV2FinalizedContentReader,
  type SourceArtifactV2FinalizedContentReader,
  type SourceArtifactV2FinalizedContentReaderError,
} from "./FinalizedContentReader";
import {
  makeSourceArtifactV2R2Store,
  type SourceArtifactV2R2Bucket,
} from "./R2Store";
import { makeLiveSourceArtifactV2Sha256 } from "./Sha256";

const LOWERCASE_SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});
const PATH_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_OBJECTS = 65_536n;
const APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_STORED_BYTES = 16_777_216n;
const APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_OUTPUT_BYTES = 4_194_304n;

export interface ApplicationAnalysisSourceModule {
  readonly path: string;
  readonly roles: number;
  readonly sourceSha256: string;
  readonly sourceByteLength: number;
  readonly source: string;
}

export interface ApplicationAnalysisSourceBundle {
  readonly sourceArtifact: ApplicationManifestSourceArtifactV1Input;
  readonly modules: ReadonlyArray<ApplicationAnalysisSourceModule>;
}

export class ApplicationAnalysisSourceReadError extends Data.TaggedError(
  "ApplicationAnalysisSourceReadError",
)<{
  readonly operation: "read";
  readonly reason:
    | "invalidRoot"
    | "limitExceeded"
    | "invalidSourceArtifact"
    | "unsupportedAuth"
    | "invalidSourceText"
    | "sourceReadFailed"
    | "internalFailure";
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export interface ApplicationAnalysisSourceReader {
  readonly read: (
    rootSha256: string,
  ) => Effect.Effect<
    ApplicationAnalysisSourceBundle,
    ApplicationAnalysisSourceReadError
  >;
}

export function makeApplicationAnalysisSourceReader(options: {
  readonly source: SourceArtifactV2FinalizedContentReader;
}): ApplicationAnalysisSourceReader {
  const read = Effect.fn("ApplicationAnalysisSource.read")(function* (
    rootSha256: string,
  ): Effect.fn.Return<
    ApplicationAnalysisSourceBundle,
    ApplicationAnalysisSourceReadError
  > {
    if (!LOWERCASE_SHA256.test(rootSha256)) {
      return yield* new ApplicationAnalysisSourceReadError({
        operation: "read",
        reason: "invalidRoot",
      });
    }
    const budget = yield* Effect.fromResult(applicationAnalysisReadBudget());
    const finalized = yield* options.source.read(
      sourceArtifactV2DigestBytesFromLowerHex(rootSha256),
      budget,
    ).pipe(Effect.mapError(projectSourceReadFailure));
    if (finalized.root.authPath !== null) {
      return yield* new ApplicationAnalysisSourceReadError({
        operation: "read",
        reason: "unsupportedAuth",
        path: finalized.root.authPath,
      });
    }
    const modules: ApplicationAnalysisSourceModule[] = [];
    for (const module of finalized.modules) {
      let source: string;
      let path: string;
      try {
        source = SOURCE_UTF8_DECODER.decode(module.sourceBytes);
        path = PATH_UTF8_DECODER.decode(module.pathBytes);
      } catch (cause) {
        return yield* new ApplicationAnalysisSourceReadError({
          operation: "read",
          reason: "invalidSourceText",
          path: `modules[${module.ordinal}]`,
          cause,
        });
      }
      modules.push(Object.freeze({
        path,
        roles: module.roles,
        sourceSha256: encodeBytesToLowercaseHex(module.sourceSha256),
        sourceByteLength: module.sourceBytes.byteLength,
        source,
      }));
    }
    const relationshipFailure = validateSourceRelationships(
      finalized.root.executionPath,
      finalized.root.schemaPath,
      finalized.root.functionModuleCount,
      modules,
    );
    if (relationshipFailure !== undefined) return yield* relationshipFailure;
    const sourceArtifact: ApplicationManifestSourceArtifactV1Input =
      Object.freeze({
        rootSha256,
        executionModulePath: finalized.root.executionPath,
        schemaModulePath: finalized.root.schemaPath,
        modules: Object.freeze(modules.map(module => Object.freeze({
          path: module.path,
          roles: module.roles,
          sourceSha256: module.sourceSha256,
          sourceByteLength: module.sourceByteLength,
        }))),
      });
    return Object.freeze({
      sourceArtifact,
      modules: Object.freeze(modules),
    });
  });

  return Object.freeze({ read });
}

function validateSourceRelationships(
  executionPath: string,
  schemaPath: string | null,
  functionModuleCount: bigint,
  modules: ReadonlyArray<ApplicationAnalysisSourceModule>,
): ApplicationAnalysisSourceReadError | undefined {
  const executionModules = modules.filter(module =>
    (module.roles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) !== 0
  );
  if (
    executionModules.length !== 1 ||
    executionModules[0]?.path !== executionPath
  ) {
    return new ApplicationAnalysisSourceReadError({
      operation: "read",
      reason: "invalidSourceArtifact",
      path: executionPath,
    });
  }
  const schemaModules = modules.filter(module =>
    (module.roles & SOURCE_ARTIFACT_V2_ROLE_SCHEMA) !== 0
  );
  if (
    (schemaPath === null && schemaModules.length !== 0) ||
    (schemaPath !== null &&
      (schemaModules.length !== 1 || schemaModules[0]?.path !== schemaPath))
  ) {
    return new ApplicationAnalysisSourceReadError({
      operation: "read",
      reason: "invalidSourceArtifact",
      ...(schemaPath === null ? {} : { path: schemaPath }),
    });
  }
  const authModule = modules.find(module =>
    (module.roles & SOURCE_ARTIFACT_V2_ROLE_AUTH) !== 0
  );
  if (authModule !== undefined) {
    return new ApplicationAnalysisSourceReadError({
      operation: "read",
      reason: "unsupportedAuth",
      path: authModule.path,
    });
  }
  const observedFunctionModuleCount = modules.reduce(
    (count, module) => count + (
      (module.roles & SOURCE_ARTIFACT_V2_ROLE_FUNCTION) === 0 ? 0n : 1n
    ),
    0n,
  );
  return observedFunctionModuleCount === functionModuleCount
    ? undefined
    : new ApplicationAnalysisSourceReadError({
      operation: "read",
      reason: "invalidSourceArtifact",
      path: "functionModuleCount",
    });
}

export function makeApplicationAnalysisR2SourceReader(
  bucket: SourceArtifactV2R2Bucket,
): ApplicationAnalysisSourceReader {
  const r2 = makeSourceArtifactV2R2Store(
    bucket,
    makeLiveSourceArtifactV2Sha256(),
  );
  return makeApplicationAnalysisSourceReader({
    source: makeSourceArtifactV2FinalizedContentReader({
      r2,
      sourceMaps: "ignore",
    }),
  });
}

function applicationAnalysisReadBudget(): Result.Result<
  ReturnType<typeof makeDeclarativeV2ContentReadBudgetTracker> extends
    Result.Result<infer Success, unknown> ? Success : never,
  ApplicationAnalysisSourceReadError
> {
  const ceilings = budgetFrame("attempt_ceilings");
  const usage = budgetFrame("attempt_usage", 0n);
  const command = budgetFrame("command_budget");
  return makeDeclarativeV2ContentReadBudgetTracker({
    ceilings,
    usage,
    command,
  }).pipe(Result.mapError(projectSourceReadFailure));
}

function budgetFrame(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  override?: bigint,
): DeclarativeV2VerifierBudgetFrameV2 {
  const values: Record<string, bigint | string> = { kind };
  for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
    values[dimension] = override ?? applicationAnalysisDimensionLimit(dimension);
  }
  return Object.freeze(values) as DeclarativeV2VerifierBudgetFrameV2;
}

function applicationAnalysisDimensionLimit(
  dimension: typeof DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2[number],
): bigint {
  switch (dimension) {
    case "calls":
    case "objectCalls":
    case "graphNodes":
    case "frontierEntries":
      return APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_OBJECTS;
    case "modules":
      return BigInt(APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1);
    case "sourceBytes":
      return BigInt(APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1);
    case "objectBodyBytes":
    case "canonicalBytes":
    case "frameBytes":
    case "hashBytes":
      return APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_STORED_BYTES;
    case "stringBytes":
    case "outputBytes":
      return APPLICATION_ANALYSIS_SOURCE_READ_MAXIMUM_OUTPUT_BYTES;
    default:
      return 0n;
  }
}

function projectSourceReadFailure(
  cause: SourceArtifactV2FinalizedContentReaderError,
): ApplicationAnalysisSourceReadError {
  return new ApplicationAnalysisSourceReadError({
    operation: "read",
    reason: sourceReadFailureReason(cause),
    cause,
  });
}

function sourceReadFailureReason(
  cause: SourceArtifactV2FinalizedContentReaderError,
): ApplicationAnalysisSourceReadError["reason"] {
  switch (cause._tag) {
    case "DeclarativeV2ContentReadBudgetError":
      return "limitExceeded";
    case "SourceArtifactV2FinalizedContentCorruptionError":
    case "DeclarativeV2ArtifactModulePathV1Error":
    case "SourceArtifactV2R2NotFoundError":
    case "SourceArtifactV2R2CorruptionError":
      return "invalidSourceArtifact";
    case "SourceArtifactV2R2InputError":
      return "internalFailure";
    case "SourceArtifactV2Sha256InputError":
      return cause.reason === "inputBytesExceeded"
        ? "invalidSourceArtifact"
        : "internalFailure";
    case "SourceArtifactV2R2ResourceError":
    case "SourceArtifactV2R2SettlementUncertainError":
    case "SourceArtifactV2Sha256ResourceError":
      return "sourceReadFailed";
  }
}
