import { Result, Schema } from "effect";
import { UserIdentitySchema } from "flarex-protocol/auth";
import type { Json } from "flarex-protocol/json";
import { ReplacementScopeIdV1Schema } from "flarex-protocol/storage-authority";

const STRICT_PARSE_OPTIONS = { onExcessProperty: "error" } as const;
const PrincipalObjectSchema = Schema.Struct({
  version: Schema.Literal(1),
  scopeId: ReplacementScopeIdV1Schema,
  executionIdentity: Schema.Struct({
    kind: Schema.Literal("user"),
    user: UserIdentitySchema,
  }).annotate({ parseOptions: STRICT_PARSE_OPTIONS }),
}).annotate({ parseOptions: STRICT_PARSE_OPTIONS });

export type TaskExecutionPrincipalObjectV1 = typeof PrincipalObjectSchema.Type;
export type TaskExecutionPrincipalIdentity = TaskExecutionPrincipalObjectV1["executionIdentity"];

const decodePrincipalObject = Schema.decodeUnknownResult(
  PrincipalObjectSchema,
  STRICT_PARSE_OPTIONS,
);

/** Decode protocol-owned input. Bounded, no-getter capture and canonical byte
 * verification remain with the caller; this decoder proves shape and takes an
 * immutable, detached copy, not execution authority. */
export function decodeTaskExecutionPrincipalObjectV1(
  input: unknown,
): Result.Result<TaskExecutionPrincipalObjectV1, void> {
  return decodePrincipalObject(input).pipe(
    Result.map(ownPrincipalObject),
    Result.mapError(() => undefined),
  );
}

/** Take ownership after validation by the principal object or identity owner. */
export function ownPrincipalObject(
  input: TaskExecutionPrincipalObjectV1,
): TaskExecutionPrincipalObjectV1 {
  const executionIdentity = structuredClone(input.executionIdentity);
  for (const value of Object.values(executionIdentity.user)) {
    if (value !== undefined) freezeJson(value);
  }
  Object.freeze(executionIdentity.user);
  Object.freeze(executionIdentity);
  return Object.freeze({
    version: 1,
    scopeId: input.scopeId,
    executionIdentity,
  });
}

function freezeJson(value: Json): void {
  if (Array.isArray(value)) {
    for (const member of value) freezeJson(member);
    Object.freeze(value);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) freezeJson(member);
    Object.freeze(value);
  }
}
