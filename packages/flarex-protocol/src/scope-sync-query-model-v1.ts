import {
  bytesEqual,
  copyBytes,
  isUint8Array,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { Context, Data, Effect, Result, Schema } from "effect";

import {
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
} from "./commit-protocol";
import {
  exactOwnDataIssue,
  hasExactOwnDataKeys,
  inspectOwnDataRecord,
  type ExactOwnDataIssue,
} from "./exact-own-data";
import { encodeCanonicalJson, JsonValue } from "./json";
import {
  captureScopeSyncCanonicalQueryIdentityV1,
  captureScopeSyncDependencyKeyV1,
  decodeScopeSyncDependencyKeyV1Result,
  ScopeSyncCanonicalQueryIdentityV1Schema,
  ScopeSyncDependencyKeyV1Schema,
  SCOPE_SYNC_PROTOCOL_VERSION_V1,
  type ScopeSyncCanonicalQueryIdentityV1,
  type ScopeSyncDependencyKeyV1,
} from "./scope-sync-v1";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema,
  StorageGenerationFenceSchema,
} from "./storage-authority";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export const SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1 =
  "flarexdb.application-query.v1" as const;
export const SCOPE_SYNC_QUERY_KEY_FORMAT_V1 =
  "flarex.scope-sync-canonical-query-key" as const;
export const SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1 =
  "flarex.scope-sync-query-authority" as const;
export const SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1 = 32;
export const MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1 = 131_072;
export const MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1 = 16_384;
export const MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1 = 4_096;

export const ScopeSyncCanonicalQueryKeyFrameV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_QUERY_KEY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  identity: ScopeSyncCanonicalQueryIdentityV1Schema,
}).annotate(StrictStructOptions);
export type ScopeSyncCanonicalQueryKeyFrameV1 =
  typeof ScopeSyncCanonicalQueryKeyFrameV1Schema.Type;

export const ScopeSyncQueryAuthorityV1Schema = Schema.Struct({
  format: Schema.Literal(SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1),
  version: Schema.Literal(SCOPE_SYNC_PROTOCOL_VERSION_V1),
  scopeUuid: ScopeUuidV1Schema,
  syncModelId: Schema.Literal(SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1),
  epochUuid: ScopeEpochUuidV1Schema,
  storageGeneration: FlarexDbV1StorageGenerationSchema,
  storageGenerationFence: StorageGenerationFenceSchema,
  activationSequence: ApplicationActivationSequenceV1Schema,
  activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema,
}).annotate(StrictStructOptions);
export type ScopeSyncQueryAuthorityV1 =
  typeof ScopeSyncQueryAuthorityV1Schema.Type;

export type ScopeSyncQueryModelV1Operation =
  | "canonicalizeQueryKey"
  | "decodeQueryKey"
  | "canonicalizeDependencyKey"
  | "decodeDependencyKey"
  | "canonicalizeQueryAuthority"
  | "decodeQueryAuthority";

export type ScopeSyncQueryModelV1Component =
  | "queryKey"
  | "dependencyKey"
  | "queryAuthority";

export type ScopeSyncQueryModelV1Issue =
  | Readonly<{
      readonly reason: "invalidOwnData";
      readonly component: ScopeSyncQueryModelV1Component;
      readonly path: string;
      readonly cause?: unknown;
    }>
  | Readonly<{
      readonly reason: "invalidInput";
      readonly component: ScopeSyncQueryModelV1Component;
      readonly cause?: Schema.SchemaError;
    }>
  | Readonly<{
      readonly reason: "invalidCanonicalBytes";
      readonly component: ScopeSyncQueryModelV1Component;
      readonly observedBytes: number | null;
    }>
  | Readonly<{
      readonly reason: "invalidUtf8" | "invalidJson";
      readonly component: ScopeSyncQueryModelV1Component;
      readonly cause: unknown;
    }>
  | Readonly<{
      readonly reason: "canonicalBytesExceeded";
      readonly component: ScopeSyncQueryModelV1Component;
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }>
  | Readonly<{
      readonly reason: "invalidSha256Length";
      readonly component: "queryKey" | "queryAuthority";
      readonly observedBytes: number | null;
      readonly expectedBytes: number;
    }>
  | Readonly<{
      readonly reason: "nonCanonical" | "digestMismatch";
      readonly component: ScopeSyncQueryModelV1Component;
    }>;

export class ScopeSyncQueryModelV1Error extends Data.TaggedError(
  "ScopeSyncQueryModelV1Error",
)<{
  readonly operation: ScopeSyncQueryModelV1Operation;
  readonly issue: ScopeSyncQueryModelV1Issue;
}> {}

export class ScopeSyncQueryModelSha256Error extends Data.TaggedError(
  "ScopeSyncQueryModelSha256Error",
)<{
  readonly operation: "digest";
  readonly cause: unknown;
}> {}

export interface ScopeSyncQueryModelSha256Api {
  readonly digest: (
    canonicalBytes: Uint8Array,
  ) => Effect.Effect<Uint8Array, ScopeSyncQueryModelSha256Error>;
}

export class ScopeSyncQueryModelSha256 extends Context.Service<
  ScopeSyncQueryModelSha256,
  ScopeSyncQueryModelSha256Api
>()("flarex/protocol/scopeSyncQueryModel/ScopeSyncQueryModelSha256") {}

const queryKeyEvidenceNominal = Symbol(
  "flarex.protocol.scopeSyncQueryKeyEvidenceV1",
);
const dependencyKeyEvidenceNominal = Symbol(
  "flarex.protocol.scopeSyncDependencyKeyEvidenceV1",
);
const queryAuthorityEvidenceNominal = Symbol(
  "flarex.protocol.scopeSyncQueryAuthorityEvidenceV1",
);

export interface ScopeSyncQueryKeyEvidenceV1 {
  readonly [queryKeyEvidenceNominal]: true;
  readonly frame: ScopeSyncCanonicalQueryKeyFrameV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export interface ScopeSyncDependencyKeyEvidenceV1 {
  readonly [dependencyKeyEvidenceNominal]: true;
  readonly dependencyKey: ScopeSyncDependencyKeyV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export interface ScopeSyncQueryAuthorityEvidenceV1 {
  readonly [queryAuthorityEvidenceNominal]: true;
  readonly authority: ScopeSyncQueryAuthorityV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

const decodeQueryKeyFrameResult = Schema.decodeUnknownResult(
  ScopeSyncCanonicalQueryKeyFrameV1Schema,
  StrictParseOptions,
);
const decodeQueryIdentityTypeResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeSyncCanonicalQueryIdentityV1Schema),
  StrictParseOptions,
);
const encodeQueryKeyFrameResult = Schema.encodeUnknownResult(
  ScopeSyncCanonicalQueryKeyFrameV1Schema,
  StrictParseOptions,
);
const encodeDependencyKeyResult = Schema.encodeUnknownResult(
  ScopeSyncDependencyKeyV1Schema,
  StrictParseOptions,
);
const decodeDependencyKeyTypeResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeSyncDependencyKeyV1Schema),
  StrictParseOptions,
);
const decodeQueryAuthorityResult = Schema.decodeUnknownResult(
  ScopeSyncQueryAuthorityV1Schema,
  StrictParseOptions,
);
const decodeQueryAuthorityTypeResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeSyncQueryAuthorityV1Schema),
  StrictParseOptions,
);
const encodeQueryAuthorityResult = Schema.encodeUnknownResult(
  ScopeSyncQueryAuthorityV1Schema,
  StrictParseOptions,
);
const decodeJsonValueResult = Schema.decodeUnknownResult(JsonValue);

export const canonicalizeScopeSyncQueryKeyV1 = Effect.fn(
  "ScopeSyncQueryModel.canonicalizeQueryKeyV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ScopeSyncQueryKeyEvidenceV1,
  ScopeSyncQueryModelV1Error | ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelSha256
> {
  const identity = yield* Effect.fromResult(
    snapshotExactQueryIdentityResult(input, "queryIdentity").pipe(
      Result.flatMap(decodeQueryIdentityTypeResult),
      Result.map(captureScopeSyncCanonicalQueryIdentityV1),
      Result.mapError((cause) =>
        cause instanceof ScopeSyncQueryModelV1Error
          ? cause
          : codecError("canonicalizeQueryKey", {
            reason: "invalidInput",
            component: "queryKey",
            cause,
          })
      ),
    ),
  );
  const frame = captureQueryKeyFrame(identity);
  const canonicalText = yield* Effect.fromResult(
    encodeCanonicalTextResult(
      encodeQueryKeyFrameResult(frame),
      "canonicalizeQueryKey",
      "queryKey",
    ),
  );
  const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
  yield* enforceCanonicalByteLimitEffect(
    "canonicalizeQueryKey",
    "queryKey",
    canonicalBytes.byteLength,
    MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1,
  );
  const sha256 = yield* digestCanonicalBytesEffect(
    "canonicalizeQueryKey",
    "queryKey",
    canonicalBytes,
  );
  return queryKeyEvidence(frame, canonicalText, canonicalBytes, sha256);
});

export const decodeScopeSyncQueryKeyEvidenceV1 = Effect.fn(
  "ScopeSyncQueryModel.decodeQueryKeyEvidenceV1",
)(function* (
  canonicalBytes: unknown,
  expectedSha256: unknown,
): Effect.fn.Return<
  ScopeSyncQueryKeyEvidenceV1,
  ScopeSyncQueryModelV1Error | ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelSha256
> {
  const stableBytes = yield* Effect.fromResult(validateCanonicalBytesResult(
    canonicalBytes,
    "decodeQueryKey",
    "queryKey",
    MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1,
  ));
  const stableExpectedSha256 = yield* Effect.fromResult(validateSha256Result(
    expectedSha256,
    "decodeQueryKey",
    "queryKey",
  ));
  const parsed = yield* Effect.fromResult(
    decodeUtf8JsonResult(stableBytes, "decodeQueryKey", "queryKey"),
  );
  const frame = yield* Effect.fromResult(decodeQueryKeyFrameResult(parsed).pipe(
    Result.map(captureDecodedQueryKeyFrame),
    Result.mapError((cause) => codecError(
      "decodeQueryKey",
      { reason: "invalidInput", component: "queryKey", cause },
    )),
  ));
  const canonicalText = yield* Effect.fromResult(
    encodeCanonicalTextResult(
      encodeQueryKeyFrameResult(frame),
      "decodeQueryKey",
      "queryKey",
    ),
  );
  const reencodedBytes = UTF8_ENCODER.encode(canonicalText);
  yield* enforceCanonicalByteLimitEffect(
    "decodeQueryKey",
    "queryKey",
    reencodedBytes.byteLength,
    MAX_SCOPE_SYNC_QUERY_KEY_CANONICAL_BYTES_V1,
  );
  if (!bytesEqual(stableBytes, reencodedBytes)) {
    return yield* Effect.fail(codecError(
      "decodeQueryKey",
      { reason: "nonCanonical", component: "queryKey" },
    ));
  }
  const sha256 = yield* digestCanonicalBytesEffect(
    "decodeQueryKey",
    "queryKey",
    reencodedBytes,
  );
  if (!bytesEqual(stableExpectedSha256, sha256)) {
    return yield* Effect.fail(codecError(
      "decodeQueryKey",
      { reason: "digestMismatch", component: "queryKey" },
    ));
  }
  return queryKeyEvidence(frame, canonicalText, reencodedBytes, sha256);
});

export function canonicalizeScopeSyncDependencyKeyV1Result(
  input: unknown,
): Result.Result<
  ScopeSyncDependencyKeyEvidenceV1,
  ScopeSyncQueryModelV1Error
> {
  return Result.gen(function* () {
    const dependencyKey = yield* snapshotExactDependencyKeyResult(
      input,
      "dependencyKey",
    ).pipe(
      Result.flatMap(decodeDependencyKeyTypeResult),
      Result.map(captureScopeSyncDependencyKeyV1),
      Result.mapError((cause) =>
        cause instanceof ScopeSyncQueryModelV1Error
          ? cause
          : codecError("canonicalizeDependencyKey", {
            reason: "invalidInput",
            component: "dependencyKey",
            cause,
          })
      ),
    );
    const canonicalText = yield* encodeCanonicalTextResult(
      encodeDependencyKeyResult(dependencyKey),
      "canonicalizeDependencyKey",
      "dependencyKey",
    );
    const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
    yield* enforceCanonicalByteLimitResult(
      "canonicalizeDependencyKey",
      "dependencyKey",
      canonicalBytes.byteLength,
      MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1,
    );
    return dependencyKeyEvidence(
      dependencyKey,
      canonicalText,
      canonicalBytes,
    );
  });
}

export function decodeScopeSyncDependencyKeyEvidenceV1Result(
  canonicalBytes: unknown,
): Result.Result<
  ScopeSyncDependencyKeyEvidenceV1,
  ScopeSyncQueryModelV1Error
> {
  return Result.gen(function* () {
    const stableBytes = yield* validateCanonicalBytesResult(
      canonicalBytes,
      "decodeDependencyKey",
      "dependencyKey",
      MAX_SCOPE_SYNC_DEPENDENCY_KEY_CANONICAL_BYTES_V1,
    );
    const parsed = yield* decodeUtf8JsonResult(
      stableBytes,
      "decodeDependencyKey",
      "dependencyKey",
    );
    const dependencyKey = yield* decodeScopeSyncDependencyKeyV1Result(parsed)
      .pipe(Result.mapError((cause) => codecError(
        "decodeDependencyKey",
        { reason: "invalidInput", component: "dependencyKey", cause },
      )));
    const canonical = yield* canonicalizeScopeSyncDependencyKeyV1Result(
      dependencyKey,
    );
    if (!bytesEqual(stableBytes, canonical.canonicalBytes)) {
      return yield* Result.fail(codecError(
        "decodeDependencyKey",
        { reason: "nonCanonical", component: "dependencyKey" },
      ));
    }
    return canonical;
  });
}

export const canonicalizeScopeSyncQueryAuthorityV1 = Effect.fn(
  "ScopeSyncQueryModel.canonicalizeQueryAuthorityV1",
)(function* (
  input: unknown,
): Effect.fn.Return<
  ScopeSyncQueryAuthorityEvidenceV1,
  ScopeSyncQueryModelV1Error | ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelSha256
> {
  const authority = yield* Effect.fromResult(
    snapshotExactQueryAuthorityResult(input, "queryAuthority").pipe(
      Result.flatMap(decodeQueryAuthorityTypeResult),
      Result.map(captureQueryAuthority),
      Result.mapError((cause) =>
        cause instanceof ScopeSyncQueryModelV1Error
          ? cause
          : codecError("canonicalizeQueryAuthority", {
            reason: "invalidInput",
            component: "queryAuthority",
            cause,
          })
      ),
    ),
  );
  const canonicalText = yield* Effect.fromResult(
    encodeCanonicalTextResult(
      encodeQueryAuthorityResult(authority),
      "canonicalizeQueryAuthority",
      "queryAuthority",
    ),
  );
  const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
  yield* enforceCanonicalByteLimitEffect(
    "canonicalizeQueryAuthority",
    "queryAuthority",
    canonicalBytes.byteLength,
    MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1,
  );
  const sha256 = yield* digestCanonicalBytesEffect(
    "canonicalizeQueryAuthority",
    "queryAuthority",
    canonicalBytes,
  );
  return queryAuthorityEvidence(
    authority,
    canonicalText,
    canonicalBytes,
    sha256,
  );
});

export const decodeScopeSyncQueryAuthorityEvidenceV1 = Effect.fn(
  "ScopeSyncQueryModel.decodeQueryAuthorityEvidenceV1",
)(function* (
  canonicalBytes: unknown,
  expectedSha256: unknown,
): Effect.fn.Return<
  ScopeSyncQueryAuthorityEvidenceV1,
  ScopeSyncQueryModelV1Error | ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelSha256
> {
  const stableBytes = yield* Effect.fromResult(validateCanonicalBytesResult(
    canonicalBytes,
    "decodeQueryAuthority",
    "queryAuthority",
    MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1,
  ));
  const stableExpectedSha256 = yield* Effect.fromResult(validateSha256Result(
    expectedSha256,
    "decodeQueryAuthority",
    "queryAuthority",
  ));
  const parsed = yield* Effect.fromResult(decodeUtf8JsonResult(
    stableBytes,
    "decodeQueryAuthority",
    "queryAuthority",
  ));
  const authority = yield* Effect.fromResult(
    decodeQueryAuthorityResult(parsed).pipe(
      Result.map(captureQueryAuthority),
      Result.mapError((cause) => codecError(
        "decodeQueryAuthority",
        { reason: "invalidInput", component: "queryAuthority", cause },
      )),
    ),
  );
  const canonicalText = yield* Effect.fromResult(
    encodeCanonicalTextResult(
      encodeQueryAuthorityResult(authority),
      "decodeQueryAuthority",
      "queryAuthority",
    ),
  );
  const reencodedBytes = UTF8_ENCODER.encode(canonicalText);
  yield* enforceCanonicalByteLimitEffect(
    "decodeQueryAuthority",
    "queryAuthority",
    reencodedBytes.byteLength,
    MAX_SCOPE_SYNC_QUERY_AUTHORITY_CANONICAL_BYTES_V1,
  );
  if (!bytesEqual(stableBytes, reencodedBytes)) {
    return yield* Effect.fail(codecError(
      "decodeQueryAuthority",
      { reason: "nonCanonical", component: "queryAuthority" },
    ));
  }
  const sha256 = yield* digestCanonicalBytesEffect(
    "decodeQueryAuthority",
    "queryAuthority",
    reencodedBytes,
  );
  if (!bytesEqual(stableExpectedSha256, sha256)) {
    return yield* Effect.fail(codecError(
      "decodeQueryAuthority",
      { reason: "digestMismatch", component: "queryAuthority" },
    ));
  }
  return queryAuthorityEvidence(
    authority,
    canonicalText,
    reencodedBytes,
    sha256,
  );
});

export type ScopeSyncQueryKeyEvidenceComparisonV1 =
  | Readonly<{ readonly kind: "equal" }>
  | Readonly<{ readonly kind: "distinct" }>;

export type ScopeSyncQueryKeyComparisonV1Issue =
  | Readonly<{
      readonly reason: "sha256Collision";
      readonly leftCanonicalText: string;
      readonly rightCanonicalText: string;
    }>
  | Readonly<{
      readonly reason: "inconsistentDigest";
      readonly canonicalText: string;
    }>;

export class ScopeSyncQueryKeyComparisonV1Error extends Data.TaggedError(
  "ScopeSyncQueryKeyComparisonV1Error",
)<{
  readonly operation: "compareEvidence";
  readonly issue: ScopeSyncQueryKeyComparisonV1Issue;
}> {}

const EQUAL_QUERY_KEY_EVIDENCE_V1 = Object.freeze({
  kind: "equal",
} as const satisfies ScopeSyncQueryKeyEvidenceComparisonV1);
const DISTINCT_QUERY_KEY_EVIDENCE_V1 = Object.freeze({
  kind: "distinct",
} as const satisfies ScopeSyncQueryKeyEvidenceComparisonV1);

export function compareScopeSyncQueryKeyEvidenceV1(
  left: ScopeSyncQueryKeyEvidenceV1,
  right: ScopeSyncQueryKeyEvidenceV1,
): Result.Result<
  ScopeSyncQueryKeyEvidenceComparisonV1,
  ScopeSyncQueryKeyComparisonV1Error
> {
  const bytesMatch = bytesEqual(left.canonicalBytes, right.canonicalBytes);
  const digestsMatch = bytesEqual(left.sha256, right.sha256);
  if (digestsMatch) {
    return bytesMatch
      ? Result.succeed(EQUAL_QUERY_KEY_EVIDENCE_V1)
      : Result.fail(new ScopeSyncQueryKeyComparisonV1Error({
        operation: "compareEvidence",
        issue: {
          reason: "sha256Collision",
          leftCanonicalText: left.canonicalText,
          rightCanonicalText: right.canonicalText,
        },
      }));
  }
  return bytesMatch
    ? Result.fail(new ScopeSyncQueryKeyComparisonV1Error({
      operation: "compareEvidence",
      issue: {
        reason: "inconsistentDigest",
        canonicalText: left.canonicalText,
      },
    }))
    : Result.succeed(DISTINCT_QUERY_KEY_EVIDENCE_V1);
}

function snapshotExactQueryIdentityResult(
  input: unknown,
  path: string,
): Result.Result<unknown, ScopeSyncQueryModelV1Error> {
  return Result.gen(function* () {
    const inspected = yield* inspectOwnDataRecord(input, path).pipe(
      Result.mapError((issue) => ownDataCodecError(
        "canonicalizeQueryKey",
        "queryKey",
        issue,
      )),
    );
    if (!hasExactOwnDataKeys(inspected.properties, [
      "format",
      "version",
      "scopeUuid",
      "epochUuid",
      "activationSequence",
      "activeHeadSha256Hex",
      "sourcePackageSha256Hex",
      "schemaVersionId",
      "policyVersion",
      "componentPath",
      "functionPath",
      "argumentsSha256Hex",
      "identityAccessPolicySha256Hex",
    ])) {
      return yield* Result.fail(ownDataCodecError(
        "canonicalizeQueryKey",
        "queryKey",
        exactOwnDataIssue(path),
      ));
    }
    return {
      format: inspected.properties.get("format"),
      version: inspected.properties.get("version"),
      scopeUuid: inspected.properties.get("scopeUuid"),
      epochUuid: inspected.properties.get("epochUuid"),
      activationSequence: inspected.properties.get("activationSequence"),
      activeHeadSha256Hex: inspected.properties.get("activeHeadSha256Hex"),
      sourcePackageSha256Hex:
        inspected.properties.get("sourcePackageSha256Hex"),
      schemaVersionId: inspected.properties.get("schemaVersionId"),
      policyVersion: inspected.properties.get("policyVersion"),
      componentPath: inspected.properties.get("componentPath"),
      functionPath: inspected.properties.get("functionPath"),
      argumentsSha256Hex: inspected.properties.get("argumentsSha256Hex"),
      identityAccessPolicySha256Hex:
        inspected.properties.get("identityAccessPolicySha256Hex"),
    };
  });
}

function snapshotExactDependencyKeyResult(
  input: unknown,
  path: string,
): Result.Result<unknown, ScopeSyncQueryModelV1Error> {
  return Result.gen(function* () {
    const inspected = yield* inspectOwnDataRecord(input, path).pipe(
      Result.mapError((issue) => ownDataCodecError(
        "canonicalizeDependencyKey",
        "dependencyKey",
        issue,
      )),
    );
    const kind = inspected.properties.get("kind");
    switch (kind) {
      case "appRowPoint":
        if (!hasExactOwnDataKeys(inspected.properties, [
          "format",
          "version",
          "kind",
          "documentId",
        ])) {
          return yield* Result.fail(ownDataCodecError(
            "canonicalizeDependencyKey",
            "dependencyKey",
            exactOwnDataIssue(path),
          ));
        }
        return {
          format: inspected.properties.get("format"),
          version: inspected.properties.get("version"),
          kind,
          documentId: inspected.properties.get("documentId"),
        };
      case "appTable":
        if (!hasExactOwnDataKeys(inspected.properties, [
          "format",
          "version",
          "kind",
          "tableId",
        ])) {
          return yield* Result.fail(ownDataCodecError(
            "canonicalizeDependencyKey",
            "dependencyKey",
            exactOwnDataIssue(path),
          ));
        }
        return {
          format: inspected.properties.get("format"),
          version: inspected.properties.get("version"),
          kind,
          tableId: inspected.properties.get("tableId"),
        };
      case "appRelationIncoming":
        if (!hasExactOwnDataKeys(inspected.properties, [
          "format",
          "version",
          "kind",
          "edgeDefinitionId",
          "targetRowId",
        ])) {
          return yield* Result.fail(ownDataCodecError(
            "canonicalizeDependencyKey",
            "dependencyKey",
            exactOwnDataIssue(path),
          ));
        }
        return {
          format: inspected.properties.get("format"),
          version: inspected.properties.get("version"),
          kind,
          edgeDefinitionId: inspected.properties.get("edgeDefinitionId"),
          targetRowId: inspected.properties.get("targetRowId"),
        };
      default:
        return yield* Result.fail(ownDataCodecError(
          "canonicalizeDependencyKey",
          "dependencyKey",
          exactOwnDataIssue(`${path}.kind`),
        ));
    }
  });
}

function snapshotExactQueryAuthorityResult(
  input: unknown,
  path: string,
): Result.Result<unknown, ScopeSyncQueryModelV1Error> {
  return Result.gen(function* () {
    const inspected = yield* inspectOwnDataRecord(input, path).pipe(
      Result.mapError((issue) => ownDataCodecError(
        "canonicalizeQueryAuthority",
        "queryAuthority",
        issue,
      )),
    );
    if (!hasExactOwnDataKeys(inspected.properties, [
      "format",
      "version",
      "scopeUuid",
      "syncModelId",
      "epochUuid",
      "storageGeneration",
      "storageGenerationFence",
      "activationSequence",
      "activeHeadSha256Hex",
    ])) {
      return yield* Result.fail(ownDataCodecError(
        "canonicalizeQueryAuthority",
        "queryAuthority",
        exactOwnDataIssue(path),
      ));
    }
    return {
      format: inspected.properties.get("format"),
      version: inspected.properties.get("version"),
      scopeUuid: inspected.properties.get("scopeUuid"),
      syncModelId: inspected.properties.get("syncModelId"),
      epochUuid: inspected.properties.get("epochUuid"),
      storageGeneration: inspected.properties.get("storageGeneration"),
      storageGenerationFence:
        inspected.properties.get("storageGenerationFence"),
      activationSequence: inspected.properties.get("activationSequence"),
      activeHeadSha256Hex: inspected.properties.get("activeHeadSha256Hex"),
    };
  });
}

function ownDataCodecError(
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
  issue: ExactOwnDataIssue,
): ScopeSyncQueryModelV1Error {
  return codecError(operation, {
    reason: "invalidOwnData",
    component,
    path: issue.path,
    ...(issue.reason === "invalidOwnData" && issue.cause !== undefined
      ? { cause: issue.cause }
      : {}),
  });
}

function captureQueryKeyFrame(
  identity: ScopeSyncCanonicalQueryIdentityV1,
): ScopeSyncCanonicalQueryKeyFrameV1 {
  return Object.freeze({
    format: SCOPE_SYNC_QUERY_KEY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    identity: captureScopeSyncCanonicalQueryIdentityV1(identity),
  });
}

function captureDecodedQueryKeyFrame(
  frame: ScopeSyncCanonicalQueryKeyFrameV1,
): ScopeSyncCanonicalQueryKeyFrameV1 {
  return captureQueryKeyFrame(frame.identity);
}

function captureQueryAuthority(
  authority: ScopeSyncQueryAuthorityV1,
): ScopeSyncQueryAuthorityV1 {
  return Object.freeze({
    format: SCOPE_SYNC_QUERY_AUTHORITY_FORMAT_V1,
    version: SCOPE_SYNC_PROTOCOL_VERSION_V1,
    scopeUuid: authority.scopeUuid,
    syncModelId: SCOPE_SYNC_APPLICATION_QUERY_MODEL_ID_V1,
    epochUuid: authority.epochUuid,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    activationSequence: authority.activationSequence,
    activeHeadSha256Hex: authority.activeHeadSha256Hex,
  });
}

function queryKeyEvidence(
  frame: ScopeSyncCanonicalQueryKeyFrameV1,
  canonicalText: string,
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
): ScopeSyncQueryKeyEvidenceV1 {
  const stableBytes = copyBytes(canonicalBytes);
  const stableSha256 = copyBytes(sha256);
  return Object.freeze({
    [queryKeyEvidenceNominal]: true as const,
    frame,
    canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
  });
}

function dependencyKeyEvidence(
  dependencyKey: ScopeSyncDependencyKeyV1,
  canonicalText: string,
  canonicalBytes: Uint8Array,
): ScopeSyncDependencyKeyEvidenceV1 {
  const stableBytes = copyBytes(canonicalBytes);
  return Object.freeze({
    [dependencyKeyEvidenceNominal]: true as const,
    dependencyKey: captureScopeSyncDependencyKeyV1(dependencyKey),
    canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
  });
}

function queryAuthorityEvidence(
  authority: ScopeSyncQueryAuthorityV1,
  canonicalText: string,
  canonicalBytes: Uint8Array,
  sha256: Uint8Array,
): ScopeSyncQueryAuthorityEvidenceV1 {
  const stableBytes = copyBytes(canonicalBytes);
  const stableSha256 = copyBytes(sha256);
  return Object.freeze({
    [queryAuthorityEvidenceNominal]: true as const,
    authority,
    canonicalText,
    get canonicalBytes(): Uint8Array {
      return copyBytes(stableBytes);
    },
    get sha256(): Uint8Array {
      return copyBytes(stableSha256);
    },
  });
}

function encodeCanonicalTextResult(
  encodedResult: Result.Result<unknown, Schema.SchemaError>,
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
): Result.Result<string, ScopeSyncQueryModelV1Error> {
  return encodedResult.pipe(
    Result.mapError((cause) => codecError(
      operation,
      { reason: "invalidInput", component, cause },
    )),
    Result.flatMap((encoded) => decodeJsonValueResult(encoded).pipe(
      Result.mapError((cause) => codecError(
        operation,
        { reason: "invalidInput", component, cause },
      )),
    )),
    Result.map((json) => encodeCanonicalJson(json, (issue) => {
      throw new Error(
        `Typed scope-sync ${component} lost its JSON representation: ${issue.reason}`,
      );
    })),
  );
}

function decodeUtf8JsonResult(
  bytes: Uint8Array,
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
): Result.Result<unknown, ScopeSyncQueryModelV1Error> {
  let text: string;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch (cause) {
    return Result.fail(codecError(
      operation,
      { reason: "invalidUtf8", component, cause },
    ));
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return Result.succeed(parsed);
  } catch (cause) {
    return Result.fail(codecError(
      operation,
      { reason: "invalidJson", component, cause },
    ));
  }
}

function validateCanonicalBytesResult(
  input: unknown,
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
  maximumBytes: number,
): Result.Result<Uint8Array, ScopeSyncQueryModelV1Error> {
  const observedBytes = uint8ArrayByteLength(input);
  if (observedBytes === undefined || observedBytes === 0) {
    return Result.fail(codecError(
      operation,
      {
        reason: "invalidCanonicalBytes",
        component,
        observedBytes: observedBytes ?? null,
      },
    ));
  }
  if (observedBytes > maximumBytes) {
    return Result.fail(codecError(
      operation,
      {
        reason: "canonicalBytesExceeded",
        component,
        observedBytes,
        maximumBytes,
      },
    ));
  }
  if (!isUint8Array(input)) {
    return Result.fail(codecError(
      operation,
      { reason: "invalidCanonicalBytes", component, observedBytes },
    ));
  }
  return Result.succeed(copyBytes(input));
}

function validateSha256Result(
  input: unknown,
  operation: "decodeQueryKey" | "decodeQueryAuthority",
  component: "queryKey" | "queryAuthority",
): Result.Result<Uint8Array, ScopeSyncQueryModelV1Error> {
  if (!isUint8ArrayWithByteLength(
    input,
    SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
  )) {
    return Result.fail(codecError(operation, {
      reason: "invalidSha256Length",
      component,
      observedBytes: uint8ArrayByteLength(input) ?? null,
      expectedBytes: SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
    }));
  }
  return Result.succeed(copyBytes(input));
}

function enforceCanonicalByteLimitResult(
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
  observedBytes: number,
  maximumBytes: number,
): Result.Result<void, ScopeSyncQueryModelV1Error> {
  return observedBytes <= maximumBytes
    ? Result.succeed(undefined)
    : Result.fail(codecError(operation, {
      reason: "canonicalBytesExceeded",
      component,
      observedBytes,
      maximumBytes,
    }));
}

const enforceCanonicalByteLimitEffect = Effect.fn(function* (
  operation: ScopeSyncQueryModelV1Operation,
  component: ScopeSyncQueryModelV1Component,
  observedBytes: number,
  maximumBytes: number,
): Effect.fn.Return<void, ScopeSyncQueryModelV1Error> {
  return yield* Effect.fromResult(enforceCanonicalByteLimitResult(
    operation,
    component,
    observedBytes,
    maximumBytes,
  ));
});

const digestCanonicalBytesEffect = Effect.fn(function* (
  operation:
    | "canonicalizeQueryKey"
    | "decodeQueryKey"
    | "canonicalizeQueryAuthority"
    | "decodeQueryAuthority",
  component: "queryKey" | "queryAuthority",
  canonicalBytes: Uint8Array,
): Effect.fn.Return<
  Uint8Array,
  ScopeSyncQueryModelV1Error | ScopeSyncQueryModelSha256Error,
  ScopeSyncQueryModelSha256
> {
  const stableBytes = copyBytes(canonicalBytes);
  const sha256Service = yield* ScopeSyncQueryModelSha256;
  const digest = yield* sha256Service.digest(copyBytes(stableBytes));
  if (!isUint8ArrayWithByteLength(
    digest,
    SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
  )) {
    return yield* Effect.fail(codecError(operation, {
      reason: "invalidSha256Length",
      component,
      observedBytes: uint8ArrayByteLength(digest) ?? null,
      expectedBytes: SCOPE_SYNC_QUERY_MODEL_SHA256_BYTES_V1,
    }));
  }
  return copyBytes(digest);
});

function codecError(
  operation: ScopeSyncQueryModelV1Operation,
  issue: ScopeSyncQueryModelV1Issue,
): ScopeSyncQueryModelV1Error {
  return new ScopeSyncQueryModelV1Error({ operation, issue });
}
