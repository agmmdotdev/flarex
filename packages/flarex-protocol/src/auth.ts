import { Data, Effect, Schema } from "effect";
import { isJson, type Json } from "./json";

export interface UserIdentity {
  readonly tokenIdentifier: string;
  readonly subject: string;
  readonly issuer: string;
  readonly name?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly nickname?: string;
  readonly preferredUsername?: string;
  readonly profileUrl?: string;
  readonly pictureUrl?: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
  readonly gender?: string;
  readonly birthday?: string;
  readonly timezone?: string;
  readonly language?: string;
  readonly phoneNumber?: string;
  readonly phoneNumberVerified?: boolean;
  readonly address?: string;
  readonly updatedAt?: string;
  readonly [claim: string]: Json | undefined;
}

export type UserIdentityAttributes = Omit<UserIdentity, "tokenIdentifier">;

export type ExecutionIdentity =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly user: UserIdentity };

export function executionIdentityFingerprint(identity: ExecutionIdentity): string {
  return `identity:v1:${fnv1a64Hex(stableIdentityJson(identity))}`;
}

export class AuthProtocolValidationError extends Data.TaggedError(
  "AuthProtocolValidationError",
)<{
  readonly schema: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const UserIdentitySchema = Schema.declare<UserIdentity>(
  isUserIdentity,
  {
    title: "UserIdentity",
    description:
      "A Convex-compatible authenticated user identity with JSON custom claims.",
  },
);

export const ExecutionIdentitySchema = Schema.declare<ExecutionIdentity>(
  isExecutionIdentity,
  {
    title: "ExecutionIdentity",
    description:
      "An execution identity that is either anonymous or a validated user identity.",
  },
);

const decodeUnknownUserIdentity = Schema.decodeUnknownEffect(UserIdentitySchema);
const decodeUnknownExecutionIdentity = Schema.decodeUnknownEffect(
  ExecutionIdentitySchema,
);

export const decodeUserIdentityEffect = Effect.fn(
  "AuthProtocol.decodeUserIdentity",
)(function* (
  value: unknown,
): Effect.fn.Return<UserIdentity, AuthProtocolValidationError> {
  return yield* decodeUnknownUserIdentity(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "UserIdentity",
        message:
          "User identity must include string tokenIdentifier, subject, issuer, optional OIDC fields, and JSON custom claims.",
        cause,
      })
    ),
  );
});

export const decodeExecutionIdentityEffect = Effect.fn(
  "AuthProtocol.decodeExecutionIdentity",
)(function* (
  value: unknown,
): Effect.fn.Return<ExecutionIdentity, AuthProtocolValidationError> {
  return yield* decodeUnknownExecutionIdentity(value).pipe(
    Effect.mapError(cause =>
      new AuthProtocolValidationError({
        schema: "ExecutionIdentity",
        message:
          "Execution identity must be anonymous or include a valid user identity.",
        cause,
      })
    ),
  );
});

function isExecutionIdentity(value: unknown): value is ExecutionIdentity {
  if (!isRecord(value)) return false;
  if (value.kind === "anonymous") {
    return !("user" in value);
  }
  if (value.kind === "user") {
    return isUserIdentity(value.user);
  }
  return false;
}

function isUserIdentity(value: unknown): value is UserIdentity {
  if (!isRecord(value)) return false;
  if (
    typeof value.tokenIdentifier !== "string" ||
    typeof value.subject !== "string" ||
    typeof value.issuer !== "string"
  ) {
    return false;
  }
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    if (isKnownStringClaim(key)) {
      if (typeof field !== "string") return false;
      continue;
    }
    if (isKnownBooleanClaim(key)) {
      if (typeof field !== "boolean") return false;
      continue;
    }
    if (!isJson(field)) return false;
  }
  return true;
}

function isKnownStringClaim(key: string): boolean {
  return (
    key === "tokenIdentifier" ||
    key === "subject" ||
    key === "issuer" ||
    key === "name" ||
    key === "givenName" ||
    key === "familyName" ||
    key === "nickname" ||
    key === "preferredUsername" ||
    key === "profileUrl" ||
    key === "pictureUrl" ||
    key === "email" ||
    key === "gender" ||
    key === "birthday" ||
    key === "timezone" ||
    key === "language" ||
    key === "phoneNumber" ||
    key === "address" ||
    key === "updatedAt"
  );
}

function isKnownBooleanClaim(key: string): boolean {
  return key === "emailVerified" || key === "phoneNumberVerified";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.getOwnPropertySymbols(value).length === 0;
}

function stableIdentityJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableIdentityJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableIdentityJson(record[key])}`)
    .join(",")}}`;
}

function fnv1a64Hex(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}
