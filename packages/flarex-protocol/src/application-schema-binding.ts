import {
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";

import {
  CatalogEdgeDefinitionIdSchema,
  CatalogIndexIdSchema,
  CatalogRelationIdSchema,
  CatalogTableIdSchema,
} from "./catalog";
import { snapshotDecodedProtocolPlainData } from
  "./decoded-protocol-snapshot";
import {
  encodeCanonicalJson,
  isJson,
  measureCanonicalJsonUtf8Bytes,
} from "./json";
import {
  RELATION_DECLARATION_FORMAT_V1,
  RELATION_DECLARATION_VERSION_V1,
  RelationDeclarationV1Schema,
  RelationSourcePathV1Schema,
  type RelationSourcePathV1,
} from "./relation-declaration-v1";
import {
  RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
  RELATION_OCCURRENCE_FORMAT_V1,
  RELATION_OCCURRENCE_VERSION_V1,
} from "./relation-occurrence-v1";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  SchemaManifestAppIndexDescriptorSchema,
  SchemaManifestAppTableNameSchema,
} from "./schema-manifest";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

const TEXT_ENCODER = new TextEncoder();

export const APPLICATION_SCHEMA_BINDING_FORMAT =
  "flarex.application-schema-binding" as const;
export const APPLICATION_SCHEMA_BINDING_VERSION_V1 = 1 as const;
export const APPLICATION_SCHEMA_BINDING_VERSION_V2 = 2 as const;
export const MAX_APPLICATION_SCHEMA_BINDING_RELATIONS = 1_024;
export const MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES =
  16 * 1_024 * 1_024;
export const MAX_SEMANTIC_RELATION_DEFINITION_CANONICAL_BYTES_V1 =
  16 * 1_024;
export const MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1 =
  16 * 1_024;
export const RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 = 128;
export const RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1 = 129;
export const RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1 = 4_096;

const PositiveSafeIntegerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const LowercaseSha256HexSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected an exact lowercase hexadecimal SHA-256 digest"
  ),
);
const DeploymentIdSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isNonBlankString(value) && !value.includes("\0")
      ? undefined
      : "Expected a nonblank deployment identity without null bytes"
  ),
);

export const ApplicationSchemaBindingSha256HexSchema =
  LowercaseSha256HexSchema.pipe(
    Schema.brand("FlarexDB/ApplicationSchemaBindingSha256Hex"),
  );
export type ApplicationSchemaBindingSha256Hex =
  typeof ApplicationSchemaBindingSha256HexSchema.Type;

export const ApplicationManifestSchemaBindingSha256HexSchema =
  LowercaseSha256HexSchema.pipe(
    Schema.brand("FlarexDB/ApplicationManifestSchemaBindingSha256Hex"),
  );
export type ApplicationManifestSchemaBindingSha256Hex =
  typeof ApplicationManifestSchemaBindingSha256HexSchema.Type;

export const SemanticRelationDefinitionSha256HexSchema =
  LowercaseSha256HexSchema.pipe(
    Schema.brand("FlarexDB/SemanticRelationDefinitionSha256Hex"),
  );
export type SemanticRelationDefinitionSha256Hex =
  typeof SemanticRelationDefinitionSha256HexSchema.Type;

export const EdgeDefinitionSha256HexSchema = LowercaseSha256HexSchema.pipe(
  Schema.brand("FlarexDB/EdgeDefinitionSha256Hex"),
);
export type EdgeDefinitionSha256Hex =
  typeof EdgeDefinitionSha256HexSchema.Type;

export const ApplicationSchemaTableBindingSchema = Schema.Struct({
  applicationTableId: PositiveSafeIntegerSchema,
  logicalName: SchemaManifestAppTableNameSchema,
  tableId: CatalogTableIdSchema,
}).annotate(StrictStructOptions);
export type ApplicationSchemaTableBinding =
  typeof ApplicationSchemaTableBindingSchema.Type;

export const ApplicationSchemaIndexBindingSchema = Schema.Struct({
  applicationIndexId: PositiveSafeIntegerSchema,
  applicationTableId: PositiveSafeIntegerSchema,
  descriptor: SchemaManifestAppIndexDescriptorSchema,
  logicalIndexId: CatalogIndexIdSchema,
  tableId: CatalogTableIdSchema,
}).annotate(StrictStructOptions);
export type ApplicationSchemaIndexBinding =
  typeof ApplicationSchemaIndexBindingSchema.Type;

const ApplicationSchemaTableBindingsSchema = Schema.Array(
  ApplicationSchemaTableBindingSchema,
).check(Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_TABLES));
const ApplicationSchemaIndexBindingsSchema = Schema.Array(
  ApplicationSchemaIndexBindingSchema,
).check(Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_INDEXES));

const ApplicationSchemaBindingV1StructuralSchema = Schema.Struct({
  format: Schema.Literal(APPLICATION_SCHEMA_BINDING_FORMAT),
  version: Schema.Literal(APPLICATION_SCHEMA_BINDING_VERSION_V1),
  deploymentId: DeploymentIdSchema,
  applicationSchemaSha256: LowercaseSha256HexSchema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  schemaVersion: CatalogSchemaVersionSchema,
  schemaManifestSha256: LowercaseSha256HexSchema,
  tables: ApplicationSchemaTableBindingsSchema,
  indexes: ApplicationSchemaIndexBindingsSchema,
}).annotate(StrictStructOptions);

export const ApplicationSchemaBindingV1Schema =
  ApplicationSchemaBindingV1StructuralSchema.check(
    Schema.makeFilter(validateBaseBinding),
  );
export type ApplicationSchemaBindingV1 =
  typeof ApplicationSchemaBindingV1Schema.Type;

/**
 * Schema-artifact-qualified semantic meaning for one stable logical relation.
 * The declaration remains the complete R01 semantic authority; stable table
 * and relation identities bind it to one deployed schema artifact.
 */
export const SemanticRelationDefinitionV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.semantic-relation-definition"),
  version: Schema.Literal(1),
  applicationSchemaSha256: LowercaseSha256HexSchema,
  relationId: CatalogRelationIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  declaration: RelationDeclarationV1Schema,
}).annotate(StrictStructOptions);
export type SemanticRelationDefinitionV1 =
  typeof SemanticRelationDefinitionV1Schema.Type;
export type SemanticRelationDefinition = SemanticRelationDefinitionV1;
export const SemanticRelationDefinitionSchema =
  SemanticRelationDefinitionV1Schema;

const CurrentOccurrenceIdentityV1Schema = Schema.Tuple([
  Schema.Literal("scopeId"),
  Schema.Literal("edgeDefinitionId"),
  Schema.Literal("sourceDocumentId"),
  Schema.Literal("targetDocumentId"),
  Schema.Literal("duplicateOrdinal"),
]);
const OutgoingEqualityPrefixV1Schema = Schema.Tuple([
  Schema.Literal("scopeId"),
  Schema.Literal("edgeDefinitionId"),
  Schema.Literal("sourceDocumentId"),
]);
const OutgoingOrderV1Schema = Schema.Tuple([
  Schema.Literal("targetDocumentId"),
  Schema.Literal("duplicateOrdinal"),
]);
const IncomingEqualityPrefixV1Schema = Schema.Tuple([
  Schema.Literal("scopeId"),
  Schema.Literal("edgeDefinitionId"),
  Schema.Literal("targetDocumentId"),
]);
const IncomingOrderV1Schema = Schema.Tuple([
  Schema.Literal("sourceDocumentId"),
  Schema.Literal("duplicateOrdinal"),
]);
const EndpointAdjacencyVersionKeyV1Schema = Schema.Tuple([
  Schema.Literal("scopeId"),
  Schema.Literal("edgeDefinitionId"),
  Schema.Literal("direction"),
  Schema.Literal("endpointDocumentId"),
]);

/**
 * First immutable physical edge meaning selected by R01/R01-P.
 *
 * Every access and snapshot choice is data in this contract so no later
 * reader may recover physical meaning from mutable active state.
 */
export const PhysicalEdgeDefinitionV1Schema = Schema.Struct({
  format: Schema.Literal("flarex.physical-edge-definition"),
  version: Schema.Literal(1),
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  sourcePath: RelationSourcePathV1Schema,
  sourceValueExtraction: Schema.Union([
    Schema.Literal("scalar"),
    Schema.Literal("array"),
  ]),
  duplicates: Schema.Literal("forbid"),
  localization: Schema.Struct({
    kind: Schema.Literal("none"),
  }).annotate(StrictStructOptions),
  positionRetention: Schema.Struct({
    storage: Schema.Literal("nullable"),
    scalar: Schema.Literal("null"),
    array: Schema.Literal("zeroBasedIndex"),
  }).annotate(StrictStructOptions),
  occurrenceCodec: Schema.Struct({
    format: Schema.Literal(RELATION_OCCURRENCE_FORMAT_V1),
    version: Schema.Literal(RELATION_OCCURRENCE_VERSION_V1),
    duplicateOrdinal: Schema.Literal(
      RELATION_OCCURRENCE_DUPLICATE_ORDINAL_V1,
    ),
  }).annotate(StrictStructOptions),
  currentOccurrenceIdentity: CurrentOccurrenceIdentityV1Schema,
  outgoingCurrentAccess: Schema.Struct({
    equalityPrefix: OutgoingEqualityPrefixV1Schema,
    order: OutgoingOrderV1Schema,
  }).annotate(StrictStructOptions),
  incomingCurrentAccess: Schema.Struct({
    equalityPrefix: IncomingEqualityPrefixV1Schema,
    order: IncomingOrderV1Schema,
  }).annotate(StrictStructOptions),
  currentProjection: Schema.Struct({
    position: Schema.Literal("includedNullable"),
    commitProvenance: Schema.Literal("included"),
  }).annotate(StrictStructOptions),
  incomingPage: Schema.Struct({
    maximumLogicalIdentities: Schema.Literal(
      RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1,
    ),
    maximumBaseRows: Schema.Literal(
      RELATION_INCOMING_PAGE_MAXIMUM_BASE_ROWS_V1,
    ),
    internalFrontier: IncomingOrderV1Schema,
    exhausted: Schema.Literal(
      "allReturnedRowsConsumedAndNoLookahead",
    ),
    callerAuthoredCursor: Schema.Literal("none"),
    maximumTransactionBaseOccurrences: Schema.Literal(
      RELATION_TRANSACTION_MAXIMUM_BASE_OCCURRENCES_V1,
    ),
  }).annotate(StrictStructOptions),
  snapshot: Schema.Struct({
    kind: Schema.Literal("endpointAdjacencyVersion"),
    version: Schema.Literal(1),
    key: EndpointAdjacencyVersionKeyV1Schema,
    value: Schema.Literal("lastChangedCommitSeq"),
    absentValue: Schema.Literal("0"),
    advancement: Schema.Literal("oncePerAffectedEndpointScopeCommit"),
    pageRead: Schema.Literal("versionBeforeCurrentPageVersionAfter"),
    snapshotEligibility: Schema.Literal(
      "versionsEqualAndAtOrBeforeSnapshot",
    ),
    dependency: Schema.Literal("exactObservedEndpointVersion"),
    validationLockOrder: Schema.Literal("scopeClockFirst"),
    finalValidation: Schema.Literal("dependencyUnchanged"),
    conflict: Schema.Literal("replaceAttemptAndDeterministicallyRerun"),
    historyFallback: Schema.Literal("forbidden"),
  }).annotate(StrictStructOptions),
}).annotate(StrictStructOptions);
export type PhysicalEdgeDefinitionV1 =
  typeof PhysicalEdgeDefinitionV1Schema.Type;
export type PhysicalEdgeDefinition = PhysicalEdgeDefinitionV1;
export const PhysicalEdgeDefinitionSchema = PhysicalEdgeDefinitionV1Schema;

export const RELATION_SEMANTIC_CHANGE_ORDER_V1 = Object.freeze([
  "sourceTable",
  "sourcePath",
  "forwardName",
  "targetTable",
  "cardinality",
  "required",
  "minimumItems",
  "maximumItems",
  "ordering",
  "duplicates",
  "inverseCardinality",
  "inverseName",
  "localization",
  "targetDeletePolicy",
] as const);

export const RelationSemanticChangeV1Schema = Schema.Literals(
  RELATION_SEMANTIC_CHANGE_ORDER_V1,
);
export type RelationSemanticChangeV1 =
  typeof RelationSemanticChangeV1Schema.Type;

const RelationSemanticChangesV1Schema = Schema.Array(
  RelationSemanticChangeV1Schema,
).check(
  Schema.isMaxLength(RELATION_SEMANTIC_CHANGE_ORDER_V1.length),
  Schema.makeFilter((changes) => {
    let priorIndex = -1;
    for (const change of changes) {
      const currentIndex = RELATION_SEMANTIC_CHANGE_ORDER_V1.indexOf(change);
      if (currentIndex <= priorIndex) {
        return "Expected unique semantic changes in canonical V1 order";
      }
      priorIndex = currentIndex;
    }
    return undefined;
  }),
);

export const RelationCompatibilityClassificationV1Schema = Schema.Struct({
  declarationCodec: Schema.Literal("sameV1"),
  changes: RelationSemanticChangesV1Schema,
}).annotate(StrictStructOptions);
export type RelationCompatibilityClassificationV1 =
  typeof RelationCompatibilityClassificationV1Schema.Type;

export const ApplicationSchemaRelationBindingV2Schema = Schema.Struct({
  relationOrdinal: PositiveSafeIntegerSchema,
  sourceTableOrdinal: PositiveSafeIntegerSchema,
  targetTableOrdinal: PositiveSafeIntegerSchema,
  relationId: CatalogRelationIdSchema,
  sourceTableId: CatalogTableIdSchema,
  targetTableId: CatalogTableIdSchema,
  semanticDefinitionSha256: SemanticRelationDefinitionSha256HexSchema,
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  evolution: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("new"),
    }).annotate(StrictStructOptions),
    Schema.Struct({
      kind: Schema.Literal("preserve"),
      fromSchemaVersionId: CatalogSchemaVersionIdSchema,
      fromRelationOrdinal: PositiveSafeIntegerSchema,
      physical: Schema.Union([
        Schema.Literal("reuse"),
        Schema.Literal("replace"),
      ]),
      compatibility: RelationCompatibilityClassificationV1Schema,
    }).annotate(StrictStructOptions),
  ]),
}).annotate(StrictStructOptions);
export type ApplicationSchemaRelationBindingV2 =
  typeof ApplicationSchemaRelationBindingV2Schema.Type;

export const ApplicationSchemaSemanticDefinitionV2Schema = Schema.Struct({
  relationId: CatalogRelationIdSchema,
  semanticDefinitionSha256: SemanticRelationDefinitionSha256HexSchema,
  definition: SemanticRelationDefinitionV1Schema,
}).annotate(StrictStructOptions);
export type ApplicationSchemaSemanticDefinitionV2 =
  typeof ApplicationSchemaSemanticDefinitionV2Schema.Type;

export const ApplicationSchemaEdgeDefinitionV2Schema = Schema.Struct({
  edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
  edgeDefinitionSha256: EdgeDefinitionSha256HexSchema,
  definition: PhysicalEdgeDefinitionV1Schema,
}).annotate(StrictStructOptions);
export type ApplicationSchemaEdgeDefinitionV2 =
  typeof ApplicationSchemaEdgeDefinitionV2Schema.Type;

const ApplicationSchemaBindingV2StructuralSchema = Schema.Struct({
  format: Schema.Literal(APPLICATION_SCHEMA_BINDING_FORMAT),
  version: Schema.Literal(APPLICATION_SCHEMA_BINDING_VERSION_V2),
  deploymentId: DeploymentIdSchema,
  applicationSchemaSha256: LowercaseSha256HexSchema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  schemaVersion: CatalogSchemaVersionSchema,
  schemaManifestSha256: LowercaseSha256HexSchema,
  tables: ApplicationSchemaTableBindingsSchema,
  indexes: ApplicationSchemaIndexBindingsSchema,
  relationBindings: Schema.Array(
    ApplicationSchemaRelationBindingV2Schema,
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_APPLICATION_SCHEMA_BINDING_RELATIONS),
  ),
  semanticDefinitions: Schema.Array(
    ApplicationSchemaSemanticDefinitionV2Schema,
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_APPLICATION_SCHEMA_BINDING_RELATIONS),
  ),
  edgeDefinitions: Schema.Array(
    ApplicationSchemaEdgeDefinitionV2Schema,
  ).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_APPLICATION_SCHEMA_BINDING_RELATIONS),
  ),
}).annotate(StrictStructOptions);

export const ApplicationSchemaBindingV2Schema =
  ApplicationSchemaBindingV2StructuralSchema.check(
    Schema.makeFilter(validateBindingV2),
  );
export type ApplicationSchemaBindingV2 =
  typeof ApplicationSchemaBindingV2Schema.Type;

export type ApplicationSchemaBinding =
  | ApplicationSchemaBindingV1
  | ApplicationSchemaBindingV2;
export const ApplicationSchemaBindingSchema = Schema.Union([
  ApplicationSchemaBindingV1Schema,
  ApplicationSchemaBindingV2Schema,
]);

export const APPLICATION_MANIFEST_SCHEMA_BINDING_FORMAT_V1 =
  "flarex.application-manifest-schema-binding" as const;
export const APPLICATION_MANIFEST_SCHEMA_BINDING_VERSION_V1 = 1 as const;

/**
 * Revision-local pin from one analyzed manifest to its reusable bound schema.
 * Keeping this separate prevents function-only manifest changes from creating
 * another stable schema publication.
 */
export const ApplicationManifestSchemaBindingV1Schema = Schema.Struct({
  format: Schema.Literal(APPLICATION_MANIFEST_SCHEMA_BINDING_FORMAT_V1),
  version: Schema.Literal(APPLICATION_MANIFEST_SCHEMA_BINDING_VERSION_V1),
  deploymentId: DeploymentIdSchema,
  applicationManifestSha256: LowercaseSha256HexSchema,
  applicationSchemaSha256: LowercaseSha256HexSchema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  schemaVersion: CatalogSchemaVersionSchema,
  boundPublicationSha256: ApplicationSchemaBindingSha256HexSchema,
}).annotate(StrictStructOptions);
export type ApplicationManifestSchemaBindingV1 =
  typeof ApplicationManifestSchemaBindingV1Schema.Type;
export type ApplicationManifestSchemaBinding =
  ApplicationManifestSchemaBindingV1;
export const ApplicationManifestSchemaBindingSchema =
  ApplicationManifestSchemaBindingV1Schema;

export type ApplicationSchemaBindingOperation =
  | "decodeBinding"
  | "canonicalizeBinding"
  | "decodeManifestBinding"
  | "canonicalizeManifestBinding"
  | "canonicalizeSemanticDefinition"
  | "canonicalizeEdgeDefinition";
export type ApplicationSchemaBindingIssue =
  | Readonly<{ readonly reason: "invalidInput"; readonly cause?: unknown }>
  | Readonly<{
      readonly reason: "canonicalBytesExceeded";
      readonly observed: number;
      readonly maximum: number;
    }>
  | Readonly<{ readonly reason: "digestUnavailable"; readonly cause: unknown }>
  | Readonly<{
      readonly reason: "definitionDigestMismatch";
      readonly path: string;
    }>;

export class ApplicationSchemaBindingError extends Data.TaggedError(
  "ApplicationSchemaBindingError",
)<{
  readonly operation: ApplicationSchemaBindingOperation;
  readonly issue: ApplicationSchemaBindingIssue;
}> {}

export interface CanonicalSemanticRelationDefinitionV1 {
  readonly definition: SemanticRelationDefinitionV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: SemanticRelationDefinitionSha256Hex;
}

export interface CanonicalPhysicalEdgeDefinitionV1 {
  readonly definition: PhysicalEdgeDefinitionV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: EdgeDefinitionSha256Hex;
}

export interface CanonicalApplicationSchemaBindingV1 {
  readonly binding: ApplicationSchemaBindingV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: ApplicationSchemaBindingSha256Hex;
}

export interface CanonicalApplicationSchemaBindingV2 {
  readonly binding: ApplicationSchemaBindingV2;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: ApplicationSchemaBindingSha256Hex;
}

export interface CanonicalApplicationManifestSchemaBindingV1 {
  readonly binding: ApplicationManifestSchemaBindingV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256Hex: ApplicationManifestSchemaBindingSha256Hex;
}

export type CanonicalApplicationManifestSchemaBinding =
  CanonicalApplicationManifestSchemaBindingV1;

export type CanonicalApplicationSchemaBinding =
  | CanonicalApplicationSchemaBindingV1
  | CanonicalApplicationSchemaBindingV2;

const decodeBindingV1Shape = Schema.decodeUnknownResult(
  ApplicationSchemaBindingV1Schema,
  StrictParseOptions,
);
const decodeBindingV2Shape = Schema.decodeUnknownResult(
  ApplicationSchemaBindingV2Schema,
  StrictParseOptions,
);
const decodeSemanticDefinitionV1Shape = Schema.decodeUnknownResult(
  SemanticRelationDefinitionV1Schema,
  StrictParseOptions,
);
const decodeEdgeDefinitionV1Shape = Schema.decodeUnknownResult(
  PhysicalEdgeDefinitionV1Schema,
  StrictParseOptions,
);
const decodeManifestSchemaBindingV1Shape = Schema.decodeUnknownResult(
  ApplicationManifestSchemaBindingV1Schema,
  StrictParseOptions,
);

export function decodeApplicationSchemaBindingV1Result(
  input: unknown,
): Result.Result<ApplicationSchemaBindingV1, ApplicationSchemaBindingError> {
  return decodeOwnedValueResult(
    input,
    decodeBindingV1Shape,
    "decodeBinding",
  );
}

export function decodeApplicationSchemaBindingV2Result(
  input: unknown,
): Result.Result<ApplicationSchemaBindingV2, ApplicationSchemaBindingError> {
  return decodeOwnedValueResult(
    input,
    decodeBindingV2Shape,
    "decodeBinding",
  );
}

export function decodeApplicationSchemaBindingResult(
  input: unknown,
): Result.Result<ApplicationSchemaBinding, ApplicationSchemaBindingError> {
  return Result.gen(function* () {
    const version = yield* bindingVersionResult(input);
    if (version === APPLICATION_SCHEMA_BINDING_VERSION_V1) {
      const binding = yield* decodeApplicationSchemaBindingV1Result(input);
      return binding;
    }
    const binding = yield* decodeApplicationSchemaBindingV2Result(input);
    return binding;
  });
}

export function decodeSemanticRelationDefinitionResult(
  input: unknown,
): Result.Result<SemanticRelationDefinition, ApplicationSchemaBindingError> {
  return decodeOwnedValueResult(
    input,
    decodeSemanticDefinitionV1Shape,
    "canonicalizeSemanticDefinition",
    MAX_SEMANTIC_RELATION_DEFINITION_CANONICAL_BYTES_V1,
  );
}

export function decodePhysicalEdgeDefinitionResult(
  input: unknown,
): Result.Result<PhysicalEdgeDefinition, ApplicationSchemaBindingError> {
  return decodeOwnedValueResult(
    input,
    decodeEdgeDefinitionV1Shape,
    "canonicalizeEdgeDefinition",
    MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1,
  );
}

export function decodeApplicationManifestSchemaBindingResult(
  input: unknown,
): Result.Result<
  ApplicationManifestSchemaBinding,
  ApplicationSchemaBindingError
> {
  return decodeOwnedValueResult(
    input,
    decodeManifestSchemaBindingV1Shape,
    "decodeManifestBinding",
  );
}

export const canonicalizeSemanticRelationDefinitionV1 = Effect.fn(
  "ApplicationSchemaBinding.canonicalizeSemanticRelationDefinitionV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalSemanticRelationDefinitionV1,
  ApplicationSchemaBindingError
> {
  const definition = yield* Effect.fromResult(
    decodeSemanticRelationDefinitionResult(input),
  );
  const encoded = yield* encodeAndDigest(
    definition,
    "canonicalizeSemanticDefinition",
    MAX_SEMANTIC_RELATION_DEFINITION_CANONICAL_BYTES_V1,
  );
  return Object.freeze({
    definition,
    canonicalText: encoded.canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(encoded.stableBytes);
    },
    sha256Hex: SemanticRelationDefinitionSha256HexSchema.make(
      encoded.sha256Hex,
    ),
  });
});

export const canonicalizeSemanticRelationDefinition =
  canonicalizeSemanticRelationDefinitionV1;

export const canonicalizePhysicalEdgeDefinitionV1 = Effect.fn(
  "ApplicationSchemaBinding.canonicalizePhysicalEdgeDefinitionV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalPhysicalEdgeDefinitionV1,
  ApplicationSchemaBindingError
> {
  const definition = yield* Effect.fromResult(
    decodePhysicalEdgeDefinitionResult(input),
  );
  const encoded = yield* encodeAndDigest(
    definition,
    "canonicalizeEdgeDefinition",
    MAX_PHYSICAL_EDGE_DEFINITION_CANONICAL_BYTES_V1,
  );
  return Object.freeze({
    definition,
    canonicalText: encoded.canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(encoded.stableBytes);
    },
    sha256Hex: EdgeDefinitionSha256HexSchema.make(encoded.sha256Hex),
  });
});

export const canonicalizePhysicalEdgeDefinition =
  canonicalizePhysicalEdgeDefinitionV1;

export const canonicalizeApplicationSchemaBindingV1 = Effect.fn(
  "ApplicationSchemaBinding.canonicalizeV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalApplicationSchemaBindingV1,
  ApplicationSchemaBindingError
> {
  const binding = yield* Effect.fromResult(
    decodeApplicationSchemaBindingV1Result(input),
  );
  const encoded = yield* encodeAndDigest(binding, "canonicalizeBinding");
  return canonicalBindingV1(binding, encoded);
});

export const canonicalizeApplicationSchemaBindingV2 = Effect.fn(
  "ApplicationSchemaBinding.canonicalizeV2",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalApplicationSchemaBindingV2,
  ApplicationSchemaBindingError
> {
  const binding = yield* Effect.fromResult(
    decodeApplicationSchemaBindingV2Result(input),
  );
  for (let index = 0; index < binding.semanticDefinitions.length; index += 1) {
    const entry = binding.semanticDefinitions[index];
    if (entry === undefined) {
      return yield* Effect.die(
        new Error("Semantic definition array lost an entry."),
      );
    }
    const canonical = yield* canonicalizeSemanticRelationDefinition(
      entry.definition,
    );
    if (canonical.sha256Hex !== entry.semanticDefinitionSha256) {
      return yield* digestMismatch(`semanticDefinitions[${index}]`);
    }
  }
  for (let index = 0; index < binding.edgeDefinitions.length; index += 1) {
    const entry = binding.edgeDefinitions[index];
    if (entry === undefined) {
      return yield* Effect.die(
        new Error("Edge definition array lost an entry."),
      );
    }
    const canonical = yield* canonicalizePhysicalEdgeDefinition(
      entry.definition,
    );
    if (canonical.sha256Hex !== entry.edgeDefinitionSha256) {
      return yield* digestMismatch(`edgeDefinitions[${index}]`);
    }
  }
  const encoded = yield* encodeAndDigest(binding, "canonicalizeBinding");
  return canonicalBindingV2(binding, encoded);
});

export const canonicalizeApplicationSchemaBinding = Effect.fn(
  "ApplicationSchemaBinding.canonicalize",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalApplicationSchemaBinding,
  ApplicationSchemaBindingError
> {
  const version = yield* Effect.fromResult(bindingVersionResult(input));
  return version === APPLICATION_SCHEMA_BINDING_VERSION_V1
    ? yield* canonicalizeApplicationSchemaBindingV1(input)
    : yield* canonicalizeApplicationSchemaBindingV2(input);
});

export const canonicalizeApplicationManifestSchemaBindingV1 = Effect.fn(
  "ApplicationSchemaBinding.canonicalizeManifestBindingV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  CanonicalApplicationManifestSchemaBindingV1,
  ApplicationSchemaBindingError
> {
  const binding = yield* Effect.fromResult(
    decodeApplicationManifestSchemaBindingResult(input),
  );
  const encoded = yield* encodeAndDigest(
    binding,
    "canonicalizeManifestBinding",
  );
  return Object.freeze({
    binding,
    canonicalText: encoded.canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(encoded.stableBytes);
    },
    sha256Hex: ApplicationManifestSchemaBindingSha256HexSchema.make(
      encoded.sha256Hex,
    ),
  });
});

export const canonicalizeApplicationManifestSchemaBinding =
  canonicalizeApplicationManifestSchemaBindingV1;

function canonicalBindingV1(
  binding: ApplicationSchemaBindingV1,
  encoded: EncodedAndDigested,
): CanonicalApplicationSchemaBindingV1 {
  return Object.freeze({
    binding,
    canonicalText: encoded.canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(encoded.stableBytes);
    },
    sha256Hex: ApplicationSchemaBindingSha256HexSchema.make(
      encoded.sha256Hex,
    ),
  });
}

function canonicalBindingV2(
  binding: ApplicationSchemaBindingV2,
  encoded: EncodedAndDigested,
): CanonicalApplicationSchemaBindingV2 {
  return Object.freeze({
    binding,
    canonicalText: encoded.canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(encoded.stableBytes);
    },
    sha256Hex: ApplicationSchemaBindingSha256HexSchema.make(
      encoded.sha256Hex,
    ),
  });
}

interface EncodedAndDigested {
  readonly canonicalText: string;
  readonly stableBytes: Uint8Array;
  readonly sha256Hex: string;
}

const encodeAndDigest = Effect.fn(function* (
  value: unknown,
  operation: Exclude<
    ApplicationSchemaBindingOperation,
    "decodeBinding" | "decodeManifestBinding"
  >,
  maximumBytes: number = MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES,
): Effect.fn.Return<EncodedAndDigested, ApplicationSchemaBindingError> {
  const measurement = measureCanonicalJsonUtf8Bytes(
    value,
    maximumBytes,
  );
  if (measurement.kind === "invalid") {
    return yield* Effect.fail(bindingError(operation, {
      reason: "invalidInput",
    }));
  }
  if (measurement.kind === "exceeded") {
    return yield* Effect.fail(bindingError(operation, {
      reason: "canonicalBytesExceeded",
      observed: measurement.observed,
      maximum: maximumBytes,
    }));
  }
  if (!isJson(value)) {
    return yield* Effect.fail(bindingError(operation, {
      reason: "invalidInput",
    }));
  }
  const canonicalText = encodeCanonicalJson(value, issue => {
    throw new Error(
      `Validated application schema binding lost JSON: ${issue.reason}.`,
    );
  });
  const encoded = TEXT_ENCODER.encode(canonicalText);
  if (encoded.byteLength !== measurement.bytes) {
    return yield* Effect.die(
      new Error("Application schema binding byte measurement drifted."),
    );
  }
  const stableBytes = copyBytes(encoded);
  const digest = yield* Effect.tryPromise({
    try: () => crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(stableBytes),
    ),
    catch: cause => bindingError(operation, {
      reason: "digestUnavailable",
      cause,
    }),
  });
  return Object.freeze({
    canonicalText,
    stableBytes,
    sha256Hex: encodeBytesToLowercaseHex(new Uint8Array(digest)),
  });
});

function decodeOwnedValueResult<A>(
  input: unknown,
  decode: (
    input: unknown,
  ) => Result.Result<A, Schema.SchemaError>,
  operation: ApplicationSchemaBindingOperation,
  maximumBytes: number = MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES,
): Result.Result<A, ApplicationSchemaBindingError> {
  const measurement = measureCanonicalJsonUtf8Bytes(
    input,
    maximumBytes,
  );
  if (measurement.kind === "invalid") {
    return Result.fail(bindingError(operation, { reason: "invalidInput" }));
  }
  if (measurement.kind === "exceeded") {
    return Result.fail(bindingError(operation, {
      reason: "canonicalBytesExceeded",
      observed: measurement.observed,
      maximum: maximumBytes,
    }));
  }
  return decode(input).pipe(
    Result.mapError(cause => bindingError(operation, {
      reason: "invalidInput",
      cause,
    })),
    Result.map(snapshotDecodedProtocolPlainData),
  );
}

function bindingVersionResult(
  input: unknown,
): Result.Result<1 | 2, ApplicationSchemaBindingError> {
  const measurement = measureCanonicalJsonUtf8Bytes(
    input,
    MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES,
  );
  if (measurement.kind === "invalid") {
    return Result.fail(bindingError("decodeBinding", {
      reason: "invalidInput",
    }));
  }
  if (measurement.kind === "exceeded") {
    return Result.fail(bindingError("decodeBinding", {
      reason: "canonicalBytesExceeded",
      observed: measurement.observed,
      maximum: MAX_APPLICATION_SCHEMA_BINDING_CANONICAL_BYTES,
    }));
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return Result.fail(bindingError("decodeBinding", {
      reason: "invalidInput",
    }));
  }
  const descriptor = Object.getOwnPropertyDescriptor(input, "version");
  return descriptor !== undefined && "value" in descriptor &&
      (descriptor.value === APPLICATION_SCHEMA_BINDING_VERSION_V1 ||
        descriptor.value === APPLICATION_SCHEMA_BINDING_VERSION_V2)
    ? Result.succeed(descriptor.value)
    : Result.fail(bindingError("decodeBinding", { reason: "invalidInput" }));
}

function validateBaseBinding(
  binding: typeof ApplicationSchemaBindingV1StructuralSchema.Type,
): string | undefined {
  const tableIds = new Set<number>();
  const tableNames = new Set<string>();
  for (let index = 0; index < binding.tables.length; index += 1) {
    const table = binding.tables[index];
    if (table === undefined || table.applicationTableId !== index + 1) {
      return "Expected tables in dense application-table ordinal order";
    }
    if (tableIds.has(table.tableId) || tableNames.has(table.logicalName)) {
      return "Expected unique stable table identities and logical names";
    }
    tableIds.add(table.tableId);
    tableNames.add(table.logicalName);
  }
  const logicalIndexIds = new Set<number>();
  const descriptors = new Set<string>();
  for (let index = 0; index < binding.indexes.length; index += 1) {
    const item = binding.indexes[index];
    if (item === undefined || item.applicationIndexId !== index + 1) {
      return "Expected indexes in dense application-index ordinal order";
    }
    const table = binding.tables[item.applicationTableId - 1];
    if (table === undefined || table.tableId !== item.tableId) {
      return "Expected every index mapping to reference its exact table mapping";
    }
    const descriptorKey = `${item.tableId}:${item.descriptor}`;
    if (
      logicalIndexIds.has(item.logicalIndexId) ||
      descriptors.has(descriptorKey)
    ) {
      return "Expected unique logical index identities and table descriptors";
    }
    logicalIndexIds.add(item.logicalIndexId);
    descriptors.add(descriptorKey);
  }
  return undefined;
}

function validateBindingV2(
  binding: typeof ApplicationSchemaBindingV2StructuralSchema.Type,
): string | undefined {
  const baseIssue = validateBaseBinding({
    ...binding,
    version: APPLICATION_SCHEMA_BINDING_VERSION_V1,
  });
  if (baseIssue !== undefined) return baseIssue;
  if (
    binding.semanticDefinitions.length !== binding.relationBindings.length
  ) {
    return "Expected one semantic definition per relation binding";
  }

  const semanticsByRelation = new Map<
    number,
    ApplicationSchemaSemanticDefinitionV2
  >();
  const semanticDigests = new Set<string>();
  let priorRelationId = 0;
  for (const semantic of binding.semanticDefinitions) {
    if (
      semantic.relationId <= priorRelationId ||
      semanticsByRelation.has(semantic.relationId) ||
      semanticDigests.has(semantic.semanticDefinitionSha256) ||
      semantic.definition.relationId !== semantic.relationId ||
      semantic.definition.applicationSchemaSha256 !==
        binding.applicationSchemaSha256
    ) {
      return "Expected ordered, unique, schema-qualified semantic definitions";
    }
    priorRelationId = semantic.relationId;
    semanticsByRelation.set(semantic.relationId, semantic);
    semanticDigests.add(semantic.semanticDefinitionSha256);
  }

  const edgesById = new Map<number, ApplicationSchemaEdgeDefinitionV2>();
  const edgeDigests = new Set<string>();
  let priorEdgeDefinitionId = 0;
  for (const edge of binding.edgeDefinitions) {
    if (
      edge.edgeDefinitionId <= priorEdgeDefinitionId ||
      edgesById.has(edge.edgeDefinitionId) ||
      edgeDigests.has(edge.edgeDefinitionSha256)
    ) {
      return "Expected ordered, unique physical edge definitions";
    }
    priorEdgeDefinitionId = edge.edgeDefinitionId;
    edgesById.set(edge.edgeDefinitionId, edge);
    edgeDigests.add(edge.edgeDefinitionSha256);
  }

  const relationIds = new Set<number>();
  const referencedEdges = new Set<number>();
  for (let index = 0; index < binding.relationBindings.length; index += 1) {
    const relation = binding.relationBindings[index];
    if (
      relation === undefined || relation.relationOrdinal !== index + 1 ||
      relationIds.has(relation.relationId)
    ) {
      return "Expected dense relation-ordinal order and unique relation identities";
    }
    if (
      relation.evolution.kind === "preserve" &&
      relation.evolution.fromSchemaVersionId === binding.schemaVersionId
    ) {
      return "Expected preserved relation origin to name a prior schema";
    }
    relationIds.add(relation.relationId);
    const source = binding.tables[relation.sourceTableOrdinal - 1];
    const target = binding.tables[relation.targetTableOrdinal - 1];
    if (
      source === undefined || target === undefined ||
      source.tableId !== relation.sourceTableId ||
      target.tableId !== relation.targetTableId
    ) {
      return "Expected relation ordinals to resolve to exact stable table identities";
    }
    const semantic = semanticsByRelation.get(relation.relationId);
    const edge = edgesById.get(relation.edgeDefinitionId);
    if (
      semantic === undefined || edge === undefined ||
      semantic.semanticDefinitionSha256 !==
        relation.semanticDefinitionSha256 ||
      referencedEdges.has(relation.edgeDefinitionId) ||
      !semanticMatchesBinding(semantic.definition, relation, source, target) ||
      !physicalMatchesSemantic(edge.definition, semantic.definition)
    ) {
      return "Expected relation bindings and relation-owned definition references to agree exactly";
    }
    referencedEdges.add(relation.edgeDefinitionId);
  }
  if (
    semanticsByRelation.size !== relationIds.size ||
    referencedEdges.size !== edgesById.size
  ) {
    return "Expected no unreferenced semantic or physical definitions";
  }
  return undefined;
}

function semanticMatchesBinding(
  definition: SemanticRelationDefinitionV1,
  binding: ApplicationSchemaRelationBindingV2,
  source: ApplicationSchemaTableBinding,
  target: ApplicationSchemaTableBinding,
): boolean {
  return definition.relationId === binding.relationId &&
    definition.sourceTableId === binding.sourceTableId &&
    definition.targetTableId === binding.targetTableId &&
    definition.declaration.format === RELATION_DECLARATION_FORMAT_V1 &&
    definition.declaration.version === RELATION_DECLARATION_VERSION_V1 &&
    String(definition.declaration.source.table) === String(source.logicalName) &&
    String(definition.declaration.target.table) === String(target.logicalName);
}

function physicalMatchesSemantic(
  physical: PhysicalEdgeDefinitionV1,
  semantic: SemanticRelationDefinitionV1,
): boolean {
  return physical.sourceTableId === semantic.sourceTableId &&
    physical.targetTableId === semantic.targetTableId &&
    sourcePathsEqual(physical.sourcePath, semantic.declaration.source.path) &&
    physical.sourceValueExtraction ===
      (semantic.declaration.value.cardinality === "one" ? "scalar" : "array");
}

function sourcePathsEqual(
  left: RelationSourcePathV1,
  right: RelationSourcePathV1,
): boolean {
  const leftSegment = left[0];
  const rightSegment = right[0];
  return leftSegment !== undefined && rightSegment !== undefined &&
    leftSegment.kind === rightSegment.kind &&
    leftSegment.name === rightSegment.name;
}

function digestMismatch(
  path: string,
): Effect.Effect<never, ApplicationSchemaBindingError> {
  return Effect.fail(bindingError("canonicalizeBinding", {
    reason: "definitionDigestMismatch",
    path,
  }));
}

function bindingError(
  operation: ApplicationSchemaBindingOperation,
  issue: ApplicationSchemaBindingIssue,
): ApplicationSchemaBindingError {
  return new ApplicationSchemaBindingError({ operation, issue });
}
