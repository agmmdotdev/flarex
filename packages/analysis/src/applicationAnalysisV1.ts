import { Data, Effect, Result, Schema, SchemaGetter } from "effect";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  backendCodegenAnalysisFromCodegenAnalysisEffect,
  type AnalyzerPartitionError,
  type AnalyzerValidatorError,
  type DeploymentAnalysis,
} from "./index.ts";
import {
  encodeCanonicalJson,
  isJson,
  measureCanonicalJsonUtf8Bytes,
} from "flarex-protocol/json";
import { isCanonicalIsoTimestamp } from "flarex-protocol/iso-timestamp";
import { selectorNameForPartitionField } from "flarex-protocol/partition-selector";
import {
  ValidatorJsonV1,
  validatorJsonAdmissionIssueV1,
} from "flarex-protocol/validator-json";
import { isDeclarativeV2ArtifactModulePathV1 } from "flarex-protocol/internal/declarative-v2-artifact-module-path-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_AUTH,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";

export const APPLICATION_MANIFEST_FORMAT_V1 =
  "flarex.application-manifest" as const;
export const APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1 =
  "flarex.application-analysis-receipt" as const;
export const ApplicationAnalysisRejectionCodeV1 = Object.freeze({
  invalidSourceArtifact: "invalid_source_artifact",
  moduleImportFailed: "module_import_failed",
  forbiddenImportEffect: "forbidden_import_effect",
  invalidRegistration: "invalid_registration",
  invalidSchema: "invalid_schema",
  limitExceeded: "limit_exceeded",
  timeout: "timeout",
  nondeterministicRegistration: "nondeterministic_registration",
} as const);
export type ApplicationAnalysisRejectionCodeV1 =
  typeof ApplicationAnalysisRejectionCodeV1[
    keyof typeof ApplicationAnalysisRejectionCodeV1
  ];

export const APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1 = 128;
export const APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1 = 1_048_576;
export const APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1 = 2_000_000;
export const APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1 = 1_024;
export const APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1 = 256;
export const APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1 = 1_024;
export const APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1 = 1_048_576;
export const APPLICATION_ANALYSIS_MAXIMUM_RECEIPT_BYTES_V1 = 65_536;
export const APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1 = 8_192;

const UTF8 = new TextEncoder();
const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const NonemptyStringSchema = Schema.String.check(
  Schema.makeFilter(value => value.length > 0 ? undefined : "Expected a nonempty string"),
);
const BoundedIdentitySchema = NonemptyStringSchema.check(
  Schema.isMaxLength(256),
);
const ApplicationModuleNameSchema = NonemptyStringSchema.check(
  Schema.makeFilter(value => value.includes(":")
    ? "Application module names must not contain a colon"
    : undefined),
);
const ApplicationExportNameSchema = NonemptyStringSchema.check(
  Schema.makeFilter(value => value.includes(":")
    ? "Application export names must not contain a colon"
    : undefined),
);
const LowercaseSha256Schema = Schema.String.check(
  Schema.makeFilter(value => /^[0-9a-f]{64}$/.test(value)
    ? undefined
    : "Expected an exact lowercase hexadecimal SHA-256 digest"),
).pipe(Schema.brand("Flarex/ApplicationAnalysisSha256V1"));
const NonNegativeSafeIntegerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const PositiveSafeIntegerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const ModuleRolesSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 15 }),
);
const SourceByteLengthSchema = NonNegativeSafeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1),
);
const CanonicalIsoTimestampSchema = Schema.String.check(
  Schema.makeFilter(value => isCanonicalIsoTimestamp(value)
    ? undefined
    : "Expected a canonical ECMAScript ISO timestamp"),
);
const ApplicationManifestModuleV1Schema = Schema.Struct({
  path: NonemptyStringSchema,
  roles: ModuleRolesSchema,
  sourceSha256: LowercaseSha256Schema,
  sourceByteLength: SourceByteLengthSchema,
}).annotate(StrictStructOptions);
const ApplicationManifestModulesV1Schema = Schema.Unknown.check(
  Schema.makeFilter(value =>
    Array.isArray(value) &&
      value.length > APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1
      ? `Expected at most ${APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1} source modules`
      : undefined
  ),
).pipe(Schema.decodeTo(
  Schema.Array(ApplicationManifestModuleV1Schema).check(Schema.isMinLength(1)),
));

const ApplicationTablePlacementV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("partitionBy"),
    field: Schema.String,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    kind: Schema.Literal("colocateWith"),
    table: Schema.String,
    field: Schema.String,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    kind: Schema.Literal("global"),
  }).annotate(StrictStructOptions),
]);

const AdmittedValidatorJsonV1Schema = Schema.Unknown.check(
  Schema.makeFilter(value => {
    const issue = validatorJsonAdmissionIssueV1(value);
    return issue === undefined
      ? undefined
      : `Validator JSON exceeds the admitted profile: ${issue.reason}`;
  }),
).pipe(Schema.decodeTo(ValidatorJsonV1));

const ApplicationManifestTableV1Schema = Schema.Struct({
  tableId: PositiveSafeIntegerSchema,
  name: NonemptyStringSchema,
  validator: AdmittedValidatorJsonV1Schema,
  placement: ApplicationTablePlacementV1Schema,
}).annotate(StrictStructOptions);

const ApplicationManifestIndexV1Schema = Schema.Struct({
  indexId: PositiveSafeIntegerSchema,
  tableId: PositiveSafeIntegerSchema,
  name: NonemptyStringSchema,
  fields: Schema.Array(NonemptyStringSchema),
}).annotate(StrictStructOptions);

const ApplicationManifestTablesV1Schema = Schema.Unknown.check(
  Schema.makeFilter(value =>
    Array.isArray(value) &&
      value.length > APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1
      ? `Expected at most ${APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1} tables`
      : undefined
  ),
).pipe(Schema.decodeTo(Schema.Array(ApplicationManifestTableV1Schema)));

const ApplicationManifestIndexesV1Schema = Schema.Unknown.check(
  Schema.makeFilter(value =>
    Array.isArray(value) &&
      value.length > APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1
      ? `Expected at most ${APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1} indexes`
      : undefined
  ),
).pipe(Schema.decodeTo(Schema.Array(ApplicationManifestIndexV1Schema)));

const ApplicationSchemaManifestV1Schema = Schema.Struct({
  version: Schema.Literal(1),
  tables: ApplicationManifestTablesV1Schema,
  indexes: ApplicationManifestIndexesV1Schema,
}).annotate(StrictStructOptions);

const ApplicationManifestFunctionV1Schema = Schema.Struct({
  path: NonemptyStringSchema,
  moduleName: ApplicationModuleNameSchema,
  exportName: ApplicationExportNameSchema,
  kind: Schema.Union([
    Schema.Literal("query"),
    Schema.Literal("mutation"),
    Schema.Literal("workflowMutation"),
    Schema.Literal("action"),
  ]),
  visibility: Schema.Union([
    Schema.Literal("public"),
    Schema.Literal("internal"),
  ]),
  args: AdmittedValidatorJsonV1Schema,
  returns: Schema.Union([AdmittedValidatorJsonV1Schema, Schema.Null]),
  partition: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("partition"),
      table: Schema.String,
      selector: Schema.String,
      partitionField: Schema.String,
      argField: Schema.String,
    }).annotate(StrictStructOptions),
    Schema.Struct({
      type: Schema.Literal("partitionCreateRoot"),
      table: Schema.String,
      partitionField: Schema.Literal("_id"),
    }).annotate(StrictStructOptions),
    Schema.Null,
  ]),
}).annotate(StrictStructOptions);

const ApplicationManifestFunctionsV1Schema = Schema.Unknown.check(
  Schema.makeFilter(value =>
    Array.isArray(value) &&
      value.length > APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1
      ? `Expected at most ${APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1} functions`
      : undefined
  ),
).pipe(Schema.decodeTo(Schema.Array(ApplicationManifestFunctionV1Schema)));

const ApplicationManifestV1StructuralSchema = Schema.Struct({
  format: Schema.Literal(APPLICATION_MANIFEST_FORMAT_V1),
  version: Schema.Literal(1),
  sourceArtifact: Schema.Struct({
    rootSha256: LowercaseSha256Schema,
    executionModulePath: NonemptyStringSchema,
    schemaModulePath: Schema.Union([NonemptyStringSchema, Schema.Null]),
    modules: ApplicationManifestModulesV1Schema,
  }).annotate(StrictStructOptions),
  schema: ApplicationSchemaManifestV1Schema,
  functions: ApplicationManifestFunctionsV1Schema,
}).annotate(StrictStructOptions);

export type ApplicationManifestV1 =
  typeof ApplicationManifestV1StructuralSchema.Type;

const ApplicationManifestV1SemanticSchema =
  ApplicationManifestV1StructuralSchema.check(
    Schema.makeFilter(value => {
      const verdict = validateApplicationManifestV1(value, "decodeManifest");
      return Result.isFailure(verdict)
        ? `Invalid Application Manifest V1: ${verdict.failure.reason}`
        : undefined;
    }),
  );

const OwnedApplicationManifestV1Schema = Schema.declare<ApplicationManifestV1>(
  (value): value is ApplicationManifestV1 =>
    isNonArrayRecord(value) && isDeeplyFrozenJson(value),
  { identifier: "OwnedApplicationManifestV1" },
);

export const ApplicationManifestV1Schema =
  ApplicationManifestV1SemanticSchema.pipe(Schema.decodeTo(
    OwnedApplicationManifestV1Schema,
    {
      decode: SchemaGetter.transform(snapshotApplicationManifestV1),
      encode: SchemaGetter.transform(snapshotApplicationManifestV1),
    },
  ));

export type ApplicationAnalysisSha256V1 = typeof LowercaseSha256Schema.Type;

const ApplicationAnalysisReceiptBaseV1Schema = {
  format: Schema.Literal(APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1),
  version: Schema.Literal(1),
  analysisId: BoundedIdentitySchema,
  candidateId: BoundedIdentitySchema,
  scopeId: BoundedIdentitySchema,
  sourceArtifactRootSha256: LowercaseSha256Schema,
  analyzerIdentity: BoundedIdentitySchema,
  analyzerPolicyIdentity: BoundedIdentitySchema,
  completedAt: CanonicalIsoTimestampSchema,
} as const;

const AnalyzedApplicationAnalysisReceiptV1Schema = Schema.Struct({
  ...ApplicationAnalysisReceiptBaseV1Schema,
  status: Schema.Literal("analyzed"),
  manifestSha256: LowercaseSha256Schema,
}).annotate(StrictStructOptions);

const RejectedApplicationAnalysisReceiptV1Schema = Schema.Struct({
  ...ApplicationAnalysisReceiptBaseV1Schema,
  status: Schema.Literal("rejected"),
  failureCode: Schema.Union([
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.invalidSourceArtifact),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.moduleImportFailed),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.forbiddenImportEffect),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.invalidRegistration),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.invalidSchema),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.limitExceeded),
    Schema.Literal(ApplicationAnalysisRejectionCodeV1.timeout),
    Schema.Literal(
      ApplicationAnalysisRejectionCodeV1.nondeterministicRegistration,
    ),
  ]),
  detail: Schema.String.check(
    Schema.makeFilter(value =>
      UTF8.encode(value).byteLength <=
          APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1
        ? undefined
        : `Expected at most ${APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1} UTF-8 bytes`
    ),
  ),
}).annotate(StrictStructOptions);

const ApplicationAnalysisReceiptV1StructuralSchema = Schema.Union([
  AnalyzedApplicationAnalysisReceiptV1Schema,
  RejectedApplicationAnalysisReceiptV1Schema,
]);
export type ApplicationAnalysisReceiptV1 =
  typeof ApplicationAnalysisReceiptV1StructuralSchema.Type;

const OwnedApplicationAnalysisReceiptV1Schema =
  Schema.declare<ApplicationAnalysisReceiptV1>(
    (value): value is ApplicationAnalysisReceiptV1 =>
      isNonArrayRecord(value) && isDeeplyFrozenJson(value),
    { identifier: "OwnedApplicationAnalysisReceiptV1" },
  );

export const ApplicationAnalysisReceiptV1Schema =
  ApplicationAnalysisReceiptV1StructuralSchema.pipe(Schema.decodeTo(
    OwnedApplicationAnalysisReceiptV1Schema,
    {
      decode: SchemaGetter.transform(snapshotApplicationAnalysisReceiptV1),
      encode: SchemaGetter.transform(snapshotApplicationAnalysisReceiptV1),
    },
  ));

export interface CanonicalApplicationManifestV1 {
  readonly manifest: ApplicationManifestV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export interface CanonicalApplicationAnalysisReceiptV1 {
  readonly receipt: ApplicationAnalysisReceiptV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationAnalysisContractError extends Data.TaggedError(
  "ApplicationAnalysisContractError",
)<{
  readonly operation: "decodeManifest" | "encodeManifest" | "decodeReceipt" |
    "encodeReceipt" | "lowerManifest";
  readonly reason: "invalidInput" | "duplicateModulePath" |
    "invalidSourceModulePath" |
    "missingExecutionModule" | "sourceBytesExceeded" |
    "manifestBytesExceeded" | "receiptBytesExceeded" |
    "invalidAnalyzedFunction" | "noncanonicalOrder" |
    "duplicateFunctionPath" | "invalidFunctionPath" |
    "invalidExecutionModuleRole" | "missingSchemaModule" |
    "invalidSchemaModuleRole" | "unsupportedAuthModule" |
    "invalidSchemaRelationship" | "validatorLimitExceeded" |
    "limitExceeded";
  readonly path?: string;
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}> {}

function preflightApplicationManifest(
  value: unknown,
  operation: "decodeManifest" | "lowerManifest",
): ApplicationAnalysisContractError | undefined {
  try {
    if (!isNonArrayRecord(value)) return undefined;
    const sourceArtifactRead = readOwnDataProperty(value, "sourceArtifact");
    if (sourceArtifactRead.kind === "accessor") {
      return invalidManifestPreflight(operation, "sourceArtifact");
    }
    if (
      sourceArtifactRead.kind === "value" &&
      isNonArrayRecord(sourceArtifactRead.value)
    ) {
      const modulesRead = readOwnDataProperty(sourceArtifactRead.value, "modules");
      if (modulesRead.kind === "accessor") {
        return invalidManifestPreflight(operation, "sourceArtifact.modules");
      }
      if (modulesRead.kind === "value" && Array.isArray(modulesRead.value)) {
        if (modulesRead.value.length > APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1) {
          return limitExceededFailure(
            operation,
            "sourceArtifact.modules",
            modulesRead.value.length,
            APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
          );
        }
        let totalSourceBytes = 0;
        for (let index = 0; index < modulesRead.value.length; index += 1) {
          const moduleRead = readOwnDataProperty(modulesRead.value, String(index));
          if (moduleRead.kind === "accessor") {
            return invalidManifestPreflight(
              operation,
              `sourceArtifact.modules[${index}]`,
            );
          }
          if (moduleRead.kind !== "value" || !isNonArrayRecord(moduleRead.value)) {
            continue;
          }
          const byteLengthRead = readOwnDataProperty(
            moduleRead.value,
            "sourceByteLength",
          );
          if (byteLengthRead.kind === "accessor") {
            return invalidManifestPreflight(
              operation,
              `sourceArtifact.modules[${index}].sourceByteLength`,
            );
          }
          if (
            byteLengthRead.kind !== "value" ||
            typeof byteLengthRead.value !== "number" ||
            !Number.isSafeInteger(byteLengthRead.value) ||
            byteLengthRead.value < 0
          ) continue;
          if (
            byteLengthRead.value > APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1
          ) {
            return limitExceededFailure(
              operation,
              `sourceArtifact.modules[${index}].sourceByteLength`,
              byteLengthRead.value,
              APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
            );
          }
          totalSourceBytes += byteLengthRead.value;
          if (totalSourceBytes > APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1) {
            return limitExceededFailure(
              operation,
              "sourceArtifact.modules",
              totalSourceBytes,
              APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
            );
          }
        }
      }
    }
    const schemaRead = readOwnDataProperty(value, "schema");
    if (schemaRead.kind === "accessor") {
      return invalidManifestPreflight(operation, "schema");
    }
    if (schemaRead.kind === "value" && isNonArrayRecord(schemaRead.value)) {
      const tablesRead = readOwnDataProperty(schemaRead.value, "tables");
      if (tablesRead.kind === "accessor") {
        return invalidManifestPreflight(operation, "schema.tables");
      }
      if (tablesRead.kind === "value" && Array.isArray(tablesRead.value)) {
        if (tablesRead.value.length > APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1) {
          return limitExceededFailure(
            operation,
            "schema.tables",
            tablesRead.value.length,
            APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1,
          );
        }
        for (let index = 0; index < tablesRead.value.length; index += 1) {
          const tableRead = readOwnDataProperty(tablesRead.value, String(index));
          if (tableRead.kind === "accessor") {
            return invalidManifestPreflight(operation, `schema.tables[${index}]`);
          }
          if (tableRead.kind !== "value" || !isNonArrayRecord(tableRead.value)) {
            continue;
          }
          const validatorRead = readOwnDataProperty(tableRead.value, "validator");
          if (validatorRead.kind === "accessor") {
            return invalidManifestPreflight(
              operation,
              `schema.tables[${index}].validator`,
            );
          }
          if (validatorRead.kind === "value") {
            const failure = validatorAdmissionFailure(
              operation,
              `schema.tables[${index}].validator`,
              validatorRead.value,
            );
            if (failure !== undefined) return failure;
          }
        }
      }
      const indexesRead = readOwnDataProperty(schemaRead.value, "indexes");
      if (indexesRead.kind === "accessor") {
        return invalidManifestPreflight(operation, "schema.indexes");
      }
      if (
        indexesRead.kind === "value" && Array.isArray(indexesRead.value) &&
        indexesRead.value.length > APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1
      ) {
        return limitExceededFailure(
          operation,
          "schema.indexes",
          indexesRead.value.length,
          APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1,
        );
      }
    }

    const functionsRead = readOwnDataProperty(value, "functions");
    if (functionsRead.kind === "accessor") {
      return invalidManifestPreflight(operation, "functions");
    }
    if (functionsRead.kind !== "value" || !Array.isArray(functionsRead.value)) {
      return undefined;
    }
    if (functionsRead.value.length > APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1) {
      return limitExceededFailure(
        operation,
        "functions",
        functionsRead.value.length,
        APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1,
      );
    }
    for (let index = 0; index < functionsRead.value.length; index += 1) {
      const functionRead = readOwnDataProperty(functionsRead.value, String(index));
      if (functionRead.kind === "accessor") {
        return invalidManifestPreflight(operation, `functions[${index}]`);
      }
      if (
        functionRead.kind !== "value" ||
        !isNonArrayRecord(functionRead.value)
      ) continue;
      for (const key of ["args", "returns"] as const) {
        const validatorRead = readOwnDataProperty(functionRead.value, key);
        if (validatorRead.kind === "accessor") {
          return invalidManifestPreflight(
            operation,
            `functions[${index}].${key}`,
          );
        }
        if (
          validatorRead.kind === "value" &&
          !(key === "returns" && validatorRead.value === null)
        ) {
          const failure = validatorAdmissionFailure(
            operation,
            `functions[${index}].${key}`,
            validatorRead.value,
          );
          if (failure !== undefined) return failure;
        }
      }
    }
    return undefined;
  } catch (cause) {
    return new ApplicationAnalysisContractError({
      operation,
      reason: "invalidInput",
      cause,
    });
  }
}

function limitExceededFailure(
  operation: "decodeManifest" | "lowerManifest" | "decodeReceipt",
  path: string,
  observed: number,
  maximum: number,
): ApplicationAnalysisContractError {
  return new ApplicationAnalysisContractError({
    operation,
    reason: "limitExceeded",
    path,
    observed,
    maximum,
  });
}

function preflightApplicationAnalysisReceipt(
  value: unknown,
): ApplicationAnalysisContractError | undefined {
  try {
    if (!isNonArrayRecord(value)) return undefined;
    const detailRead = readOwnDataProperty(value, "detail");
    if (detailRead.kind === "accessor") {
      return new ApplicationAnalysisContractError({
        operation: "decodeReceipt",
        reason: "invalidInput",
        path: "detail",
      });
    }
    if (
      detailRead.kind === "value" && typeof detailRead.value === "string"
    ) {
      const observed = UTF8.encode(detailRead.value).byteLength;
      if (observed > APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1) {
        return limitExceededFailure(
          "decodeReceipt",
          "detail",
          observed,
          APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1,
        );
      }
    }
    return undefined;
  } catch (cause) {
    return new ApplicationAnalysisContractError({
      operation: "decodeReceipt",
      reason: "invalidInput",
      cause,
    });
  }
}

function validatorAdmissionFailure(
  operation: "decodeManifest" | "lowerManifest",
  path: string,
  value: unknown,
): ApplicationAnalysisContractError | undefined {
  const issue = validatorJsonAdmissionIssueV1(value);
  return issue === undefined
    ? undefined
    : new ApplicationAnalysisContractError({
        operation,
        reason: "validatorLimitExceeded",
        path,
        cause: issue,
      });
}

function invalidManifestPreflight(
  operation: "decodeManifest" | "lowerManifest",
  path: string,
): ApplicationAnalysisContractError {
  return new ApplicationAnalysisContractError({
    operation,
    reason: "invalidInput",
    path,
  });
}

type OwnDataPropertyRead =
  | Readonly<{ readonly kind: "missing" | "accessor" }>
  | Readonly<{ readonly kind: "value"; readonly value: unknown }>;

function readOwnDataProperty(
  value: object,
  key: PropertyKey,
): OwnDataPropertyRead {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return { kind: "missing" };
  return "value" in descriptor
    ? { kind: "value", value: descriptor.value }
    : { kind: "accessor" };
}

const decodeApplicationManifestV1ShapeResult = Schema.decodeUnknownResult(
  ApplicationManifestV1StructuralSchema,
  StrictParseOptions,
);
const decodeApplicationAnalysisReceiptV1ShapeResult = Schema.decodeUnknownResult(
  ApplicationAnalysisReceiptV1StructuralSchema,
  StrictParseOptions,
);

export function decodeApplicationManifestV1(
  value: unknown,
): Result.Result<ApplicationManifestV1, ApplicationAnalysisContractError> {
  return decodeApplicationManifestV1ForOperation(value, "decodeManifest");
}

function decodeApplicationManifestV1ForOperation(
  value: unknown,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<ApplicationManifestV1, ApplicationAnalysisContractError> {
  const admissionFailure = preflightApplicationManifest(value, operation);
  if (admissionFailure !== undefined) return Result.fail(admissionFailure);
  return decodeApplicationManifestV1ShapeResult(value).pipe(
    Result.mapError(cause => new ApplicationAnalysisContractError({
      operation,
      reason: "invalidInput",
      cause,
    })),
    Result.flatMap(manifest => validateApplicationManifestV1(manifest, operation)),
    Result.map(snapshotApplicationManifestV1),
  );
}

export function decodeApplicationAnalysisReceiptV1(
  value: unknown,
): Result.Result<ApplicationAnalysisReceiptV1, ApplicationAnalysisContractError> {
  const admissionFailure = preflightApplicationAnalysisReceipt(value);
  if (admissionFailure !== undefined) return Result.fail(admissionFailure);
  return decodeApplicationAnalysisReceiptV1ShapeResult(value).pipe(
    Result.map(snapshotApplicationAnalysisReceiptV1),
    Result.mapError(cause => new ApplicationAnalysisContractError({
      operation: "decodeReceipt",
      reason: "invalidInput",
      cause,
    })),
  );
}

export function canonicalizeApplicationManifestV1(
  value: unknown,
): Result.Result<CanonicalApplicationManifestV1, ApplicationAnalysisContractError> {
  return canonicalizeApplicationManifestV1ForOperation(
    value,
    "decodeManifest",
    "encodeManifest",
  );
}

function canonicalizeApplicationManifestV1ForOperation(
  value: unknown,
  decodeOperation: "decodeManifest" | "lowerManifest",
  encodeOperation: "encodeManifest" | "lowerManifest",
): Result.Result<CanonicalApplicationManifestV1, ApplicationAnalysisContractError> {
  return Result.gen(function* () {
    const manifest = yield* decodeApplicationManifestV1ForOperation(
      value,
      decodeOperation,
    );
    const canonical = yield* canonicalJsonBytes(
      manifest,
      APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
      encodeOperation,
      "manifestBytesExceeded",
    );
    return Object.freeze({ manifest, ...canonical });
  });
}

export function canonicalizeApplicationAnalysisReceiptV1(
  value: unknown,
): Result.Result<
  CanonicalApplicationAnalysisReceiptV1,
  ApplicationAnalysisContractError
> {
  return Result.gen(function* () {
    const receipt = yield* decodeApplicationAnalysisReceiptV1(value);
    const canonical = yield* canonicalJsonBytes(
      receipt,
      APPLICATION_ANALYSIS_MAXIMUM_RECEIPT_BYTES_V1,
      "encodeReceipt",
      "receiptBytesExceeded",
    );
    return Object.freeze({ receipt, ...canonical });
  });
}

export interface ApplicationManifestSourceArtifactV1Input {
  readonly rootSha256: string;
  readonly executionModulePath: string;
  readonly schemaModulePath: string | null;
  readonly modules: ReadonlyArray<{
    readonly path: string;
    readonly roles: number;
    readonly sourceSha256: string;
    readonly sourceByteLength: number;
  }>;
}

export const makeApplicationManifestV1 = Effect.fn(
  "ApplicationAnalysis.makeManifestV1",
)(function* (
  analysis: DeploymentAnalysis,
  sourceArtifact: ApplicationManifestSourceArtifactV1Input,
): Effect.fn.Return<
  CanonicalApplicationManifestV1,
  ApplicationAnalysisContractError | AnalyzerValidatorError |
    AnalyzerPartitionError
> {
  const source = yield* Effect.fromResult(
    validateAndOrderSourceArtifact(sourceArtifact),
  );
  yield* Effect.fromResult(preflightDeploymentAnalysis(analysis));
  const deployment = yield* backendCodegenAnalysisFromCodegenAnalysisEffect(
    analysis,
  );
  const functions: Array<{
    readonly path: string;
    readonly moduleName: string;
    readonly exportName: string;
    readonly kind: "query" | "mutation" | "workflowMutation" | "action";
    readonly visibility: "public" | "internal";
    readonly args: typeof ValidatorJsonV1.Type;
    readonly returns: typeof ValidatorJsonV1.Type | null;
    readonly partition:
      ApplicationManifestV1["functions"][number]["partition"];
  }> = [];
  for (const module of deployment.functions) {
    for (const fn of module.functions) {
      const path = functionPath(module.moduleName, fn.exportName);
      if (
        fn.moduleName !== module.moduleName ||
        !isApplicationFunctionName(module.moduleName) ||
        !isApplicationFunctionName(fn.exportName) ||
        fn.visibility === undefined || fn.args === undefined ||
        fn.args === null || fn.returns === undefined ||
        fn.partition === undefined
      ) {
        return yield* new ApplicationAnalysisContractError({
          operation: "lowerManifest",
          reason: "invalidAnalyzedFunction",
          path,
        });
      }
      functions.push({
        path,
        moduleName: module.moduleName,
        exportName: fn.exportName,
        kind: fn.kind,
        visibility: fn.visibility,
        args: fn.args,
        returns: fn.returns,
        partition: fn.partition,
      });
    }
  }
  const tables = deployment.schema.tables.map(table => {
    if (table.validator === undefined || table.validator === null) {
      throw new Error("Analyzed application table lost its required validator.");
    }
    return {
      tableId: table.tableId,
      name: table.name,
      validator: table.validator,
      placement: table.placement,
    };
  });
  return yield* Effect.fromResult(canonicalizeApplicationManifestV1ForOperation({
    format: APPLICATION_MANIFEST_FORMAT_V1,
    version: 1,
    sourceArtifact: source,
    schema: {
      version: deployment.schema.version,
      tables,
      indexes: deployment.schema.indexes.map(index => ({
        indexId: index.indexId,
        tableId: index.tableId,
        name: index.name,
        fields: index.fields,
      })),
    },
    functions,
  }, "lowerManifest", "lowerManifest"));
});

function preflightDeploymentAnalysis(
  analysis: DeploymentAnalysis,
): Result.Result<void, ApplicationAnalysisContractError> {
  if (analysis.schema.tables.length > APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1) {
    return Result.fail(limitExceededFailure(
      "lowerManifest",
      "schema.tables",
      analysis.schema.tables.length,
      APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1,
    ));
  }
  if (analysis.schema.indexes.length > APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1) {
    return Result.fail(limitExceededFailure(
      "lowerManifest",
      "schema.indexes",
      analysis.schema.indexes.length,
      APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1,
    ));
  }
  for (let index = 0; index < analysis.schema.tables.length; index += 1) {
    const table = analysis.schema.tables[index];
    if (table === undefined) {
      throw new Error("Application Analysis table array lost an item.");
    }
    const failure = validatorAdmissionFailure(
      "lowerManifest",
      `schema.tables[${index}].validator`,
      table.validator,
    );
    if (failure !== undefined) return Result.fail(failure);
  }
  let functionCount = 0;
  for (let moduleIndex = 0; moduleIndex < analysis.functions.length; moduleIndex += 1) {
    const module = analysis.functions[moduleIndex];
    if (module === undefined) {
      throw new Error("Application Analysis module array lost an item.");
    }
    functionCount += module.functions.length;
    if (functionCount > APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1) {
      return Result.fail(limitExceededFailure(
        "lowerManifest",
        "functions",
        functionCount,
        APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1,
      ));
    }
    for (let functionIndex = 0; functionIndex < module.functions.length; functionIndex += 1) {
      const fn = module.functions[functionIndex];
      if (fn === undefined) {
        throw new Error("Application Analysis function array lost an item.");
      }
      for (const [key, validator] of [
        ["args", fn.args],
        ...(fn.returns === null
          ? []
          : [["returns", fn.returns] as const]),
      ] as const) {
        const failure = validatorAdmissionFailure(
          "lowerManifest",
          `functions[${moduleIndex}][${functionIndex}].${key}`,
          validator,
        );
        if (failure !== undefined) return Result.fail(failure);
      }
    }
  }
  return Result.succeed(undefined);
}

function validateAndOrderSourceArtifact(
  input: ApplicationManifestSourceArtifactV1Input,
): Result.Result<
  ApplicationManifestSourceArtifactV1Input,
  ApplicationAnalysisContractError
> {
  return Result.gen(function* () {
    if (input.modules.length > APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1) {
      return yield* Result.fail(limitExceededFailure(
        "lowerManifest",
        "sourceArtifact.modules",
        input.modules.length,
        APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
      ));
    }
    let admittedSourceBytes = 0;
    for (let index = 0; index < input.modules.length; index += 1) {
      const module = input.modules[index];
      if (module === undefined) {
        throw new Error("Application Analysis source-module array lost an item.");
      }
      if (
        Number.isSafeInteger(module.sourceByteLength) &&
        module.sourceByteLength >= 0 &&
        module.sourceByteLength > APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1
      ) {
        return yield* Result.fail(limitExceededFailure(
          "lowerManifest",
          `sourceArtifact.modules[${index}].sourceByteLength`,
          module.sourceByteLength,
          APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
        ));
      }
      if (
        Number.isSafeInteger(module.sourceByteLength) &&
        module.sourceByteLength >= 0
      ) {
        admittedSourceBytes += module.sourceByteLength;
        if (admittedSourceBytes > APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1) {
          return yield* Result.fail(limitExceededFailure(
            "lowerManifest",
            "sourceArtifact.modules",
            admittedSourceBytes,
            APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
          ));
        }
      }
    }
    const modules = [...input.modules].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
    let sourceBytes = 0;
    let previousPath: string | undefined;
    let foundExecutionModule = false;
    for (const module of modules) {
      if (module.path === previousPath) {
        return yield* Result.fail(new ApplicationAnalysisContractError({
          operation: "lowerManifest",
          reason: "duplicateModulePath",
          path: module.path,
        }));
      }
      previousPath = module.path;
      foundExecutionModule ||= module.path === input.executionModulePath;
      sourceBytes += module.sourceByteLength;
      if (!Number.isSafeInteger(sourceBytes) ||
        sourceBytes > APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1) {
        return yield* Result.fail(new ApplicationAnalysisContractError({
          operation: "lowerManifest",
          reason: "sourceBytesExceeded",
          observed: sourceBytes,
          maximum: APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
        }));
      }
    }
    if (!foundExecutionModule) {
      return yield* Result.fail(new ApplicationAnalysisContractError({
        operation: "lowerManifest",
        reason: "missingExecutionModule",
        path: input.executionModulePath,
      }));
    }
    return {
      rootSha256: input.rootSha256,
      executionModulePath: input.executionModulePath,
      schemaModulePath: input.schemaModulePath,
      modules,
    };
  });
}

function isApplicationFunctionName(value: string): boolean {
  return value.length > 0 && !value.includes(":");
}

function functionPath(moduleName: string, exportName: string): string {
  return exportName === "default"
    ? moduleName
    : `${moduleName}:${exportName}`;
}

function canonicalJsonBytes(
  value: unknown,
  maximumBytes: number,
  operation: "encodeManifest" | "encodeReceipt" | "lowerManifest",
  reason: "manifestBytesExceeded" | "receiptBytesExceeded",
): Result.Result<
  Readonly<{ readonly canonicalText: string; readonly canonicalBytes: Uint8Array }>,
  ApplicationAnalysisContractError
> {
  if (!isJson(value)) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "invalidInput",
    }));
  }
  const measurement = measureCanonicalJsonUtf8Bytes(value, maximumBytes);
  if (measurement.kind !== "success") {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason,
      ...(measurement.kind === "exceeded"
        ? { observed: measurement.observed, maximum: maximumBytes }
        : {}),
    }));
  }
  const canonicalText = encodeCanonicalJson(value, issue => {
    throw new Error(`Validated Application Analysis JSON lost ${issue.reason}.`);
  });
  const canonicalBytes = UTF8.encode(canonicalText);
  if (canonicalBytes.byteLength !== measurement.bytes) {
    throw new Error("Application Analysis canonical JSON measurement drifted.");
  }
  return Result.succeed(Object.freeze({ canonicalText, canonicalBytes }));
}

function snapshotApplicationManifestV1(
  manifest: ApplicationManifestV1,
): ApplicationManifestV1 {
  const snapshot = structuredClone(manifest);
  freezeOwnedApplicationAnalysisJson(snapshot);
  return snapshot;
}

function snapshotApplicationAnalysisReceiptV1(
  receipt: ApplicationAnalysisReceiptV1,
): ApplicationAnalysisReceiptV1 {
  const snapshot = structuredClone(receipt);
  freezeOwnedApplicationAnalysisJson(snapshot);
  return snapshot;
}

function validateApplicationManifestV1(
  manifest: ApplicationManifestV1,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<ApplicationManifestV1, ApplicationAnalysisContractError> {
  if (!isDeclarativeV2ArtifactModulePathV1(
    manifest.sourceArtifact.executionModulePath,
  )) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "invalidSourceModulePath",
      path: manifest.sourceArtifact.executionModulePath,
    }));
  }
  if (
    manifest.sourceArtifact.schemaModulePath !== null &&
    !isDeclarativeV2ArtifactModulePathV1(
      manifest.sourceArtifact.schemaModulePath,
    )
  ) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "invalidSourceModulePath",
      path: manifest.sourceArtifact.schemaModulePath,
    }));
  }
  let totalSourceBytes = 0;
  let previousModulePath: string | undefined;
  let executionModuleFound = false;
  let schemaModuleFound = manifest.sourceArtifact.schemaModulePath === null;
  let executionRoleCount = 0;
  let schemaRoleCount = 0;
  for (const module of manifest.sourceArtifact.modules) {
    if (!isDeclarativeV2ArtifactModulePathV1(module.path)) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "invalidSourceModulePath",
        path: module.path,
      }));
    }
    if (previousModulePath !== undefined && module.path <= previousModulePath) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: module.path === previousModulePath
          ? "duplicateModulePath"
          : "noncanonicalOrder",
        path: module.path,
      }));
    }
    previousModulePath = module.path;
    totalSourceBytes += module.sourceByteLength;
    if (totalSourceBytes > APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "sourceBytesExceeded",
        observed: totalSourceBytes,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
      }));
    }
    if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_AUTH) !== 0) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "unsupportedAuthModule",
        path: module.path,
      }));
    }
    if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) !== 0) {
      executionRoleCount += 1;
      if (module.path !== manifest.sourceArtifact.executionModulePath) {
        return Result.fail(new ApplicationAnalysisContractError({
          operation,
          reason: "invalidExecutionModuleRole",
          path: module.path,
        }));
      }
    }
    if (module.path === manifest.sourceArtifact.executionModulePath) {
      if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_EXECUTION) === 0) {
        return Result.fail(new ApplicationAnalysisContractError({
          operation,
          reason: "invalidExecutionModuleRole",
          path: module.path,
        }));
      }
      executionModuleFound = true;
    }
    if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_SCHEMA) !== 0) {
      schemaRoleCount += 1;
      if (module.path !== manifest.sourceArtifact.schemaModulePath) {
        return Result.fail(new ApplicationAnalysisContractError({
          operation,
          reason: "invalidSchemaModuleRole",
          path: module.path,
        }));
      }
    }
    if (module.path === manifest.sourceArtifact.schemaModulePath) {
      if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_SCHEMA) === 0) {
        return Result.fail(new ApplicationAnalysisContractError({
          operation,
          reason: "invalidSchemaModuleRole",
          path: module.path,
        }));
      }
      schemaModuleFound = true;
    }
  }
  if (!executionModuleFound) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "missingExecutionModule",
      path: manifest.sourceArtifact.executionModulePath,
    }));
  }
  if (executionRoleCount !== 1) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "invalidExecutionModuleRole",
      path: manifest.sourceArtifact.executionModulePath,
    }));
  }
  if (
    manifest.sourceArtifact.schemaModulePath === null &&
    (manifest.schema.tables.length > 0 || manifest.schema.indexes.length > 0)
  ) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "missingSchemaModule",
      path: "sourceArtifact.schemaModulePath",
    }));
  }
  if (!schemaModuleFound) {
    const schemaModulePath = manifest.sourceArtifact.schemaModulePath;
    if (schemaModulePath === null) {
      throw new Error("Application Analysis schema-module tracking drifted.");
    }
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "missingSchemaModule",
      path: schemaModulePath,
    }));
  }
  const expectedSchemaRoleCount = manifest.sourceArtifact.schemaModulePath === null
    ? 0
    : 1;
  if (schemaRoleCount !== expectedSchemaRoleCount) {
    return Result.fail(new ApplicationAnalysisContractError({
      operation,
      reason: "invalidSchemaModuleRole",
      path: manifest.sourceArtifact.schemaModulePath ??
        "sourceArtifact.schemaModulePath",
    }));
  }
  const tableNames = new Set<string>();
  const tablesByName = new Map<
    string,
    ApplicationManifestV1["schema"]["tables"][number]
  >();
  const tableIds = new Set<number>();
  let previousTableName: string | undefined;
  for (let index = 0; index < manifest.schema.tables.length; index += 1) {
    const table = manifest.schema.tables[index];
    if (table === undefined) {
      throw new Error("Application Analysis table array lost an item.");
    }
    if (
      table.tableId !== index + 1 || tableNames.has(table.name) ||
      (previousTableName !== undefined && table.name <= previousTableName)
    ) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "noncanonicalOrder",
        path: `schema.tables[${index}]`,
      }));
    }
    tableNames.add(table.name);
    tableIds.add(table.tableId);
    tablesByName.set(table.name, table);
    previousTableName = table.name;
  }
  for (let index = 0; index < manifest.schema.tables.length; index += 1) {
    const table = manifest.schema.tables[index];
    if (table === undefined) {
      throw new Error("Application Analysis table array lost an item.");
    }
    if (
      table.placement.kind === "colocateWith" &&
      !hasValidColocationRoot(table.name, tablesByName)
    ) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "invalidSchemaRelationship",
        path: `schema.tables[${index}].placement`,
      }));
    }
  }
  for (let index = 0; index < manifest.schema.indexes.length; index += 1) {
    const schemaIndex = manifest.schema.indexes[index];
    if (schemaIndex === undefined) {
      throw new Error("Application Analysis index array lost an item.");
    }
    if (
      schemaIndex.indexId !== index + 1 ||
      !tableIds.has(schemaIndex.tableId)
    ) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: schemaIndex.indexId !== index + 1
          ? "noncanonicalOrder"
          : "invalidSchemaRelationship",
        path: `schema.indexes[${index}]`,
      }));
    }
  }
  const functionPaths = new Set<string>();
  let previousFunction: ApplicationManifestV1["functions"][number] | undefined;
  for (let index = 0; index < manifest.functions.length; index += 1) {
    const fn = manifest.functions[index];
    if (fn === undefined) {
      throw new Error("Application Analysis function array lost an item.");
    }
    if (
      previousFunction !== undefined &&
      compareFunctionEntries(fn, previousFunction) <= 0
    ) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: fn.moduleName === previousFunction.moduleName &&
            fn.exportName === previousFunction.exportName
          ? "duplicateFunctionPath"
          : "noncanonicalOrder",
        path: fn.path,
      }));
    }
    previousFunction = fn;
    if (functionPaths.has(fn.path)) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "duplicateFunctionPath",
        path: fn.path,
      }));
    }
    functionPaths.add(fn.path);
    const expectedPath = functionPath(fn.moduleName, fn.exportName);
    if (fn.path !== expectedPath) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "invalidFunctionPath",
        path: fn.path,
      }));
    }
    if (!hasValidFunctionPartition(fn, tablesByName)) {
      return Result.fail(new ApplicationAnalysisContractError({
        operation,
        reason: "invalidSchemaRelationship",
        path: `functions[${index}].partition`,
      }));
    }
  }
  return Result.succeed(manifest);
}

function compareFunctionEntries(
  left: ApplicationManifestV1["functions"][number],
  right: ApplicationManifestV1["functions"][number],
): number {
  const moduleOrder = compareUtf16Strings(left.moduleName, right.moduleName);
  return moduleOrder === 0
    ? compareUtf16Strings(left.exportName, right.exportName)
    : moduleOrder;
}

function hasValidColocationRoot(
  tableName: string,
  tablesByName: ReadonlyMap<
    string,
    ApplicationManifestV1["schema"]["tables"][number]
  >,
): boolean {
  const seen = new Set<string>();
  let currentName = tableName;
  while (!seen.has(currentName)) {
    seen.add(currentName);
    const table = tablesByName.get(currentName);
    if (table === undefined) return false;
    if (table.placement.kind === "partitionBy") return true;
    if (table.placement.kind !== "colocateWith") return false;
    currentName = table.placement.table;
  }
  return false;
}

function hasValidFunctionPartition(
  fn: ApplicationManifestV1["functions"][number],
  tablesByName: ReadonlyMap<
    string,
    ApplicationManifestV1["schema"]["tables"][number]
  >,
): boolean {
  const partition = fn.partition;
  if (partition === null) return true;
  const table = tablesByName.get(partition.table);
  if (table === undefined || table.placement.kind !== "partitionBy") {
    return false;
  }
  if (partition.type === "partitionCreateRoot") {
    return table.placement.field === "_id" && partition.partitionField === "_id";
  }
  return table.placement.field === partition.partitionField &&
    partition.selector === selectorNameForPartitionField(table.placement.field) &&
    validatorHasRequiredField(fn.args, partition.argField);
}

function validatorHasRequiredField(
  validator: typeof ValidatorJsonV1.Type,
  field: string,
): boolean {
  return validator.type === "object" &&
    Object.hasOwn(validator.value, field) &&
    validator.value[field]?.optional === false;
}

function freezeOwnedApplicationAnalysisJson(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) freezeOwnedApplicationAnalysisJson(item);
    Object.freeze(value);
    return;
  }
  for (const item of Object.values(value)) {
    freezeOwnedApplicationAnalysisJson(item);
  }
  Object.freeze(value);
}

function isDeeplyFrozenJson(value: unknown): boolean {
  if (!isJson(value)) return false;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (!Object.isFrozen(current)) return false;
    if (Array.isArray(current)) {
      pending.push(...current);
    } else {
      pending.push(...Object.values(current));
    }
  }
  return true;
}
