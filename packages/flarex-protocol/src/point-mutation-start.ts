import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { Data, Result, Schema } from "effect";

import {
  AppDocumentIdV1Error,
  requireAppDocumentIdentityV1ForTable,
} from "./app-document-id";
import type { CatalogTableId } from "./catalog";
import { snapshotDecodedProtocolPlainData } from "./decoded-protocol-snapshot";
import { isJsonObject, type JsonObject } from "./json";
import { freezeOwnedProtocolProjection } from "./owned-protocol-projection";
import {
  CatalogSchemaVersionIdSchema,
  SchemaManifestAppSchemaV1Schema,
  type SchemaManifestAppSchemaV1,
} from "./schema-manifest";
import { ReplacementScopeIdV1Schema } from "./storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  transactionGrantRequestSha256HexV1FromBytes,
  transactionGrantValidatedArgsSha256HexV1FromBytes,
  type TransactionGrantPayloadV1,
} from "./transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type CanonicalTransactionArgumentsBytesV1,
  type TransactionArgumentsSha256V1,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionRequestKeyV1,
  type TransactionRequestSha256V1,
} from "./transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  canonicalizeFlarexValueV1,
  normalizeFlarexValueV1,
} from "./value";
import {
  ValidatorValueErrorV1,
  validateValidatorValueV1,
} from "./validator-engine";
import {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
  type ValidatorJsonV1 as ValidatorJsonV1Type,
} from "./validator-json";

const StrictStructOptions: {
  readonly parseOptions: { readonly onExcessProperty: "error" };
} = { parseOptions: { onExcessProperty: "error" } };

export const POINT_MUTATION_TARGET_METADATA_FORMAT_V1 =
  "flarex.point-mutation-target-metadata";
export const POINT_MUTATION_TARGET_METADATA_VERSION_V1 = 1;
export const POINT_MUTATION_REQUEST_FORMAT_V1 =
  "flarex.point-mutation-request";
export const POINT_MUTATION_REQUEST_VERSION_V1 = 1;
/** Convex transaction arguments are charged as one implicit array value. */
export const POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1 = 2;
export const MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 =
  16 * 1024 * 1024;

const PointMutationFunctionKindV1Schema = Schema.Literals([
  "query",
  "mutation",
  "action",
  "workflowMutation",
]);

const PointMutationFunctionVisibilityV1Schema = Schema.Literals([
  "public",
  "internal",
]);

const PointMutationArgumentsValidatorV1Schema = Schema.Union([
  ObjectValidatorJsonV1,
  Schema.Struct({ type: Schema.Literal("any") }).annotate(
    StrictStructOptions,
  ),
]);

export const PointMutationTargetFunctionMetadataV1Schema = Schema.Struct({
  path: TransactionFunctionPathV1Schema,
  executionModule: TransactionExecutionModuleV1Schema,
  kind: PointMutationFunctionKindV1Schema,
  visibility: PointMutationFunctionVisibilityV1Schema,
  argsValidator: PointMutationArgumentsValidatorV1Schema,
  returnsValidator: Schema.Union([ValidatorJsonV1, Schema.Null]),
}).annotate(StrictStructOptions);
export type PointMutationTargetFunctionMetadataV1 =
  typeof PointMutationTargetFunctionMetadataV1Schema.Type;

export const ActivePointMutationTargetMetadataV1Schema = Schema.Struct({
  format: Schema.Literal(POINT_MUTATION_TARGET_METADATA_FORMAT_V1),
  version: Schema.Literal(POINT_MUTATION_TARGET_METADATA_VERSION_V1),
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  packageId: TransactionPackageIdV1Schema,
  artifactRuntime: TransactionArtifactRuntimeV1Schema,
  artifactId: TransactionArtifactIdV1Schema,
  sourcePackageHash: TransactionSourcePackageSha256HexV1Schema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  functions: Schema.Array(PointMutationTargetFunctionMetadataV1Schema),
  schemaManifest: SchemaManifestAppSchemaV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((metadata) =>
    metadata.artifactId ===
        `artifact_${metadata.sourcePackageHash.slice(0, 32)}`
      ? undefined
      : "Expected artifact ID to match the source-package hash",
  ),
);
export type ActivePointMutationTargetMetadataV1 =
  typeof ActivePointMutationTargetMetadataV1Schema.Type;
export const decodeActivePointMutationTargetMetadataV1 =
  Schema.decodeUnknownSync(ActivePointMutationTargetMetadataV1Schema, {
    onExcessProperty: "error",
  });

export const PointMutationCurrentScopeAuthorityV1Schema = Schema.Struct({
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  authorizationRevocationEpoch:
    Schema.toType(TransactionAuthorizationRevocationEpochSchema),
}).annotate(StrictStructOptions);
export type PointMutationCurrentScopeAuthorityV1 =
  typeof PointMutationCurrentScopeAuthorityV1Schema.Type;
export const decodePointMutationCurrentScopeAuthorityV1 =
  Schema.decodeUnknownSync(PointMutationCurrentScopeAuthorityV1Schema, {
    onExcessProperty: "error",
  });

export interface PointMutationStartCandidateV1 {
  readonly deploymentId: TransactionGrantPayloadV1["deploymentId"];
  readonly functionPath: TransactionGrantPayloadV1["functionPath"];
  readonly args: unknown;
  readonly requestKey: TransactionRequestKeyV1;
}

export type PointMutationGrantLogicalPinsV1 = Readonly<
  Pick<
    TransactionGrantPayloadV1,
    | "deploymentId"
    | "scopeId"
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "functionPath"
    | "functionKind"
    | "schemaVersionId"
    | "validatedArgsValueCodecVersion"
    | "validatedArgsSha256"
    | "requestKey"
    | "requestSha256"
    | "authorizationRevocationEpoch"
  >
>;

export interface CanonicalPointMutationArgumentsV1 {
  readonly valueJson: JsonObject;
  readonly canonicalBytes: CanonicalTransactionArgumentsBytesV1;
  readonly sha256: TransactionArgumentsSha256V1;
}

export interface PointMutationRequestEnvelopeV1 {
  readonly format: typeof POINT_MUTATION_REQUEST_FORMAT_V1;
  readonly version: typeof POINT_MUTATION_REQUEST_VERSION_V1;
  readonly deploymentId: TransactionGrantPayloadV1["deploymentId"];
  readonly functionPath: TransactionGrantPayloadV1["functionPath"];
  readonly functionKind: "mutation";
  readonly validatedArgsSha256: TransactionGrantPayloadV1["validatedArgsSha256"];
  readonly requestKey: TransactionRequestKeyV1;
}

export interface CanonicalPointMutationRequestV1 {
  readonly envelope: PointMutationRequestEnvelopeV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: TransactionRequestSha256V1;
}

export interface PreparedPointMutationStartEvidenceV1 {
  readonly logicalPins: PointMutationGrantLogicalPinsV1;
  readonly validatedArguments: CanonicalPointMutationArgumentsV1;
  readonly requestEvidence: CanonicalPointMutationRequestV1;
  readonly returnsValidator: ValidatorJsonV1Type | null;
}

export type PointMutationTargetSelectionV1Issue =
  | { readonly reason: "deploymentMismatch" }
  | { readonly reason: "functionMissing" }
  | { readonly reason: "duplicateFunctionPath" }
  | { readonly reason: "wrongFunctionKind" }
  | { readonly reason: "functionNotPublic" }
  | { readonly reason: "argumentsNotObject" }
  | {
      readonly reason: "argumentsTooLarge";
      readonly observed: number;
      readonly maximum: number;
    };

export class PointMutationTargetSelectionV1Error extends Data.TaggedError(
  "PointMutationTargetSelectionV1Error",
)<{
  readonly issue: PointMutationTargetSelectionV1Issue;
}> {}

export async function preparePointMutationStartEvidenceV1(
  metadata: ActivePointMutationTargetMetadataV1,
  candidate: PointMutationStartCandidateV1,
  authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch,
): Promise<PreparedPointMutationStartEvidenceV1> {
  const deploymentId = candidate.deploymentId;
  const functionPath = candidate.functionPath;
  const requestKey = candidate.requestKey;
  const args = candidate.args;

  if (metadata.deploymentId !== deploymentId) {
    throw selectionFailure("deploymentMismatch");
  }

  const matchingFunctions = metadata.functions.filter(
    (metadataFunction) => metadataFunction.path === functionPath,
  );
  if (matchingFunctions.length === 0) {
    throw selectionFailure("functionMissing");
  }
  if (matchingFunctions.length !== 1) {
    throw selectionFailure("duplicateFunctionPath");
  }
  const targetFunction = matchingFunctions[0];
  if (targetFunction.kind !== "mutation") {
    throw selectionFailure("wrongFunctionKind");
  }
  if (targetFunction.visibility !== "public") {
    throw selectionFailure("functionNotPublic");
  }

  const validatedArguments = await canonicalizePointMutationArgumentsV1(
    targetFunction.argsValidator,
    args,
    metadata.schemaManifest,
  );
  const requestEvidence = await canonicalizePointMutationRequestV1({
    deploymentId,
    functionPath: targetFunction.path,
    validatedArgsSha256: validatedArguments.sha256,
    requestKey,
  });
  const logicalPins = Object.freeze({
    deploymentId: metadata.deploymentId,
    scopeId: metadata.scopeId,
    packageId: metadata.packageId,
    artifactRuntime: metadata.artifactRuntime,
    artifactId: metadata.artifactId,
    sourcePackageHash: metadata.sourcePackageHash,
    executionModule: targetFunction.executionModule,
    functionPath: targetFunction.path,
    functionKind: "mutation" as const,
    schemaVersionId: metadata.schemaVersionId,
    validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256:
      transactionGrantValidatedArgsSha256HexV1FromBytes(
        validatedArguments.sha256,
      ),
    requestKey,
    requestSha256: transactionGrantRequestSha256HexV1FromBytes(
      requestEvidence.sha256,
    ),
    authorizationRevocationEpoch,
  } satisfies PointMutationGrantLogicalPinsV1);

  return Object.freeze({
    logicalPins,
    validatedArguments,
    requestEvidence,
    returnsValidator: snapshotDecodedProtocolPlainData(
      targetFunction.returnsValidator,
    ),
  } satisfies PreparedPointMutationStartEvidenceV1);
}

export async function canonicalizePointMutationArgumentsV1(
  validator: PointMutationTargetFunctionMetadataV1["argsValidator"],
  args: unknown,
  schemaManifest: SchemaManifestAppSchemaV1,
): Promise<CanonicalPointMutationArgumentsV1> {
  const normalized = normalizeFlarexValueV1(args);
  if (!isRuntimeObject(normalized.value)) {
    throw selectionFailure("argumentsNotObject");
  }
  requirePointMutationArgumentSemanticSizeV1(normalized.semanticSizeBytes);
  const tableIdByLogicalName = new Map<string, CatalogTableId>(
    schemaManifest.tableDefinitions.tables.map((table) => [
      table.logicalName,
      table.tableId,
    ] as const),
  );
  const validation = validateValidatorValueV1(
    validator,
    normalized.value,
    {
      path: "$args",
      idPolicy: {
        mode: "tableAware",
        check: (tableName, value) => {
          const tableId = tableIdByLogicalName.get(tableName);
          if (tableId === undefined) return "unavailable";
          try {
            requireAppDocumentIdentityV1ForTable(value, tableId);
            return "valid";
          } catch (cause) {
            if (cause instanceof AppDocumentIdV1Error) return "invalid";
            throw cause;
          }
        },
      },
    },
  );
  if (Result.isFailure(validation)) throw validation.failure;

  const canonical = await canonicalizeFlarexValueJsonV1(
    normalized.valueJson,
  );
  if (!isJsonObject(canonical.valueJson)) {
    throw selectionFailure("argumentsNotObject");
  }
  const stableCanonicalBytes = CanonicalTransactionArgumentsBytesV1Schema.make(
    new Uint8Array(canonical.canonicalBytes),
  );
  const stableSha256 = TransactionArgumentsSha256V1Schema.make(
    new Uint8Array(canonical.sha256),
  );
  const stableValueJson = freezeOwnedProtocolProjection(canonical.valueJson);
  return Object.freeze({
    valueJson: stableValueJson,
    get canonicalBytes(): CanonicalTransactionArgumentsBytesV1 {
      return CanonicalTransactionArgumentsBytesV1Schema.make(
        new Uint8Array(stableCanonicalBytes),
      );
    },
    get sha256(): TransactionArgumentsSha256V1 {
      return TransactionArgumentsSha256V1Schema.make(
        new Uint8Array(stableSha256),
      );
    },
  } satisfies CanonicalPointMutationArgumentsV1);
}

/**
 * Applies Convex's argument accounting to an already-normalized argument
 * object. The caller supplies the object value's semantic bytes; the implicit
 * outer argument array contributes exactly two additional bytes.
 */
export function requirePointMutationArgumentSemanticSizeV1(
  argumentSemanticBytes: number,
): number {
  const observed =
    POINT_MUTATION_ARGUMENT_ARRAY_OVERHEAD_SEMANTIC_BYTES_V1 +
    argumentSemanticBytes;
  if (
    !isNonNegativeSafeInteger(argumentSemanticBytes) ||
    observed > MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1
  ) {
    throw new PointMutationTargetSelectionV1Error({
      issue: {
        reason: "argumentsTooLarge",
        observed,
        maximum: MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
      },
    });
  }
  return observed;
}

export async function canonicalizePointMutationRequestV1(input: {
  readonly deploymentId: TransactionGrantPayloadV1["deploymentId"];
  readonly functionPath: TransactionGrantPayloadV1["functionPath"];
  readonly validatedArgsSha256: TransactionArgumentsSha256V1;
  readonly requestKey: TransactionRequestKeyV1;
}): Promise<CanonicalPointMutationRequestV1> {
  const envelope = Object.freeze({
    format: POINT_MUTATION_REQUEST_FORMAT_V1,
    version: POINT_MUTATION_REQUEST_VERSION_V1,
    deploymentId: input.deploymentId,
    functionPath: input.functionPath,
    functionKind: "mutation" as const,
    validatedArgsSha256:
      transactionGrantValidatedArgsSha256HexV1FromBytes(
        input.validatedArgsSha256,
      ),
    requestKey: TransactionRequestKeyV1Schema.make(input.requestKey),
  } satisfies PointMutationRequestEnvelopeV1);
  const canonical = await canonicalizeFlarexValueV1(envelope);
  const stableCanonicalBytes = new Uint8Array(canonical.canonicalBytes);
  const stableSha256 = TransactionRequestSha256V1Schema.make(
    new Uint8Array(canonical.sha256),
  );
  return Object.freeze({
    envelope,
    canonicalText: canonical.canonicalText,
    get canonicalBytes(): Uint8Array {
      return new Uint8Array(stableCanonicalBytes);
    },
    get sha256(): TransactionRequestSha256V1 {
      return TransactionRequestSha256V1Schema.make(
        new Uint8Array(stableSha256),
      );
    },
  } satisfies CanonicalPointMutationRequestV1);
}

function selectionFailure(
  reason: Exclude<
    PointMutationTargetSelectionV1Issue["reason"],
    "argumentsTooLarge"
  >,
): PointMutationTargetSelectionV1Error {
  return new PointMutationTargetSelectionV1Error({ issue: { reason } });
}

function isRuntimeObject(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer);
}

export { ValidatorValueErrorV1 };
