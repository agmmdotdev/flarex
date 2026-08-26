import type { ApplicationRelationSourceReference } from
  "@flarex/persistence-postgres/internal/application-relation-read";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import {
  RelationIdentityV1Schema,
  type RelationSourcePathV1,
} from "flarex-protocol/internal/relation-declaration-v1";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from
  "flarex-protocol/internal/application-schema-binding";
import { Data, Result, Schema } from "effect";

const decodeRelationIdentity = Schema.decodeUnknownResult(
  RelationIdentityV1Schema,
);

export interface TakeIncomingRelationSourcesInput {
  readonly relation: ApplicationRelationSourceReference;
  readonly target: AppDocumentIdV1;
  readonly limit: number;
}

export class ApplicationRelationQueryInputError extends Data.TaggedError(
  "ApplicationRelationQueryInputError",
)<{
  readonly operation: "takeIncomingRelationSources";
  readonly reason: "invalidInput";
  readonly path: string;
  readonly cause?: unknown;
}> {}

export function decodeTakeIncomingRelationSourcesInput(
  input: unknown,
): Result.Result<
  TakeIncomingRelationSourcesInput,
  ApplicationRelationQueryInputError
> {
  return snapshotTakeIncomingRelationSourcesInput(input).pipe(
    Result.flatMap(snapshot => Result.gen(function* () {
      const table = yield* decodeRelationIdentity(snapshot.table).pipe(
        Result.mapError(cause => inputError("input.relation.source.table", cause)),
      );
      const field = yield* decodeRelationIdentity(snapshot.field).pipe(
        Result.mapError(cause =>
          inputError("input.relation.source.path[0].name", cause)
        ),
      );
      if (snapshot.kind !== "field") {
        return yield* Result.fail(
          inputError("input.relation.source.path[0].kind"),
        );
      }
      const target = yield* decodeAppDocumentIdentityV1Result(
        snapshot.target,
      ).pipe(
        Result.mapError(cause => inputError("input.target", cause)),
        Result.map(identity => identity.id),
      );
      const limit = snapshot.limit;
      if (
        !isPositiveSafeInteger(limit) ||
        limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
      ) {
        return yield* Result.fail(inputError("input.limit"));
      }
      const path: RelationSourcePathV1 = Object.freeze([
        Object.freeze({ kind: "field" as const, name: field }),
      ]);
      return Object.freeze({
        relation: Object.freeze({
          source: Object.freeze({ table, path }),
        }),
        target,
        limit,
      });
    })),
  );
}

interface TakeIncomingRelationSourcesInputSnapshot {
  readonly table: unknown;
  readonly kind: unknown;
  readonly field: unknown;
  readonly target: unknown;
  readonly limit: unknown;
}

function snapshotTakeIncomingRelationSourcesInput(
  input: unknown,
): Result.Result<
  TakeIncomingRelationSourcesInputSnapshot,
  ApplicationRelationQueryInputError
> {
  return Result.gen(function* () {
    const root = yield* inspectExactRecord(
      input,
      ["relation", "target", "limit"],
      "input",
    );
    const relation = yield* inspectExactRecord(
      root.get("relation"),
      ["source"],
      "input.relation",
    );
    const source = yield* inspectExactRecord(
      relation.get("source"),
      ["table", "path"],
      "input.relation.source",
    );
    const path = yield* inspectExactSingleMemberArray(
      source.get("path"),
      "input.relation.source.path",
    );
    const field = yield* inspectExactRecord(
      path,
      ["kind", "name"],
      "input.relation.source.path[0]",
    );
    return Object.freeze({
      table: source.get("table"),
      kind: field.get("kind"),
      field: field.get("name"),
      target: root.get("target"),
      limit: root.get("limit"),
    });
  });
}

function inspectExactRecord(
  input: unknown,
  expectedKeys: ReadonlyArray<string>,
  path: string,
): Result.Result<ReadonlyMap<string, unknown>, ApplicationRelationQueryInputError> {
  if (input === null || typeof input !== "object") {
    return Result.fail(inputError(path));
  }
  return Result.gen(function* () {
    const isArray = yield* inspectIsArray(input, path);
    if (isArray) return yield* Result.fail(inputError(path));
    const keys = yield* inspectOwnKeys(input, path);
    if (
      keys.length !== expectedKeys.length ||
      keys.some(key =>
        typeof key !== "string" || !expectedKeys.includes(key)
      )
    ) return yield* Result.fail(inputError(path));
    const properties = new Map<string, unknown>();
    for (const key of expectedKeys) {
      const descriptor = yield* inspectOwnDescriptor(input, key, `${path}.${key}`);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) return yield* Result.fail(inputError(`${path}.${key}`));
      properties.set(key, descriptor.value);
    }
    return properties;
  });
}

function inspectExactSingleMemberArray(
  input: unknown,
  path: string,
): Result.Result<unknown, ApplicationRelationQueryInputError> {
  if (input === null || typeof input !== "object") {
    return Result.fail(inputError(path));
  }
  return Result.gen(function* () {
    const isArray = yield* inspectIsArray(input, path);
    if (!isArray) return yield* Result.fail(inputError(path));
    const keys = yield* inspectOwnKeys(input, path);
    if (
      keys.length !== 2 ||
      !keys.includes("0") ||
      !keys.includes("length")
    ) return yield* Result.fail(inputError(path));
    const length = yield* inspectOwnDescriptor(input, "length", `${path}.length`);
    if (
      length === undefined ||
      !("value" in length) ||
      length.enumerable !== false ||
      length.value !== 1
    ) return yield* Result.fail(inputError(path));
    const member = yield* inspectOwnDescriptor(input, "0", `${path}[0]`);
    if (
      member === undefined ||
      !("value" in member) ||
      member.enumerable !== true
    ) return yield* Result.fail(inputError(`${path}[0]`));
    return member.value;
  });
}

function inspectIsArray(
  input: object,
  path: string,
): Result.Result<boolean, ApplicationRelationQueryInputError> {
  try {
    return Result.succeed(Array.isArray(input));
  } catch (cause) {
    return Result.fail(inputError(path, cause));
  }
}

function inspectOwnKeys(
  input: object,
  path: string,
): Result.Result<ReadonlyArray<PropertyKey>, ApplicationRelationQueryInputError> {
  try {
    return Result.succeed(Reflect.ownKeys(input));
  } catch (cause) {
    return Result.fail(inputError(path, cause));
  }
}

function inspectOwnDescriptor(
  input: object,
  key: PropertyKey,
  path: string,
): Result.Result<PropertyDescriptor | undefined, ApplicationRelationQueryInputError> {
  try {
    return Result.succeed(Object.getOwnPropertyDescriptor(input, key));
  } catch (cause) {
    return Result.fail(inputError(path, cause));
  }
}

function inputError(
  path: string,
  cause?: unknown,
): ApplicationRelationQueryInputError {
  return new ApplicationRelationQueryInputError({
    operation: "takeIncomingRelationSources",
    reason: "invalidInput",
    path,
    ...(cause === undefined ? {} : { cause }),
  });
}
