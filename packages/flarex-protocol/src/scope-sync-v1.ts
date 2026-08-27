import {
  compareUtf16Strings,
  isNonBlankString,
} from "@flarex/utils/strings";
import { Data, Result, Schema } from "effect";

import {
  AppDocumentIdV1Schema,
  AppRowIdHexV1Schema,
} from "./app-document-id";
import {
  CatalogEdgeDefinitionIdSchema,
  CatalogTableIdSchema,
} from "./catalog";
import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
} from "./commit-protocol";
import {
  CommitSeqSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
} from "./storage-authority";
import { CatalogSchemaVersionIdSchema } from "./schema-manifest";
import { CanonicalPositivePostgresBigIntFromString } from "./postgres-bigint";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const SCOPE_SYNC_CURSOR_FORMAT_V1 = "flarex.scope-sync-cursor";
export const SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1 =
  "flarex.scope-sync-canonical-query";
export const SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1 =
  "flarex.scope-sync-dependency-key";
export const SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1 =
  "flarex.scope-sync-query-generation";
export const SCOPE_SYNC_WAKE_FORMAT_V1 = "flarex.scope-sync-wake";
export const SCOPE_SYNC_PROTOCOL_VERSION_V1 = 1;
export const MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1 = 4_096;
export const MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1 =
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 +
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 +
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1;

const TEXT_ENCODER = new TextEncoder();
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/;

const ScopeSyncQueryTextV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    isNonBlankString(value) &&
      !value.includes("\0") &&
      isWellFormedUnicode(value) &&
      TEXT_ENCODER.encode(value).byteLength <=
        MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1
      ? undefined
      : `Expected well-formed NUL-free nonblank query text no greater than ${MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1} UTF-8 bytes`
  ),
);
const BoundedScopeSyncSchemaVersionIdV1Schema =
  CatalogSchemaVersionIdSchema.check(
    Schema.makeFilter((value) =>
      TEXT_ENCODER.encode(value).byteLength <=
        MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1
        ? undefined
        : `Expected schema version ID no greater than ${MAX_SCOPE_SYNC_QUERY_TEXT_UTF8_BYTES_V1} UTF-8 bytes`
    ),
  );
const ScopeSyncSha256HexV1Schema = Schema.String.check(
  Schema.isPattern(LOWERCASE_SHA256_PATTERN),
);

export const ScopeSyncQueryGenerationSequenceV1Schema =
  CanonicalPositivePostgresBigIntFromString.pipe(
    Schema.brand("FlarexDB/ScopeSyncQueryGenerationSequenceV1"),
  );
export type ScopeSyncQueryGenerationSequenceV1 =
  typeof ScopeSyncQueryGenerationSequenceV1Schema.Type;

export const ScopeSyncQuerySourcePackageSha256HexV1Schema =
  ScopeSyncSha256HexV1Schema.pipe(
    Schema.brand("FlarexDB/ScopeSyncQuerySourcePackageSha256HexV1"),
  );
export type ScopeSyncQuerySourcePackageSha256HexV1 =
  typeof ScopeSyncQuerySourcePackageSha256HexV1Schema.Type;
export const ScopeSyncQueryArgumentsSha256HexV1Schema =
  ScopeSyncSha256HexV1Schema.pipe(
    Schema.brand("FlarexDB/ScopeSyncQueryArgumentsSha256HexV1"),
  );
export type ScopeSyncQueryArgumentsSha256HexV1 =
  typeof ScopeSyncQueryArgumentsSha256HexV1Schema.Type;
export const ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema =
  ScopeSyncSha256HexV1Schema.pipe(
    Schema.brand(
      "FlarexDB/ScopeSyncQueryIdentityAccessPolicySha256HexV1",
    ),
  );
export type ScopeSyncQueryIdentityAccessPolicySha256HexV1 =
  typeof ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema.Type;
export const ScopeSyncQueryResultSha256HexV1Schema =
  ScopeSyncSha256HexV1Schema.pipe(
    Schema.brand("FlarexDB/ScopeSyncQueryResultSha256HexV1"),
  );
export type ScopeSyncQueryResultSha256HexV1 =
  typeof ScopeSyncQueryResultSha256HexV1Schema.Type;

export const ScopeSyncCanonicalQueryIdentityV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  activationSequence: ApplicationActivationSequenceV1Schema,
  activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema,
  sourcePackageSha256Hex: ScopeSyncQuerySourcePackageSha256HexV1Schema,
  schemaVersionId: BoundedScopeSyncSchemaVersionIdV1Schema,
  policyVersion: ScopeSyncQueryTextV1Schema,
  componentPath: Schema.NullOr(ScopeSyncQueryTextV1Schema),
  functionPath: ScopeSyncQueryTextV1Schema,
  argumentsSha256Hex: ScopeSyncQueryArgumentsSha256HexV1Schema,
  identityAccessPolicySha256Hex:
    ScopeSyncQueryIdentityAccessPolicySha256HexV1Schema,
}).annotate(StrictStructOptions);
export type ScopeSyncCanonicalQueryIdentityV1 =
  typeof ScopeSyncCanonicalQueryIdentityV1Schema.Type;

export const ScopeSyncCursorV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_CURSOR_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  appliedThroughCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);
export type ScopeSyncCursorV1 = typeof ScopeSyncCursorV1Schema.Type;

export const ScopeSyncWakeV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_WAKE_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  observedCommitSeq: CommitSeqSchema,
}).annotate(StrictStructOptions);
export type ScopeSyncWakeV1 = typeof ScopeSyncWakeV1Schema.Type;

const ScopeSyncAppRowPointDependencyKeyV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  kind: Schema.Literal("appRowPoint"),
  documentId: AppDocumentIdV1Schema,
}).annotate(StrictStructOptions);

const ScopeSyncAppTableDependencyKeyV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  kind: Schema.Literal("appTable"),
  tableId: CatalogTableIdSchema,
}).annotate(StrictStructOptions);

const ScopeSyncApplicationRelationIncomingDependencyKeyV1Schema =
  Schema.Struct({
    format: Schema.Literal(SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1),
    version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
    kind: Schema.Literal("appRelationIncoming"),
    edgeDefinitionId: CatalogEdgeDefinitionIdSchema,
    targetRowId: AppRowIdHexV1Schema,
  }).annotate(StrictStructOptions);

export const ScopeSyncDependencyKeyV1Schema = Schema.Union([
  ScopeSyncAppRowPointDependencyKeyV1Schema,
  ScopeSyncAppTableDependencyKeyV1Schema,
  ScopeSyncApplicationRelationIncomingDependencyKeyV1Schema,
]);
export type ScopeSyncDependencyKeyV1 =
  typeof ScopeSyncDependencyKeyV1Schema.Type;

export const ScopeSyncDependencyKeySetV1Schema = Schema.Array(
  ScopeSyncDependencyKeyV1Schema,
).check(
  Schema.isMaxLength(MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1),
  Schema.makeFilter((keys) =>
    isCanonicalScopeSyncDependencyKeySetV1(keys)
      ? undefined
      : "Expected dependency keys in strict sorted unique order"
  ),
);
export type ScopeSyncDependencyKeySetV1 =
  typeof ScopeSyncDependencyKeySetV1Schema.Type;

const ScopeSyncProvisionalQueryGenerationV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  phase: Schema.Literal("provisional"),
  identity: ScopeSyncCanonicalQueryIdentityV1Schema,
  generation: ScopeSyncQueryGenerationSequenceV1Schema,
  registeredAtCursor: ScopeSyncCursorV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((state) =>
    state.identity.scopeUuid === state.registeredAtCursor.scopeUuid &&
      state.identity.epochUuid === state.registeredAtCursor.epochUuid
      ? undefined
      : "Expected provisional identity and registration cursor authority to match"
  ),
);

const ScopeSyncActiveQueryGenerationV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  phase: Schema.Literal("active"),
  identity: ScopeSyncCanonicalQueryIdentityV1Schema,
  generation: ScopeSyncQueryGenerationSequenceV1Schema,
  snapshotCommitSeq: CommitSeqSchema,
  refreshedThroughCursor: ScopeSyncCursorV1Schema,
  dependencies: ScopeSyncDependencyKeySetV1Schema,
  resultSha256Hex: ScopeSyncQueryResultSha256HexV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((state) =>
    state.identity.scopeUuid === state.refreshedThroughCursor.scopeUuid &&
      state.identity.epochUuid === state.refreshedThroughCursor.epochUuid &&
      state.snapshotCommitSeq <=
        state.refreshedThroughCursor.appliedThroughCommitSeq
      ? undefined
      : "Expected active identity, snapshot, and refreshed cursor authority to agree"
  ),
);

export const ScopeSyncQueryGenerationV1Schema = Schema.Union([
  ScopeSyncProvisionalQueryGenerationV1Schema,
  ScopeSyncActiveQueryGenerationV1Schema,
]);
export type ScopeSyncQueryGenerationV1 =
  typeof ScopeSyncQueryGenerationV1Schema.Type;
export type ScopeSyncProvisionalQueryGenerationV1 = Extract<
  ScopeSyncQueryGenerationV1,
  { readonly phase: "provisional" }
>;
export type ScopeSyncActiveQueryGenerationV1 = Extract<
  ScopeSyncQueryGenerationV1,
  { readonly phase: "active" }
>;

export class ScopeSyncDependencyKeySetV1Error extends Data.TaggedError(
  "ScopeSyncDependencyKeySetV1Error",
)<{
  readonly maximumKeys: number;
  readonly observedKeys: number;
}> {}

const decodeCursorResult = Schema.decodeUnknownResult(
  ScopeSyncCursorV1Schema,
  StrictParseOptions,
);
const decodeWakeResult = Schema.decodeUnknownResult(
  ScopeSyncWakeV1Schema,
  StrictParseOptions,
);
const decodeDependencyKeyResult = Schema.decodeUnknownResult(
  ScopeSyncDependencyKeyV1Schema,
  StrictParseOptions,
);
const decodeCanonicalQueryIdentityResult = Schema.decodeUnknownResult(
  ScopeSyncCanonicalQueryIdentityV1Schema,
  StrictParseOptions,
);
const decodeDependencyKeySetResult = Schema.decodeUnknownResult(
  ScopeSyncDependencyKeySetV1Schema,
  StrictParseOptions,
);
const decodeQueryGenerationResult = Schema.decodeUnknownResult(
  ScopeSyncQueryGenerationV1Schema,
  StrictParseOptions,
);

export function decodeScopeSyncCanonicalQueryIdentityV1Result(
  input: unknown,
): Result.Result<ScopeSyncCanonicalQueryIdentityV1, Schema.SchemaError> {
  return decodeCanonicalQueryIdentityResult(input).pipe(
    Result.map(captureScopeSyncCanonicalQueryIdentityV1),
  );
}

export function decodeScopeSyncCursorV1Result(
  input: unknown,
): Result.Result<ScopeSyncCursorV1, Schema.SchemaError> {
  return decodeCursorResult(input).pipe(Result.map(captureScopeSyncCursorV1));
}

export function decodeScopeSyncWakeV1Result(
  input: unknown,
): Result.Result<ScopeSyncWakeV1, Schema.SchemaError> {
  return decodeWakeResult(input).pipe(Result.map(captureScopeSyncWakeV1));
}

export function decodeScopeSyncDependencyKeyV1Result(
  input: unknown,
): Result.Result<ScopeSyncDependencyKeyV1, Schema.SchemaError> {
  return decodeDependencyKeyResult(input).pipe(
    Result.map(captureScopeSyncDependencyKeyV1),
  );
}

export function decodeScopeSyncDependencyKeySetV1Result(
  input: unknown,
): Result.Result<ScopeSyncDependencyKeySetV1, Schema.SchemaError> {
  return decodeDependencyKeySetResult(input).pipe(
    Result.map(captureScopeSyncDependencyKeySetV1),
  );
}

export function decodeScopeSyncQueryGenerationV1Result(
  input: unknown,
): Result.Result<ScopeSyncQueryGenerationV1, Schema.SchemaError> {
  return decodeQueryGenerationResult(input).pipe(
    Result.map(captureScopeSyncQueryGenerationV1),
  );
}

export function captureScopeSyncCanonicalQueryIdentityV1(
  input: ScopeSyncCanonicalQueryIdentityV1,
): ScopeSyncCanonicalQueryIdentityV1 {
  return Object.freeze({
    format: SCOPE_SYNC_CANONICAL_QUERY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: input.scopeUuid,
    epochUuid: input.epochUuid,
    activationSequence: input.activationSequence,
    activeHeadSha256Hex: input.activeHeadSha256Hex,
    sourcePackageSha256Hex: input.sourcePackageSha256Hex,
    schemaVersionId: input.schemaVersionId,
    policyVersion: input.policyVersion,
    componentPath: input.componentPath,
    functionPath: input.functionPath,
    argumentsSha256Hex: input.argumentsSha256Hex,
    identityAccessPolicySha256Hex: input.identityAccessPolicySha256Hex,
  });
}

export function captureScopeSyncCursorV1(
  input: ScopeSyncCursorV1,
): ScopeSyncCursorV1 {
  return Object.freeze({
    format: SCOPE_SYNC_CURSOR_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: input.scopeUuid,
    epochUuid: input.epochUuid,
    appliedThroughCommitSeq: input.appliedThroughCommitSeq,
  });
}

export function captureScopeSyncWakeV1(
  input: ScopeSyncWakeV1,
): ScopeSyncWakeV1 {
  return Object.freeze({
    format: SCOPE_SYNC_WAKE_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: input.scopeUuid,
    epochUuid: input.epochUuid,
    observedCommitSeq: input.observedCommitSeq,
  });
}

export function captureScopeSyncDependencyKeyV1(
  input: ScopeSyncDependencyKeyV1,
): ScopeSyncDependencyKeyV1 {
  switch (input.kind) {
    case "appRowPoint":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        documentId: input.documentId,
      });
    case "appTable":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        tableId: input.tableId,
      });
    case "appRelationIncoming":
      return Object.freeze({
        format: SCOPE_SYNC_DEPENDENCY_KEY_FORMAT_V1,
        version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
        kind: input.kind,
        edgeDefinitionId: input.edgeDefinitionId,
        targetRowId: input.targetRowId,
      });
  }
}

export function normalizeScopeSyncDependencyKeySetV1Result(
  input: ReadonlyArray<ScopeSyncDependencyKeyV1>,
): Result.Result<
  ScopeSyncDependencyKeySetV1,
  ScopeSyncDependencyKeySetV1Error
> {
  if (input.length > MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1) {
    return Result.fail(new ScopeSyncDependencyKeySetV1Error({
      maximumKeys: MAX_SCOPE_SYNC_DEPENDENCY_KEYS_V1,
      observedKeys: input.length,
    }));
  }
  const ordered = input.map(captureScopeSyncDependencyKeyV1)
    .toSorted(compareScopeSyncDependencyKeysV1);
  const unique: ScopeSyncDependencyKeyV1[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const key = ordered[index]!;
    if (
      index === 0 ||
      compareScopeSyncDependencyKeysV1(ordered[index - 1]!, key) !== 0
    ) {
      unique.push(key);
    }
  }
  return Result.succeed(Object.freeze(unique));
}

export function captureScopeSyncDependencyKeySetV1(
  input: ScopeSyncDependencyKeySetV1,
): ScopeSyncDependencyKeySetV1 {
  return Object.freeze(input.map(captureScopeSyncDependencyKeyV1));
}

export function captureScopeSyncQueryGenerationV1(
  input: ScopeSyncProvisionalQueryGenerationV1,
): ScopeSyncProvisionalQueryGenerationV1;
export function captureScopeSyncQueryGenerationV1(
  input: ScopeSyncActiveQueryGenerationV1,
): ScopeSyncActiveQueryGenerationV1;
export function captureScopeSyncQueryGenerationV1(
  input: ScopeSyncQueryGenerationV1,
): ScopeSyncQueryGenerationV1;
export function captureScopeSyncQueryGenerationV1(
  input: ScopeSyncQueryGenerationV1,
): ScopeSyncQueryGenerationV1 {
  if (input.phase === "provisional") {
    return Object.freeze({
      format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
      version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
      phase: input.phase,
      identity: captureScopeSyncCanonicalQueryIdentityV1(input.identity),
      generation: input.generation,
      registeredAtCursor: captureScopeSyncCursorV1(input.registeredAtCursor),
    });
  }
  return Object.freeze({
    format: SCOPE_SYNC_QUERY_GENERATION_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    phase: input.phase,
    identity: captureScopeSyncCanonicalQueryIdentityV1(input.identity),
    generation: input.generation,
    snapshotCommitSeq: input.snapshotCommitSeq,
    refreshedThroughCursor: captureScopeSyncCursorV1(
      input.refreshedThroughCursor,
    ),
    dependencies: captureScopeSyncDependencyKeySetV1(input.dependencies),
    resultSha256Hex: input.resultSha256Hex,
  });
}

export function compareScopeSyncDependencyKeysV1(
  left: ScopeSyncDependencyKeyV1,
  right: ScopeSyncDependencyKeyV1,
): number {
  const rank = dependencyKindRank;
  const kindDelta = rank(left) - rank(right);
  if (kindDelta !== 0) return kindDelta;
  if (left.kind === "appRowPoint" && right.kind === "appRowPoint") {
    return compareUtf16Strings(left.documentId, right.documentId);
  }
  if (left.kind === "appTable" && right.kind === "appTable") {
    return left.tableId - right.tableId;
  }
  if (
    left.kind === "appRelationIncoming" &&
    right.kind === "appRelationIncoming"
  ) {
    return left.edgeDefinitionId - right.edgeDefinitionId ||
      compareUtf16Strings(left.targetRowId, right.targetRowId);
  }
  return 0;
}

function isCanonicalScopeSyncDependencyKeySetV1(
  keys: ReadonlyArray<ScopeSyncDependencyKeyV1>,
): boolean {
  for (let index = 1; index < keys.length; index += 1) {
    if (compareScopeSyncDependencyKeysV1(keys[index - 1]!, keys[index]!) >= 0) {
      return false;
    }
  }
  return true;
}

function dependencyKindRank(key: ScopeSyncDependencyKeyV1): number {
  switch (key.kind) {
    case "appRowPoint":
      return 0;
    case "appTable":
      return 1;
    case "appRelationIncoming":
      return 2;
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
