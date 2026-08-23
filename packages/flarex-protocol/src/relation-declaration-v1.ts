import { copyBytes } from "@flarex/utils/bytes";
import { Data, Result, Schema } from "effect";

import { snapshotDecodedProtocolPlainData } from
  "./decoded-protocol-snapshot";
import {
  encodeCanonicalJson,
  type JsonObject,
} from "./json";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  exactOwnDataIssue,
  hasExactOwnDataKeys,
  inspectOwnDataArray,
  inspectOwnDataRecord,
  type ExactOwnDataIssue,
} from "./exact-own-data";
import { snapshotExactRelationSourcePathV1 } from
  "./relation-source-path-v1-exact";

const UTF8_ENCODER = new TextEncoder();

export const RELATION_DECLARATION_FORMAT_V1 =
  "flarex.relation-declaration" as const;
export const RELATION_DECLARATION_VERSION_V1 = 1 as const;
export const MAX_RELATION_IDENTITY_CODE_UNITS_V1 = 256;
export const MAX_RELATION_MANY_ITEMS_V1 = 1_024;
export const MAX_RELATION_DECLARATIONS_V1 = 1_024;
export const MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1 = 8_192;

export const RelationIdentityV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    value.length >= 1 && value.length <= MAX_RELATION_IDENTITY_CODE_UNITS_V1
      ? undefined
      : `Expected between 1 and ${MAX_RELATION_IDENTITY_CODE_UNITS_V1} UTF-16 code units`
  ),
).pipe(Schema.brand("FlarexDB/RelationIdentityV1"));
export type RelationIdentityV1 = typeof RelationIdentityV1Schema.Type;

export const RelationSourcePathFieldV1Schema = Schema.Struct({
  kind: Schema.Literal("field"),
  name: RelationIdentityV1Schema,
}).annotate(StrictStructOptions);
export type RelationSourcePathFieldV1 =
  typeof RelationSourcePathFieldV1Schema.Type;

export const RelationSourcePathV1Schema = Schema.Tuple([
  RelationSourcePathFieldV1Schema,
]);
export type RelationSourcePathV1 = typeof RelationSourcePathV1Schema.Type;

export const RelationOneValueV1Schema = Schema.Struct({
  cardinality: Schema.Literal("one"),
  required: Schema.Boolean,
}).annotate(StrictStructOptions);
export type RelationOneValueV1 = typeof RelationOneValueV1Schema.Type;

export const RelationManyValueV1Schema = Schema.Struct({
  cardinality: Schema.Literal("many"),
  minItems: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: MAX_RELATION_MANY_ITEMS_V1 }),
  ),
  maxItems: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 1, maximum: MAX_RELATION_MANY_ITEMS_V1 }),
  ),
  ordered: Schema.Boolean,
  duplicates: Schema.Literal("forbid"),
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((value) =>
    value.minItems <= value.maxItems
      ? undefined
      : "Expected relation minItems to be at most maxItems"
  ),
);
export type RelationManyValueV1 = typeof RelationManyValueV1Schema.Type;

export const RelationValueV1Schema = Schema.Union([
  RelationOneValueV1Schema,
  RelationManyValueV1Schema,
]);
export type RelationValueV1 = typeof RelationValueV1Schema.Type;

const RelationSourceV1Schema = Schema.Struct({
  table: RelationIdentityV1Schema,
  path: RelationSourcePathV1Schema,
  forwardName: RelationIdentityV1Schema,
}).annotate(StrictStructOptions).check(
  Schema.makeFilter((source) =>
    source.path[0].name === source.forwardName
      ? undefined
      : "Expected the first-profile source field to equal its forward name"
  ),
);

const RelationTargetV1Schema = Schema.Struct({
  table: RelationIdentityV1Schema,
}).annotate(StrictStructOptions);

const RelationInverseV1Schema = Schema.Struct({
  cardinality: Schema.Literal("many"),
  name: Schema.Union([RelationIdentityV1Schema, Schema.Null]),
}).annotate(StrictStructOptions);

export const RelationDeclarationV1Schema = Schema.Struct({
  format: Schema.Literal(RELATION_DECLARATION_FORMAT_V1),
  version: Schema.Literal(RELATION_DECLARATION_VERSION_V1),
  source: RelationSourceV1Schema,
  target: RelationTargetV1Schema,
  value: RelationValueV1Schema,
  inverse: RelationInverseV1Schema,
  localized: Schema.Literal(false),
  onTargetDelete: Schema.Literal("restrict"),
}).annotate(StrictStructOptions);
export type RelationDeclarationV1 = typeof RelationDeclarationV1Schema.Type;

export const RelationDeclarationsV1Schema = Schema.Array(
  RelationDeclarationV1Schema,
).check(Schema.isMaxLength(MAX_RELATION_DECLARATIONS_V1));

const decodeRelationDeclarationShapeV1Result = Schema.decodeUnknownResult(
  RelationDeclarationV1Schema,
  StrictParseOptions,
);
const decodeRelationDeclarationsShapeV1Result = Schema.decodeUnknownResult(
  RelationDeclarationsV1Schema,
  StrictParseOptions,
);

export type RelationDeclarationV1Issue =
  | Readonly<{
      readonly reason: "invalidDeclaration";
      readonly cause: Schema.SchemaError;
    }>
  | Readonly<{
      readonly reason: "invalidDeclarationSet";
      readonly cause: Schema.SchemaError;
    }>
  | Readonly<{
      readonly reason: "invalidOwnData";
      readonly path: string;
      readonly cause?: unknown;
    }>
  | Readonly<{
      readonly reason: "declarationLimitExceeded";
      readonly observed: number;
      readonly maximum: number;
    }>
  | Readonly<{
      readonly reason: "canonicalBytesExceeded";
      readonly observedBytes: number;
      readonly maximumBytes: number;
    }>;

export class RelationDeclarationV1Error extends Data.TaggedError(
  "RelationDeclarationV1Error",
)<{
  readonly operation: "decodeDeclaration" | "decodeDeclarations" |
    "canonicalizeDeclaration";
  readonly issue: RelationDeclarationV1Issue;
}> {}

export interface CanonicalRelationDeclarationV1 {
  readonly declaration: RelationDeclarationV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export function decodeRelationDeclarationV1Result(
  input: unknown,
): Result.Result<RelationDeclarationV1, RelationDeclarationV1Error> {
  return snapshotExactRelationDeclarationV1(input, "declaration", new Set())
    .pipe(
    Result.mapError(issue => ownDataError("decodeDeclaration", issue)),
    Result.flatMap(value => decodeRelationDeclarationShapeV1Result(value).pipe(
      Result.mapError((cause) => new RelationDeclarationV1Error({
        operation: "decodeDeclaration",
        issue: { reason: "invalidDeclaration", cause },
      })),
    )),
    Result.map(snapshotDecodedProtocolPlainData),
  );
}

export function decodeRelationDeclarationsV1Result(
  input: unknown,
): Result.Result<
  ReadonlyArray<RelationDeclarationV1>,
  RelationDeclarationV1Error
> {
  return snapshotExactRelationDeclarationsV1(input).pipe(
    Result.mapError(issue => ownDataError("decodeDeclarations", issue)),
    Result.flatMap(value => decodeRelationDeclarationsShapeV1Result(value).pipe(
      Result.mapError((cause) => new RelationDeclarationV1Error({
        operation: "decodeDeclarations",
        issue: { reason: "invalidDeclarationSet", cause },
      })),
    )),
    Result.map(snapshotDecodedProtocolPlainData),
  );
}

function snapshotExactRelationDeclarationsV1(
  input: unknown,
): Result.Result<unknown, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const declarations = yield* inspectOwnDataArray(
      input,
      "declarations",
      { maximumLength: MAX_RELATION_DECLARATIONS_V1 },
    );
    const snapshot: unknown[] = [];
    for (let index = 0; index < declarations.values.length; index += 1) {
      snapshot.push(yield* snapshotExactRelationDeclarationV1(
        declarations.values[index],
        `declarations[${index}]`,
        declarations.ancestors,
      ));
    }
    return snapshot;
  });
}

function snapshotExactRelationDeclarationV1(
  input: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): Result.Result<unknown, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const declaration = yield* inspectOwnDataRecord(input, path, ancestors);
    if (!hasExactOwnDataKeys(declaration.properties, [
      "format",
      "version",
      "source",
      "target",
      "value",
      "inverse",
      "localized",
      "onTargetDelete",
    ])) {
      return yield* Result.fail(exactOwnDataIssue(path));
    }
    const source = yield* inspectOwnDataRecord(
      declaration.properties.get("source"),
      `${path}.source`,
      declaration.ancestors,
    );
    if (!hasExactOwnDataKeys(source.properties, [
      "table",
      "path",
      "forwardName",
    ])) {
      return yield* Result.fail(exactOwnDataIssue(`${path}.source`));
    }
    const sourcePath = yield* snapshotExactRelationSourcePathV1(
      source.properties.get("path"),
      `${path}.source.path`,
      source.ancestors,
    );
    const target = yield* inspectOwnDataRecord(
      declaration.properties.get("target"),
      `${path}.target`,
      declaration.ancestors,
    );
    if (!hasExactOwnDataKeys(target.properties, ["table"])) {
      return yield* Result.fail(exactOwnDataIssue(`${path}.target`));
    }
    const inverse = yield* inspectOwnDataRecord(
      declaration.properties.get("inverse"),
      `${path}.inverse`,
      declaration.ancestors,
    );
    if (!hasExactOwnDataKeys(inverse.properties, ["cardinality", "name"])) {
      return yield* Result.fail(exactOwnDataIssue(`${path}.inverse`));
    }
    const value = yield* snapshotExactRelationValueV1(
      declaration.properties.get("value"),
      `${path}.value`,
      declaration.ancestors,
    );
    return {
      format: declaration.properties.get("format"),
      version: declaration.properties.get("version"),
      source: {
        table: source.properties.get("table"),
        path: sourcePath,
        forwardName: source.properties.get("forwardName"),
      },
      target: { table: target.properties.get("table") },
      value,
      inverse: {
        cardinality: inverse.properties.get("cardinality"),
        name: inverse.properties.get("name"),
      },
      localized: declaration.properties.get("localized"),
      onTargetDelete: declaration.properties.get("onTargetDelete"),
    };
  });
}

function snapshotExactRelationValueV1(
  input: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): Result.Result<unknown, ExactOwnDataIssue> {
  return Result.gen(function* () {
    const value = yield* inspectOwnDataRecord(input, path, ancestors);
    const cardinality = value.properties.get("cardinality");
    const oneKeys = ["cardinality", "required"];
    const manyKeys = [
      "cardinality",
      "minItems",
      "maxItems",
      "ordered",
      "duplicates",
    ];
    const usesManyShape = cardinality === "many" ||
      cardinality !== "one" && hasExactOwnDataKeys(value.properties, manyKeys);
    const expectedKeys = usesManyShape ? manyKeys : oneKeys;
    if (!hasExactOwnDataKeys(value.properties, expectedKeys)) {
      return yield* Result.fail(exactOwnDataIssue(path));
    }
    return usesManyShape
      ? {
          cardinality,
          minItems: value.properties.get("minItems"),
          maxItems: value.properties.get("maxItems"),
          ordered: value.properties.get("ordered"),
          duplicates: value.properties.get("duplicates"),
        }
      : {
          cardinality,
          required: value.properties.get("required"),
        };
  });
}

function ownDataError(
  operation: "decodeDeclaration" | "decodeDeclarations",
  issue: ExactOwnDataIssue,
): RelationDeclarationV1Error {
  if (issue.reason === "maximumLengthExceeded") {
    return new RelationDeclarationV1Error({
      operation,
      issue: {
        reason: "declarationLimitExceeded",
        observed: issue.observed,
        maximum: issue.maximum,
      },
    });
  }
  return new RelationDeclarationV1Error({
    operation,
    issue: {
      reason: "invalidOwnData",
      path: issue.path,
      ...(issue.cause === undefined ? {} : { cause: issue.cause }),
    },
  });
}

export function canonicalizeRelationDeclarationV1Result(
  input: unknown,
): Result.Result<
  CanonicalRelationDeclarationV1,
  RelationDeclarationV1Error
> {
  return decodeRelationDeclarationV1Result(input).pipe(
    Result.flatMap((declaration) => {
      const canonicalText = encodeRelationDeclarationV1CanonicalText(
        declaration,
      );
      const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
      if (
        canonicalBytes.byteLength >
          MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1
      ) {
        return Result.fail(new RelationDeclarationV1Error({
          operation: "canonicalizeDeclaration",
          issue: {
            reason: "canonicalBytesExceeded",
            observedBytes: canonicalBytes.byteLength,
            maximumBytes: MAX_RELATION_DECLARATION_CANONICAL_BYTES_V1,
          },
        }));
      }
      const stableBytes = copyBytes(canonicalBytes);
      return Result.succeed(Object.freeze({
        declaration,
        canonicalText,
        get canonicalBytes(): Uint8Array {
          return copyBytes(stableBytes);
        },
      } satisfies CanonicalRelationDeclarationV1));
    }),
  );
}

export function compareRelationDeclarationsV1(
  left: RelationDeclarationV1,
  right: RelationDeclarationV1,
): number {
  const leftText = encodeRelationDeclarationV1CanonicalText(left);
  const rightText = encodeRelationDeclarationV1CanonicalText(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function encodeRelationDeclarationV1CanonicalText(
  declaration: RelationDeclarationV1,
): string {
  return encodeCanonicalJson(
    relationDeclarationV1ToJson(declaration),
    (issue) => {
      throw new Error(
        `Typed relation declaration lost its JSON representation: ${issue.reason}`,
      );
    },
  );
}

function relationDeclarationV1ToJson(
  declaration: RelationDeclarationV1,
): JsonObject {
  const value: JsonObject = declaration.value.cardinality === "one"
    ? {
      cardinality: declaration.value.cardinality,
      required: declaration.value.required,
    }
    : {
      cardinality: declaration.value.cardinality,
      duplicates: declaration.value.duplicates,
      maxItems: declaration.value.maxItems,
      minItems: declaration.value.minItems,
      ordered: declaration.value.ordered,
    };
  return {
    format: declaration.format,
    inverse: {
      cardinality: declaration.inverse.cardinality,
      name: declaration.inverse.name,
    },
    localized: declaration.localized,
    onTargetDelete: declaration.onTargetDelete,
    source: {
      forwardName: declaration.source.forwardName,
      path: [{
        kind: declaration.source.path[0].kind,
        name: declaration.source.path[0].name,
      }],
      table: declaration.source.table,
    },
    target: { table: declaration.target.table },
    value,
    version: declaration.version,
  };
}
