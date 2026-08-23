import { isNonArrayRecord } from "@flarex/utils/records";
import {
  Effect,
  Option,
  Result,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  canonicalizeRelationDeclarationV1Result,
  compareRelationDeclarationsV1,
} from "flarex-protocol/internal/relation-declaration-v1";
import {
  encodeCanonicalJson,
  isJson,
  measureCanonicalJsonUtf8Bytes,
} from "flarex-protocol/json";

import {
  analyzeDecodedApplicationRelationsResult,
  APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
  type AnalyzedApplicationRelation,
} from "./applicationRelationAnalysis.ts";
import {
  APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
  APPLICATION_MANIFEST_FORMAT_V1,
  ApplicationAnalysisContractError,
  ApplicationManifestV1Schema,
  canonicalizeApplicationManifestV1,
  decodeApplicationManifestV1,
  makeApplicationManifestV1,
  type ApplicationManifestSourceArtifactV1Input,
  type ApplicationManifestV1,
  type CanonicalApplicationManifestV1,
} from "./applicationAnalysisV1.ts";
import type {
  AnalyzerPartitionError,
  AnalyzerValidatorError,
  ApplicationAnalysis,
} from "./index.ts";

const UTF8_ENCODER = new TextEncoder();

export const APPLICATION_MANIFEST_VERSION_V2 = 2 as const;

export interface ApplicationManifestV2 {
  readonly format: typeof APPLICATION_MANIFEST_FORMAT_V1;
  readonly version: typeof APPLICATION_MANIFEST_VERSION_V2;
  readonly sourceArtifact: ApplicationManifestV1["sourceArtifact"];
  readonly schema: Readonly<{
    readonly version: typeof APPLICATION_MANIFEST_VERSION_V2;
    readonly tables: ApplicationManifestV1["schema"]["tables"];
    readonly indexes: ApplicationManifestV1["schema"]["indexes"];
    readonly relations: ReadonlyArray<AnalyzedApplicationRelation>;
  }>;
  readonly functions: ApplicationManifestV1["functions"];
}

export type ApplicationManifest = ApplicationManifestV1 | ApplicationManifestV2;

export interface CanonicalApplicationManifestV2 {
  readonly manifest: ApplicationManifestV2;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export type CanonicalApplicationManifest =
  | CanonicalApplicationManifestV1
  | CanonicalApplicationManifestV2;

const OwnedApplicationManifestV2Schema = Schema.declare<ApplicationManifestV2>(
  (value): value is ApplicationManifestV2 =>
    isNonArrayRecord(value) && isDeeplyFrozenJson(value),
  { identifier: "OwnedApplicationManifestV2" },
);

export const ApplicationManifestV2Schema = Schema.Unknown.pipe(
  Schema.decodeTo(OwnedApplicationManifestV2Schema, {
    decode: SchemaGetter.transformOrFail<ApplicationManifestV2, unknown>(
      (value) => Result.match(decodeApplicationManifestV2(value), {
        onFailure: (failure) => Effect.fail(new SchemaIssue.InvalidValue(
          Option.some(value),
          { message: `Invalid Application Manifest V2: ${failure.reason}` },
        )),
        onSuccess: Effect.succeed,
      }),
    ),
    encode: SchemaGetter.transform(snapshotApplicationManifestV2),
  }),
);

export const ApplicationManifestSchema = Schema.Union([
  ApplicationManifestV1Schema,
  ApplicationManifestV2Schema,
]);

export function decodeApplicationManifestV2(
  value: unknown,
): Result.Result<ApplicationManifestV2, ApplicationAnalysisContractError> {
  return decodeApplicationManifestV2Worker(value, "decodeManifest");
}

export function canonicalizeApplicationManifestV2(
  value: unknown,
): Result.Result<
  CanonicalApplicationManifestV2,
  ApplicationAnalysisContractError
> {
  return canonicalizeApplicationManifestV2ForOperation(
    value,
    "decodeManifest",
    "encodeManifest",
  );
}

export function canonicalizeApplicationManifest(
  value: unknown,
): Result.Result<
  CanonicalApplicationManifest,
  ApplicationAnalysisContractError
> {
  return Result.gen(function* () {
    const version = yield* manifestVersion(value);
    return version === 1
      ? yield* canonicalizeApplicationManifestV1(value)
      : yield* canonicalizeApplicationManifestV2(value);
  });
}

export function isApplicationManifestV1(
  manifest: ApplicationManifest,
): manifest is ApplicationManifestV1 {
  return manifest.version === 1;
}

export function isApplicationManifestV2(
  manifest: ApplicationManifest,
): manifest is ApplicationManifestV2 {
  return manifest.version === APPLICATION_MANIFEST_VERSION_V2;
}

export const makeApplicationManifest = Effect.fn(
  "ApplicationAnalysis.makeManifest",
)(function* (
  analysis: ApplicationAnalysis,
  sourceArtifact: ApplicationManifestSourceArtifactV1Input,
): Effect.fn.Return<
  CanonicalApplicationManifest,
  ApplicationAnalysisContractError | AnalyzerValidatorError |
    AnalyzerPartitionError
> {
  const canonicalV1 = yield* makeApplicationManifestV1(
    analysis,
    sourceArtifact,
  );
  if (analysis.relations.length === 0) return canonicalV1;
  return yield* Effect.fromResult(
    canonicalizeApplicationManifestV2ForOperation({
      format: canonicalV1.manifest.format,
      version: APPLICATION_MANIFEST_VERSION_V2,
      sourceArtifact: canonicalV1.manifest.sourceArtifact,
      schema: {
        version: APPLICATION_MANIFEST_VERSION_V2,
        tables: canonicalV1.manifest.schema.tables,
        indexes: canonicalV1.manifest.schema.indexes,
        relations: analysis.relations,
      },
      functions: canonicalV1.manifest.functions,
    }, "lowerManifest", "lowerManifest"),
  );
});

function decodeApplicationManifestV2Worker(
  value: unknown,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<ApplicationManifestV2, ApplicationAnalysisContractError> {
  return Result.gen(function* () {
    const manifestProperties = yield* strictOwnDataProperties(
      value,
      ["format", "version", "sourceArtifact", "schema", "functions"],
      "manifest",
      operation,
    );
    if (
      manifestProperties.get("format") !== APPLICATION_MANIFEST_FORMAT_V1 ||
      manifestProperties.get("version") !== APPLICATION_MANIFEST_VERSION_V2
    ) {
      return yield* Result.fail(contractFailure(
        operation,
        "invalidInput",
        { path: "version" },
      ));
    }
    const schemaProperties = yield* strictOwnDataProperties(
      manifestProperties.get("schema"),
      ["version", "tables", "indexes", "relations"],
      "schema",
      operation,
    );
    if (schemaProperties.get("version") !== APPLICATION_MANIFEST_VERSION_V2) {
      return yield* Result.fail(contractFailure(
        operation,
        "invalidInput",
        { path: "schema.version" },
      ));
    }

    const canonicalV1 = yield* decodeApplicationManifestV1({
      format: manifestProperties.get("format"),
      version: 1,
      sourceArtifact: manifestProperties.get("sourceArtifact"),
      schema: {
        version: 1,
        tables: schemaProperties.get("tables"),
        indexes: schemaProperties.get("indexes"),
      },
      functions: manifestProperties.get("functions"),
    }).pipe(Result.mapError(error => operation === "decodeManifest"
      ? error
      : new ApplicationAnalysisContractError({
          ...error,
          operation,
        })));

    const suppliedRelations = yield* decodeAnalyzedRelationEntries(
      schemaProperties.get("relations"),
      operation,
    );
    const expectedRelations = yield* analyzeDecodedApplicationRelationsResult(
      suppliedRelations.map(entry => entry.declaration),
      canonicalV1.schema,
    ).pipe(Result.mapError(issue => contractFailure(
      operation,
      issue.reason === "relationLimitExceeded"
        ? "limitExceeded"
        : "invalidSchemaRelationship",
      {
        path: issue.path,
        cause: issue,
        ...(issue.observed === undefined
          ? {}
          : { observed: issue.observed }),
        ...(issue.maximum === undefined
          ? {}
          : { maximum: issue.maximum }),
      },
    )));

    for (let index = 0; index < expectedRelations.length; index += 1) {
      const expected = expectedRelations[index];
      const supplied = suppliedRelations[index];
      if (expected === undefined || supplied === undefined) {
        throw new Error("Application Manifest V2 relation arrays drifted.");
      }
      if (
        supplied.relationOrdinal !== expected.relationOrdinal ||
        supplied.sourceTableOrdinal !== expected.sourceTableOrdinal ||
        supplied.targetTableOrdinal !== expected.targetTableOrdinal ||
        compareRelationDeclarationsV1(
            supplied.declaration,
            expected.declaration,
          ) !== 0
      ) {
        return yield* Result.fail(contractFailure(
          operation,
          "noncanonicalOrder",
          { path: `schema.relations[${index}]` },
        ));
      }
    }

    return snapshotApplicationManifestV2({
      format: canonicalV1.format,
      version: APPLICATION_MANIFEST_VERSION_V2,
      sourceArtifact: canonicalV1.sourceArtifact,
      schema: {
        version: APPLICATION_MANIFEST_VERSION_V2,
        tables: canonicalV1.schema.tables,
        indexes: canonicalV1.schema.indexes,
        relations: expectedRelations,
      },
      functions: canonicalV1.functions,
    });
  });
}

function decodeAnalyzedRelationEntries(
  value: unknown,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<
  ReadonlyArray<AnalyzedApplicationRelation>,
  ApplicationAnalysisContractError
> {
  return Result.gen(function* () {
    const inspected = yield* inspectRelationArray(value, operation);
    const length = inspected.length;
    if (length === 0) {
      return yield* Result.fail(contractFailure(
        operation,
        "invalidSchemaRelationship",
        { path: "schema.relations" },
      ));
    }
    if (length > APPLICATION_ANALYSIS_MAXIMUM_RELATIONS) {
      return yield* Result.fail(contractFailure(operation, "limitExceeded", {
        path: "schema.relations",
        observed: length,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_RELATIONS,
      }));
    }
    const entries: AnalyzedApplicationRelation[] = [];
    for (let index = 0; index < length; index += 1) {
      const path = `schema.relations[${index}]`;
      const item = yield* readOwnDataValue(
        inspected.value,
        String(index),
        path,
        operation,
      );
      const properties = yield* strictOwnDataProperties(
        item,
        [
          "relationOrdinal",
          "sourceTableOrdinal",
          "targetTableOrdinal",
          "declaration",
        ],
        path,
        operation,
      );
      const relationOrdinal = properties.get("relationOrdinal");
      const sourceTableOrdinal = properties.get("sourceTableOrdinal");
      const targetTableOrdinal = properties.get("targetTableOrdinal");
      if (
        !isPositiveSafeInteger(relationOrdinal) ||
        !isPositiveSafeInteger(sourceTableOrdinal) ||
        !isPositiveSafeInteger(targetTableOrdinal)
      ) {
        return yield* Result.fail(contractFailure(operation, "invalidInput", {
          path,
        }));
      }
      const declaration = yield* decodeRelationDeclarationSafely(
        properties.get("declaration"),
        `${path}.declaration`,
        operation,
      );
      entries.push(Object.freeze({
        relationOrdinal,
        sourceTableOrdinal,
        targetTableOrdinal,
        declaration,
      }));
    }
    return Object.freeze(entries);
  });
}

function canonicalizeApplicationManifestV2ForOperation(
  value: unknown,
  decodeOperation: "decodeManifest" | "lowerManifest",
  encodeOperation: "encodeManifest" | "lowerManifest",
): Result.Result<
  CanonicalApplicationManifestV2,
  ApplicationAnalysisContractError
> {
  return Result.gen(function* () {
    const manifest = yield* decodeApplicationManifestV2Worker(
      value,
      decodeOperation,
    );
    if (!isJson(manifest)) {
      return yield* Result.fail(contractFailure(
        encodeOperation,
        "invalidInput",
      ));
    }
    const measurement = measureCanonicalJsonUtf8Bytes(
      manifest,
      APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
    );
    if (measurement.kind !== "success") {
      return yield* Result.fail(contractFailure(
        encodeOperation,
        "manifestBytesExceeded",
        measurement.kind === "exceeded"
          ? {
              observed: measurement.observed,
              maximum: APPLICATION_ANALYSIS_MAXIMUM_MANIFEST_BYTES_V1,
            }
          : {},
      ));
    }
    const canonicalText = encodeCanonicalJson(manifest, issue => {
      throw new Error(
        `Validated Application Manifest V2 lost JSON: ${issue.reason}.`,
      );
    });
    const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
    if (canonicalBytes.byteLength !== measurement.bytes) {
      throw new Error(
        "Application Manifest V2 canonical JSON measurement drifted.",
      );
    }
    return Object.freeze({ manifest, canonicalText, canonicalBytes });
  });
}

function strictOwnDataProperties(
  value: unknown,
  expectedKeys: ReadonlyArray<string>,
  path: string,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<
  ReadonlyMap<string, unknown>,
  ApplicationAnalysisContractError
> {
  try {
    if (!isNonArrayRecord(value)) {
      return Result.fail(contractFailure(operation, "invalidInput", { path }));
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== expectedKeys.length ||
      ownKeys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
    ) {
      return Result.fail(contractFailure(operation, "invalidInput", { path }));
    }
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return Result.fail(contractFailure(operation, "invalidInput", {
          path: `${path}.${key}`,
        }));
      }
      properties.set(key, descriptor.value);
    }
    return Result.succeed(properties);
  } catch (cause) {
    return Result.fail(contractFailure(operation, "invalidInput", {
      path,
      cause,
    }));
  }
}

function manifestVersion(
  value: unknown,
): Result.Result<1 | 2, ApplicationAnalysisContractError> {
  try {
    if (!isNonArrayRecord(value)) {
      return Result.fail(contractFailure("decodeManifest", "invalidInput"));
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, "version");
    return descriptor !== undefined && "value" in descriptor &&
        (descriptor.value === 1 || descriptor.value === 2)
      ? Result.succeed(descriptor.value)
      : Result.fail(contractFailure("decodeManifest", "invalidInput", {
          path: "version",
        }));
  } catch (cause) {
    return Result.fail(contractFailure("decodeManifest", "invalidInput", {
      path: "version",
      cause,
    }));
  }
}

function inspectRelationArray(
  value: unknown,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<
  Readonly<{
    readonly value: ReadonlyArray<unknown>;
    readonly length: number;
  }>,
  ApplicationAnalysisContractError
> {
  try {
    if (!Array.isArray(value)) {
      return Result.fail(contractFailure(operation, "invalidInput", {
        path: "schema.relations",
      }));
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const rawLength: unknown = lengthDescriptor !== undefined &&
        "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof rawLength !== "number" || !Number.isSafeInteger(rawLength) ||
      rawLength < 0
    ) {
      return Result.fail(contractFailure(operation, "invalidInput", {
        path: "schema.relations",
      }));
    }
    const length = rawLength;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== length + 1 ||
      ownKeys.some(key =>
        key !== "length" && (
          typeof key !== "string" || !isExpectedArrayIndexKey(key, length)
        )
      )
    ) {
      return Result.fail(contractFailure(operation, "invalidInput", {
        path: "schema.relations",
      }));
    }
    return Result.succeed({ value, length });
  } catch (cause) {
    return Result.fail(contractFailure(operation, "invalidInput", {
      path: "schema.relations",
      cause,
    }));
  }
}

function readOwnDataValue(
  value: ReadonlyArray<unknown>,
  key: string,
  path: string,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<unknown, ApplicationAnalysisContractError> {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor &&
        descriptor.enumerable === true
      ? Result.succeed(descriptor.value)
      : Result.fail(contractFailure(operation, "invalidInput", { path }));
  } catch (cause) {
    return Result.fail(contractFailure(operation, "invalidInput", {
      path,
      cause,
    }));
  }
}

function isExpectedArrayIndexKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length &&
    String(index) === key;
}

function decodeRelationDeclarationSafely(
  value: unknown,
  path: string,
  operation: "decodeManifest" | "lowerManifest",
): Result.Result<
  AnalyzedApplicationRelation["declaration"],
  ApplicationAnalysisContractError
> {
  try {
    return canonicalizeRelationDeclarationV1Result(value).pipe(
      Result.map(canonical => canonical.declaration),
      Result.mapError(cause => contractFailure(
        operation,
        "invalidSchemaRelationship",
        { path, cause },
      )),
    );
  } catch (cause) {
    return Result.fail(contractFailure(
      operation,
      "invalidSchemaRelationship",
      { path, cause },
    ));
  }
}

function contractFailure(
  operation: "decodeManifest" | "encodeManifest" | "lowerManifest",
  reason: ApplicationAnalysisContractError["reason"],
  details: Readonly<{
    readonly path?: string;
    readonly observed?: number;
    readonly maximum?: number;
    readonly cause?: unknown;
  }> = {},
): ApplicationAnalysisContractError {
  return new ApplicationAnalysisContractError({
    operation,
    reason,
    ...(details.path === undefined ? {} : { path: details.path }),
    ...(details.observed === undefined ? {} : { observed: details.observed }),
    ...(details.maximum === undefined ? {} : { maximum: details.maximum }),
    ...(details.cause === undefined ? {} : { cause: details.cause }),
  });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function snapshotApplicationManifestV2(
  manifest: ApplicationManifestV2,
): ApplicationManifestV2 {
  const snapshot: ApplicationManifestV2 = structuredClone(manifest);
  freezeOwnedApplicationManifestV2(snapshot);
  return snapshot;
}

function freezeOwnedApplicationManifestV2(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) freezeOwnedApplicationManifestV2(item);
    Object.freeze(value);
    return;
  }
  for (const item of Object.values(value)) {
    freezeOwnedApplicationManifestV2(item);
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
