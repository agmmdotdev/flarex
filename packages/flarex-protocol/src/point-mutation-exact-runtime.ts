import { copyBytes } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";

import { AppCreationTimeV1Schema } from "./app-document";
import {
  decodeUserIdentityEffect,
  UserIdentitySchema,
  type UserIdentity,
} from "./auth";
import { CatalogTableIdSchema, type CatalogTableId } from "./catalog";
import {
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";
import {
  MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
  requirePointMutationArgumentSemanticSizeV1,
} from "./point-mutation-start";
import type { Json } from "./json";
import {
  SchemaManifestAppTableNameSchema,
  type SchemaManifestAppTableName,
} from "./schema-manifest";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type TransactionArtifactIdV1,
  type TransactionExecutionModuleV1,
  type TransactionFunctionPathV1,
  type TransactionSourcePackageSha256HexV1,
} from "./transaction-session";

export const POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1 =
  "flarex.point-mutation-exact-runtime";
export const POINT_MUTATION_EXACT_RUNTIME_VERSION_V1 = 1;
export const POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1 =
  "flarex.point-mutation-exact-runtime-result";
export const POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1 = 1;
export const POINT_MUTATION_EXACT_RUNTIME_PROFILE_V1 =
  "point-mutation-exact-runtime-v1";
export const POINT_MUTATION_EXACT_RUNTIME_ENTRYPOINT_V1 =
  "FlarexPointMutationExactRuntimeV1";
export const MAX_POINT_MUTATION_EXACT_RUNTIME_CONTEXT_TEXT_BYTES_V1 = 512;
export const POINT_MUTATION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1 = 32;
export const MAX_POINT_MUTATION_EXACT_RUNTIME_AUTH_SEMANTIC_BYTES_V1 =
  64 * 1_024;

const textEncoder = new TextEncoder();

const BoundedContextTextV1Schema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) =>
    value.trim().length === 0
      ? "Expected a nonblank exact-runtime context string"
      : undefined
  ),
  Schema.makeFilter((value) =>
    textEncoder.encode(value).byteLength <=
        MAX_POINT_MUTATION_EXACT_RUNTIME_CONTEXT_TEXT_BYTES_V1
      ? undefined
      : `Expected at most ${MAX_POINT_MUTATION_EXACT_RUNTIME_CONTEXT_TEXT_BYTES_V1} UTF-8 bytes`
  ),
);

const ExactRuntimeAuthV1Schema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("anonymous"),
  }).annotate(StrictStructOptions),
  Schema.Struct({
    kind: Schema.Literal("user"),
    user: UserIdentitySchema,
  }).annotate(StrictStructOptions),
]);

const ExactRuntimeArtifactRefV1Schema = Schema.Struct({
  runtime: TransactionArtifactRuntimeV1Schema,
  artifactId: TransactionArtifactIdV1Schema,
  sourcePackageHash: TransactionSourcePackageSha256HexV1Schema,
  executionModule: TransactionExecutionModuleV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((ref) =>
    ref.artifactId === `artifact_${ref.sourcePackageHash.slice(0, 32)}`
      ? undefined
      : "Expected artifact ID to match the source-package hash"
  ),
);

const ExactRuntimeFunctionV1Schema = Schema.Struct({
  path: TransactionFunctionPathV1Schema,
  executionModule: TransactionExecutionModuleV1Schema,
  kind: Schema.Literal("mutation"),
  visibility: Schema.Literal("public"),
}).annotate(StrictStructOptions);

const ExactRuntimeContextV1Schema = Schema.Struct({
  executionId: BoundedContextTextV1Schema,
  logScopeId: BoundedContextTextV1Schema,
  randomSeed: Schema.Uint8Array.check(
    Schema.isMinLength(POINT_MUTATION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1),
    Schema.isMaxLength(POINT_MUTATION_EXACT_RUNTIME_RANDOM_SEED_BYTES_V1),
  ),
  executionTime: AppCreationTimeV1Schema,
  initialCreationTimeCursor: AppCreationTimeV1Schema,
}).annotate(StrictStructOptions);

const ExactRuntimeTableV1Schema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  logicalName: SchemaManifestAppTableNameSchema,
}).annotate(StrictStructOptions);

const ExactRuntimeTablesV1Schema = Schema.Array(
  ExactRuntimeTableV1Schema,
).check(
  Schema.isMaxLength(1_024),
  Schema.makeFilter((tables) => {
    const ids = new Set<CatalogTableId>();
    const names = new Set<SchemaManifestAppTableName>();
    for (const table of tables) {
      if (ids.has(table.tableId) || names.has(table.logicalName)) {
        return "Expected unique exact-runtime table IDs and logical names";
      }
      ids.add(table.tableId);
      names.add(table.logicalName);
    }
    return undefined;
  }),
);

const ExactRuntimeRequestShapeV1Schema = Schema.Struct({
  format: Schema.Literal(POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1),
  version: Schema.Literal(POINT_MUTATION_EXACT_RUNTIME_VERSION_V1),
  artifact: ExactRuntimeArtifactRefV1Schema,
  function: ExactRuntimeFunctionV1Schema,
  auth: ExactRuntimeAuthV1Schema,
  arguments: Schema.Unknown,
  argumentArraySemanticBytes: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({
      minimum: 2,
      maximum: MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
    }),
  ),
  tables: ExactRuntimeTablesV1Schema,
  context: ExactRuntimeContextV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((request) =>
    request.artifact.executionModule === request.function.executionModule
      ? undefined
      : "Expected the exact-runtime function module to match the artifact module"
  ),
);

const ExactRuntimeResultShapeV1Schema = Schema.Struct({
  format: Schema.Literal(POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1),
  version: Schema.Literal(POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1),
  value: Schema.Unknown,
}).annotate(StrictStructOptions);

const decodeExactRuntimeRequestShapeV1Result = Schema.decodeUnknownResult(
  ExactRuntimeRequestShapeV1Schema,
  StrictParseOptions,
);
const decodeExactRuntimeResultShapeV1Result = Schema.decodeUnknownResult(
  ExactRuntimeResultShapeV1Schema,
  StrictParseOptions,
);

export type PointMutationExactRuntimeAuthV1 =
  | Readonly<{ readonly kind: "anonymous" }>
  | Readonly<{
      readonly kind: "user";
      readonly user: UserIdentity;
    }>;

export interface PointMutationExactRuntimeArtifactRefV1 {
  readonly runtime: "dynamic-worker";
  readonly artifactId: TransactionArtifactIdV1;
  readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
  readonly executionModule: TransactionExecutionModuleV1;
}

export interface PointMutationExactRuntimeFunctionV1 {
  readonly path: TransactionFunctionPathV1;
  readonly executionModule: TransactionExecutionModuleV1;
  readonly kind: "mutation";
  readonly visibility: "public";
}

export interface PointMutationExactRuntimeTableV1 {
  readonly tableId: CatalogTableId;
  readonly logicalName: SchemaManifestAppTableName;
}

export interface PointMutationExactRuntimeContextV1 {
  readonly executionId: string;
  readonly logScopeId: string;
  readonly randomSeed: Uint8Array;
  readonly executionTime: typeof AppCreationTimeV1Schema.Type;
  readonly initialCreationTimeCursor: typeof AppCreationTimeV1Schema.Type;
}

export interface PointMutationExactRuntimeRequestV1 {
  readonly format: typeof POINT_MUTATION_EXACT_RUNTIME_FORMAT_V1;
  readonly version: typeof POINT_MUTATION_EXACT_RUNTIME_VERSION_V1;
  readonly artifact: PointMutationExactRuntimeArtifactRefV1;
  readonly function: PointMutationExactRuntimeFunctionV1;
  readonly auth: PointMutationExactRuntimeAuthV1;
  readonly arguments: CanonicalFlarexRuntimeObjectV1;
  readonly argumentArraySemanticBytes: number;
  readonly tables: ReadonlyArray<PointMutationExactRuntimeTableV1>;
  readonly context: PointMutationExactRuntimeContextV1;
}

export interface PointMutationExactRuntimeResultV1 {
  readonly format: typeof POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1;
  readonly version: typeof POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1;
  readonly value: CanonicalFlarexRuntimeValueV1;
}

export class PointMutationExactRuntimeProtocolV1Error extends Data.TaggedError(
  "PointMutationExactRuntimeProtocolV1Error",
)<{
  readonly boundary: "request" | "result";
  readonly reason:
    | "invalidShape"
    | "invalidAuth"
    | "invalidArguments"
    | "argumentSizeMismatch"
    | "invalidResult";
  readonly cause?: unknown;
}> {}

export const decodePointMutationExactRuntimeRequestV1Effect = Effect.fn(
  "PointMutationExactRuntimeProtocol.decodeRequest",
)(function* (
  value: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeRequestV1,
  PointMutationExactRuntimeProtocolV1Error
> {
  const request = yield* Effect.fromResult(
    decodeExactRuntimeRequestShapeV1Result(value).pipe(
      Result.mapError((cause) =>
        new PointMutationExactRuntimeProtocolV1Error({
          boundary: "request",
          reason: "invalidShape",
          cause,
        })
      ),
    ),
  );
  const auth = request.auth.kind === "anonymous"
    ? Object.freeze({ kind: "anonymous" as const })
    : yield* decodeOwnedUserAuthV1(request.auth.user);
  const normalizedArguments = yield* Effect.try({
    try: () => normalizeFlarexValueV1(request.arguments),
    catch: (cause) =>
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidArguments",
        cause,
      }),
  });
  if (!isCanonicalFlarexRuntimeObjectV1(normalizedArguments.value)) {
    return yield* Effect.fail(
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidArguments",
      }),
    );
  }
  const argumentArraySemanticBytes = yield* Effect.try({
    try: () =>
      requirePointMutationArgumentSemanticSizeV1(
        normalizedArguments.semanticSizeBytes,
      ),
    catch: (cause) =>
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidArguments",
        cause,
      }),
  });
  if (argumentArraySemanticBytes !== request.argumentArraySemanticBytes) {
    return yield* Effect.fail(
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "argumentSizeMismatch",
      }),
    );
  }
  return Object.freeze({
    format: request.format,
    version: request.version,
    artifact: Object.freeze({ ...request.artifact }),
    function: Object.freeze({ ...request.function }),
    auth,
    arguments: normalizedArguments.value,
    argumentArraySemanticBytes,
    tables: Object.freeze(
      request.tables.map((table) => Object.freeze({ ...table })),
    ),
    context: Object.freeze({
      ...request.context,
      randomSeed: copyBytes(request.context.randomSeed),
    }),
  } satisfies PointMutationExactRuntimeRequestV1);
});

const decodeOwnedUserAuthV1 = Effect.fn(
  "PointMutationExactRuntimeProtocol.decodeUserAuth",
)(function* (
  value: UserIdentity,
): Effect.fn.Return<
  Extract<PointMutationExactRuntimeAuthV1, { readonly kind: "user" }>,
  PointMutationExactRuntimeProtocolV1Error
> {
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(value),
    catch: cause =>
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause,
      }),
  });
  if (
    normalized.semanticSizeBytes >
      MAX_POINT_MUTATION_EXACT_RUNTIME_AUTH_SEMANTIC_BYTES_V1
  ) {
    return yield* Effect.fail(
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause: new Error("Exact-runtime user identity exceeds its byte limit."),
      }),
    );
  }
  const owned = structuredClone(value);
  const user = yield* decodeUserIdentityEffect(owned).pipe(
    Effect.mapError(cause =>
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "request",
        reason: "invalidAuth",
        cause,
      })
    ),
  );
  freezeUserIdentity(user);
  return Object.freeze({
    kind: "user",
    user,
  });
});

function freezeUserIdentity(user: UserIdentity): void {
  for (const value of Object.values(user)) {
    if (value !== undefined) freezeJsonValue(value);
  }
  Object.freeze(user);
}

function freezeJsonValue(value: Json): void {
  if (Array.isArray(value)) {
    for (const item of value) freezeJsonValue(item);
    Object.freeze(value);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freezeJsonValue(item);
    Object.freeze(value);
  }
}

export const decodePointMutationExactRuntimeResultV1Effect = Effect.fn(
  "PointMutationExactRuntimeProtocol.decodeResult",
)(function* (
  value: unknown,
): Effect.fn.Return<
  PointMutationExactRuntimeResultV1,
  PointMutationExactRuntimeProtocolV1Error
> {
  const result = yield* Effect.fromResult(
    decodeExactRuntimeResultShapeV1Result(value).pipe(
      Result.mapError((cause) =>
        new PointMutationExactRuntimeProtocolV1Error({
          boundary: "result",
          reason: "invalidShape",
          cause,
        })
      ),
    ),
  );
  const normalized = yield* Effect.try({
    try: () => normalizeFlarexValueV1(result.value),
    catch: (cause) =>
      new PointMutationExactRuntimeProtocolV1Error({
        boundary: "result",
        reason: "invalidResult",
        cause,
      }),
  });
  return Object.freeze({
    format: result.format,
    version: result.version,
    value: normalized.value,
  } satisfies PointMutationExactRuntimeResultV1);
});
